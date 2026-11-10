"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { deliveryProjectsOptions, issueDeliveriesOptions, vcsKeys } from "@multica/core/vcs";
import { Button } from "@multica/ui/components/ui/button";
import { IconButton } from "@multica/ui/components/common/icon-button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@multica/ui/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@multica/ui/components/ui/select";
import { Plus, RefreshCw, ExternalLink } from "@multica/ui/icons";
import { useT } from "../../i18n";
import { IssueSidebarSectionHeader } from "./issue-sidebar-section";

export function IssueDeliveriesSection({ issueId }: { issueId: string }) {
  const formId = useId();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { t } = useT("settings");
  const query = useQuery(issueDeliveriesOptions(wsId, issueId));
  const projects = useQuery({ ...deliveryProjectsOptions(wsId), enabled: !!wsId && query.data?.available === true });
  const [expanded, setExpanded] = useState(true);
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState("");
  const [sha, setSha] = useState("");
  const [ref, setRef] = useState("");
  const registration = useMutation({
    mutationFn: () => api.registerDelivery(issueId, { projectConfigId: project || projects.data?.projects[0]?.id || "", sha: sha.trim(), ref: ref.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: vcsKeys.deliveries(wsId, issueId) });
      setOpen(false); setSha(""); setRef("");
    },
  });
  const resume = useMutation({
    mutationFn: (id: string) => api.resumeDelivery(issueId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: vcsKeys.deliveries(wsId, issueId) }),
  });
  if ((query.error instanceof ApiError && query.error.status === 404) || query.data?.available === false) return null;
  const statuses = t(($) => $.delivery.statuses, { returnObjects: true });
  return <div>
    <IssueSidebarSectionHeader title={t(($) => $.delivery.title)} open={expanded} onOpenChange={setExpanded}
      count={query.data?.deliveries.length}
      actions={<Dialog open={open} onOpenChange={(next) => { if (!registration.isPending) { setOpen(next); registration.reset(); } }}>
        <DialogTrigger render={<IconButton variant="ghost" size="icon-xs" label={t(($) => $.delivery.register)} />}><Plus /></DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t(($) => $.delivery.register)}</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!registration.isPending) registration.mutate(); }}>
            {projects.isLoading && <p>{t(($) => $.delivery.loading)}</p>}
            {projects.isError && <p role="alert">{t(($) => $.delivery.error)}</p>}
            {projects.data?.projects.length === 0 && <p>{t(($) => $.delivery.empty)}</p>}
            <div className="space-y-1.5"><Label htmlFor={`${formId}-project`}>{t(($) => $.delivery.project_choice)}</Label>
              <Select items={projects.data?.projects.map((p) => ({ value: p.id, label: `${p.projectPath} (${p.instanceUrl})` })) || []}
                disabled={registration.isPending} value={project || projects.data?.projects[0]?.id || null} onValueChange={(v) => setProject(v || "")}>
                <SelectTrigger id={`${formId}-project`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{projects.data?.projects.map((p) => <SelectItem key={p.id} value={p.id}>{`${p.projectPath} (${p.instanceUrl})`}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label htmlFor={`${formId}-sha`}>{t(($) => $.delivery.sha)}</Label>
              <Input id={`${formId}-sha`} disabled={registration.isPending} required pattern="[a-fA-F0-9]{40}|[a-fA-F0-9]{64}" value={sha} onChange={(e) => setSha(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor={`${formId}-ref`}>{t(($) => $.delivery.ref)}</Label>
              <Input id={`${formId}-ref`} disabled={registration.isPending} required maxLength={255} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            {registration.error && <p role="alert" className="break-words text-caption text-destructive">{registration.error.message}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={registration.isPending} onClick={() => setOpen(false)}>{t(($) => $.delivery.cancel)}</Button>
              <Button type="submit" disabled={registration.isPending || !projects.data?.projects.length} aria-busy={registration.isPending}><Plus />{t(($) => $.delivery.register)}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>} />
    {expanded && <div className="space-y-3 px-2 text-caption">
      {query.isLoading && <p className="text-muted-foreground">{t(($) => $.delivery.loading)}</p>}
      {query.isError && <div role="alert"><p>{t(($) => $.delivery.error)}</p><Button variant="ghost" size="sm" onClick={() => void query.refetch()}><RefreshCw />{t(($) => $.delivery.retry)}</Button></div>}
      {query.data?.deliveries.length === 0 && <p className="text-muted-foreground">{t(($) => $.delivery.none)}</p>}
      {resume.error && <p role="alert" className="break-words text-destructive">{resume.error.message}</p>}
      {query.data?.deliveries.map((d) => <div key={d.id} className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 break-all font-medium">{d.projectPath}</span>
          {d.terminal && <IconButton variant="ghost" size="icon-xs" label={t(($) => $.delivery.resume)} disabled={resume.isPending} onClick={() => resume.mutate(d.id)}><RefreshCw /></IconButton>}
        </div>
        <p className="break-all text-muted-foreground">{d.ref} · {d.sha.slice(0, 8)}</p>
        <p className={d.status === "deployed" ? "text-success" : d.status === "failed" || d.status === "blocked" ? "text-destructive" : "text-muted-foreground"}>
          {Object.hasOwn(statuses, d.status) ? statuses[d.status as keyof typeof statuses] : statuses.unknown}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {d.result.pipelineUrl && <a className="inline-flex items-center gap-1 text-muted-foreground hover:underline" href={d.result.pipelineUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />{t(($) => $.delivery.pipeline)}</a>}
          {d.result.jobUrl && <a className="inline-flex items-center gap-1 text-muted-foreground hover:underline" href={d.result.jobUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />{t(($) => $.delivery.job_link)}</a>}
          {d.result.deploymentUrl && <a className="inline-flex items-center gap-1 hover:underline" href={d.result.deploymentUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />{t(($) => $.delivery.visit)}</a>}
        </div>
        {d.result.deploymentUrl && <p className="break-all text-muted-foreground">{d.result.deploymentUrl}</p>}
        {d.result.urlSource === "job_trace" && <p className="text-muted-foreground">{t(($) => $.delivery.evidence)}</p>}
        {d.status === "deployed" && <p className="text-muted-foreground">{t(($) => $.delivery.acceptance)}</p>}
        {d.result.reason && <p className="break-words text-muted-foreground">{d.result.reason}</p>}
        {d.updatedAt && !Number.isNaN(Date.parse(d.updatedAt)) && <p className="text-micro text-muted-foreground">{t(($) => $.delivery.updated, { time: new Date(d.updatedAt).toLocaleString() })}</p>}
      </div>)}
    </div>}
  </div>;
}
