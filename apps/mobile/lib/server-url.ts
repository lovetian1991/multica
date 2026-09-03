const FALLBACK_SERVER_URL = "http://192.168.11.173:30080";

function getDefaultServerUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL ?? FALLBACK_SERVER_URL;
  return normalizeServerUrl(configured);
}

export function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("请输入服务器地址。");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("请输入完整的 http:// 或 https:// 服务器地址。");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务器地址必须以 http:// 或 https:// 开头。");
  }
  if (!parsed.hostname) {
    throw new Error("服务器地址必须包含主机名或 IP 地址。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("服务器地址不能包含用户名或密码。");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("服务器地址不能包含查询参数或片段。");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export const DEFAULT_SERVER_URL = getDefaultServerUrl();

let currentServerUrl = DEFAULT_SERVER_URL;

export function getCurrentServerUrl(): string {
  return currentServerUrl;
}

export function setCurrentServerUrl(rawUrl: string): string {
  const normalized = normalizeServerUrl(rawUrl);
  currentServerUrl = normalized;
  return normalized;
}

export function toWebSocketUrl(serverUrl: string): string {
  const parsed = new URL(normalizeServerUrl(serverUrl));
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/ws`;
  return parsed.toString();
}
