import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMobileDir = path.resolve(scriptDir, "..");
const defaultRepoRoot = path.resolve(defaultMobileDir, "..", "..");
const dependencyFingerprintFilename = ".hongyi-dependencies-fingerprint";
const fingerprintFilename = ".hongyi-prebuild-fingerprint";
const windowsVirtualStoreMaxLength = 32;

const fingerprintInputs = [
  ["mobile/app.config.ts", "app.config.ts"],
  ["mobile/package.json", "package.json"],
  ["mobile/.env.production", ".env.production"],
  ["mobile/assets/icon.png", "assets/icon.png"],
  ["mobile/assets/brand-mark.png", "assets/brand-mark.png"],
  ["repo/pnpm-lock.yaml", "../../pnpm-lock.yaml"],
];

export function parseBuildArgs(argv) {
  const options = {
    clean: false,
    help: false,
    syncNative: false,
    universal: false,
  };

  for (const arg of argv) {
    if (arg === "--clean") options.clean = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--sync-native") options.syncNative = true;
    else if (arg === "--universal") options.universal = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function parseEnvFile(contents) {
  const values = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;

    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

export async function computeNativeFingerprint({ mobileDir, repoRoot }) {
  const hash = createHash("sha256");

  for (const [label, relativePath] of fingerprintInputs) {
    const inputPath =
      label === "repo/pnpm-lock.yaml"
        ? path.join(repoRoot, "pnpm-lock.yaml")
        : path.join(mobileDir, relativePath);
    hash.update(`${label}\0`);
    hash.update(await readFile(inputPath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

export async function computeDependencyFingerprint({ repoRoot }) {
  const hash = createHash("sha256");
  const manifestPaths = [path.join(repoRoot, "package.json")];

  for (const workspaceDir of ["apps", "packages"]) {
    for (const child of await childDirectories(path.join(repoRoot, workspaceDir))) {
      manifestPaths.push(path.join(child, "package.json"));
    }
  }

  for (const inputPath of [
    path.join(repoRoot, "pnpm-lock.yaml"),
    path.join(repoRoot, "pnpm-workspace.yaml"),
  ]) {
    hash.update(`${path.relative(repoRoot, inputPath)}\0`);
    hash.update(await readFile(inputPath));
    hash.update("\0");
  }

  for (const manifestPath of manifestPaths.sort()) {
    if (!(await pathExists(manifestPath))) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const dependencyFields = {
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
      optionalDependencies: manifest.optionalDependencies,
      packageManager: manifest.packageManager,
      peerDependencies: manifest.peerDependencies,
      pnpm: manifest.pnpm,
    };
    hash.update(`${path.relative(repoRoot, manifestPath)}\0`);
    hash.update(JSON.stringify(dependencyFields));
    hash.update("\0");
  }

  return hash.digest("hex");
}

export function getGradleArguments({ clean, universal }) {
  const tasks = clean
    ? ["app:clean", "app:assembleRelease"]
    : ["app:assembleRelease"];
  const architectureArgs = universal
    ? []
    : ["-PreactNativeArchitectures=arm64-v8a"];

  return [...tasks, ...architectureArgs, "--build-cache", "--parallel"];
}

export function getWindowsVirtualStoreDir(repoRoot) {
  const normalizedRoot = path.resolve(repoRoot).toLowerCase();
  const workspaceId = createHash("sha256")
    .update(normalizedRoot)
    .digest("hex")
    .slice(0, 8);
  return path.join(path.parse(repoRoot).root, "p", workspaceId);
}

export function getCorepackCommand({
  execPath = process.execPath,
  platform = process.platform,
} = {}) {
  return platform === "win32"
    ? path.join(path.dirname(execPath), "corepack.cmd")
    : "corepack";
}

function parseModulesValue(contents, key) {
  const match = contents.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "mu"));
  if (!match) return null;
  return match[1].replace(/^['"]|['"]$/gu, "");
}

function normalizeComparablePath(value) {
  return path.resolve(value).replaceAll("/", "\\").toLowerCase();
}

export function dependencyLayoutMatches(contents, virtualStoreDir) {
  const configuredDir = parseModulesValue(contents, "virtualStoreDir");
  const configuredMaxLength = Number(
    parseModulesValue(contents, "virtualStoreDirMaxLength"),
  );

  return (
    configuredDir !== null &&
    normalizeComparablePath(configuredDir) ===
      normalizeComparablePath(virtualStoreDir) &&
    Number.isFinite(configuredMaxLength) &&
    configuredMaxLength <= windowsVirtualStoreMaxLength
  );
}

export async function ensureWindowsDependencyBridge({
  repoRoot,
  virtualStoreDir,
}) {
  const rootNodeModules = path.join(repoRoot, "node_modules");
  const bridgePath = path.join(virtualStoreDir, "node_modules");

  await mkdir(virtualStoreDir, { recursive: true });
  if (await pathExists(bridgePath)) {
    const [resolvedBridge, resolvedRootNodeModules] = await Promise.all([
      realpath(bridgePath),
      realpath(rootNodeModules),
    ]);
    if (
      normalizeComparablePath(resolvedBridge) !==
      normalizeComparablePath(resolvedRootNodeModules)
    ) {
      throw new Error(
        `Short-path dependency bridge points to an unexpected location: ${bridgePath}`,
      );
    }
    return { bridgePath, created: false };
  }

  await symlink(rootNodeModules, bridgePath, "junction");
  return { bridgePath, created: true };
}

function quoteWindowsCommandArg(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function getProcessInvocation(
  command,
  args,
  { env = process.env, platform = process.platform } = {},
) {
  if (platform !== "win32") {
    return { args, command, windowsVerbatimArguments: false };
  }

  const commandLine = [command, ...args].map(quoteWindowsCommandArg).join(" ");
  return {
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    command: env.ComSpec ?? env.COMSPEC ?? "cmd.exe",
    windowsVerbatimArguments: true,
  };
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function printHelp(log) {
  log(`鸿翼灵工 Android 快速打包

Usage:
  pnpm android:build [options]

Options:
  --sync-native  强制运行 Expo prebuild，适合原生配置或依赖变更
  --clean        同步原生工程并执行 Gradle clean 后重新构建
  --universal    构建四架构通用 APK；默认只构建 arm64
  -h, --help     显示帮助
`);
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function assertPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove path outside ${parent}: ${target}`);
  }
}

async function javaHomeIsUsable(javaHome, platform) {
  if (!javaHome) return false;
  const executable = platform === "win32" ? "java.exe" : "java";
  return pathExists(path.join(javaHome, "bin", executable));
}

async function childDirectories(parent) {
  try {
    return (await readdir(parent, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

export async function findJavaHome({
  env = process.env,
  platform = process.platform,
} = {}) {
  if (await javaHomeIsUsable(env.JAVA_HOME, platform)) return env.JAVA_HOME;

  const candidates = [];
  if (platform === "win32") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const localAppData = env.LOCALAPPDATA;
    candidates.push(
      path.join(programFiles, "Android", "Android Studio", "jbr"),
      path.join(programFiles, "Android", "Android Studio", "jre"),
    );
    if (localAppData) {
      candidates.push(
        path.join(localAppData, "Programs", "Android Studio", "jbr"),
      );
    }

    const microsoftJdks = await childDirectories(
      path.join(programFiles, "Microsoft"),
    );
    candidates.push(
      ...microsoftJdks
        .filter((directory) => path.basename(directory).startsWith("jdk-"))
        .sort()
        .reverse(),
    );

    const jetBrainsProducts = await childDirectories(
      path.join(programFiles, "JetBrains"),
    );
    candidates.push(
      ...jetBrainsProducts
        .sort()
        .reverse()
        .map((directory) => path.join(directory, "jbr")),
    );
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    );
  } else {
    candidates.push("/opt/android-studio/jbr", "/usr/lib/jvm/default-java");
  }

  for (const candidate of candidates) {
    if (await javaHomeIsUsable(candidate, platform)) return candidate;
  }

  return null;
}

async function androidSdkIsUsable(androidHome, platform) {
  if (!androidHome) return false;
  const adb = platform === "win32" ? "adb.exe" : "adb";
  return pathExists(path.join(androidHome, "platform-tools", adb));
}

export async function findAndroidHome({
  env = process.env,
  platform = process.platform,
  repoRoot = defaultRepoRoot,
} = {}) {
  for (const configured of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) {
    if (await androidSdkIsUsable(configured, platform)) return configured;
  }

  const candidates = [];
  if (platform === "win32") {
    if (env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, "Android", "Sdk"));
    }
    if (env.USERPROFILE) {
      candidates.push(path.join(env.USERPROFILE, "Android", "Sdk"));
    }
    candidates.push(
      path.join(path.parse(repoRoot).root, "Android", "Sdk"),
      "C:\\Android\\Sdk",
    );
  } else if (platform === "darwin") {
    if (env.HOME) {
      candidates.push(path.join(env.HOME, "Library", "Android", "sdk"));
    }
  } else if (env.HOME) {
    candidates.push(path.join(env.HOME, "Android", "Sdk"));
  }

  for (const candidate of candidates) {
    if (await androidSdkIsUsable(candidate, platform)) return candidate;
  }

  return null;
}

async function runProcess(command, args, options) {
  await new Promise((resolve, reject) => {
    const invocation = getProcessInvocation(command, args, {
      env: options.env,
    });
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: "inherit",
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const suffix = signal ? ` (signal ${signal})` : "";
      reject(
        new Error(
          `${options.label} failed with exit code ${code ?? "unknown"}${suffix}`,
        ),
      );
    });
  });
}

export async function prepareWindowsDependencies({
  corepackCommand = getCorepackCommand({ platform: "win32" }),
  ensureDependencyBridge = ensureWindowsDependencyBridge,
  env,
  log,
  mobileDir,
  repoRoot,
  runCommand = runProcess,
}) {
  const modulesFile = path.join(repoRoot, "node_modules", ".modules.yaml");
  const dependencyFingerprintPath = path.join(
    repoRoot,
    "node_modules",
    dependencyFingerprintFilename,
  );
  const virtualStoreDir = getWindowsVirtualStoreDir(repoRoot);
  const currentModules = (await pathExists(modulesFile))
    ? await readFile(modulesFile, "utf8")
    : "";
  const dependencyFingerprint = await computeDependencyFingerprint({
    repoRoot,
  });
  const existingDependencyFingerprint = (
    await pathExists(dependencyFingerprintPath)
  )
    ? (await readFile(dependencyFingerprintPath, "utf8")).trim()
    : "";

  if (
    dependencyLayoutMatches(currentModules, virtualStoreDir) &&
    existingDependencyFingerprint === dependencyFingerprint
  ) {
    await ensureDependencyBridge({ repoRoot, virtualStoreDir });
    log(`[android] 短路径依赖缓存已就绪: ${virtualStoreDir}`);
    return { prepared: false, virtualStoreDir };
  }

  log("[android] 首次准备 Windows 短路径依赖缓存，后续打包会直接复用");
  log(`[android] 依赖缓存目录: ${virtualStoreDir}`);

  const gradleWrapper = path.join(mobileDir, "android", "gradlew.bat");
  if (await pathExists(gradleWrapper)) {
    await runCommand(gradleWrapper, ["--stop"], {
      cwd: path.join(mobileDir, "android"),
      env,
      label: "Gradle daemon stop",
    });
  }

  const installEnv = {
    ...env,
    CI: "true",
    npm_config_virtual_store_dir_max_length: String(
      windowsVirtualStoreMaxLength,
    ),
  };
  await runCommand(
    corepackCommand,
    [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--virtual-store-dir",
      virtualStoreDir,
      "--prefer-offline",
    ],
    {
      cwd: repoRoot,
      env: installEnv,
      label: "pnpm short-path dependency setup",
    },
  );

  const updatedModules = await readFile(modulesFile, "utf8");
  if (!dependencyLayoutMatches(updatedModules, virtualStoreDir)) {
    throw new Error("pnpm completed but the short-path dependency layout is invalid");
  }
  await ensureDependencyBridge({ repoRoot, virtualStoreDir });
  await writeFile(
    dependencyFingerprintPath,
    `${dependencyFingerprint}\n`,
    "utf8",
  );

  const androidBuildDir = path.join(mobileDir, "android", "build");
  assertPathInside(mobileDir, androidBuildDir);
  await rm(androidBuildDir, { force: true, recursive: true });

  return { prepared: true, virtualStoreDir };
}

export async function buildAndroid({
  argv = [],
  log = console.log,
  mobileDir = defaultMobileDir,
  now = () => performance.now(),
  platform = process.platform,
  prepareDependencies = prepareWindowsDependencies,
  repoRoot = defaultRepoRoot,
  runCommand = runProcess,
} = {}) {
  const options = parseBuildArgs(argv);
  if (options.help) {
    printHelp(log);
    return { help: true };
  }

  const startedAt = now();
  const timings = {};
  const androidDir = path.join(mobileDir, "android");
  const envPath = path.join(mobileDir, ".env.production");
  const envValues = parseEnvFile(await readFile(envPath, "utf8"));
  const javaHome = await findJavaHome({ platform });
  const androidHome = await findAndroidHome({ platform, repoRoot });
  const buildEnv = {
    ...process.env,
    ...envValues,
    APP_ENV: "production",
    NODE_ENV: "production",
  };
  buildEnv.NODE_PATH = [
    path.join(mobileDir, "node_modules"),
    path.join(repoRoot, "node_modules"),
    buildEnv.NODE_PATH,
  ]
    .filter(Boolean)
    .join(path.delimiter);

  if (javaHome) {
    buildEnv.JAVA_HOME = javaHome;
    buildEnv.PATH = `${path.join(javaHome, "bin")}${path.delimiter}${buildEnv.PATH ?? ""}`;
    if (!process.env.JAVA_HOME) {
      log(`[android] 自动发现 JDK: ${javaHome}`);
    }
  }
  if (androidHome) {
    buildEnv.ANDROID_HOME = androidHome;
    buildEnv.ANDROID_SDK_ROOT = androidHome;
    buildEnv.PATH = `${path.join(androidHome, "platform-tools")}${path.delimiter}${buildEnv.PATH ?? ""}`;
    if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
      log(`[android] 自动发现 Android SDK: ${androidHome}`);
    }
  }

  const dependencyStartedAt = now();
  if (platform === "win32") {
    await prepareDependencies({
      env: buildEnv,
      log,
      mobileDir,
      repoRoot,
      runCommand,
    });
  }
  timings.dependencies = now() - dependencyStartedAt;

  const fingerprint = await computeNativeFingerprint({ mobileDir, repoRoot });
  const fingerprintPath = path.join(androidDir, fingerprintFilename);
  const existingFingerprint = (await pathExists(fingerprintPath))
    ? (await readFile(fingerprintPath, "utf8")).trim()
    : "";
  const nativeProjectExists = await pathExists(androidDir);
  const shouldSyncNative =
    options.syncNative ||
    options.clean ||
    !nativeProjectExists ||
    existingFingerprint !== fingerprint;

  if (shouldSyncNative) {
    const prebuildStartedAt = now();
    const reason = !nativeProjectExists
      ? "Android 原生工程不存在"
      : options.clean
        ? "请求了完整清理"
        : options.syncNative
          ? "请求了原生配置同步"
          : "原生配置指纹发生变化";
    log(`[android] 同步原生工程: ${reason}`);
    await runCommand(
      platform === "win32" ? getCorepackCommand({ platform }) : "pnpm",
      [
        ...(platform === "win32" ? ["pnpm"] : []),
        "exec",
        "expo",
        "prebuild",
        "-p",
        "android",
        "--no-install",
      ],
      {
        cwd: mobileDir,
        env: buildEnv,
        label: "Expo prebuild",
      },
    );
    await mkdir(androidDir, { recursive: true });
    await writeFile(fingerprintPath, `${fingerprint}\n`, "utf8");
    timings.prebuild = now() - prebuildStartedAt;
  } else {
    log("[android] 原生配置未变化，跳过 Expo prebuild");
    timings.prebuild = 0;
  }

  const gradleWrapper = path.join(
    androidDir,
    platform === "win32" ? "gradlew.bat" : "gradlew",
  );
  const gradleStartedAt = now();
  const architectures = options.universal ? "通用四架构" : "arm64";
  log(`[android] Gradle Release 构建: ${architectures}`);
  await access(gradleWrapper);
  await runCommand(gradleWrapper, getGradleArguments(options), {
    cwd: androidDir,
    env: buildEnv,
    label: "Gradle build",
  });
  timings.gradle = now() - gradleStartedAt;

  const sourceApk = path.join(
    androidDir,
    "app",
    "build",
    "outputs",
    "apk",
    "release",
    "app-release.apk",
  );
  await access(sourceApk);

  const outputDir = path.join(repoRoot, "dist");
  const outputName = options.universal
    ? "hongyi-linggong-android-universal-release.apk"
    : "hongyi-linggong-android-arm64-release.apk";
  const outputPath = path.join(outputDir, outputName);
  await mkdir(outputDir, { recursive: true });
  await copyFile(sourceApk, outputPath);

  const output = await readFile(outputPath);
  const outputStat = await stat(outputPath);
  const sha256 = createHash("sha256").update(output).digest("hex").toUpperCase();
  timings.total = now() - startedAt;

  log(`[android] APK: ${outputPath}`);
  log(`[android] 大小: ${(outputStat.size / 1024 / 1024).toFixed(1)} MB`);
  log(`[android] SHA256: ${sha256}`);
  log(
    `[android] 耗时: 依赖准备 ${formatDuration(timings.dependencies)}, prebuild ${formatDuration(timings.prebuild)}, Gradle ${formatDuration(timings.gradle)}, 总计 ${formatDuration(timings.total)}`,
  );

  return {
    help: false,
    outputPath,
    prebuildRan: shouldSyncNative,
    sha256,
    timings,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  buildAndroid({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(`[android] 打包失败: ${error.message}`);
    process.exitCode = 1;
  });
}
