import { z } from "zod";

const link = z.string().refine((value) => value === "" || /^https?:\/\//.test(value)).catch("");

export const DeliveryRulesSchema = z.object({
  auto_discover: z.boolean().optional(),
  deployment_job: z.string(),
  pipeline_source: z.string().default("push"),
  url_prefix: z.string().default("MULTICA_DEPLOY_URL="),
  allowed_hosts: z.array(z.string()),
  timeout_minutes: z.number().default(120),
}).transform((r) => ({
  ...(r.auto_discover === undefined ? {} : { autoDiscover: r.auto_discover }),
  deploymentJob: r.deployment_job,
  pipelineSource: r.pipeline_source,
  urlPrefix: r.url_prefix,
  allowedHosts: r.allowed_hosts,
  timeoutMinutes: r.timeout_minutes,
}));

export const DeliveryProjectSchema = z.object({
  inherits_defaults: z.boolean().default(false),
  id: z.string().min(1),
  connection_id: z.string().min(1),
  instance_url: link.default(""),
  project_id: z.number().int().positive(),
  project_path: z.string(),
  rules: DeliveryRulesSchema,
}).transform((p) => ({
  inheritsDefaults: p.inherits_defaults,
  id: p.id, connectionId: p.connection_id, instanceUrl: p.instance_url, projectId: p.project_id,
  projectPath: p.project_path, rules: p.rules,
}));

export const DeliveryIntegrationSchema = z.object({
  source_ref: z.string().min(1),
  source_sha: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/),
  target_ref: z.string().min(1),
  merge_request_url: link.default(""),
  merge_request_iid: z.number().int().nonnegative().default(0),
  merge_sha: z.string().default(""),
  state: z.string().min(1),
  reason: z.string().default(""),
  source_cleanup: z.string().default("retained"),
}).transform((i) => ({
  sourceRef: i.source_ref, sourceSha: i.source_sha, targetRef: i.target_ref,
  mergeRequestUrl: i.merge_request_url, mergeRequestIid: i.merge_request_iid,
  mergeSha: i.merge_sha, state: i.state, reason: i.reason, sourceCleanup: i.source_cleanup,
}));

const ResultSchema = z.object({
  integration: DeliveryIntegrationSchema.nullish(),
  pipeline_id: z.number().default(0),
  pipeline_status: z.string().default(""),
  pipeline_url: link.default(""),
  job_id: z.number().default(0),
  job_status: z.string().default(""),
  job_url: link.default(""),
  deployment_url: link.default(""),
  url_source: z.string().default(""),
  reason: z.string().default(""),
  downstream_pipelines: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string().default(""),
    status: z.string().default("unknown"),
    url: link.default(""),
  })).default([]),
}).transform((r) => ({
  pipelineId: r.pipeline_id, pipelineStatus: r.pipeline_status, pipelineUrl: r.pipeline_url,
  jobId: r.job_id, jobStatus: r.job_status, jobUrl: r.job_url,
  deploymentUrl: r.deployment_url, urlSource: r.url_source, reason: r.reason,
  downstreamPipelines: r.downstream_pipelines,
  integration: r.integration,
}));

export const DeliverySchema = z.object({
  id: z.string().min(1),
  project_config_id: z.string(),
  project_path: z.string(),
  sha: z.string(),
  ref: z.string(),
  status: z.string().default("unknown"),
  result: ResultSchema.prefault({}),
  created_at: z.string().default(""),
  updated_at: z.string().default(""),
  terminal: z.boolean().default(false),
}).transform((d) => ({
  id: d.id, projectConfigId: d.project_config_id, projectPath: d.project_path,
  sha: d.sha, ref: d.ref, status: d.status, result: d.result,
  createdAt: d.created_at, updatedAt: d.updated_at, terminal: d.terminal,
}));

export const DeliveryProjectsSchema = z.object({ projects: z.array(DeliveryProjectSchema) });
export const DeliveryDefaultsSchema = z.object({
  enabled: z.boolean(),
  rules: DeliveryRulesSchema,
});
export const IssueDeliveriesSchema = z.object({
  available: z.boolean().default(false), deliveries: z.array(DeliverySchema),
});
export const IntegrateDeliverySchema = z.object({
  integration: DeliveryIntegrationSchema,
  delivery: DeliverySchema.optional(),
}).refine((r) => r.integration.state !== "merged" || (
  r.delivery?.sha === r.integration.mergeSha.toLowerCase() &&
  r.delivery.ref === r.integration.targetRef
), "Merged delivery identity is missing or inconsistent");

export type DeliveryIntegration = z.infer<typeof DeliveryIntegrationSchema>;
export type IntegrateDeliveryResponse = z.infer<typeof IntegrateDeliverySchema>;
export type DeliveryRules = z.infer<typeof DeliveryRulesSchema>;
export type DeliveryProject = z.infer<typeof DeliveryProjectSchema>;
export type Delivery = z.infer<typeof DeliverySchema>;
export type DeliveryDefaults = z.infer<typeof DeliveryDefaultsSchema>;
export interface SaveDeliveryProjectInput {
  connectionId: string;
  projectId: number;
  rules: DeliveryRules;
}
export type RegisterDeliveryInput = ({
  projectConfigId: string; repositoryUrl?: never;
} | {
  repositoryUrl: string; projectConfigId?: never;
}) & {
  sha: string;
  ref: string;
};
