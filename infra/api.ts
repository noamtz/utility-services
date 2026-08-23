import { AWS_REGION } from "./config/app.js";
import { CONTROL_AUTHORIZER_NAME, CONTROL_ROUTES } from "./config/control.js";
import { FILE_OBJECT_PREFIX, FILE_ROUTES } from "./config/file-management.js";

export const API_COMPONENT_NAME = "ServiceApi";
export const API_CORS = false;
export const HEALTH_ROUTE = {
  name: "HealthRoute",
  route: "GET /v1/health",
  handler: "packages/backend/src/functions/health.handler",
  runtime: "nodejs24.x",
  tracingMode: "Active",
} as const;

interface ControlResources {
  userPool: sst.aws.CognitoUserPool;
  userPoolClient: sst.aws.CognitoUserPoolClient;
  table: sst.aws.Dynamo;
}

interface UsageResources {
  table: sst.aws.Dynamo;
}

interface FileResources {
  table: sst.aws.Dynamo;
  bucket: sst.aws.Bucket;
}

export function createApi(
  control: ControlResources,
  usagePricing?: UsageResources,
  files?: FileResources,
) {
  const api = new sst.aws.ApiGatewayV2(API_COMPONENT_NAME, { cors: API_CORS });
  api.route(
    HEALTH_ROUTE.route,
    {
      handler: HEALTH_ROUTE.handler,
      runtime: HEALTH_ROUTE.runtime,
      transform: {
        function: {
          tracingConfig: { mode: HEALTH_ROUTE.tracingMode },
        },
      },
    },
    { name: HEALTH_ROUTE.name },
  );
  const authorizer = api.addAuthorizer({
    name: CONTROL_AUTHORIZER_NAME,
    jwt: {
      issuer: control.userPool.id.apply(
        (poolId) => `https://cognito-idp.${AWS_REGION}.amazonaws.com/${poolId}`,
      ),
      audiences: [control.userPoolClient.id],
    },
  });
  for (const route of CONTROL_ROUTES) {
    api.route(
      route.route,
      {
        handler: route.handler,
        runtime: "nodejs24.x",
        link: [control.table],
        ...(route.additionalTableActions.length > 0
          ? {
              permissions: [
                {
                  actions: [...route.additionalTableActions],
                  resources: [control.table.arn],
                },
              ],
            }
          : {}),
        transform: { function: { tracingConfig: { mode: "Active" } } },
      },
      { name: route.name, auth: { jwt: { authorizer: authorizer.id } } },
    );
  }
  if (usagePricing && files) {
    const fileObjectArn = $interpolate`${files.bucket.arn}/${FILE_OBJECT_PREFIX}*`;
    for (const route of FILE_ROUTES) {
      const permissions = [
        ...(route.controlTableActions.length > 0
          ? [{ actions: [...route.controlTableActions], resources: [control.table.arn] }]
          : []),
        ...(route.fileTableActions.length > 0
          ? [{ actions: [...route.fileTableActions], resources: [files.table.arn] }]
          : []),
        ...(route.bucketActions.length > 0
          ? [{ actions: [...route.bucketActions], resources: [fileObjectArn] }]
          : []),
      ];
      api.route(
        route.route,
        {
          handler: route.handler,
          runtime: "nodejs24.x",
          link: [control.table, files.table, files.bucket],
          ...(permissions.length > 0 ? { permissions } : {}),
          transform: { function: { tracingConfig: { mode: "Active" } } },
        },
        { name: route.name },
      );
    }
  }
  return api;
}
