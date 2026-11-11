export const COMMUNICATION_CONNECTION_TABLE_COMPONENT_NAME = "CommunicationConnectionsTable";
export const COMMUNICATION_CONNECTION_TABLE_POLICY = {
  billingMode: "PAY_PER_REQUEST",
  fields: { pk: "string", sk: "string", projectId: "string" },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  globalIndexes: { "projectId-index": { hashKey: "projectId", rangeKey: "sk" } },
  ttl: "expiresAt",
} as const;

export const COMMUNICATION_CONTROL_ROUTES = [
  {
    name: "SetupCommunicationWebhookRoute",
    route:
      "POST /v1/control/projects/{projectId}/communication-connections/{connectionId}/webhook-setup",
    handler: "packages/backend/src/functions/control/setup-communication-webhook.handler",
    connectionTableActions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
    parameterActions: [],
  },
  {
    name: "ListCommunicationConnectionsRoute",
    route: "GET /v1/control/projects/{projectId}/communication-connections",
    handler: "packages/backend/src/functions/control/list-communication-connections.handler",
    connectionTableActions: ["dynamodb:Query"],
    parameterActions: [],
  },
  {
    name: "RegisterCommunicationConnectionRoute",
    route: "POST /v1/control/projects/{projectId}/communication-connections",
    handler: "packages/backend/src/functions/control/register-communication-connection.handler",
    connectionTableActions: ["dynamodb:TransactWriteItems"],
    parameterActions: ["ssm:PutParameter", "ssm:DeleteParameter"],
  },
  {
    name: "InspectCommunicationConnectionRoute",
    route: "GET /v1/control/projects/{projectId}/communication-connections/{connectionId}",
    handler: "packages/backend/src/functions/control/inspect-communication-connection.handler",
    connectionTableActions: ["dynamodb:GetItem"],
    parameterActions: [],
  },
  {
    name: "RotateCommunicationConnectionRoute",
    route: "POST /v1/control/projects/{projectId}/communication-connections/{connectionId}/rotate",
    handler: "packages/backend/src/functions/control/rotate-communication-connection.handler",
    connectionTableActions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
    parameterActions: ["ssm:PutParameter", "ssm:DeleteParameter"],
  },
  {
    name: "DisableCommunicationConnectionRoute",
    route: "DELETE /v1/control/projects/{projectId}/communication-connections/{connectionId}",
    handler: "packages/backend/src/functions/control/disable-communication-connection.handler",
    connectionTableActions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
    parameterActions: [],
  },
] as const;
