import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Server } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { cn } from "@multica/ui/lib/utils";
import { useAuthStore } from "@multica/core/auth";
import { useWelcomeStore } from "@multica/core/onboarding";
import { useT } from "@multica/views/i18n";
import { DEFAULT_RUNTIME_CONFIG } from "../../../shared/runtime-config";
import type { RuntimeConfig } from "../../../shared/runtime-config";
import { discoverDesktopRuntimeConfig } from "../platform/server-discovery";
import { useTabStore } from "../stores/tab-store";
import { useWindowOverlayStore } from "../stores/window-overlay-store";

interface ServerEndpointFormProps {
  variant?: "login" | "settings";
  defaultEditing?: boolean;
  onRequestChange?: () => void;
  onCancelEditing?: () => void;
}

export function ServerEndpointForm({
  variant = "login",
  defaultEditing = false,
  onRequestChange,
  onCancelEditing,
}: ServerEndpointFormProps) {
  const { t } = useT("settings");
  const runtimeConfig = currentRuntimeConfig();
  const [editing, setEditing] = useState(defaultEditing);
  const [serverUrl, setServerUrl] = useState(runtimeConfig.appUrl);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isCloud = runtimeConfig.appUrl === DEFAULT_RUNTIME_CONFIG.appUrl;
  const title = isCloud ? t(($) => $.desktop.server.cloud_name) : runtimeConfig.appUrl;
  const showApiDetail = variant === "settings" && runtimeConfig.apiUrl !== runtimeConfig.appUrl;
  const description =
    variant === "settings"
      ? t(($) => $.desktop.server.description_settings)
      : t(($) => $.desktop.server.description_login);

  useEffect(() => {
    setEditing(defaultEditing);
  }, [defaultEditing]);

  const saveAndReload = async (inputUrl: string) => {
    setSaving(true);
    setError("");
    try {
      const discovered = await discoverDesktopRuntimeConfig(inputUrl);
      const result = await window.desktopAPI.saveRuntimeConfig(discovered);
      if (!result.ok) throw new Error(result.error.message);
      await clearDesktopSession();
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t(($) => $.desktop.server.error_generic),
      );
      setSaving(false);
    }
  };

  const resetCloudAndReload = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await window.desktopAPI.resetRuntimeConfig();
      if (!result.ok) throw new Error(result.error.message);
      await clearDesktopSession();
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t(($) => $.desktop.server.error_reset),
      );
      setSaving(false);
    }
  };

  return (
    <section
      className={cn(
        variant === "login"
          ? "w-full max-w-sm rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
          : "w-full",
      )}
    >
      <div className={cn("flex min-w-0 items-start gap-3", variant === "settings" && "p-4")}>
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Server className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-body font-semibold">{t(($) => $.desktop.server.heading)}</h2>
            {!editing && (
              <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            )}
          </div>
          {!editing ? (
            <>
              <p className="mt-1 truncate font-mono text-caption" title={title}>
                {title}
              </p>
              {showApiDetail ? (
                <p className="mt-1 truncate font-mono text-caption text-muted-foreground" title={runtimeConfig.apiUrl}>
                  {t(($) => $.desktop.server.api_url_prefix)}{runtimeConfig.apiUrl}
                </p>
              ) : null}
              <p className="mt-2 text-caption leading-5 text-muted-foreground">
                {description}
              </p>
            </>
          ) : (
            <p className="mt-1 text-caption leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {!editing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (onRequestChange) {
                onRequestChange();
              } else {
                setEditing(true);
              }
            }}
          >
            {t(($) => $.desktop.server.change)}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form
          className={cn("space-y-3", variant === "settings" ? "border-t p-4" : "mt-4")}
          onSubmit={(event) => {
            event.preventDefault();
            void saveAndReload(serverUrl);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={variant === "settings" ? "settings-server-url" : "login-server-url"}>
              {t(($) => $.desktop.server.web_url_label)}
            </Label>
            <Input
              id={variant === "settings" ? "settings-server-url" : "login-server-url"}
              type="url"
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder={t(($) => $.desktop.server.web_url_placeholder)}
              disabled={saving}
            />
          </div>
          {error ? (
            <p className="flex items-start gap-2 text-caption leading-5 text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                onCancelEditing?.();
                setServerUrl(runtimeConfig.appUrl);
                setError("");
              }}
              disabled={saving}
            >
              {t(($) => $.desktop.server.cancel)}
            </Button>
            {!isCloud ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void resetCloudAndReload()}
                disabled={saving}
              >
                {t(($) => $.desktop.server.use_cloud)}
              </Button>
            ) : null}
            <Button type="submit" disabled={saving || !serverUrl.trim()}>
              {saving ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {t(($) => $.desktop.server.saving)}
                </>
              ) : (
                t(($) => $.desktop.server.continue)
              )}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export async function clearDesktopSession() {
  localStorage.removeItem("multica_token");
  useAuthStore.getState().logout();
  useTabStore.getState().reset();
  useWindowOverlayStore.getState().close();
  useWelcomeStore.getState().reset();
  window.desktopAPI.reportAuthSession?.(null);
  try {
    await window.daemonAPI.clearToken();
  } catch {
    // best effort
  }
  try {
    await window.daemonAPI.stop();
  } catch {
    // best effort
  }
}

function currentRuntimeConfig(): RuntimeConfig {
  const result = window.desktopAPI.runtimeConfig;
  if (!result.ok) {
    throw new Error("Desktop runtime config is unavailable");
  }
  return result.config;
}
