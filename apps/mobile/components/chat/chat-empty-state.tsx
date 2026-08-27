/**
 * Empty-state surface shown when the active session has no messages.
 *
 * Two modes mirror web (packages/views/chat/components/chat-window.tsx
 * `EmptyState`):
 *
 *   - first-time (the workspace has never started a chat) → educate. Tell
 *     the user what chat is for; don't surface starter prompts yet, they
 *     presume context the user doesn't have.
 *   - returning (at least one prior session exists) → starter prompts.
 *     Three taps, three common workflows; tapping prefills the composer
 *     draft so the user can edit before sending.
 *
 * Copy mirrors the web `chat.json` namespace 1:1. Mobile doesn't have
 * i18n yet so the strings are inlined in English — when mobile adopts
 * i18n the lookup keys (`empty_state.first_time_title` etc.) are already
 * established on the web side, so the migration is a literal
 * key-by-key swap.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

const STARTER_PROMPTS: { icon: string; text: string }[] = [
  { icon: "📋", text: "按优先级列出我的未完成任务" },
  { icon: "📝", text: "总结我今天完成的工作" },
  { icon: "💡", text: "帮我规划下一步工作" },
];

interface Props {
  hasSessions: boolean;
  agentName?: string;
  onPickPrompt: (text: string) => void;
}

export function ChatEmptyState({ hasSessions, agentName, onPickPrompt }: Props) {
  // First-time experience: educate before suggesting actions. Starter
  // prompts here would presume the user already knows what chat is for.
  if (!hasSessions) {
    return (
      <View className="flex-1 items-center justify-center px-6 py-8">
        <View className="max-w-xs items-center gap-3">
          <Text className="text-base font-semibold text-foreground text-center">
            与智能体聊天
          </Text>
          <Text className="text-sm text-muted-foreground text-center">
            <Text className="text-sm text-muted-foreground">
              ✨ 智能体了解工作区中的{" "}
            </Text>
            <Text className="text-sm font-medium text-foreground">
              任务、项目和技能
            </Text>
            <Text className="text-sm text-muted-foreground">.</Text>
          </Text>
          <Text className="text-sm text-muted-foreground text-center">
            你可以让智能体总结工作、规划日程或处理一项小任务。
          </Text>
        </View>
      </View>
    );
  }

  // Returning user: starter prompts are the fastest path back to action.
  const title = agentName ? `你好，我是 ${agentName}` : "欢迎回到鸿翼灵工";
  return (
    <View className="flex-1 items-center justify-center px-6 py-8 gap-5">
      <View className="items-center gap-1">
        <Text className="text-base font-semibold text-foreground text-center">
          {title}
        </Text>
        <Text className="text-sm text-muted-foreground text-center">
          试着问问
        </Text>
      </View>
      <View className="w-full max-w-xs gap-2">
        {STARTER_PROMPTS.map((p) => (
          <Button
            key={p.text}
            variant="outline"
            onPress={() => onPickPrompt(p.text)}
            className="h-auto justify-start px-3 py-2.5"
            accessibilityLabel={p.text}
          >
            <Text className="text-sm text-foreground">
              <Text className="text-sm">{p.icon}  </Text>
              {p.text}
            </Text>
          </Button>
        ))}
      </View>
    </View>
  );
}
