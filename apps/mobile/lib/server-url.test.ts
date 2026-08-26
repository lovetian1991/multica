import { beforeEach, describe, expect, it } from "vitest";
import {
  normalizeServerUrl,
  setCurrentServerUrl,
  toWebSocketUrl,
} from "./server-url";

describe("normalizeServerUrl", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizeServerUrl("  http://192.168.11.173:30080///  ")).toBe(
      "http://192.168.11.173:30080",
    );
  });

  it("preserves a path prefix", () => {
    expect(normalizeServerUrl("https://example.test/multica/")).toBe(
      "https://example.test/multica",
    );
  });

  it.each([
    "",
    "192.168.11.173:30080",
    "ftp://example.test",
    "https://user:pass@example.test",
    "https://example.test?tenant=one",
    "https://example.test#api",
  ])("rejects invalid server address %j", (value) => {
    expect(() => normalizeServerUrl(value)).toThrow();
  });
});

describe("toWebSocketUrl", () => {
  it("maps http to ws", () => {
    expect(toWebSocketUrl("http://192.168.11.173:30080")).toBe(
      "ws://192.168.11.173:30080/ws",
    );
  });

  it("maps https to wss and keeps a path prefix", () => {
    expect(toWebSocketUrl("https://example.test/multica")).toBe(
      "wss://example.test/multica/ws",
    );
  });
});

describe("runtime server selection", () => {
  beforeEach(() => {
    setCurrentServerUrl("https://api.example.test");
  });

  it("normalizes the value when switching servers", () => {
    expect(setCurrentServerUrl("http://localhost:8080/")).toBe(
      "http://localhost:8080",
    );
  });
});
