package scheduler

import (
	"context"
	"time"
)

type VCSDeliveryDispatcher interface {
	TickVCSDeliveries(context.Context) error
}

func VCSDeliveryJob(dispatcher VCSDeliveryDispatcher) JobSpec {
	return JobSpec{
		Name: "vcs_delivery_poll", Cadence: 30 * time.Second,
		CatchUpMode: CatchUpLatestOnly, CatchUpWindow: time.Hour,
		RunTimeout: 90 * time.Second, StaleTimeout: 2 * time.Minute,
		HeartbeatInterval: 10 * time.Second, MaxAttempts: 1, Scopes: StaticScopes(ScopeGlobal),
		Handler: func(ctx context.Context, _ HandlerInput) (HandlerResult, error) {
			return HandlerResult{}, dispatcher.TickVCSDeliveries(ctx)
		},
	}
}
