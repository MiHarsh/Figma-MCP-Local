import { config as loadEnv } from "dotenv";
import { resolve as resolvePath } from "path";

export type Source = "cli" | "env" | "default";

export interface Resolved<T> {
  value: T;
  source: Source;
}

export interface ServerFlags {
  env?: string;
  port?: number;
  host?: string;
  json?: boolean;
  stdio?: boolean;
}

export interface ServerConfig {
  port: number;
  host: string;
  outputFormat: "yaml" | "json";
  isStdioMode: boolean;
}

/** Resolve a config value through the priority chain: CLI flag → env var → default. */
export function resolve<T>(flag: T | undefined, env: T | undefined, fallback: T): Resolved<T> {
  if (flag !== undefined) return { value: flag, source: "cli" };
  if (env !== undefined) return { value: env, source: "env" };
  return { value: fallback, source: "default" };
}

export function envStr(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function envInt(...names: string[]): number | undefined {
  for (const name of names) {
    const val = process.env[name];
    if (val) return parseInt(val, 10);
  }
  return undefined;
}

export function loadEnvFile(envPath?: string): string {
  const envFilePath = envPath ? resolvePath(envPath) : resolvePath(process.cwd(), ".env");
  loadEnv({ path: envFilePath, override: true });
  return envFilePath;
}

export function getServerConfig(flags: ServerFlags): ServerConfig {
  loadEnvFile(flags.env);

  const port = resolve(flags.port, envInt("FRAMELINK_PORT", "PORT"), 3333);
  const host = resolve(flags.host, envStr("FRAMELINK_HOST"), "127.0.0.1");

  const outputFormat = resolve<"yaml" | "json">(
    flags.json ? "json" : undefined,
    envStr("OUTPUT_FORMAT") as "yaml" | "json" | undefined,
    "yaml",
  );

  const isStdioMode = flags.stdio === true;

  if (!isStdioMode) {
    console.log("\nConfiguration:");
    console.log(`- PORT: ${port.value} (source: ${port.source})`);
    console.log(`- HOST: ${host.value} (source: ${host.source})`);
    console.log(`- OUTPUT_FORMAT: ${outputFormat.value} (source: ${outputFormat.source})`);
    console.log();
  }

  return {
    port: port.value,
    host: host.value,
    outputFormat: outputFormat.value,
    isStdioMode,
  };
}
