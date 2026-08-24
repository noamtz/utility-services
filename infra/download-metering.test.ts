import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DOWNLOAD_LOG_BUCKET_COMPONENT_NAME,
  DOWNLOAD_METERING_DLQ_COMPONENT_NAME,
  DOWNLOAD_METERING_NOTIFICATION_COMPONENT_NAME,
  DOWNLOAD_METERING_PROCESSOR_COMPONENT_NAME,
  DOWNLOAD_METERING_QUEUE_COMPONENT_NAME,
  DOWNLOAD_METERING_TRAIL_COMPONENT_NAME,
} from "./config/download-metering.js";

interface TestOutput<T> extends SstOutput<T> {
  readonly value: T;
}

function output<T>(value: T): TestOutput<T> {
  return {
    value,
    apply(callback) {
      return output(callback(value));
    },
  };
}

function valueOf(value: unknown): unknown {
  return value && typeof value === "object" && "value" in value
    ? (value as TestOutput<unknown>).value
    : value;
}

afterEach(() => vi.unstubAllGlobals());

describe("download metering resources", () => {
  it("creates a narrow private CloudTrail-to-SQS-to-processor graph", async () => {
    const bucketCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const queueCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const subscriptionCalls: Array<{ name: string; subscriber: unknown; args: unknown }> = [];
    const iamCalls: Array<Record<string, unknown>> = [];
    const queuePolicyCalls: Array<{ name: string; args: unknown }> = [];
    const notificationCalls: Array<{ name: string; args: unknown; options: unknown }> = [];
    const trailCalls: Array<{ name: string; args: Record<string, unknown>; options: unknown }> = [];

    class Dynamo {
      public readonly name = output("usage-table");
      public readonly arn = output("arn:aws:dynamodb:il-central-1:162067902192:table/usage");
    }
    class Bucket {
      public readonly name: TestOutput<string>;
      public readonly arn: TestOutput<string>;
      public readonly nodes = { bucket: {} };
      public constructor(
        public readonly componentName: string,
        args: Record<string, unknown> = {},
      ) {
        bucketCalls.push({ name: componentName, args });
        const physical =
          componentName === "FileBucket" ? "stage-file-bucket" : "stage-download-log-bucket";
        this.name = output(physical);
        this.arn = output(`arn:aws:s3:::${physical}`);
      }
      public notify() {
        return {};
      }
    }
    class Queue {
      public readonly arn: TestOutput<string>;
      public readonly url: TestOutput<string>;
      public constructor(
        public readonly componentName: string,
        args: Record<string, unknown> = {},
      ) {
        queueCalls.push({ name: componentName, args });
        this.arn = output(`arn:aws:sqs:il-central-1:162067902192:${componentName}`);
        this.url = output(`https://sqs.il-central-1.amazonaws.com/162067902192/${componentName}`);
      }
      public subscribe(subscriber: unknown, args: unknown) {
        subscriptionCalls.push({ name: this.componentName, subscriber, args });
        return { kind: "subscription" };
      }
    }
    class Function {
      public readonly name = output("download-metering-processor");
      public readonly arn = output(
        "arn:aws:lambda:il-central-1:162067902192:function:download-metering-processor",
      );
      public constructor(name: string, args: Record<string, unknown>) {
        functionCalls.push({ name, args });
      }
    }
    class QueuePolicy {
      public constructor(name: string, args: unknown) {
        queuePolicyCalls.push({ name, args });
      }
    }
    class BucketNotification {
      public constructor(name: string, args: unknown, options: unknown) {
        notificationCalls.push({ name, args, options });
      }
    }
    class Trail {
      public readonly arn = output("trail-arn");
      public constructor(name: string, args: Record<string, unknown>, options: unknown) {
        trailCalls.push({ name, args, options });
      }
    }

    vi.stubGlobal("$app", { stage: "dev-rus02" });
    vi.stubGlobal("$interpolate", (strings: TemplateStringsArray, ...values: unknown[]) =>
      output(
        strings.reduce(
          (result, part, index) => `${result}${String(valueOf(values[index - 1]))}${part}`,
        ),
      ),
    );
    vi.stubGlobal("sst", {
      Linkable: { wrap: vi.fn() },
      aws: { Bucket, Dynamo, Queue, Function, permission: vi.fn((args: unknown) => args) },
    });
    vi.stubGlobal("aws", {
      iam: {
        getPolicyDocumentOutput(args: Record<string, unknown>) {
          iamCalls.push(args);
          return { json: output(JSON.stringify(args, (_key, item) => valueOf(item))) };
        },
      },
      s3: { BucketNotification },
      sqs: { QueuePolicy },
      cloudtrail: { Trail },
    });
    vi.resetModules();
    const { createDownloadMeteringResources } = await import("./download-metering.js");
    const fileBucket = new Bucket("FileBucket");
    const usageTable = new Dynamo();

    const resources = createDownloadMeteringResources({
      production: true,
      fileBucket,
      usageTable,
    });

    const logBucket = bucketCalls.find((call) => call.name === DOWNLOAD_LOG_BUCKET_COMPONENT_NAME)!;
    expect(logBucket.args).toMatchObject({
      cors: false,
      enforceHttps: true,
      lifecycle: [
        {
          prefix: "AWSLogs/162067902192/",
          expiresIn: "90 days",
        },
      ],
    });
    const bucketTransform = logBucket.args["transform"] as {
      bucket(args: Record<string, unknown>): void;
      publicAccessBlock(args: Record<string, unknown>): void;
    };
    const rawBucket: Record<string, unknown> = {};
    const publicAccess: Record<string, unknown> = {};
    bucketTransform.bucket(rawBucket);
    bucketTransform.publicAccessBlock(publicAccess);
    expect(rawBucket).toEqual({ forceDestroy: false });
    expect(Object.values(publicAccess).every(Boolean)).toBe(true);

    const bucketPolicies = logBucket.args["policy"] as Array<Record<string, unknown>>;
    expect(bucketPolicies).toHaveLength(2);
    expect(JSON.stringify(bucketPolicies)).toContain(
      "arn:aws:cloudtrail:il-central-1:162067902192:trail/utility-services-dev-rus02-download-metering",
    );
    expect(JSON.stringify(bucketPolicies)).toContain("AWSLogs/162067902192/*");
    expect(JSON.stringify(bucketPolicies)).not.toContain("trail-arn");
    const queueStatements = iamCalls[0]?.["statements"] as Array<Record<string, unknown>>;
    expect(queueStatements).toMatchObject([
      {
        actions: ["sqs:SendMessage"],
        principals: [{ type: "Service", identifiers: ["s3.amazonaws.com"] }],
      },
    ]);
    expect(JSON.stringify(queueStatements)).toContain("aws:SourceAccount");
    expect(JSON.stringify(queueStatements)).not.toContain("sns.amazonaws.com");

    expect(queueCalls.map((call) => call.name)).toEqual([
      DOWNLOAD_METERING_DLQ_COMPONENT_NAME,
      DOWNLOAD_METERING_QUEUE_COMPONENT_NAME,
    ]);
    const dlqRaw: Record<string, unknown> = {};
    const queueRaw: Record<string, unknown> = {};
    (queueCalls[0]!.args["transform"] as { queue(args: Record<string, unknown>): void }).queue(
      dlqRaw,
    );
    (queueCalls[1]!.args["transform"] as { queue(args: Record<string, unknown>): void }).queue(
      queueRaw,
    );
    expect(dlqRaw).toEqual({ messageRetentionSeconds: 1_209_600, sqsManagedSseEnabled: true });
    expect(queueRaw).toEqual({ sqsManagedSseEnabled: true });
    expect(queueCalls[1]!.args).toMatchObject({
      visibilityTimeout: "180 seconds",
      dlq: { retry: 5 },
    });

    const processor = functionCalls[0]!;
    expect(processor.name).toBe(DOWNLOAD_METERING_PROCESSOR_COMPONENT_NAME);
    expect(processor.args).toMatchObject({
      runtime: "nodejs24.x",
      timeout: "60 seconds",
      memory: "512 MB",
      environment: {
        DOWNLOAD_PRICING_MODE: "evidence-only",
        CLOUDTRAIL_REGION: "il-central-1",
      },
      link: [expect.any(Bucket), usageTable],
    });
    const permissions = processor.args["permissions"] as Array<{ actions: string[] }>;
    expect(permissions.flatMap((permission) => permission.actions)).toEqual(
      expect.arrayContaining(["s3:GetObject", "dynamodb:TransactWriteItems", "sqs:ReceiveMessage"]),
    );
    expect(JSON.stringify(permissions)).not.toMatch(/s3:\*|dynamodb:\*|s3:PutObject/u);
    expect(JSON.stringify(processor.args)).not.toContain("stage-file-bucket/projects/");
    expect(subscriptionCalls).toMatchObject([
      { name: DOWNLOAD_METERING_QUEUE_COMPONENT_NAME, args: { batch: { size: 1 } } },
    ]);

    expect(notificationCalls).toMatchObject([
      {
        name: DOWNLOAD_METERING_NOTIFICATION_COMPONENT_NAME,
        args: {
          queues: [
            {
              events: ["s3:ObjectCreated:Put"],
              filterPrefix: "AWSLogs/162067902192/CloudTrail/il-central-1/",
              filterSuffix: ".json.gz",
            },
          ],
        },
        options: { dependsOn: [expect.any(QueuePolicy)] },
      },
    ]);
    expect(trailCalls).toMatchObject([
      {
        name: DOWNLOAD_METERING_TRAIL_COMPONENT_NAME,
        args: {
          name: "utility-services-dev-rus02-download-metering",
          enableLogging: true,
          enableLogFileValidation: true,
          includeGlobalServiceEvents: false,
          isMultiRegionTrail: false,
          isOrganizationTrail: false,
        },
        options: { dependsOn: [expect.any(Bucket)] },
      },
    ]);
    expect(valueOf(trailCalls[0]!.args["advancedEventSelectors"])).toMatchObject([
      {
        fieldSelectors: [
          { field: "eventCategory", equals: ["Data"] },
          { field: "resources.type", equals: ["AWS::S3::Object"] },
          { field: "eventName", equals: ["GetObject"] },
          { field: "readOnly", equals: ["true"] },
          {
            field: "resources.ARN",
            startsWiths: ["arn:aws:s3:::stage-file-bucket/projects/"],
          },
        ],
      },
    ]);
    expect(resources.processor).toBeInstanceOf(Function);
    expect(resources.trail).toBeInstanceOf(Trail);
    expect(queuePolicyCalls).toHaveLength(1);
  });

  it("allows force destroy only for non-production log buckets", async () => {
    let logBucketArgs: Record<string, unknown> | undefined;
    class Dynamo {
      public readonly name = output("usage");
      public readonly arn = output("usage-arn");
    }
    class Bucket {
      public readonly name = output("bucket");
      public readonly arn = output("arn:aws:s3:::bucket");
      public readonly nodes = { bucket: {} };
      public constructor(name: string, args: Record<string, unknown> = {}) {
        if (name === DOWNLOAD_LOG_BUCKET_COMPONENT_NAME) logBucketArgs = args;
      }
      public notify() {
        return {};
      }
    }
    class Queue {
      public readonly arn = output("queue-arn");
      public readonly url = output("queue-url");
      public subscribe() {
        return {};
      }
    }
    class Function {
      public readonly arn = output("processor-arn");
      public readonly name = output("processor");
    }
    vi.stubGlobal("$app", { stage: "dev-rus02" });
    vi.stubGlobal("$interpolate", () => output("arn"));
    vi.stubGlobal("sst", {
      Linkable: { wrap: vi.fn() },
      aws: { Bucket, Dynamo, Queue, Function, permission: vi.fn() },
    });
    vi.stubGlobal("aws", {
      iam: { getPolicyDocumentOutput: () => ({ json: output("policy") }) },
      s3: { BucketNotification: class {} },
      sqs: { QueuePolicy: class {} },
      cloudtrail: { Trail: class {} },
    });
    vi.resetModules();
    const { createDownloadMeteringResources } = await import("./download-metering.js");
    const fileBucket = new Bucket("FileBucket");
    createDownloadMeteringResources({ production: false, fileBucket, usageTable: new Dynamo() });
    const transform = logBucketArgs?.["transform"] as {
      bucket(args: Record<string, unknown>): void;
    };
    const raw: Record<string, unknown> = {};
    transform.bucket(raw);
    expect(raw["forceDestroy"]).toBe(true);
  });
});
