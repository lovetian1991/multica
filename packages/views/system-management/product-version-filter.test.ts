// @vitest-environment node

import { describe, expect, it } from "vitest";
import { filterProductVersions } from "./product-version-filter";

const versions = [
  { name: "V9.1.0.0", directory: "docs", remark: "stable", enabled: true },
  { name: "V8.0.0.0", directory: "legacy", remark: "retired", enabled: false },
  { name: "hotfix", directory: "docs", remark: "", enabled: true },
];

describe("filterProductVersions", () => {
  it("returns every version when the query and status are open", () => {
    expect(filterProductVersions(versions, "", "all")).toEqual(versions);
  });

  it("keeps only enabled or disabled versions", () => {
    expect(filterProductVersions(versions, "", "enabled").map((version) => version.name)).toEqual([
      "V9.1.0.0",
      "hotfix",
    ]);
    expect(filterProductVersions(versions, "", "disabled").map((version) => version.name)).toEqual([
      "V8.0.0.0",
    ]);
  });

  it("applies the search query on top of the status filter", () => {
    expect(filterProductVersions(versions, "docs", "enabled").map((version) => version.name)).toEqual([
      "V9.1.0.0",
      "hotfix",
    ]);
    expect(filterProductVersions(versions, "v8", "all").map((version) => version.name)).toEqual([
      "V8.0.0.0",
    ]);
    expect(filterProductVersions(versions, "v8", "enabled")).toEqual([]);
  });
});
