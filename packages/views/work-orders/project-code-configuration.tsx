"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { workOrderKeys, type CustomerProject } from "@multica/core/work-orders";
import type { ProductVersion } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { GitBranch, Pencil, Save } from "@multica/ui/icons";
import { toast } from "sonner";
import { useT } from "../i18n";
import { projectBranchName } from "./branch-name";
import { OrderField } from "./controls";
import { useVersionChoices } from "./queries";
import { VersionCodeDialog } from "./version-code-dialog";

export function ProjectCodeConfiguration({ project, versionId }: { project: CustomerProject; versionId: string }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const versions = useVersionChoices();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editingVersion, setEditingVersion] = useState<ProductVersion | null>(null);
  const branches = useQuery({
    queryKey: [...workOrderKeys.catalog, "branches", project.id],
    queryFn: () => api.getWorkOrderBranches(null, project.id),
  });
  const baseline = useQuery({
    queryKey: [...workOrderKeys.catalog, "project-baseline", versionId],
    queryFn: () => api.getWorkOrderProjectBaseline(null, versionId),
  });
  const defaultRef = (id: string, name: string) => projectBranchName(
    project.name, name || versions.data?.find((v) => v.value === id)?.version.name || id.slice(0, 8),
  );
  const currentRef = (id: string, key: string, name: string) => {
    const resourceId = branches.data?.bindings.find((b) => b.versionId === id && b.moduleKey === key)?.resourceId;
    const saved = branches.data?.resources.find((r) => r.id === resourceId)?.ref;
    return saved ?? defaultRef(id, name);
  };
  const products = [...new Set([
    versionId,
    ...(baseline.data?.repos.map((m) => m.versionId) ?? []),
    ...(baseline.data?.missingVersions.map((m) => m.versionId) ?? []),
  ])].map((id) => {
    const choice = versions.data?.find((v) => v.value === id);
    const missing = baseline.data?.missingVersions.find((v) => v.versionId === id);
    const repos = baseline.data?.repos.filter((m) => m.versionId === id) ?? [];
    const name = choice?.version.name ?? missing?.versionName ?? repos[0]?.versionName ?? "";
    return {
      id, repos, missing, version: choice?.version, name,
      label: choice?.label ?? `${missing?.productName ?? repos[0]?.productId ?? id} / ${name}`,
    };
  });
  const hasBlankRef = baseline.data?.repos.some((m) =>
    !(edits[`${m.versionId}/${m.moduleKey}`] ?? currentRef(m.versionId, m.moduleKey, m.versionName)).trim());
  const mutation = useMutation({
    mutationFn: async () => {
      const refs: Record<string, string> = {};
      for (const m of baseline.data?.repos ?? []) {
        const key = `${m.versionId}/${m.moduleKey}`;
        const ref = (edits[key] ?? currentRef(m.versionId, m.moduleKey, m.versionName)).trim();
        if (ref) refs[key] = ref;
      }
      const result = await api.saveWorkOrderProject(null, project.id, versionId, refs);
      if (!result.saved) throw new Error(t(($) => $.work_orders.failed));
      return refs;
    },
    onSuccess: async (refs) => {
      setEdits(Object.fromEntries((baseline.data?.repos ?? []).map((m) => {
        const key = `${m.versionId}/${m.moduleKey}`;
        return [key, refs[key] ?? ""];
      })));
      await qc.invalidateQueries({ queryKey: workOrderKeys.catalog });
      await qc.invalidateQueries({ queryKey: ["work-orders"] });
      await qc.invalidateQueries({ queryKey: ["work-order-version-branches"] });
      toast.success(t(($) => $.work_orders.saved));
    },
  });
  const ready = !!baseline.data && !!branches.data && !baseline.error && !branches.error;
  const error = baseline.error || branches.error || mutation.error;
  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-body font-semibold">{t(($) => $.work_orders.code)}</h3>
      <Button variant="outline" disabled={!ready || mutation.isPending} onClick={() => {
        const next = { ...edits };
        for (const m of baseline.data?.repos ?? []) {
          const key = `${m.versionId}/${m.moduleKey}`;
          if (!(next[key] ?? currentRef(m.versionId, m.moduleKey, m.versionName)).trim()) {
            next[key] = defaultRef(m.versionId, m.versionName);
          }
        }
        setEdits(next);
      }}><GitBranch className="size-4" />{t(($) => $.work_orders.generate_project_branches)}</Button>
    </div>
    {(baseline.isLoading || branches.isLoading) && <p className="text-body text-muted-foreground">{t(($) => $.work_orders.loading)}</p>}
    {error && <p role="alert" className="break-words text-body text-destructive">{error.message}</p>}
    {baseline.isSuccess && !baseline.data && <p role="alert" className="text-body text-destructive">{t(($) => $.work_orders.failed)}</p>}
    {baseline.data && products.map((product) => <section key={product.id} aria-label={product.label}
      className="min-w-0 space-y-4 border-b border-surface-border pb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="min-w-0 break-words text-body font-semibold">{product.label}</h4>
        {product.id !== versionId && <span className="text-caption text-muted-foreground">{t(($) => $.work_orders.dependency_product)}</span>}
      </div>
      {product.missing && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div role="status" className="flex min-w-0 flex-wrap items-center gap-2 border-l-2 border-destructive pl-3 text-body">
          <span className="min-w-0 flex-1 break-words">{t(($) => $.work_orders.version_code_missing)}</span>
          {product.version && <Button variant="outline" disabled={mutation.isPending} onClick={() => {
            if (product.version) setEditingVersion(product.version);
          }}>
            <Pencil className="size-4" />{t(($) => $.work_orders.code)}
          </Button>}
        </div>
        <OrderField label={t(($) => $.work_orders.project_ref)}>
          <Input aria-label={`${product.label} / ${t(($) => $.work_orders.project_ref)}`} readOnly value={defaultRef(product.id, product.name)} />
        </OrderField>
      </div>}
      {product.repos.map((m) => {
        const key = `${m.versionId}/${m.moduleKey}`;
        const ref = edits[key] ?? currentRef(m.versionId, m.moduleKey, m.versionName);
        const name = m.name || m.moduleKey;
        return <div key={key} className="min-w-0 space-y-3">
          <h5 className="break-words text-body font-medium">{name}</h5>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <OrderField label={t(($) => $.work_orders.repository)}><Input readOnly value={m.repoUrl} /></OrderField>
            <OrderField label={t(($) => $.work_orders.checkout_directory)}><Input readOnly value={m.directory} /></OrderField>
            <OrderField label={t(($) => $.work_orders.baseline_ref)}><Input readOnly value={m.ref} /></OrderField>
            <OrderField label={t(($) => $.work_orders.project_ref)}>
              <Input aria-label={`${name} / ${t(($) => $.work_orders.project_ref)}`} className="min-w-0" value={ref}
                required disabled={!ready || mutation.isPending}
                onChange={(e) => setEdits({ ...edits, [key]: e.target.value })} />
            </OrderField>
            {m.subpath && <OrderField label={t(($) => $.work_orders.subpath)}><Input readOnly value={m.subpath} /></OrderField>}
            {m.remark && <div className="min-w-0 text-caption sm:col-span-2">
              <span className="text-muted-foreground">{t(($) => $.products.columns.remark)}</span>
              <p className="whitespace-pre-wrap break-words">{m.remark}</p>
            </div>}
          </div>
        </div>;
      })}
    </section>)}
    <Button disabled={!ready || hasBlankRef || mutation.isPending} aria-busy={mutation.isPending} onClick={() => mutation.mutate()}>
      <Save className="size-4" />{t(($) => $.work_orders.save)}
    </Button>
    {editingVersion && <VersionCodeDialog version={editingVersion} shared onClose={() => setEditingVersion(null)} />}
  </section>;
}
