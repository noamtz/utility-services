import {
  INSTALLATION_TARGET_ENV,
  INSTALLATION_STAGE_ENV,
  resolveInstallationEnvironment,
} from "../infra/config/installation-target.ts";

export const AWS_CLI_POLICY = Object.freeze({
  windowsCliPath: "C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe",
  posixCliPath: "/usr/bin/aws",
  windowsCaBundle: "C:\\Program Files\\Amazon\\AWSCLIV2\\awscli\\botocore\\cacert.pem",
});

/** @param {NodeJS.Platform} platform */
export function resolveTrustedAwsCliPath(platform = process.platform) {
  return platform === "win32" ? AWS_CLI_POLICY.windowsCliPath : AWS_CLI_POLICY.posixCliPath;
}

/**
 * @param {import("../infra/config/installation-target.ts").ResolvedInstallationTarget} target
 * @param {NodeJS.ProcessEnv} environment
 * @param {NodeJS.Platform} platform
 */
export function createAwsEnvironment(
  target,
  environment = process.env,
  platform = process.platform,
) {
  // Keep normal process settings and the trust bundle, but never inherit AWS auth,
  // endpoint, profile-file, region or SST selection overrides (including Windows casing).
  const clean = Object.fromEntries(
    Object.entries(environment).filter(([key]) => {
      const name = key.toUpperCase();
      return (
        !name.startsWith("AWS_") &&
        !name.startsWith("SST_") &&
        !name.startsWith("RUS_INSTALLATION_") &&
        name !== "NODE_OPTIONS" &&
        name !== "NODE_PATH"
      );
    }),
  );
  const result = {
    ...clean,
    AWS_PROFILE: target.profile,
    AWS_REGION: target.region,
    AWS_DEFAULT_REGION: target.region,
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
    [INSTALLATION_TARGET_ENV]: target.name,
    [INSTALLATION_STAGE_ENV]: target.stage.name,
    ...(environment["AWS_CA_BUNDLE"]
      ? { AWS_CA_BUNDLE: environment["AWS_CA_BUNDLE"] }
      : platform === "win32"
        ? { AWS_CA_BUNDLE: AWS_CLI_POLICY.windowsCaBundle }
        : {}),
  };
  const checked = resolveInstallationEnvironment(target.stage.name, result);
  if (checked.accountId !== target.accountId || checked.principalArn !== target.principalArn) {
    throw new Error("Installation identity policy mismatch.");
  }
  return result;
}

/** @param {import("../infra/config/installation-target.ts").ResolvedInstallationTarget} target */
export function identityArguments(target) {
  return [
    "sts",
    "get-caller-identity",
    "--profile",
    target.profile,
    "--region",
    target.region,
    "--output",
    "json",
  ];
}

/** @param {import("../infra/config/installation-target.ts").ResolvedInstallationTarget} target @param {string | Buffer | undefined} output */
export function validateAwsIdentity(target, output) {
  let identity;
  try {
    identity = JSON.parse(String(output ?? ""));
  } catch {
    throw new Error("AWS returned an unreadable caller identity.");
  }
  if (identity?.Account !== target.accountId || identity?.Arn !== target.principalArn) {
    throw new Error(
      `AWS identity mismatch. Expected ${target.principalArn} in account ${target.accountId}.`,
    );
  }
  return Object.freeze({ accountId: identity.Account, principalArn: identity.Arn });
}

/**
 * @param {import("../infra/config/installation-target.ts").ResolvedInstallationTarget} target
 * @param {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptions) => { error?: Error, status: number | null, stdout?: string | Buffer }} spawn
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} cwd
 * @param {string} awsCliPath
 */
export function verifyAwsIdentity(
  target,
  spawn,
  environment,
  cwd,
  awsCliPath = resolveTrustedAwsCliPath(),
) {
  const checked = resolveInstallationEnvironment(target.stage.name, environment);
  if (
    checked.name !== target.name ||
    checked.accountId !== target.accountId ||
    checked.principalArn !== target.principalArn ||
    checked.region !== target.region
  ) {
    throw new Error("Installation identity policy mismatch.");
  }
  const result = spawn(awsCliPath, identityArguments(checked), {
    cwd,
    shell: false,
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `AWS authentication failed for required profile "${target.profile}". Verify the profile and configured CA bundle before retrying.`,
    );
  }

  return validateAwsIdentity(checked, result.stdout);
}
