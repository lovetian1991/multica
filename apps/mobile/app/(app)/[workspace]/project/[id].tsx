/**
 * Project detail screen. Single column, scrolling:
 *
 *   Header card (icon + title + description, tap → edit)
 *   Properties section (Status / Priority / Lead — tap chip → picker)
 *   Resources section (read-only by default, "Add" button → resource form)
 *   Related issues (Open / Done bucketed list)
 *
 * Per-record realtime: `useProjectRealtime(id, onDeleted=back)` subscribes
 * to `project:updated` (full replace) and `project:deleted` (pop back).
 *
 * Right-top "…" menu uses the shared cross-platform DropdownMenu. Delete
 * asks for confirmation via `Alert.alert` because destructive actions need
 * a second tap.
 */
import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectHeaderCard } from "@/components/project/project-header-card";
import { ProjectPropertiesSection } from "@/components/project/project-properties-section";
import { ProjectRelatedIssues } from "@/components/project/project-related-issues";
import { ProjectResourcesSection } from "@/components/project/project-resources-section";
import {
  projectDetailOptions,
  projectResourcesOptions,
} from "@/data/queries/projects";
import { issueKeys } from "@/data/queries/issue-keys";
import { useDeleteProject } from "@/data/mutations/projects";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { useAuthStore } from "@/data/auth-store";
import { useProjectRealtime } from "@/data/realtime/use-project-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const qc = useQueryClient();

  const detail = useQuery(projectDetailOptions(wsId, id));
  const deleteProject = useDeleteProject(id);

  // Per-record realtime — when another client deletes the project we're
  // viewing, pop back so the user isn't stranded on a 404.
  useProjectRealtime(id, () => router.back());

  const onRefresh = useCallback(async () => {
    await Promise.all([
      detail.refetch(),
      qc.invalidateQueries({ queryKey: projectResourcesOptions(wsId, id).queryKey }),
      qc.invalidateQueries({
        queryKey: [...issueKeys.list(wsId), "byProject", id],
      }),
    ]);
  }, [detail, qc, wsId, id]);

  const project = detail.data;

  // EMPTY_PROJECT carries an empty id — parseWithFallback returned the
  // fallback because the response shape drifted. Treat as "not found".
  const projectMissing = !project || project.id === "";

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const isPinned =
    !!project &&
    !!pins?.some(
      (p) => p.item_type === "project" && p.item_id === project.id,
    );
  const createPin = useCreatePin();
  const deletePin = useDeletePin();

  const onDelete = useCallback(() => {
    Alert.alert(
      "删除项目？",
      "此操作无法撤销。该项目中的任务将不再归属于任何项目。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: () => {
            deleteProject.mutate(undefined, {
              onSuccess: () => router.back(),
            });
          },
        },
      ],
    );
  }, [deleteProject]);

  const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
  const projectLink =
    project && wsSlug && webUrl
      ? `${webUrl}/${wsSlug}/projects/${project.id}`
      : null;

  const onSelectAction = useCallback(
    (action: ProjectAction) => {
      if (!project || !wsSlug) return;
      switch (action) {
        case "pin":
          createPin.mutate({ item_type: "project", item_id: project.id });
          break;
        case "unpin":
          deletePin.mutate({ itemType: "project", itemId: project.id });
          break;
        case "edit":
          router.push(`/${wsSlug}/project/${id}/edit`);
          break;
        case "open-web":
          if (projectLink) void Linking.openURL(projectLink);
          break;
        case "delete":
          onDelete();
          break;
      }
    },
    [
      createPin,
      deletePin,
      id,
      onDelete,
      project,
      projectLink,
      wsSlug,
    ],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: project?.title || "项目",
          headerBackTitle: "返回",
          headerRight: project && project.id
            ? () => (
                <ProjectActionsMenu
                  isPinned={isPinned}
                  hasLink={!!projectLink}
                  onSelect={onSelectAction}
                />
              )
            : undefined,
        }}
      />
      {detail.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : detail.error || projectMissing ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            项目加载失败：{" "}
            {detail.error instanceof Error
              ? detail.error.message
              : "未找到项目"}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>重试</Text>
          </Button>
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="pb-10"
          refreshControl={
            <RefreshControl
              refreshing={detail.isRefetching}
              onRefresh={onRefresh}
            />
          }
          keyboardDismissMode="on-drag"
        >
          <ProjectHeaderCard
            project={project}
            onEdit={() => {
              if (wsSlug) router.push(`/${wsSlug}/project/${id}/edit`);
            }}
          />
          <ProjectPropertiesSection
            project={project}
            onPressStatus={() => {
              if (wsSlug)
                router.push({
                  pathname: "/[workspace]/project/[id]/picker/status",
                  params: { workspace: wsSlug, id },
                });
            }}
            onPressPriority={() => {
              if (wsSlug)
                router.push({
                  pathname: "/[workspace]/project/[id]/picker/priority",
                  params: { workspace: wsSlug, id },
                });
            }}
            onPressLead={() => {
              if (wsSlug)
                router.push({
                  pathname: "/[workspace]/project/[id]/picker/lead",
                  params: { workspace: wsSlug, id },
                });
            }}
          />
          <ProjectResourcesSection
            projectId={id}
            onAdd={() => {
              if (wsSlug)
                router.push({
                  pathname: "/[workspace]/project/[id]/add-resource",
                  params: { workspace: wsSlug, id },
                });
            }}
          />
          <View className="h-3" />
          <ProjectRelatedIssues projectId={id} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

type ProjectAction = "pin" | "unpin" | "edit" | "open-web" | "delete";

function ProjectActionsMenu({
  isPinned,
  hasLink,
  onSelect,
}: {
  isPinned: boolean;
  hasLink: boolean;
  onSelect: (action: ProjectAction) => void;
}) {
  const { colors } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="size-10 items-center justify-center rounded-md active:bg-accent"
        accessibilityLabel="项目操作"
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
          <Text>{isPinned ? "取消置顶" : "置顶"}</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onPress={() => onSelect("edit")}>
          <Text>编辑详情</Text>
        </DropdownMenuItem>
        {hasLink ? (
          <DropdownMenuItem onPress={() => onSelect("open-web")}>
            <Text>在网页端打开</Text>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onPress={() => onSelect("delete")}
        >
          <Text>删除项目</Text>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
