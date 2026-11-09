import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("native Node acceptance entry points", () => {
  it.each([
    ["release-readiness.mjs", ["--dashboard-url", "https://dashboard.example.com"]],
    [
      "download-metering.mjs",
      [
        "--file-id",
        "fixture",
        "--log-bucket",
        "fixture",
        "--processor-function",
        "fixture",
        "--main-queue-url",
        "https://sqs.il-central-1.amazonaws.com/162067902192/main",
        "--dlq-url",
        "https://sqs.il-central-1.amazonaws.com/162067902192/dlq",
      ],
    ],
  ] as const)("loads %s and plans locally without a TypeScript bundler", (script, args) => {
    const result = execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL(script, import.meta.url)),
        "--installation-target=israel",
        "--stage=dev-rus02",
        "--api-url",
        "https://api.example.com",
        ...args,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 },
    );
    expect(JSON.parse(result)).toMatchObject({
      decision: "not-run",
      plan: { externalMutation: false },
    });
  });
});
