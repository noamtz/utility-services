import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FILE_BUCKET_COMPONENT_NAME,
  FILE_COMPLETION_COMPONENT_NAME,
  FILE_LIFECYCLE_INDEX_NAME,
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
      public constructor(name: string, args: Record<string, unknown>) {
        cronCalls.push({ name, args });
      }
    }
    vi.stubGlobal("$interpolate", () => output("interpolated-object-arn"));
    vi.stubGlobal("sst", {
      Linkable: { wrap },
      aws: { Dynamo, Bucket, Cron, permission: vi.fn((args: unknown) => args) },
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
    expect(bucketCalls[0]?.args).toMatchObject({ cors: false, enforceHttps: false });
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

    const notification = notificationCalls[0] as {
      notifications: Array<Record<string, unknown>>;
    };
    expect(notification.notifications).toHaveLength(1);
    expect(notification.notifications[0]).toMatchObject({
      name: FILE_COMPLETION_COMPONENT_NAME,
      events: ["s3:ObjectCreated:Put"],
      filterPrefix: "projects/",
    });
    expect(cronCalls).toHaveLength(1);
    expect(cronCalls[0]).toMatchObject({
      name: FILE_RECONCILIATION_COMPONENT_NAME,
      args: { schedule: "rate(5 minutes)" },
    });
    expect(JSON.stringify({ notification, cronCalls })).not.toMatch(/s3:\*|dynamodb:\*/u);
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
    vi.stubGlobal("$interpolate", () => output("arn"));
    vi.stubGlobal("sst", {
      Linkable: { wrap: vi.fn() },
      aws: { Dynamo, Bucket, Cron: class {}, permission: vi.fn() },
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
