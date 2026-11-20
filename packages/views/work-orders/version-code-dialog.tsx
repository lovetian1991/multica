"use client";

import { useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { EMPTY_CODE, versionDirectoryName, type CodeModule, type VersionCode } from "@multica/core/work-orders";
import type { ProductVersion } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@multica/ui/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Plus, Save, Trash2 } from "@multica/ui/icons";
import { useT } from "../i18n";
import { OrderField } from "./controls";
import { DependencyEditor, useDependencyChoices } from "./dependency-editor";

function emptyModule(): CodeModule {
  return { key: "", name: "", repoUrl: "", ref: "", directory: "", subpath: "", remark: "", images: [] };
}

export function VersionCodeDialog({ version, onClose, shared = false }: {
  version: ProductVersion; onClose: () => void; shared?: boolean;
}) {
  const { t } = useT("settings");
  const code = useQuery({ queryKey: ["version-code", version.id], queryFn: () => api.getVersionCode(version.product_id, version.id) });
  const saving = useIsMutating({ mutationKey: ["save-version-code", version.id] }) > 0;
  return <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}><DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-4xl">
    <DialogHeader className="pr-8"><DialogTitle className="break-words">{version.name} · {t(($) => $.work_orders.code)}</DialogTitle></DialogHeader>
    {shared && <p className="text-caption text-muted-foreground">{t(($) => $.work_orders.shared_version_notice)}</p>}
    {code.error ? <p role="alert" className="text-body text-destructive">{code.error.message}</p> :
      code.data ? <VersionCodeForm version={version} initial={code.data} onClose={onClose} /> : <p>{t(($) => $.work_orders.loading)}</p>}
  </DialogContent></Dialog>;
}

function VersionCodeForm({ version, initial, onClose }: { version: ProductVersion; initial: VersionCode; onClose: () => void }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const [draft, setDraft] = useState<VersionCode>(() => ({ ...EMPTY_CODE, ...initial }));
  const modules = draft.modules.length ? draft.modules : [{ ...emptyModule(), key: "main", name: t(($) => $.work_orders.main_repository) }];
  const [tab, setTab] = useState("modules");
  const [dependencyVersion, setDependencyVersion] = useState<ProductVersion | null>(null);
  const choices = useDependencyChoices();
  const mutation = useMutation({
    mutationKey: ["save-version-code", version.id],
    mutationFn: async () => {
      const result = await api.saveVersionCode(version.product_id, version.id, draft);
      if (!result) throw new Error(t(($) => $.work_orders.failed));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["version-code", version.id] });
      void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes("project-baseline") });
      void qc.invalidateQueries({ queryKey: ["work-order-dependency-choices"] });
      onClose();
    },
  });
  const update = (index: number, patch: Partial<CodeModule>) => setDraft({ ...draft, modules: modules.map((m, i) => i === index ? { ...m, ...patch } : m) });
  const product = choices.data?.find((p) => p.id === version.product_id);
  const versionDirectory = versionDirectoryName(version.name);
  const disabled = mutation.isPending || (tab === "modules" ? modules : draft.modules).some((m) => !m.key || !m.repoUrl || !m.ref);
  return <div className="flex min-h-0 flex-col gap-4">
    <Tabs value={tab} onValueChange={setTab} className="shrink-0">
      <TabsList className="grid w-full max-w-full grid-cols-3 items-stretch group-data-horizontal/tabs:h-auto sm:w-fit">
        <TabsTrigger value="modules" className="h-auto min-w-0 whitespace-normal px-2 py-1">{t(($) => $.work_orders.modules_code)}</TabsTrigger>
        <TabsTrigger value="dependencies" className="h-auto min-w-0 whitespace-normal px-2 py-1">{t(($) => $.work_orders.dependencies)}{draft.dependencies.length ? ` (${draft.dependencies.length})` : ""}</TabsTrigger>
        <TabsTrigger value="deployment" className="h-auto min-w-0 whitespace-normal px-2 py-1">{t(($) => $.work_orders.deployment)}</TabsTrigger>
      </TabsList>
    </Tabs>
    <div className="min-h-0 min-w-0 space-y-6 overflow-y-auto">
    {tab === "modules" && <>
    {product && !product.slug && <p role="alert" className="text-body text-destructive">{t(($) => $.work_orders.missing_slug)}</p>}
    {modules.map((m, index) => <section key={index} className="space-y-4 border-b border-surface-border pb-5">
      <div className="flex items-center justify-between"><h2 className="text-body font-semibold">{m.key === "main" ? t(($) => $.work_orders.main_repository) : `${t(($) => $.work_orders.module)} ${index + 1}`}</h2>
        <Button variant="ghost" size="icon-sm" disabled={mutation.isPending || modules.length === 1} title={t(($) => $.work_orders.remove)} aria-label={t(($) => $.work_orders.remove)} onClick={() => setDraft({ ...draft, modules: modules.filter((_, i) => i !== index) })}><Trash2 className="size-4" /></Button>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <OrderField label={t(($) => $.work_orders.key)}><Input value={m.key} onChange={(e) => update(index, { key: e.target.value })} /></OrderField>
        <OrderField label={t(($) => $.work_orders.name)}><Input value={m.name} onChange={(e) => update(index, { name: e.target.value })} /></OrderField>
        <OrderField label={t(($) => $.work_orders.repository)}><Input value={m.repoUrl} onChange={(e) => update(index, { repoUrl: e.target.value.trim() })} /></OrderField>
        <OrderField label={t(($) => $.work_orders.ref)}><Input value={m.ref} onChange={(e) => update(index, { ref: e.target.value.trim() })} /></OrderField>
        <OrderField label={t(($) => $.work_orders.checkout_directory)}><Input value={m.directory} placeholder={m.key || "main"} onChange={(e) => update(index, { directory: e.target.value.trim() })} /></OrderField>
        <OrderField label={t(($) => $.products.columns.remark)}><Input value={m.remark} onChange={(e) => update(index, { remark: e.target.value })} /></OrderField>
      </div>
      <div className="space-y-1 text-caption">
        <p className="text-muted-foreground">{t(($) => $.work_orders.checkout_directory_help)}</p>
        <p className="break-all font-mono">{`code/${product?.slug || "<product>"}/${versionDirectory}/${m.directory || m.key || "main"}/`}</p>
      </div>
      <details className="text-caption">
        <summary className="cursor-pointer text-muted-foreground">{t(($) => $.work_orders.subpath)}</summary>
        <div className="mt-2 space-y-2">
          <OrderField label={t(($) => $.work_orders.subpath)}><Input value={m.subpath} onChange={(e) => update(index, { subpath: e.target.value.trim() })} /></OrderField>
          <p className="text-muted-foreground">{t(($) => $.work_orders.subpath_help)}</p>
        </div>
      </details>
    </section>)}
    <Button variant="outline" disabled={mutation.isPending} onClick={() => setDraft({ ...draft, modules: [...modules, emptyModule()] })}><Plus className="size-4" />{t(($) => $.work_orders.add_module)}</Button>
    </>}
    {tab === "deployment" && <>
    {modules.map((m, index) => <section key={index} className="space-y-4 border-b border-surface-border pb-5">
      <h2 className="break-words text-body font-semibold">{m.name || m.key || `${t(($) => $.work_orders.module)} ${index + 1}`}</h2>
      <h3 className="text-body font-medium">{t(($) => $.work_orders.images)}</h3>
      {m.images.map((image, i) => <div key={i} className="grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_2fr_2fr_auto]">
        {(["service", "image", "ciUrl"] as const).map((key) => <OrderField key={key} label={t(($) => $.work_orders[key === "ciUrl" ? "ci_url" : key])}><Input value={image[key]} onChange={(e) => update(index, { images: m.images.map((v, n) => n === i ? { ...v, [key]: e.target.value } : v) })} /></OrderField>)}
        <Button variant="ghost" size="icon-sm" aria-label={t(($) => $.work_orders.remove)} onClick={() => update(index, { images: m.images.filter((_, n) => n !== i) })}><Trash2 className="size-4" /></Button>
      </div>)}
      <Button variant="outline" size="sm" onClick={() => update(index, { images: [...m.images, { service: "", image: "", ciUrl: "" }] })}><Plus className="size-4" />{t(($) => $.work_orders.image)}</Button>
    </section>)}
    <OrderField label={t(($) => $.work_orders.compose)}><Textarea className="min-h-40 font-mono text-caption" value={draft.compose} onChange={(e) => setDraft({ ...draft, compose: e.target.value })} /></OrderField>
    </>}
    {tab === "dependencies" && <DependencyEditor productId={version.product_id} dependencies={draft.dependencies}
      onChange={(dependencies) => setDraft({ ...draft, dependencies })} onEditVersion={setDependencyVersion} disabled={mutation.isPending} />}
    </div>
    {mutation.error && <p role="alert" className="text-body text-destructive">{mutation.error.message}</p>}
    <div className="flex justify-end"><Button disabled={disabled} onClick={() => mutation.mutate()}><Save className="size-4" />{t(($) => $.work_orders.save)}</Button></div>
    {dependencyVersion && <VersionCodeDialog version={dependencyVersion} onClose={() => setDependencyVersion(null)} />}
  </div>;
}
