import { beforeEach, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { renderWithI18n } from "../test/i18n";
import { WorkOrdersPage } from "./work-orders-page";

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "workspace-a", slug: "team" }),
  paths: {},
}));
vi.mock("@multica/core/api", async (original) => ({
  ...await original<typeof import("@multica/core/api")>(),
  api: {
    listWorkOrders: vi.fn(), listSystemWorkspaces: vi.fn(), getWorkOrderMembers: vi.fn(),
    getWorkOrder: vi.fn(), getWorkOrderOptions: vi.fn(),
  },
}));
vi.mock("./queries", () => ({ useVersionChoices: () => ({ data: [] }) }));
vi.mock("../layout/page-header", () => ({ CollapsedNavTrigger: () => null }));
vi.mock("../system-management/system-management-layout", () => ({
  SystemManagementLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../navigation", () => ({ AppLink: () => null }));
vi.mock("./work-order-settings", () => ({ WorkOrderSettings: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listWorkOrders).mockResolvedValue({ orders: [], total: 0, canManage: true, pageSize: 20 });
  vi.mocked(api.listSystemWorkspaces).mockResolvedValue([]);
  vi.mocked(api.getWorkOrderMembers).mockResolvedValue({ members: [] });
  vi.mocked(api.getWorkOrderOptions).mockResolvedValue({ projects: [], squads: [] });
});

function renderPage(system = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderWithI18n(
    <QueryClientProvider client={client}><WorkOrdersPage system={system} embedded /></QueryClientProvider>,
    { locale: "zh-Hans" },
  );
}

it("keeps mine first and selected by default, then switches scope and resets pagination", async () => {
  vi.mocked(api.listWorkOrders).mockResolvedValue({ orders: [], total: 120, canManage: true, pageSize: 20 });
  const user = userEvent.setup();
  renderPage();
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["我的待办", "全部工单"]);
  expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(api.listWorkOrders).toHaveBeenCalledWith(
    { wsId: "workspace-a", system: false }, false, "", 1,
  ));
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(api.listWorkOrders).toHaveBeenLastCalledWith(
    { wsId: "workspace-a", system: false }, false, "", 2,
  ));
  await user.click(screen.getByRole("tab", { name: "全部工单" }));
  await waitFor(() => expect(api.listWorkOrders).toHaveBeenLastCalledWith(
    { wsId: "workspace-a", system: false }, true, "", 1,
  ));
});

it("defaults the system page to mine as well", () => {
  renderPage(true);
  expect(screen.getByRole("tab", { name: "我的待办" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "全部工单" })).toHaveAttribute("aria-selected", "false");
});

it("preserves the all-orders permission without hiding the tab layout", async () => {
  vi.mocked(api.listWorkOrders).mockResolvedValue({ orders: [], total: 0, canManage: false, pageSize: 20 });
  renderPage();
  await screen.findByText("暂无工单");
  expect(screen.getByRole("tab", { name: "我的待办" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "全部工单" })).toHaveAttribute("aria-disabled", "true");
});

it("queries the backend from page one when the keyword changes and keeps it when paging", async () => {
  vi.mocked(api.listWorkOrders).mockResolvedValue({ orders: [], total: 21, canManage: true, pageSize: 20 });
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole("tab", { name: "全部工单" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled());
  await user.type(screen.getByRole("textbox"), "ECM");
  await waitFor(() => expect(api.listWorkOrders).toHaveBeenLastCalledWith(
    { wsId: "workspace-a", system: false }, true, "ECM", 1,
  ));
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(api.listWorkOrders).toHaveBeenLastCalledWith(
    { wsId: "workspace-a", system: false }, true, "ECM", 2,
  ));
});

it("loads the full work order only when opening it, not from the list summary", async () => {
  const order = {
    id: "order-a", workspaceId: "workspace-a", source: "mis", externalId: "OC-1",
    title: "Repair", description: "", sourceStatus: "", sourceProduct: "", sourceVersion: "",
    sourceProject: "", sourceBranch: "", productVersionId: "", customerProjectId: "",
    assigneeId: "", draft: "", branchOverrides: {}, stage: "pending", issueId: "",
    executionPlan: null, updatedAt: "",
  };
  vi.mocked(api.listWorkOrders).mockResolvedValue({ orders: [order], total: 1, canManage: true, pageSize: 20 });
  vi.mocked(api.getWorkOrder).mockResolvedValue({
    order: { ...order, description: "Full original content", draft: "Existing draft" }, events: [],
  });
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole("button", { name: "Repair" });
  expect(api.getWorkOrder).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Repair" }));
  expect(await screen.findByText("Full original content")).toBeVisible();
  expect(screen.getByDisplayValue("Existing draft")).toBeVisible();
});
