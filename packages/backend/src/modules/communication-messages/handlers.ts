import { z } from "zod";
import {
  ConversationHistorySchema,
  ConversationPathSchema,
  ConversationQuerySchema,
  IncomingTextMessageSchema,
} from "@utility-services/contracts";
import { createHttpHandler, HttpError } from "../../core/http/handler.js";
import { createProjectAuthorization } from "../project-authentication/authorization.js";
import type { ProjectAuthenticationService } from "../project-authentication/service.js";
import type { createCommunicationMessageService } from "./service.js";

type Service = ReturnType<typeof createCommunicationMessageService>;
const webhookBody = z
  .object({
    typeWebhook: z.literal("incomingMessageReceived"),
    instanceData: z.object({ idInstance: z.string() }).passthrough(),
    idMessage: z.string(),
    timestamp: z.number().int().positive(),
    senderData: z.object({ chatId: z.string(), sender: z.string().optional() }).passthrough(),
    messageData: z
      .object({
        typeMessage: z.literal("textMessage"),
        textMessageData: z.object({ textMessage: z.string() }),
      })
      .passthrough(),
  })
  .passthrough();
const headers = z
  .object({ authorization: z.string().optional(), Authorization: z.string().optional() })
  .passthrough();
function bearer(headersValue: z.infer<typeof headers>) {
  const value = headersValue.authorization ?? headersValue.Authorization;
  return value?.match(/^Bearer (.+)$/u)?.[1];
}
export function createReceiveGreenWebhookHandler(service: Service) {
  return createHttpHandler({
    schemas: {
      path: z.object({ connectionId: z.string() }).strict(),
      headers,
      body: webhookBody,
      response: z.object({ accepted: z.literal(true) }).strict(),
    },
    callback: async ({ path, headers: requestHeaders, body, requestId }) => {
      if (!body.senderData.chatId.endsWith("@g.us"))
        throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed");
      const timestamp = new Date(body.timestamp * 1000).toISOString();
      const message = IncomingTextMessageSchema.parse({
        connectionId: path.connectionId,
        instanceId: body.instanceData.idInstance,
        providerMessageId: body.idMessage,
        conversationId: body.senderData.chatId,
        senderId: body.senderData.sender ?? body.senderData.chatId,
        receivedAt: timestamp,
        text: body.messageData.textMessageData.textMessage,
        receiptAt: new Date().toISOString(),
      });
      await service.receive({
        connectionId: path.connectionId,
        bearer: bearer(requestHeaders),
        message,
      });
      void requestId;
      return { accepted: true as const };
    },
  });
}
export function createListConversationMessagesHandler(
  service: Service,
  authentication: ProjectAuthenticationService,
) {
  return createHttpHandler({
    schemas: {
      path: ConversationPathSchema,
      query: ConversationQuerySchema,
      response: ConversationHistorySchema,
    },
    deriveAuthorization: createProjectAuthorization(authentication, "communication"),
    callback: ({ authorization, path, query }) =>
      service.history(authorization, {
        ...path,
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      }),
  });
}
