import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

export interface RunOptions extends SpawnOptions {
  capture?: boolean;
}

export async function run(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<string> {
  const { capture = false, ...spawnOptions } = options;
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  const child = spawn(command, args, {
    ...spawnOptions,
    stdio: capture ? (["ignore", "pipe", "pipe"] as const) : "inherit",
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) {
      resolve(stdout.trim());
    } else {
      const label = `${command}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;
      const detail = stderr.trim();
      reject(new Error(`${label} exited with ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`));
    }
  });

  return promise;
}

export async function tryRun(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<string | undefined> {
  try {
    return await run(command, args, options);
  } catch {
    return undefined;
  }
}
