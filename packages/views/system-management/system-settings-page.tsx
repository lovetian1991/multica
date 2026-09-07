"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Save, Server } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import {
  systemSettingsOptions,
  useUpdateSystemSettings,
} from "@multica/core/system-settings";
import { Button } from "@multica/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { CollapsedNavTrigger } from "../layout/page-header";
import { useT } from "../i18n";
import { SystemManagementLayout } from "./system-management-layout";

export function SystemSettingsPage() {
  const { t } = useT("settings");
  const settingsQuery = useQuery(systemSettingsOptions());
  const update = useUpdateSystemSettings();
  const [environmentURL, setEnvironmentURL] = useState("");
  const [integrationKey, setIntegrationKey] = useState("");

  useEffect(() => {
    if (!settingsQuery.data) return;
    setEnvironmentURL(settingsQuery.data.kb_environment_url);
  }, [settingsQuery.data]);

  const isForbidden =
    settingsQuery.error instanceof ApiError && settingsQuery.error.status === 403;

  const save = () => {
    update.mutate(
      {
        kb_environment_url: environmentURL.trim(),
        ...(integrationKey.trim()
          ? { kb_integration_key: integrationKey.trim() }
          : {}),
      },
      {
        onSuccess: () => {
          setIntegrationKey("");
          toast.success(t(($) => $.system_settings.saved));
        },
        onError: (error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t(($) => $.system_settings.save_failed),
          );
        },
      },
    );
  };

  return (
    <SystemManagementLayout>
      <div className="min-h-svh overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-4xl p-4 sm:p-6 md:p-8">
          <header className="mb-8 border-b border-surface-border pb-6">
            <CollapsedNavTrigger />
            <p className="mb-2 text-caption font-medium uppercase tracking-wider text-muted-foreground">
              {t(($) => $.system_management.title)}
            </p>
            <h1 className="text-title-lg font-semibold tracking-tight">
              {t(($) => $.system_settings.title)}
            </h1>
            <p className="mt-1 max-w-2xl text-body leading-6 text-muted-foreground">
              {t(($) => $.system_settings.description)}
            </p>
          </header>

          {isForbidden ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-12 text-center">
              <p className="text-body font-medium">
                {t(($) => $.system_settings.system_admin_required)}
              </p>
            </div>
          ) : settingsQuery.isLoading ? (
            <p className="text-body text-muted-foreground">
              {t(($) => $.system_settings.loading)}
            </p>
          ) : settingsQuery.error ? (
            <p className="text-body text-destructive">
              {settingsQuery.error instanceof Error
                ? settingsQuery.error.message
                : t(($) => $.system_settings.load_failed)}
            </p>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-body">
                  {t(($) => $.system_settings.kb.title)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="kb-environment-url">
                    <Server className="size-4" />
                    {t(($) => $.system_settings.kb.environment_url)}
                  </Label>
                  <Input
                    id="kb-environment-url"
                    type="url"
                    maxLength={2048}
                    value={environmentURL}
                    onChange={(event) => setEnvironmentURL(event.target.value)}
                    placeholder={t(($) => $.system_settings.kb.environment_url_placeholder)}
                  />
                  <p className="text-caption text-muted-foreground">
                    {t(($) => $.system_settings.kb.environment_url_hint)}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="kb-integration-key">
                    <KeyRound className="size-4" />
                    {t(($) => $.system_settings.kb.integration_key)}
                  </Label>
                  <Input
                    id="kb-integration-key"
                    type="password"
                    maxLength={4096}
                    value={integrationKey}
                    onChange={(event) => setIntegrationKey(event.target.value)}
                    placeholder={
                      settingsQuery.data?.kb_integration_key_configured
                        ? t(($) => $.system_settings.kb.integration_key_configured)
                        : t(($) => $.system_settings.kb.integration_key_placeholder)
                    }
                    autoComplete="new-password"
                  />
                  <p className="text-caption text-muted-foreground">
                    {settingsQuery.data?.kb_integration_key_configured ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="size-3.5 text-success" />
                        {t(($) => $.system_settings.kb.integration_key_saved_hint)}
                      </span>
                    ) : (
                      t(($) => $.system_settings.kb.integration_key_hint)
                    )}
                  </p>
                </div>

                <div className="flex justify-end border-t border-surface-border pt-5">
                  <Button className="gap-2" onClick={save} disabled={update.isPending}>
                    <Save className="size-4" />
                    {update.isPending
                      ? t(($) => $.system_settings.saving)
                      : t(($) => $.system_settings.save)}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </SystemManagementLayout>
  );
}
