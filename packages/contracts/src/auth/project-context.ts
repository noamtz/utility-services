import { z } from "zod";

import { ApiKeyIdSchema } from "../credentials/contract.js";
import {
  EnabledUtilitiesSchema,
  FileManagementSettingsSchema,
  PublicProjectIdSchema,
} from "../projects/contract.js";

export const TrustedProjectContextSchema = z
  .object({
    internalProjectId: z.uuid(),
    publicProjectId: PublicProjectIdSchema,
    keyId: ApiKeyIdSchema,
    enabledUtilities: EnabledUtilitiesSchema,
    fileManagement: FileManagementSettingsSchema,
  })
  .strict();

export type TrustedProjectContext = z.infer<typeof TrustedProjectContextSchema>;
