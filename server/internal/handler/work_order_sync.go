package handler

import (
	"context"
	"encoding/base64"
	"net/http"
	"time"

	"github.com/multica-ai/multica/server/internal/workorder"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func (h *Handler) SyncWorkOrders(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.workOrderScope(w, r)
	if !ok || !workOrderManager(w, scope) {
		return
	}
	var req struct {
		Page int `json:"page"`
	}
	if !decodeWorkOrderBody(w, r, &req) {
		return
	}
	if req.Page == 0 {
		req.Page = 1
	}
	if req.Page < 1 || req.Page > 100000 {
		writeError(w, http.StatusBadRequest, "invalid MIS page")
		return
	}
	settings, err := h.Queries.GetWorkOrderWorkspace(r.Context(), scope.workspace)
	if err != nil || settings.MisUrl == "" || settings.MisCredentials == "" || h.SystemSettingsSecretBox == nil {
		writeError(w, http.StatusConflict, "configure MIS URL and encrypted credentials first")
		return
	}
	sealed, err := base64.StdEncoding.DecodeString(settings.MisCredentials)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to decrypt MIS credentials")
		return
	}
	raw, err := h.SystemSettingsSecretBox.Open(sealed)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to decrypt MIS credentials")
		return
	}
	credentials, err := workorder.ParseMISCredentials(raw)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	orders, total, err := workorder.FetchMISPage(ctx, settings.MisUrl, credentials, req.Page)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sync work orders")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	for _, order := range orders {
		row, saveErr := q.ImportWorkOrder(ctx, db.ImportWorkOrderParams{
			WorkspaceID: scope.workspace, Source: "mis", ExternalID: order.ID, Title: order.Title,
			Description: order.Description, SourceStatus: order.Status, SourceProduct: order.Product,
			SourceVersion: order.Version, SourceProject: order.Project, SourceBranch: order.Branch,
			CreatedBy: scope.actor,
		})
		if saveErr == nil {
			saveErr = q.AddWorkOrderEvent(ctx, db.AddWorkOrderEventParams{
				WorkOrderID: row.ID, WorkspaceID: scope.workspace, ActorID: scope.actor,
				Action: "sync", Detail: []byte("{}"),
			})
		}
		if saveErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to sync work orders")
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to sync work orders")
		return
	}
	next := 0
	if req.Page*100 < total && len(orders) > 0 {
		next = req.Page + 1
	}
	writeJSON(w, http.StatusOK, map[string]int{"synced": len(orders), "total": total, "next_page": next})
}
