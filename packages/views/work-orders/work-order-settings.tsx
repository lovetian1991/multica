"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { workOrderKeys, type OrderTarget, type WorkOrderSettings as Settings } from "@multica/core/work-orders";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Folder, Save } from "@multica/ui/icons";
import { toast } from "sonner";
import { useT } from "../i18n";
import { FolderPickerDialog } from "../system-management/folder-picker-dialog";
import { OrderField, OrderSelect } from "./controls";

export function WorkOrderSettings({ target }: { target: OrderTarget }) {
  const query = useQuery({ queryKey: [...workOrderKeys.all(target), "settings"], queryFn: () => api.getWorkOrderSettings(target) });
  if (!query.data) return <p role={query.error ? "alert" : undefined} className="text-body text-muted-foreground">{query.error?.message ?? "..."}</p>;
  return <SettingsForm key={`${target.wsId}/${query.data.executionProjectId}/${query.data.squadId}`} initial={query.data} target={target} />;
}

function SettingsForm({ initial, target }: { initial: Settings; target: OrderTarget }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [credentials, setCredentials] = useState("");
  const options = useQuery({ queryKey: [...workOrderKeys.all(target), "options"], queryFn: () => api.getWorkOrderOptions(target) });
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await api.saveWorkOrderSettings(target, { ...draft, misCredentials: credentials });
      if (!result) throw new Error(t(($) => $.work_orders.failed));
    },
    onSuccess: () => { setCredentials(""); void qc.invalidateQueries({ queryKey: workOrderKeys.all(target) }); toast.success(t(($) => $.work_orders.saved)); },
  });
  return <div className="space-y-4">
    <OrderSelect label={t(($) => $.work_orders.execution_project)} value={draft.executionProjectId} onChange={(v) => setDraft({ ...draft, executionProjectId: v })} options={(options.data?.projects ?? []).filter((p) => p.purpose === "execution").map((p) => ({ value: p.id, label: p.name }))} empty={t(($) => $.work_orders.none)} />
    <OrderSelect label={t(($) => $.work_orders.squad)} value={draft.squadId} onChange={(v) => setDraft({ ...draft, squadId: v })} options={(options.data?.squads ?? []).map((s) => ({ value: s.id, label: s.name }))} empty={t(($) => $.work_orders.none)} />
    <OrderField label={t(($) => $.work_orders.mis_url)}><Input value={draft.misUrl} onChange={(e) => setDraft({ ...draft, misUrl: e.target.value })} /></OrderField>
    <OrderField label={t(($) => $.work_orders.mis_credentials)}><Input type="password" value={credentials} autoComplete="new-password" placeholder={draft.misCredentialsConfigured ? t(($) => $.work_orders.configured) : '{"headers":{"appid":"","siteoutid":""},"token":""}'} onChange={(e) => setCredentials(e.target.value)} /></OrderField>
    {options.error && <p role="alert" className="text-body text-destructive">{options.error.message}</p>}
    {mutation.error && <p role="alert" className="text-body text-destructive">{mutation.error.message}</p>}
    <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}><Save className="size-4" />{t(($) => $.work_orders.save)}</Button>
  </div>;
}

export function WorkOrderRootSetting() {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["work-order-root"], queryFn: () => api.getWorkOrderRoot() });
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await api.saveWorkOrderRoot(selected ?? query.data?.kbRootId ?? "");
      if (!result) throw new Error(t(($) => $.work_orders.failed));
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["work-order-root"] }); toast.success(t(($) => $.work_orders.saved)); },
  });
  return <section className="mt-6 space-y-4 border-t border-surface-border py-6">
    <h2 className="text-title-sm font-semibold">{t(($) => $.work_orders.kb_root)}</h2>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1"><OrderField label={t(($) => $.work_orders.kb_root)}><Input value={selected ?? query.data?.kbRootId ?? ""} onChange={(e) => setSelected(e.target.value)} /></OrderField></div>
      <Button variant="outline" onClick={() => setPicker(true)}><Folder className="size-4" />{t(($) => $.work_orders.choose_folder)}</Button>
      <Button disabled={mutation.isPending || query.isLoading || !!query.error} onClick={() => mutation.mutate()}><Save className="size-4" />{t(($) => $.work_orders.save)}</Button>
    </div>
    {(query.error || mutation.error) && <p role="alert" className="text-body text-destructive">{(query.error || mutation.error)?.message}</p>}
    <FolderPickerDialog open={picker} onOpenChange={setPicker} selectedFolderId={selected ?? query.data?.kbRootId ?? ""} onSelect={(f) => { setSelected(f.id); setPicker(false); }} />
  </section>;
}
