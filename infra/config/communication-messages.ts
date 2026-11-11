export const COMMUNICATION_MESSAGE_TABLE_COMPONENT_NAME = "CommunicationMessagesTable";
export const COMMUNICATION_INGRESS_QUEUE_COMPONENT_NAME = "CommunicationIngressQueue";
export const COMMUNICATION_INGRESS_DLQ_COMPONENT_NAME = "CommunicationIngressDeadLetterQueue";
export const COMMUNICATION_MESSAGE_TABLE_POLICY = {
  billingMode: "PAY_PER_REQUEST",
  fields: { pk: "string", sk: "string" },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
} as const;
export const COMMUNICATION_MESSAGE_ROUTES = [
  {
    name: "ReceiveGreenWebhookRoute",
    route: "POST /v1/communication/webhooks/{connectionId}",
    handler: "packages/backend/src/functions/communication/receive-green-webhook.handler",
  },
  {
    name: "ListConversationMessagesRoute",
    route: "GET /v1/communication/conversations/{connectionId}/{conversationId}/messages",
    handler: "packages/backend/src/functions/communication/list-conversation-messages.handler",
  },
] as const;
