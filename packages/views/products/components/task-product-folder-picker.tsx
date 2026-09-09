"use client";

import { useEffect, useMemo, useState, type ReactElement, type UIEvent } from "react";
import { Check, ChevronRight, Folder, FolderOpen, Loader2, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { productListOptions } from "@multica/core/products/queries";
import { productVersionListOptions } from "@multica/core/product-versions/queries";
import type { KBFolder, Product, ProductVersion } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";

export interface TaskProductFolderSelection {
  product: Product;
  version: ProductVersion;
  folder: KBFolder;
}

interface TaskProductFolderPickerProps {
  productId?: string | null;
  productVersionId?: string | null;
  folderId?: string | null;
  onConfirm: (selection: TaskProductFolderSelection) => void;
  triggerRender: ReactElement;
}

export function TaskProductFolderPicker({
  productId,
  productVersionId,
  folderId,
  onConfirm,
  triggerRender,
}: TaskProductFolderPickerProps) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(productId ?? null);
  const [selectedVersionId, setSelectedVersionId] = useState(productVersionId ?? null);
  const [selectedFolder, setSelectedFolder] = useState<KBFolder | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [folderPage, setFolderPage] = useState(0);
  const [folderTotal, setFolderTotal] = useState(0);
  const [folders, setFolders] = useState<KBFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersLoadingMore, setFoldersLoadingMore] = useState(false);

  const { data: products = [], isLoading: productsLoading } = useQuery(productListOptions());
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const { data: versions = [], isLoading: versionsLoading } = useQuery({
    ...productVersionListOptions(selectedProductId ?? ""),
    enabled: Boolean(selectedProductId),
  });
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null;
  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    return query ? products.filter((product) => product.name.toLowerCase().includes(query)) : products;
  }, [products, productQuery]);

  useEffect(() => {
    if (!open) return;
    setSelectedProductId(productId ?? null);
    setSelectedVersionId(productVersionId ?? null);
    setSelectedFolder(productVersionId === selectedVersionId && folderId
      ? { id: folderId, name: "", folderPath: "", parentId: "" }
      : null);
  }, [open, productId, productVersionId, folderId]);

  useEffect(() => {
    if (!open || !selectedVersion?.folder_id) {
      setFolders([]);
      setFolderPage(0);
      setFolderTotal(0);
      return;
    }
    let cancelled = false;
    setFoldersLoading(true);
    setFoldersLoadingMore(false);
    void api.getKBFolders(selectedVersion.folder_id, 1)
      .then((response) => {
        if (cancelled) return;
        setFolders(response.folders);
        setFolderTotal(response.totalCount);
        setFolderPage(1);
        if (folderId && selectedVersionId === productVersionId) {
          setSelectedFolder(response.folders.find((folder) => folder.id === folderId) ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFolders([]);
          setFolderTotal(0);
          setFolderPage(0);
        }
      })
      .finally(() => {
        if (!cancelled) setFoldersLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, selectedVersion?.folder_id, folderId, productVersionId, selectedVersionId]);

  const chooseProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedVersionId(null);
    setSelectedFolder(null);
  };

  const chooseVersion = (version: ProductVersion) => {
    setSelectedVersionId(version.id);
    setSelectedFolder(null);
  };

  const loadMoreFolders = async () => {
    if (!selectedVersion?.folder_id || foldersLoadingMore || folders.length >= folderTotal) return;
    const nextPage = folderPage + 1;
    setFoldersLoadingMore(true);
    try {
      const response = await api.getKBFolders(selectedVersion.folder_id, nextPage);
      setFolders((current) => [...current, ...response.folders.filter((folder) => !current.some((item) => item.id === folder.id))]);
      setFolderTotal(response.totalCount);
      setFolderPage(nextPage);
    } finally {
      setFoldersLoadingMore(false);
    }
  };

  const handleFolderScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 48) void loadMoreFolders();
  };

  const handleConfirm = () => {
    if (!selectedProduct || !selectedVersion || !selectedFolder) return;
    onConfirm({ product: selectedProduct, version: selectedVersion, folder: selectedFolder });
    setOpen(false);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setOpen(true); }}
      >
        {triggerRender}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex !h-[680px] max-h-[calc(100vh-2rem)] !w-[calc(100vw-2rem)] !max-w-4xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0 border-b border-surface-border pb-4">
            <DialogTitle>{t(($) => $.pickers.product.folder_dialog_title)}</DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden py-4 md:grid-cols-[minmax(15rem,0.9fr)_minmax(20rem,1.4fr)]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-surface-border">
              <div className="shrink-0 border-b border-surface-border p-3">
                <Input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder={t(($) => $.pickers.product.search_placeholder)} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {productsLoading ? <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : filteredProducts.map((product) => {
                  const selected = product.id === selectedProductId;
                  return (
                    <div key={product.id}>
                      <button type="button" className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-body hover:bg-muted/50", selected && "bg-muted font-medium")} onClick={() => chooseProduct(product)}>
                        <ChevronRight className={cn("size-4 shrink-0 transition-transform", selected && "rotate-90")} />
                        <Package className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{product.name}</span>
                      </button>
                      {selected && (
                        <div className="ml-5 border-l border-surface-border pl-2">
                          {versionsLoading ? <div className="px-3 py-2"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div> : versions.length === 0 ? <p className="px-3 py-2 text-caption text-muted-foreground">{t(($) => $.pickers.product.no_versions)}</p> : versions.map((version) => (
                            <button key={version.id} type="button" className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-body hover:bg-muted/50", version.id === selectedVersionId && "bg-primary/10 font-medium text-primary")} onClick={() => chooseVersion(version)}>
                              <Folder className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate">{version.name}</span>
                              {version.id === selectedVersionId && <Check className="size-4 shrink-0" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-surface-border">
              <div className="shrink-0 border-b border-surface-border px-4 py-3 text-body font-medium">{selectedVersion?.name ?? t(($) => $.pickers.product.choose_version)}</div>
              <div className="min-h-0 flex-1 overflow-y-auto" onScroll={handleFolderScroll}>
                {!selectedVersion ? <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted-foreground">{t(($) => $.pickers.product.choose_version)}</div> : !selectedVersion.folder_id ? <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted-foreground">{t(($) => $.pickers.product.no_folder)}</div> : foldersLoading ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : folders.length === 0 ? <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted-foreground">{t(($) => $.pickers.product.no_folders)}</div> : <div className="divide-y divide-surface-border">
                  <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 border-b border-surface-border bg-muted/20 px-4 py-2 text-caption font-medium text-muted-foreground">
                    <span>{t(($) => $.pickers.product.folder_name)}</span>
                    <span>{t(($) => $.pickers.product.folder_id)}</span>
                  </div>
                  {folders.map((folder) => {
                    const selected = selectedFolder?.id === folder.id;
                    return <label key={folder.id} className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50", selected && "bg-primary/10")}>
                      <Checkbox checked={selected} onCheckedChange={(checked) => setSelectedFolder(checked ? folder : null)} />
                      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate" title={folder.name}>{folder.name}</span>
                      <span className="text-caption text-muted-foreground">{folder.id}</span>
                    </label>;
                  })}
                  {foldersLoadingMore && <div className="flex justify-center py-3"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>}
                </div>}
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-surface-border pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t(($) => $.pickers.product.cancel)}</Button>
            <Button onClick={handleConfirm} disabled={!selectedProduct || !selectedVersion || !selectedFolder}>{t(($) => $.pickers.product.confirm)}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
