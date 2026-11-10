import { z } from "zod";

const link = z.string().refine((value) => value === "" || /^https?:\/\//.test(value)).catch("");

export const DeliveryRulesSchema = z.object({
  deployment_job: z.string(),
  pipeline_source: z.string().default("push"),
  url_prefix: z.string().default("MULTICA_DEPLOY_URL="),
  allowed_hosts: z.array(z.string()),
  timeout_minutes: z.number().default(120),
}).transform((r) => ({
  deploymentJob: r.deployment_job,
  pipelineSource: r.pipeline_source,
  urlPrefix: r.url_prefix,
  allowedHosts: r.allowed_hosts,
  timeoutMinutes: r.timeout_minutes,
}));

export const DeliveryProjectSchema = z.object({
  id: z.string().min(1),
  connection_id: z.string().min(1),
  instance_url: link.default(""),
  project_id: z.number().int().positive(),
  project_path: z.string(),
  rules: DeliveryRulesSchema,
}).transform((p) => ({
  id: p.id, connectionId: p.connection_id, instanceUrl: p.instance_url, projectId: p.project_id,
  projectPath: p.project_path, rules: p.rules,
}));

const ResultSchema = z.object({
  pipeline_id: z.number().default(0),
  pipeline_status: z.string().default(""),
  pipeline_url: link.default(""),
  job_id: z.number().default(0),
  job_status: z.string().default(""),
  job_url: link.default(""),
  deployment_url: link.default(""),
  url_source: z.string().default(""),
  reason: z.string().default(""),
}).transform((r) => ({
  pipelineId: r.pipeline_id, pipelineStatus: r.pipeline_status, pipelineUrl: r.pipeline_url,
  jobId: r.job_id, jobStatus: r.job_status, jobUrl: r.job_url,
  deploymentUrl: r.deployment_url, urlSource: r.url_source, reason: r.reason,
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
export const IssueDeliveriesSchema = z.object({
  available: z.boolean().default(false), deliveries: z.array(DeliverySchema),
});

export type DeliveryRules = z.infer<typeof DeliveryRulesSchema>;
export type DeliveryProject = z.infer<typeof DeliveryProjectSchema>;
export type Delivery = z.infer<typeof DeliverySchema>;
export interface SaveDeliveryProjectInput {
  connectionId: string;
  projectId: number;
  rules: DeliveryRules;
}
export interface RegisterDeliveryInput {
  projectConfigId: string;
  sha: string;
  ref: string;
}
