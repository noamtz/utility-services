import { z } from "zod";

import { createSuccessEnvelopeSchema } from "../http/envelope.js";

export const HealthPayloadSchema = z.object({ status: z.literal("ok") }).strict();
export const HealthResponseSchema = createSuccessEnvelopeSchema(HealthPayloadSchema);

export type HealthPayload = z.infer<typeof HealthPayloadSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
