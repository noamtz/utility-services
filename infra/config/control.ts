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
  ttl: "expiresAt",
} as const;

export const CONTROL_TABLE_LINK_ACTIONS = ["dynamodb:Query"] as const;

export const CONTROL_ROUTES = [
  {
    name: "CreateProjectRoute",
    route: "POST /v1/control/projects",
    handler: "packages/backend/src/functions/control/create-project.handler",
    additionalTableActions: ["dynamodb:PutItem"],
  },
  {
    name: "ListProjectsRoute",
    route: "GET /v1/control/projects",
    handler: "packages/backend/src/functions/control/list-projects.handler",
    additionalTableActions: [],
  },
  {
    name: "InspectProjectRoute",
    route: "GET /v1/control/projects/{projectId}",
    handler: "packages/backend/src/functions/control/inspect-project.handler",
    additionalTableActions: [],
  },
  {
    name: "IssueProjectApiKeyRoute",
    route: "POST /v1/control/projects/{projectId}/api-keys",
    handler: "packages/backend/src/functions/control/issue-project-api-key.handler",
    additionalTableActions: ["dynamodb:ConditionCheckItem", "dynamodb:GetItem", "dynamodb:PutItem"],
  },
  {
    name: "ListProjectApiKeysRoute",
    route: "GET /v1/control/projects/{projectId}/api-keys",
    handler: "packages/backend/src/functions/control/list-project-api-keys.handler",
    additionalTableActions: ["dynamodb:GetItem"],
  },
  {
    name: "RevokeProjectApiKeyRoute",
    route: "DELETE /v1/control/projects/{projectId}/api-keys/{keyId}",
    handler: "packages/backend/src/functions/control/revoke-project-api-key.handler",
    additionalTableActions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
  },
  {
    name: "ReplaceProjectApiKeyRoute",
    route: "POST /v1/control/projects/{projectId}/api-keys/{keyId}/replace",
    handler: "packages/backend/src/functions/control/replace-project-api-key.handler",
    additionalTableActions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
  },
] as const;

export const DASHBOARD_CONTROL_POLICY = {
  pathPattern: "v1/control/*",
  // CloudFront requires its full seven-method set whenever POST is forwarded.
  // API Gateway still authorizes only the explicit CONTROL_ROUTES above.
  allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
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
