import { z } from "zod";

export const ImageSchema = z.object({
  service: z.string(), image: z.string(), ci_url: z.string().default(""),
}).transform((v) => ({ service: v.service, image: v.image, ciUrl: v.ci_url }));
export const ModuleSchema = z.object({
  key: z.string(), name: z.string().default(""), repo_url: z.string(), ref: z.string(),
  directory: z.string().default(""), subpath: z.string().default(""), remark: z.string().default(""),
  images: z.array(ImageSchema).nullish().transform((v) => v ?? []),
}).transform((v) => ({
  key: v.key, name: v.name, repoUrl: v.repo_url, ref: v.ref,
  directory: v.directory, subpath: v.subpath, remark: v.remark, images: v.images,
}));
export const VersionCodeSchema = z.object({
  modules: z.array(ModuleSchema).nullable().transform((v) => v ?? []),
  dependencies: z.array(z.string()).nullish().transform((v) => v ?? []),
  compose: z.string().default(""),
});
export type VersionCode = z.output<typeof VersionCodeSchema>;
export type CodeModule = VersionCode["modules"][number];
export const EMPTY_CODE: VersionCode = { modules: [], dependencies: [], compose: "" };
export function codeToWire(code: VersionCode) {
  return {
    ...code,
    modules: code.modules.map((m) => ({
      key: m.key, name: m.name, repo_url: m.repoUrl, ref: m.ref,
      directory: m.directory, subpath: m.subpath, remark: m.remark,
      images: m.images.map((i) => ({ service: i.service, image: i.image, ci_url: i.ciUrl })),
    })),
  };
}

export const PlanSchema = z.object({
  version_id: z.string(), kb_root_id: z.string(), compose: z.string().default(""),
  missing_versions: z.array(z.object({
    version_id: z.string(), product_id: z.string(), product_name: z.string(), version_name: z.string(),
  }).transform((v) => ({
    versionId: v.version_id, productId: v.product_id, productName: v.product_name, versionName: v.version_name,
  }))).default([]),
  repos: z.array(z.object({
    version_id: z.string(), product_id: z.string(), module_key: z.string(), name: z.string(),
    version_name: z.string().default(""), base_ref: z.string().default(""),
    repo_url: z.string(), ref: z.string(), subpath: z.string(), directory: z.string(), remark: z.string().default(""),
    kb_path: z.string(), ref_source: z.string(), images: z.array(ImageSchema).nullish(),
  }).transform((v) => ({
    versionId: v.version_id, productId: v.product_id, moduleKey: v.module_key, name: v.name,
    versionName: v.version_name, baseRef: v.base_ref,
    repoUrl: v.repo_url, ref: v.ref, subpath: v.subpath, directory: v.directory, remark: v.remark,
    kbPath: v.kb_path, refSource: v.ref_source, images: v.images ?? [],
  }))),
}).transform((v) => ({ versionId: v.version_id, kbRootId: v.kb_root_id, compose: v.compose, repos: v.repos, missingVersions: v.missing_versions }));
export type WorkOrderPlan = z.output<typeof PlanSchema>;
export const OrderSchema = z.object({
  id: z.string(), workspace_id: z.string(), source: z.string(), external_id: z.string(),
  title: z.string(), description: z.string(), source_status: z.string(), source_product: z.string(),
  source_version: z.string(), source_project: z.string(), source_branch: z.string(),
  product_version_id: z.string(), customer_project_id: z.string(), assignee_id: z.string(),
  draft: z.string(), branch_overrides: z.record(z.string(), z.string()).default({}),
  stage: z.string(), issue_id: z.string(), execution_plan: PlanSchema.nullish(), updated_at: z.string(),
}).transform((v) => ({
  id: v.id, workspaceId: v.workspace_id, source: v.source, externalId: v.external_id,
  title: v.title, description: v.description, sourceStatus: v.source_status,
  sourceProduct: v.source_product, sourceVersion: v.source_version, sourceProject: v.source_project,
  sourceBranch: v.source_branch, productVersionId: v.product_version_id, customerProjectId: v.customer_project_id,
  assigneeId: v.assignee_id, draft: v.draft, branchOverrides: v.branch_overrides,
  stage: v.stage, issueId: v.issue_id, executionPlan: v.execution_plan ?? null, updatedAt: v.updated_at,
}));
export type WorkOrder = z.output<typeof OrderSchema>;
export const OrdersSchema = z.object({
  orders: z.array(OrderSchema).default([]), total: z.number().default(0), can_manage: z.boolean().default(false),
  page_size: z.number().int().min(1).max(100).default(50),
}).transform((v) => ({ orders: v.orders, total: v.total, canManage: v.can_manage, pageSize: v.page_size }));
export const MembersSchema = z.object({ members: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })) });
const NamedOptionSchema = z.object({ id: z.string(), name: z.string() });
export const CustomerProjectSchema = NamedOptionSchema.extend({
  product_id: z.string().default(""), product_version_id: z.string().default(""),
  purpose: z.string().default(""),
}).transform((v) => ({
  id: v.id, name: v.name, productId: v.product_id, productVersionId: v.product_version_id, purpose: v.purpose,
}));
export type CustomerProject = z.output<typeof CustomerProjectSchema>;
export const OrderOptionsSchema = z.object({
  projects: z.array(CustomerProjectSchema).default([]), squads: z.array(NamedOptionSchema).default([]),
});
export const OrderBranchesSchema = z.object({
  bindings: z.array(z.object({ version_id: z.string(), module_key: z.string(), resource_id: z.string() }).transform((v) => ({
    versionId: v.version_id, moduleKey: v.module_key, resourceId: v.resource_id,
  }))).default([]),
  resources: z.array(z.object({ id: z.string(), repo_url: z.string(), ref: z.string() }).transform((v) => ({
    id: v.id, repoUrl: v.repo_url, ref: v.ref,
  }))).default([]),
});
export const VersionBranchesSchema = z.object({
  projects: z.array(z.object({
    id: z.string(), name: z.string(),
    branches: z.array(z.object({
      version_id: z.string(), version_name: z.string().default(""), product_name: z.string().default(""),
      module_key: z.string(), repo_url: z.string(), ref: z.string(),
    }).transform((v) => ({
      versionId: v.version_id, versionName: v.version_name, productName: v.product_name,
      moduleKey: v.module_key, repoUrl: v.repo_url, ref: v.ref,
    }))).default([]),
  }).transform((v) => ({ id: v.id, name: v.name, branches: v.branches }))).default([]),
  total: z.number().default(0),
});
export type VersionProjectBranches = z.output<typeof VersionBranchesSchema>;
export const SyncSchema = z.object({ synced: z.number(), total: z.number(), next_page: z.number() })
  .transform((v) => ({ synced: v.synced, total: v.total, nextPage: v.next_page }));
export const SavedSchema = z.object({ saved: z.boolean() });
export const SettingsSchema = z.object({
  execution_project_id: z.string(), squad_id: z.string().default(""),
  mis_url: z.string().default(""), mis_credentials_configured: z.boolean().default(false),
}).transform((v) => ({
  executionProjectId: v.execution_project_id, squadId: v.squad_id,
  misUrl: v.mis_url, misCredentialsConfigured: v.mis_credentials_configured,
}));
export type WorkOrderSettings = z.output<typeof SettingsSchema>;
export const RootSchema = z.object({ kb_root_id: z.string() }).transform((v) => ({ kbRootId: v.kb_root_id }));
export const ConvertSchema = z.object({ issue_id: z.string() }).transform((v) => ({ issueId: v.issue_id }));
export const DetailSchema = z.object({
  order: OrderSchema,
  events: z.array(z.object({
    id: z.string(), actor_id: z.string(), action: z.string(), created_at: z.string(),
    detail: z.unknown(),
  }).transform((v) => ({ id: v.id, actorId: v.actor_id, action: v.action, createdAt: v.created_at, detail: v.detail }))).default([]),
});
export type OrderTarget = { wsId: string; system?: boolean };
export function orderEndpoint(target: OrderTarget, suffix = "", params = new URLSearchParams()) {
  if (target.system) params.set("workspace_id", target.wsId);
  const query = params.toString();
  return `/api/${target.system ? "system/" : ""}work-orders${suffix}${query ? `?${query}` : ""}`;
}
export function orderCatalogEndpoint(target: OrderTarget | null, suffix: string, params = new URLSearchParams()) {
  if (target) return orderEndpoint(target, suffix, params);
  const query = params.toString();
  return `/api/system/work-orders${suffix}${query ? `?${query}` : ""}`;
}
export function updateToWire(order: WorkOrder) {
  return {
    assignee_id: order.assigneeId, product_version_id: order.productVersionId,
    customer_project_id: order.customerProjectId, draft: order.draft,
    branch_overrides: order.branchOverrides, stage: order.stage, updated_at: order.updatedAt,
  };
}
