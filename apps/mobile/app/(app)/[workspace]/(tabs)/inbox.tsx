import { useMemo } from "react";
import {
  Alert,
  FlatList,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { InboxItem } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/ui/header";
import { HeaderActions } from "@/components/ui/app-header-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwipeableInboxRow } from "@/components/inbox/swipeable-inbox-row";
import { inboxListOptions } from "@/data/queries/inbox";
import {
  useArchiveAllInbox,
  useArchiveAllReadInbox,
  useArchiveCompletedInbox,
  useArchiveInbox,
  useMarkAllInboxRead,
  useMarkInboxRead,
} from "@/data/mutations/inbox";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { deduplicateInboxItems } from "@/lib/inbox-display";

export default function Inbox() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const { data: rawItems, isLoading, error, refetch, isRefetching } = useQuery(
    inboxListOptions(wsId),
  );
  // Dedup + drop archived to match web/desktop. See CLAUDE.md
  // "Behavioral parity" → inbox dedup incident.
  const data = useMemo(
    () => deduplicateInboxItems(rawItems ?? []),
    [rawItems],
  );
  const markRead = useMarkInboxRead();
  const markAllRead = useMarkAllInboxRead();
  const archive = useArchiveInbox();
  const archiveAll = useArchiveAllInbox();
  const archiveAllRead = useArchiveAllReadInbox();
  const archiveCompleted = useArchiveCompletedInbox();

  const onPressItem = (item: InboxItem) => {
    if (!item.read) {
      // Optimistic read flip lives in useMarkInboxRead.onMutate — fires
      // setQueryData synchronously before the cancelQueries await, so the
      // row is already styled "read" by the time iOS captures the source
      // snapshot for the native stack push transition.
      markRead.mutate(item.id);
    }
    if (item.issue_id && wsSlug) {
      router.push({
        pathname: "/[workspace]/issue/[id]",
        params: {
          workspace: wsSlug,
          id: item.issue_id,
          highlight: item.details?.comment_id,
          h: String(Date.now()),
        },
      });
    }
  };

  const confirmArchiveAll = () => {
    Alert.alert(
      "归档全部消息？",
      "这会归档收件箱中的全部消息，包括已读和未读消息。之后仍可在对应任务页面中找到它们。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "全部归档",
          style: "destructive",
          onPress: () => archiveAll.mutate(),
        },
      ],
    );
  };

  return (
    <View className="flex-1 bg-background">
      <Header
        title="收件箱"
        right={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="size-10 items-center justify-center rounded-md active:bg-accent"
                accessibilityLabel="收件箱操作"
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={20}
                  color={THEME[colorScheme].foreground}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onPress={() => markAllRead.mutate()}>
                  <Text>全部标为已读</Text>
                </DropdownMenuItem>
                <DropdownMenuItem onPress={() => archiveAllRead.mutate()}>
                  <Text>归档全部已读消息</Text>
                </DropdownMenuItem>
                <DropdownMenuItem onPress={() => archiveCompleted.mutate()}>
                  <Text>归档已完成任务</Text>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onPress={confirmArchiveAll}
                >
                  <Text>归档全部消息</Text>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <HeaderActions />
          </>
        }
      />
      {isLoading ? (
        <InboxLoading />
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            收件箱加载失败：{error instanceof Error ? error.message : "未知错误"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>重试</Text>
          </Button>
        </View>
      ) : !data || data.length === 0 ? (
        <InboxEmpty iconColor={THEME[colorScheme].mutedForeground} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-16" />
          )}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => (
            <SwipeableInboxRow
              item={item}
              onPress={() => onPressItem(item)}
              onArchive={() => archive.mutate(item.id)}
            />
          )}
          refreshing={isRefetching}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}

// Loading state — 6 row-shaped Skeletons matching InboxRow's layout
// (avatar circle + two text lines). Perceived perf wins over a centered
// spinner because the eye immediately sees the list-like structure.
function InboxLoading() {
  return (
    <View className="px-4 pt-4 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="flex-row gap-3">
          <Skeleton className="size-9 rounded-full" />
          <View className="flex-1 gap-2 pt-1">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </View>
        </View>
      ))}
    </View>
  );
}

function InboxEmpty({ iconColor }: { iconColor: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3">
      <Ionicons name="mail-open-outline" size={42} color={iconColor} />
      <Text className="text-base font-medium text-foreground text-center">
        收件箱为空
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        当有人提及你、给你分配任务，或智能体完成任务时，消息会显示在这里。
      </Text>
    </View>
  );
}
