import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock("expo-secure-store", () => secureStore);

import { getCurrentServerUrl } from "@/lib/server-url";
import { restoreServerUrl, saveServerUrl } from "./server-config";

describe("server config persistence", () => {
  beforeEach(() => {
    secureStore.getItemAsync.mockReset();
    secureStore.setItemAsync.mockReset();
    secureStore.deleteItemAsync.mockReset();
  });

  it("restores and normalizes a saved server", async () => {
    secureStore.getItemAsync.mockResolvedValue(
      "http://192.168.11.173:30080/",
    );

    await expect(restoreServerUrl()).resolves.toBe(
      "http://192.168.11.173:30080",
    );
    expect(getCurrentServerUrl()).toBe("http://192.168.11.173:30080");
  });

  it("persists the normalized server", async () => {
    secureStore.setItemAsync.mockResolvedValue(undefined);

    await expect(
      saveServerUrl("https://example.test/multica/"),
    ).resolves.toBe("https://example.test/multica");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "multica_server_url",
      "https://example.test/multica",
    );
  });

  it("discards an invalid saved value", async () => {
    secureStore.getItemAsync.mockResolvedValue("not-a-url");
    secureStore.deleteItemAsync.mockResolvedValue(undefined);

    const restored = await restoreServerUrl();

    expect(restored).toMatch(/^https?:\/\//);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      "multica_server_url",
    );
  });
});
