package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (h *Handler) workOrderMISCredentials(ctx context.Context, scope workOrderScope) (string, workorder.MISCredentials, error) {
	settings, err := h.Queries.GetWorkOrderWorkspace(ctx, scope.workspace)
	if err != nil || settings.MisUrl == "" || settings.MisCredentials == "" || h.SystemSettingsSecretBox == nil {
		return "", workorder.MISCredentials{}, errors.New("请先在工单设置中配置 MIS 地址和凭据")
	}
	sealed, err := base64.StdEncoding.DecodeString(settings.MisCredentials)
	if err != nil {
		return "", workorder.MISCredentials{}, errors.New("无法解密 MIS 凭据，请重新配置")
	}
	raw, err := h.SystemSettingsSecretBox.Open(sealed)
	if err != nil {
		return "", workorder.MISCredentials{}, errors.New("无法解密 MIS 凭据，请重新配置")
	}
	credentials, err := workorder.ParseMISCredentials(raw)
	return settings.MisUrl, credentials, err
}

type externalWorkOrderResponse struct {
	workorder.MISOrder
	LocalID string `json:"local_id"`
	IssueID string `json:"issue_id"`
}

func (h *Handler) externalWorkOrderQuery(w http.ResponseWriter, r *http.Request, scope workOrderScope) ([]workorder.MISOrder, int, bool) {
	mine := r.URL.Query().Get("scope") != "all"
	if !mine && !workOrderManager(w, scope) {
		return nil, 0, false
	}
	page := 1
	if raw := r.URL.Query().Get("page"); raw != "" {
		var err error
		page, err = strconv.Atoi(raw)
		if err != nil || page < 1 || page > 100000 {
			writeError(w, http.StatusBadRequest, "invalid page")
			return nil, 0, false
		}
	}
	base, credentials, err := h.workOrderMISCredentials(r.Context(), scope)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return nil, 0, false
	}
	if mine && credentials.TaskUser == "" {
		writeError(w, http.StatusConflict, "请先在工单设置中配置 MIS 待办用户 ID")
		return nil, 0, false
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if len(search) > 256 {
		writeError(w, http.StatusBadRequest, "search is too long")
		return nil, 0, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	rows, total, err := workorder.QueryMIS(ctx, base, credentials, workorder.MISQuery{
		Mine: mine, Page: page, Size: workOrderPageSize, Search: search, ID: chi.URLParam(r, "externalId"),
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return nil, 0, false
	}
	if id := chi.URLParam(r, "externalId"); id != "" && (len(rows) != 1 || rows[0].ID != id || total != 1) {
		writeError(w, http.StatusNotFound, "工单不存在、已不在当前待办中或没有访问权限")
		return nil, 0, false
	}
	if len(rows) == 1 && chi.URLParam(r, "externalId") != "" {
		workspace, err := h.Queries.GetWorkspace(ctx, scope.workspace)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to load workspace OC settings")
			return nil, 0, false
		}
		ocURL, token, err := h.workspaceOCSession(ctx, workspace)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return nil, 0, false
		}
		headers := http.Header{}
		for key, value := range credentials.Headers {
			headers.Set(key, value)
		}
		detail, err := h.OpenContent.GetWorkOrderDetail(ctx, ocURL, token, headers.Get("appid"), headers.Get("siteoutid"), rows[0].ID)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return nil, 0, false
		}
		workorder.MergeOCDetail(&rows[0], detail)
	}
	w.Header().Set("Cache-Control", "no-store")
	return rows, total, true
}

func (h *Handler) ListExternalWorkOrders(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	rows, total, ok := h.externalWorkOrderQuery(w, r, scope)
	if !ok {
		return
	}
	out := make([]externalWorkOrderResponse, 0, len(rows))
	for _, row := range rows {
		if chi.URLParam(r, "externalId") == "" {
			row = row.Summary()
		}
		item := externalWorkOrderResponse{MISOrder: row}
		local, err := h.Queries.GetWorkOrderBySource(r.Context(), db.GetWorkOrderBySourceParams{
			WorkspaceID: scope.workspace, Source: "mis", ExternalID: row.ID,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "failed to load linked task")
			return
		}
		if err == nil && (scope.manager || local.AssigneeID == scope.actor) {
			item.LocalID, item.IssueID = uuidToString(local.ID), uuidToString(local.IssueID)
		}
		out = append(out, item)
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"orders": out, "total": total, "can_manage": scope.manager,
		"page": page, "page_size": workOrderPageSize,
	})
}

func (h *Handler) ImportExternalWorkOrder(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok {
		return
	}
	rows, _, ok := h.externalWorkOrderQuery(w, r, scope)
	if !ok {
		return
	}
	if len(rows) != 1 {
		writeError(w, http.StatusBadRequest, "a work order id is required")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to import work order")
		return
	}
	defer tx.Rollback(r.Context())
	q := h.Queries.WithTx(tx)
	source := rows[0]
	row, err := q.ImportWorkOrder(r.Context(), db.ImportWorkOrderParams{
		WorkspaceID: scope.workspace, Source: "mis", ExternalID: source.ID,
		Title: source.Title, Description: source.Description, SourceStatus: source.Status,
		SourceProduct: source.Product, SourceVersion: source.Version, SourceProject: source.Project,
		SourceBranch: source.Branch, AssigneeID: scope.actor, CreatedBy: scope.actor,
	})
	if err == nil && !scope.manager && row.AssigneeID != scope.actor {
		writeError(w, http.StatusConflict, "该工单已由当前工作区其他成员处理")
		return
	}
	if err == nil {
		detail, _ := json.Marshal(map[string]string{"number": source.Number})
		err = q.AddWorkOrderEvent(r.Context(), db.AddWorkOrderEventParams{
			WorkOrderID: row.ID, WorkspaceID: scope.workspace, ActorID: scope.actor,
			Action: "import", Detail: detail,
		})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to import work order")
		return
	}
	writeJSON(w, http.StatusOK, workOrderToResponse(row))
}
