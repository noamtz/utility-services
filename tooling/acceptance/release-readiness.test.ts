import { describe, expect, it, vi } from "vitest";
import type { ExecFileOptions } from "node:child_process";

import {
  RELEASE_ENVIRONMENT_KEYS,
  RELEASE_EXECUTION_MARKER,
  requireAuthorizedReleaseEnvironment,
} from "../../tests/e2e/support/release-config.js";
import {
  parseReleaseArguments,
  parseReleaseResult,
  runReleaseReadiness,
  sanitizeReleaseEnvironment,
} from "./release-readiness.mjs";

const args = [
  "--stage",
  "dev-rus11-e2e",
  "--dashboard-url",
  "https://dashboard.example.com",
  "--api-url",
  "https://api.example.com",
  "--run-label",
  "release-one",
];

const secrets = {
  [RELEASE_ENVIRONMENT_KEYS.ownerAEmail]: "owner-a@example.com",
  [RELEASE_ENVIRONMENT_KEYS.ownerAPassword]: "owner-a-password",
  [RELEASE_ENVIRONMENT_KEYS.ownerBEmail]: "owner-b@example.com",
  [RELEASE_ENVIRONMENT_KEYS.ownerBPassword]: "owner-b-password",
};

function identity() {
  return {
    status: 0,
    stdout: JSON.stringify({
      Account: "162067902192",
      Arn: "arn:aws:iam::162067902192:user/ntz-cli",
    }),
  };
}

function sentinel(stage = "dev-rus11-e2e") {
  return `RUS_RELEASE_RESULT:${JSON.stringify({
    decision: "pass",
    stage,
    runTimestamp: "2026-08-26T10:00:00.000Z",
    activationSeconds: 42.5,
    cases: [
      { name: "two-owner-activation", status: "pass" },
      { name: "isolation-lifecycle", status: "pass" },
    ],
    caseCounts: { passed: 2, failed: 0 },
    projectResidue: true,
    externalGatesPending: [
      "cloudtrail-transfer-matrix",
      "production-alert-delivery",
      "two-user-product-experiment",
    ],
  })}`;
}

describe("release readiness acceptance policy", () => {
  it("is a no-network dry run by default with no implicit stage", async () => {
    const spawnSync = vi.fn();
    const execFile = vi.fn();
    await expect(runReleaseReadiness(args, { spawnSync, execFile, env: {} })).resolves.toEqual({
      decision: "not-run",
      plan: {
        stage: "dev-rus11-e2e",
        mode: "dry-run",
        externalMutation: false,
        runLabel: "release-one",
        cases: [
          "two-owner-browser-activation",
          "server-side-direct-transfer",
          "isolation-and-lifecycle",
          "five-minute-timing",
        ],
      },
    });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
    expect(() => parseReleaseArguments(args.slice(2))).toThrow("Missing required --stage");
  });

  it("rejects unsafe stages, origins, flags, bounds, and confirmations", () => {
    expect(() => parseReleaseArguments(args.with(1, "production"))).toThrow("forbidden");
    expect(() => parseReleaseArguments(args.with(3, "http://dashboard.example.com"))).toThrow(
      "HTTPS origin",
    );
    expect(() => parseReleaseArguments([...args, "--unknown"])).toThrow("Unknown");
    expect(() => parseReleaseArguments([...args, "--confirm-stage", "dev-rus11-e2e"])).toThrow(
      "only with --execute",
    );
    expect(() =>
      parseReleaseArguments([...args, "--execute", "--confirm-stage", "dev-other"]),
    ).toThrow("matching --stage");
    expect(() => parseReleaseArguments([...args, "--completion-timeout-seconds", "5"])).toThrow(
      "between 30 and 900",
    );
  });

  it("requires an exact marker, confirmation, and two distinct invited owners", () => {
    const environment = {
      ...secrets,
      [RELEASE_ENVIRONMENT_KEYS.execute]: RELEASE_EXECUTION_MARKER,
      [RELEASE_ENVIRONMENT_KEYS.stage]: "dev-rus11-e2e",
      [RELEASE_ENVIRONMENT_KEYS.dashboardUrl]: "https://dashboard.example.com",
      [RELEASE_ENVIRONMENT_KEYS.apiUrl]: "https://api.example.com",
      [RELEASE_ENVIRONMENT_KEYS.confirmStage]: "dev-rus11-e2e",
    };
    expect(requireAuthorizedReleaseEnvironment(environment)).toMatchObject({
      stage: "dev-rus11-e2e",
      runLabel: "rus11",
    });
    expect(() =>
      requireAuthorizedReleaseEnvironment({ ...environment, RUS_RELEASE_EXECUTE: "wrong" }),
    ).toThrow("marker");
    expect(() =>
      requireAuthorizedReleaseEnvironment({
        ...environment,
        [RELEASE_ENVIRONMENT_KEYS.ownerBEmail]: "OWNER-A@example.com",
      }),
    ).toThrow("distinct");
    expect(() =>
      requireAuthorizedReleaseEnvironment({
        ...environment,
        [RELEASE_ENVIRONMENT_KEYS.confirmStage]: "dev-other",
      }),
    ).toThrow("confirmation");
  });

  it("sanitizes inherited process injection and secret-shaped values", () => {
    const sanitized = sanitizeReleaseEnvironment({
      PATH: "safe-path",
      NODE_OPTIONS: "--require injected",
      AWS_ACCESS_KEY_ID: "inherited-access-key",
      AWS_SESSION_TOKEN: "session-value",
      SOME_PASSWORD: "password-value",
      RUS_RELEASE_OWNER_A_EMAIL: "owner-a@example.com",
      PLAYWRIGHT_BROWSERS_PATH: "unexpected",
      PWDEBUG: "1",
    });
    expect(sanitized).toEqual({ PATH: "safe-path" });
  });

  it("preflights the exact identity and launches the local CLI without a shell", async () => {
    const spawnSync = vi.fn().mockReturnValue(identity());
    const execFile = vi.fn((file: string, command: string[], options: ExecFileOptions) => {
      void file;
      void command;
      void options;
      return Promise.resolve({ stdout: sentinel(), stderr: "ignored" });
    });
    const result = await runReleaseReadiness(
      [...args, "--execute", "--confirm-stage", "dev-rus11-e2e"],
      { spawnSync, execFile, env: { PATH: "safe-path", ...secrets }, platform: "win32" },
    );
    expect(result).toMatchObject({ decision: "pass", activationSeconds: 42.5 });
    expect(spawnSync.mock.calls[0]?.[0]).toBe("aws");
    expect(spawnSync.mock.calls[0]?.[2]).toMatchObject({ shell: false });
    const [file, command, options] = execFile.mock.calls[0]!;
    expect(file).toBe(process.execPath);
    expect(command).toContain("--project=authorized-deployed");
    expect(command[0]).toMatch(/@playwright[\\/]test[\\/]cli\.js$/u);
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      timeout: 16 * 60 * 1_000,
      maxBuffer: 8 * 1_024,
    });
    expect(options.env).toMatchObject({
      AWS_PROFILE: "ntz-cli",
      AWS_REGION: "il-central-1",
      AWS_CA_BUNDLE: "C:\\Program Files\\Amazon\\AWSCLIV2\\awscli\\botocore\\cacert.pem",
      [RELEASE_ENVIRONMENT_KEYS.ownerAEmail]: "owner-a@example.com",
    });
    expect(JSON.stringify(result)).not.toMatch(/password|dashboard\.example|api\.example/u);
  });

  it("refuses wrong identity, child failure, missing results, and stage mismatch safely", async () => {
    const wrongIdentity = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ Account: "000000000000", Arn: "arn:aws:iam::000:user/wrong" }),
    });
    const executeArgs = [...args, "--execute", "--confirm-stage", "dev-rus11-e2e"];
    await expect(
      runReleaseReadiness(executeArgs, { spawnSync: wrongIdentity, env: secrets }),
    ).rejects.toThrow("identity mismatch");
    await expect(
      runReleaseReadiness(executeArgs, {
        spawnSync: vi.fn().mockReturnValue(identity()),
        execFile: vi.fn().mockRejectedValue(new Error("owner-a-password signed-url?secret=x")),
        env: secrets,
      }),
    ).rejects.toThrow("failed without publishable evidence");
    await expect(
      runReleaseReadiness(executeArgs, {
        spawnSync: vi.fn().mockReturnValue(identity()),
        execFile: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("timed out"), { killed: true })),
        env: secrets,
      }),
    ).rejects.toThrow("failed without publishable evidence");
    await expect(
      runReleaseReadiness(executeArgs, {
        spawnSync: vi.fn().mockReturnValue(identity()),
        execFile: vi.fn().mockResolvedValue({ stdout: "ordinary output", stderr: "" }),
        env: secrets,
      }),
    ).rejects.toThrow("exactly one safe result");
    await expect(
      runReleaseReadiness(executeArgs, {
        spawnSync: vi.fn().mockReturnValue(identity()),
        execFile: vi.fn().mockResolvedValue({ stdout: sentinel("dev-other"), stderr: "" }),
        env: secrets,
      }),
    ).rejects.toThrow("does not match execution");
  });

  it("strictly validates one bounded safe result", () => {
    expect(parseReleaseResult(sentinel())).toMatchObject({ decision: "pass" });
    expect(() => parseReleaseResult(`${sentinel()}\n${sentinel()}`)).toThrow("exactly one");
    expect(() => parseReleaseResult("x".repeat(9_000))).toThrow("size limit");
    expect(() => parseReleaseResult(sentinel().replace('"failed":0', '"failed":1'))).toThrow(
      "invalid safe result",
    );
  });
});
