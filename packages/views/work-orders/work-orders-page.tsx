"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { paths, useCurrentWorkspace } from "@multica/core/paths";
import { workOrderKeys, workOrdersOptions, type OrderTarget, type WorkOrder, type WorkOrderPlan } from "@multica/core/work-orders";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { ArrowLeft, ArrowRight, FileText, Plus, RefreshCw, Save } from "@multica/ui/icons";
import { toast } from "sonner";
import { useT } from "../i18n";
import { AppLink } from "../navigation";
import { CollapsedNavTrigger } from "../layout/page-header";
import { SystemManagementLayout } from "../system-management/system-management-layout";
import { OrderField, OrderSelect } from "./controls";
import { WorkOrderSettings } from "./work-order-settings";
import { useVersionChoices } from "./queries";

const stages = ["pending", "processing", "review", "accepted", "blocked"] as const;

export function WorkOrdersPage({ system = false, embedded = false }: { system?: boolean; embedded?: boolean }) {
  const { t } = useT("settings");
  const workspace = useCurrentWorkspace();
  const [workspaceId, setWorkspaceId] = useState("");
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [syncPage, setSyncPage] = useState(1);
  const qc = useQueryClient();
  const versions = useVersionChoices();
  const ws = useQuery({ queryKey: ["system-workspaces"], queryFn: () => api.listSystemWorkspaces(), enabled: system });
  const target: OrderTarget = { wsId: system ? workspaceId || ws.data?.[0]?.id || "" : workspace?.id ?? "", system };
  const list = useQuery(workOrdersOptions(target, all, search, page));
  const members = useQuery({ queryKey: [...workOrderKeys.all(target), "members"], queryFn: () => api.getWorkOrderMembers(target), enabled: !!list.data?.canManage });
  const sync = useMutation({
    mutationFn: async () => {
      const result = await api.syncWorkOrders(target, syncPage);
      if (!result) throw new Error(t(($) => $.work_orders.failed));
      return result;
    },
    onSuccess: (v) => { setSyncPage(v.nextPage || 1); void qc.invalidateQueries({ queryKey: workOrderKeys.all(target) }); toast.success(`${v.synced} / ${v.total}`); },
    onError: (e) => toast.error(e.message),
  });
  const body = <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-3">
      <CollapsedNavTrigger /><FileText className="size-5 text-muted-foreground" />
      <h1 className="text-title-sm font-semibold">{t(($) => system ? $.work_orders.admin : $.work_orders.title)}</h1>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t(($) => $.work_orders.refresh)} title={t(($) => $.work_orders.refresh)} onClick={() => void list.refetch()}><RefreshCw className="size-4" /></Button>
        {list.data?.canManage && <>
          <Button variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw className="size-4" />{t(($) => $.work_orders.sync)}{syncPage > 1 ? ` (${syncPage})` : ""}</Button>
          <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>{t(($) => $.work_orders.config)}</Button>
          <Button size="sm" onClick={() => setImportOpen(true)}><Plus className="size-4" />{t(($) => $.work_orders.import)}</Button>
        </>}
      </div>
    </header>
    <div className="flex flex-wrap items-end gap-4 border-b border-surface-border p-4">
      {system && <div className="w-64"><OrderSelect disabled={sync.isPending} label={t(($) => $.work_orders.workspace)} value={target.wsId} onChange={(v) => { setWorkspaceId(v); setPage(1); setSyncPage(1); setSelected(null); }} options={(ws.data ?? []).map((v) => ({ value: v.id, label: v.name }))} empty={t(($) => $.work_orders.none)} /></div>}
      <Input className="max-w-sm" aria-label={t(($) => $.work_orders.search)} placeholder={t(($) => $.work_orders.search)} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <Tabs value={all ? "all" : "mine"} onValueChange={(v) => { setAll(v === "all"); setPage(1); }}>
        <TabsList><TabsTrigger value="mine">{t(($) => $.work_orders.mine)}</TabsTrigger><TabsTrigger value="all" disabled={!list.data?.canManage}>{t(($) => $.work_orders.all)}</TabsTrigger></TabsList>
      </Tabs>
    </div>
    {(ws.error || list.error) && <p role="alert" className="p-4 text-body text-destructive">{(ws.error || list.error)?.message}</p>}
    <div className="min-h-0 flex-1 overflow-auto">
      {list.isLoading ? <p className="p-8 text-body text-muted-foreground">{t(($) => $.work_orders.loading)}</p> :
        !list.data?.orders.length ? <p className="p-8 text-body text-muted-foreground">{t(($) => $.work_orders.empty)}</p> :
          <table className="w-full min-w-[640px] text-left text-body">
            <thead className="sticky top-0 bg-background text-caption text-muted-foreground"><tr>
              <th className="px-4 py-3">{t(($) => $.work_orders.external_id)}</th><th className="px-4 py-3">{t(($) => $.work_orders.subject)}</th>
              <th className="px-4 py-3">{t(($) => $.work_orders.version)}</th><th className="px-4 py-3">{t(($) => $.work_orders.stage)}</th>
              {list.data.canManage && <th className="px-4 py-3">{t(($) => $.work_orders.assignee)}</th>}
            </tr></thead>
            <tbody>{list.data.orders.map((o) => <tr key={o.id} className="border-t border-surface-border hover:bg-surface-hover">
              <td className="px-4 py-3 font-mono text-caption">{o.externalId}</td>
              <td className="max-w-lg px-4 py-3"><button className="w-full break-words text-left font-medium hover:underline" onClick={() => setSelected(o)}>{o.title}</button></td>
              <td className="max-w-56 break-words px-4 py-3 text-muted-foreground">{versions.data?.find((v) => v.value === o.productVersionId)?.label || `${o.sourceProduct} ${o.sourceVersion}`}</td>
              <td className="px-4 py-3">{stages.includes(o.stage as typeof stages[number]) ? t(($) => $.work_orders[o.stage as typeof stages[number]]) : o.stage}</td>
              {list.data.canManage && <td className="px-4 py-3">{members.data?.members.find((m) => m.id === o.assigneeId)?.name || (o.assigneeId ? o.assigneeId : t(($) => $.work_orders.unassigned))}</td>}
            </tr>)}</tbody>
          </table>}
    </div>
    <footer className="flex items-center justify-end gap-3 border-t border-surface-border p-3 text-caption">
      <span>{list.data?.total ?? 0}</span>
      <Button variant="ghost" size="icon-sm" disabled={page <= 1} aria-label={t(($) => $.work_orders.previous)} onClick={() => setPage(page - 1)}><ArrowLeft className="size-4" /></Button>
      <span>{page}</span>
      <Button variant="ghost" size="icon-sm" disabled={page * 50 >= (list.data?.total ?? 0)} aria-label={t(($) => $.work_orders.next)} onClick={() => setPage(page + 1)}><ArrowRight className="size-4" /></Button>
    </footer>
    {selected && <OrderEditor key={selected.id} initial={selected} target={target} manager={!!list.data?.canManage} workspaceSlug={system ? ws.data?.find((w) => w.id === target.wsId)?.slug ?? "" : workspace?.slug ?? ""} onClose={() => setSelected(null)} />}
    {importOpen && <OrderImport target={target} onClose={() => setImportOpen(false)} />}
    <Dialog open={configOpen} onOpenChange={setConfigOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{t(($) => $.work_orders.config)}</DialogTitle></DialogHeader><WorkOrderSettings target={target} /></DialogContent></Dialog>
  </div>;
  return system && !embedded ? <SystemManagementLayout><div className="h-svh min-w-0">{body}</div></SystemManagementLayout> : body;
}

function OrderEditor({ initial, target, manager, workspaceSlug, onClose }: {
  initial: WorkOrder; target: OrderTarget; manager: boolean; workspaceSlug: string; onClose: () => void;
}) {
  const { t, i18n } = useT("settings");
  const qc = useQueryClient();
  const [order, setOrder] = useState(initial);
  const [plan, setPlan] = useState<WorkOrderPlan | null>(initial.executionPlan);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [projectName, setProjectName] = useState(initial.sourceProject);
  const [rememberRefs, setRememberRefs] = useState(false);
  const versions = useVersionChoices();
  const members = useQuery({ queryKey: [...workOrderKeys.all(target), "members"], queryFn: () => api.getWorkOrderMembers(target), enabled: manager });
  const options = useQuery({ queryKey: [...workOrderKeys.all(target), "options"], queryFn: () => api.getWorkOrderOptions(target) });
  const history = useQuery({ queryKey: [...workOrderKeys.all(target), "detail", order.id], queryFn: () => api.getWorkOrder(target, order.id) });
  const matchingProjects = !order.customerProjectId ? options.data?.projects.filter((p) =>
    p.purpose !== "execution" && p.name.trim().toLocaleLowerCase() === projectName.trim().toLocaleLowerCase()) ?? [] : [];
  const matchingProject = matchingProjects.length === 1 ? matchingProjects[0] : undefined;
  const mutation = useMutation({
    mutationFn: async (action: "save" | "preview" | "prepare" | "convert") => {
      const draft = action === "prepare" && matchingProject ? {
        ...order, customerProjectId: matchingProject.id,
        productVersionId: order.productVersionId || matchingProject.productVersionId,
      } : order;
      let updated = await api.saveWorkOrder(target, draft);
      if (!updated) throw new Error(t(($) => $.work_orders.failed));
      setOrder(updated);
      if (action === "preview" || action === "prepare") {
        const preview = await api.previewWorkOrder(target, updated.id);
        if (!preview) throw new Error(t(($) => $.work_orders.failed));
        setPlan(preview);
        if (action === "prepare") setConfirmOpen(true);
      }
      if (action === "convert") {
        const registered = await api.registerWorkOrderProject(target, updated, projectName, rememberRefs);
        if (!registered) throw new Error(t(($) => $.work_orders.failed));
        updated = registered;
        setOrder(registered);
        const confirmedPlan = await api.previewWorkOrder(target, registered.id);
        if (!confirmedPlan) throw new Error(t(($) => $.work_orders.failed));
        setPlan(confirmedPlan);
        if (JSON.stringify(confirmedPlan) !== JSON.stringify(plan)) return false;
        const converted = await api.convertWorkOrder(target, updated.id);
        if (!converted.issueId) throw new Error(t(($) => $.work_orders.failed));
        const detail = await api.getWorkOrder(target, updated.id);
        if (!detail) throw new Error(t(($) => $.work_orders.failed));
        setOrder(detail.order);
        setPlan(detail.order.executionPlan);
        setConfirmOpen(false);
      }
      return true;
    },
    onSuccess: (result) => {
      if (result === false) toast.info(t(($) => $.work_orders.confirm_project));
      else toast.success(t(($) => $.work_orders.saved));
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workOrderKeys.all(target) });
      void qc.invalidateQueries({ queryKey: workOrderKeys.catalog });
    },
  });
  const stageOptions = stages.map((s) => ({ value: s, label: t(($) => $.work_orders[s]) }));
  const refSourceLabel = (source: string) => {
    switch (source) {
      case "baseline": return t(($) => $.work_orders.baseline_ref);
      case "project": return t(($) => $.work_orders.project_ref);
      case "ticket": return t(($) => $.work_orders.ticket_ref);
      default: return source;
    }
  };
  const eventLabel = (action: string) => {
    switch (action) {
      case "import": return t(($) => $.work_orders.event_import);
      case "sync": return t(($) => $.work_orders.event_sync);
      case "update": return t(($) => $.work_orders.event_update);
      case "convert": return t(($) => $.work_orders.event_convert);
      case "project_confirm": return t(($) => $.work_orders.event_project_confirm);
      default: return action;
    }
  };
  return <Dialog open onOpenChange={(v) => { if (!v && !mutation.isPending) onClose(); }}><DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-4xl">
    <DialogHeader className="shrink-0 pr-8"><DialogTitle className="break-words">{order.externalId} · {order.title}</DialogTitle></DialogHeader>
    <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto">
    {(versions.error || members.error || options.error || history.error) && <p role="alert" className="text-body text-destructive">{(versions.error || members.error || options.error || history.error)?.message}</p>}
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <OrderSelect label={t(($) => $.work_orders.version)} value={order.productVersionId} disabled={!!order.issueId} onChange={(v) => { setOrder({ ...order, productVersionId: v, branchOverrides: {} }); setPlan(null); }} options={versions.data ?? []} empty={t(($) => $.work_orders.none)} />
      <OrderSelect label={t(($) => $.work_orders.stage)} value={order.stage} onChange={(v) => setOrder({ ...order, stage: v || "pending" })} options={stageOptions} empty={t(($) => $.work_orders.none)} />
      {manager && <OrderSelect label={t(($) => $.work_orders.assignee)} value={order.assigneeId} onChange={(v) => setOrder({ ...order, assigneeId: v })} options={(members.data?.members ?? []).map((m) => ({ value: m.id, label: m.name || m.email }))} empty={t(($) => $.work_orders.unassigned)} />}
      <OrderSelect label={t(($) => $.work_orders.project)} value={order.customerProjectId} disabled={!!order.issueId} onChange={(v) => {
        const project = options.data?.projects.find((p) => p.id === v);
        setOrder({ ...order, customerProjectId: v,
          productVersionId: project?.productVersionId || order.productVersionId, branchOverrides: {} });
        setPlan(null);
      }} options={(options.data?.projects ?? []).filter((p) => p.purpose !== "execution").map((p) => ({ value: p.id, label: p.name }))} empty={t(($) => $.work_orders.new_project)} />
    </div>
    <OrderField label={t(($) => $.work_orders.description)}><div className="max-h-48 overflow-auto whitespace-pre-wrap break-words border border-surface-border p-3 text-body text-muted-foreground">{order.description}</div></OrderField>
    <OrderField label={t(($) => $.work_orders.draft)}><Textarea className="min-h-32" value={order.draft} onChange={(e) => setOrder({ ...order, draft: e.target.value })} /></OrderField>
    {Object.entries(order.branchOverrides).filter(([key]) => !plan?.repos.some((r) => `${r.versionId}/${r.moduleKey}` === key)).map(([key, ref]) =>
      <OrderField key={key} label={key}><Input disabled={!!order.issueId} value={ref} onChange={(e) => setOrder({ ...order, branchOverrides: { ...order.branchOverrides, [key]: e.target.value } })} /></OrderField>)}
    {plan && <section className="min-w-0 overflow-auto border-y border-surface-border py-3">
      <h2 className="mb-2 text-body font-semibold">{t(($) => $.work_orders.preview)}</h2>
      {plan.repos.map((r) => <div key={`${r.versionId}/${r.moduleKey}`} className="mb-3 break-all text-caption">
        <div className="font-medium">{r.name || r.moduleKey} · {r.ref} ({refSourceLabel(r.refSource)})</div>
        <div>{r.repoUrl}</div><div className="font-mono">{r.directory}{r.subpath ? `/${r.subpath}` : ""}</div>
        {r.remark && <p className="whitespace-pre-wrap text-muted-foreground">{r.remark}</p>}
        <div className="text-muted-foreground">{r.kbPath}</div>
        <OrderField label={t(($) => $.work_orders.branches)}><Input disabled={!!order.issueId} placeholder={r.ref} value={order.branchOverrides[`${r.versionId}/${r.moduleKey}`] ?? ""} onChange={(e) => {
          const overrides = { ...order.branchOverrides };
          const key = `${r.versionId}/${r.moduleKey}`;
          if (e.target.value) overrides[key] = e.target.value; else delete overrides[key];
          setOrder({ ...order, branchOverrides: overrides });
        }} /></OrderField>
      </div>)}
    </section>}
    {!!history.data?.events.length && <section><h2 className="mb-2 text-body font-semibold">{t(($) => $.work_orders.history)}</h2>
      {history.data.events.map((e) => <div key={e.id} className="flex flex-wrap gap-3 text-caption text-muted-foreground"><time>{new Date(e.createdAt).toLocaleString(i18n.language)}</time><span>{eventLabel(e.action)}</span><span className="break-all">{e.actorId}</span></div>)}
    </section>}
    {mutation.error && <p role="alert" className="text-body text-destructive">{mutation.error.message}</p>}
    </div>
    <footer className="flex shrink-0 flex-wrap justify-end gap-2">
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate("preview")}>{t(($) => $.work_orders.preview)}</Button>
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate("save")}><Save className="size-4" />{t(($) => $.work_orders.save)}</Button>
      {order.issueId ? <AppLink className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-body text-primary-foreground" href={paths.workspace(workspaceSlug).issueDetail(order.issueId)}>{t(($) => $.work_orders.open)}</AppLink> :
        <Button disabled={mutation.isPending || !order.productVersionId || !options.data} onClick={() => mutation.mutate("prepare")}>{t(($) => $.work_orders.convert)}</Button>}
    </footer>
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!mutation.isPending) setConfirmOpen(open); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t(($) => $.work_orders.confirm_project)}</DialogTitle></DialogHeader>
        <dl className="space-y-3 text-body">
          <div><dt className="text-muted-foreground">{t(($) => $.work_orders.version)}</dt><dd className="break-words">{versions.data?.find((v) => v.value === order.productVersionId)?.label}</dd></div>
          {order.customerProjectId && <div><dt className="text-muted-foreground">{t(($) => $.work_orders.project)}</dt><dd className="break-words">{options.data?.projects.find((p) => p.id === order.customerProjectId)?.name}</dd></div>}
        </dl>
        {!order.customerProjectId && <OrderField label={t(($) => $.work_orders.project_name)}><Input disabled={mutation.isPending} maxLength={256} value={projectName} onChange={(e) => setProjectName(e.target.value)} /></OrderField>}
        <div className="max-h-48 space-y-2 overflow-y-auto border-y border-surface-border py-3">
          {plan?.repos.map((r) => <div key={`${r.versionId}/${r.moduleKey}`} className="break-all text-body">
            <span className="font-medium">{r.name || r.moduleKey}</span>
            <div className="font-mono text-caption">{r.ref} <span className="text-muted-foreground">({refSourceLabel(r.refSource)})</span></div>
          </div>)}
        </div>
        {!!Object.keys(order.branchOverrides).length && <label className="flex items-center gap-2 text-body">
          <Checkbox checked={rememberRefs} disabled={mutation.isPending} onCheckedChange={(v) => setRememberRefs(v === true)} />
          <span>{t(($) => $.work_orders.remember_branches)}</span>
        </label>}
        {mutation.error && <p role="alert" className="text-body text-destructive">{mutation.error.message}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={mutation.isPending} onClick={() => setConfirmOpen(false)}>{t(($) => $.work_orders.cancel)}</Button>
          <Button disabled={mutation.isPending || (!order.customerProjectId && !projectName.trim())} onClick={() => mutation.mutate(matchingProject ? "prepare" : "convert")}>
            {t(($) => matchingProject ? $.work_orders.confirm_project : $.work_orders.confirm_convert)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </DialogContent></Dialog>;
}

function OrderImport({ target, onClose }: { target: OrderTarget; onClose: () => void }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const versions = useVersionChoices();
  const members = useQuery({ queryKey: [...workOrderKeys.all(target), "members"], queryFn: () => api.getWorkOrderMembers(target) });
  const [draft, setDraft] = useState({ externalId: "", title: "", description: "", assigneeId: "", productVersionId: "" });
  const mutation = useMutation({
    mutationFn: async () => { const result = await api.importWorkOrder(target, draft); if (!result) throw new Error(t(($) => $.work_orders.failed)); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: workOrderKeys.all(target) }); onClose(); },
  });
  return <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}><DialogContent className="max-h-[85vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{t(($) => $.work_orders.import)}</DialogTitle></DialogHeader>
    <OrderField label={t(($) => $.work_orders.external_id)}><Input value={draft.externalId} onChange={(e) => setDraft({ ...draft, externalId: e.target.value })} /></OrderField>
    <OrderField label={t(($) => $.work_orders.subject)}><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></OrderField>
    <OrderField label={t(($) => $.work_orders.description)}><Textarea className="min-h-32" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></OrderField>
    <OrderSelect label={t(($) => $.work_orders.version)} value={draft.productVersionId} onChange={(v) => setDraft({ ...draft, productVersionId: v })} options={versions.data ?? []} empty={t(($) => $.work_orders.none)} />
    <OrderSelect label={t(($) => $.work_orders.assignee)} value={draft.assigneeId} onChange={(v) => setDraft({ ...draft, assigneeId: v })} options={(members.data?.members ?? []).map((m) => ({ value: m.id, label: m.name || m.email }))} empty={t(($) => $.work_orders.unassigned)} />
    {(versions.error || members.error) && <p role="alert" className="text-body text-destructive">{(versions.error || members.error)?.message}</p>}
    {mutation.error && <p role="alert" className="text-body text-destructive">{mutation.error.message}</p>}
    <Button disabled={mutation.isPending || !draft.externalId.trim() || !draft.title.trim()} onClick={() => mutation.mutate()}>{t(($) => $.work_orders.import)}</Button>
  </DialogContent></Dialog>;
}
