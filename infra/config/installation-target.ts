import { classifyStage, type StageClassification } from "./stage.ts";

export const INSTALLATION_TARGET_ENV = "RUS_INSTALLATION_TARGET";
export const INSTALLATION_STAGE_ENV = "RUS_INSTALLATION_STAGE";

export interface InstallationTarget {
  readonly name: string;
  readonly accountId: string;
  readonly principalArn: string;
  readonly profile: string;
  readonly region: string;
  readonly stages: readonly string[];
  readonly developmentPrefix: string;
  readonly pullRequests: boolean;
}

export interface ResolvedInstallationTarget extends InstallationTarget {
  readonly stage: Readonly<StageClassification>;
}

// Adding an installation requires reviewed account/principal and stage bindings.
// Existing entries are identities, never a mechanism for moving a stage's region.
export const INSTALLATION_TARGETS: readonly InstallationTarget[] = Object.freeze([
  Object.freeze({
    name: "israel",
    accountId: "162067902192",
    principalArn: "arn:aws:iam::162067902192:user/ntz-cli",
    profile: "ntz-cli",
    region: "il-central-1",
    stages: Object.freeze(["dev-rus02", "dev-plan", "production"]),
    developmentPrefix: "dev-israel-",
    pullRequests: true,
  }),
]);

export class InstallationTargetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InstallationTargetError";
  }
}

/** Pure policy resolver; the optional registry supports local policy validation. */
export function resolveInstallationTarget(
  targetName: unknown,
  stageName: unknown,
  registry: readonly InstallationTarget[] = INSTALLATION_TARGETS,
): ResolvedInstallationTarget {
  if (typeof targetName !== "string" || !targetName) {
    throw new InstallationTargetError("Exactly one explicit --installation-target is required.");
  }
  const targets = registry.filter((target) => target.name === targetName);
  const target = targets[0];
  if (targets.length !== 1 || !target) {
    throw new InstallationTargetError("Unknown or ambiguous installation target.");
  }
  const stage = classifyStage(stageName);
  const owners = registry.filter(
    (candidate) =>
      candidate.stages.includes(stage.name) ||
      (stage.kind === "development" && stage.name.startsWith(candidate.developmentPrefix)) ||
      (stage.kind === "pull-request" && candidate.pullRequests),
  );
  if (owners.length !== 1 || owners[0] !== target) {
    throw new InstallationTargetError(
      "Stage is unbound, belongs to another target, or collides between installations.",
    );
  }
  return Object.freeze({
    ...target,
    stages: Object.freeze([...target.stages]),
    stage: Object.freeze(stage),
  });
}

/** SST app and run are evaluated separately; both must use the wrapper's exact binding. */
export function resolveInstallationEnvironment(
  stageName: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): ResolvedInstallationTarget {
  const installation = resolveInstallationTarget(environment[INSTALLATION_TARGET_ENV], stageName);
  if (
    environment[INSTALLATION_STAGE_ENV] !== installation.stage.name ||
    environment["AWS_REGION"] !== installation.region ||
    environment["AWS_DEFAULT_REGION"] !== installation.region ||
    environment["AWS_PROFILE"] !== installation.profile
  ) {
    throw new InstallationTargetError(
      "Installation environment mismatch; use the target-aware wrapper.",
    );
  }
  return installation;
}

/** Validate after SST loads dotenv, before it initializes any AWS provider. */
export function resolveSstAppInstallation(
  stageName: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): ResolvedInstallationTarget {
  const installation = resolveInstallationEnvironment(stageName, environment);
  const allowedAwsVariables = new Set([
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_CA_BUNDLE",
    "AWS_EC2_METADATA_DISABLED",
    "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS",
  ]);
  const hasOverride = Object.entries(environment).some(([key, value]) => {
    if (value === undefined) return false;
    const name = key.toUpperCase();
    // Exact casing also rejects duplicate Windows aliases of allowed variables.
    // SST_AWS_* credentials are generated later and must not exist at this boundary.
    return (
      (name.startsWith("AWS_") && !allowedAwsVariables.has(key)) || name.startsWith("SST_AWS_")
    );
  });
  if (
    hasOverride ||
    environment["AWS_EC2_METADATA_DISABLED"] !== "true" ||
    environment["AWS_IGNORE_CONFIGURED_ENDPOINT_URLS"] !== "true"
  ) {
    throw new InstallationTargetError(
      "AWS environment overrides are forbidden before SST provider initialization; remove them from dotenv files and use the target-aware wrapper.",
    );
  }
  return installation;
}
