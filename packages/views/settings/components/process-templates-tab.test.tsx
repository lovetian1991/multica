// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSettings from "../../locales/en/settings.json";

const mockApply = vi.hoisted(() => vi.fn());
const mockUpgrade = vi.hoisted(() => vi.fn());

const data = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  isLoading: false,
  error: null as Error | null,
  role: "owner" as "owner" | "admin" | "member",
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: data.templates,
    isLoading: data.isLoading,
    error: data.error,
  }),
}));

vi.mock("@multica/core/process-templates", () => ({
  workspaceProcessTemplateListOptions: () => ({
    queryKey: ["process-templates", "workspace", "list"],
  }),
  useApplyWorkspaceProcessTemplate: () => ({
    mutate: mockApply,
    isPending: false,
    variables: undefined,
  }),
  useUpgradeWorkspaceProcessTemplate: () => ({
    mutate: mockUpgrade,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "workspace-1", name: "Acme", slug: "acme" }),
}));

vi.mock("@multica/core/permissions", () => ({
  useCurrentMember: () => ({ role: data.role, isLoading: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProcessTemplatesTab } from "./process-templates-tab";

const TEST_RESOURCES = {
  en: { common: enCommon, settings: enSettings },
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

function template(over: Record<string, unknown> = {}) {
  return {
    id: "tpl-1",
    slug: "dev-squad",
    name: "Development squad",
    description: "Agents, squads, and skills for delivery.",
    created_at: "2026-09-18T00:00:00Z",
    updated_at: "2026-09-18T00:00:00Z",
    latest_version: {
      id: "ver-2",
      version: 2,
      checksum: "abc",
      file_name: "dev.zip",
      file_size: 12,
      created_at: "2026-09-18T00:00:00Z",
    },
    installed: false,
    can_upgrade: false,
    ...over,
  };
}

describe("ProcessTemplatesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data.role = "owner";
    data.isLoading = false;
    data.error = null;
    data.templates = [template()];
  });

  it("lets owners apply a template that is not installed", async () => {
    const user = userEvent.setup();
    render(<ProcessTemplatesTab />, { wrapper: Wrapper });

    expect(screen.getByText("Development squad")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apply/ }));
    expect(mockApply).toHaveBeenCalledWith("tpl-1", expect.any(Object));
    expect(mockUpgrade).not.toHaveBeenCalled();
  });

  it("lets owners upgrade an installed template", async () => {
    const user = userEvent.setup();
    data.templates = [
      template({
        installed: true,
        can_upgrade: true,
        installed_version: {
          id: "ver-1",
          version: 1,
          checksum: "old",
          file_name: "dev.zip",
          file_size: 10,
          created_at: "2026-09-01T00:00:00Z",
        },
      }),
    ];
    render(<ProcessTemplatesTab />, { wrapper: Wrapper });

    expect(screen.getByText("Installed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Upgrade/ }));
    expect(mockUpgrade).toHaveBeenCalledWith("tpl-1", expect.any(Object));
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("hides apply and upgrade from a plain member", () => {
    data.role = "member";
    data.templates = [template({ installed: false, can_upgrade: true })];
    render(<ProcessTemplatesTab />, { wrapper: Wrapper });

    expect(screen.getByText("Development squad")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(
      screen.getByText(/Only workspace owners and admins/),
    ).toBeInTheDocument();
  });

  it("renders an empty catalog", () => {
    data.templates = [];
    render(<ProcessTemplatesTab />, { wrapper: Wrapper });
    expect(screen.getByText("No process templates yet")).toBeInTheDocument();
  });
});
