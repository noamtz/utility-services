import { z } from "zod";

import { createSuccessEnvelopeSchema } from "../http/envelope.js";
import { PublicProjectIdSchema } from "../projects/contract.js";

export const COMMUNICATION_UTILITY = "communication" as const;
export const ConnectionIdSchema = z.string().regex(/^con_[A-Za-z0-9_-]{22}$/);
export const ProviderInstanceIdSchema = z.string().trim().min(1).max(128);
export const ProviderCredentialSchema = z.string().trim().min(16).max(4096);
export const ConnectionStatusSchema = z.enum(["active", "rotating", "disabled"]);

export const CreateCommunicationConnectionRequestSchema = z
  .object({
    provider: z.literal("green-api"),
    instanceId: ProviderInstanceIdSchema,
    credential: ProviderCredentialSchema,
  })
  .strict();
export const RotateCommunicationCredentialRequestSchema = z
  .object({ credential: ProviderCredentialSchema })
  .strict();

export const CommunicationConnectionSchema = z
  .object({
    connectionId: ConnectionIdSchema,
    projectId: PublicProjectIdSchema,
    provider: z.literal("green-api"),
    instanceId: ProviderInstanceIdSchema,
    status: ConnectionStatusSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const CommunicationConnectionResponseSchema = createSuccessEnvelopeSchema(
  CommunicationConnectionSchema,
);
export const CommunicationConnectionListSchema = z
  .object({ items: z.array(CommunicationConnectionSchema).max(1) })
  .strict();
export const CommunicationConnectionListResponseSchema = createSuccessEnvelopeSchema(
  CommunicationConnectionListSchema,
);
export const CommunicationConnectionPathSchema = z
  .object({ projectId: PublicProjectIdSchema, connectionId: ConnectionIdSchema })
  .strict();

/** Returned once by the owner-only setup endpoint. Never persist or log the token. */
export const WebhookSetupSchema = z
  .object({ callbackUrl: z.string().url(), webhookUrlToken: z.string().min(43).max(256) })
  .strict();
export const WebhookSetupResponseSchema = createSuccessEnvelopeSchema(WebhookSetupSchema);

export type CreateCommunicationConnectionRequest = z.infer<
  typeof CreateCommunicationConnectionRequestSchema
>;
export type CommunicationConnection = z.infer<typeof CommunicationConnectionSchema>;
export type CommunicationConnectionPath = z.infer<typeof CommunicationConnectionPathSchema>;
export type RotateCommunicationCredentialRequest = z.infer<
  typeof RotateCommunicationCredentialRequestSchema
>;
export type WebhookSetup = z.infer<typeof WebhookSetupSchema>;
