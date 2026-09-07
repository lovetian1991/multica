// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverDesktopRuntimeConfig } from "./server-discovery";

function mockFetch(response: Partial<Response>) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("discoverDesktopRuntimeConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps daemon server and app URLs from /api/config", async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          daemon_server_url: "http://192.168.11.173:30081/",
          daemon_app_url: "http://192.168.11.173:30080/",
        }),
    });

    await expect(
      discoverDesktopRuntimeConfig("http://192.168.11.173:30080/?x=1#top"),
    ).resolves.toEqual({
      apiUrl: "http://192.168.11.173:30081",
      appUrl: "http://192.168.11.173:30080",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://192.168.11.173:30080/api/config",
      { headers: { accept: "application/json" } },
    );
  });

  it("falls back to the input URL when daemon URLs are absent", async () => {
    mockFetch({ ok: true, json: () => Promise.resolve({}) });

    await expect(
      discoverDesktopRuntimeConfig("https://multica.example.com/app/"),
    ).resolves.toEqual({
      apiUrl: "https://multica.example.com/app",
      appUrl: "https://multica.example.com/app",
    });
  });

  it("asks for the web URL when a direct API URL omits daemon_app_url", async () => {
    mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          daemon_server_url: "http://192.168.11.173:30081",
        }),
    });

    await expect(
      discoverDesktopRuntimeConfig("http://192.168.11.173:30081"),
    ).rejects.toThrow(/web URL/i);
  });

  it("rejects non-http input URLs before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverDesktopRuntimeConfig("file:///tmp/multica")).rejects.toThrow(
      /http or https/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid daemon URL fields", async () => {
    mockFetch({
      ok: true,
      json: () => Promise.resolve({ daemon_server_url: "ftp://example.com" }),
    });

    await expect(
      discoverDesktopRuntimeConfig("https://multica.example.com"),
    ).rejects.toThrow(/daemon_server_url must use http or https/);
  });

  it("reports non-JSON /api/config responses", async () => {
    mockFetch({ ok: true, json: () => Promise.reject(new Error("nope")) });

    await expect(
      discoverDesktopRuntimeConfig("https://multica.example.com"),
    ).rejects.toThrow(/did not return JSON/);
  });

  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      discoverDesktopRuntimeConfig("https://multica.example.com"),
    ).rejects.toThrow(/Could not reach/);
  });
});
