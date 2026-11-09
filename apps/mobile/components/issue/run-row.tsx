/**
 * Single row inside the agent-runs formSheet route
 * (`app/(app)/[workspace]/issue/[id]/runs.tsx`). Same component for active
 * and past tasks —
 * the trailing Cancel button is available for every cancellable status,
 * and the status badge / colour swaps based on the AgentTask.status enum.
 *
 * Terminal runs open their persisted execution record. Active rows keep the
 * cancel affordance and are not links: this route is for historical records.
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "nativewind";
import { router } from "expo-router";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RunCancelButton } from "./run-cancel-button";
import { useActorLookup } from "@/data/use-actor-name";
import { runFailureBadgeLabel } from "@/lib/run-failure-badge";
import { timeAgo } from "@/lib/time-ago";
import { useT } from "@/lib/i18n";
import { isCancellableRunStatus, runTranscriptRoute } from "@/lib/run-transcript";
import { useWorkspaceStore } from "@/data/workspace-store";
import { THEME } from "@/lib/theme";

interface Props {
  task: AgentTask;
  issueId: string;
}

const TERMINAL_STATUSES: readonly AgentTask["status"][] = [
  "completed",
  "failed",
  "cancelled",
];

export function RunRow({ task, issueId }: Props) {
  const { getName } = useActorLookup();
  const { t } = useT("issues");
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === "dark" ? "dark" : "light"];
  const workspace = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const isActive = isCancellableRunStatus(task.status);
  const isTerminal = TERMINAL_STATUSES.includes(task.status);
  const summary =
    task.trigger_summary?.trim() || fallbackSummary(task, t);
  // Past tasks use completed_at when present (server fills it for terminal
  // statuses); active tasks fall back to created_at so the user sees how
  // long it's been waiting.
  const timestamp = task.completed_at || task.created_at;

  const content = (
    <>
      <ActorAvatar type="agent" id={task.agent_id} size={28} showPresence />
      <View className="flex-1 gap-1">
        <Text
          className="text-sm text-foreground"
          numberOfLines={2}
        >
          <Text className="font-medium">{getName("agent", task.agent_id)}</Text>
          <Text className="text-muted-foreground"> · {summary}</Text>
        </Text>
        <View className="flex-row items-center gap-2">
          <StatusBadge task={task} />
          <Text className="text-xs text-muted-foreground">
            {timestamp ? timeAgo(timestamp) : ""}
          </Text>
        </View>
      </View>
      {isActive ? <RunCancelButton taskId={task.id} issueId={issueId} /> : null}
      {isTerminal ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={theme.mutedForeground}
        />
      ) : null}
    </>
  );

  if (!isTerminal || !workspace) {
    return <View className="flex-row items-start gap-3 py-2">{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("runs.open_transcript", { summary })}
      onPress={() => router.push(runTranscriptRoute(workspace, issueId, task.id))}
      className="flex-row items-start gap-3 py-2 active:opacity-60"
    >
      {content}
    </Pressable>
  );
}

function StatusBadge({ task }: { task: AgentTask }) {
  const { t } = useT("issues");
  const label = t(`runs.status.${task.status}`);
  const cls = STATUS_CLASS[task.status] ?? "text-muted-foreground";
  // For failed tasks, surface the failure_reason inline so users don't have
  // to drill in. Missing / empty / unrecognised stays as just "Failed".
  if (task.status === "failed") {
    const reasonLabel = runFailureBadgeLabel(task.failure_reason);
    if (reasonLabel) {
      return (
        <Text className={`text-xs ${cls}`}>
          {label} · {reasonLabel}
        </Text>
      );
    }
  }
  return <Text className={`text-xs ${cls}`}>{label}</Text>;
}

function fallbackSummary(
  task: AgentTask,
  t: (key: string) => string,
): string {
  switch (task.kind) {
    case "comment":
      return t("summary.comment");
    case "autopilot":
      return t("summary.autopilot");
    case "chat":
      return t("summary.chat");
    case "quick_create":
      return t("summary.quick_create");
    case "direct":
    default:
      return t("summary.direct");
  }
}

const STATUS_CLASS: Record<AgentTask["status"], string> = {
  queued: "text-muted-foreground",
  deferred: "text-muted-foreground",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};
// Short badge copy — deliberately terser than lib/failure-reason-label.ts,
// which backs a full-width chat bubble; this one shares a single line with the
// status word and a timestamp.
//
// Keyed by the raw wire value, not a closed enum: `failure_reason` is an open
// string that grows as classifier rules land. It held only the six
// pre-MUL-1949 coarse values until MUL-5370, so every refined `agent_error.*`
// the backend has written since fell through and the badge read just "Failed".
// An unrecognised reason still does — a compact badge is the one place where
// web's raw-wire-value fallback would overflow the row.
const FAILURE_REASON_LABEL: Record<string, string> = {
  queued_expired: "排队超时",
  runtime_offline: "运行时离线",
  runtime_recovery: "运行时恢复中",
  timeout: "执行超时",
  iteration_limit: "达到迭代上限",
  agent_blocked: "需要输入",
  api_invalid_request: "请求被拒绝",
  skill_bundle_unavailable: "技能下载失败",
  runtime_cli_timeout: "运行时命令超时",

  "agent_error.provider_auth_or_access": "认证失败",
  "agent_error.provider_quota_limit": "额度已用尽",
  "agent_error.provider_capacity_or_rate_limit": "请求受限",
  "agent_error.provider_server_error": "服务提供方错误",
  "agent_error.provider_network": "网络错误",
  "agent_error.process_failure": "进程崩溃",
  "agent_error.empty_or_unparseable_output": "没有可用输出",
  "agent_error.agent_timeout": "智能体超时",
  "agent_error.context_overflow": "上下文超限",
  "agent_error.missing_config": "缺少配置",
  "agent_error.model_not_found_or_unavailable": "模型不可用",
  "agent_error.runtime_version_unsupported": "命令行版本不受支持",
  "agent_error.runtime_missing_executable": "命令行工具未安装",
  "agent_error.unknown": "智能体错误",

  agent_error: "智能体错误",
  codex_semantic_inactivity: "Codex 长时间无响应",
  manual: "手动取消",
};
