// @vitest-environment node
import { expect, it } from "vitest";
import { versionDirectoryName } from "./paths";

it.each([
  ["v6", "v6"],
  [" release/v6:win ", "release-v6-win"],
  ["CON", "_CON"],
  ["aux.txt", "_aux.txt"],
  ["v6\nwin", "v6-win"],
  ["版本6", "版本6"],
  ["...", ""],
])("previews the server's portable version directory for %s", (name, expected) => {
  expect(versionDirectoryName(name)).toBe(expected);
});
