"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FileArchive,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@multica/core/api";
import {
  systemProcessTemplateListOptions,
  useCreateSystemProcessTemplate,
  useDeleteSystemProcessTemplate,
  useUpdateSystemProcessTemplate,
} from "@multica/core/process-templates";
import type { ProcessTemplate } from "@multica/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Label as FieldLabel } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { CollapsedNavTrigger } from "../layout/page-header";
import { useT } from "../i18n";
import { SystemManagementLayout } from "./system-management-layout";

const MAX_ZIP_BYTES = 20 * 1024 * 1024;

interface TemplateDraft {
  name: string;
  description: string;
  slug: string;
  file: File | null;
}

const EMPTY_DRAFT: TemplateDraft = { name: "", description: "", slug: "", file: null };

export function ProcessTemplateManagementPage() {
  const { t } = useT("settings");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessTemplate | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProcessTemplate | null>(null);

  const listQuery = useQuery(systemProcessTemplateListOptions());
  const templates = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const isForbidden = listQuery.error instanceof ApiError && listQuery.error.status === 403;
  const isUnauthorized = listQuery.error instanceof ApiError && listQuery.error.status === 401;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return templates;
    return templates.filter((template) =>
      [template.name, template.description, template.slug].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [templates, query]);

  if (isForbidden || isUnauthorized) {
    return (
      <SystemManagementLayout>
        <SystemPageShell
          title={t(($) => $.process_templates.title)}
          eyebrow={t(($) => $.system_management.title)}
        >
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-12 text-center">
            <p className="text-body font-medium">
              {isUnauthorized
                ? t(($) => $.process_templates.unauthorized)
                : t(($) => $.process_templates.system_admin_required)}
            </p>
          </div>
        </SystemPageShell>
      </SystemManagementLayout>
    );
  }

  return (
    <SystemManagementLayout>
      <SystemPageShell
        title={t(($) => $.process_templates.title)}
        description={t(($) => $.process_templates.system_description)}
        eyebrow={t(($) => $.system_management.title)}
      >
        <div className="flex gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t(($) => $.process_templates.search_placeholder)}
              className="pl-9"
            />
          </div>
          <Button className="shrink-0 gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t(($) => $.process_templates.new_template)}
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-surface-border bg-card">
          <div className="hidden grid-cols-[minmax(10rem,1.2fr)_minmax(12rem,1.4fr)_6rem_minmax(10rem,1fr)_2rem] gap-4 border-b border-surface-border bg-muted/20 px-4 py-2.5 text-caption font-medium text-muted-foreground md:grid">
            <span>{t(($) => $.process_templates.columns.name)}</span>
            <span>{t(($) => $.process_templates.columns.description)}</span>
            <span>{t(($) => $.process_templates.columns.version)}</span>
            <span>{t(($) => $.process_templates.columns.zip)}</span>
            <span />
          </div>

          {listQuery.isLoading ? (
            <div className="px-4 py-12 text-center text-body text-muted-foreground">
              {t(($) => $.process_templates.loading)}
            </div>
          ) : listQuery.error ? (
            <div className="px-4 py-12 text-center text-body text-destructive">
              {listQuery.error instanceof Error
                ? listQuery.error.message
                : t(($) => $.process_templates.load_failed)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Workflow className="mx-auto size-6 text-faint-foreground" />
              <p className="mt-3 text-body font-medium">
                {query
                  ? t(($) => $.process_templates.no_results)
                  : t(($) => $.process_templates.empty)}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {filtered.map((template) => (
                <div
                  key={template.id}
                  className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(10rem,1.2fr)_minmax(12rem,1.4fr)_6rem_minmax(10rem,1fr)_2rem] md:items-center md:gap-4"
                >
                  <div className="min-w-0">
                    <span className="truncate text-body font-medium">{template.name}</span>
                    {template.slug ? (
                      <p className="truncate text-caption text-muted-foreground">{template.slug}</p>
                    ) : null}
                  </div>
                  <p className="min-w-0 truncate text-caption text-muted-foreground md:text-body">
                    {template.description || t(($) => $.process_templates.not_set)}
                  </p>
                  <span className="text-body">
                    {template.latest_version
                      ? `v${template.latest_version.version}`
                      : t(($) => $.process_templates.not_set)}
                  </span>
                  <div className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground md:text-body">
                    <FileArchive className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {template.latest_version
                        ? `${template.latest_version.file_name || t(($) => $.process_templates.zip_unnamed)} (${formatBytes(template.latest_version.file_size)})`
                        : t(($) => $.process_templates.not_set)}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t(($) => $.process_templates.actions.open, {
                            name: template.name,
                          })}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!template.latest_version}
                        onClick={() => {
                          if (!template.latest_version) return;
                          void downloadTemplate(template, t(($) => $.process_templates.download_failed));
                        }}
                      >
                        <Download className="size-4" />
                        {t(($) => $.process_templates.actions.download)}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditing(template)}>
                        <Pencil className="size-4" />
                        {t(($) => $.process_templates.actions.edit)}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setPendingDelete(template)}
                      >
                        <Trash2 className="size-4" />
                        {t(($) => $.process_templates.actions.delete)}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </div>

        <TemplateEditorDialog open={createOpen} onOpenChange={setCreateOpen} />
        <TemplateEditorDialog
          open={Boolean(editing)}
          onOpenChange={(open) => !open && setEditing(null)}
          template={editing}
        />
        <DeleteTemplateDialog template={pendingDelete} onClose={() => setPendingDelete(null)} />
      </SystemPageShell>
    </SystemManagementLayout>
  );
}

function SystemPageShell({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 md:p-8">
        <header className="mb-8 border-b border-surface-border pb-6">
          <CollapsedNavTrigger />
          <p className="mb-2 text-caption font-medium uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="text-title-lg font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-body leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </header>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

function TemplateEditorDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ProcessTemplate | null;
}) {
  const { t } = useT("settings");
  const create = useCreateSystemProcessTemplate();
  const update = useUpdateSystemProcessTemplate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(
      template
        ? { name: template.name, description: template.description ?? "", slug: template.slug ?? "", file: null }
        : EMPTY_DRAFT,
    );
    if (fileRef.current) fileRef.current.value = "";
  }, [open, template]);

  const submit = () => {
    const name = draft.name.trim();
    if (!name) return;
    if (!template && !draft.file) {
      toast.error(t(($) => $.process_templates.zip_required));
      return;
    }
    if (draft.file && draft.file.size > MAX_ZIP_BYTES) {
      toast.error(t(($) => $.process_templates.zip_too_large));
      return;
    }
    const data = {
      name,
      description: draft.description.trim(),
      slug: draft.slug.trim() || undefined,
      file: draft.file,
    };
    const options = {
      onSuccess: () => onOpenChange(false),
      onError: (error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : t(($) => $.process_templates.save_failed),
        ),
    };
    if (template) {
      update.mutate({ id: template.id, ...data }, options);
    } else {
      create.mutate(data, options);
    }
  };

  const saving = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {template
              ? t(($) => $.process_templates.editor.edit_title)
              : t(($) => $.process_templates.editor.create_title)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.process_templates.editor.description)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <FieldLabel htmlFor="process-template-name">
              {t(($) => $.process_templates.editor.name)}
            </FieldLabel>
            <Input
              id="process-template-name"
              autoFocus
              required
              maxLength={160}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={t(($) => $.process_templates.editor.name_placeholder)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="process-template-slug">
              {t(($) => $.process_templates.editor.slug)}
            </FieldLabel>
            <Input
              id="process-template-slug"
              maxLength={128}
              value={draft.slug}
              onChange={(event) =>
                setDraft((current) => ({ ...current, slug: event.target.value }))
              }
              placeholder={t(($) => $.process_templates.editor.slug_placeholder)}
            />
            <p className="text-caption text-muted-foreground">
              {t(($) => $.process_templates.editor.slug_hint)}
            </p>
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="process-template-description">
              {t(($) => $.process_templates.editor.description_label)}
            </FieldLabel>
            <Textarea
              id="process-template-description"
              rows={4}
              maxLength={4000}
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder={t(($) => $.process_templates.editor.description_placeholder)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="process-template-zip">
              {t(($) => $.process_templates.editor.zip)}
            </FieldLabel>
            <input
              ref={fileRef}
              id="process-template-zip"
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && file.size > MAX_ZIP_BYTES) {
                  toast.error(t(($) => $.process_templates.zip_too_large));
                  event.target.value = "";
                  setDraft((current) => ({ ...current, file: null }));
                  return;
                }
                setDraft((current) => ({ ...current, file }));
              }}
            />
            <div className="flex gap-2">
              <Input
                readOnly
                value={
                  draft.file?.name
                  || (template?.latest_version?.file_name && !draft.file
                    ? template.latest_version.file_name
                    : "")
                }
                placeholder={t(($) => $.process_templates.editor.zip_placeholder)}
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                {t(($) => $.process_templates.editor.choose_zip)}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              {template
                ? t(($) => $.process_templates.editor.zip_optional)
                : t(($) => $.process_templates.editor.zip_hint)}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t(($) => $.process_templates.editor.cancel)}
          </Button>
          <Button
            onClick={submit}
            disabled={!draft.name.trim() || saving || (!template && !draft.file)}
          >
            {saving
              ? t(($) => $.process_templates.editor.saving)
              : t(($) => $.process_templates.editor.save)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTemplateDialog({
  template,
  onClose,
}: {
  template: ProcessTemplate | null;
  onClose: () => void;
}) {
  const { t } = useT("settings");
  const remove = useDeleteSystemProcessTemplate();

  return (
    <AlertDialog open={Boolean(template)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(($) => $.process_templates.delete_dialog.title)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $.process_templates.delete_dialog.description, {
              name: template?.name ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {t(($) => $.process_templates.delete_dialog.cancel)}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={() => {
              if (!template) return;
              remove.mutate(template.id, {
                onSuccess: onClose,
                onError: (error) =>
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t(($) => $.process_templates.delete_dialog.failed),
                  ),
              });
            }}
          >
            {remove.isPending
              ? t(($) => $.process_templates.delete_dialog.deleting)
              : t(($) => $.process_templates.delete_dialog.confirm)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

async function downloadTemplate(template: ProcessTemplate, failed: string) {
  if (!template.latest_version) return;
  try {
    const { blob, fileName } = await api.downloadSystemProcessTemplateVersion(
      template.id,
      template.latest_version.id,
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || template.latest_version.file_name || "process-template.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : failed);
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
