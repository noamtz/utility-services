export const COMMUNICATION_CONNECTION_TABLE_COMPONENT_NAME = "CommunicationConnectionsTable";
export const COMMUNICATION_CONNECTION_TABLE_POLICY = {
  billingMode: "PAY_PER_REQUEST",
  fields: { pk: "string", sk: "string" },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  ttl: "expiresAt",
} as const;

export const COMMUNICATION_CONTROL_ROUTES = [
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
    parameterActions: ["ssm:PutParameter"],
  },
  {
    name: "DisableCommunicationConnectionRoute",
    route: "DELETE /v1/control/projects/{projectId}/communication-connections/{connectionId}",
    handler: "packages/backend/src/functions/control/disable-communication-connection.handler",
    connectionTableActions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
    parameterActions: [],
  },
] as const;
