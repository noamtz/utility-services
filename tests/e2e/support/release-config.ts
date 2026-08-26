export const RELEASE_EXECUTION_MARKER = "authorized-deployed";
export const RELEASE_EXPIRY_TIMEOUT_SECONDS = 7 * 60;

export const RELEASE_CASES = Object.freeze({
  twoOwnerSignIn: "two-owner-sign-in",
  twoOwnerProjects: "two-owner-projects",
  oneTimeKeyIssuance: "one-time-key-issuance",
  fiveMinutePrivateActivation: "five-minute-private-activation",
  stablePublicAccess: "stable-public-access",
  crossProjectAndGuessedIdDenial: "cross-project-and-guessed-id-denial",
  trashRestoreIdentity: "trash-restore-identity",
  keyReplacementAndUrlExpiry: "key-replacement-and-url-expiry",
  forceDelete: "force-delete",
  usageFreshness: "usage-freshness",
  keyRevocation: "key-revocation",
} as const);

export const RELEASE_CASE_NAMES = Object.freeze(Object.values(RELEASE_CASES));

export const RELEASE_ENVIRONMENT_KEYS = Object.freeze({
  execute: "RUS_RELEASE_EXECUTE",
  stage: "RUS_RELEASE_STAGE",
  dashboardUrl: "RUS_RELEASE_DASHBOARD_URL",
  apiUrl: "RUS_RELEASE_API_URL",
  confirmStage: "RUS_RELEASE_CONFIRM_STAGE",
  runLabel: "RUS_RELEASE_RUN_LABEL",
  completionTimeoutSeconds: "RUS_RELEASE_COMPLETION_TIMEOUT_SECONDS",
  expiryTimeoutSeconds: "RUS_RELEASE_EXPIRY_TIMEOUT_SECONDS",
  ownerAEmail: "RUS_RELEASE_OWNER_A_EMAIL",
  ownerAPassword: "RUS_RELEASE_OWNER_A_PASSWORD",
  ownerANewPassword: "RUS_RELEASE_OWNER_A_NEW_PASSWORD",
  ownerBEmail: "RUS_RELEASE_OWNER_B_EMAIL",
  ownerBPassword: "RUS_RELEASE_OWNER_B_PASSWORD",
  ownerBNewPassword: "RUS_RELEASE_OWNER_B_NEW_PASSWORD",
} as const);

export interface ReleaseOwnerCredentials {
  email: string;
  password: string;
  newPassword?: string;
}

export interface AuthorizedReleaseEnvironment {
  stage: string;
  dashboardUrl: string;
  apiUrl: string;
  runLabel: string;
  completionTimeoutSeconds: number;
  expiryTimeoutSeconds: number;
  ownerA: ReleaseOwnerCredentials;
  ownerB: ReleaseOwnerCredentials;
}

function requireValue(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key];
  if (!value) throw new Error(`Missing required release environment value: ${key}`);
  return value;
}

export function validateReleaseStage(value: string): string {
  if (value === "production" || value === "default" || value === "main") {
    throw new Error("Production and default stages are forbidden for release acceptance");
  }
  if (!/^(?:dev-[a-z0-9]+(?:-[a-z0-9]+)*|pr-[1-9]\d*)$/u.test(value)) {
    throw new Error("An explicit non-production release stage is required");
  }
  return value;
}

export function validateReleaseOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(`${name} must be an HTTPS origin`);
  }
  return url.origin;
}

export function validateRunLabel(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(value)) {
    throw new Error("Release run label must use 1-48 lowercase letters, digits, or hyphens");
  }
  return value;
}

export function validateBoundedSeconds(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  const resolved = value ?? String(fallback);
  if (!/^\d+$/u.test(resolved)) throw new Error(`${name} must be a whole number`);
  const seconds = Number(resolved);
  if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 900) {
    throw new Error(`${name} must be between 30 and 900 seconds`);
  }
  return seconds;
}

export function releaseBaseUrl(environment: NodeJS.ProcessEnv): string {
  const candidate = environment[RELEASE_ENVIRONMENT_KEYS.dashboardUrl];
  return candidate
    ? validateReleaseOrigin(candidate, RELEASE_ENVIRONMENT_KEYS.dashboardUrl)
    : "https://dashboard.example.invalid";
}

function ownerCredentials(
  environment: NodeJS.ProcessEnv,
  emailKey: string,
  passwordKey: string,
  newPasswordKey: string,
): ReleaseOwnerCredentials {
  const email = requireValue(environment, emailKey).trim();
  const password = requireValue(environment, passwordKey);
  if (!email || !password) throw new Error("Release owner credentials are incomplete");
  const newPassword = environment[newPasswordKey];
  return { email, password, ...(newPassword ? { newPassword } : {}) };
}

export function requireAuthorizedReleaseEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AuthorizedReleaseEnvironment {
  if (environment[RELEASE_ENVIRONMENT_KEYS.execute] !== RELEASE_EXECUTION_MARKER) {
    throw new Error("Release execution marker is missing or invalid");
  }
  const stage = validateReleaseStage(requireValue(environment, RELEASE_ENVIRONMENT_KEYS.stage));
  if (requireValue(environment, RELEASE_ENVIRONMENT_KEYS.confirmStage) !== stage) {
    throw new Error("Release stage confirmation does not match the selected stage");
  }
  const ownerA = ownerCredentials(
    environment,
    RELEASE_ENVIRONMENT_KEYS.ownerAEmail,
    RELEASE_ENVIRONMENT_KEYS.ownerAPassword,
    RELEASE_ENVIRONMENT_KEYS.ownerANewPassword,
  );
  const ownerB = ownerCredentials(
    environment,
    RELEASE_ENVIRONMENT_KEYS.ownerBEmail,
    RELEASE_ENVIRONMENT_KEYS.ownerBPassword,
    RELEASE_ENVIRONMENT_KEYS.ownerBNewPassword,
  );
  if (ownerA.email.toLowerCase() === ownerB.email.toLowerCase()) {
    throw new Error("Release acceptance requires two distinct invited owners");
  }
  const expiryTimeoutSeconds = validateBoundedSeconds(
    environment[RELEASE_ENVIRONMENT_KEYS.expiryTimeoutSeconds],
    RELEASE_ENVIRONMENT_KEYS.expiryTimeoutSeconds,
    RELEASE_EXPIRY_TIMEOUT_SECONDS,
  );
  if (expiryTimeoutSeconds < 65) {
    throw new Error("Release expiry timeout must allow the one-minute URL to expire");
  }
  return Object.freeze({
    stage,
    dashboardUrl: validateReleaseOrigin(
      requireValue(environment, RELEASE_ENVIRONMENT_KEYS.dashboardUrl),
      RELEASE_ENVIRONMENT_KEYS.dashboardUrl,
    ),
    apiUrl: validateReleaseOrigin(
      requireValue(environment, RELEASE_ENVIRONMENT_KEYS.apiUrl),
      RELEASE_ENVIRONMENT_KEYS.apiUrl,
    ),
    runLabel: validateRunLabel(environment[RELEASE_ENVIRONMENT_KEYS.runLabel] ?? "rus11"),
    completionTimeoutSeconds: validateBoundedSeconds(
      environment[RELEASE_ENVIRONMENT_KEYS.completionTimeoutSeconds],
      RELEASE_ENVIRONMENT_KEYS.completionTimeoutSeconds,
      180,
    ),
    expiryTimeoutSeconds,
    ownerA,
    ownerB,
  });
}
