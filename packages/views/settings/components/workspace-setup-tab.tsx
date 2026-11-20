"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@multica/core/api";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useCurrentMember } from "@multica/core/permissions";
import {
  workspaceSetupTemplatesOptions,
  setupTemplateNeedsApply,
  useInitializeWorkspace,
  WorkspaceSetupValidationError,
  WorkspaceSetupStepError,
  type SetupStep,
  type SetupStepState,
  type SetupSquadSource,
} from "@multica/core/process-templates";
import { projectListOptions } from "@multica/core/projects/queries";
import { memberListOptions, squadListOptions } from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes";
import { systemSettingsOptions } from "@multica/core/system-settings";
import { deliveryDefaultsOptions, vcsConnectionsOptions } from "@multica/core/vcs";
import { CheckCircle2, Loader2, RefreshCw, Zap } from "@multica/ui/icons";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Switch } from "@multica/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@multica/ui/components/ui/select";
import { TooltipHint } from "@multica/ui/components/common/tooltip-hint";
import { useT } from "../../i18n";
import { SettingsSection, SettingsTab } from "./settings-layout";

const NEW_PROJECT = "__new_project__";

export function WorkspaceSetupTab() {
  const { t } = useT("settings");
  const workspace = useCurrentWorkspace();
  const wsId = workspace?.id ?? "";
  const { role, userId } = useCurrentMember(wsId);
  const canManage = role === "owner" || role === "admin";
  const catalog = useQuery({
    ...workspaceSetupTemplatesOptions(wsId),
    enabled: !!wsId && canManage,
    retry: false,
  });
  const runtimes = useQuery({ ...runtimeListOptions(wsId), enabled: !!wsId && canManage });
  const connections = useQuery({ ...vcsConnectionsOptions(wsId), enabled: !!wsId && canManage, retry: false });
  const defaults = useQuery({ ...deliveryDefaultsOptions(wsId), enabled: !!wsId && canManage });
  const kb = useQuery({ ...systemSettingsOptions(), enabled: canManage, retry: false });
  const initialize = useInitializeWorkspace(wsId);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [gitlabEnabled, setGitlabEnabled] = useState(true);
  const [kbEnabled, setKbEnabled] = useState(true);
  const [gitlabUrl, setGitlabUrl] = useState<string | null>(null);
  const [gitlabToken, setGitlabToken] = useState("");
  const [urlPrefix, setUrlPrefix] = useState<string | null>(null);
  const [kbUrl, setKbUrl] = useState<string | null>(null);
  const [kbToken, setKbToken] = useState("");
  const [workflowEnabled, setWorkflowEnabled] = useState(true);
  const [workflowScope, setWorkflowScope] = useState<"workspace" | "project">("workspace");
  const [designChoice, setDesignChoice] = useState<string | null>(null);
  const [developmentChoice, setDevelopmentChoice] = useState<string | null>(null);
  const [reviewerChoice, setReviewerChoice] = useState<string | null>(null);
  const [projectChoice, setProjectChoice] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
  const workflowQueriesEnabled = !!wsId && canManage && workflowEnabled;
  const projects = useQuery({ ...projectListOptions(wsId), enabled: workflowQueriesEnabled && workflowScope === "project" });
  const members = useQuery({ ...memberListOptions(wsId), enabled: workflowQueriesEnabled });
  const squads = useQuery({ ...squadListOptions(wsId), enabled: workflowQueriesEnabled });
  const [steps, setSteps] = useState<Partial<Record<SetupStep, SetupStepState>>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const templates = catalog.data ?? [];
  const squadOptions: { value: string; label: string; source: SetupSquadSource }[] = [
    ...(squads.data ?? []).filter((item) => !item.archived_at).map((item) => ({
      value: `squad:${item.id}`, label: item.name, source: { squadId: item.id },
    })),
    ...templates.filter((item) => item.installed || item.latest_version).flatMap((template) =>
      (template.squads ?? []).map((squad) => ({
        value: `template:${template.id}:${squad.key}`, label: `${template.name} / ${squad.name}`,
        source: { templateId: template.id, squadKey: squad.key },
      }))),
  ];
  const designValue = designChoice ?? squadOptions.find((item) =>
    /design|product|设计|設計|产品|產品/i.test(item.label))?.value ?? squadOptions[0]?.value ?? "";
  const developmentValue = developmentChoice ?? squadOptions.find((item) =>
    /development|implementation|开发|開發/i.test(item.label) && item.value !== designValue)?.value ??
    squadOptions.find((item) => item.value !== designValue)?.value ?? "";
  const design = squadOptions.find((item) => item.value === designValue);
  const development = squadOptions.find((item) => item.value === developmentValue);
  const projectId = projectChoice ?? (projects.data?.length === 1 ? projects.data[0]!.id :
    projects.data?.length === 0 ? NEW_PROJECT : "");
  const newProjectTitle = projectTitle ?? t(($) => $.setup.workflow.default_project);
  const reviewerId = reviewerChoice ?? userId ?? "";
  const baseSelection = selection ?? (workflowEnabled ? [] :
    templates.filter((item) => setupTemplateNeedsApply(item) && item.latest_version).slice(0, 1).map((item) => item.id));
  const requiredTemplates = workflowEnabled ? [design, development].flatMap((item) =>
    item && "templateId" in item.source ? [item.source.templateId] : []) : [];
  const selected = [...new Set([...baseSelection, ...requiredTemplates])];
  const existingGitlab = connections.data?.connections.filter((item) => item.provider === "gitlab") ?? [];
  const instanceUrl = gitlabUrl ?? existingGitlab[0]?.instance_url ?? "";
  const hasConnection = existingGitlab.some((item) =>
    item.instance_url.replace(/\/+$/, "") === instanceUrl.trim().replace(/\/+$/, ""),
  );
  const environmentUrl = kbUrl ?? kb.data?.kb_environment_url ?? "";
  const prefix = urlPrefix ?? defaults.data?.rules.urlPrefix ?? "MULTICA_DEPLOY_URL=";
  const kbForbidden = kb.error instanceof ApiError && kb.error.status === 403;
  const gitlabAvailable = connections.data?.available !== false &&
    connections.data?.can_manage === true && (connections.data?.configured === true || hasConnection);
  const busy = initialize.isPending;
  const loading = canManage && [catalog, runtimes, connections, defaults, kb,
    ...(workflowEnabled ? [members, squads, ...(workflowScope === "project" ? [projects] : [])] : [])].some((query) => query.isLoading);
  const loadFailed = catalog.isError || runtimes.isError ||
    (gitlabEnabled && (connections.isError || defaults.isError)) ||
    (kbEnabled && kb.isError && !kbForbidden) ||
    (workflowEnabled && ((workflowScope === "project" && projects.isError) || members.isError || squads.isError));
  const stepLabel = (step: SetupStep) =>
    step === "kb" ? t(($) => $.setup.kb) :
    step === "gitlab" ? "GitLab" :
    step === "ci" ? t(($) => $.setup.ci) :
    step === "workflow" ? t(($) => $.setup.workflow.title) :
    step === "project" ? t(($) => $.setup.workflow.project) :
    templates.find((item) => `template:${item.id}` === step)?.name ?? t(($) => $.setup.templates);
  const refresh = () => {
    void catalog.refetch();
    void runtimes.refetch();
    void connections.refetch();
    void defaults.refetch();
    void kb.refetch();
    if (workflowEnabled) {
      if (workflowScope === "project") void projects.refetch();
      void members.refetch();
      void squads.refetch();
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    setSteps({});
    setSelection(selected);
    setDesignChoice(designValue);
    setDevelopmentChoice(developmentValue);
    if (workflowScope === "project") setProjectChoice(projectId);
    setReviewerChoice(reviewerId);
    try {
      if (workflowEnabled && (!design || !development)) {
        throw new WorkspaceSetupValidationError("squad_required");
      }
      const result = await initialize.mutateAsync({
        input: {
          templateIds: selected,
          ...(workflowEnabled && design && development ? {
            workflow: {
              scope: workflowScope,
              ...(workflowScope === "project" ? (projectId === NEW_PROJECT ? { projectTitle: newProjectTitle } : { projectId }) : {}),
              reviewerId, design: design.source, development: development.source,
              labels: {
                name: t(($) => $.setup.workflow.name),
                approval: t(($) => $.setup.workflow.approval),
                designInstructions: t(($) => $.setup.workflow.design_instructions),
                developmentInstructions: t(($) => $.setup.workflow.development_instructions),
              },
            },
          } : {}),
          ...(gitlabEnabled ? { gitlab: { instanceUrl, accessToken: gitlabToken, urlPrefix: prefix } } : {}),
          ...(kbEnabled && !kbForbidden ? { kb: { environmentUrl, integrationKey: kbToken } } : {}),
        },
        onStep: (step, state) => {
          setSteps((previous) => ({ ...previous, [step]: state }));
          if (state === "saved" && step === "gitlab") setGitlabToken("");
          if (state === "saved" && step === "kb") setKbToken("");
        },
      });
      if (result.projectId) setProjectChoice(result.projectId);
      setSaved(true);
      setGitlabToken("");
      setKbToken("");
    } catch (cause) {
      setError(cause instanceof WorkspaceSetupValidationError
        ? t(($) => $.setup.validation[cause.code])
        : cause instanceof WorkspaceSetupStepError
          ? t(($) => $.setup.step_failed, { step: stepLabel(cause.step) })
          : t(($) => $.setup.failed));
    } finally {
      initialize.reset();
    }
  };

  return (
    <SettingsTab title={t(($) => $.setup.title)}>
      {!canManage ? <p role="note" className="text-body text-muted-foreground">{t(($) => $.process_templates.read_only_note)}</p> : (
        <form onSubmit={submit} className="space-y-8">
          <fieldset disabled={busy || loading} className="min-w-0 space-y-8">
            <SettingsSection title={t(($) => $.setup.templates)} anchor="setup-templates">
              <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
                <span>{runtimes.data?.some((item) => item.status.toLowerCase() === "online")
                  ? t(($) => $.setup.runtime_online)
                  : t(($) => $.setup.validation.runtime_required)}</span>
                <TooltipHint label={t(($) => $.setup.refresh)}>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t(($) => $.setup.refresh)} onClick={refresh}>
                    <RefreshCw className="size-4" />
                  </Button>
                </TooltipHint>
              </div>
              {!loading && !templates.length ? <p className="text-body text-muted-foreground">{t(($) => $.process_templates.empty_workspace)}</p> : null}
              <ul className="divide-y divide-surface-border">
                {templates.map((template) => (
                  <li key={template.id}>
                    <label className="flex cursor-pointer items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={(template.installed === true && !setupTemplateNeedsApply(template)) || selected.includes(template.id)}
                        disabled={(template.installed && !setupTemplateNeedsApply(template)) || !template.latest_version || requiredTemplates.includes(template.id)}
                        onChange={(event) => {
                          setSaved(false);
                          setSelection(event.target.checked ? [...selected, template.id] : selected.filter((id) => id !== template.id));
                        }}
                      />
                      <span className="min-w-0 flex-1 break-words text-body">
                        <span className="font-medium">{template.name}</span>
                        {template.description ? <span className="mt-1 block text-caption text-muted-foreground">{template.description}</span> : null}
                      </span>
                      {template.installed ? <span className="shrink-0 text-caption text-success">{t(($) => $.process_templates.installed)}</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </SettingsSection>
            <SettingsSection title={t(($) => $.setup.workflow.title)} anchor="setup-workflow" action={
              <Switch disabled={busy || loading} aria-label={t(($) => $.setup.workflow.configure)} checked={workflowEnabled} onCheckedChange={(value) => { setWorkflowEnabled(value); setSaved(false); }} />
            }>
              {workflowEnabled ? <>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption font-medium">
                  <span>{t(($) => $.setup.workflow.design)}</span><span aria-hidden="true">&rarr;</span>
                  <span>{t(($) => $.setup.workflow.approval)}</span><span aria-hidden="true">&rarr;</span>
                  <span>{t(($) => $.setup.workflow.development)}</span><span aria-hidden="true">&rarr;</span>
                  <span>{t(($) => $.setup.workflow.acceptance)}</span>
                </div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <SetupSelect label={t(($) => $.setup.workflow.scope)} value={workflowScope} options={[
                    { value: "workspace", label: t(($) => $.setup.workflow.workspace_default) },
                    { value: "project", label: t(($) => $.setup.workflow.project_override) },
                  ]} placeholder={t(($) => $.setup.workflow.scope)} onChange={(value) => {
                    if (value === "workspace" || value === "project") setWorkflowScope(value);
                    setSaved(false);
                  }} />
                  <SetupSelect label={t(($) => $.setup.workflow.design)} value={designValue} options={squadOptions} placeholder={t(($) => $.setup.workflow.choose_squad)} onChange={(value) => { setDesignChoice(value); setSaved(false); }} />
                  <SetupSelect label={t(($) => $.setup.workflow.development)} value={developmentValue} options={squadOptions} placeholder={t(($) => $.setup.workflow.choose_squad)} onChange={(value) => { setDevelopmentChoice(value); setSaved(false); }} />
                  <SetupSelect label={t(($) => $.setup.workflow.reviewer)} value={reviewerId} options={(members.data ?? []).map((item) => ({ value: item.user_id, label: item.name }))} placeholder={t(($) => $.setup.workflow.reviewer)} onChange={(value) => { setReviewerChoice(value); setSaved(false); }} />
                  {workflowScope === "project" ? <SetupSelect label={t(($) => $.setup.workflow.project)} value={projectId} options={[
                    ...(projects.data ?? []).map((item) => ({ value: item.id, label: item.title })),
                    { value: NEW_PROJECT, label: t(($) => $.setup.workflow.new_project) },
                  ]} placeholder={t(($) => $.setup.workflow.choose_project)} onChange={(value) => { setProjectChoice(value); setSaved(false); }} /> : null}
                  {workflowScope === "project" && projectId === NEW_PROJECT ? <div className="min-w-0 space-y-2 sm:col-span-2">
                    <Label htmlFor="setup-project-name">{t(($) => $.setup.workflow.project_name)}</Label>
                    <Input id="setup-project-name" required maxLength={200} value={newProjectTitle} onChange={(event) => { setProjectTitle(event.target.value); setSaved(false); }} />
                  </div> : null}
                </div>
              </> : null}
            </SettingsSection>
            <SettingsSection title={t(($) => $.setup.gitlab)} anchor="setup-gitlab" action={
              <Switch disabled={busy || loading} aria-label={t(($) => $.setup.configure_gitlab)} checked={gitlabEnabled} onCheckedChange={(value) => { setGitlabEnabled(value); setSaved(false); }} />
            }>
              {gitlabEnabled ? <>
                {!loading && !gitlabAvailable && !connections.error ? <p role="note" className="text-caption text-destructive">{t(($) => $.setup.validation.gitlab_unavailable)}</p> : null}
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="setup-gitlab-url">{t(($) => $.setup.gitlab_url)}</Label>
                    <Input id="setup-gitlab-url" type="url" required value={instanceUrl} onChange={(event) => { setGitlabUrl(event.target.value); setGitlabToken(""); setSaved(false); }} placeholder="https://gitlab.example.com" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="setup-gitlab-token">{t(($) => $.setup.gitlab_token)}</Label>
                    <Input id="setup-gitlab-token" type="password" autoComplete="new-password" maxLength={4096} required={!hasConnection} disabled={hasConnection} value={gitlabToken} onChange={(event) => { setGitlabToken(event.target.value); setSaved(false); }} placeholder={hasConnection ? t(($) => $.setup.configured) : undefined} />
                  </div>
                </div>
                <div className="max-w-lg space-y-2">
                  <Label htmlFor="setup-ci-marker">{t(($) => $.delivery.prefix)}</Label>
                  <Input id="setup-ci-marker" value={prefix} maxLength={256} onChange={(event) => { setUrlPrefix(event.target.value); setSaved(false); }} />
                </div>
                <p className="text-caption text-muted-foreground">{t(($) => $.setup.gitlab_hint)}</p>
              </> : null}
            </SettingsSection>
            <SettingsSection title={t(($) => $.setup.kb)} anchor="setup-kb" action={
              !kbForbidden ? <Switch disabled={busy || loading} aria-label={t(($) => $.setup.configure_kb)} checked={kbEnabled} onCheckedChange={(value) => { setKbEnabled(value); setSaved(false); }} /> : null
            }>
              {kbForbidden ? <p role="note" className="text-caption text-muted-foreground">{t(($) => $.system_settings.system_admin_required)}</p> : kbEnabled ? <>
                <p className="text-caption text-muted-foreground">{t(($) => $.setup.kb_scope)}</p>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="setup-kb-url">{t(($) => $.system_settings.kb.environment_url)}</Label>
                    <Input id="setup-kb-url" type="url" required maxLength={2048} value={environmentUrl} onChange={(event) => { setKbUrl(event.target.value); setSaved(false); }} />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="setup-kb-token">{t(($) => $.system_settings.kb.integration_key)}</Label>
                    <Input id="setup-kb-token" type="password" maxLength={4096} autoComplete="new-password" value={kbToken} onChange={(event) => { setKbToken(event.target.value); setSaved(false); }} placeholder={kb.data?.kb_integration_key_configured ? t(($) => $.setup.configured) : ""} />
                  </div>
                </div>
              </> : null}
            </SettingsSection>
          </fieldset>
          {loadFailed ? <div role="alert" className="flex items-center justify-between gap-3 text-body text-destructive">
            {t(($) => $.setup.load_failed)}
            <Button type="button" variant="outline" onClick={refresh} disabled={busy}><RefreshCw className="size-4" />{t(($) => $.setup.refresh)}</Button>
          </div> : null}
          {Object.keys(steps).length ? <ul aria-live="polite" className="space-y-2">
            {Object.entries(steps).map(([step, state]) => state ? (
              <li key={step} className="flex min-h-6 items-center gap-2 text-caption">
                {state === "running" ? <Loader2 className="size-4 shrink-0 animate-spin" /> : state === "saved" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : null}
                <span className="min-w-0 break-words">{stepLabel(step as SetupStep)}: {t(($) => $.setup.states[state])}</span>
              </li>
            ) : null)}
          </ul> : null}
          {error ? <p role="alert" className="text-body text-destructive">{error}</p> : null}
          {saved ? <p role="status" className="text-body text-success">{t(($) => $.setup.saved)}</p> : null}
          <div className="flex items-center justify-start border-t border-surface-border pt-5 sm:justify-end">
            <Button type="submit" disabled={busy || loading || loadFailed || (!workflowEnabled && !selected.length && !gitlabEnabled && (!kbEnabled || kbForbidden)) || (gitlabEnabled && !gitlabAvailable)} aria-busy={busy}>
              {busy || loading ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              {busy ? t(($) => $.setup.applying) : t(($) => $.setup.apply)}
            </Button>
          </div>
        </form>
      )}
    </SettingsTab>
  );
}

function SetupSelect({ label, value, options, placeholder, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label>{label}</Label>
      <Select items={options} value={value || null} onValueChange={(next) => { if (next) onChange(next); }}>
        <SelectTrigger aria-label={label} className="w-full min-w-0">
          <span className="truncate">{options.find((item) => item.value === value)?.label ?? placeholder}</span>
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => <SelectItem key={item.value} value={item.value}><span className="break-words">{item.label}</span></SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
