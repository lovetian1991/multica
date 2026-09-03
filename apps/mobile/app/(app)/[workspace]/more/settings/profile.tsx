/**
 * Profile edit subscreen — name + avatar.
 *
 * Avatar tap opens the shared cross-platform DropdownMenu. It mirrors the
 * avatar upload flow in
 * packages/views/settings/components/account-tab.tsx but the picker uses
 * native camera and library APIs.
 *
 * Save runs PATCH /api/me then writes the returned user back to the auth
 * store via setUser — same source-of-truth pattern as web (server response
 * is authoritative, never the local form state).
 */
import { useEffect, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  ScrollView,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import type { FileAsset } from "@/data/api";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB — matches what's reasonable on cellular.

function initialsOf(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function ProfileSettingsScreen() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Resync if `user` updates from outside (avatar upload, refetch, login as
  // different user). Without this the form would render stale init forever.
  useEffect(() => {
    setName(user?.name ?? "");
  }, [user]);

  const dirty = name.trim() !== (user?.name ?? "") && name.trim().length > 0;

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("需要相机权限", "请允许访问相机后再拍照。");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadAvatar(result.assets[0]);
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) await uploadAvatar(result.assets[0]);
  };

  const uploadAvatar = async (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
      Alert.alert("图片过大", "请选择小于 5 MB 的图片。");
      return;
    }
    const fileAsset: FileAsset = {
      uri: asset.uri,
      // expo-image-picker doesn't always supply a fileName (camera captures);
      // fabricate one from the URI so the multipart upload has a stable name.
      name: asset.fileName ?? `avatar-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    };

    setUploading(true);
    try {
      const attachment = await api.uploadFile(fileAsset);
      const updated = await api.updateMe({ avatar_url: attachment.url });
      setUser(updated);
    } catch (err) {
      Alert.alert(
        "头像上传失败",
        err instanceof Error ? err.message : "无法上传头像。",
      );
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    try {
      const updated = await api.updateMe({ avatar_url: "" });
      setUser(updated);
    } catch (err) {
      Alert.alert(
        "头像移除失败",
        err instanceof Error ? err.message : "无法移除头像。",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const updated = await api.updateMe({ name: name.trim() });
      setUser(updated);
    } catch (err) {
      Alert.alert(
        "保存失败",
        err instanceof Error ? err.message : "无法更新个人资料。",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-6 gap-6"
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={uploading}
            accessibilityLabel="更换头像"
          >
            <Avatar alt={user?.name ?? "用户头像"} className="size-24">
              {user?.avatar_url ? (
                <AvatarImage source={{ uri: user.avatar_url }} />
              ) : null}
              <AvatarFallback>
                <Text className="text-2xl font-semibold text-muted-foreground">
                  {initialsOf(user?.name)}
                </Text>
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-52">
            <DropdownMenuItem onPress={() => void pickFromCamera()}>
              <Text>拍照</Text>
            </DropdownMenuItem>
            <DropdownMenuItem onPress={() => void pickFromLibrary()}>
              <Text>从相册选择</Text>
            </DropdownMenuItem>
            {user?.avatar_url ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onPress={() => void removeAvatar()}
                >
                  <Text>移除头像</Text>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {uploading ? (
          <ActivityIndicator />
        ) : (
          <Text className="text-xs text-muted-foreground">
            点击更换头像
          </Text>
        )}
      </View>

      <Separator />

      <View className="gap-4">
        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">姓名</Text>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder="输入姓名"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>
        <View>
          <Text className="text-xs text-muted-foreground mb-1.5">邮箱</Text>
          <View className="rounded-md border border-border bg-muted px-3 py-2.5">
            <Text className="text-base text-muted-foreground">
              {user?.email ?? "—"}
            </Text>
          </View>
          <Text className="text-xs text-muted-foreground mt-1.5">
            邮箱在注册时设置，暂不支持在此修改。
          </Text>
        </View>
      </View>

      <Button onPress={handleSave} disabled={!dirty || saving}>
        <Text>{saving ? "保存中..." : "保存"}</Text>
      </Button>
    </ScrollView>
  );
}
