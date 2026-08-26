// @ts-nocheck -- the wrapper validates its allowlist and argv before spawning pinned executables.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { classifyStage } from "../infra/config/stage.ts";
import { createAwsEnvironment, verifyAwsIdentity } from "./aws-access.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SST_ENTRYPOINT = path.join(REPOSITORY_ROOT, "node_modules", "sst", "bin", "sst.mjs");
const OPERATOR_SCRIPTS = Object.freeze({
  "set-suspension": path.join(REPOSITORY_ROOT, "tooling", "operations", "set-suspension.mjs"),
  "backfill-watermark-index": path.join(
    REPOSITORY_ROOT,
    "tooling",
    "operations",
    "backfill-watermark-index.mjs",
  ),
});

/** @param {string[]} argv */
export function parseOperatorInvocation(argv) {
  const [operation, ...args] = argv;
  if (!operation || !(operation in OPERATOR_SCRIPTS)) {
    throw new Error(`Unsupported operator command "${operation ?? ""}".`);
  }
  if (
    args.some((argument) => argument === "--table-name" || argument.startsWith("--table-name="))
  ) {
    throw new Error("Physical resource names cannot be supplied by the caller.");
  }

  const stages = [];
  const toolArgs = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--stage") {
      stages.push(args[index + 1]);
      index += 1;
    } else if (argument?.startsWith("--stage=")) {
      stages.push(argument.slice("--stage=".length));
    } else if (argument !== undefined) {
      toolArgs.push(argument);
    }
  }
  if (stages.length !== 1) throw new Error("Exactly one explicit --stage must be provided.");
  const stage = classifyStage(stages[0]);
  return Object.freeze({
    operation,
    script: OPERATOR_SCRIPTS[operation],
    stage,
    toolArgs: Object.freeze(toolArgs),
  });
}

function spawnProcess(command, args, options) {
  return spawnSync(command, args, options);
}

/** @param {string[]} argv @param {typeof spawnProcess} spawn */
export function runOperator(argv, spawn = spawnProcess) {
  const invocation = parseOperatorInvocation(argv);
  const environment = createAwsEnvironment();
  verifyAwsIdentity(spawn, environment, REPOSITORY_ROOT);
  const result = spawn(
    process.execPath,
    [
      SST_ENTRYPOINT,
      "shell",
      "--stage",
      invocation.stage.name,
      "--",
      process.execPath,
      invocation.script,
      "--stage-name",
      invocation.stage.name,
      ...invocation.toolArgs,
    ],
    {
      cwd: REPOSITORY_ROOT,
      shell: false,
      env: environment,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = runOperator(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Operator command failed."}\n`,
    );
    process.exitCode = 1;
  }
}
