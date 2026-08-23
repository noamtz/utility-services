import { afterEach, describe, expect, it, vi } from "vitest";

import { API_COMPONENT_NAME, API_CORS, HEALTH_ROUTE } from "./api.js";
import {
  CONTROL_CACHE_POLICY_NAME,
  CONTROL_ORIGIN_REQUEST_POLICY_NAME,
  CONTROL_ROUTES,
  DASHBOARD_CONTROL_POLICY,
} from "./config/control.js";
import { DASHBOARD_COMPONENT_NAME, DASHBOARD_CONFIG, createDashboard } from "./dashboard.js";
import { DYNAMO_LINK_BASELINE_ACTIONS } from "./dynamo-link.js";
import { USAGE_PRICING_TABLE_POLICY } from "./config/usage-pricing.js";
import { FILE_BUCKET_POLICY, FILE_ROUTES, FILE_TABLE_POLICY } from "./config/file-management.js";

function output<T>(value: T): SstOutput<T> {
  return {
    apply(callback) {
      return output(callback(value));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("SST composition contracts", () => {
  it("keeps health public and defines seven separate control routes", () => {
    expect(API_COMPONENT_NAME).toBe("ServiceApi");
    expect(API_CORS).toBe(false);
    expect(HEALTH_ROUTE).toEqual({
      name: "HealthRoute",
      route: "GET /v1/health",
      handler: "packages/backend/src/functions/health.handler",
      runtime: "nodejs24.x",
      tracingMode: "Active",
    });
    expect(JSON.stringify(HEALTH_ROUTE)).not.toContain("*");
    expect(CONTROL_ROUTES).toHaveLength(7);
  });

  it("keeps usage pricing independent with the same query-only link baseline", () => {
    expect(USAGE_PRICING_TABLE_POLICY.primaryIndex).toEqual({ hashKey: "pk", rangeKey: "sk" });
    expect(USAGE_PRICING_TABLE_POLICY.globalIndexes).toEqual({});
    expect(DYNAMO_LINK_BASELINE_ACTIONS).toEqual(["dynamodb:Query"]);
    expect(JSON.stringify(DYNAMO_LINK_BASELINE_ACTIONS)).not.toMatch(/Put|Update|Get|Scan|\*/u);
    expect(CONTROL_ROUTES).toHaveLength(7);
  });

  it("keeps file utility routes separate and storage private", () => {
    expect(FILE_ROUTES).toHaveLength(7);
    expect(FILE_ROUTES.map((route) => route.route)).toEqual([
      "POST /v1/files/uploads",
      "GET /v1/files",
      "GET /v1/files/{fileId}",
      "POST /v1/files/{fileId}/downloads",
      "DELETE /v1/files/{fileId}",
      "POST /v1/files/{fileId}/restore",
      "GET /files/public/{publicProjectId}/{publicFileId}",
    ]);
    expect(FILE_ROUTES.slice(3).map((route) => route.bucketActions)).toEqual([
      ["s3:GetObject"],
      ["s3:DeleteObject"],
      [],
      ["s3:GetObject"],
    ]);
    expect(FILE_ROUTES[6]?.controlTableActions).toEqual([]);
    expect(FILE_ROUTES[6]?.fileTableActions).toEqual(["dynamodb:GetItem"]);
    expect(FILE_ROUTES[4]?.usageTableActions.length).toBeGreaterThan(0);
    expect(FILE_ROUTES[5]?.usageTableActions).toEqual([]);
    expect(FILE_TABLE_POLICY.globalIndexes).toHaveProperty("PublicFiles");
    expect(FILE_TABLE_POLICY.globalIndexes).toHaveProperty("FileLifecycle");
    expect(FILE_BUCKET_POLICY.cors).toBe(false);
    expect(JSON.stringify({ routes: FILE_ROUTES, bucket: FILE_BUCKET_POLICY })).not.toMatch(
      /s3:\*|dynamodb:\*|allowOrigins/u,
    );
  });

  it("builds the dashboard from the real Vite workspace", () => {
    expect(DASHBOARD_COMPONENT_NAME).toBe("Dashboard");
    expect(DASHBOARD_CONFIG).toEqual({
      path: "apps/dashboard",
      build: { command: "npm run build", output: "dist" },
    });
    expect(DASHBOARD_CONTROL_POLICY.pathPattern).toBe("v1/control/*");
    expect(DASHBOARD_CONTROL_POLICY.minTtl).toBe(0);
    expect(DASHBOARD_CONTROL_POLICY.defaultTtl).toBe(0);
    expect(DASHBOARD_CONTROL_POLICY.maxTtl).toBe(0);
    expect(DASHBOARD_CONTROL_POLICY.headers).toEqual(["Authorization", "Content-Type"]);
    expect(DASHBOARD_CONTROL_POLICY.queryStrings).toEqual(["limit", "cursor"]);
    expect(DASHBOARD_CONTROL_POLICY.cookieBehavior).toBe("none");
  });

  it("creates the dashboard cache policy through SST's AWS provider global", () => {
    let cachePolicyName: string | undefined;
    let cachePolicyArgs: unknown;
    let originRequestPolicyName: string | undefined;
    let originRequestPolicyArgs: unknown;
    let siteArgs: unknown;
    class CachePolicy {
      public readonly id = output("cache-policy-id");

      public constructor(name: string, args: unknown) {
        cachePolicyName = name;
        cachePolicyArgs = args;
      }
    }
    class OriginRequestPolicy {
      public readonly id = output("origin-request-policy-id");

      public constructor(name: string, args: unknown) {
        originRequestPolicyName = name;
        originRequestPolicyArgs = args;
      }
    }
    class StaticSite {
      public readonly url = output("https://dashboard.example.com");

      public constructor(_name: string, args: unknown) {
        siteArgs = args;
      }
    }
    vi.stubGlobal("aws", { cloudfront: { CachePolicy, OriginRequestPolicy } });
    vi.stubGlobal("sst", { aws: { StaticSite } });

    createDashboard({
      apiUrl: output("https://api.example.com"),
      userPoolId: output("il-central-1_pool"),
      userPoolClientId: output("0123456789abcdefghijklmnop"),
    });

    expect(cachePolicyName).toBe(CONTROL_CACHE_POLICY_NAME);
    expect(cachePolicyArgs).toMatchObject({
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 0,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: { cookieBehavior: "none" },
        headersConfig: { headerBehavior: "none" },
        queryStringsConfig: { queryStringBehavior: "none" },
      },
    });
    expect(originRequestPolicyName).toBe(CONTROL_ORIGIN_REQUEST_POLICY_NAME);
    expect(originRequestPolicyArgs).toEqual({
      cookiesConfig: { cookieBehavior: "none" },
      headersConfig: {
        headerBehavior: "whitelist",
        headers: { items: ["Authorization", "Content-Type"] },
      },
      queryStringsConfig: {
        queryStringBehavior: "whitelist",
        queryStrings: { items: ["limit", "cursor"] },
      },
    });
    const transform = (
      siteArgs as {
        transform: {
          cdn(args: { origins: unknown[]; orderedCacheBehaviors?: unknown[] }): void;
        };
      }
    ).transform;
    const cdnArgs: { origins: unknown[]; orderedCacheBehaviors?: unknown[] } = {
      origins: [],
      orderedCacheBehaviors: [],
    };
    transform.cdn(cdnArgs);
    expect(cdnArgs.origins).toHaveLength(1);
    const behaviors = cdnArgs.orderedCacheBehaviors as
      | Array<{ pathPattern: string; cachePolicyId: unknown; originRequestPolicyId: unknown }>
      | undefined;
    expect(behaviors).toHaveLength(1);
    expect(behaviors?.[0]?.pathPattern).toBe("v1/control/*");
    expect(behaviors?.[0]?.cachePolicyId).toBeDefined();
    expect(behaviors?.[0]?.originRequestPolicyId).toBeDefined();
  });
});
