import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "node:util";

import { resolveInstallationTarget } from "../infra/config/installation-target.ts";
import { createAwsEnvironment, verifyAwsIdentity } from "./aws-access.mjs";

interface SstConfig {
  app(input: { stage: string }): Promise<{
    name: string;
    providers: { aws: { region: string } };
  }>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadAppAfterPreflight(dotenv: string) {
  const target = resolveInstallationTarget("israel", "dev-rus02");
  const environment = createAwsEnvironment(target, {});
  const sts = vi.fn().mockReturnValue({
    status: 0,
    stdout: JSON.stringify({ Account: target.accountId, Arn: target.principalArn }),
  });
  verifyAwsIdentity(target, sts, environment, process.cwd());
  expect(sts).toHaveBeenCalledOnce();

  // SST loads .env and then overloads .env.<stage> after the wrapper's preflight.
  for (const key of Object.keys(process.env)) {
    if (/^(?:AWS_|SST_AWS_|RUS_INSTALLATION_)/iu.test(key)) vi.stubEnv(key, undefined);
  }
  for (const [key, value] of Object.entries({ ...environment, ...parseEnv(dotenv) })) {
    vi.stubEnv(key, value);
  }
  vi.stubGlobal("$config", (config: SstConfig) => config);
  // Execute only the real app hook; no SST CLI, AWS provider, or run() is started.
  const configUrl = new URL("../sst.config.ts", import.meta.url).href;
  const { default: config } = (await import(configUrl)) as { default: SstConfig };
  return config;
}

describe("SST app boundary after dotenv loading", () => {
  it.each([
    "AWS_CONFIG_FILE=C:/synthetic/other-config",
    "AWS_SHARED_CREDENTIALS_FILE=C:/synthetic/other-credentials",
    "aws_shared_credentials_file=C:/synthetic/other-credentials",
    "AWS_ACCESS_KEY_ID=synthetic-key\nAWS_SECRET_ACCESS_KEY=synthetic-secret",
    "AWS_WEB_IDENTITY_TOKEN_FILE=C:/synthetic/token",
    "AWS_ENDPOINT_URL_S3=https://endpoint.example.com",
    "SST_AWS_ACCESS_KEY_ID=synthetic-key",
    "AWS_EC2_METADATA_DISABLED=false",
    "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS=false",
  ])("rejects reintroduced overrides before provider configuration: %s", async (dotenv) => {
    const config = await loadAppAfterPreflight(dotenv);
    const initializeProvider = vi.fn();
    await expect(config.app({ stage: "dev-rus02" }).then(initializeProvider)).rejects.toThrow(
      "AWS environment overrides",
    );
    expect(initializeProvider).not.toHaveBeenCalled();
  });

  it("preserves the existing provider binding with normal application dotenv values", async () => {
    const config = await loadAppAfterPreflight("APPLICATION_LABEL=local-test");
    await expect(config.app({ stage: "dev-rus02" })).resolves.toMatchObject({
      name: "utility-services",
      providers: { aws: { region: "il-central-1" } },
    });
  });
});
