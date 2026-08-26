import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  setCurrentServerUrl,
} from "@/lib/server-url";

const SERVER_URL_KEY = "multica_server_url";

export async function restoreServerUrl(): Promise<string> {
  const stored = await SecureStore.getItemAsync(SERVER_URL_KEY);
  if (!stored) {
    return setCurrentServerUrl(DEFAULT_SERVER_URL);
  }

  try {
    return setCurrentServerUrl(stored);
  } catch {
    await SecureStore.deleteItemAsync(SERVER_URL_KEY);
    return setCurrentServerUrl(DEFAULT_SERVER_URL);
  }
}

export async function saveServerUrl(rawUrl: string): Promise<string> {
  const normalized = normalizeServerUrl(rawUrl);
  await SecureStore.setItemAsync(SERVER_URL_KEY, normalized);
  return setCurrentServerUrl(normalized);
}
