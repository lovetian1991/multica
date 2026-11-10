// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { GetKBFoldersResponse, KBFolder, Product, ProductVersion } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { TaskProductFolderPicker } from "./task-product-folder-picker";

const PRODUCT: Product = {
  id: "product-1",
  name: "OpenContent智能文档云",
  description: "",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const VERSION: ProductVersion = {
  id: "version-1",
  product_id: PRODUCT.id,
  name: "V9.1.0.0",
  directory: "",
  remark: "",
  folder_id: "root-1",
  enabled: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function folder(id: string, name: string): KBFolder {
  return { id, name, folderPath: `/${name}`, parentId: "root-1" };
}

const PAGE_ONE = [folder("1413916", "base增加元数据类别管理"), folder("1413917", "CAD专业图纸")];
const PAGE_TWO = [folder("1413943", "help文档需要鉴权"), folder("1413947", "KM缺陷修复")];
const PAGE_THREE = [folder("1413944", "SDK APIKEY安全性")];
const PAGE_FOUR = [folder("1413928", "markdown1M以上文件卡顿")];

const listProductVersionFolders = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", () => ({
  api: {
    listProducts: vi.fn(),
    listSystemProductVersions: vi.fn(),
    listProductVersionFolders: (...args: unknown[]) => listProductVersionFolders(...args),
  },
}));

vi.mock("@multica/core/products/queries", () => ({
  productListOptions: () => ({
    queryKey: ["products", "list"],
    queryFn: async () => [PRODUCT],
  }),
}));

vi.mock("@multica/core/product-versions/queries", () => ({
  productVersionListOptions: (productId: string) => ({
    queryKey: ["product-versions", productId, "list"],
    queryFn: async () => (productId ? [VERSION] : []),
    enabled: Boolean(productId),
  }),
}));

function pageResponse(folders: KBFolder[], totalCount: number): GetKBFoldersResponse {
  return { folders, totalCount, currentFolder: null };
}

function renderPicker(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithI18n(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

async function openPicker() {
  renderPicker(
    <TaskProductFolderPicker
      onConfirm={() => {}}
      triggerRender={<button type="button">Open catalog</button>}
    />,
  );
  fireEvent.click(screen.getByText("Open catalog"));
  await screen.findByText(PRODUCT.name);
  fireEvent.click(screen.getByText(PRODUCT.name));
  await screen.findByText(VERSION.name);
  fireEvent.click(screen.getByText(VERSION.name));
  await screen.findByText(PAGE_ONE[0]!.name);
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  listProductVersionFolders.mockReset();
  listProductVersionFolders.mockImplementation((_productId: string, _versionId: string, pageIndex = 1) => {
    if (pageIndex === 1) return Promise.resolve(pageResponse(PAGE_ONE, 7));
    if (pageIndex === 2) return Promise.resolve(pageResponse(PAGE_TWO, 7));
    if (pageIndex === 3) return Promise.resolve(pageResponse(PAGE_THREE, 7));
    return Promise.resolve(pageResponse(PAGE_FOUR, 7));
  });
});

describe("TaskProductFolderPicker folder search", () => {
  // Regression: the folder list used to come from the system administrator
  // endpoint, so an ordinary member got an empty list where the server had
  // answered 403.
  it("reads folders through the product version, not the admin endpoint", async () => {
    await openPicker();

    expect(listProductVersionFolders).toHaveBeenCalledTimes(1);
    expect(listProductVersionFolders).toHaveBeenCalledWith(PRODUCT.id, VERSION.id, 1);
  });

  it("filters the loaded folders on the client without fetching", async () => {
    await openPicker();
    expect(listProductVersionFolders).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText("Search folders..."), "CAD");

    expect(screen.getByText("CAD专业图纸")).toBeTruthy();
    expect(screen.queryByText("base增加元数据类别管理")).toBeNull();
    expect(listProductVersionFolders).toHaveBeenCalledTimes(1);
  });

  it("auto-loads up to two extra pages when the loaded pages have no match", async () => {
    await openPicker();

    fireEvent.change(screen.getByLabelText("Search folders..."), {
      target: { value: "SDK" },
    });

    await screen.findByText("SDK APIKEY安全性");
    expect(listProductVersionFolders.mock.calls.map((call) => call[2])).toEqual([1, 2, 3]);
  });

  it("stops after two extra pages and lets the user load more by hand", async () => {
    await openPicker();

    fireEvent.change(screen.getByLabelText("Search folders..."), {
      target: { value: "markdown" },
    });

    expect(await screen.findByText("No matches on the loaded pages")).toBeTruthy();
    await waitFor(() => expect(listProductVersionFolders).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("markdown1M以上文件卡顿");
    expect(listProductVersionFolders).toHaveBeenCalledTimes(4);
  });

  it("does not offer load more when every page is already loaded", async () => {
    listProductVersionFolders.mockImplementation((_productId: string, _versionId: string, pageIndex = 1) => {
      if (pageIndex === 1) return Promise.resolve(pageResponse(PAGE_ONE, 2));
      return Promise.resolve(pageResponse([], 2));
    });
    await openPicker();

    fireEvent.change(screen.getByLabelText("Search folders..."), {
      target: { value: "markdown" },
    });

    expect(await screen.findByText("No matching folders")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(listProductVersionFolders).toHaveBeenCalledTimes(1);
  });
});
