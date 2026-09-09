"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Folder,
  FolderOpen,
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
import {
  productVersionListOptions,
  useCreateProductVersion,
  useDeleteProductVersion,
  useUpdateProductVersion,
} from "@multica/core/product-versions";
import type { Product, ProductVersion } from "@multica/core/types";
import type { KBFolder } from "@multica/core/types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@multica/ui/components/ui/alert-dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@multica/ui/components/ui/dropdown-menu";
import { Input } from "@multica/ui/components/ui/input";
import { Label as FieldLabel } from "@multica/ui/components/ui/label";
import { Switch } from "@multica/ui/components/ui/switch";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { CollapsedNavTrigger } from "../layout/page-header";
import { useT } from "../i18n";
import { SystemManagementLayout } from "./system-management-layout";
import { FolderPickerDialog } from "./folder-picker-dialog";

interface ProductDraft {
  name: string;
}

interface ProductVersionDraft {
  name: string;
  directory: string;
  remark: string;
  folder_id: string;
  enabled: boolean;
}

const EMPTY_PRODUCT_DRAFT: ProductDraft = {
  name: "",
};

const EMPTY_VERSION_DRAFT: ProductVersionDraft = {
  name: "",
  directory: "",
  remark: "",
  folder_id: "",
  enabled: true,
};

export function ProductVersionManagementPage() {
  const { t } = useT("settings");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [versionQuery, setVersionQuery] = useState("");
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null);
  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [editingVersion, setEditingVersion] = useState<ProductVersion | null>(null);
  const [pendingDeleteVersion, setPendingDeleteVersion] = useState<ProductVersion | null>(null);

  const productListQuery = useQuery({
    ...systemProductListOptions(),
  });
  const products = useMemo(
    () => productListQuery.data ?? [],
    [productListQuery.data],
  );
  const isForbidden =
    productListQuery.error instanceof ApiError && productListQuery.error.status === 403;

  const isUnauthorized =
    productListQuery.error instanceof ApiError && productListQuery.error.status === 401;

  const versionListQuery = useQuery({
    ...productVersionListOptions(selectedProduct?.id ?? ""),
    enabled: Boolean(selectedProduct?.id),
  });
  const versions = useMemo(
    () => versionListQuery.data ?? [],
    [versionListQuery.data],
  );

  const filteredProducts = useMemo(() => {
    const normalized = productQuery.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter((product) =>
      product.name.toLowerCase().includes(normalized),
    );
  }, [products, productQuery]);

  const filteredVersions = useMemo(() => {
    const normalized = versionQuery.trim().toLowerCase();
    if (!normalized) return versions;
    return versions.filter((version) =>
      [version.name, version.directory, version.remark].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [versions, versionQuery]);

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

  if (isUnauthorized) {
    return (
      <SystemManagementLayout>
        <SystemPageShell
          title={t(($) => $.products.title)}
          eyebrow={t(($) => $.system_management.title)}
        >
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-12 text-center">
            <p className="text-body font-medium">
              {t(($) => $.products.unauthorized)}
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
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* Left Panel: Products */}
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                  placeholder={t(($) => $.products.search_placeholder)}
                  className="pl-9"
                />
              </div>
              <Button
                className="shrink-0 gap-2"
                onClick={() => setCreateProductOpen(true)}
              >
                <Plus className="size-4" />
                {t(($) => $.products.new_product)}
              </Button>
            </div>

            <div className="overflow-hidden rounded-lg border border-surface-border bg-card">
              {productListQuery.isLoading ? (
                <div className="px-4 py-12 text-center text-body text-muted-foreground">
                  {t(($) => $.products.loading)}
                </div>
              ) : productListQuery.error ? (
                <div className="px-4 py-12 text-center text-body text-destructive">
                  {productListQuery.error instanceof Error
                    ? productListQuery.error.message
                    : t(($) => $.products.load_failed)}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <Package className="mx-auto size-6 text-faint-foreground" />
                  <p className="mt-3 text-body font-medium">
                    {productQuery ? t(($) => $.products.no_results) : t(($) => $.products.empty)}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-surface-border">
                  {filteredProducts.map((product) => (
                    <div
                      key={product.id}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${
                        selectedProduct?.id === product.id
                          ? "bg-muted data-active:hover:bg-muted"
                          : ""
                      }`}
                      onClick={() => setSelectedProduct(product)}
                    >
                      <Package className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-body font-medium">
                        {product.name}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t(($) => $.products.actions.open, { name: product.name })}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingProduct(product);
                            }}
                          >
                            <Pencil className="size-4" />
                            {t(($) => $.products.actions.edit)}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteProduct(product);
                            }}
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

          {/* Right Panel: Product Versions */}
          <div className="space-y-4">
            {!selectedProduct ? (
              <div className="flex h-full min-h-[400px] items-center justify-center rounded-lg border border-dashed border-surface-border bg-muted/20">
                <div className="text-center">
                  <Package className="mx-auto size-8 text-faint-foreground" />
                  <p className="mt-3 text-body font-medium text-muted-foreground">
                    {t(($) => $.products.versions.select_product)}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-3">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={versionQuery}
                      onChange={(event) => setVersionQuery(event.target.value)}
                      placeholder={t(($) => $.products.versions.search_placeholder)}
                      className="pl-9"
                    />
                  </div>
                  <Button
                    className="shrink-0 gap-2"
                    onClick={() => setCreateVersionOpen(true)}
                  >
                    <Plus className="size-4" />
                    {t(($) => $.products.versions.new_version)}
                  </Button>
                </div>

                <div className="overflow-hidden rounded-lg border border-surface-border bg-card">
                  <div className="hidden grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1fr)_minmax(8rem,0.8fr)_5rem_2rem] gap-4 border-b border-surface-border bg-muted/20 px-4 py-2.5 text-caption font-medium text-muted-foreground md:grid">
                    <span>{t(($) => $.products.columns.name)}</span>
                    <span>{t(($) => $.products.versions.columns.directory)}</span>
                    <span>{t(($) => $.products.columns.remark)}</span>
                    <span>{t(($) => $.products.versions.columns.status)}</span>
                    <span />
                  </div>

                  {versionListQuery.isLoading ? (
                    <div className="px-4 py-12 text-center text-body text-muted-foreground">
                      {t(($) => $.products.loading)}
                    </div>
                  ) : versionListQuery.error ? (
                    <div className="px-4 py-12 text-center text-body text-destructive">
                      {versionListQuery.error instanceof Error
                        ? versionListQuery.error.message
                        : t(($) => $.products.load_failed)}
                    </div>
                  ) : filteredVersions.length === 0 ? (
                    <div className="px-4 py-12 text-center">
                      <Folder className="mx-auto size-6 text-faint-foreground" />
                      <p className="mt-3 text-body font-medium">
                        {versionQuery
                          ? t(($) => $.products.no_results)
                          : t(($) => $.products.empty)}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-surface-border">
                      {filteredVersions.map((version) => (
                        <div
                          key={version.id}
                          className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(8rem,0.8fr)_minmax(10rem,1fr)_minmax(8rem,0.8fr)_5rem_2rem] md:items-center md:gap-4"
                        >
                          <span className="truncate text-body font-medium">{version.name}</span>
                          <div className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground md:text-body">
                            <Folder className="size-3.5 shrink-0" />
                            <span className="truncate">
                              {version.directory || t(($) => $.products.not_set)}
                            </span>
                          </div>
                          <p className="min-w-0 truncate text-caption text-muted-foreground md:text-body">
                            {version.remark || t(($) => $.products.not_set)}
                          </p>
                          <div className="flex items-center">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                version.enabled
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                              }`}
                            >
                              {version.enabled
                                ? t(($) => $.products.versions.enabled)
                                : t(($) => $.products.versions.disabled)}
                            </span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t(($) => $.products.actions.open, {
                                    name: version.name,
                                  })}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEditingVersion(version)}>
                                <Pencil className="size-4" />
                                {t(($) => $.products.actions.edit)}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setPendingDeleteVersion(version)}
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
              </>
            )}
          </div>
        </div>

        {/* Dialogs */}
        <ProductEditorDialog
          open={createProductOpen}
          onOpenChange={setCreateProductOpen}
        />
        <ProductEditorDialog
          open={Boolean(editingProduct)}
          onOpenChange={(open) => !open && setEditingProduct(null)}
          product={editingProduct}
        />
        <DeleteProductDialog
          product={pendingDeleteProduct}
          onClose={() => setPendingDeleteProduct(null)}
        />
        <ProductVersionEditorDialog
          open={createVersionOpen}
          onOpenChange={setCreateVersionOpen}
          productId={selectedProduct?.id}
        />
        <ProductVersionEditorDialog
          open={Boolean(editingVersion)}
          onOpenChange={(open) => !open && setEditingVersion(null)}
          productId={selectedProduct?.id}
          version={editingVersion}
        />
        <DeleteProductVersionDialog
          version={pendingDeleteVersion}
          productId={selectedProduct?.id ?? null}
          onClose={() => setPendingDeleteVersion(null)}
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
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_PRODUCT_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(
      product
        ? {
            name: product.name,
          }
        : EMPTY_PRODUCT_DRAFT,
    );
  }, [open, product]);

  const submit = () => {
    const name = draft.name.trim();
    if (!name) return;
    const data = {
      name,
      directory: "",
      remark: "",
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
              ? t(($) => $.products.product_editor.edit_title)
              : t(($) => $.products.product_editor.create_title)}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $.products.product_editor.description)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <FieldLabel htmlFor="system-product-name">
              {t(($) => $.products.product_editor.name)}
            </FieldLabel>
            <Input
              id="system-product-name"
              autoFocus
              required
              maxLength={128}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder={t(($) => $.products.product_editor.name_placeholder)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t(($) => $.products.product_editor.cancel)}
          </Button>
          <Button onClick={submit} disabled={!draft.name.trim() || saving}>
            {saving
              ? t(($) => $.products.product_editor.saving)
              : t(($) => $.products.product_editor.save)}
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

function ProductVersionEditorDialog({
  open,
  onOpenChange,
  productId,
  version,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId?: string;
  version?: ProductVersion | null;
}) {
  const { t } = useT("settings");
  const create = useCreateProductVersion(productId ?? "");
  const update = useUpdateProductVersion(productId ?? "", version?.id ?? "");
  const [draft, setDraft] = useState<ProductVersionDraft>(EMPTY_VERSION_DRAFT);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [selectedFolderName, setSelectedFolderName] = useState("");

  useEffect(() => {
    if (!open) return;
    if (version) {
      setDraft({
        name: version.name,
        directory: version.directory,
        remark: version.remark,
        folder_id: version.folder_id || "",
        enabled: version.enabled,
      });
      // Restore the folder name stored in the directory field.
      setSelectedFolderName(version.directory || "");
    } else {
      setDraft(EMPTY_VERSION_DRAFT);
      setSelectedFolderName("");
    }
  }, [open, version]);

  const handleFolderSelect = (folder: KBFolder) => {
    // Keep the folder id and stored folder name in sync.
    setDraft((current) => ({
      ...current,
      folder_id: folder.id,
      directory: folder.name
    }));
    setSelectedFolderName(folder.name);
  };

  const submit = () => {
    if (!productId) return;
    const name = draft.name.trim();
    if (!name) return;
    const data = {
      name,
      directory: draft.directory.trim(),
      remark: draft.remark.trim(),
      folder_id: draft.folder_id.trim(),
      enabled: draft.enabled,
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
    if (version) {
      update.mutate(data, options);
    } else {
      create.mutate(data, options);
    }
  };

  const saving = create.isPending || update.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {version
                ? t(($) => $.products.version_editor.edit_title)
                : t(($) => $.products.version_editor.create_title)}
            </DialogTitle>
            <DialogDescription>
              {t(($) => $.products.version_editor.description)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <FieldLabel htmlFor="product-version-name">
                {t(($) => $.products.version_editor.name)}
              </FieldLabel>
              <Input
                id="product-version-name"
                autoFocus
                required
                maxLength={128}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder={t(($) => $.products.version_editor.name_placeholder)}
              />
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="product-version-directory">
                {t(($) => $.products.versions.directory)}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="product-version-directory"
                  readOnly
                  value={selectedFolderName}
                  placeholder={t(($) => $.products.versions.directory_placeholder)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setFolderPickerOpen(true)}
                >
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel htmlFor="product-version-remark">
                {t(($) => $.products.version_editor.remark)}
              </FieldLabel>
              <Textarea
                id="product-version-remark"
                rows={3}
                maxLength={2000}
                value={draft.remark}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, remark: event.target.value }))
                }
                placeholder={t(($) => $.products.version_editor.remark_placeholder)}
              />
            </div>
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <FieldLabel htmlFor="product-version-enabled">
                  {t(($) => $.products.versions.enabled_label)}
                </FieldLabel>
                <div className="text-caption text-muted-foreground">
                  {t(($) => $.products.versions.disabled_description)}
                </div>
              </div>
              <Switch
                id="product-version-enabled"
                checked={draft.enabled}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, enabled: checked }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              {t(($) => $.products.version_editor.cancel)}
            </Button>
            <Button onClick={submit} disabled={!draft.name.trim() || saving}>
              {saving
                ? t(($) => $.products.version_editor.saving)
                : t(($) => $.products.version_editor.save)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderPickerDialog
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderSelect}
        selectedFolderId={draft.folder_id}
      />
    </>
  );
}

function DeleteProductVersionDialog({
  version,
  productId,
  onClose,
}: {
  version: ProductVersion | null;
  productId: string | null;
  onClose: () => void;
}) {
  const { t } = useT("settings");
  const remove = useDeleteProductVersion(productId ?? "");

  return (
    <AlertDialog open={Boolean(version)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(($) => $.products.delete_dialog.title)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(($) => $.products.delete_dialog.description, {
              name: version?.name ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {t(($) => $.products.delete_dialog.cancel)}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={() => {
              if (!version) return;
              remove.mutate(version.id, {
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
