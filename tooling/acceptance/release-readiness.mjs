import { execFile as execFileCallback, spawnSync as spawnSyncDefault } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAwsEnvironment, verifyAwsIdentity } from "../aws-access.mjs";
import {
  RELEASE_ENVIRONMENT_KEYS,
  RELEASE_EXECUTION_MARKER,
  RELEASE_CASE_NAMES,
  requireAuthorizedReleaseEnvironment,
  validateBoundedSeconds,
  validateReleaseOrigin,
  validateReleaseStage,
  validateRunLabel,
} from "../../tests/e2e/support/release-config.ts";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve("@playwright/test/cli");
const RESULT_PREFIX = "RUS_RELEASE_RESULT:";
const MAX_RESULT_BYTES = 8 * 1024;
const EXTERNAL_GATES = Object.freeze([
  "cloudtrail-transfer-matrix",
  "production-alert-delivery",
  "two-user-product-experiment",
]);
const VALUE_OPTIONS = new Set([
  "--stage",
  "--dashboard-url",
  "--api-url",
  "--confirm-stage",
  "--run-label",
  "--completion-timeout-seconds",
  "--expiry-timeout-seconds",
]);
const FLAG_OPTIONS = new Set(["--execute"]);

/** @typedef {Record<string, string | undefined>} Environment */
/** @typedef {{ stage: string, dashboardUrl: string, apiUrl: string, runLabel: string, completionTimeoutSeconds: number, expiryTimeoutSeconds: number, execute: boolean }} ReleaseArgumentConfig */
/** @typedef {{ stdout?: string | Buffer, stderr?: string | Buffer }} ReleaseProcessResult */
/** @typedef {(file: string, args: string[], options: import("node:child_process").ExecFileOptions) => Promise<ReleaseProcessResult>} ReleaseExecFile */
/** @typedef {{ cwd?: string, env?: Environment, platform?: NodeJS.Platform, spawnSync?: typeof spawnSyncDefault, execFile?: ReleaseExecFile }} ReleaseDependencies */
/** @typedef {{ name: string, status: "pass" }} ReleaseCase */
/** @typedef {{ decision: "pass", stage: string, runTimestamp: string, activationSeconds: number, cases: ReleaseCase[], caseCounts: { passed: number, failed: 0 }, projectResidue: true, externalGatesPending: string[] }} ReleaseResult */
/** @typedef {{ decision: "not-run", plan: { stage: string, mode: "dry-run", externalMutation: false, runLabel: string, cases: string[] } }} ReleaseDryRunResult */

/** @param {string[]} argv */
function optionMap(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) throw new Error("Only named release arguments are accepted");
    if (FLAG_OPTIONS.has(argument)) {
      if (flags.has(argument)) throw new Error(`Duplicate release option: ${argument}`);
      flags.add(argument);
      continue;
    }
    if (!VALUE_OPTIONS.has(argument)) throw new Error(`Unknown release option: ${argument}`);
    if (values.has(argument)) throw new Error(`Duplicate release option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  return { values, flags };
}

/** @param {Map<string, string>} values @param {string} name */
function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

/** @param {string[]} argv @returns {Readonly<ReleaseArgumentConfig>} */
export function parseReleaseArguments(argv) {
  const { values, flags } = optionMap(argv);
  const stage = validateReleaseStage(required(values, "--stage"));
  const execute = flags.has("--execute");
  const confirmStage = values.get("--confirm-stage");
  if (execute && confirmStage !== stage) {
    throw new Error("Execution requires an exact --confirm-stage matching --stage");
  }
  if (!execute && confirmStage !== undefined) {
    throw new Error("--confirm-stage is accepted only with --execute");
  }
  return Object.freeze({
    stage,
    dashboardUrl: validateReleaseOrigin(required(values, "--dashboard-url"), "--dashboard-url"),
    apiUrl: validateReleaseOrigin(required(values, "--api-url"), "--api-url"),
    runLabel: validateRunLabel(values.get("--run-label") ?? "rus11"),
    completionTimeoutSeconds: validateBoundedSeconds(
      values.get("--completion-timeout-seconds"),
      "--completion-timeout-seconds",
      180,
    ),
    expiryTimeoutSeconds: validateBoundedSeconds(
      values.get("--expiry-timeout-seconds"),
      "--expiry-timeout-seconds",
      90,
    ),
    execute,
  });
}

export function sanitizeReleaseEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => {
      const canonical = key.toUpperCase();
      const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
      return (
        !canonical.startsWith("AWS_") &&
        !canonical.startsWith("RUS_RELEASE_") &&
        !canonical.startsWith("PLAYWRIGHT_") &&
        canonical !== "NODE_OPTIONS" &&
        canonical !== "NODE_PATH" &&
        canonical !== "PWDEBUG" &&
        canonical !== "DEBUG" &&
        !/(?:authorization|bearer|apikey|password|token|secret|credential|session)/u.test(
          normalized,
        )
      );
    }),
  );
}

/** @param {ReleaseArgumentConfig} config @param {Environment} sourceEnvironment @returns {Environment} */
function releaseChildEnvironment(config, sourceEnvironment) {
  /** @type {Environment} */
  const environment = {
    ...sanitizeReleaseEnvironment(sourceEnvironment),
    [RELEASE_ENVIRONMENT_KEYS.execute]: RELEASE_EXECUTION_MARKER,
    [RELEASE_ENVIRONMENT_KEYS.stage]: config.stage,
    [RELEASE_ENVIRONMENT_KEYS.dashboardUrl]: config.dashboardUrl,
    [RELEASE_ENVIRONMENT_KEYS.apiUrl]: config.apiUrl,
    [RELEASE_ENVIRONMENT_KEYS.confirmStage]: config.stage,
    [RELEASE_ENVIRONMENT_KEYS.runLabel]: config.runLabel,
    [RELEASE_ENVIRONMENT_KEYS.completionTimeoutSeconds]: String(config.completionTimeoutSeconds),
    [RELEASE_ENVIRONMENT_KEYS.expiryTimeoutSeconds]: String(config.expiryTimeoutSeconds),
  };
  for (const key of [
    RELEASE_ENVIRONMENT_KEYS.ownerAEmail,
    RELEASE_ENVIRONMENT_KEYS.ownerAPassword,
    RELEASE_ENVIRONMENT_KEYS.ownerANewPassword,
    RELEASE_ENVIRONMENT_KEYS.ownerBEmail,
    RELEASE_ENVIRONMENT_KEYS.ownerBPassword,
    RELEASE_ENVIRONMENT_KEYS.ownerBNewPassword,
  ]) {
    const value = sourceEnvironment[key];
    if (value) environment[key] = value;
  }
  requireAuthorizedReleaseEnvironment(environment);
  return environment;
}

/** @param {unknown} value @param {string[]} expected */
function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...expected].sort().join("|")
  );
}

/** @param {string} output @returns {Readonly<ReleaseResult>} */
export function parseReleaseResult(output) {
  if (Buffer.byteLength(output, "utf8") > MAX_RESULT_BYTES) {
    throw new Error("Release result output exceeded the safe size limit");
  }
  const matches = output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(RESULT_PREFIX))
    .map((line) => line.slice(RESULT_PREFIX.length));
  if (matches.length !== 1) throw new Error("Release journey did not emit exactly one safe result");
  const match = matches[0];
  if (match === undefined) throw new Error("Release journey did not emit exactly one safe result");
  let parsed;
  try {
    parsed = JSON.parse(match);
  } catch {
    throw new Error("Release journey emitted an unreadable safe result");
  }
  if (
    !exactKeys(parsed, [
      "decision",
      "stage",
      "runTimestamp",
      "activationSeconds",
      "cases",
      "caseCounts",
      "projectResidue",
      "externalGatesPending",
    ]) ||
    parsed.decision !== "pass" ||
    typeof parsed.stage !== "string" ||
    !Number.isFinite(parsed.activationSeconds) ||
    parsed.activationSeconds < 0 ||
    parsed.activationSeconds >= 300 ||
    Number.isNaN(Date.parse(parsed.runTimestamp)) ||
    parsed.projectResidue !== true ||
    !Array.isArray(parsed.cases) ||
    parsed.cases.length === 0 ||
    parsed.cases.some(
      (/** @type {any} */ item) =>
        !exactKeys(item, ["name", "status"]) ||
        typeof item.name !== "string" ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(item.name) ||
        item.status !== "pass",
    ) ||
    parsed.cases.map((/** @type {any} */ item) => item.name).join("|") !==
      RELEASE_CASE_NAMES.join("|") ||
    !exactKeys(parsed.caseCounts, ["passed", "failed"]) ||
    !Number.isSafeInteger(parsed.caseCounts.passed) ||
    parsed.caseCounts.passed !== parsed.cases.length ||
    parsed.caseCounts.failed !== 0 ||
    !Array.isArray(parsed.externalGatesPending) ||
    parsed.externalGatesPending.join("|") !== EXTERNAL_GATES.join("|")
  ) {
    throw new Error("Release journey emitted an invalid safe result");
  }
  validateReleaseStage(parsed.stage);
  return Object.freeze(/** @type {ReleaseResult} */ (parsed));
}

/** @param {string} file @param {string[]} args @param {import("node:child_process").ExecFileOptions} options @returns {Promise<ReleaseProcessResult>} */
function execFileDefault(file, args, options) {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** @param {string[]} argv @param {ReleaseDependencies} [dependencies] @returns {Promise<Readonly<ReleaseResult | ReleaseDryRunResult>>} */
export async function runReleaseReadiness(argv, dependencies = {}) {
  const config = parseReleaseArguments(argv);
  if (!config.execute) {
    return Object.freeze(
      /** @type {ReleaseDryRunResult} */ ({
        decision: "not-run",
        plan: {
          stage: config.stage,
          mode: "dry-run",
          externalMutation: false,
          runLabel: config.runLabel,
          cases: [
            "two-owner-browser-activation",
            "server-side-direct-transfer",
            "isolation-and-lifecycle",
            "five-minute-timing",
          ],
        },
      }),
    );
  }

  const cwd = dependencies.cwd ?? REPOSITORY_ROOT;
  const sourceEnvironment = dependencies.env ?? process.env;
  const childEnvironment = releaseChildEnvironment(config, sourceEnvironment);
  const awsEnvironment = createAwsEnvironment(childEnvironment, dependencies.platform);
  verifyAwsIdentity(dependencies.spawnSync ?? spawnSyncDefault, awsEnvironment, cwd);

  let result;
  try {
    result = await (dependencies.execFile ?? execFileDefault)(
      process.execPath,
      [PLAYWRIGHT_CLI, "test", "--project=authorized-deployed"],
      {
        cwd,
        shell: false,
        windowsHide: true,
        env: awsEnvironment,
        timeout: 16 * 60 * 1_000,
        maxBuffer: MAX_RESULT_BYTES,
      },
    );
  } catch {
    throw new Error("Release browser journey failed without publishable evidence");
  }
  const summary = parseReleaseResult(String(result.stdout ?? ""));
  if (summary.stage !== config.stage)
    throw new Error("Release result stage does not match execution");
  return summary;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  try {
    const result = await runReleaseReadiness(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Release acceptance could not run";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
