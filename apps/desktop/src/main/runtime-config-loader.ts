import { app } from "electron";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import {
  DEFAULT_RUNTIME_CONFIG,
  parseRuntimeConfig,
  runtimeConfigFromDevEnv,
  type RuntimeConfig,
  type RuntimeConfigEnv,
  type RuntimeConfigResult,
  type RuntimeConfigWriteInput,
} from "../shared/runtime-config";

export async function loadRuntimeConfig(options: {
  isDev: boolean;
  env: RuntimeConfigEnv;
  configPath?: string;
}): Promise<RuntimeConfigResult> {
  if (options.isDev) {
    try {
      return { ok: true, config: runtimeConfigFromDevEnv(options.env) };
    } catch (err) {
      return { ok: false, error: { message: errorMessage(err) } };
    }
  }

  const configPath = options.configPath ?? desktopConfigPath();
  try {
    const raw = await readFile(configPath, "utf-8");
    return { ok: true, config: parseRuntimeConfig(raw) };
  } catch (err) {
    if (isMissingFileError(err)) {
      return { ok: true, config: { ...DEFAULT_RUNTIME_CONFIG } };
    }
    return {
      ok: false,
      error: {
        message: `Invalid ${configPath}: ${errorMessage(err)}`,
      },
    };
  }
}

export async function saveRuntimeConfig(
  input: RuntimeConfigWriteInput,
  options: { configPath?: string } = {},
): Promise<RuntimeConfigResult> {
  const configPath = options.configPath ?? desktopConfigPath();
  try {
    const config = parseRuntimeConfig(
      JSON.stringify({
        schemaVersion: 1,
        apiUrl: input.apiUrl,
        appUrl: input.appUrl,
        wsUrl: input.wsUrl,
      }),
    );
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
      "utf-8",
    );
    return { ok: true, config };
  } catch (err) {
    return { ok: false, error: { message: errorMessage(err) } };
  }
}

export async function resetRuntimeConfig(
  options: { configPath?: string } = {},
): Promise<RuntimeConfigResult> {
  return saveRuntimeConfig(DEFAULT_RUNTIME_CONFIG, options);
}

export function desktopConfigPath(): string {
  return join(app.getPath("home"), ".multica", "desktop.json");
}

function isMissingFileError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT",
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { RuntimeConfig, RuntimeConfigResult };
