import { z } from "zod";
import { createSuccessEnvelopeSchema } from "../http/envelope.js";
import { ConnectionIdSchema } from "./contract.js";

export const ConversationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+@g\.us$/)
  .max(256);
export const ProviderMessageIdSchema = z.string().trim().min(1).max(256);
export const MessageTextSchema = z.string().min(1).max(65_536);
export const IncomingTextMessageSchema = z
  .object({
    connectionId: ConnectionIdSchema,
    instanceId: z.string().trim().min(1).max(128),
    providerMessageId: ProviderMessageIdSchema,
    conversationId: ConversationIdSchema,
    senderId: z.string().trim().min(1).max(256),
    receivedAt: z.iso.datetime({ offset: true }),
    text: MessageTextSchema,
    receiptAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const ConversationPathSchema = z
  .object({ connectionId: ConnectionIdSchema, conversationId: ConversationIdSchema })
  .strict();
export const ConversationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
export const ConversationMessageSchema = IncomingTextMessageSchema.pick({
  providerMessageId: true,
  conversationId: true,
  senderId: true,
  receivedAt: true,
  text: true,
  receiptAt: true,
});
export const ConversationHistorySchema = z
  .object({
    items: z.array(ConversationMessageSchema),
    nextCursor: z.string().optional(),
    knownRecordStartedAt: z.iso.datetime({ offset: true }).optional(),
    watermark: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export const ConversationHistoryResponseSchema =
  createSuccessEnvelopeSchema(ConversationHistorySchema);
export type IncomingTextMessage = z.infer<typeof IncomingTextMessageSchema>;
