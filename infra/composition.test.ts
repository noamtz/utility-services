import { afterEach, describe, expect, it, vi } from "vitest";

import { API_COMPONENT_NAME, API_CORS, HEALTH_ROUTE } from "./api.js";
import {
  CONTROL_CACHE_POLICY_NAME,
  CONTROL_ORIGIN_REQUEST_POLICY_NAME,
  CONTROL_ROUTES,
  DASHBOARD_CONTROL_POLICY,
} from "./config/control.js";
import { DASHBOARD_COMPONENT_NAME, DASHBOARD_CONFIG, createDashboard } from "./dashboard.js";

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
