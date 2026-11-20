"use client";

import { useState } from "react";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Check, Plus, Search } from "@multica/ui/icons";
import { useT } from "../i18n";
import { matchesPinyin } from "../editor/extensions/pinyin-match";

export interface PickerProduct {
  id: string;
  name: string;
  slug?: string;
  versions: { id: string; name: string }[];
}

function matches(value: string, query: string) {
  const q = query.trim().toLocaleLowerCase();
  return !q || value.toLocaleLowerCase().includes(q) || matchesPinyin(value, q);
}

/** Two-pane product/version chooser. The catalog can grow large, so both panes search by name and pinyin. */
export function ProductVersionPickerDialog({ products, title, selectedVersionId, onSelect, onCreateVersion, onClose }: {
  products: PickerProduct[]; title: string; selectedVersionId?: string;
  onSelect: (productId: string, versionId: string) => void;
  onCreateVersion?: (productId: string, productName: string) => void;
  onClose: () => void;
}) {
  const { t } = useT("settings");
  const initial = products.find((p) => p.versions.some((v) => v.id === selectedVersionId)) ?? products[0];
  const [productId, setProductId] = useState(initial?.id ?? "");
  const [productQuery, setProductQuery] = useState("");
  const [versionQuery, setVersionQuery] = useState("");
  const product = products.find((p) => p.id === productId);
  const visibleProducts = products.filter((p) => matches(p.name, productQuery) || matches(p.slug ?? "", productQuery));
  const visibleVersions = (product?.versions ?? []).filter((v) => matches(v.name, versionQuery));
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-3xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-2">
        <section className="flex min-h-0 flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-9" aria-label={t(($) => $.work_orders.search_products)} placeholder={t(($) => $.work_orders.search_products)}
              value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-surface-border">
            {visibleProducts.map((p) => <button key={p.id} type="button" aria-pressed={p.id === productId}
              onClick={() => { setProductId(p.id); setVersionQuery(""); }}
              className={`flex w-full min-w-0 flex-col gap-1 border-b border-surface-border px-3 py-2.5 text-left text-body last:border-b-0 ${p.id === productId ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
              <span className="break-words font-medium">{p.name}</span>
              {p.slug && <span className="break-all font-mono text-caption text-muted-foreground">{p.slug}</span>}
            </button>)}
            {visibleProducts.length === 0 && <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.work_orders.no_matching_products)}</p>}
          </div>
        </section>
        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-9" aria-label={t(($) => $.work_orders.search_versions)} placeholder={t(($) => $.work_orders.search_versions)}
                disabled={!product} value={versionQuery} onChange={(e) => setVersionQuery(e.target.value)} />
            </div>
            {product && onCreateVersion && <Button variant="outline" size="sm" className="shrink-0"
              onClick={() => onCreateVersion(product.id, product.name)}><Plus className="size-4" />{t(($) => $.products.versions.new_version)}</Button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-surface-border">
            {visibleVersions.map((v) => <button key={v.id} type="button" onClick={() => { if (product) onSelect(product.id, v.id); }}
              className={`flex w-full min-w-0 items-center justify-between gap-2 border-b border-surface-border px-3 py-2.5 text-left text-body last:border-b-0 hover:bg-muted ${v.id === selectedVersionId ? "bg-accent/60" : ""}`}>
              <span className="break-words">{v.name}</span>
              {v.id === selectedVersionId && <Check className="size-4 shrink-0" />}
            </button>)}
            {!product && <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.work_orders.no_matching_versions)}</p>}
            {product && visibleVersions.length === 0 && <p className="px-3 py-8 text-center text-body text-muted-foreground">{t(($) => $.work_orders.no_matching_versions)}</p>}
          </div>
        </section>
      </div>
      <div className="flex justify-end"><Button type="button" variant="outline" onClick={onClose}>{t(($) => $.work_orders.cancel)}</Button></div>
    </DialogContent>
  </Dialog>;
}
