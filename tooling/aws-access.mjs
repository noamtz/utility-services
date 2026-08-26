export const AWS_ACCESS_POLICY = Object.freeze({
  accountId: "162067902192",
  principalArn: "arn:aws:iam::162067902192:user/ntz-cli",
  profile: "ntz-cli",
  region: "il-central-1",
  windowsCaBundle: "C:\\Program Files\\Amazon\\AWSCLIV2\\awscli\\botocore\\cacert.pem",
});

/** @param {NodeJS.ProcessEnv} environment @param {NodeJS.Platform} platform */
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
 * @param {string} cwd
 */
export function verifyAwsIdentity(spawn, environment, cwd) {
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
      cwd,
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
  return Object.freeze({ accountId: identity.Account, principalArn: identity.Arn });
}
