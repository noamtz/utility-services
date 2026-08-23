import {
  CONTROL_CACHE_POLICY_NAME,
  CONTROL_ORIGIN_ID,
  DASHBOARD_CONTROL_POLICY,
} from "./config/control.js";

export const DASHBOARD_COMPONENT_NAME = "Dashboard";
export const DASHBOARD_CONFIG = {
  path: "apps/dashboard",
  build: {
    command: "npm run build",
    output: "dist",
  },
} as const;

interface DashboardResources {
  apiUrl: SstOutput<string>;
  userPoolId: SstOutput<string>;
  userPoolClientId: SstOutput<string>;
}

export function createDashboard(resources: DashboardResources) {
  const cachePolicy = new aws.cloudfront.CachePolicy(CONTROL_CACHE_POLICY_NAME, {
    minTtl: DASHBOARD_CONTROL_POLICY.minTtl,
    defaultTtl: DASHBOARD_CONTROL_POLICY.defaultTtl,
    maxTtl: DASHBOARD_CONTROL_POLICY.maxTtl,
    parametersInCacheKeyAndForwardedToOrigin: {
      enableAcceptEncodingBrotli: false,
      enableAcceptEncodingGzip: false,
      cookiesConfig: { cookieBehavior: DASHBOARD_CONTROL_POLICY.cookieBehavior },
      headersConfig: {
        headerBehavior: "whitelist",
        headers: { items: [...DASHBOARD_CONTROL_POLICY.headers] },
      },
      queryStringsConfig: {
        queryStringBehavior: "whitelist",
        queryStrings: { items: [...DASHBOARD_CONTROL_POLICY.queryStrings] },
      },
    },
  });
  return new sst.aws.StaticSite(DASHBOARD_COMPONENT_NAME, {
    ...DASHBOARD_CONFIG,
    environment: {
      VITE_COGNITO_USER_POOL_ID: resources.userPoolId,
      VITE_COGNITO_USER_POOL_CLIENT_ID: resources.userPoolClientId,
    },
    transform: {
      cdn(args) {
        args.origins = [
          ...args.origins,
          {
            originId: CONTROL_ORIGIN_ID,
            domainName: resources.apiUrl.apply((url) => new URL(url).hostname),
            customOriginConfig: {
              httpPort: 80,
              httpsPort: 443,
              originProtocolPolicy: DASHBOARD_CONTROL_POLICY.originProtocolPolicy,
              originSslProtocols: [...DASHBOARD_CONTROL_POLICY.originSslProtocols],
            },
          },
        ];
        args.orderedCacheBehaviors = [
          ...(args.orderedCacheBehaviors ?? []),
          {
            pathPattern: DASHBOARD_CONTROL_POLICY.pathPattern,
            targetOriginId: CONTROL_ORIGIN_ID,
            viewerProtocolPolicy: DASHBOARD_CONTROL_POLICY.viewerProtocolPolicy,
            allowedMethods: [...DASHBOARD_CONTROL_POLICY.allowedMethods],
            cachedMethods: [...DASHBOARD_CONTROL_POLICY.cachedMethods],
            compress: true,
            cachePolicyId: cachePolicy.id,
          },
        ];
      },
    },
  });
}
