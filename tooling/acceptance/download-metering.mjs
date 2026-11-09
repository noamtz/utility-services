import {
  createAwsEnvironment,
  identityArguments,
  validateAwsIdentity,
  resolveTrustedAwsCliPath,
} from "../aws-access.mjs";
import { parseInstallationArguments } from "../installation-arguments.mjs";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

/** @typedef {Record<string, string | undefined>} Environment */
/** @typedef {{ stdout: string }} CommandResult */
/** @typedef {(file: string, args: string[], options: { env: Environment, windowsHide: boolean }) => Promise<CommandResult>} ExecFile */
/** @typedef {{ ok: boolean, status: number, json: () => Promise<unknown>, arrayBuffer: () => Promise<ArrayBuffer> }} HarnessResponse */
/** @typedef {(url: string, init?: RequestInit) => Promise<HarnessResponse>} FetchLike */
/** @typedef {{ case: string, bytes?: number, requests?: number, successful?: boolean, cancelled?: boolean }} MatrixResult */
/** @typedef {{ installation: import("../../infra/config/installation-target.ts").ResolvedInstallationTarget, stage: string, apiUrl: string, fileId: string, logBucket: string, processorFunction: string, mainQueueUrl: string, dlqUrl: string, timeoutSeconds: number, expiryWaitSeconds: number, execute: boolean, redrive: boolean, redriveAuthorized: boolean, dlqArn: string | undefined, projectKey: string | undefined }} HarnessConfig */
/** @typedef {{ execFile?: ExecFile, fetch?: FetchLike, sleep?: (milliseconds: number) => Promise<void>, now?: () => number, env?: Environment }} HarnessDependencies */

const execFileDefault = /** @type {ExecFile} */ (
  /** @type {unknown} */ (promisify(execFileCallback))
);
const MATRIX_CASES = Object.freeze([
  "full",
  "range",
  "cancelled",
  "repeated",
  "expired-or-failed",
  "unused",
]);

/** @param {string[]} argv */
function optionMap(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item?.startsWith("--")) throw new Error("Only named arguments are accepted");
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) flags.add(item);
    else {
      values.set(item, next);
      index += 1;
    }
  }
  return { values, flags };
}

/** @param {Map<string, string>} values @param {string} name */
function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

/** @param {string} value @param {string} name */
function positiveInteger(value, name) {
  if (!/^\d+$/u.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

/** @param {string} value */
function safeStage(value) {
  if (value === "production" || value === "default" || value === "main") {
    throw new Error("Production and default stages are forbidden");
  }
  if (!/^(?:dev-[a-z0-9]+(?:-[a-z0-9]+)*|pr-[1-9]\d*)$/u.test(value)) {
    throw new Error("An explicit non-production --stage is required");
  }
  return value;
}

/** @param {string} value @param {string} name */
function httpsUrl(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  return url.toString().replace(/\/$/u, "");
}

/** @param {string[]} argv @param {Environment} [env] @returns {Readonly<HarnessConfig>} */
export function parseHarnessConfig(argv, env = process.env) {
  const { installation, args } = parseInstallationArguments(argv);
  const { values, flags } = optionMap([...args, "--stage", installation.stage.name]);
  const execute = flags.has("--execute");
  const redrive = flags.has("--redrive");
  const config = {
    installation,
    stage: safeStage(required(values, "--stage")),
    apiUrl: httpsUrl(required(values, "--api-url"), "--api-url"),
    fileId: required(values, "--file-id"),
    logBucket: required(values, "--log-bucket"),
    processorFunction: required(values, "--processor-function"),
    mainQueueUrl: httpsUrl(required(values, "--main-queue-url"), "--main-queue-url"),
    dlqUrl: httpsUrl(required(values, "--dlq-url"), "--dlq-url"),
    timeoutSeconds: positiveInteger(values.get("--timeout-seconds") ?? "900", "timeout"),
    expiryWaitSeconds: positiveInteger(values.get("--expiry-wait-seconds") ?? "360", "expiry wait"),
    execute,
    redrive,
    redriveAuthorized: flags.has("--redrive-authorized"),
    dlqArn: values.get("--dlq-arn"),
    projectKey: env["DOWNLOAD_METERING_PROJECT_KEY"],
  };
  if (execute && !redrive && !config.projectKey) {
    throw new Error("DOWNLOAD_METERING_PROJECT_KEY is required only for execution");
  }
  if (redrive && (!execute || !config.redriveAuthorized || !config.dlqArn)) {
    throw new Error("Redrive requires --execute, --redrive-authorized, and --dlq-arn");
  }
  return Object.freeze(config);
}

/** @param {import("../../infra/config/installation-target.ts").ResolvedInstallationTarget} target @param {Environment} [base] @returns {Environment} */
export function awsEnvironment(target, base = process.env) {
  const safeBase = Object.fromEntries(
    Object.entries(base).filter(([key]) => {
      const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
      return !/(?:projectkey|authorization|token|secret|password)/u.test(normalized);
    }),
  );
  return createAwsEnvironment(target, safeBase);
}

/** @param {import("../../infra/config/installation-target.ts").ResolvedInstallationTarget} target @param {ExecFile} [execFile] @param {Environment} [env] */
export async function verifyAwsIdentity(target, execFile = execFileDefault, env = process.env) {
  let result;
  try {
    result = await execFile(resolveTrustedAwsCliPath(), identityArguments(target), {
      env: awsEnvironment(target, env),
      windowsHide: true,
    });
  } catch {
    throw new Error("AWS authentication failed; verify the approved profile and CA bundle.");
  }
  return validateAwsIdentity(target, result.stdout);
}

/** @param {unknown} value */
export function redactAcceptanceText(value) {
  return String(value)
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]")
    .replace(/([?&](?:X-Amz-[^=]+|Signature|token|secret)=)[^&\s"']+/giu, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"']+\?[^\s"']+/giu, (url) => url.slice(0, url.indexOf("?")));
}

/** @param {HarnessResponse} response */
async function responseJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(`Control request failed with HTTP ${response.status}`);
  return body;
}

/** @param {unknown} body */
function opaqueDownloadUrl(body) {
  const root =
    body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : {};
  const data =
    root["data"] && typeof root["data"] === "object"
      ? /** @type {Record<string, unknown>} */ (root["data"])
      : {};
  const download =
    data["download"] && typeof data["download"] === "object"
      ? /** @type {Record<string, unknown>} */ (data["download"])
      : {};
  const candidate =
    download["url"] ?? data["downloadUrl"] ?? root["downloadUrl"] ?? data["url"] ?? root["url"];
  if (typeof candidate !== "string" || !candidate.startsWith("https://")) {
    throw new Error("Download authorization response did not contain an opaque HTTPS URL");
  }
  return candidate;
}

/** @param {HarnessResponse} response */
async function bytes(response) {
  if (!response.ok) throw new Error(`Transfer failed with HTTP ${response.status}`);
  return (await response.arrayBuffer()).byteLength;
}

/** @param {MatrixResult[]} results */
export function classifyMatrix(results) {
  const required = new Map(results.map((item) => [item.case, item]));
  const passed =
    MATRIX_CASES.every((name) => required.has(name)) &&
    (required.get("full")?.bytes ?? 0) > 0 &&
    (required.get("range")?.bytes ?? 0) > 0 &&
    required.get("repeated")?.requests === 2 &&
    required.get("expired-or-failed")?.successful === false &&
    required.get("unused")?.requests === 0 &&
    required.get("cancelled")?.cancelled === true;
  return Object.freeze({
    decision: passed ? "pass" : "fail",
    pricingRecommendation: passed
      ? "eligible-for-separate-reviewed-priced-deploy"
      : "remain-evidence-only",
    cases: MATRIX_CASES.map((name) => ({ case: name, passed: Boolean(required.get(name)) })),
  });
}

/** @param {HarnessConfig} config @param {{ fetch: FetchLike, sleep: (milliseconds: number) => Promise<void> }} dependencies */
async function runTransferMatrix(config, dependencies) {
  const authEndpoint = `${config.apiUrl}/v1/files/${encodeURIComponent(config.fileId)}/downloads`;
  const authorize = async () =>
    opaqueDownloadUrl(
      await responseJson(
        await dependencies.fetch(authEndpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.projectKey}` },
        }),
      ),
    );
  /** @type {MatrixResult[]} */
  const results = [];
  results.push({ case: "full", bytes: await bytes(await dependencies.fetch(await authorize())) });
  results.push({
    case: "range",
    bytes: await bytes(
      await dependencies.fetch(await authorize(), { headers: { Range: "bytes=0-9" } }),
    ),
  });
  const controller = new AbortController();
  const cancelledTransfer = dependencies
    .fetch(await authorize(), { signal: controller.signal })
    .then(bytes);
  await dependencies.sleep(100);
  controller.abort();
  try {
    await cancelledTransfer;
    results.push({ case: "cancelled", cancelled: false });
  } catch {
    results.push({ case: "cancelled", cancelled: true });
  }
  const repeatedUrl = await authorize();
  await bytes(await dependencies.fetch(repeatedUrl));
  await bytes(await dependencies.fetch(repeatedUrl));
  results.push({ case: "repeated", requests: 2 });
  const expiredUrl = await authorize();
  await dependencies.sleep(config.expiryWaitSeconds * 1_000);
  const expired = await dependencies.fetch(expiredUrl);
  results.push({ case: "expired-or-failed", successful: expired.ok });
  await authorize();
  results.push({ case: "unused", requests: 0 });
  return results;
}

/** @param {ExecFile} execFile @param {string} queueUrl @param {Environment} env */
async function queueDepth(execFile, queueUrl, env) {
  const output = await execFile(
    resolveTrustedAwsCliPath(),
    [
      "sqs",
      "get-queue-attributes",
      "--queue-url",
      queueUrl,
      "--attribute-names",
      "ApproximateNumberOfMessages",
      "ApproximateNumberOfMessagesNotVisible",
      "--output",
      "json",
    ],
    { env, windowsHide: true },
  );
  const parsed = JSON.parse(output.stdout);
  return (
    Number(parsed.Attributes?.ApproximateNumberOfMessages ?? 0) +
    Number(parsed.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0)
  );
}

/** @param {number} mainQueueDepth @param {number} deadLetterDepth @param {number} accepted */
export function acceptanceInfrastructurePassed(mainQueueDepth, deadLetterDepth, accepted) {
  return mainQueueDepth === 0 && deadLetterDepth === 0 && accepted >= 4;
}

/** @param {ExecFile} execFile @param {HarnessConfig} config @param {Environment} env @param {() => number} [now] */
async function listExactLogKeys(execFile, config, env, now = Date.now) {
  const date = new Date(now()).toISOString().slice(0, 10).replaceAll("-", "/");
  const output = await execFile(
    resolveTrustedAwsCliPath(),
    [
      "s3api",
      "list-objects-v2",
      "--bucket",
      config.logBucket,
      "--prefix",
      `AWSLogs/${config.installation.accountId}/CloudTrail/${config.installation.region}/${date}/`,
      "--max-items",
      "100",
      "--output",
      "json",
    ],
    { env, windowsHide: true },
  );
  const parsed = /** @type {{ Contents?: { Key?: unknown }[] }} */ (JSON.parse(output.stdout));
  /** @type {string[]} */
  const keys = [];
  for (const item of parsed.Contents ?? []) {
    if (typeof item.Key === "string" && item.Key.endsWith(".json.gz")) keys.push(item.Key);
  }
  return keys;
}

/** @param {ExecFile} execFile @param {HarnessConfig} config @param {Environment} env @param {{ sleep: (milliseconds: number) => Promise<void>, now: () => number }} dependencies */
async function pollForLogKeys(execFile, config, env, dependencies) {
  const startedAt = dependencies.now();
  while (dependencies.now() - startedAt < config.timeoutSeconds * 1_000) {
    const keys = await listExactLogKeys(execFile, config, env, dependencies.now);
    if (keys.length > 0) return keys;
    await dependencies.sleep(15_000);
  }
  throw new Error("Timed out waiting for retained CloudTrail logs");
}

/** @param {ExecFile} execFile @param {HarnessConfig} config @param {string[]} logKeys @param {Environment} env */
async function invokeExactReplay(execFile, config, logKeys, env) {
  const directory = await mkdtemp(join(tmpdir(), "download-metering-acceptance-"));
  const outputPath = join(directory, "invoke-output.json");
  try {
    const result = await execFile(
      resolveTrustedAwsCliPath(),
      [
        "lambda",
        "invoke",
        "--function-name",
        config.processorFunction,
        "--cli-binary-format",
        "raw-in-base64-out",
        "--payload",
        JSON.stringify({ kind: "reconcile-download-metering", logKeys }),
        "--output",
        "json",
        outputPath,
      ],
      { env, windowsHide: true },
    );
    const metadata = JSON.parse(result.stdout);
    if (metadata.FunctionError) throw new Error("Metering reconciliation invocation failed");
    const payload = JSON.parse(await readFile(outputPath, "utf8"));
    return Object.freeze({
      accepted: Number(payload.accepted ?? 0),
      recorded: Number(payload.recorded ?? 0),
      duplicates: Number(payload.duplicates ?? 0),
      quarantined: Number(payload.quarantined ?? 0),
      rebuiltPeriods: Number(payload.rebuiltPeriods ?? 0),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** @param {string[]} argv @param {HarnessDependencies} [dependencies] */
export async function runDownloadMeteringAcceptance(argv, dependencies = {}) {
  const config = parseHarnessConfig(argv, dependencies.env ?? process.env);
  const plan = Object.freeze({
    stage: config.stage,
    mode: config.redrive ? "redrive" : config.execute ? "execute" : "dry-run",
    matrix: MATRIX_CASES,
    pricingGate: "evidence-only",
    timeoutSeconds: config.timeoutSeconds,
    externalMutation: config.execute,
  });
  if (!config.execute) return Object.freeze({ plan, decision: "not-run" });
  if (config.installation.name !== "israel") {
    throw new Error(
      "WCU-02 regional metering is required before executing on another installation.",
    );
  }
  const execFile = dependencies.execFile ?? execFileDefault;
  const env = awsEnvironment(config.installation, dependencies.env ?? process.env);
  await verifyAwsIdentity(config.installation, execFile, env);
  if (config.redrive) {
    if (!config.dlqArn) throw new Error("Authorized redrive requires an exact DLQ ARN");
    const output = await execFile(
      resolveTrustedAwsCliPath(),
      [
        "sqs",
        "start-message-move-task",
        "--source-arn",
        config.dlqArn,
        "--max-number-of-messages-per-second",
        "10",
        "--output",
        "json",
      ],
      { env, windowsHide: true },
    );
    const parsed = JSON.parse(output.stdout);
    return Object.freeze({
      plan,
      decision: "redrive-started",
      taskHandlePresent: Boolean(parsed.TaskHandle),
    });
  }
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const sleep =
    dependencies.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const matrix = await runTransferMatrix(config, { fetch: fetchImpl, sleep });
  const logKeys = await pollForLogKeys(execFile, config, env, {
    sleep,
    now: dependencies.now ?? Date.now,
  });
  const replay = await invokeExactReplay(execFile, config, logKeys, env);
  const queue = await queueDepth(execFile, config.mainQueueUrl, env);
  const dlq = await queueDepth(execFile, config.dlqUrl, env);
  const classified = classifyMatrix(matrix);
  const infrastructurePassed = acceptanceInfrastructurePassed(queue, dlq, replay.accepted);
  return Object.freeze({
    plan,
    decision: infrastructurePassed ? classified.decision : "fail",
    pricingRecommendation: infrastructurePassed
      ? classified.pricingRecommendation
      : "remain-evidence-only",
    queueDepth: queue,
    deadLetterDepth: dlq,
    retainedLogCount: logKeys.length,
    replay,
    matrix: matrix.map((item) => ({ ...item })),
  });
}

async function main() {
  try {
    const result = await runDownloadMeteringAcceptance(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${redactAcceptanceText(error instanceof Error ? error.message : error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
