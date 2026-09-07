"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Folder,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@multica/core/api";
import {
  systemProductListOptions,
  useCreateSystemProduct,
  useDeleteSystemProduct,
  useUpdateSystemProduct,
} from "@multica/core/system-products";
import type { Product } from "@multica/core/types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Label as FieldLabel } from "@multica/ui/components/ui/label";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { CollapsedNavTrigger } from "../layout/page-header";
import { useT } from "../i18n";
import { SystemManagementLayout } from "./system-management-layout";

interface ProductDraft {
  name: string;
  directory: string;
  remark: string;
}

const EMPTY_DRAFT: ProductDraft = {
  name: "",
  directory: "",
  remark: "",
};

export function ProductManagementPage() {
  const { t } = useT("settings");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);

  const productQuery = useQuery({
    ...systemProductListOptions(),
  });
  const products = useMemo(
    () => productQuery.data ?? [],
    [productQuery.data],
  );
  const isForbidden =
    productQuery.error instanceof ApiError && productQuery.error.status === 403;

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter((product) =>
      [product.name, product.directory, product.remark].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [products, query]);

  if (isForbidden) {
    return (
      <SystemManagementLayout>
        <SystemPageShell
          title={t(($) => $.products.title)}
          eyebrow={t(($) => $.system_management.title)}
        >
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-12 text-center">
            <p className="text-body font-medium">
              {t(($) => $.products.system_admin_required)}
            </p>
          </div>
        </SystemPageShell>
      </SystemManagementLayout>
    );
  }

  return (
    <SystemManagementLayout>
      <SystemPageShell
        title={t(($) => $.products.title)}
        description={t(($) => $.products.system_description)}
        eyebrow={t(($) => $.system_management.title)}
      >
        <div className="space-y-5">
        <div className="flex flex-col gap-3 border-b border-surface-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1" />
          <div className="flex w-full gap-3 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t(($) => $.products.search_placeholder)}
                className="pl-9"
              />
            </div>
            <Button className="shrink-0 gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t(($) => $.products.new_product)}
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-surface-border bg-card">
            <div className="hidden grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.2fr)_minmax(10rem,1fr)_2rem] gap-4 border-b border-surface-border bg-muted/20 px-4 py-2.5 text-caption font-medium text-muted-foreground md:grid">
              <span>{t(($) => $.products.columns.name)}</span>
              <span>{t(($) => $.products.columns.directory)}</span>
              <span>{t(($) => $.products.columns.remark)}</span>
              <span />
            </div>

            {productQuery.isLoading ? (
              <div className="px-4 py-12 text-center text-body text-muted-foreground">
                {t(($) => $.products.loading)}
              </div>
            ) : productQuery.error ? (
              <div className="px-4 py-12 text-center text-body text-destructive">
                {productQuery.error instanceof Error
                  ? productQuery.error.message
                  : t(($) => $.products.load_failed)}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Package className="mx-auto size-6 text-faint-foreground" />
                <p className="mt-3 text-body font-medium">
                  {query ? t(($) => $.products.no_results) : t(($) => $.products.empty)}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-surface-border">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.2fr)_minmax(10rem,1fr)_2rem] md:items-center md:gap-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Package className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-body font-medium">{product.name}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground md:text-body">
                      <Folder className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {product.directory || t(($) => $.products.not_set)}
                      </span>
                    </div>
                    <p className="min-w-0 truncate text-caption text-muted-foreground md:text-body">
                      {product.remark || t(($) => $.products.not_set)}
                    </p>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t(($) => $.products.actions.open, { name: product.name })}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(product)}>
                          <Pencil className="size-4" />
                          {t(($) => $.products.actions.edit)}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setPendingDelete(product)}
                        >
                          <Trash2 className="size-4" />
                          {t(($) => $.products.actions.delete)}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
        </div>
        </div>

        <ProductEditorDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
        <ProductEditorDialog
          open={Boolean(editing)}
          onOpenChange={(open) => !open && setEditing(null)}
          product={editing}
        />
        <DeleteProductDialog
          product={pendingDelete}
          onClose={() => setPendingDelete(null)}
        />
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
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
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
        {children}
      </div>
    </div>
  );
}

function ProductEditorDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
}) {
  const { t } = useT("settings");
  const create = useCreateSystemProduct();
  const update = useUpdateSystemProduct();
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(
      product
        ? {
            name: product.name,
            directory: product.directory,
            remark: product.remark,
          }
        : EMPTY_DRAFT,
    );
  }, [open, product]);

  const submit = () => {
    const name = draft.name.trim();
    if (!name) return;
    const data = {
      name,
      directory: draft.directory.trim(),
      remark: draft.remark.trim(),
    };
    const options = {
      onSuccess: () => onOpenChange(false),
      onError: (error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : t(($) => $.products.save_failed),
        ),
    };
    if (product) {
      update.mutate({ id: product.id, ...data }, options);
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
            {product
              ? t(($) => $.products.editor.edit_title)
              : t(($) => $.products.editor.create_title)}
          </DialogTitle>
          <DialogDescription>{t(($) => $.products.editor.description)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <FieldLabel htmlFor="system-product-name">{t(($) => $.products.editor.name)}</FieldLabel>
            <Input
              id="system-product-name"
              autoFocus
              required
              maxLength={128}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder={t(($) => $.products.editor.name_placeholder)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="system-product-directory">
              {t(($) => $.products.editor.directory)}
            </FieldLabel>
            <Input
              id="system-product-directory"
              maxLength={1024}
              value={draft.directory}
              onChange={(event) =>
                setDraft((current) => ({ ...current, directory: event.target.value }))
              }
              placeholder={t(($) => $.products.editor.directory_placeholder)}
            />
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="system-product-remark">{t(($) => $.products.editor.remark)}</FieldLabel>
            <Textarea
              id="system-product-remark"
              rows={3}
              maxLength={2000}
              value={draft.remark}
              onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))}
              placeholder={t(($) => $.products.editor.remark_placeholder)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t(($) => $.products.editor.cancel)}
          </Button>
          <Button onClick={submit} disabled={!draft.name.trim() || saving}>
            {saving ? t(($) => $.products.editor.saving) : t(($) => $.products.editor.save)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProductDialog({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const { t } = useT("settings");
  const remove = useDeleteSystemProduct();

  return (
    <AlertDialog open={Boolean(product)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(($) => $.products.delete_dialog.title)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $.products.delete_dialog.description, { name: product?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {t(($) => $.products.delete_dialog.cancel)}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={() => {
              if (!product) return;
              remove.mutate(product.id, {
                onSuccess: onClose,
                onError: (error) =>
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t(($) => $.products.delete_dialog.failed),
                  ),
              });
            }}
          >
            {remove.isPending
              ? t(($) => $.products.delete_dialog.deleting)
              : t(($) => $.products.delete_dialog.confirm)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
