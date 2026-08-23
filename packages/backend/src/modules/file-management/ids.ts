import { randomBytes } from "node:crypto";

import {
  FileIdSchema,
  PublicFileIdSchema,
  type FileId,
  type PublicFileId,
} from "@utility-services/contracts";

export interface FileIds {
  readonly fileId: FileId;
  readonly publicFileId: PublicFileId;
}

export type FileEntropy = () => Buffer;

function identifier(prefix: "fil_" | "pfil_", entropy: FileEntropy): string {
  const bytes = entropy();
  if (bytes.length !== 16) throw new RangeError("File identifier entropy must contain 16 bytes");
  return `${prefix}${bytes.toString("base64url")}`;
}

export function generateFileIds(entropy: FileEntropy = () => randomBytes(16)): FileIds {
  return Object.freeze({
    fileId: FileIdSchema.parse(identifier("fil_", entropy)),
    publicFileId: PublicFileIdSchema.parse(identifier("pfil_", entropy)),
  });
}
