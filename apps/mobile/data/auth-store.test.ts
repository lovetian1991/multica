// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@multica/core/types";

const mocks = vi.hoisted(() => ({
  api: { setToken: vi.fn(), getMe: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn() },
  getToken: vi.fn(),
  clearToken: vi.fn(),
  setToken: vi.fn(),
  restoreSlug: vi.fn(),
  clearWorkspace: vi.fn(),
  clearQueries: vi.fn(),
  restoreServerUrl: vi.fn(),
  saveServerUrl: vi.fn(),
}));

vi.mock("./api", () => ({
  api: mocks.api,
  ApiError: class extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
}));
vi.mock("./secure-storage", () => ({
  getToken: mocks.getToken, clearToken: mocks.clearToken, setToken: mocks.setToken,
}));
vi.mock("./workspace-store", () => ({
  useWorkspaceStore: {
    getState: () => ({ restoreSlug: mocks.restoreSlug, clear: mocks.clearWorkspace }),
  },
}));
vi.mock("./query-client", () => ({ queryClient: { clear: mocks.clearQueries } }));
vi.mock("./server-config", () => ({
  restoreServerUrl: mocks.restoreServerUrl, saveServerUrl: mocks.saveServerUrl,
}));

import { useAuthStore } from "./auth-store";
import { ApiError } from "./api";
import { currentSessionEpoch } from "./session-epoch";
import { getCurrentServerUrl, setCurrentServerUrl } from "@/lib/server-url";

const user = { id: "user-1" } as User;
const originalServer = "https://original.example.test";

beforeEach(() => {
  vi.resetAllMocks();
  setCurrentServerUrl(originalServer);
  useAuthStore.setState({ user: null, isLoading: true });
  mocks.getToken.mockResolvedValue("old-token");
  mocks.api.getMe.mockResolvedValue(user);
  mocks.restoreServerUrl.mockResolvedValue(originalServer);
  mocks.saveServerUrl.mockImplementation(async (url: string) => setCurrentServerUrl(url));
});

describe("mobile auth initialization", () => {
  it("restores the selected server before loading credentials or requesting the user", async () => {
    mocks.restoreServerUrl.mockImplementation(async () => setCurrentServerUrl("https://saved.example.test"));
    mocks.api.getMe.mockImplementation(async () => {
      expect(getCurrentServerUrl()).toBe("https://saved.example.test");
      return user;
    });

    await useAuthStore.getState().initialize();

    expect(mocks.restoreServerUrl.mock.invocationCallOrder[0]).toBeLessThan(mocks.getToken.mock.invocationCallOrder[0]);
    expect(mocks.restoreSlug).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ user, isLoading: false });
  });

  it("finishes loading without requesting a user when signed out", async () => {
    mocks.getToken.mockResolvedValue(null);
    await useAuthStore.getState().initialize();
    expect(mocks.api.getMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
  });

  it.each([new TypeError("offline"), new ApiError("unavailable", 503)])(
    "preserves credentials on transient failures: %s",
    async (error) => {
      mocks.api.getMe.mockRejectedValue(error);
      await useAuthStore.getState().initialize();
      expect(mocks.clearToken).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isLoading).toBe(false);
    },
  );

  it("clears expired credentials on 401", async () => {
    mocks.api.getMe.mockRejectedValue(new ApiError("unauthorized", 401));
    await useAuthStore.getState().initialize();
    expect(mocks.clearToken).toHaveBeenCalledOnce();
    expect(mocks.api.setToken).toHaveBeenLastCalledWith(null);
  });

  it("finishes loading when the global 401 handler starts signing out", async () => {
    mocks.api.getMe.mockImplementation(async () => {
      await useAuthStore.getState().logout();
      throw new ApiError("unauthorized", 401);
    });
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState()).toMatchObject({ user: null, isLoading: false });
  });

  it("does not stay on the loading screen when server storage fails", async () => {
    mocks.restoreServerUrl.mockRejectedValue(new Error("storage unavailable"));
    await useAuthStore.getState().initialize();
    expect(mocks.api.getMe).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});

describe("mobile server configuration", () => {
  it("invalidates the old session synchronously and clears private state before switching hosts", async () => {
    useAuthStore.setState({ user });
    const epoch = currentSessionEpoch();
    mocks.saveServerUrl.mockImplementation(async (url: string) => {
      expect(mocks.clearToken).toHaveBeenCalledOnce();
      expect(mocks.clearWorkspace).toHaveBeenCalledOnce();
      expect(mocks.clearQueries).toHaveBeenCalledOnce();
      expect(useAuthStore.getState().user).toBeNull();
      return setCurrentServerUrl(url);
    });

    const pending = useAuthStore.getState().configureServer(" https://new.example.test/prefix/ ");
    expect(currentSessionEpoch()).toBeGreaterThan(epoch);
    expect(mocks.api.setToken).toHaveBeenLastCalledWith(null);
    await pending;
    expect(getCurrentServerUrl()).toBe("https://new.example.test/prefix");
  });

  it("does not sign out when the normalized server is unchanged", async () => {
    useAuthStore.setState({ user });
    await useAuthStore.getState().configureServer(`${originalServer}/`);
    expect(mocks.clearToken).not.toHaveBeenCalled();
    expect(mocks.clearQueries).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBe(user);
  });

  it("rejects an invalid address without disturbing the current session", async () => {
    await expect(useAuthStore.getState().configureServer("file:///tmp")).rejects.toThrow();
    expect(mocks.clearToken).not.toHaveBeenCalled();
    expect(mocks.saveServerUrl).not.toHaveBeenCalled();
  });

  it("does not switch hosts when old credentials cannot be removed", async () => {
    mocks.clearToken.mockRejectedValue(new Error("storage unavailable"));
    await expect(useAuthStore.getState().configureServer("https://new.example.test")).rejects.toThrow();
    expect(mocks.saveServerUrl).not.toHaveBeenCalled();
    expect(getCurrentServerUrl()).toBe(originalServer);
  });

  it("keeps the old origin without credentials when persisting the new origin fails", async () => {
    mocks.saveServerUrl.mockRejectedValue(new Error("storage unavailable"));
    await expect(useAuthStore.getState().configureServer("https://new.example.test")).rejects.toThrow();
    expect(getCurrentServerUrl()).toBe(originalServer);
    expect(mocks.api.setToken).toHaveBeenLastCalledWith(null);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("discards a user response from the previous server after a switch", async () => {
    let respond!: (value: User) => void;
    mocks.api.getMe.mockImplementation(() => new Promise<User>((resolve) => { respond = resolve; }));
    const initializing = useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(mocks.api.getMe).toHaveBeenCalledOnce());
    await useAuthStore.getState().configureServer("https://new.example.test");
    respond(user);
    await initializing;
    expect(useAuthStore.getState().user).toBeNull();
  });
});
