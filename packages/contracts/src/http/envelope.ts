import { z } from "zod";

export const RequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Request ID contains unsupported characters");

export const ValidationDetailSchema = z
  .object({
    path: z.string(),
    message: z.string().min(1),
  })
  .strict();

export const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        message: z.string().min(1),
        details: z.array(ValidationDetailSchema).optional(),
      })
      .strict(),
    requestId: RequestIdSchema,
  })
  .strict();

export function createSuccessEnvelopeSchema<TSchema extends z.ZodType>(dataSchema: TSchema) {
  return z
    .object({
      data: dataSchema,
      requestId: RequestIdSchema,
    })
    .strict();
}

export type ValidationDetail = z.infer<typeof ValidationDetailSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type SuccessEnvelope<T> = {
  data: T;
  requestId: z.infer<typeof RequestIdSchema>;
};
