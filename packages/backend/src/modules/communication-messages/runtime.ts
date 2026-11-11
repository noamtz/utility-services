import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { z } from "zod";
import { IncomingTextMessageSchema } from "@utility-services/contracts";
import { createDynamoConnectionRepository } from "../communication-connections/repository.js";
import { createProjectAuthenticationRuntime } from "../project-authentication/runtime.js";
import { createDynamoMessageRepository } from "./repository.js";
import { createCommunicationMessageService } from "./service.js";
import {
  createListConversationMessagesHandler,
  createReceiveGreenWebhookHandler,
} from "./handlers.js";

const resources = Resource as unknown as {
  CommunicationConnectionsTable: { name: unknown };
  CommunicationMessagesTable: { name: unknown };
  ControlTable: { name: unknown };
  CommunicationIngressQueue: { url: unknown };
};
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const queue: import("./service.js").MessageQueue = {
  async send(message) {
    await new SQSClient({}).send(
      new SendMessageCommand({
        QueueUrl: z.string().parse(resources.CommunicationIngressQueue.url),
        MessageBody: JSON.stringify(message),
      }),
    );
  },
};
const service = createCommunicationMessageService({
  connections: createDynamoConnectionRepository({
    client,
    tableName: z.string().parse(resources.CommunicationConnectionsTable.name),
  }),
  messages: createDynamoMessageRepository({
    client,
    tableName: z.string().parse(resources.CommunicationMessagesTable.name),
  }),
  queue,
});
export const receiveGreenWebhookHandler = createReceiveGreenWebhookHandler(service);
export const listConversationMessagesHandler = createListConversationMessagesHandler(
  service,
  createProjectAuthenticationRuntime({ tableName: z.string().parse(resources.ControlTable.name) }),
);
export async function processIncomingTextHandler(event: { Records?: Array<{ body: string }> }) {
  for (const record of event.Records ?? [])
    await service.process(IncomingTextMessageSchema.parse(JSON.parse(record.body) as unknown));
  return {};
}
