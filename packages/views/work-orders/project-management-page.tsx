"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@multica/core/api";
import { workOrderKeys, type CustomerProject } from "@multica/core/work-orders";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@multica/ui/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogTrigger } from "@multica/ui/components/ui/alert-dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@multica/ui/components/ui/tooltip";
import { ChevronDown, Folder, Save, Search, Plus, Pencil, Trash2 } from "@multica/ui/icons";
import { toast } from "sonner";
import { useT } from "../i18n";
import { CollapsedNavTrigger } from "../layout/page-header";
import { SystemManagementLayout } from "../system-management/system-management-layout";
import { OrderField } from "./controls";
import { useVersionChoices } from "./queries";
import { ProductVersionPickerDialog, type PickerProduct } from "./product-version-picker";
import { ProjectCodeConfiguration } from "./project-code-configuration";

export function ProjectManagementPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useT("settings");
  const body = <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-3">
      <CollapsedNavTrigger /><Folder className="size-5 text-muted-foreground" />
      <h1 className="text-title-sm font-semibold">{t(($) => $.work_orders.project_management)}</h1>
    </header>
    <ProjectList />
  </div>;
  return embedded ? body : <SystemManagementLayout><div className="h-svh min-w-0">{body}</div></SystemManagementLayout>;
}

function ProjectList() {
  const { t } = useT("settings");
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const versions = useVersionChoices();
  const options = useQuery({ queryKey: [...workOrderKeys.catalog, "list"], queryFn: () => api.listCustomerProjects() });
  const projects = (options.data?.projects ?? []).filter((p) => p.purpose !== "execution");
  const project = projects.find((p) => p.id === projectId);
  return <div className="grid min-h-0 flex-1 overflow-auto md:grid-cols-[280px_minmax(0,1fr)]">
    <aside className="border-b border-surface-border p-4 md:overflow-y-auto md:border-b-0 md:border-r">
      <div className="mb-3"><ProjectNameEditor onSaved={(p) => { setSearch(""); setProjectId(p.id); }} /></div>
      <div className="relative mb-3"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" aria-label={t(($) => $.work_orders.search_projects)} placeholder={t(($) => $.work_orders.search_projects)} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {options.isLoading && <p className="text-body text-muted-foreground">{t(($) => $.work_orders.loading)}</p>}
      {options.error && <p role="alert" className="text-body text-destructive">{options.error.message}</p>}
      {!options.isLoading && !options.error && projects.length === 0 &&
        <p className="py-4 text-body text-muted-foreground">{t(($) => $.work_orders.no_projects)}</p>}
      {projects.length > 0 && !projects.some((p) => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) &&
        <p className="py-4 text-body text-muted-foreground">{t(($) => $.work_orders.no_matching_projects)}</p>}
      {projects.filter((p) => p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((p) =>
        <button key={p.id} onClick={() => setProjectId(p.id)} aria-pressed={projectId === p.id}
          className={`mb-1 flex w-full min-w-0 flex-col gap-1 rounded-md px-3 py-3 text-left text-body ${projectId === p.id ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
          <span className="break-words font-medium">{p.name}</span>
          <span className="break-words text-caption text-muted-foreground">{versions.data?.find((v) => v.value === p.productVersionId)?.label || t(($) => $.work_orders.none)}</span>
        </button>)}
    </aside>
    <main className="min-w-0 p-4 md:overflow-y-auto md:p-6">
      {project ? <ProjectConfiguration key={project.id} project={project} onDeleted={() => setProjectId("")} /> :
        <p className="py-8 text-body text-muted-foreground">{t(($) => $.work_orders.select_project)}</p>}
    </main>
  </div>;
}

function ProjectNameEditor({ project, onSaved }: { project?: CustomerProject; onSaved?: (p: CustomerProject) => void }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const title = project ? t(($) => $.work_orders.edit_project) : t(($) => $.work_orders.create_project);
  const mutation = useMutation({
    mutationFn: async () => {
      const result = project ? await api.renameCustomerProject(project.id, name.trim()) : await api.createCustomerProject(name.trim());
      if (!result) throw new Error(t(($) => $.work_orders.failed));
      return result;
    },
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: workOrderKeys.catalog });
      await qc.invalidateQueries({ queryKey: ["work-orders"] });
      onSaved?.(result);
      setOpen(false);
      toast.success(t(($) => $.work_orders.saved));
    },
  });
  return <Dialog open={open} onOpenChange={(value) => {
    if (mutation.isPending) return;
    if (value) { setName(project?.name ?? ""); mutation.reset(); }
    setOpen(value);
  }}>
    {project ? <Tooltip><TooltipTrigger render={<DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={title} />} />}>
      <Pencil className="size-4" />
    </TooltipTrigger><TooltipContent>{title}</TooltipContent></Tooltip> :
      <DialogTrigger render={<Button variant="outline" className="w-full" />}><Plus className="size-4" />{title}</DialogTrigger>}
    <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && !mutation.isPending) mutation.mutate(); }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2 py-5">
          <label htmlFor="customer-project-name" className="text-body font-medium">{t(($) => $.work_orders.project_name)}</label>
          <Input id="customer-project-name" autoFocus required maxLength={256} value={name} disabled={mutation.isPending} onChange={(e) => setName(e.target.value)} />
          {mutation.error && <p role="alert" className="text-body text-destructive">{mutation.error instanceof ApiError && mutation.error.status === 409 ?
            t(($) => $.work_orders.project_name_exists) : t(($) => $.work_orders.failed)}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>{t(($) => $.work_orders.cancel)}</Button>
          <Button type="submit" disabled={!name.trim() || mutation.isPending} aria-busy={mutation.isPending}><Save className="size-4" />{t(($) => $.work_orders.save)}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function DeleteProject({ project, onDeleted }: { project: CustomerProject; onDeleted: () => void }) {
  const { t } = useT("settings");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!(await api.deleteCustomerProject(project.id)).saved) throw new Error(t(($) => $.work_orders.failed));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: workOrderKeys.catalog });
      await qc.invalidateQueries({ queryKey: ["work-orders"] });
      setOpen(false);
      onDeleted();
      toast.success(t(($) => $.work_orders.project_deleted));
    },
  });
  const title = t(($) => $.work_orders.delete_project);
  return <AlertDialog open={open} onOpenChange={(value) => {
    if (mutation.isPending) return;
    if (value) mutation.reset();
    setOpen(value);
  }}>
    <Tooltip><TooltipTrigger render={<AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={title} />} />}>
      <Trash2 className="size-4" />
    </TooltipTrigger><TooltipContent>{title}</TooltipContent></Tooltip>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{t(($) => $.work_orders.delete_project_description, { name: project.name })}</AlertDialogDescription>
      </AlertDialogHeader>
      {mutation.error && <p role="alert" className="text-body text-destructive">{mutation.error instanceof ApiError && mutation.error.status === 409 ?
        t(($) => $.work_orders.project_in_use) : t(($) => $.work_orders.failed)}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={mutation.isPending}>{t(($) => $.work_orders.cancel)}</AlertDialogCancel>
        <Button variant="destructive" disabled={mutation.isPending} aria-busy={mutation.isPending} onClick={() => mutation.mutate()}>
          <Trash2 className="size-4" />{title}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function ProjectConfiguration({ project, onDeleted }: { project: CustomerProject; onDeleted: () => void }) {
  const { t } = useT("settings");
  const versions = useVersionChoices();
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const versionId = selectedVersion ?? project.productVersionId;
  const current = versions.data?.find((v) => v.value === versionId);
  const version = current?.version;
  const pickerProducts = useMemo<PickerProduct[]>(() => {
    const products = new Map<string, PickerProduct>();
    for (const choice of versions.data ?? []) {
      const product = products.get(choice.productId) ?? { id: choice.productId, name: choice.productName, versions: [] };
      product.versions.push({ id: choice.version.id, name: choice.version.name });
      products.set(choice.productId, product);
    }
    return [...products.values()];
  }, [versions.data]);
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-3">
      <h2 className="min-w-0 break-words text-title-sm font-semibold">{project.name}</h2>
      <div className="flex shrink-0 items-center gap-1">
        <ProjectNameEditor project={project} />
        <DeleteProject project={project} onDeleted={onDeleted} />
      </div>
    </div>
    {versions.error && <p role="alert" className="text-body text-destructive">{versions.error.message}</p>}
    <div className="max-w-lg"><OrderField label={t(($) => $.work_orders.version)}>
      <Button type="button" variant="outline" className="w-full justify-between" disabled={versions.isLoading || !!versions.error} onClick={() => setPickerOpen(true)}>
        <span className="min-w-0 truncate">{current?.label ?? t(($) => $.work_orders.none)}</span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </Button>
    </OrderField></div>
    {pickerOpen && <ProductVersionPickerDialog products={pickerProducts} title={t(($) => $.work_orders.select_product_version)}
      selectedVersionId={versionId} onClose={() => setPickerOpen(false)}
      onSelect={(_productId, id) => { setSelectedVersion(id); setPickerOpen(false); }} />}
    {version && <ProjectCodeConfiguration key={version.id} project={project} versionId={version.id} />}
  </div>;
}
