/**
 * Issue detail screen.
 *
 * Read-mostly timeline with an inline comment composer pinned to the
 * bottom (`<InlineCommentComposer>`). The composer is a single
 * `<TextInput>` + mention suggestion bar — no modal route, no toolbar,
 * no draft persistence. Sticks to the keyboard via `KeyboardStickyView`.
 *
 * Header note: the parent _layout.tsx already declares the `issue/[id]`
 * Stack.Screen with title "Issue". We override that here once the data
 * lands so the navigation bar shows `MUL-123` (Linear-style).
 */
import { useCallback, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams, useTheme } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import type { Issue } from "@multica/core/types";
import type { TFunction } from "i18next";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TimelineList } from "@/components/issue/timeline-list";
import { AgentHeaderBadge } from "@/components/issue/agent-header-badge";
import { InlineCommentComposer } from "@/components/issue/inline-comment-composer";
import {
  issueDetailOptions,
  issueKeys,
  issueTimelineOptions,
} from "@/data/queries/issues";
import { ApiError } from "@/data/api";
import { useDeleteIssue } from "@/data/mutations/issues";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { useAuthStore } from "@/data/auth-store";
import { useIssueRealtime } from "@/data/realtime/use-issue-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useViewedIssuesStore } from "@/data/viewed-issues-store";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { useT } from "@/lib/i18n";

export default function IssueDetail() {
  // `highlight` + `h` come from inbox deep-link (apps/mobile/app/(app)/
  // [workspace]/(tabs)/inbox.tsx). `highlight` is the target comment id;
  // `h` is a per-tap nonce so re-tapping the same row re-fires the
  // scroll-and-flash effect.
  const { id, workspace: wsSlug, highlight, h } = useLocalSearchParams<{
    id: string;
    workspace: string;
    highlight?: string;
    h?: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();

  const detail = useQuery(issueDetailOptions(wsId, id));
  const timeline = useQuery(issueTimelineOptions(wsId, id));

  // Subscribe to per-issue WS events: status/priority/assignee/label
  // changes, comments, activity, reactions, agent task progress.
  // Mounted with `id` — cleans up automatically on navigate-away.
  // If another client deletes the issue we're viewing, pop back so the
  // user isn't stranded on a 404 detail page.
  useIssueRealtime(id, () => router.back());

  // Track viewed issues so the chat composer's `@` suggestion bar can
  // surface "Recent" — the user just looked at MUL-123, likely wants to
  // ask the agent about it next. Workspace-scoped + in-memory; see
  // data/viewed-issues-store.ts.
  useEffect(() => {
    if (wsId && id) {
      useViewedIssuesStore.getState().push(wsId, id);
    }
  }, [wsId, id]);

  // Screen-scoped composer state — clear on unmount so re-entering the
  // issue starts from a clean slate (no stale text-selection comment id,
  // no stale "Replying to X" target). Both stores are singletons used by
  // the long-press action sheet.
  useEffect(() => {
    return () => {
      useCommentSelectStore.getState().clear();
      useReplyTargetStore.getState().clear();
    };
  }, []);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      detail.refetch(),
      qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, id) }),
    ]);
  }, [detail, qc, wsId, id]);

  const issue = detail.data;
  const deleteIssue = useDeleteIssue();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const isPinned =
    !!issue &&
    !!pins?.some((p) => p.item_type === "issue" && p.item_id === issue.id);
  const createPin = useCreatePin();
  const deletePin = useDeletePin();
  const { t } = useT("issues");

  const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
  const issueLink =
    issue && wsSlug && webUrl
      ? `${webUrl}/${wsSlug}/issue/${issue.identifier}`
      : null;

  const onSelectAction = useCallback(
    (action: IssueAction) => {
      if (!issue || !wsSlug) return;
      switch (action) {
        case "pin":
          createPin.mutate({ item_type: "issue", item_id: issue.id });
          break;
        case "unpin":
          deletePin.mutate({ itemType: "issue", itemId: issue.id });
          break;
        case "edit":
          router.push(`/${wsSlug}/issue/${issue.id}/edit`);
          break;
        case "copy-link":
          if (issueLink) Clipboard.setStringAsync(issueLink);
          break;
        case "open-web":
          if (issueLink) Linking.openURL(issueLink);
          break;
        case "delete":
          confirmDelete(t, issue, () =>
            deleteIssue.mutate(issue.id, {
              onSuccess: () => router.back(),
              onError: (error) => Alert.alert(
                t("delete.failed_title"),
                error instanceof ApiError && error.status === 403
                  ? t("delete.permission_denied")
                  : t("delete.failed"),
              ),
            }),
          );
          break;
      }
    },
    [issue, wsSlug, createPin, deletePin, issueLink, deleteIssue, t],
  );

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: issue?.identifier ?? t("navigation:routes.issue"),
          headerBackTitle: t("common:actions.back"),
          headerRight: issue
            ? () => (
                <View className="flex-row items-center gap-2">
                  {/* Ambient agent-working badge — renders null when no
                   *  active tasks, so it doesn't crowd the header in the
                   *  common case. See agent-header-badge.tsx. */}
                  <AgentHeaderBadge issueId={id} />
                  <IssueActionsMenu
                    isPinned={isPinned}
                    hasLink={!!issueLink}
                    onSelect={onSelectAction}
                  />
                </View>
              )
            : undefined,
        }}
      />
      {detail.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : detail.error || !issue ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            {t("errors.load_failed", {
              message:
                detail.error instanceof Error
                  ? detail.error.message
                  : "not found",
            })}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>{t("common:actions.retry")}</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-1">
          <TimelineList
            issue={issue}
            entries={timeline.data}
            timelineLoading={timeline.isLoading}
            refreshing={detail.isRefetching || timeline.isRefetching}
            onRefresh={onRefresh}
            highlightCommentId={highlight}
            highlightNonce={h}
          />
          <InlineCommentComposer issueId={id} />
        </View>
      )}
    </View>
  );
}

type IssueAction =
  | "pin"
  | "unpin"
  | "edit"
  | "copy-link"
  | "open-web"
  | "delete";

function IssueActionsMenu({
  isPinned,
  hasLink,
  onSelect,
}: {
  isPinned: boolean;
  hasLink: boolean;
  onSelect: (action: IssueAction) => void;
}) {
  const { colors } = useTheme();
  const { t } = useT("issues");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="size-10 items-center justify-center rounded-md active:bg-accent"
        accessibilityLabel={t("menu.issue_actions")}
      >
        <Ionicons
          name="ellipsis-horizontal"
          size={20}
          color={colors.text}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onPress={() => onSelect(isPinned ? "unpin" : "pin")}
        >
          <Text>{t(isPinned ? "menu.unpin" : "menu.pin")}</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onPress={() => onSelect("edit")}>
          <Text>{t("menu.edit_details")}</Text>
        </DropdownMenuItem>
        {hasLink ? (
          <>
            <DropdownMenuItem onPress={() => onSelect("copy-link")}>
              <Text>{t("menu.copy_link")}</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => onSelect("open-web")}>
              <Text>{t("menu.open_web")}</Text>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onPress={() => onSelect("delete")}
        >
          <Text>{t("menu.delete_issue")}</Text>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function confirmDelete(t: TFunction<"issues">, issue: Issue, onConfirm: () => void) {
  Alert.alert(
    t("delete.title"),
    t("delete.message", { identifier: issue.identifier }),
    [
      { text: t("common:actions.cancel"), style: "cancel" },
      { text: t("common:actions.delete"), style: "destructive", onPress: onConfirm },
    ],
  );
}
