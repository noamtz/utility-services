export const USER_POOL_COMPONENT_NAME = "OwnerUserPool";
export const USER_POOL_CLIENT_NAME = "DashboardClient";
export const CONTROL_TABLE_COMPONENT_NAME = "ControlTable";
export const OWNER_INDEX_NAME = "OwnerProjects";
export const CONTROL_AUTHORIZER_NAME = "OwnerJwtAuthorizer";
export const CONTROL_ORIGIN_ID = "control-api";
export const CONTROL_CACHE_POLICY_NAME = "DashboardControlCachePolicy";
export const CONTROL_ORIGIN_REQUEST_POLICY_NAME = "DashboardControlOriginRequestPolicy";

export const USER_POOL_POLICY = {
  usernames: ["email"],
  allowAdminCreateUserOnly: true,
} as const;

export const USER_POOL_CLIENT_POLICY = {
  generateSecret: false,
  oauthEnabled: false,
  explicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
  preventUserExistenceErrors: "ENABLED",
} as const;

export const CONTROL_TABLE_POLICY = {
  billingMode: "PAY_PER_REQUEST",
  fields: { pk: "string", sk: "string", gsi1pk: "string", gsi1sk: "string" },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  globalIndexes: {
    [OWNER_INDEX_NAME]: { hashKey: "gsi1pk", rangeKey: "gsi1sk", projection: "all" },
  },
} as const;

export const CONTROL_TABLE_ACTIONS = ["dynamodb:Query", "dynamodb:TransactWriteItems"] as const;

export const CONTROL_ROUTES = [
  {
    name: "CreateProjectRoute",
    route: "POST /v1/control/projects",
    handler: "packages/backend/src/functions/control/create-project.handler",
  },
  {
    name: "ListProjectsRoute",
    route: "GET /v1/control/projects",
    handler: "packages/backend/src/functions/control/list-projects.handler",
  },
  {
    name: "InspectProjectRoute",
    route: "GET /v1/control/projects/{projectId}",
    handler: "packages/backend/src/functions/control/inspect-project.handler",
  },
] as const;

export const DASHBOARD_CONTROL_POLICY = {
  pathPattern: "v1/control/*",
  allowedMethods: ["GET", "HEAD", "OPTIONS", "POST"],
  cachedMethods: ["GET", "HEAD"],
  viewerProtocolPolicy: "redirect-to-https",
  originProtocolPolicy: "https-only",
  originSslProtocols: ["TLSv1.2"],
  minTtl: 0,
  defaultTtl: 0,
  maxTtl: 0,
  headers: ["Authorization", "Content-Type"],
  queryStrings: ["limit", "cursor"],
  cookieBehavior: "none",
} as const;

export function controlTableDeletionProtection(production: boolean): boolean {
  return production;
}
