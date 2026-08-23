import { z } from "zod";

import { ApiKeyIdSchema } from "../credentials/contract.js";
import { EnabledUtilitiesSchema } from "../projects/contract.js";

export const TrustedProjectContextSchema = z
  .object({
    internalProjectId: z.uuid(),
    keyId: ApiKeyIdSchema,
    enabledUtilities: EnabledUtilitiesSchema,
  })
  .strict();

export type TrustedProjectContext = z.infer<typeof TrustedProjectContextSchema>;
