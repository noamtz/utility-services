import { classifyStage, type StageClassification } from "./stage.js";

export const APP_NAME = "utility-services";
export const AWS_HOME = "aws";
export const AWS_PROVIDER_PACKAGE = "@pulumi/aws";
export const AWS_PROVIDER_VERSION = "7.43.0";
export const AWS_REGION = "il-central-1";

export interface AppPolicy {
  name: typeof APP_NAME;
  home: typeof AWS_HOME;
  stage: StageClassification;
  provider: {
    package: typeof AWS_PROVIDER_PACKAGE;
    version: typeof AWS_PROVIDER_VERSION;
    region: typeof AWS_REGION;
  };
  removal: "retain" | "remove";
  protect: boolean;
}

export function createAppPolicy(stageName: unknown): AppPolicy {
  const stage = classifyStage(stageName);
  const production = stage.kind === "production";

  return {
    name: APP_NAME,
    home: AWS_HOME,
    stage,
    provider: {
      package: AWS_PROVIDER_PACKAGE,
      version: AWS_PROVIDER_VERSION,
      region: AWS_REGION,
    },
    removal: production ? "retain" : "remove",
    protect: production,
  };
}
