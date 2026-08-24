import { writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  acceptanceInfrastructurePassed,
  classifyMatrix,
  parseHarnessConfig,
  redactAcceptanceText,
  runDownloadMeteringAcceptance,
  verifyAwsIdentity,
} from "./download-metering.mjs";

const args = [
  "--stage",
  "dev-rus02",
  "--api-url",
  "https://api.example.com",
  "--file-id",
  "fil_0123456789abcdefghijkl",
  "--log-bucket",
  "download-log-bucket",
  "--processor-function",
  "download-metering-processor",
  "--main-queue-url",
  "https://sqs.il-central-1.amazonaws.com/162067902192/main",
  "--dlq-url",
  "https://sqs.il-central-1.amazonaws.com/162067902192/dlq",
  "--timeout-seconds",
  "30",
  "--expiry-wait-seconds",
  "1",
];

function identity() {
  return JSON.stringify({
    Account: "162067902192",
    Arn: "arn:aws:iam::162067902192:user/ntz-cli",
  });
}

describe("download metering acceptance harness policy", () => {
  it("is a no-network dry run by default and has no default stage", async () => {
    const execFile = vi.fn();
    const fetch = vi.fn();
    await expect(
      runDownloadMeteringAcceptance(args, { execFile, fetch, env: {} }),
    ).resolves.toMatchObject({
      decision: "not-run",
      plan: {
        stage: "dev-rus02",
        mode: "dry-run",
        externalMutation: false,
        pricingGate: "evidence-only",
      },
    });
    expect(execFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(() => parseHarnessConfig(args.slice(2), {})).toThrow("Missing required --stage");
    expect(() => parseHarnessConfig(args.with(1, "production"), {})).toThrow("forbidden");
    expect(() => parseHarnessConfig(args.with(1, "default"), {})).toThrow("forbidden");
  });

  it("requires the exact AWS identity and fixed profile/region/CA environment", async () => {
    const wrong = vi.fn(
      (file: string, command: string[], options: { env: Record<string, string | undefined> }) => {
        void file;
        void command;
        void options;
        return Promise.resolve({
          stdout: JSON.stringify({ Account: "000000000000", Arn: "arn:aws:iam::000:user/wrong" }),
        });
      },
    );
    await expect(verifyAwsIdentity(wrong, {})).rejects.toThrow("identity mismatch");
    expect(wrong.mock.calls[0]?.[0]).toBe("aws");
    expect(wrong.mock.calls[0]?.[1]).toEqual(["sts", "get-caller-identity", "--output", "json"]);
    expect(wrong.mock.calls[0]?.[2]?.env).toMatchObject({
      AWS_PROFILE: "ntz-cli",
      AWS_REGION: "il-central-1",
      AWS_CA_BUNDLE: "C:\\Program Files\\Amazon\\AWSCLIV2\\awscli\\botocore\\cacert.pem",
    });
  });

  it("redacts bearer material and signed query strings", () => {
    const redacted = redactAcceptanceText(
      "Bearer super-secret https://bucket.example/key?X-Amz-Signature=abc&token=def",
    );
    expect(redacted).not.toMatch(/super-secret|abc|def/u);
    expect(redacted).toContain("Bearer [REDACTED]");
  });

  it("classifies the exact transfer matrix and fails incomplete evidence", () => {
    const pass = classifyMatrix([
      { case: "full", bytes: 100 },
      { case: "range", bytes: 10 },
      { case: "cancelled", cancelled: true },
      { case: "repeated", requests: 2 },
      { case: "expired-or-failed", successful: false },
      { case: "unused", requests: 0 },
    ]);
    expect(pass).toMatchObject({
      decision: "pass",
      pricingRecommendation: "eligible-for-separate-reviewed-priced-deploy",
    });
    expect(classifyMatrix([{ case: "full", bytes: 100 }])).toMatchObject({
      decision: "fail",
      pricingRecommendation: "remain-evidence-only",
    });
    expect(acceptanceInfrastructurePassed(0, 0, 4)).toBe(true);
    expect(acceptanceInfrastructurePassed(1, 0, 6)).toBe(false);
    expect(acceptanceInfrastructurePassed(0, 1, 6)).toBe(false);
    expect(acceptanceInfrastructurePassed(0, 0, 3)).toBe(false);
  });

  it("fails with a bounded timeout when retained logs do not arrive", async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new Error("aborted");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { downloadUrl: "https://download.example/file" } }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(url.includes("api.example") ? 0 : 10)),
      });
    });
    const execFile = vi.fn((file: string, command: string[]) => {
      void file;
      if (command[0] === "sts") return Promise.resolve({ stdout: identity() });
      return Promise.resolve({ stdout: JSON.stringify({ Contents: [] }) });
    });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(1_001);
    await expect(
      runDownloadMeteringAcceptance([...args, "--timeout-seconds", "1", "--execute"], {
        execFile,
        fetch,
        sleep: vi.fn(() => Promise.resolve()),
        now,
        env: { DOWNLOAD_METERING_PROJECT_KEY: "project-secret" },
      }),
    ).rejects.toThrow("Timed out waiting for retained CloudTrail logs");
    expect(JSON.stringify(execFile.mock.calls)).not.toContain("project-secret");
  });

  it("constructs native redrive only after explicit mutation authorization", async () => {
    expect(() =>
      parseHarnessConfig([...args, "--redrive", "--execute"], {
        DOWNLOAD_METERING_PROJECT_KEY: "project-secret",
      }),
    ).toThrow("Redrive requires");
    const execFile = vi.fn((file: string, command: string[]) => {
      void file;
      if (command[0] === "sts") return Promise.resolve({ stdout: identity() });
      return Promise.resolve({ stdout: JSON.stringify({ TaskHandle: "safe-task-handle" }) });
    });
    const result = await runDownloadMeteringAcceptance(
      [
        ...args,
        "--execute",
        "--redrive",
        "--redrive-authorized",
        "--dlq-arn",
        "arn:aws:sqs:il-central-1:162067902192:download-dlq",
      ],
      { execFile, env: { DOWNLOAD_METERING_PROJECT_KEY: "project-secret" } },
    );
    expect(result).toMatchObject({ decision: "redrive-started", taskHandlePresent: true });
    expect(execFile.mock.calls[1]?.[1]).toEqual([
      "sqs",
      "start-message-move-task",
      "--source-arn",
      "arn:aws:sqs:il-central-1:162067902192:download-dlq",
      "--max-number-of-messages-per-second",
      "10",
      "--output",
      "json",
    ]);
    expect(JSON.stringify(execFile.mock.calls)).not.toContain("project-secret");
  });
});

describe("download metering acceptance execution", () => {
  it("runs the matrix, finds retained logs, invokes exact replay, and checks queue health", async () => {
    let authorization = 0;
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("https://api.example.com/")) {
        authorization += 1;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: { downloadUrl: `https://download.example/${authorization}?secret=x` },
            }),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      }
      if (init?.signal?.aborted) throw new Error("aborted");
      const expired = url.includes("/5?");
      return Promise.resolve({
        ok: !expired,
        status: expired ? 403 : 200,
        json: () => Promise.resolve({}),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(url.includes("/2?") ? 10 : 100)),
      });
    });
    const execFile = vi.fn(async (_file: string, command: string[]) => {
      if (command[0] === "sts") return { stdout: identity() };
      if (command[0] === "s3api") {
        return {
          stdout: JSON.stringify({
            Contents: [
              {
                Key: "AWSLogs/162067902192/CloudTrail/il-central-1/2026/08/24/log.json.gz",
              },
            ],
          }),
        };
      }
      if (command[0] === "lambda") {
        const outputPath = command.at(-1)!;
        await writeFile(
          outputPath,
          JSON.stringify({
            accepted: 6,
            recorded: 0,
            duplicates: 6,
            quarantined: 1,
            rebuiltPeriods: 2,
          }),
        );
        return { stdout: JSON.stringify({ StatusCode: 200 }) };
      }
      if (command[0] === "sqs") {
        return { stdout: JSON.stringify({ Attributes: { ApproximateNumberOfMessages: "0" } }) };
      }
      throw new Error("unexpected command");
    });
    const result = await runDownloadMeteringAcceptance([...args, "--execute"], {
      execFile,
      fetch,
      sleep: vi.fn(() => Promise.resolve()),
      now: () => 0,
      env: { DOWNLOAD_METERING_PROJECT_KEY: "project-secret" },
    });
    expect(result).toMatchObject({
      decision: "pass",
      pricingRecommendation: "eligible-for-separate-reviewed-priced-deploy",
      retainedLogCount: 1,
      deadLetterDepth: 0,
      replay: { accepted: 6, duplicates: 6, rebuiltPeriods: 2 },
    });
    expect(fetch).toHaveBeenCalled();
    expect(execFile.mock.calls.find((call) => call[1][0] === "s3api")?.[1]).toContain(
      "AWSLogs/162067902192/CloudTrail/il-central-1/1970/01/01/",
    );
    expect(JSON.stringify(result)).not.toMatch(/project-secret|download\.example|AWSLogs/u);
    expect(JSON.stringify(execFile.mock.calls)).not.toContain("project-secret");
  });
});
