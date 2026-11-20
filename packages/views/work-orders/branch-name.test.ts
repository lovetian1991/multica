// @vitest-environment node
import { describe, expect, it } from "vitest";
import { projectBranchName } from "./branch-name";

describe("projectBranchName", () => {
  it("transliterates Chinese project names and keeps version names", () => {
    expect(projectBranchName("中石化", "V1.2")).toBe("proj-zhong-shi-hua-v1.2");
  });

  it("transliterates non-ASCII version names", () => {
    expect(projectBranchName("ECM", "标准版")).toBe("proj-ecm-biao-zhun-ban");
  });

  it("removes characters that are invalid in git refs", () => {
    expect(projectBranchName("ACME / 华东", "v 2.0")).toBe("proj-acme-hua-dong-v-2.0");
  });

  it("falls back for empty segments", () => {
    expect(projectBranchName("", "")).toBe("proj-x-x");
  });
});
