const MAX_STAGE_LENGTH = 63;
const PRODUCTION_STAGE = "production";
const PR_STAGE_PATTERN = /^pr-([1-9]\d*)$/;
const DEVELOPMENT_STAGE_PATTERN = /^dev-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type StageKind = "production" | "pull-request" | "development";

export interface StageClassification {
  name: string;
  kind: StageKind;
  ephemeral: boolean;
}

export class StageValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StageValidationError";
  }
}

export function classifyStage(value: unknown): StageClassification {
  if (typeof value !== "string" || value.length === 0) {
    throw new StageValidationError(
      "An explicit --stage is required: production, pr-<positive-integer>, or dev-<lowercase-slug>.",
    );
  }

  if (value.length > MAX_STAGE_LENGTH) {
    throw new StageValidationError(`Stage names must be at most ${MAX_STAGE_LENGTH} characters.`);
  }

  if (value === PRODUCTION_STAGE) {
    return { name: value, kind: "production", ephemeral: false };
  }

  if (PR_STAGE_PATTERN.test(value)) {
    return { name: value, kind: "pull-request", ephemeral: true };
  }

  if (DEVELOPMENT_STAGE_PATTERN.test(value)) {
    return { name: value, kind: "development", ephemeral: true };
  }

  throw new StageValidationError(
    `Invalid stage "${value}". Use production, pr-<positive-integer>, or dev-<lowercase-slug>.`,
  );
}
