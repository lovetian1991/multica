/**
 * Activity-row text formatter. Subset of the web `formatActivity` in
 * packages/views/issues/components/issue-detail.tsx:95 — same actions,
 * Simplified Chinese copy matching the mobile UI. Mirror the structure when
 * mobile adopts shared i18n.
 *
 * Unknown actions fall through to the raw string in `entry.action`. NEVER
 * throw and NEVER drop the row — that's the API Response Compatibility rule
 * from repo-root CLAUDE.md (server may add new action enum values; older
 * mobile clients in the wild must render them as a generic fallback, not
 * crash).
 */
import type { IssuePriority, TimelineEntry } from "@multica/core/types";
import { formatDateOnly } from "@multica/core/issues/date";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  isIssueStatusCategory,
} from "@/lib/issue-status";

/**
 * Names a status KEY out of a timeline entry. `resolveLabel` comes from the
 * workspace catalog and is what names a CUSTOM status; without it (or for a key
 * the catalog never heard of) a built-in still gets its own copy and anything
 * else falls back to the raw key rather than rendering blank. Mirrors web's
 * `statusLabel` in packages/views/issues/components/issue-detail.tsx.
 * (MUL-6243)
 */
function statusName(
  s: string | undefined,
  resolveLabel?: (statusKey: string) => string,
): string {
  if (!s) return "?";
  if (resolveLabel) return resolveLabel(s);
  return isIssueStatusCategory(s) ? STATUS_LABEL[s] : s;
}

function priorityName(p: string | undefined): string {
  if (p && p in PRIORITY_LABEL) return PRIORITY_LABEL[p as IssuePriority];
  return p ?? "?";
}

// start_date / due_date are calendar days — format timezone-safely (no offset
// day shift). Mirrors web's formatActivity in issue-detail.tsx.
function shortDate(date: string | undefined): string {
  if (!date) return "?";
  return formatDateOnly(
    date,
    { month: "numeric", day: "numeric" },
    "zh-CN",
  );
}

export function formatActivity(
  entry: TimelineEntry,
  resolveActorName: (
    type: string | null | undefined,
    id: string | null | undefined,
  ) => string,
  resolveStatusLabel?: (statusKey: string) => string,
): string {
  const details = (entry.details ?? {}) as Record<string, string>;
  switch (entry.action) {
    case "created":
      return "创建了任务";
    case "status_changed":
      return `将状态从 ${statusName(details.from, resolveStatusLabel)} 改为 ${statusName(details.to, resolveStatusLabel)}`;
    case "priority_changed":
      return `将优先级从 ${priorityName(details.from)} 改为 ${priorityName(details.to)}`;
    case "assignee_changed": {
      const isSelf =
        details.to_type === entry.actor_type &&
        details.to_id === entry.actor_id;
      if (isSelf) return "将任务分配给了自己";
      if (details.from_id && !details.to_id) return "移除了负责人";
      const toName =
        details.to_id && details.to_type
          ? resolveActorName(details.to_type, details.to_id)
          : null;
      if (toName) return `将任务分配给 ${toName}`;
      return "更改了负责人";
    }
    case "start_date_changed": {
      if (!details.to) return "移除了开始日期";
      return `将开始日期设为 ${shortDate(details.to)}`;
    }
    case "due_date_changed": {
      if (!details.to) return "移除了截止日期";
      return `将截止日期设为 ${shortDate(details.to)}`;
    }
    case "title_changed":
      return `将标题从“${details.from ?? "?"}”改为“${details.to ?? "?"}”`;
    case "description_updated":
      return "更新了描述";
    case "task_completed": {
      const n = entry.coalesced_count ?? 1;
      return n > 1 ? `完成了 ${n} 个任务` : "完成了一个任务";
    }
    case "task_failed": {
      const n = entry.coalesced_count ?? 1;
      return n > 1 ? `${n} 个任务执行失败` : "一个任务执行失败";
    }
    case "squad_leader_evaluated": {
      // Copy mirrors packages/views/locales/en/issues.json
      // (squad_leader_action / squad_leader_no_action / squad_leader_failed,
      // each with an optional `_reason` variant).
      const reason = details.reason?.trim();
      switch (details.outcome) {
        case "action":
          return reason
            ? `评估后执行了操作：${reason}`
            : "评估后执行了操作";
        case "no_action":
          return reason
            ? `评估完成，无需操作（${reason}）`
            : "评估完成，无需操作";
        case "failed":
          return reason
            ? `评估失败：${reason}`
            : "评估失败";
        default:
          return "评估了小队触发条件";
      }
    }
    default:
      return entry.action ?? "";
  }
}

