export const API_COMPONENT_NAME = "ServiceApi";
export const API_CORS = false;
export const HEALTH_ROUTE = {
  name: "HealthRoute",
  route: "GET /v1/health",
  handler: "packages/backend/src/functions/health.handler",
  runtime: "nodejs24.x",
  tracingMode: "Active",
} as const;

export function createApi() {
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
  return api;
}
