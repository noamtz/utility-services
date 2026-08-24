import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_LOG_RETENTION_DAYS,
  DOWNLOAD_METERING_DLQ_RETENTION_DAYS,
  DOWNLOAD_METERING_DYNAMO_ACTIONS,
  DOWNLOAD_METERING_LOG_ACTIONS,
  DOWNLOAD_METERING_PROCESSOR_TIMEOUT_SECONDS,
  DOWNLOAD_METERING_QUEUE_VISIBILITY_SECONDS,
  DOWNLOAD_PRICING_MODE,
  assertDownloadMeteringPolicy,
  cloudTrailAccountLogPrefix,
  cloudTrailRegionalLogPrefix,
  downloadMeteringAdvancedSelectors,
  downloadMeteringTrailArn,
  downloadMeteringTrailName,
} from "./download-metering.js";

describe("download metering infrastructure policy", () => {
  it("builds stage-qualified deterministic trail names and exact ARNs", () => {
    expect(downloadMeteringTrailName("dev-rus02")).toBe(
      "utility-services-dev-rus02-download-metering",
    );
    expect(downloadMeteringTrailName("pr-42")).not.toBe(downloadMeteringTrailName("production"));
    expect(
      downloadMeteringTrailArn({
        partition: "aws",
        region: "il-central-1",
        accountId: "162067902192",
        trailName: downloadMeteringTrailName("dev-rus02"),
      }),
    ).toBe(
      "arn:aws:cloudtrail:il-central-1:162067902192:trail/utility-services-dev-rus02-download-metering",
    );
    expect(() => downloadMeteringTrailName("main")).toThrow();
    expect(() =>
      downloadMeteringTrailArn({
        partition: "aws",
        region: "*",
        accountId: "162067902192",
        trailName: "valid-trail",
      }),
    ).toThrow();
  });

  it("targets only regional CloudTrail logs for the configured account", () => {
    expect(cloudTrailRegionalLogPrefix("162067902192")).toBe(
      "AWSLogs/162067902192/CloudTrail/il-central-1/",
    );
    expect(cloudTrailAccountLogPrefix("162067902192")).toBe("AWSLogs/162067902192/");
    expect(() => cloudTrailRegionalLogPrefix("*")).toThrow();
  });

  it("selects only read-only project GetObject data events", () => {
    const selectors = downloadMeteringAdvancedSelectors(
      "arn:aws:s3:::utility-services-dev-rus02-filebucket",
    );
    expect(selectors).toEqual([
      {
        name: "Successful project GetObject data events",
        fieldSelectors: [
          { field: "eventCategory", equals: ["Data"] },
          { field: "resources.type", equals: ["AWS::S3::Object"] },
          { field: "eventName", equals: ["GetObject"] },
          { field: "readOnly", equals: ["true"] },
          {
            field: "resources.ARN",
            startsWiths: ["arn:aws:s3:::utility-services-dev-rus02-filebucket/projects/"],
          },
        ],
      },
    ]);
    const serialized = JSON.stringify(selectors);
    expect(serialized).not.toMatch(/Management|PutObject|DeleteObject|\*/u);
    expect(() => downloadMeteringAdvancedSelectors("arn:aws:s3:::*")).toThrow();
  });

  it("defaults to evidence-only with bounded retention, timing, and explicit actions", () => {
    expect(DOWNLOAD_PRICING_MODE).toBe("evidence-only");
    expect(DOWNLOAD_LOG_RETENTION_DAYS).toBe(90);
    expect(DOWNLOAD_METERING_DLQ_RETENTION_DAYS).toBe(14);
    expect(DOWNLOAD_METERING_QUEUE_VISIBILITY_SECONDS).toBeGreaterThan(
      DOWNLOAD_METERING_PROCESSOR_TIMEOUT_SECONDS,
    );
    expect([...DOWNLOAD_METERING_DYNAMO_ACTIONS, ...DOWNLOAD_METERING_LOG_ACTIONS]).not.toContain(
      expect.stringContaining("*"),
    );
    expect(assertDownloadMeteringPolicy).not.toThrow();
  });
});
