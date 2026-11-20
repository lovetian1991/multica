import { expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../test/i18n";
import { ProductVersionPickerDialog } from "./product-version-picker";

it("filters products by pinyin and selects a version", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  renderWithI18n(<ProductVersionPickerDialog products={[
    { id: "ecm", name: "中石化", versions: [{ id: "v1", name: "V1" }, { id: "v2", name: "V2" }] },
    { id: "cms", name: "CMS", versions: [{ id: "v3", name: "V3" }] },
  ]} title="选择产品与版本" onSelect={onSelect} onClose={vi.fn()} />, { locale: "zh-Hans" });
  await user.type(screen.getByRole("textbox", { name: "搜索产品" }), "zsh");
  expect(screen.queryByRole("button", { name: /CMS/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /V2/ }));
  expect(onSelect).toHaveBeenCalledWith("ecm", "v2");
});
