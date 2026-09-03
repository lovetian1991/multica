/**
 * Empty-state surface shown when the active session has no messages.
 *
 * A configured agent supplies its own conversation starters. Agents without
 * configured starters use the built-in defaults. Selecting a starter only
 * prefills the composer so the user can edit it before sending.
 */
import { View } from "react-native";
import type { Agent, AgentConversationStarter } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

const FALLBACK_CONVERSATION_STARTERS: AgentConversationStarter[] = [
  {
    label: "我能帮你做什么？",
    prompt: "你最擅长帮助我完成什么？请简要介绍。",
  },
  {
    label: "建议一个待办事项",
    prompt: "请建议三个我可以交给你的实用任务。",
  },
  {
    label: "推荐下一步行动",
    prompt: "根据你对我工作区的了解，推荐一个有用的下一步行动。",
  },
];

interface Props {
  hasSessions: boolean;
  agent: Agent | null;
  onPickPrompt: (text: string) => void;
}

export function ChatEmptyState({ hasSessions, agent, onPickPrompt }: Props) {
  const title = agent ? `你好，我是 ${agent.name}` : "与智能体聊天";
  const configured = (agent?.conversation_starters ?? []).filter(
    (item) => item.label.trim() && item.prompt.trim(),
  );
  const starters =
    configured.length > 0
      ? configured
      : FALLBACK_CONVERSATION_STARTERS;

  return (
    <View className="flex-1 items-center justify-center px-6 py-8 gap-5">
      <View className="items-center gap-1">
        <Text className="text-base font-semibold text-foreground text-center">
          {title}
        </Text>
        {agent?.description ? (
          <Text className="text-sm text-muted-foreground text-center">
            {agent.description}
          </Text>
        ) : null}
        {!agent && !hasSessions ? (
          <>
            <Text className="text-sm text-muted-foreground text-center">
              <Text className="text-sm text-muted-foreground">
                ✨ 智能体了解工作区中的{" "}
              </Text>
              <Text className="text-sm font-medium text-foreground">
                任务、项目和技能
              </Text>
              <Text className="text-sm text-muted-foreground">。</Text>
            </Text>
            <Text className="text-sm text-muted-foreground text-center">
              你可以让智能体总结工作、规划日程或处理一项小任务。
            </Text>
          </>
        ) : null}
        {!hasSessions && agent ? (
          <Text className="text-sm text-muted-foreground text-center">
            选择一个示例开始，然后可以在发送前编辑内容。
          </Text>
        ) : null}
        {hasSessions && agent ? (
          <Text className="text-sm text-muted-foreground text-center">
            试着问问
          </Text>
        ) : null}
      </View>
      {agent ? (
        <View className="w-full max-w-xs gap-2">
          {starters.map((item, index) => (
            <Button
              key={`${item.label}-${index}`}
              variant="outline"
              onPress={() => onPickPrompt(item.prompt)}
              className="h-auto justify-start px-3 py-2.5"
              accessibilityLabel={item.label}
            >
              <Text className="text-sm text-foreground">{item.label}</Text>
            </Button>
          ))}
        </View>
      ) : null}
    </View>
  );
}
