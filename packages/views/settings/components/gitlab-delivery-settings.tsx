"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { deliveryProjectsOptions, vcsKeys, type DeliveryProject } from "@multica/core/vcs";
import type { VCSConnection } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { IconButton } from "@multica/ui/components/common/icon-button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@multica/ui/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@multica/ui/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@multica/ui/components/ui/select";
import { Pencil, Trash2, Settings } from "@multica/ui/icons";
import { useT } from "../../i18n";
import { SettingsRow } from "./settings-layout";

const sources = ["push", "web", "api", "merge_request_event", "schedule"].map((value) => ({ value, label: value }));

export function GitLabDeliverySettings({ connections, canManage }: { connections: VCSConnection[]; canManage: boolean }) {
  const formId = useId();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { t } = useT("settings");
  const gitlabs = connections.filter((c) => c.provider === "gitlab");
  const query = useQuery({ ...deliveryProjectsOptions(wsId), enabled: !!wsId && gitlabs.length > 0 });
  const [open, setOpen] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [job, setJob] = useState("");
  const [source, setSource] = useState("push");
  const [hosts, setHosts] = useState("");
  const [prefix, setPrefix] = useState("MULTICA_DEPLOY_URL=");
  const [timeout, setTimeout] = useState("120");
  const [remove, setRemove] = useState<DeliveryProject | null>(null);
  const save = useMutation({
    mutationFn: () => api.saveDeliveryProject(wsId, {
      connectionId: connectionId || gitlabs[0]?.id || "", projectId: Number(projectId),
      rules: { deploymentJob: job.trim(), pipelineSource: source, urlPrefix: prefix,
        allowedHosts: hosts.split(",").map((h) => h.trim()).filter(Boolean), timeoutMinutes: Number(timeout) },
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: vcsKeys.deliveryProjects(wsId) });
      setOpen(false);
    },
  });
  const deletion = useMutation({
    mutationFn: (id: string) => api.deleteDeliveryProject(wsId, id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: vcsKeys.deliveryProjects(wsId) });
      setRemove(null);
    },
  });
  if (!gitlabs.length || (query.error instanceof ApiError && query.error.status === 404)) return null;
  function edit(p: DeliveryProject) {
    setConnectionId(p.connectionId); setProjectId(String(p.projectId));
    setJob(p.rules.deploymentJob); setSource(p.rules.pipelineSource);
    setHosts(p.rules.allowedHosts.join(", ")); setPrefix(p.rules.urlPrefix);
    setTimeout(String(p.rules.timeoutMinutes)); save.reset();
  }
  return (
    <>
      <SettingsRow label={t(($) => $.delivery.title)}>
        {canManage && <Dialog open={open} onOpenChange={(next) => { if (!save.isPending) { setOpen(next); save.reset(); } }}>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>
            <Settings />{t(($) => $.delivery.configure)}
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
            <DialogHeader><DialogTitle>{t(($) => $.delivery.configure)}</DialogTitle></DialogHeader>
            <div className="space-y-2">
              {query.isLoading && <p>{t(($) => $.delivery.loading)}</p>}
              {query.isError && <p role="alert">{t(($) => $.delivery.error)}</p>}
              {query.data?.projects.map((p) => <div key={p.id} className="flex min-w-0 items-center gap-2 text-caption">
                <span className="min-w-0 flex-1 break-all">{p.projectPath} · {p.rules.deploymentJob}</span>
                <IconButton variant="ghost" size="icon-sm" label={t(($) => $.delivery.edit)} disabled={save.isPending || deletion.isPending} onClick={() => edit(p)}><Pencil /></IconButton>
                <IconButton variant="ghost" size="icon-sm" label={t(($) => $.delivery.remove)} disabled={save.isPending || deletion.isPending} onClick={() => { deletion.reset(); setRemove(p); }}><Trash2 /></IconButton>
              </div>)}
            </div>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-connection`}>{t(($) => $.delivery.connection)}</Label>
                <Select items={gitlabs.map((c) => ({ value: c.id, label: c.instance_url }))}
                  disabled={save.isPending} value={connectionId || gitlabs[0]?.id} onValueChange={(v) => setConnectionId(v || "")}>
                  <SelectTrigger id={`${formId}-connection`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{gitlabs.map((c) => <SelectItem key={c.id} value={c.id}>{c.instance_url}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor={`${formId}-project`}>{t(($) => $.delivery.project)}</Label>
                <Input id={`${formId}-project`} disabled={save.isPending} type="number" min="1" required value={projectId} onChange={(e) => setProjectId(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor={`${formId}-job`}>{t(($) => $.delivery.job)}</Label>
                <Input id={`${formId}-job`} disabled={save.isPending} required maxLength={200} value={job} onChange={(e) => setJob(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor={`${formId}-source`}>{t(($) => $.delivery.source)}</Label>
                <Select items={sources} disabled={save.isPending} value={source} onValueChange={(v) => setSource(v || "push")}>
                  <SelectTrigger id={`${formId}-source`} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{sources.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label htmlFor={`${formId}-hosts`}>{t(($) => $.delivery.hosts)}</Label>
                <Input id={`${formId}-hosts`} disabled={save.isPending} required value={hosts} onChange={(e) => setHosts(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor={`${formId}-prefix`}>{t(($) => $.delivery.prefix)}</Label>
                <Input id={`${formId}-prefix`} disabled={save.isPending} required maxLength={100} value={prefix} onChange={(e) => setPrefix(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor={`${formId}-timeout`}>{t(($) => $.delivery.timeout)}</Label>
                <Input id={`${formId}-timeout`} disabled={save.isPending} type="number" min="5" max="1440" required value={timeout} onChange={(e) => setTimeout(e.target.value)} /></div>
              {save.error && <p role="alert" className="break-words text-caption text-destructive">{save.error.message}</p>}
              <DialogFooter><Button type="button" variant="outline" disabled={save.isPending} onClick={() => setOpen(false)}>{t(($) => $.delivery.cancel)}</Button>
                <Button type="submit" disabled={save.isPending || deletion.isPending || query.isLoading || query.isError} aria-busy={save.isPending}><Settings />{t(($) => $.delivery.save)}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}
      </SettingsRow>
      <AlertDialog open={!!remove} onOpenChange={(next) => { if (!next && !deletion.isPending) setRemove(null); }}>
        <AlertDialogContent><AlertDialogHeader>
          <AlertDialogTitle>{t(($) => $.delivery.remove_title)}</AlertDialogTitle>
          <AlertDialogDescription>{t(($) => $.delivery.remove_description)}</AlertDialogDescription>
        </AlertDialogHeader>
          {deletion.error && <p role="alert" className="text-caption text-destructive">{deletion.error.message}</p>}
          <AlertDialogFooter><AlertDialogCancel disabled={deletion.isPending}>{t(($) => $.delivery.cancel)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deletion.isPending} onClick={(e) => { e.preventDefault(); if (remove) deletion.mutate(remove.id); }}>{t(($) => $.delivery.remove)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
