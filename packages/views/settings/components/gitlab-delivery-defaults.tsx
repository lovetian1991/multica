"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { deliveryDefaultsOptions, vcsKeys, type DeliveryDefaults } from "@multica/core/vcs";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Switch } from "@multica/ui/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@multica/ui/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@multica/ui/components/ui/select";
import { Settings } from "@multica/ui/icons";
import { useT } from "../../i18n";
import { SettingsRow } from "./settings-layout";

const sources = ["push", "web", "api", "merge_request_event", "schedule"].map((value) => ({ value, label: value }));

export function GitLabDeliveryDefaults({ canManage }: { canManage: boolean }) {
  const id = useId();
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const { t } = useT("settings");
  const query = useQuery(deliveryDefaultsOptions(wsId));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DeliveryDefaults | null>(null);
  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("CI tracking defaults are not loaded");
      return api.saveDeliveryDefaults(wsId, { ...draft, rules: {
        ...draft.rules, allowedHosts: [],
      } });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: vcsKeys.deliveryDefaults(wsId) }),
        qc.invalidateQueries({ queryKey: vcsKeys.deliveryProjects(wsId) }),
      ]);
      setOpen(false);
    },
  });
  if (query.error instanceof ApiError && query.error.status === 404) return null;
  const rules = draft?.rules;
  function updateRules(patch: Partial<DeliveryDefaults["rules"]>) {
    setDraft((current) => current ? { ...current, rules: { ...current.rules, ...patch } } : current);
  }
  return (
    <SettingsRow label={t(($) => $.delivery.defaults_title)}>
      {query.isError && <span role="alert" className="text-caption text-destructive">{t(($) => $.delivery.error)}</span>}
      {canManage && <Dialog open={open} onOpenChange={(next) => {
        if (save.isPending) return;
        if (next && query.data) {
          setDraft(query.data);
        }
        save.reset();
        setOpen(next);
      }}>
        <DialogTrigger render={<Button variant="outline" size="sm" disabled={!query.data} />}>
          <Settings />{t(($) => $.delivery.defaults_configure)}
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t(($) => $.delivery.defaults_title)}</DialogTitle></DialogHeader>
          {draft && rules && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`${id}-enabled`}>{t(($) => $.delivery.defaults_enabled)}</Label>
              <Switch id={`${id}-enabled`} disabled={save.isPending} checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
            </div>
            <div className="space-y-1.5"><Label htmlFor={`${id}-job`}>{t(($) => $.delivery.auto_job)}</Label>
              <Input id={`${id}-job`} disabled={save.isPending} maxLength={200} value={rules.deploymentJob}
                onChange={(e) => updateRules({ deploymentJob: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor={`${id}-source`}>{t(($) => $.delivery.source)}</Label>
              <Select items={sources} disabled={save.isPending} value={rules.pipelineSource} onValueChange={(v) => updateRules({ pipelineSource: v || "push" })}>
                <SelectTrigger id={`${id}-source`} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{sources.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label htmlFor={`${id}-prefix`}>{t(($) => $.delivery.prefix)}</Label>
              <Input id={`${id}-prefix`} disabled={save.isPending} required maxLength={100} value={rules.urlPrefix}
                onChange={(e) => updateRules({ urlPrefix: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor={`${id}-timeout`}>{t(($) => $.delivery.timeout)}</Label>
              <Input id={`${id}-timeout`} disabled={save.isPending} type="number" min="5" max="1440" required value={rules.timeoutMinutes}
                onChange={(e) => updateRules({ timeoutMinutes: Number(e.target.value) })} /></div>
            {save.error && <p role="alert" className="break-words text-caption text-destructive">{save.error.message}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={save.isPending} onClick={() => setOpen(false)}>{t(($) => $.delivery.cancel)}</Button>
              <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}><Settings />{t(($) => $.delivery.save)}</Button>
            </DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>}
    </SettingsRow>
  );
}
