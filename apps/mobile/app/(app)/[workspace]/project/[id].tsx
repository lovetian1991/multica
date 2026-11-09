/**
 * Project detail screen. Single column, scrolling:
 *
 *   Header card (icon + title + description, tap → edit)
 *   Properties section (Status / Priority / Lead / Product — tap chip → picker)
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
import { Stack, router, useLocalSearchParams, useTheme } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
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
import { canDeleteProject } from "@multica/core/projects/deletion-permissions";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { issueKeys } from "@/data/queries/issue-keys";
import { useDeleteProject } from "@/data/mutations/projects";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { useAuthStore } from "@/data/auth-store";
import { useProjectRealtime } from "@/data/realtime/use-project-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useT } from "@/lib/i18n";

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
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId, { includeArchived: true }));
  const role = members.find((m) => m.user_id === userId)?.role ?? null;
  const canDelete = !!project && canDeleteProject(project, userId, role, agents);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const isPinned =
    !!project &&
    !!pins?.some(
      (p) => p.item_type === "project" && p.item_id === project.id,
    );
  const createPin = useCreatePin();
  const deletePin = useDeletePin();
  const { t } = useT("projects");

  const onDelete = useCallback(() => {
    if (!canDelete) return;
    Alert.alert(
      t("delete.title"),
      t("delete.message"),
      [
        { text: t("common:actions.cancel"), style: "cancel" },
        {
          text: t("common:actions.delete"),
          style: "destructive",
          onPress: () => {
            deleteProject.mutate(undefined, {
              onSuccess: () => router.back(),
            });
          },
        },
      ],
    );
  }, [canDelete, deleteProject, t]);

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
        case "new-issue":
          router.push({
            pathname: "/[workspace]/new-issue",
            params: { workspace: wsSlug, projectId: project.id },
          });
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
          title: project?.title || t("navigation:routes.project"),
          headerBackTitle: t("common:actions.back"),
          headerRight: project && project.id
            ? () => (
                <ProjectActionsMenu
                  isPinned={isPinned}
                  hasLink={!!projectLink}
                  canDelete={canDelete}
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
            onPressProduct={() => {
              if (wsSlug)
                router.push({
                  pathname: "/[workspace]/project/[id]/picker/product",
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

type ProjectAction = "pin" | "unpin" | "edit" | "new-issue" | "open-web" | "delete";

function ProjectActionsMenu({
  isPinned,
  hasLink,
  canDelete,
  onSelect,
}: {
  isPinned: boolean;
  hasLink: boolean;
  canDelete: boolean;
  onSelect: (action: ProjectAction) => void;
}) {
  const { colors } = useTheme();
  const { t } = useT("projects");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="size-10 items-center justify-center rounded-md active:bg-accent"
        accessibilityLabel={t("menu.project_actions")}
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
        <DropdownMenuItem onPress={() => onSelect("new-issue")}>
          <Text>{t("issues:new.title")}</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onPress={() => onSelect("edit")}>
          <Text>{t("menu.edit_details")}</Text>
        </DropdownMenuItem>
        {hasLink ? (
          <DropdownMenuItem onPress={() => onSelect("open-web")}>
            <Text>{t("menu.open_web")}</Text>
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onPress={() => onSelect("delete")}
            >
              <Text>{t("common:actions.delete")}</Text>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
