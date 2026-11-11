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

export const GroupIdSchema = z.string().trim().min(1).max(256);
export const GroupPresenceSchema = z.enum(["present", "unknown"]);
export const GroupObservationReasonSchema = z.enum([
  "confirmed-by-group-data",
  "provider-error",
  "incomplete-scan",
  "missing-from-scan",
  "unconfirmed-group-data",
]);
export const GroupDirectoryEntrySchema = z
  .object({
    groupId: GroupIdSchema,
    presence: GroupPresenceSchema,
    observedAt: z.iso.datetime({ offset: true }),
    sourceObservedAt: z.iso.datetime({ offset: true }).nullable(),
    scanComplete: z.boolean(),
    knownRecordStartAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const GroupDirectoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const GroupDirectoryListSchema = z
  .object({ items: z.array(GroupDirectoryEntrySchema), cursor: z.string().optional() })
  .strict();
export const GroupDirectoryListResponseSchema =
  createSuccessEnvelopeSchema(GroupDirectoryListSchema);
export const GroupEventSchema = GroupDirectoryEntrySchema.extend({
  eventId: z.string().min(1).max(128),
  reason: GroupObservationReasonSchema,
}).strict();
export const GroupEventListSchema = z
  .object({ items: z.array(GroupEventSchema), cursor: z.string().optional() })
  .strict();
export const GroupEventListResponseSchema = createSuccessEnvelopeSchema(GroupEventListSchema);
export const GroupEventPathSchema = z.object({ groupId: GroupIdSchema }).strict();

export type CreateCommunicationConnectionRequest = z.infer<
  typeof CreateCommunicationConnectionRequestSchema
>;
export type CommunicationConnection = z.infer<typeof CommunicationConnectionSchema>;
export type CommunicationConnectionPath = z.infer<typeof CommunicationConnectionPathSchema>;
export type RotateCommunicationCredentialRequest = z.infer<
  typeof RotateCommunicationCredentialRequestSchema
>;
export type GroupDirectoryEntry = z.infer<typeof GroupDirectoryEntrySchema>;
export type GroupDirectoryQuery = z.infer<typeof GroupDirectoryQuerySchema>;
