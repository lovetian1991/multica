import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { useAuthStore } from "@/data/auth-store";
import { mapAuthError } from "@/lib/auth-error";
import {
  getCurrentServerUrl,
  normalizeServerUrl,
} from "@/lib/server-url";

export default function Login() {
  const configureServer = useAuthStore((s) => s.configureServer);
  const sendCode = useAuthStore((s) => s.sendCode);
  const [serverUrl, setServerUrl] = useState(getCurrentServerUrl);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed || !serverUrl.trim()) return;

    let normalizedServerUrl: string;
    try {
      normalizedServerUrl = normalizeServerUrl(serverUrl);
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "请输入有效的服务器地址。",
      );
      return;
    }

    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    setServerError(null);
    try {
      await configureServer(normalizedServerUrl);
      setServerUrl(normalizedServerUrl);
      await sendCode(trimmed);
      router.push({ pathname: "/verify", params: { email: trimmed } });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, "验证码发送失败，请重试。"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 justify-center px-6 gap-6">
          <View className="items-center gap-3">
            <MulticaLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-2xl font-semibold text-foreground">
                登录鸿翼灵工
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                输入邮箱地址，我们会向你发送验证码。
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <View className="gap-1.5">
              <Text className="text-sm font-medium text-foreground">
                服务器地址
              </Text>
              <TextField
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://api.example.com"
                value={serverUrl}
                onChangeText={(value) => {
                  setServerUrl(value);
                  if (serverError) setServerError(null);
                }}
                editable={!submitting}
                invalid={!!serverError}
              />
              {serverError ? (
                <Text className="text-sm text-destructive">{serverError}</Text>
              ) : null}
            </View>

            <View className="gap-1.5">
              <Text className="text-sm font-medium text-foreground">
                邮箱
              </Text>
              <TextField
                autoCapitalize="none"
                autoComplete="email"
                autoFocus
                keyboardType="email-address"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={onSubmit}
                returnKeyType="send"
                editable={!submitting}
                invalid={!!error}
              />
            </View>
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : null}
          </View>

          <Button
            size="lg"
            disabled={submitting || !email.trim() || !serverUrl.trim()}
            onPress={onSubmit}
          >
            <Text>{submitting ? "正在发送..." : "发送验证码"}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
