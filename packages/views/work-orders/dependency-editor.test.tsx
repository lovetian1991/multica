import { beforeEach, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { renderWithI18n } from "../test/i18n";
import { DependencyEditor } from "./dependency-editor";

vi.mock("@multica/core/api", async (original) => ({
  ...await original<typeof import("@multica/core/api")>(),
  api: { listSystemProducts: vi.fn(), listSystemProductVersions: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listSystemProducts).mockResolvedValue({
    products: [{ id: "ecm", name: "ECM", slug: "ecm", description: "", created_at: "", updated_at: "" }], total: 1,
  });
  vi.mocked(api.listSystemProductVersions).mockResolvedValue({ versions: [], total: 0 });
});

it("refetches dependency choices cached before the catalog changed", async () => {
  const user = userEvent.setup();
  vi.mocked(api.listSystemProducts).mockResolvedValue({
    products: [
      { id: "ecm", name: "ECM", slug: "ecm", description: "", created_at: "", updated_at: "" },
      { id: "cms", name: "CMS", slug: "cms", description: "", created_at: "", updated_at: "" },
    ],
    total: 2,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  // The editor was opened while the catalog held no other product.
  qc.setQueryData(["work-order-dependency-choices"], []);
  renderWithI18n(<QueryClientProvider client={qc}>
    <DependencyEditor productId="ecm" dependencies={[]} onChange={vi.fn()} onEditVersion={vi.fn()} disabled={false} />
  </QueryClientProvider>, { locale: "zh-Hans" });
  const add = screen.getByRole("button", { name: "添加依赖" });
  await waitFor(() => expect(api.listSystemProducts).toHaveBeenCalled());
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
  await waitFor(() => expect(screen.queryByText("没有其他可选产品", { exact: true })).not.toBeInTheDocument());
});

it("offers dependency creation even when the current product is the only product", async () => {
  const user = userEvent.setup();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  renderWithI18n(<QueryClientProvider client={qc}>
    <DependencyEditor productId="ecm" dependencies={[]} onChange={vi.fn()} onEditVersion={vi.fn()} disabled={false} />
  </QueryClientProvider>, { locale: "zh-Hans" });
  const add = screen.getByRole("button", { name: "添加依赖" });
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
  expect(screen.getByText("没有其他可选产品", { exact: true })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "新建产品" }));
  expect(await screen.findByRole("dialog", { name: "新建产品" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "产品英文标识" })).toBeVisible();
});
