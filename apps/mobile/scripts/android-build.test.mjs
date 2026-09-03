// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildAndroid,
  computeDependencyFingerprint,
  computeNativeFingerprint,
  dependencyLayoutMatches,
  ensureWindowsDependencyBridge,
  findAndroidHome,
  findJavaHome,
  getCorepackCommand,
  getGradleArguments,
  getProcessInvocation,
  getWindowsVirtualStoreDir,
  prepareWindowsDependencies,
} from "./android-build.mjs";

const tempDirs = [];

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "android-build-"));
  tempDirs.push(repoRoot);
  const mobileDir = path.join(repoRoot, "apps", "mobile");
  const androidDir = path.join(mobileDir, "android");

  await mkdir(path.join(mobileDir, "assets"), { recursive: true });
  await mkdir(androidDir, { recursive: true });
  await writeFile(path.join(mobileDir, "app.config.ts"), "app config");
  await writeFile(path.join(mobileDir, "package.json"), "{}");
  await writeFile(
    path.join(mobileDir, ".env.production"),
    "EXPO_PUBLIC_API_URL=http://192.168.11.173:30080\n",
  );
  await writeFile(path.join(mobileDir, "assets", "icon.png"), "icon");
  await writeFile(path.join(mobileDir, "assets", "brand-mark.png"), "brand");
  await writeFile(path.join(repoRoot, "package.json"), "{}");
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfile");
  await writeFile(path.join(repoRoot, "pnpm-workspace.yaml"), "packages: []");
  await writeFile(path.join(androidDir, "gradlew.bat"), "@echo off");
  const virtualStoreDir = getWindowsVirtualStoreDir(repoRoot);
  await mkdir(path.join(repoRoot, "node_modules"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "node_modules", ".modules.yaml"),
    `virtualStoreDir: ${virtualStoreDir}\nvirtualStoreDirMaxLength: 32\n`,
  );
  const dependencyFingerprint = await computeDependencyFingerprint({
    repoRoot,
  });
  await writeFile(
    path.join(repoRoot, "node_modules", ".hongyi-dependencies-fingerprint"),
    `${dependencyFingerprint}\n`,
  );

  return { androidDir, mobileDir, repoRoot, virtualStoreDir };
}

async function writeCurrentFingerprint(fixture) {
  const fingerprint = await computeNativeFingerprint(fixture);
  await writeFile(
    path.join(fixture.androidDir, ".hongyi-prebuild-fingerprint"),
    `${fingerprint}\n`,
  );
}

function createRunner(fixture, { failGradle = false } = {}) {
  const calls = [];
  const runCommand = async (command, args, options) => {
    calls.push({ args, command, options });
    if (args.includes("app:assembleRelease")) {
      if (failGradle) throw new Error("Gradle failed");
      const releaseDir = path.join(
        fixture.androidDir,
        "app",
        "build",
        "outputs",
        "apk",
        "release",
      );
      await mkdir(releaseDir, { recursive: true });
      await writeFile(path.join(releaseDir, "app-release.apk"), "test apk");
    }
  };
  return { calls, runCommand };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) =>
      rm(tempDir, { force: true, recursive: true }),
    ),
  );
});

describe("Android fast build", () => {
  it("derives an isolated short virtual store on the repository drive", () => {
    const store = getWindowsVirtualStoreDir("G:\\aicode\\multica");

    expect(store).toBe("G:\\p\\6983b33b");
    expect(store.length).toBeLessThan(20);
  });

  it("recognizes only the expected short dependency layout", () => {
    expect(
      dependencyLayoutMatches(
        "virtualStoreDir: G:\\p\\6983b33b\nvirtualStoreDirMaxLength: 32\n",
        "G:\\p\\6983b33b",
      ),
    ).toBe(true);
    expect(
      dependencyLayoutMatches(
        "virtualStoreDir: G:\\aicode\\multica\\node_modules\\.pnpm\nvirtualStoreDirMaxLength: 60\n",
        "G:\\p\\6983b33b",
      ),
    ).toBe(false);
  });

  it("bridges peer dependency lookup back to the repository node_modules", async () => {
    const fixture = await createFixture();
    const virtualStoreDir = path.join(fixture.repoRoot, "short-store");

    const first = await ensureWindowsDependencyBridge({
      repoRoot: fixture.repoRoot,
      virtualStoreDir,
    });
    const second = await ensureWindowsDependencyBridge({
      repoRoot: fixture.repoRoot,
      virtualStoreDir,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    await expect(realpath(first.bridgePath)).resolves.toBe(
      await realpath(path.join(fixture.repoRoot, "node_modules")),
    );
  });

  it("skips pnpm install when the short dependency layout is ready", async () => {
    const fixture = await createFixture();
    const runner = createRunner(fixture);
    const bridgeCalls = [];

    const result = await prepareWindowsDependencies({
      ensureDependencyBridge: async (options) => {
        bridgeCalls.push(options);
      },
      env: {},
      log: () => {},
      mobileDir: fixture.mobileDir,
      repoRoot: fixture.repoRoot,
      runCommand: runner.runCommand,
    });

    expect(result.prepared).toBe(false);
    expect(runner.calls).toHaveLength(0);
    expect(bridgeCalls).toEqual([
      {
        repoRoot: fixture.repoRoot,
        virtualStoreDir: fixture.virtualStoreDir,
      },
    ]);
  });

  it("refreshes dependencies when the lockfile changes", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.repoRoot, "pnpm-lock.yaml"), "changed");
    const calls = [];
    const runCommand = async (command, args, options) => {
      calls.push({ args, command, options });
    };

    const result = await prepareWindowsDependencies({
      ensureDependencyBridge: async () => {},
      env: { PATH: "test" },
      log: () => {},
      mobileDir: fixture.mobileDir,
      repoRoot: fixture.repoRoot,
      runCommand,
    });

    expect(result.prepared).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].args.slice(0, 2)).toEqual(["pnpm", "install"]);
    await expect(
      readFile(
        path.join(
          fixture.repoRoot,
          "node_modules",
          ".hongyi-dependencies-fingerprint",
        ),
        "utf8",
      ),
    ).resolves.toBe(
      `${await computeDependencyFingerprint({ repoRoot: fixture.repoRoot })}\n`,
    );
  });

  it("prepares short dependencies and removes stale Android autolinking", async () => {
    const fixture = await createFixture();
    const staleBuildFile = path.join(
      fixture.androidDir,
      "build",
      "generated",
      "autolinking",
      "autolinking.json",
    );
    await mkdir(path.dirname(staleBuildFile), { recursive: true });
    await writeFile(staleBuildFile, "stale");
    await writeFile(
      path.join(fixture.repoRoot, "node_modules", ".modules.yaml"),
      "virtualStoreDir: G:\\old\nvirtualStoreDirMaxLength: 60\n",
    );

    const calls = [];
    const runCommand = async (command, args, options) => {
      calls.push({ args, command, options });
      if (args.includes("install")) {
        await writeFile(
          path.join(fixture.repoRoot, "node_modules", ".modules.yaml"),
          `virtualStoreDir: ${fixture.virtualStoreDir}\nvirtualStoreDirMaxLength: 32\n`,
        );
      }
    };

    const result = await prepareWindowsDependencies({
      ensureDependencyBridge: async () => {},
      env: { PATH: "test" },
      log: () => {},
      mobileDir: fixture.mobileDir,
      repoRoot: fixture.repoRoot,
      runCommand,
    });

    expect(result.prepared).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(["--stop"]);
    expect(calls[1].command).toBe(
      getCorepackCommand({ platform: "win32" }),
    );
    expect(calls[1].args).toEqual([
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--virtual-store-dir",
      fixture.virtualStoreDir,
      "--prefer-offline",
    ]);
    expect(calls[1].options.env.CI).toBe("true");
    expect(
      calls[1].options.env.npm_config_virtual_store_dir_max_length,
    ).toBe("32");
    await expect(readFile(staleBuildFile)).rejects.toThrow();
  });

  it("skips prebuild when the native fingerprint is unchanged", async () => {
    const fixture = await createFixture();
    await writeCurrentFingerprint(fixture);
    const runner = createRunner(fixture);

    const result = await buildAndroid({
      ...fixture,
      log: () => {},
      platform: "win32",
      runCommand: runner.runCommand,
    });

    expect(result.prebuildRan).toBe(false);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].args).toContain(
      "-PreactNativeArchitectures=arm64-v8a",
    );
    expect(runner.calls[0].options.env.NODE_PATH).toContain(
      path.join(fixture.repoRoot, "node_modules"),
    );
  });

  it("runs prebuild first when a fingerprint input changes", async () => {
    const fixture = await createFixture();
    await writeCurrentFingerprint(fixture);
    await writeFile(path.join(fixture.mobileDir, "app.config.ts"), "changed");
    const runner = createRunner(fixture);

    const result = await buildAndroid({
      ...fixture,
      log: () => {},
      platform: "win32",
      runCommand: runner.runCommand,
    });

    expect(result.prebuildRan).toBe(true);
    expect(runner.calls[0].args).toEqual([
      "pnpm",
      "exec",
      "expo",
      "prebuild",
      "-p",
      "android",
      "--no-install",
    ]);
    expect(runner.calls[1].args).toContain("app:assembleRelease");
  });

  it("does not constrain architectures for a universal build", () => {
    const args = getGradleArguments({ clean: false, universal: true });
    expect(args).not.toContain("-PreactNativeArchitectures=arm64-v8a");
    expect(args).not.toContain("--configuration-cache");
  });

  it("runs Windows command scripts through cmd without shell mode", () => {
    const invocation = getProcessInvocation(
      "G:\\repo with spaces\\gradlew.bat",
      ["app:assembleRelease", "-Pname=value with spaces"],
      {
        env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
        platform: "win32",
      },
    );

    expect(invocation).toEqual({
      args: [
        "/d",
        "/s",
        "/c",
        '""G:\\repo with spaces\\gradlew.bat" "app:assembleRelease" "-Pname=value with spaces""',
      ],
      command: "C:\\Windows\\System32\\cmd.exe",
      windowsVerbatimArguments: true,
    });
  });

  it("resolves Corepack beside the active Node executable on Windows", () => {
    expect(
      getCorepackCommand({
        execPath: "C:\\Node\\node.exe",
        platform: "win32",
      }),
    ).toBe("C:\\Node\\corepack.cmd");
    expect(getCorepackCommand({ platform: "linux" })).toBe("corepack");
  });

  it("discovers a Microsoft JDK when JAVA_HOME is not set", async () => {
    const programFiles = await mkdtemp(
      path.join(os.tmpdir(), "android-build-program-files-"),
    );
    tempDirs.push(programFiles);
    const javaHome = path.join(programFiles, "Microsoft", "jdk-17.0.1");
    await mkdir(path.join(javaHome, "bin"), { recursive: true });
    await writeFile(path.join(javaHome, "bin", "java.exe"), "");

    await expect(
      findJavaHome({
        env: { ProgramFiles: programFiles },
        platform: "win32",
      }),
    ).resolves.toBe(javaHome);
  });

  it("discovers an Android SDK on the repository drive", async () => {
    const driveRoot = await mkdtemp(
      path.join(os.tmpdir(), "android-build-drive-"),
    );
    tempDirs.push(driveRoot);
    const repoRoot = path.join(driveRoot, "repo");
    const androidHome = path.join(path.parse(repoRoot).root, "Android", "Sdk");

    // A temporary POSIX path has "/" as its drive root, so use an explicit
    // environment path to exercise the same validation without touching it.
    const configuredHome = path.join(driveRoot, "Android", "Sdk");
    await mkdir(path.join(configuredHome, "platform-tools"), {
      recursive: true,
    });
    await writeFile(
      path.join(configuredHome, "platform-tools", "adb.exe"),
      "",
    );

    await expect(
      findAndroidHome({
        env: { ANDROID_HOME: configuredHome },
        platform: "win32",
        repoRoot,
      }),
    ).resolves.toBe(configuredHome);
    expect(androidHome).toBe(path.join(path.parse(repoRoot).root, "Android", "Sdk"));
  });

  it("does not copy an APK when Gradle fails", async () => {
    const fixture = await createFixture();
    await writeCurrentFingerprint(fixture);
    const runner = createRunner(fixture, { failGradle: true });

    await expect(
      buildAndroid({
        ...fixture,
        log: () => {},
        platform: "win32",
        runCommand: runner.runCommand,
      }),
    ).rejects.toThrow("Gradle failed");

    await expect(
      readFile(
        path.join(
          fixture.repoRoot,
          "dist",
          "hongyi-linggong-android-arm64-release.apk",
        ),
      ),
    ).rejects.toThrow();
  });

  it("copies the release APK and reports its SHA256", async () => {
    const fixture = await createFixture();
    await writeCurrentFingerprint(fixture);
    const runner = createRunner(fixture);

    const result = await buildAndroid({
      ...fixture,
      log: () => {},
      platform: "win32",
      runCommand: runner.runCommand,
    });

    const contents = await readFile(result.outputPath);
    expect(contents.toString()).toBe("test apk");
    expect(result.sha256).toBe(
      createHash("sha256").update("test apk").digest("hex").toUpperCase(),
    );
  });
});
