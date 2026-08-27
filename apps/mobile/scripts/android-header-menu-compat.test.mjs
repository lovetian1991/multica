// @vitest-environment node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const detailScreens = [
  "../app/(app)/[workspace]/project/[id].tsx",
  "../app/(app)/[workspace]/issue/[id].tsx",
];

describe("Android detail header menus", () => {
  for (const relativePath of detailScreens) {
    it(`${relativePath} uses the cross-platform dropdown menu`, async () => {
      const source = await readFile(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      );

      expect(source).toContain("<DropdownMenu>");
      expect(source).toContain("<DropdownMenuTrigger");
      expect(source).not.toContain("ActionSheetIOS");
    });
  }
});
