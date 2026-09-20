package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/logger"
	"github.com/multica-ai/multica/server/internal/processtemplate"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (h *Handler) ApplyWorkspaceProcessTemplate(w http.ResponseWriter, r *http.Request) {
	h.applyOrUpgradeWorkspaceProcessTemplate(w, r, false)
}

func (h *Handler) UpgradeWorkspaceProcessTemplate(w http.ResponseWriter, r *http.Request) {
	h.applyOrUpgradeWorkspaceProcessTemplate(w, r, true)
}

func (h *Handler) applyOrUpgradeWorkspaceProcessTemplate(w http.ResponseWriter, r *http.Request, upgrade bool) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if _, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin"); !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
	if !ok {
		return
	}
	templateID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "template id")
	if !ok {
		return
	}

	template, err := h.Queries.GetProcessTemplate(r.Context(), templateID)
	if isNotFound(err) {
		writeError(w, http.StatusNotFound, "process template not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get process template")
		return
	}
	latest, err := h.Queries.GetLatestProcessTemplateVersion(r.Context(), template.ID)
	if isNotFound(err) {
		writeError(w, http.StatusBadRequest, "process template has no versions")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get process template version")
		return
	}

	installed, installedErr := h.Queries.GetWorkspaceProcessTemplate(r.Context(), db.GetWorkspaceProcessTemplateParams{
		WorkspaceID: wsUUID,
		TemplateID:  template.ID,
	})
	if installedErr != nil && !errors.Is(installedErr, pgx.ErrNoRows) && !isNotFound(installedErr) {
		writeError(w, http.StatusInternalServerError, "failed to get workspace process template")
		return
	}
	installedOK := installedErr == nil
	if upgrade {
		if !installedOK {
			writeError(w, http.StatusBadRequest, "process template is not installed in this workspace")
			return
		}
		if uuidEqual(installed.TemplateVersionID, latest.ID) {
			h.writeWorkspaceProcessTemplate(w, r, wsUUID, template.ID)
			return
		}
	}

	zipData, err := h.Queries.GetProcessTemplateVersionZip(r.Context(), latest.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load process template zip")
		return
	}
	archive, err := processtemplate.ParseZip(zipData)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start process template apply")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if err := h.applyProcessTemplateArchive(r.Context(), qtx, wsUUID, parseUUID(userID), archive); err != nil {
		status := http.StatusInternalServerError
		if isApplyClientError(err) {
			status = http.StatusBadRequest
		}
		slog.Warn("apply process template failed", append(logger.RequestAttrs(r), "error", err, "template_id", uuidToString(template.ID))...)
		writeError(w, status, err.Error())
		return
	}
	if _, err := qtx.UpsertWorkspaceProcessTemplate(r.Context(), db.UpsertWorkspaceProcessTemplateParams{
		WorkspaceID:       wsUUID,
		TemplateID:        template.ID,
		TemplateVersionID: latest.ID,
		AppliedBy:         parseUUID(userID),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record process template install")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit process template apply")
		return
	}
	h.writeWorkspaceProcessTemplate(w, r, wsUUID, template.ID)
}

func (h *Handler) writeWorkspaceProcessTemplate(w http.ResponseWriter, r *http.Request, workspaceID, templateID pgtype.UUID) {
	rows, err := h.Queries.ListWorkspaceProcessTemplates(r.Context(), workspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list process templates")
		return
	}
	for _, row := range rows {
		if uuidEqual(row.ID, templateID) {
			writeJSON(w, http.StatusOK, workspaceProcessTemplateToResponse(row))
			return
		}
	}
	writeError(w, http.StatusNotFound, "process template not found")
}

func (h *Handler) applyProcessTemplateArchive(ctx context.Context, qtx *db.Queries, workspaceID, actorID pgtype.UUID, archive processtemplate.Archive) error {
	skillIDs, err := applyProcessTemplateSkills(ctx, qtx, workspaceID, actorID, archive.Skills)
	if err != nil {
		return err
	}
	agentsByKey, err := h.applyProcessTemplateAgents(ctx, qtx, workspaceID, actorID, archive.Agents, skillIDs)
	if err != nil {
		return err
	}
	if err := applyProcessTemplateSquads(ctx, qtx, workspaceID, actorID, archive.Squads, agentsByKey); err != nil {
		return err
	}
	return nil
}

func applyProcessTemplateSkills(ctx context.Context, qtx *db.Queries, workspaceID, actorID pgtype.UUID, skills []processtemplate.Skill) (map[string]pgtype.UUID, error) {
	skillIDs := map[string]pgtype.UUID{}
	register := func(name string, id pgtype.UUID) {
		for _, candidate := range processtemplate.SkillNameCandidates(name) {
			skillIDs[strings.ToLower(strings.TrimSpace(candidate))] = id
		}
	}
	for _, skill := range skills {
		files := make([]CreateSkillFileRequest, 0, len(skill.Files))
		for _, file := range skill.Files {
			files = append(files, CreateSkillFileRequest{Path: file.Path, Content: file.Content})
		}
		existing, found, err := findWorkspaceSkill(ctx, qtx, workspaceID, skill.Name)
		if err != nil {
			return nil, err
		}
		if found {
			overwritten, err := overwriteTemplateSkill(ctx, qtx, workspaceID, actorID, existing, skill, files)
			if err != nil {
				return nil, err
			}
			register(skill.Name, overwritten.ID)
			register(existing.Name, overwritten.ID)
			continue
		}
		created, err := createSkillWithFilesInTx(ctx, qtx, skillCreateInput{
			WorkspaceID: workspaceID,
			CreatorID:   actorID,
			Name:        skill.Name,
			Description: skill.Description,
			Content:     skill.Content,
			Files:       files,
		})
		if err != nil {
			if isUniqueViolation(err) {
				existing, found, findErr := findWorkspaceSkill(ctx, qtx, workspaceID, skill.Name)
				if findErr != nil {
					return nil, findErr
				}
				if !found {
					return nil, fmt.Errorf("skill %q already exists but could not be loaded", skill.Name)
				}
				overwritten, overwriteErr := overwriteTemplateSkill(ctx, qtx, workspaceID, actorID, existing, skill, files)
				if overwriteErr != nil {
					return nil, overwriteErr
				}
				register(skill.Name, overwritten.ID)
				register(existing.Name, overwritten.ID)
				continue
			}
			return nil, fmt.Errorf("failed to create skill %q: %w", skill.Name, err)
		}
		createdID := parseUUID(created.ID)
		register(skill.Name, createdID)
		register(created.Name, createdID)
	}
	return skillIDs, nil
}

func overwriteTemplateSkill(ctx context.Context, qtx *db.Queries, workspaceID, actorID pgtype.UUID, existing db.Skill, skill processtemplate.Skill, files []CreateSkillFileRequest) (db.Skill, error) {
	input := skillOverwriteInput{
		WorkspaceID:    workspaceID,
		TargetSkillID:  existing.ID,
		UserID:         uuidToString(actorID),
		ExpectedName:   existing.Name,
		NewName:        skill.Name,
		AllowOverwrite: func(string, db.Skill) bool { return true },
		Description:    skill.Description,
		Content:        skill.Content,
		Files:          files,
	}
	result, err := overwriteSkillWithFilesInTx(ctx, qtx, input)
	if errors.Is(err, errSkillOverwriteNameConflict) {
		input.NewName = ""
		result, err = overwriteSkillWithFilesInTx(ctx, qtx, input)
	}
	if err != nil {
		return db.Skill{}, fmt.Errorf("failed to update skill %q: %w", skill.Name, err)
	}
	updated, err := qtx.GetSkillInWorkspace(ctx, db.GetSkillInWorkspaceParams{
		ID:          parseUUID(result.ID),
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return db.Skill{}, err
	}
	return updated, nil
}

func findWorkspaceSkill(ctx context.Context, qtx *db.Queries, workspaceID pgtype.UUID, name string) (db.Skill, bool, error) {
	for _, candidate := range processtemplate.SkillNameCandidates(name) {
		skill, err := qtx.GetSkillByWorkspaceAndName(ctx, db.GetSkillByWorkspaceAndNameParams{
			WorkspaceID: workspaceID,
			Name:        candidate,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return db.Skill{}, false, err
		}
		return skill, true, nil
	}
	return db.Skill{}, false, nil
}

func (h *Handler) applyProcessTemplateAgents(ctx context.Context, qtx *db.Queries, workspaceID, actorID pgtype.UUID, agents []processtemplate.Agent, skillIDs map[string]pgtype.UUID) (map[string][]db.Agent, error) {
	existing, err := qtx.ListAllAgents(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to list agents: %w", err)
	}
	byKey := map[string][]db.Agent{}
	for _, tmpl := range agents {
		matches := findMatchingAgents(existing, tmpl)
		if len(matches) == 0 {
			created, err := h.createTemplateAgent(ctx, qtx, workspaceID, actorID, tmpl)
			if err != nil {
				if isUniqueViolation(err) {
					existing, listErr := qtx.ListAllAgents(ctx, workspaceID)
					if listErr != nil {
						return nil, listErr
					}
					matches = findMatchingAgents(existing, tmpl)
					if len(matches) == 0 {
						return nil, fmt.Errorf("an agent named %q already exists in this workspace", firstNonEmptyName(tmpl.DisplayName, tmpl.Key))
					}
				} else {
					return nil, err
				}
			} else {
				if err := syncTemplateAgentSkills(ctx, qtx, created.ID, tmpl.Skills, skillIDs, tmpl.DisplayName); err != nil {
					return nil, err
				}
				byKey[tmpl.Key] = append(byKey[tmpl.Key], created)
				existing = append(existing, created)
				continue
			}
		}
		updatedMatches := make([]db.Agent, 0, len(matches))
		for _, match := range matches {
			updated, err := updateTemplateAgent(ctx, qtx, match, tmpl)
			if err != nil {
				return nil, err
			}
			if err := syncTemplateAgentSkills(ctx, qtx, updated.ID, tmpl.Skills, skillIDs, tmpl.DisplayName); err != nil {
				return nil, err
			}
			updatedMatches = append(updatedMatches, updated)
		}
		byKey[tmpl.Key] = append(byKey[tmpl.Key], updatedMatches...)
	}
	return byKey, nil
}

func (h *Handler) createTemplateAgent(ctx context.Context, qtx *db.Queries, workspaceID, actorID pgtype.UUID, tmpl processtemplate.Agent) (db.Agent, error) {
	runtime, err := firstOnlineRuntime(ctx, qtx, workspaceID, actorID)
	if err != nil {
		return db.Agent{}, err
	}
	created, err := qtx.CreateAgent(ctx, db.CreateAgentParams{
		WorkspaceID:          workspaceID,
		Name:                 firstNonEmptyName(tmpl.DisplayName, tmpl.Key),
		Description:          tmpl.Description,
		Instructions:         tmpl.Instructions,
		RuntimeMode:          runtime.RuntimeMode,
		RuntimeConfig:        []byte("{}"),
		RuntimeID:            runtime.ID,
		Visibility:           "private",
		PermissionMode:       "private",
		MaxConcurrentTasks:   1,
		OwnerID:              actorID,
		CustomEnv:            []byte("{}"),
		CustomArgs:           []byte("[]"),
		ConversationStarters: []byte("[]"),
	})
	if err != nil {
		return db.Agent{}, err
	}
	return created, nil
}

func updateTemplateAgent(ctx context.Context, qtx *db.Queries, existing db.Agent, tmpl processtemplate.Agent) (db.Agent, error) {
	agent := existing
	if existing.ArchivedAt.Valid {
		restored, err := qtx.RestoreAgent(ctx, existing.ID)
		if err != nil {
			return db.Agent{}, fmt.Errorf("failed to restore agent %q: %w", existing.Name, err)
		}
		agent = restored
	}
	name := firstNonEmptyName(tmpl.DisplayName, tmpl.Key)
	updated, err := qtx.UpdateAgent(ctx, db.UpdateAgentParams{
		ID:           agent.ID,
		Name:         pgtype.Text{String: name, Valid: true},
		Description:  pgtype.Text{String: tmpl.Description, Valid: true},
		Instructions: pgtype.Text{String: tmpl.Instructions, Valid: true},
	})
	if err != nil {
		if isUniqueViolation(err) {
			updated, err = qtx.UpdateAgent(ctx, db.UpdateAgentParams{
				ID:           agent.ID,
				Description:  pgtype.Text{String: tmpl.Description, Valid: true},
				Instructions: pgtype.Text{String: tmpl.Instructions, Valid: true},
			})
		}
		if err != nil {
			return db.Agent{}, fmt.Errorf("failed to update agent %q: %w", existing.Name, err)
		}
	}
	return updated, nil
}

func syncTemplateAgentSkills(ctx context.Context, qtx *db.Queries, agentID pgtype.UUID, skills []string, skillIDs map[string]pgtype.UUID, agentName string) error {
	if skills == nil {
		return nil
	}
	if err := qtx.RemoveAllAgentSkills(ctx, agentID); err != nil {
		return fmt.Errorf("failed to reset skills for agent %q: %w", agentName, err)
	}
	seen := map[string]struct{}{}
	for _, raw := range skills {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		id, ok := lookupTemplateSkillID(skillIDs, name)
		if !ok {
			return applyErrorf("skill %q required by agent %q was not found", name, agentName)
		}
		key := uuidToString(id)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		if err := qtx.AddAgentSkill(ctx, db.AddAgentSkillParams{AgentID: agentID, SkillID: id}); err != nil {
			return fmt.Errorf("failed to attach skill %q to agent %q: %w", name, agentName, err)
		}
	}
	return nil
}

func applyProcessTemplateSquads(ctx context.Context, qtx *db.Queries, workspaceID, actorID pgtype.UUID, squads []processtemplate.Squad, agentsByKey map[string][]db.Agent) error {
	existing, err := qtx.ListAllSquads(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("failed to list squads: %w", err)
	}
	for _, tmpl := range squads {
		leader, ok := firstAgentForKey(agentsByKey, tmpl.Leader)
		if !ok {
			return applyErrorf("squad %q is missing leader agent %q", firstNonEmptyName(tmpl.DisplayName, tmpl.Key), tmpl.Leader)
		}
		matches := findMatchingSquads(existing, tmpl)
		if len(matches) == 0 {
			created, err := qtx.CreateSquad(ctx, db.CreateSquadParams{
				WorkspaceID: workspaceID,
				Name:        firstNonEmptyName(tmpl.DisplayName, tmpl.Key),
				Description: tmpl.Description,
				LeaderID:    leader.ID,
				CreatorID:   actorID,
			})
			if err != nil {
				if isUniqueViolation(err) {
					existing, listErr := qtx.ListAllSquads(ctx, workspaceID)
					if listErr != nil {
						return listErr
					}
					matches = findMatchingSquads(existing, tmpl)
					if len(matches) == 0 {
						return fmt.Errorf("a squad named %q already exists in this workspace", firstNonEmptyName(tmpl.DisplayName, tmpl.Key))
					}
				} else {
					return fmt.Errorf("failed to create squad %q: %w", tmpl.Key, err)
				}
			} else {
				if _, err := qtx.UpdateSquad(ctx, db.UpdateSquadParams{
					ID:           created.ID,
					Instructions: pgtype.Text{String: tmpl.Instructions, Valid: true},
				}); err != nil {
					return fmt.Errorf("failed to set squad instructions for %q: %w", tmpl.Key, err)
				}
				if err := ensureSquadRoster(ctx, qtx, created.ID, leader, tmpl, agentsByKey); err != nil {
					return err
				}
				existing = append(existing, created)
				continue
			}
		}
		for _, match := range matches {
			squad := match
			if match.ArchivedAt.Valid {
				restored, err := qtx.RestoreSquad(ctx, match.ID)
				if err != nil {
					return fmt.Errorf("failed to restore squad %q: %w", match.Name, err)
				}
				squad = restored
			}
			if _, err := qtx.UpdateSquad(ctx, db.UpdateSquadParams{
				ID:           squad.ID,
				Name:         pgtype.Text{String: firstNonEmptyName(tmpl.DisplayName, tmpl.Key), Valid: true},
				Description:  pgtype.Text{String: tmpl.Description, Valid: true},
				LeaderID:     leader.ID,
				Instructions: pgtype.Text{String: tmpl.Instructions, Valid: true},
			}); err != nil {
				return fmt.Errorf("failed to update squad %q: %w", match.Name, err)
			}
			if err := ensureSquadRoster(ctx, qtx, squad.ID, leader, tmpl, agentsByKey); err != nil {
				return err
			}
		}
	}
	return nil
}

func ensureSquadRoster(ctx context.Context, qtx *db.Queries, squadID pgtype.UUID, leader db.Agent, tmpl processtemplate.Squad, agentsByKey map[string][]db.Agent) error {
	members, err := qtx.ListSquadMembers(ctx, squadID)
	if err != nil {
		return fmt.Errorf("failed to list members for squad %q: %w", tmpl.Key, err)
	}
	present := map[string]struct{}{}
	for _, member := range members {
		present[member.MemberType+":"+uuidToString(member.MemberID)] = struct{}{}
	}
	add := func(agent db.Agent, role string) error {
		key := "agent:" + uuidToString(agent.ID)
		if _, ok := present[key]; ok {
			return nil
		}
		if _, err := qtx.AddSquadMember(ctx, db.AddSquadMemberParams{
			SquadID:    squadID,
			MemberType: "agent",
			MemberID:   agent.ID,
			Role:       role,
		}); err != nil && !isUniqueViolation(err) {
			return fmt.Errorf("failed to add member to squad %q: %w", tmpl.Key, err)
		}
		present[key] = struct{}{}
		return nil
	}
	if err := add(leader, "leader"); err != nil {
		return err
	}
	for _, key := range tmpl.Members {
		if strings.TrimSpace(key) == "" || namesEqual(key, tmpl.Leader) {
			continue
		}
		agent, ok := firstAgentForKey(agentsByKey, key)
		if !ok {
			continue
		}
		if err := add(agent, "member"); err != nil {
			return err
		}
	}
	return nil
}

func firstOnlineRuntime(ctx context.Context, qtx *db.Queries, workspaceID, ownerID pgtype.UUID) (db.AgentRuntime, error) {
	runtimes, err := qtx.ListVisibleAgentRuntimes(ctx, db.ListVisibleAgentRuntimesParams{
		WorkspaceID: workspaceID,
		OwnerID:     ownerID,
	})
	if err != nil {
		return db.AgentRuntime{}, fmt.Errorf("failed to list agent runtimes: %w", err)
	}
	for _, runtime := range runtimes {
		if strings.EqualFold(runtime.Status, "online") {
			return runtime, nil
		}
	}
	return db.AgentRuntime{}, applyErrorf("no online agent runtime is available in this workspace")
}

func findMatchingAgents(agents []db.Agent, tmpl processtemplate.Agent) []db.Agent {
	var matches []db.Agent
	for _, agent := range agents {
		if processtemplate.MatchesIdentity(agent.Name, tmpl.DisplayName, tmpl.Key) {
			matches = append(matches, agent)
		}
	}
	return matches
}

func findMatchingSquads(squads []db.Squad, tmpl processtemplate.Squad) []db.Squad {
	var matches []db.Squad
	for _, squad := range squads {
		if processtemplate.MatchesIdentity(squad.Name, tmpl.DisplayName, tmpl.Key) {
			matches = append(matches, squad)
		}
	}
	return matches
}

func firstAgentForKey(agentsByKey map[string][]db.Agent, key string) (db.Agent, bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		return db.Agent{}, false
	}
	for tmplKey, agents := range agentsByKey {
		if !processtemplate.MatchesIdentity(tmplKey, key) {
			continue
		}
		for _, agent := range agents {
			if !agent.ArchivedAt.Valid {
				return agent, true
			}
		}
		if len(agents) > 0 {
			return agents[0], true
		}
	}
	return db.Agent{}, false
}

func lookupTemplateSkillID(skillIDs map[string]pgtype.UUID, name string) (pgtype.UUID, bool) {
	for _, candidate := range processtemplate.SkillNameCandidates(processtemplate.ExpandSkillName(name)) {
		if id, ok := skillIDs[strings.ToLower(strings.TrimSpace(candidate))]; ok {
			return id, true
		}
	}
	for _, candidate := range processtemplate.SkillNameCandidates(name) {
		if id, ok := skillIDs[strings.ToLower(strings.TrimSpace(candidate))]; ok {
			return id, true
		}
	}
	return pgtype.UUID{}, false
}

func namesEqual(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

func firstNonEmptyName(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func uuidEqual(a, b pgtype.UUID) bool {
	return a.Valid && b.Valid && a.Bytes == b.Bytes
}

type applyClientError struct{ msg string }

func (e applyClientError) Error() string { return e.msg }

func applyErrorf(format string, args ...any) error {
	return applyClientError{msg: fmt.Sprintf(format, args...)}
}

func isApplyClientError(err error) bool {
	var client applyClientError
	return errors.As(err, &client)
}
