import { afterEach, describe, expect, it, vi } from "vitest";

import { PRICE_VERSIONS, USAGE_PRICING_TABLE_COMPONENT_NAME } from "./config/usage-pricing.js";
import { createUsagePricingResources, priceSeedResourceName } from "./usage-pricing.js";

function output<T>(value: T): SstOutput<T> {
  return {
    apply(callback) {
      return output(callback(value));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("usage pricing resources", () => {
  it("creates one protected-capable TTL table and retained immutable price seeds", () => {
    const dynamoCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const itemCalls: Array<{
      name: string;
      args: Record<string, unknown>;
      options: Record<string, unknown> | undefined;
    }> = [];
    const wrap = vi.fn();
    const cronCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    class Dynamo {
      public readonly name = output("usage-table");
      public readonly arn = output("usage-table-arn");
      public constructor(name: string, args: Record<string, unknown>) {
        dynamoCalls.push({ name, args });
      }
    }
    class TableItem {
      public constructor(
        name: string,
        args: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) {
        itemCalls.push({ name, args, options });
      }
    }
    class Cron {
      public constructor(name: string, args: Record<string, unknown>) {
        cronCalls.push({ name, args });
      }
    }
    vi.stubGlobal("$interpolate", () => output("interpolated-arn"));
    vi.stubGlobal("sst", {
      Linkable: { wrap },
      aws: { Dynamo, Cron, permission: vi.fn((args: unknown) => args) },
    });
    vi.stubGlobal("aws", { dynamodb: { TableItem } });

    const resources = createUsagePricingResources({ production: true });

    expect(dynamoCalls).toEqual([
      {
        name: USAGE_PRICING_TABLE_COMPONENT_NAME,
        args: {
          fields: { pk: "string", sk: "string", gsi1pk: "string", gsi1sk: "string" },
          primaryIndex: { hashKey: "pk", rangeKey: "sk" },
          globalIndexes: {
            UsageWatermarkFreshness: {
              hashKey: "gsi1pk",
              rangeKey: "gsi1sk",
              projection: "all",
            },
          },
          ttl: "expiresAt",
          deletionProtection: true,
        },
      },
    ]);
    expect(resources.priceItems).toHaveLength(PRICE_VERSIONS.length);
    expect(itemCalls).toHaveLength(PRICE_VERSIONS.length);
    expect(itemCalls[0]?.name).toBe(priceSeedResourceName(PRICE_VERSIONS[0]!));
    expect(itemCalls[0]?.args).toMatchObject({ hashKey: "pk", rangeKey: "sk" });
    expect(itemCalls[0]?.args["tableName"]).toBe(resources.table.name);
    expect(itemCalls[0]?.options).toEqual({ retainOnDelete: true, ignoreChanges: ["item"] });
    expect(JSON.parse(String(itemCalls[0]?.args["item"]))).toMatchObject({
      pk: { S: "PRICING" },
      itemType: { S: "price-version" },
    });
    expect(JSON.stringify(dynamoCalls)).not.toMatch(/Scan|\*/u);
    expect(cronCalls).toMatchObject([
      {
        name: "UsageFreshnessMonitor",
        args: {
          schedule: "rate(5 minutes)",
          function: {
            handler:
              "packages/backend/src/functions/usage-pricing/check-metering-freshness.handler",
            permissions: [{ actions: ["dynamodb:Query"] }],
          },
        },
      },
    ]);
    expect(resources.table).toBeInstanceOf(Dynamo);
  });

  it("does not enable non-production deletion protection", () => {
    let args: Record<string, unknown> | undefined;
    class Dynamo {
      public readonly name = output("usage-table");
      public readonly arn = output("usage-table-arn");
      public constructor(_name: string, value: Record<string, unknown>) {
        args = value;
      }
    }
    vi.stubGlobal("sst", {
      Linkable: { wrap: vi.fn() },
      aws: { Dynamo, Cron: class {}, permission: vi.fn() },
    });
    vi.stubGlobal("$interpolate", () => output("index-arn"));
    vi.stubGlobal("aws", { dynamodb: { TableItem: class {} } });
    createUsagePricingResources({ production: false });
    expect(args?.["deletionProtection"]).toBe(false);
  });
});
