import type { RuntimeConfigWriteInput } from "../../../shared/runtime-config";

interface PublicServerConfig {
  daemonServerUrl?: string;
  daemonAppUrl?: string;
}

export async function discoverDesktopRuntimeConfig(
  inputUrl: string,
): Promise<RuntimeConfigWriteInput> {
  const webUrl = normalizeHttpUrl(inputUrl, "Server URL");
  const configUrl = new URL(webUrl);
  configUrl.pathname = joinPath(configUrl.pathname, "/api/config");

  let response: Response;
  try {
    response = await fetch(configUrl.toString(), {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new Error("Could not reach this server. Check the URL and try again.");
  }

  if (!response.ok) {
    throw new Error(
      `Could not read server config (${response.status}). Check the URL and try again.`,
    );
  }

  const raw = await readJson(response);
  const publicConfig = parsePublicServerConfig(raw);
  const apiUrl = publicConfig.daemonServerUrl ?? webUrl;
  const appUrl = publicConfig.daemonAppUrl ?? webUrl;

  if (
    publicConfig.daemonServerUrl &&
    !publicConfig.daemonAppUrl &&
    sameUrl(publicConfig.daemonServerUrl, webUrl)
  ) {
    throw new Error(
      "This looks like the API server. Enter the Multica web URL instead.",
    );
  }

  return { apiUrl, appUrl };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("This server did not return JSON from /api/config.");
  }
}

function parsePublicServerConfig(raw: unknown): PublicServerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("This server returned an invalid /api/config response.");
  }
  const obj = raw as Record<string, unknown>;
  return {
    daemonServerUrl: optionalHttpUrl(obj.daemon_server_url, "daemon_server_url"),
    daemonAppUrl: optionalHttpUrl(obj.daemon_app_url, "daemon_app_url"),
  };
}

function optionalHttpUrl(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when present.`);
  }
  return normalizeHttpUrl(value, field);
}

function normalizeHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${field} must be a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} must use http or https.`);
  }
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.toString());
}

function sameUrl(a: string, b: string): boolean {
  return normalizeHttpUrl(a, "daemon_server_url") === normalizeHttpUrl(b, "Server URL");
}

function joinPath(base: string, suffix: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}${suffix}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
