// @vitest-environment node

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import withAndroidFbjni from "../plugins/with-android-fbjni.cjs";

const require = createRequire(import.meta.url);

describe("Android fbjni compatibility", () => {
  it("pins every native project's dependency and is idempotent", () => {
    const original = 'apply plugin: "com.facebook.react.rootproject"\n';
    const patched = withAndroidFbjni.patchRootBuildGradle(original);

    expect(patched).toContain("allprojects {");
    expect(patched).toContain("configurations.configureEach {");
    expect(patched).toContain('force "com.facebook.fbjni:fbjni:0.7.0"');
    expect(withAndroidFbjni.patchRootBuildGradle(patched)).toBe(patched);
  });

  it("matches the fbjni version shipped with the installed React Native", async () => {
    const catalog = await readFile(
      path.join(
        path.dirname(require.resolve("react-native/package.json")),
        "gradle",
        "libs.versions.toml",
      ),
      "utf8",
    );
    expect(catalog).toMatch(/^fbjni = "0\.7\.0"$/m);
  });

  it("registers the fix in Expo prebuild", async () => {
    const config = await readFile(
      new URL("../app.config.ts", import.meta.url),
      "utf8",
    );
    expect(config).toContain('"./plugins/with-android-fbjni.cjs"');
  });
});
