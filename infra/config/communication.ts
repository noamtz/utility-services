export const COMMUNICATION_CONNECTION_TABLE_COMPONENT_NAME = "CommunicationConnectionsTable";
export const COMMUNICATION_CONNECTION_TABLE_POLICY = {
  billingMode: "PAY_PER_REQUEST",
  fields: {
    pk: "string",
    sk: "string",
    projectId: "string",
    groupProjectId: "string",
    activeConnection: "string",
  },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  globalIndexes: {
    "projectId-index": { hashKey: "projectId", rangeKey: "sk" },
    "groupProjectId-index": { hashKey: "groupProjectId", rangeKey: "sk" },
    "activeConnection-index": { hashKey: "activeConnection", rangeKey: "sk" },
  },
  ttl: "expiresAt",
} as const;

export const COMMUNICATION_GROUP_ROUTES = [
  {
    name: "ListCommunicationGroupsRoute",
    route: "GET /v1/communication/groups",
    handler: "packages/backend/src/functions/communication/list-groups.handler",
    connectionTableActions: ["dynamodb:Query"],
  },
  {
    name: "ListCommunicationGroupEventsRoute",
    route: "GET /v1/communication/groups/{groupId}/events",
    handler: "packages/backend/src/functions/communication/list-group-events.handler",
    connectionTableActions: ["dynamodb:Query"],
  },
] as const;

export const COMMUNICATION_GROUP_REFRESH_SCHEDULE = "rate(15 minutes)";

export const COMMUNICATION_CONTROL_ROUTES = [
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
