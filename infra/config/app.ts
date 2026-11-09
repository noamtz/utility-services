import type { StageClassification } from "./stage.js";
import {
  resolveInstallationTarget,
  type ResolvedInstallationTarget,
} from "./installation-target.js";

export const APP_NAME = "utility-services";
export const AWS_HOME = "aws";
export const AWS_PROVIDER_PACKAGE = "@pulumi/aws";
export const AWS_PROVIDER_VERSION = "7.43.0";

export interface AppPolicy {
  name: typeof APP_NAME;
  home: typeof AWS_HOME;
  stage: StageClassification;
  installation: ResolvedInstallationTarget;
  provider: {
    package: typeof AWS_PROVIDER_PACKAGE;
    version: typeof AWS_PROVIDER_VERSION;
    region: string;
  };
  removal: "retain" | "remove";
  protect: boolean;
}

export function createAppPolicy(targetName: unknown, stageName: unknown): AppPolicy {
  const installation = resolveInstallationTarget(targetName, stageName);
  const { stage } = installation;
  const production = stage.kind === "production";

  return {
    name: APP_NAME,
    home: AWS_HOME,
    stage,
    installation,
    provider: {
      package: AWS_PROVIDER_PACKAGE,
      version: AWS_PROVIDER_VERSION,
      region: installation.region,
    },
    removal: production ? "retain" : "remove",
    protect: production,
  };
}
