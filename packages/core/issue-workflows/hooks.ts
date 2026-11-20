import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { projectListOptions } from "../projects/queries";
import type { IssueWorkflow, Project } from "../types";
import { defaultWorkflow, issueWorkflowListOptions, resolveProjectWorkflow } from "./queries";

const EMPTY: IssueWorkflow[] = [];

/** The workspace's workflows, in name order. Empty until loaded. */
export function useIssueWorkflows(wsId: string): { workflows: IssueWorkflow[]; isLoaded: boolean } {
  const { data } = useQuery({ ...issueWorkflowListOptions(wsId), enabled: Boolean(wsId) });
  return useMemo(() => ({ workflows: data ?? EMPTY, isLoaded: data !== undefined }), [data]);
}

/**
 * A project and its resolved workflow. Issues outside a project inherit the
 * workspace Default. Null while the required lists are still loading.
 */
export function useProjectWithWorkflow(
  wsId: string,
  projectId: string | null | undefined,
): { project: Project | null; workflow: IssueWorkflow | null; defaultWorkflow: IssueWorkflow | null } {
  const { workflows } = useIssueWorkflows(wsId);
  const { data: projects } = useQuery({
    ...projectListOptions(wsId),
    enabled: Boolean(wsId) && Boolean(projectId),
  });
  return useMemo(() => {
    const project = projectId ? projects?.find((p) => p.id === projectId) ?? null : null;
    return {
      project,
      workflow: projectId === null ? defaultWorkflow(workflows) : resolveProjectWorkflow(workflows, project),
      defaultWorkflow: defaultWorkflow(workflows),
    };
  }, [projectId, projects, workflows]);
}

/** The project's workflow, or the workspace Default outside a project. */
export function useProjectWorkflow(
  wsId: string,
  projectId: string | null | undefined,
): IssueWorkflow | null {
  return useProjectWithWorkflow(wsId, projectId).workflow;
}
