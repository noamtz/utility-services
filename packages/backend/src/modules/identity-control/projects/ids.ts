import { randomBytes, randomUUID } from "node:crypto";

import { PublicProjectIdSchema } from "@utility-services/contracts";
import { z } from "zod";

export interface ProjectIds {
  readonly internalProjectId: string;
  readonly publicProjectId: string;
}

export interface ProjectIdFactories {
  readonly createUuid?: () => string;
  readonly createRandomBytes?: (size: number) => Buffer;
}

export function generateProjectIds(factories: ProjectIdFactories = {}): ProjectIds {
  const internalProjectId = z.uuid().parse((factories.createUuid ?? randomUUID)());
  const bytes = (factories.createRandomBytes ?? randomBytes)(16);
  if (bytes.length !== 16) {
    throw new Error("Public project ID entropy source returned an invalid length");
  }
  const publicProjectId = PublicProjectIdSchema.parse(`prj_${bytes.toString("base64url")}`);
  return Object.freeze({ internalProjectId, publicProjectId });
}
