import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FILE_BUCKET_COMPONENT_NAME,
  FILE_COMPLETION_COMPONENT_NAME,
  FILE_LIFECYCLE_INDEX_NAME,
  FILE_OPERATIONS_DLQ_COMPONENT_NAME,
  FILE_PURGE_COMPONENT_NAME,
  FILE_RECONCILIATION_COMPONENT_NAME,
  FILE_TABLE_COMPONENT_NAME,
  PUBLIC_FILE_INDEX_NAME,
} from "./config/file-management.js";

function output<T>(value: T): SstOutput<T> {
  return { apply: (callback) => output(callback(value)) };
}

afterEach(() => vi.unstubAllGlobals());

describe("file management resources", () => {
  it("creates the private file plane with exact notification and reconciliation workers", async () => {
    const dynamoCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const bucketCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const notificationCalls: unknown[] = [];
    const cronCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const queueCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const encryptionCalls: Array<{ name: string; args: unknown }> = [];
    const queuePolicyCalls: Array<{ name: string; args: unknown }> = [];
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const wrap = vi.fn();
    class Dynamo {
      public readonly name = output("file-table");
      public readonly arn = output("file-table-arn");
      public constructor(name: string, args: Record<string, unknown>) {
        dynamoCalls.push({ name, args });
      }
    }
    class Bucket {
      public readonly name = output("private-file-bucket");
      public readonly arn = output("private-file-bucket-arn");
      public constructor(name: string, args: Record<string, unknown>) {
        bucketCalls.push({ name, args });
      }
      public notify(args: unknown) {
        notificationCalls.push(args);
        return { kind: "notification" };
      }
    }
    class Cron {
      public readonly nodes: { rule: { arn: SstOutput<string> } };
      public constructor(name: string, args: Record<string, unknown>) {
        cronCalls.push({ name, args });
        this.nodes = { rule: { arn: output(`${name}-rule-arn`) } };
      }
    }
    class Queue {
      public readonly arn: SstOutput<string>;
      public readonly url: SstOutput<string>;
      public constructor(name: string, args: Record<string, unknown>) {
        queueCalls.push({ name, args });
        this.arn = output(`${name}-arn`);
        this.url = output(`${name}-url`);
      }
    }
    class BucketServerSideEncryptionConfiguration {
      public constructor(name: string, args: unknown) {
        encryptionCalls.push({ name, args });
      }
    }
    class QueuePolicy {
      public constructor(name: string, args: unknown) {
        queuePolicyCalls.push({ name, args });
      }
    }
    class Function {
      public readonly arn = output("completion-worker-arn");
      public readonly name = output("completion-worker");
      public constructor(name: string, args: Record<string, unknown>) {
        functionCalls.push({ name, args });
      }
    }
    vi.stubGlobal("$interpolate", () => output("interpolated-object-arn"));
    vi.stubGlobal("sst", {
      Linkable: { wrap },
      aws: { Dynamo, Bucket, Cron, Queue, Function, permission: vi.fn((args: unknown) => args) },
    });
    vi.stubGlobal("aws", {
      iam: { getPolicyDocumentOutput: vi.fn((args: unknown) => ({ json: output(args) })) },
      s3: { BucketServerSideEncryptionConfiguration },
      sqs: { QueuePolicy },
    });
    vi.resetModules();
    const { createFileManagementResources } = await import("./file-management.js");
    const controlTable = new Dynamo("control", {});
    const usageTable = new Dynamo("usage", {});

    const resources = createFileManagementResources({
      production: true,
      controlTable,
      usageTable,
    });

    const fileTable = dynamoCalls.find((call) => call.name === FILE_TABLE_COMPONENT_NAME);
    expect(fileTable?.args["deletionProtection"]).toBe(true);
    const globalIndexes = fileTable?.args["globalIndexes"] as Record<string, unknown>;
    expect(Object.keys(globalIndexes)).toEqual([PUBLIC_FILE_INDEX_NAME, FILE_LIFECYCLE_INDEX_NAME]);
    expect(bucketCalls[0]?.name).toBe(FILE_BUCKET_COMPONENT_NAME);
    expect(bucketCalls[0]?.args).toMatchObject({ cors: false, enforceHttps: true });
    const bucketTransform = bucketCalls[0]?.args["transform"] as {
      bucket(args: Record<string, unknown>): void;
      publicAccessBlock(args: Record<string, unknown>): void;
    };
    const rawBucket: Record<string, unknown> = { forceDestroy: true };
    const publicAccess: Record<string, unknown> = {};
    bucketTransform.bucket(rawBucket);
    bucketTransform.publicAccessBlock(publicAccess);
    expect(rawBucket).toEqual({ forceDestroy: false });
    expect(Object.values(publicAccess).every(Boolean)).toBe(true);
    expect(encryptionCalls[0]?.args).toMatchObject({
      rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
    });
    expect(queueCalls[0]?.name).toBe(FILE_OPERATIONS_DLQ_COMPONENT_NAME);
    const dlqRaw: Record<string, unknown> = {};
    (queueCalls[0]!.args["transform"] as { queue(args: Record<string, unknown>): void }).queue(
      dlqRaw,
    );
    expect(dlqRaw).toEqual({ messageRetentionSeconds: 1_209_600, sqsManagedSseEnabled: true });

    const notification = notificationCalls[0] as {
      notifications: Array<Record<string, unknown>>;
    };
    expect(notification.notifications).toHaveLength(1);
    expect(notification.notifications[0]).toMatchObject({
      name: FILE_COMPLETION_COMPONENT_NAME,
      events: ["s3:ObjectCreated:Put"],
      filterPrefix: "projects/",
    });
    const completionFunction = functionCalls[0]?.args as {
      retries: number;
      permissions: Array<{ actions: string[] }>;
      transform: { eventInvokeConfig(args: Record<string, unknown>): void };
    };
    expect(completionFunction.retries).toBe(2);
    expect(completionFunction.permissions.flatMap((permission) => permission.actions)).toContain(
      "sqs:SendMessage",
    );
    const eventInvokeConfig: Record<string, unknown> = {};
    completionFunction.transform.eventInvokeConfig(eventInvokeConfig);
    expect(eventInvokeConfig).toMatchObject({ destinationConfig: { onFailure: {} } });
    expect(cronCalls).toHaveLength(2);
    expect(cronCalls[0]).toMatchObject({
      name: FILE_RECONCILIATION_COMPONENT_NAME,
      args: { schedule: "rate(5 minutes)" },
    });
    expect(cronCalls[1]).toMatchObject({
      name: FILE_PURGE_COMPONENT_NAME,
      args: {
        schedule: "rate(5 minutes)",
      },
    });
    for (const cron of cronCalls) {
      const targetArgs: Record<string, unknown> = {};
      (cron.args["transform"] as { target(args: Record<string, unknown>): void }).target(
        targetArgs,
      );
      expect(targetArgs).toMatchObject({
        deadLetterConfig: {},
        retryPolicy: { maximumEventAgeInSeconds: 3_600, maximumRetryAttempts: 2 },
      });
    }
    const purgeFunction = cronCalls[1]?.args["function"] as {
      handler: string;
      permissions: Array<{ actions: string[] }>;
    };
    expect(purgeFunction.handler).toBe(
      "packages/backend/src/functions/files/purge-trashed-files.handler",
    );
    const purgePermissions = purgeFunction.permissions;
    expect(purgePermissions.flatMap((permission) => permission.actions)).toEqual(
      expect.arrayContaining([
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:TransactWriteItems",
        "s3:DeleteObject",
      ]),
    );
    expect(JSON.stringify({ notification, cronCalls })).not.toMatch(/s3:\*|dynamodb:\*/u);
    expect(JSON.stringify({ notification, cronCalls })).not.toContain("s3:ListBucket");
    expect(queuePolicyCalls).toHaveLength(1);
    expect(resources.table).toBeInstanceOf(Dynamo);
    expect(resources.bucket).toBeInstanceOf(Bucket);
  });

  it("allows force-destroy only for removable non-production stages", async () => {
    let bucketArgs: Record<string, unknown> | undefined;
    class Dynamo {
      public readonly name = output("table");
      public readonly arn = output("table-arn");
    }
    class Bucket {
      public readonly name = output("bucket");
      public readonly arn = output("bucket-arn");
      public constructor(_name: string, args: Record<string, unknown>) {
        bucketArgs = args;
      }
      public notify() {
        return {};
      }
    }
    class Queue {
      public readonly arn = output("queue-arn");
      public readonly url = output("queue-url");
    }
    class Function {
      public readonly arn = output("function-arn");
      public readonly name = output("function-name");
    }
    class Cron {
      public readonly nodes = { rule: { arn: output("rule-arn") } };
    }
    vi.stubGlobal("$interpolate", () => output("arn"));
    vi.stubGlobal("sst", {
      Linkable: { wrap: vi.fn() },
      aws: { Dynamo, Bucket, Cron, Queue, Function, permission: vi.fn() },
    });
    vi.stubGlobal("aws", {
      iam: { getPolicyDocumentOutput: () => ({ json: output("policy") }) },
      s3: { BucketServerSideEncryptionConfiguration: class {} },
      sqs: { QueuePolicy: class {} },
    });
    vi.resetModules();
    const { createFileManagementResources } = await import("./file-management.js");
    const table = new Dynamo();
    createFileManagementResources({ production: false, controlTable: table, usageTable: table });
    const transform = bucketArgs?.["transform"] as {
      bucket(args: Record<string, unknown>): void;
    };
    const raw: Record<string, unknown> = {};
    transform.bucket(raw);
    expect(raw["forceDestroy"]).toBe(true);
  });
});
