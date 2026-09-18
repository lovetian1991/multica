// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  FOLDER_SEARCH_AUTO_LOAD_DELAY_MS,
  FOLDER_SEARCH_AUTO_LOAD_PAGES,
  filterFoldersByQuery,
  folderMatchesQuery,
  folderSearchAutoLoadDelayMs,
  shouldAutoLoadMoreFolders,
} from "./task-product-folder-search";

const folders = [
  { id: "1413916", name: "base增加元数据类别管理" },
  { id: "1413947", name: "KM缺陷修复" },
  { id: "1424304", name: "anydoc集成" },
];

describe("folderMatchesQuery", () => {
  it("matches a case-insensitive name substring", () => {
    expect(folderMatchesQuery(folders[1]!, "km缺陷")).toBe(true);
    expect(folderMatchesQuery(folders[1]!, "KM缺陷")).toBe(true);
    expect(folderMatchesQuery(folders[1]!, "不存在")).toBe(false);
  });

  it("matches a folder id", () => {
    expect(folderMatchesQuery(folders[0]!, "1413916")).toBe(true);
    expect(folderMatchesQuery(folders[0]!, "1413")).toBe(true);
  });

  it("treats a blank query as a match so the unfiltered list stays intact", () => {
    expect(folderMatchesQuery(folders[0]!, "   ")).toBe(true);
  });
});

describe("filterFoldersByQuery", () => {
  it("returns the original list when the query is empty", () => {
    expect(filterFoldersByQuery(folders, "")).toBe(folders);
  });

  it("keeps only matching folders", () => {
    expect(filterFoldersByQuery(folders, "集成").map((folder) => folder.id)).toEqual(["1424304"]);
  });
});

describe("shouldAutoLoadMoreFolders", () => {
  const ready = {
    query: "KM",
    matchCount: 0,
    loadedCount: 10,
    totalCount: 40,
    autoLoadedPages: 0,
    loading: false,
  };

  it("auto-loads when the loaded pages have no match and more pages exist", () => {
    expect(shouldAutoLoadMoreFolders(ready)).toBe(true);
  });

  it("stops after the auto-load budget", () => {
    expect(shouldAutoLoadMoreFolders({
      ...ready,
      autoLoadedPages: FOLDER_SEARCH_AUTO_LOAD_PAGES,
    })).toBe(false);
  });

  it("does not auto-load when the current pages already match", () => {
    expect(shouldAutoLoadMoreFolders({ ...ready, matchCount: 1 })).toBe(false);
  });

  it("does not auto-load a single-page result set", () => {
    expect(shouldAutoLoadMoreFolders({ ...ready, loadedCount: 10, totalCount: 10 })).toBe(false);
  });

  it("does not auto-load while a fetch is in flight or the query is empty", () => {
    expect(shouldAutoLoadMoreFolders({ ...ready, loading: true })).toBe(false);
    expect(shouldAutoLoadMoreFolders({ ...ready, query: "  " })).toBe(false);
    expect(shouldAutoLoadMoreFolders({ ...ready, loadedCount: 0 })).toBe(false);
  });
});

describe("folderSearchAutoLoadDelayMs", () => {
  it("debounces only the first extra page of a query", () => {
    expect(folderSearchAutoLoadDelayMs(0)).toBe(FOLDER_SEARCH_AUTO_LOAD_DELAY_MS);
    expect(folderSearchAutoLoadDelayMs(1)).toBe(0);
  });
});
