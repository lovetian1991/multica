// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OCConnectionSchema } from "./schemas";
import { parseWithFallback } from "./schema";

describe("OC connection response", () => {
  it("excludes tokens and defaults missing connection status to false", () => {
    expect(OCConnectionSchema.parse({ connected: true, token: "never expose" })).toEqual({ connected: true });
    expect(OCConnectionSchema.parse({})).toEqual({ connected: false });
  });

  it("does not treat malformed responses as a successful connection", () => {
    expect(parseWithFallback({ connected: "true" }, OCConnectionSchema, { connected: false }, { endpoint: "POST /api/workspaces/:id/oc/check" })).toEqual({ connected: false });
  });
});
