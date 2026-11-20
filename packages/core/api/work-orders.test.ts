// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
import { OrderSchema, PlanSchema, VersionCodeSchema, codeToWire, orderEndpoint } from "../work-orders/schema";
import { ProductSchema } from "./schemas";

const client = new ApiClient("https://api.example.test");
const target = { wsId: "workspace-a", system: true };
const wireOrder = {
  id: "order-a", workspace_id: target.wsId, source: "mis", external_id: "123",
  title: "Repair old product", description: "Original", source_status: "open",
  source_product: "ECM", source_version: "6", source_project: "", source_branch: "",
  product_version_id: "", customer_project_id: "", assignee_id: "user-a", draft: "",
  stage: "future-stage", issue_id: "", updated_at: "2026-11-13T00:00:00Z",
};
function reply(body: unknown, status = 200) {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

it("reports missing dependency repositories and accepts older baselines without diagnostics", async () => {
  const plan = { version_id: "v", kb_root_id: "", repos: [] };
  reply(plan);
  expect((await client.getWorkOrderProjectBaseline(null, "v"))?.missingVersions).toEqual([]);
  reply({ ...plan, missing_versions: [{ version_id: "dep-v", product_id: "dep", product_name: "Low code", version_name: "v6" }] });
  expect((await client.getWorkOrderProjectBaseline(null, "v"))?.missingVersions).toEqual([
    { versionId: "dep-v", productId: "dep", productName: "Low code", versionName: "v6" },
  ]);
  for (const missing of ["invalid", [{ version_id: "dep-v" }]]) {
    reply({ ...plan, missing_versions: missing });
    expect(await client.getWorkOrderProjectBaseline(null, "v")).toBeNull();
  }
});

it("creates, renames and deletes shared projects without workspace context and validates mutation responses", async () => {
  const created = reply({ id: "customer", name: "Acme", purpose: "customer" });
  expect(await client.createCustomerProject("Acme")).toMatchObject({ id: "customer", name: "Acme", productVersionId: "" });
  expect(created.mock.calls[0]?.[0]).toBe("https://api.example.test/api/system/work-orders/projects");
  expect(created.mock.calls[0]?.[1].method).toBe("POST");
  expect(JSON.parse(created.mock.calls[0]?.[1].body)).toEqual({ name: "Acme" });
  const renamed = reply({ id: "customer", name: "Acme II", product_version_id: "v1" });
  expect(await client.renameCustomerProject("p / q", "Acme II")).toMatchObject({ name: "Acme II", productVersionId: "v1" });
  expect(renamed.mock.calls[0]?.[0]).toBe("https://api.example.test/api/system/work-orders/projects/p%20%2F%20q");
  expect(renamed.mock.calls[0]?.[1].method).toBe("PATCH");
  expect(JSON.parse(renamed.mock.calls[0]?.[1].body)).toEqual({ name: "Acme II" });
  const deleted = reply({ saved: true });
  expect(await client.deleteCustomerProject("p & q")).toEqual({ saved: true });
  expect(deleted.mock.calls[0]?.[0]).toBe("https://api.example.test/api/system/work-orders/projects/p%20%26%20q");
  expect(deleted.mock.calls[0]?.[1].method).toBe("DELETE");
  reply({ id: "partial" });
  expect(await client.createCustomerProject("Acme")).toBeNull();
  expect(await client.renameCustomerProject("customer", "Acme")).toBeNull();
  reply({ saved: "true" });
  expect(await client.deleteCustomerProject("customer")).toEqual({ saved: false });
  reply({ error: "referenced" }, 409);
  await expect(client.deleteCustomerProject("customer")).rejects.toMatchObject({ status: 409 });
});

it("scopes system requests explicitly and encodes identifiers", () => {
  expect(orderEndpoint(target, "/settings")).toBe("/api/system/work-orders/settings?workspace_id=workspace-a");
  expect(orderEndpoint({ wsId: "a" })).toBe("/api/work-orders");
});

it("maintains the global customer catalog without workspace parameters and rejects malformed responses", async () => {
  const list = reply({ projects: [{ id: "customer", name: "Shared", purpose: "customer", product_version_id: "v" }] });
  expect((await client.listCustomerProjects()).projects[0]).toMatchObject({ id: "customer", productVersionId: "v" });
  expect(list.mock.calls[0]?.[0]).toBe("https://api.example.test/api/system/work-orders/projects");
  const branches = reply({ bindings: [], resources: [] });
  await client.getWorkOrderBranches(null, "p & q");
  expect(branches.mock.calls[0]?.[0]).toBe("https://api.example.test/api/system/work-orders/branches?project_id=p+%26+q");
  const baseline = reply({});
  expect(await client.getWorkOrderProjectBaseline(null, "v")).toBeNull();
  expect(baseline.mock.calls[0]?.[0]).not.toContain("workspace_id");
  const save = reply({ saved: true });
  expect(await client.saveWorkOrderProject(null, "p", "v", {})).toEqual({ saved: true });
  expect(save.mock.calls[0]?.[0]).toBe("https://api.example.test/api/system/work-orders/projects");
  reply({ projects: "invalid" });
  expect(await client.listCustomerProjects()).toEqual({ projects: [], squads: [] });
  reply({ saved: "true" });
  expect(await client.saveWorkOrderProject(null, "p", "v", {})).toEqual({ saved: false });
});

it("parses personal inventories and preserves unknown future stages", async () => {
  const fetcher = reply({ orders: [wireOrder], total: 1, can_manage: false });
  const result = await client.listWorkOrders(target, false, "old & new");
  expect(result.orders[0]).toMatchObject({ workspaceId: target.wsId, stage: "future-stage", branchOverrides: {}, executionPlan: null });
  expect(fetcher.mock.calls[0]?.[0]).toContain("workspace_id=workspace-a");
  expect(fetcher.mock.calls[0]?.[0]).toContain("all=false");
  expect(fetcher.mock.calls[0]?.[0]).toContain("search=old+%26+new");
  expect(result.pageSize).toBe(50);
});

it("uses server pagination metadata and sends search with the requested page", async () => {
  const fetcher = reply({ orders: [wireOrder], total: 21, can_manage: true, page_size: 20 });
  expect((await client.listWorkOrders(target, true, "ECM & OC", 2)).pageSize).toBe(20);
  const url = new URL(fetcher.mock.calls[0]?.[0]);
  expect(url.searchParams.get("page")).toBe("2");
  expect(url.searchParams.get("page_size")).toBe("20");
  expect(url.searchParams.get("summary")).toBe("true");
  expect(url.searchParams.get("search")).toBe("ECM & OC");
  for (const size of [0, -1, 1.5, 101, "20"]) {
    reply({ orders: [wireOrder], total: 21, page_size: size });
    expect((await client.listWorkOrders(target)).orders).toEqual([]);
  }
});

it("degrades malformed reads without granting administrative controls", async () => {
  reply({ orders: [{ id: "partial" }], total: 1, can_manage: true });
  expect(await client.listWorkOrders(target)).toEqual({ orders: [], total: 0, canManage: false, pageSize: 50 });
  reply({ projects: [{ id: "partial" }], squads: "bad" });
  expect(await client.getWorkOrderOptions(target)).toEqual({ projects: [], squads: [] });
  reply({ bindings: null, resources: "bad" });
  expect(await client.getWorkOrderBranches(target, "project")).toEqual({ bindings: [], resources: [] });
  reply({ order: {}, events: [] });
  expect(await client.getWorkOrder(target, "a")).toBeNull();
});

it("sends local edits and concurrency token without overwriting source content", async () => {
  const fetcher = reply(wireOrder);
  const order = OrderSchema.parse(wireOrder);
  await client.saveWorkOrder(target, { ...order, draft: "Fix", branchOverrides: { "v/api": "fix/123" } });
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
    assignee_id: "user-a", product_version_id: "", customer_project_id: "",
    draft: "Fix", stage: "future-stage", branch_overrides: { "v/api": "fix/123" },
    updated_at: wireOrder.updated_at,
  });
  reply({});
  expect(await client.saveWorkOrder(target, order)).toBeNull();
  expect(await client.convertWorkOrder(target, order.id)).toEqual({ issueId: "" });
  expect(await client.syncWorkOrders(target)).toBeNull();
});

it("retains usable options, branch bindings, images and concrete dependency versions", async () => {
  reply({ bindings: [{ version_id: "v", module_key: "api", resource_id: "r" }], resources: [{ id: "r", repo_url: "https://git.test/a", ref: "legacy" }] });
  expect(await client.getWorkOrderBranches(target, "p")).toEqual({
    bindings: [{ versionId: "v", moduleKey: "api", resourceId: "r" }],
    resources: [{ id: "r", repoUrl: "https://git.test/a", ref: "legacy" }],
  });
  reply({ modules: [{ key: "api", repo_url: "ssh://git@git.test/team/api", ref: "v6",
    images: [{ service: "api", image: "registry.test/api@sha256:123", ci_url: "https://ci.test/1" }] }],
  dependencies: ["base-v3"] });
  const code = await client.getVersionCode("p", "v");
  expect(code.dependencies).toEqual(["base-v3"]);
  expect(code.modules[0]?.directory).toBe("");
  expect(codeToWire(code).modules[0]?.images[0]).toMatchObject({ ci_url: "https://ci.test/1" });
  reply({ error: "forbidden" }, 403);
  await expect(client.listWorkOrders(target, true)).rejects.toThrow();
});

it("round-trips checkout directories separately from existing repository subpaths", async () => {
  const wire = { modules: [{ key: "main", repo_url: "https://git.test/ecm", ref: "v6", directory: "backend", subpath: "src" }], dependencies: [] };
  const code = VersionCodeSchema.parse(wire);
  expect(code.modules[0]).toMatchObject({ directory: "backend", subpath: "src" });
  expect(codeToWire(code).modules[0]).toMatchObject({ directory: "backend", subpath: "src" });
  reply({ ...wire, modules: [{ ...wire.modules[0], directory: 42 }] });
  expect(await client.getVersionCode("p", "v")).toEqual({ modules: [], dependencies: [], compose: "" });
});

it("reads product identifiers without breaking older or malformed product responses", () => {
  const product = { id: "p", name: "ECM", description: "", created_at: "", updated_at: "" };
  expect(ProductSchema.parse(product).slug).toBe("");
  expect(ProductSchema.parse({ ...product, slug: "ecm" }).slug).toBe("ecm");
  expect(ProductSchema.parse({ ...product, slug: 42 }).slug).toBe("");
});

it("does not report malformed configuration saves as successful", async () => {
  reply({});
  expect(await client.saveWorkOrderRoot("root")).toBeNull();
  expect(await client.saveWorkOrderSettings(target, {
    executionProjectId: "project", squadId: "", misUrl: "", misCredentialsConfigured: false,
  })).toBeNull();
  expect(await client.saveVersionCode("product", "version", { modules: [], dependencies: [], compose: "" })).toBeNull();
});

it("keeps historical module instructions in plans and accepts older plans without remarks", () => {
  const repo = {
    version_id: "v", product_id: "p", module_key: "api", name: "API",
    repo_url: "https://git.test/api", ref: "legacy", subpath: "", directory: "p/api",
    kb_path: "p/v/api/legacy", ref_source: "baseline",
  };
  const plan = { version_id: "v", kb_root_id: "root", repos: [repo] };
  expect(PlanSchema.parse(plan).repos[0]?.remark).toBe("");
  expect(PlanSchema.parse(plan).repos[0]).toMatchObject({ versionName: "", baseRef: "" });
  expect(PlanSchema.parse({ ...plan, repos: [{ ...repo, remark: "Use the legacy CI." }] }).repos[0]?.remark)
    .toBe("Use the legacy CI.");
  expect(PlanSchema.parse({ ...plan, repos: [{ ...repo, version_name: "V1", base_ref: "main" }] }).repos[0])
    .toMatchObject({ versionName: "V1", baseRef: "main" });
});

it("reads project branches for a product version and falls back for malformed responses", async () => {
  reply({
    total: 1,
    projects: [{
      id: "project", name: "Acme",
      branches: [{ version_id: "v", version_name: "V1", product_name: "ECM", module_key: "api", repo_url: "https://git.test/api", ref: "proj/acme-v1" }],
    }],
  });
  expect((await client.getWorkOrderVersionBranches("v")).projects[0]).toEqual({
    id: "project", name: "Acme",
    branches: [{ versionId: "v", versionName: "V1", productName: "ECM", moduleKey: "api", repoUrl: "https://git.test/api", ref: "proj/acme-v1" }],
  });
  const fetch = reply({ projects: "bad" });
  expect((await client.getWorkOrderVersionBranches("v")).projects).toEqual([]);
  expect(fetch.mock.calls[0]?.[0]).toBe("https://api.example.test/api/system/work-orders/version-branches?version_id=v");
});

it("reads project version bindings while remaining compatible with older option responses", async () => {
  reply({ projects: [{ id: "p", name: "Customer" }] });
  expect((await client.getWorkOrderOptions(target)).projects[0]).toEqual({
    id: "p", name: "Customer", productId: "", productVersionId: "", purpose: "",
  });
  reply({ projects: [{ id: "p", name: "Customer", product_id: "product", product_version_id: "v", purpose: "execution" }] });
  expect((await client.getWorkOrderOptions(target)).projects[0]).toMatchObject({
    productId: "product", productVersionId: "v", purpose: "execution",
  });
});

it("persists confirmed project configuration with a concurrency token and explicit branch opt-in", async () => {
  const fetcher = reply(wireOrder);
  await client.registerWorkOrderProject(target, OrderSchema.parse(wireOrder), "Customer", true);
  expect(fetcher.mock.calls[0]?.[0]).toContain("/order-a/project?workspace_id=workspace-a");
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
    name: "Customer", remember_refs: true, updated_at: wireOrder.updated_at,
  });
  reply({});
  expect(await client.registerWorkOrderProject(target, OrderSchema.parse(wireOrder), "Customer", false)).toBeNull();
  expect(await client.getWorkOrderProjectBaseline(target, "v")).toBeNull();
  expect(await client.saveWorkOrderProject(target, "p", "v", {})).toEqual({ saved: false });
  const save = reply({ saved: true });
  expect(await client.saveWorkOrderProject(target, "p", "v", { "v/api": "customer/v6" })).toEqual({ saved: true });
  expect(JSON.parse(save.mock.calls[0]?.[1].body)).toEqual({
    project_id: "p", version_id: "v", refs: { "v/api": "customer/v6" },
  });
});
