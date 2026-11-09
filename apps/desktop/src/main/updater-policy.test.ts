// @vitest-environment node
import { expect, it } from "vitest";
import { DISABLE_UPDATES } from "./updater-policy";

it("disables the public update feed for self-hosted builds", () => {
  expect(DISABLE_UPDATES).toBe(true);
});
