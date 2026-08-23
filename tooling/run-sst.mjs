import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { classifyStage } from "../infra/config/stage.ts";

const ALLOWED_COMMANDS = new Set(["install", "diff", "deploy", "dev"]);
const NETWORKED_COMMANDS = new Set(["diff", "deploy", "dev"]);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SST_ENTRYPOINT = path.join(REPOSITORY_ROOT, "node_modules", "sst", "bin", "sst.mjs");

export const AWS_ACCESS_POLICY = Object.freeze({
  accountId: "162067902192",
  principalArn: "arn:aws:iam::162067902192:user/ntz-cli",
  profile: "ntz-cli",
  region: "il-central-1",
  windowsCaBundle: "C:\\Program Files\\Amazon\\AWSCLIV2\\awscli\\botocore\\cacert.pem",
});

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
 * @param {NodeJS.ProcessEnv} environment
 * @param {NodeJS.Platform} platform
 */
export function createAwsEnvironment(environment = process.env, platform = process.platform) {
  return {
    ...environment,
    AWS_PROFILE: AWS_ACCESS_POLICY.profile,
    AWS_REGION: AWS_ACCESS_POLICY.region,
    AWS_DEFAULT_REGION: AWS_ACCESS_POLICY.region,
    ...(environment["AWS_CA_BUNDLE"]
      ? { AWS_CA_BUNDLE: environment["AWS_CA_BUNDLE"] }
      : platform === "win32"
        ? { AWS_CA_BUNDLE: AWS_ACCESS_POLICY.windowsCaBundle }
        : {}),
  };
}

/**
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptions) => { error?: Error, status: number | null, stdout?: string | Buffer }} spawn
 * @param {NodeJS.ProcessEnv} environment
 */
function verifyAwsIdentity(spawn, environment) {
  const result = spawn(
    "aws",
    [
      "sts",
      "get-caller-identity",
      "--profile",
      AWS_ACCESS_POLICY.profile,
      "--region",
      AWS_ACCESS_POLICY.region,
      "--output",
      "json",
    ],
    {
      cwd: REPOSITORY_ROOT,
      shell: false,
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `AWS authentication failed for required profile "${AWS_ACCESS_POLICY.profile}". Verify the profile and configured CA bundle before retrying.`,
    );
  }

  let identity;
  try {
    identity = JSON.parse(String(result.stdout ?? ""));
  } catch {
    throw new Error("AWS returned an unreadable caller identity.");
  }
  if (
    identity?.Account !== AWS_ACCESS_POLICY.accountId ||
    identity?.Arn !== AWS_ACCESS_POLICY.principalArn
  ) {
    throw new Error(
      `AWS identity mismatch. Expected ${AWS_ACCESS_POLICY.principalArn} in account ${AWS_ACCESS_POLICY.accountId}.`,
    );
  }
}

/**
 * @param {string[]} argv
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptions) => { error?: Error, status: number | null, stdout?: string | Buffer }} [spawn]
 */
export function runSst(argv, spawn = spawnSstProcess) {
  const invocation = parseSstInvocation(argv);
  const environment = createAwsEnvironment();
  if (NETWORKED_COMMANDS.has(invocation.command)) {
    verifyAwsIdentity(spawn, environment);
  }
  const result = spawn(process.execPath, [SST_ENTRYPOINT, invocation.command, ...invocation.args], {
    cwd: REPOSITORY_ROOT,
    shell: false,
    env: environment,
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
