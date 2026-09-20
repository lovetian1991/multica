"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, Loader2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useCurrentMember } from "@multica/core/permissions";
import {
  useApplyWorkspaceProcessTemplate,
  useUpgradeWorkspaceProcessTemplate,
  workspaceProcessTemplateListOptions,
} from "@multica/core/process-templates";
import type { ProcessTemplate } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { useT } from "../../i18n";
import { SettingsCard, SettingsSection, SettingsTab } from "./settings-layout";

export function ProcessTemplatesTab() {
  const { t } = useT("settings");
  const workspace = useCurrentWorkspace();
  const wsId = workspace?.id ?? "";
  const { role } = useCurrentMember(wsId);
  const canManage = role === "owner" || role === "admin";

  const listQuery = useQuery({
    ...workspaceProcessTemplateListOptions(),
    enabled: Boolean(wsId),
  });
  const apply = useApplyWorkspaceProcessTemplate(wsId);
  const upgrade = useUpgradeWorkspaceProcessTemplate(wsId);
  const templates = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const busyId = apply.isPending
    ? apply.variables
    : upgrade.isPending
      ? upgrade.variables
      : null;

  const runApply = (template: ProcessTemplate) => {
    apply.mutate(template.id, {
      onSuccess: () => toast.success(t(($) => $.process_templates.apply_success, { name: template.name })),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : t(($) => $.process_templates.apply_failed),
        ),
    });
  };

  const runUpgrade = (template: ProcessTemplate) => {
    upgrade.mutate(template.id, {
      onSuccess: () => toast.success(t(($) => $.process_templates.upgrade_success, { name: template.name })),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : t(($) => $.process_templates.upgrade_failed),
        ),
    });
  };

  return (
    <SettingsTab
      title={t(($) => $.process_templates.title)}
      description={t(($) => $.process_templates.workspace_description)}
    >
      <SettingsSection
        title={t(($) => $.process_templates.catalog_title)}
        description={
          canManage
            ? t(($) => $.process_templates.workspace_hint)
            : t(($) => $.process_templates.read_only_note)
        }
      >
        <SettingsCard>
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : listQuery.error ? (
            <div className="px-4 py-8 text-center text-body text-destructive">
              {listQuery.error instanceof Error
                ? listQuery.error.message
                : t(($) => $.process_templates.load_failed)}
            </div>
          ) : templates.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Workflow className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-3 text-body font-medium">
                {t(($) => $.process_templates.empty_workspace)}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-surface-border">
              {templates.map((template) => {
                const latest = template.latest_version?.version;
                const installed = template.installed_version?.version;
                return (
                  <li
                    key={template.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-body font-medium">{template.name}</p>
                        {template.installed ? (
                          <Badge variant="secondary">
                            {t(($) => $.process_templates.installed)}
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            {t(($) => $.process_templates.not_installed)}
                          </Badge>
                        )}
                        {template.can_upgrade ? (
                          <Badge>{t(($) => $.process_templates.can_upgrade)}</Badge>
                        ) : null}
                      </div>
                      {template.description ? (
                        <p className="mt-1 text-caption text-muted-foreground">
                          {template.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-caption text-muted-foreground">
                        {t(($) => $.process_templates.version_summary, {
                          latest: latest ? `v${latest}` : t(($) => $.process_templates.not_set),
                          installed: template.installed
                            ? installed
                              ? `v${installed}`
                              : t(($) => $.process_templates.not_set)
                            : t(($) => $.process_templates.not_installed),
                        })}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex shrink-0 gap-2">
                        {template.installed ? null : (
                          <Button
                            size="sm"
                            disabled={busyId === template.id}
                            onClick={() => runApply(template)}
                          >
                            {busyId === template.id && apply.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            {busyId === template.id && apply.isPending
                              ? t(($) => $.process_templates.applying)
                              : t(($) => $.process_templates.apply)}
                          </Button>
                        )}
                        {template.can_upgrade ? (
                          <Button
                            size="sm"
                            variant={template.installed ? "default" : "outline"}
                            disabled={busyId === template.id}
                            onClick={() => runUpgrade(template)}
                          >
                            {busyId === template.id && upgrade.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ArrowUpCircle className="h-4 w-4" />
                            )}
                            {busyId === template.id && upgrade.isPending
                              ? t(($) => $.process_templates.upgrading)
                              : t(($) => $.process_templates.upgrade)}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}
