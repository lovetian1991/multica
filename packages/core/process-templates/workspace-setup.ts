import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { systemSettingsKeys } from "../system-settings";
import { vcsKeys } from "../vcs/queries";
import { workspaceKeys } from "../workspace/queries";
import { projectKeys } from "../projects/queries";
import { issueWorkflowKeys } from "../issue-workflows/queries";
import { issueStatusKeys } from "../issue-statuses/queries";
import type { IssueWorkflowStep, IssueWorkflowStepInput, ProcessTemplate, Squad } from "../types";
import { processTemplateKeys } from "./queries";

export type SetupSquadSource = { squadId: string } | { templateId: string; squadKey: string };

export interface SetupWorkflowInput {
  scope: "workspace" | "project";
  projectId?: string;
  projectTitle?: string;
  reviewerId: string;
  design: SetupSquadSource;
  development: SetupSquadSource;
  labels: {
    name: string;
    approval: string;
    designInstructions: string;
    developmentInstructions: string;
  };
}

export interface WorkspaceSetupInput {
  templateIds: string[];
  workflow?: SetupWorkflowInput;
  gitlab?: { instanceUrl: string; accessToken: string; urlPrefix: string };
  kb?: { environmentUrl: string; integrationKey: string };
}

export type SetupStep = "kb" | "gitlab" | "ci" | "workflow" | "project" | `template:${string}`;
export type SetupStepState = "running" | "saved" | "failed";
export type SetupValidation =
  | "invalid_url"
  | "runtime_required"
  | "template_unavailable"
  | "gitlab_unavailable"
  | "gitlab_token_required"
  | "kb_key_required"
  | "project_required"
  | "project_conflict"
  | "reviewer_required"
  | "squad_required"
  | "workflow_conflict"
  | "status_mapping_required";

export class WorkspaceSetupValidationError extends Error {
  constructor(public readonly code: SetupValidation) {
    super(code);
  }
}

export class WorkspaceSetupStepError extends Error {
  constructor(public readonly step: SetupStep) {
    // Provider error bodies can contain credentials. Only expose the step.
    super("Workspace initialization failed");
  }
}

export function workspaceSetupTemplatesOptions(wsId: string) {
  return queryOptions({
    queryKey: [...processTemplateKeys.workspaceList(), wsId, "setup"],
    queryFn: () => api.listWorkspaceProcessTemplates(true),
    select: (data) => data.templates,
    enabled: !!wsId,
    retry: false,
  });
}

export function setupBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) throw new Error();
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new WorkspaceSetupValidationError("invalid_url");
  }
}

export function setupTemplateNeedsApply(template: ProcessTemplate): boolean {
  return !template.installed || template.squads?.some((squad) => !squad.id) === true;
}

function resolveSetupSquad(source: SetupSquadSource, templates: ProcessTemplate[], squads: Squad[]): string | undefined {
  const id = "squadId" in source ? source.squadId :
    templates.find((item) => item.id === source.templateId)?.squads?.find((item) => item.key === source.squadKey)?.id;
  return squads.find((item) => item.id === id && !item.archived_at)?.id;
}

function workflowSteps(input: SetupWorkflowInput, designId: string, developmentId: string, approvalKey?: string): IssueWorkflowStepInput[] {
  const none = { handler: { type: "none" as const } };
  return [
    { status_key: "backlog", ...none },
    { status_key: "todo", handler: { type: "squad", id: designId }, instructions: input.labels.designInstructions },
    {
      ...(approvalKey ? { status_key: approvalKey } : { new_status: { name: input.labels.approval, category: "started" } }),
      handler: { type: "member", id: input.reviewerId },
    },
    {
      status_key: "in_progress", handler: { type: "squad", id: developmentId },
      instructions: input.labels.developmentInstructions, next_status_key: "in_review", back_status_key: "todo",
    },
    { status_key: "in_review", handler: { type: "member", id: input.reviewerId } },
    { status_key: "blocked", ...none },
    { status_key: "done", ...none },
    { status_key: "cancelled", ...none },
  ];
}

function sameWorkflowSteps(saved: IssueWorkflowStep[], expected: IssueWorkflowStepInput[]): boolean {
  return saved.length === expected.length && saved.every((step, index) => {
    const wanted = expected[index];
    return wanted && "status_key" in wanted && step.status_key === wanted.status_key &&
      step.handler.type === wanted.handler?.type && (step.handler.id ?? "") === (wanted.handler.id ?? "") &&
      step.instructions === (wanted.instructions ?? "") &&
      (step.next_status_key ?? "") === (wanted.next_status_key ?? "") &&
      (step.back_status_key ?? "") === (wanted.back_status_key ?? "");
  });
}

export async function initializeWorkspace(
  wsId: string,
  input: WorkspaceSetupInput,
  onStep: (step: SetupStep, state: SetupStepState) => void,
): Promise<{ projectId?: string }> {
  // Read and validate every selected section before the first write.
  const gitlabUrl = input.gitlab && setupBaseUrl(input.gitlab.instanceUrl);
  const kbUrl = input.kb && setupBaseUrl(input.kb.environmentUrl);
  const workflow = input.workflow;
  const sources = workflow ? [workflow.design, workflow.development] : [];
  const templateIds = [...new Set([...input.templateIds,
    ...sources.flatMap((source) => "templateId" in source ? [source.templateId] : []),
  ])];
  const [catalog, runtimes, connections, defaults, kb] = await Promise.all([
    templateIds.length ? api.listWorkspaceProcessTemplates(true) : undefined,
    templateIds.length ? api.listRuntimes({ workspace_id: wsId }) : undefined,
    input.gitlab ? api.listVCSConnections(wsId) : undefined,
    input.gitlab ? api.getDeliveryDefaults(wsId) : undefined,
    input.kb ? api.getSystemSettings() : undefined,
  ]);
  const templates = templateIds.map((id) => {
    const template = catalog?.templates.find((item) => item.id === id);
    if (!template || (!template.installed && !template.latest_version)) {
      throw new WorkspaceSetupValidationError("template_unavailable");
    }
    return template;
  });
  const workflowData = workflow ? await Promise.all([
    workflow.scope === "project" ? api.listProjects() : undefined,
    api.listMembers(wsId), api.listSquads(), api.listIssueWorkflows(), api.listIssueStatuses(),
  ]) : undefined;
  let project = workflowData?.[0]?.projects.find((item) => item.id === workflow?.projectId);
  const projectTitle = workflow?.projectTitle?.trim() ?? "";
  const workflowName = (title: string) => Array.from(`${workflow?.labels.name} (${title})`).slice(0, 64).join("");
  if (workflow && workflowData) {
    if (workflow.scope === "workspace" && !workflowData[3].workflows.some((item) => item.is_default)) {
      throw new WorkspaceSetupValidationError("workflow_conflict");
    }
    if (workflow.scope === "project" && (workflow.projectId ? !project : !projectTitle)) {
      throw new WorkspaceSetupValidationError("project_required");
    }
    if (workflow.scope === "project" && !workflow.projectId) {
      const matches = workflowData[0]!.projects.filter((item) => item.title.toLowerCase() === projectTitle.toLowerCase());
      const existingWorkflow = workflowData[3].workflows.find((item) => item.name === workflowName(projectTitle));
      if (matches.length) {
        if (matches.length !== 1 || !existingWorkflow || matches[0]!.workflow_id !== existingWorkflow.id) {
          throw new WorkspaceSetupValidationError("project_conflict");
        }
        project = matches[0];
      }
    }
    if (!workflowData[1].some((item) => item.user_id === workflow.reviewerId)) {
      throw new WorkspaceSetupValidationError("reviewer_required");
    }
    for (const source of sources) {
      const template = "templateId" in source ? templates.find((item) => item.id === source.templateId) : undefined;
      const valid = "squadId" in source ? resolveSetupSquad(source, templates, workflowData[2]) :
        template?.squads?.some((item) => item.key === source.squadKey &&
          (setupTemplateNeedsApply(template) || resolveSetupSquad(source, templates, workflowData[2])));
      if (!valid) throw new WorkspaceSetupValidationError("squad_required");
    }
    if (!workflow.labels.name.trim() || !workflow.labels.approval.trim() ||
      workflowData[4].statuses.some((item) => item.is_system &&
        item.name.toLowerCase() === workflow.labels.approval.trim().toLowerCase())) {
      throw new WorkspaceSetupValidationError("workflow_conflict");
    }
  }
  if (templates.some(setupTemplateNeedsApply) &&
    !runtimes?.some((runtime) => runtime.status.toLowerCase() === "online")) {
    throw new WorkspaceSetupValidationError("runtime_required");
  }
  const connected = connections?.connections.some((connection) =>
    connection.provider === "gitlab" && setupBaseUrl(connection.instance_url) === gitlabUrl,
  );
  if (input.gitlab) {
    if (connections?.available === false || !connections?.can_manage ||
      (!connected && !connections?.configured)) {
      throw new WorkspaceSetupValidationError("gitlab_unavailable");
    }
    if (!connected && !input.gitlab.accessToken.trim()) {
      throw new WorkspaceSetupValidationError("gitlab_token_required");
    }
  }
  if (input.kb && !input.kb.integrationKey.trim() &&
    (!kb?.kb_integration_key_configured || setupBaseUrl(kb.kb_environment_url) !== kbUrl)) {
    throw new WorkspaceSetupValidationError("kb_key_required");
  }
  const run = async (step: SetupStep, action: () => Promise<unknown>) => {
    onStep(step, "running");
    try {
      await action();
      onStep(step, "saved");
    } catch (cause) {
      onStep(step, "failed");
      if (cause instanceof WorkspaceSetupValidationError) throw cause;
      throw new WorkspaceSetupStepError(step);
    }
  };
  if (input.kb && kbUrl) {
    const integrationKey = input.kb.integrationKey.trim();
    await run("kb", async () => {
      if (integrationKey || kb?.kb_environment_url !== kbUrl) {
        await api.updateSystemSettings({
          kb_environment_url: kbUrl,
          ...(integrationKey ? { kb_integration_key: integrationKey } : {}),
        });
      }
    });
  }
  if (input.gitlab && gitlabUrl && defaults) {
    const gitlab = input.gitlab;
    await run("gitlab", async () => {
      // Reconnecting rotates webhook secrets; initialization keeps existing connections.
      if (!connected) await api.connectVCS(wsId, {
        provider: "gitlab", instance_url: gitlabUrl, access_token: gitlab.accessToken.trim(),
      });
    });
    await run("ci", async () => {
      const next = {
        enabled: true,
        rules: { ...defaults.rules, autoDiscover: true, allowedHosts: [], urlPrefix: gitlab.urlPrefix.trim() },
      };
      if (JSON.stringify(next) !== JSON.stringify(defaults)) {
        await api.saveDeliveryDefaults(wsId, next);
      }
    });
  }
  for (const template of templates) {
    await run(`template:${template.id}`, async () => {
      if (setupTemplateNeedsApply(template)) await api.applyWorkspaceProcessTemplate(template.id);
    });
  }
  if (workflow && workflowData) {
    let workflowId = "";
    await run("workflow", async () => {
      const [updatedCatalog, squads, workflows, statuses] = await Promise.all([
        templateIds.length ? api.listWorkspaceProcessTemplates(true) : undefined,
        api.listSquads(), api.listIssueWorkflows(), api.listIssueStatuses(),
      ]);
      const installedTemplates = updatedCatalog?.templates ?? [];
      const designId = resolveSetupSquad(workflow.design, installedTemplates, squads);
      const developmentId = resolveSetupSquad(workflow.development, installedTemplates, squads);
      if (!designId || !developmentId) throw new WorkspaceSetupValidationError("squad_required");
      const approval = statuses.statuses.find((item) => !item.archived_at && !item.is_system &&
        item.name.toLowerCase() === workflow.labels.approval.trim().toLowerCase());
      const steps = workflowSteps(workflow, designId, developmentId, approval?.key);
      if (workflow.scope === "workspace") {
        const current = workflows.workflows.find((item) => item.is_default);
        if (!current) throw new WorkspaceSetupValidationError("workflow_conflict");
        if (!sameWorkflowSteps(current.steps, steps)) await api.updateIssueWorkflow(current.id, { steps });
        return;
      }
      const name = workflowName(project?.title ?? projectTitle);
      const existing = workflows.workflows.filter((item) => item.name === name);
      if (existing.length) {
        if (existing.length !== 1 || existing[0]!.is_default ||
          existing[0]!.project_ids.some((id) => id !== project?.id) || !sameWorkflowSteps(existing[0]!.steps, steps)) {
          throw new WorkspaceSetupValidationError("workflow_conflict");
        }
        workflowId = existing[0]!.id;
      } else {
        workflowId = (await api.createIssueWorkflow({ name, steps })).id;
      }
    });
    if (workflow.scope === "project") await run("project", async () => {
      if (!project) {
        project = await api.createProject({ title: projectTitle, workflow_id: workflowId });
        return;
      }
      if (project.workflow_id === workflowId) return;
      const preview = await api.dryRunProjectWorkflow(project.id, workflowId);
      if (preview.plan.required.length) throw new WorkspaceSetupValidationError("status_mapping_required");
      await api.setProjectWorkflow(project.id, { workflow_id: workflowId });
    });
  }
  return { projectId: project?.id };
}

export function useInitializeWorkspace(wsId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: ({
      input,
      onStep,
    }: {
      input: WorkspaceSetupInput;
      onStep: (step: SetupStep, state: SetupStepState) => void;
    }) => initializeWorkspace(wsId, input, onStep),
    onSettled: async () => {
      await Promise.all([
        processTemplateKeys.workspace(),
        workspaceKeys.agents(wsId),
        workspaceKeys.squads(wsId),
        workspaceKeys.skills(wsId),
        vcsKeys.all(wsId),
        systemSettingsKeys.all(),
        projectKeys.all(wsId),
        issueWorkflowKeys.all(wsId),
        issueStatusKeys.all(wsId),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
