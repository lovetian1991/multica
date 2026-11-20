"use client";

import type { ReactNode } from "react";
import { Label } from "@multica/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@multica/ui/components/ui/select";

export function OrderField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-2 text-body"><span>{label}</span>{children}</label>;
}

export function OrderSelect({ label, value, onChange, options, disabled = false, empty }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean; empty: string;
}) {
  const items = [{ value: "__none", label: empty }, ...options];
  return <div className="min-w-0 space-y-2">
    <Label>{label}</Label>
    <Select items={items} value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v ?? "")} disabled={disabled}>
      <SelectTrigger aria-label={label} className="w-full min-w-0"><SelectValue /></SelectTrigger>
      <SelectContent>{items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}
