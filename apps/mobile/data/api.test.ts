// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "./api";
import { setCurrentServerUrl } from "@/lib/server-url";

// Pin the default server before server-url.ts is imported.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.example.test";
});

// The real store pulls in expo-secure-store; the client only needs the slug.
vi.mock("@/data/workspace-store", () => ({ getCurrentSlug: () => null }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

describe("api.listAgents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [undefined, "/api/agents"],
    [{ includeArchived: false }, "/api/agents"],
    [{ includeArchived: true }, "/api/agents?include_archived=true"],
  ])("with %j requests %s", async (opts, path) => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.listAgents(opts)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`https://api.example.test${path}`, expect.any(Object));
  });
});

describe("api.deleteComment", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
    setCurrentServerUrl("https://api.example.test");
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // #8296: servers that keep a deleted comment's replies also route
  // /keep-replies; older servers do not, so a keep-replies delete that reaches
  // one fails instead of deleting the replies too.
  it.each([
    [{ keepReplies: true }, "https://api.example.test/api/comments/comment-1/keep-replies"],
    [{ keepReplies: false }, "https://api.example.test/api/comments/comment-1"],
    [undefined, "https://api.example.test/api/comments/comment-1"],
  ])("with %j sends DELETE %s", async (opts, url) => {
    await api.deleteComment("comment-1", opts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: "DELETE" }));
  });
});

describe("api.listProductVersionFolders", () => {
  const requestedUrls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    requestedUrls.push(url);
    return new Response(JSON.stringify({ folders: [], total_count: 0, current_folder: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  beforeEach(() => {
    setCurrentServerUrl("https://api.example.test");
    fetchMock.mockClear();
    requestedUrls.length = 0;
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Issue pickers read the version's subtree instead of the
  // system-administrator-only /api/system/kb/folders, which answered 403 to
  // ordinary members and left the folder list empty.
  it.each([
    [undefined, "https://api.example.test/api/products/product-1/versions/version-1/folders"],
    [3, "https://api.example.test/api/products/product-1/versions/version-1/folders?page_index=3"],
  ])("with page index %s requests %s", async (pageIndex, url) => {
    await api.listProductVersionFolders("product-1", "version-1", pageIndex);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrls).toEqual([url]);
  });
});

describe("mobile API transport", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    setCurrentServerUrl("https://api.example.test");
    api.setToken(null);
    api.setOptions({ onUnauthorized: undefined });
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    api.setToken(null);
    api.setOptions({ onUnauthorized: undefined });
    setCurrentServerUrl("https://api.example.test");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the currently selected server, including its path prefix", async () => {
    setCurrentServerUrl("https://selected.example.test/multica/");
    await api.deleteComment("comment-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://selected.example.test/multica/api/comments/comment-1",
      expect.any(Object),
    );
  });

  it("sends bearer credentials and Android client metadata", async () => {
    api.setToken("test-token");
    await api.deleteComment("comment-1");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "X-Client-Platform": "mobile",
      "X-Client-OS": "android",
      "X-Client-Version": "0.1.0",
      "X-Request-ID": expect.any(String),
    });
  });

  it("omits bearer credentials after signing out", async () => {
    api.setToken("test-token");
    api.setToken(null);
    await api.deleteComment("comment-1");
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
  });

  it("routes unauthorized errors to the session cleanup handler", async () => {
    const onUnauthorized = vi.fn();
    api.setOptions({ onUnauthorized });
    fetchMock.mockResolvedValue(new Response('{"message":"expired"}', { status: 401 }));
    await expect(api.getMe()).rejects.toMatchObject({ status: 401, message: "expired" });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("does not sign out on server errors", async () => {
    const onUnauthorized = vi.fn();
    api.setOptions({ onUnauthorized });
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each(["server", "token"])("ignores a stale 401 after the %s has changed", async (changed) => {
    const onUnauthorized = vi.fn();
    api.setOptions({ onUnauthorized });
    api.setToken("old-token");
    fetchMock.mockImplementation(async () => {
      if (changed === "server") setCurrentServerUrl("https://new.example.test");
      else api.setToken("new-token");
      return new Response("expired", { status: 401 });
    });
    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("forwards caller cancellation to the native fetch signal", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new DOMException("cancelled", "AbortError");
    });
    await expect(api.getMe({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts hung requests after 30 seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")));
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = expect(api.getMe()).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
