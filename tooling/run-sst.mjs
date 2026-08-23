import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { classifyStage } from "../infra/config/stage.ts";

const ALLOWED_COMMANDS = new Set(["install", "diff", "deploy", "dev"]);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SST_ENTRYPOINT = path.join(REPOSITORY_ROOT, "node_modules", "sst", "bin", "sst.mjs");

/** @param {string[]} argv */
export function parseSstInvocation(argv) {
  const [command, ...args] = argv;
  if (!command || !ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Unsupported SST command "${command ?? ""}".`);
  }

  const stages = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--stage") {
      stages.push(args[index + 1]);
      index += 1;
    } else if (argument?.startsWith("--stage=")) {
      stages.push(argument.slice("--stage=".length));
    }
  }

  if (stages.length !== 1) {
    throw new Error("Exactly one explicit --stage must be provided.");
  }

  const stage = classifyStage(stages[0]);
  if ((command === "dev" || command === "deploy") && stage.kind === "production") {
    throw new Error(`SST ${command} cannot target production through the foundation workflow.`);
  }

  return { command, args, stage };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptions} options
 */
function spawnSstProcess(command, args, options) {
  return spawnSync(command, args, options);
}

/**
 * @param {string[]} argv
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptions) => { error?: Error, status: number | null }} [spawn]
 */
export function runSst(argv, spawn = spawnSstProcess) {
  const invocation = parseSstInvocation(argv);
  const result = spawn(process.execPath, [SST_ENTRYPOINT, invocation.command, ...invocation.args], {
    cwd: REPOSITORY_ROOT,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = runSst(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run SST.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
