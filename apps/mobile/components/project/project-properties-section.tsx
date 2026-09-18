/**
 * Project properties section. Tappable rows for Status / Priority / Lead / Product.
 * Each row opens a picker sheet via the corresponding `onPress*` callback.
 *
 * Layout mirrors iOS Settings rows: label on left, current value on right
 * with a disclosure chevron, full-width separator below each row. Tapping
 * anywhere on the row triggers the picker.
 *
 * Lead supports both member and agent (Project.lead_type), resolved via
 * useActorLookup so it shares the same lookup with my-issues + issue detail.
 */
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import {
  productListOptions,
  productVersionListOptions,
} from "@/data/queries/products";
import { useActorLookup } from "@/data/use-actor-name";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  project: Project;
  onPressStatus: () => void;
  onPressPriority: () => void;
  onPressLead: () => void;
  onPressProduct: () => void;
}

export function ProjectPropertiesSection({
  project,
  onPressStatus,
  onPressPriority,
  onPressLead,
  onPressProduct,
}: Props) {
  const { getName } = useActorLookup();
  const leadName =
    project.lead_type && project.lead_id
      ? getName(project.lead_type, project.lead_id)
      : null;
  const { data: products = [] } = useQuery(productListOptions());
  const { data: versions = [] } = useQuery(
    productVersionListOptions(project.product_id),
  );
  const product = products.find((item) => item.id === project.product_id);
  const productVersion = versions.find(
    (item) => item.id === project.product_version_id,
  );
  const productLabel = product
    ? [product.name, productVersion?.name].filter(Boolean).join(" / ")
    : project.product_id
      ? "已绑定"
      : "未绑定";

  return (
    <View className="border-y border-border bg-background">
      <Row
        label="状态"
        onPress={onPressStatus}
        left={<ProjectStatusIcon status={project.status} size={16} />}
        right={
          <Text className="text-sm text-foreground">
            {projectStatusLabel(project.status)}
          </Text>
        }
      />
      <Separator />
      <Row
        label="优先级"
        onPress={onPressPriority}
        left={<ProjectPriorityIcon priority={project.priority} size={16} />}
        right={
          <Text className="text-sm text-foreground">
            {projectPriorityLabel(project.priority)}
          </Text>
        }
      />
      <Separator />
      <Row
        label="负责人"
        onPress={onPressLead}
        left={
          leadName ? (
            <ActorAvatar
              type={project.lead_type}
              id={project.lead_id}
              size={20}
              showPresence
            />
          ) : (
            <PlaceholderAvatar />
          )
        }
        right={
          <Text
            className={
              leadName
                ? "text-sm text-foreground"
                : "text-sm text-muted-foreground"
            }
          >
            {leadName ?? "未分配"}
          </Text>
        }
      />
      <Separator />
      <Row
        label="产品"
        onPress={onPressProduct}
        left={<ProductIcon />}
        right={
          <Text
            className={
              product
                ? "text-sm text-foreground"
                : "text-sm text-muted-foreground"
            }
            numberOfLines={1}
          >
            {productLabel}
          </Text>
        }
      />
    </View>
  );
}

function ProductIcon() {
  const { colorScheme } = useColorScheme();
  return (
    <Ionicons
      name="cube-outline"
      size={16}
      color={THEME[colorScheme].mutedForeground}
    />
  );
}

function Row({
  label,
  onPress,
  left,
  right,
}: {
  label: string;
  onPress: () => void;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <Text className="text-sm text-muted-foreground w-20">{label}</Text>
      <View className="flex-row items-center gap-2 flex-1">
        {left}
        {right}
      </View>
      <Chevron />
    </Pressable>
  );
}

function Separator() {
  return <View className="h-px bg-border ml-4" />;
}

function Chevron() {
  const { colorScheme } = useColorScheme();
  return (
    <Ionicons
      name="chevron-forward"
      size={14}
      color={THEME[colorScheme].mutedForeground}
    />
  );
}

function PlaceholderAvatar() {
  return (
    <View
      style={{ width: 20, height: 20, borderRadius: 10 }}
      className="border border-dashed border-muted-foreground/40"
    />
  );
}
