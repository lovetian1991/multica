import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

// api.ts refuses to load without a base URL; set it before the import runs.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.example.test";
});

// The real store pulls in expo-secure-store; the client only needs the slug.
vi.mock("@/data/workspace-store", () => ({ getCurrentSlug: () => null }));

describe("api.deleteComment", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
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
