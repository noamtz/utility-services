import { DeleteParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";

import type { ConnectionSecretStore } from "./service.js";

const stageSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const connectionIdSchema = z.string().regex(/^con_[A-Za-z0-9_-]{22}$/);

/** Builds an opaque, stage-isolated SSM parameter path without using project or provider identifiers. */
export function connectionCredentialParameterName(
  stage: string,
  connectionId: string,
  version?: number,
): string {
  const base = `/utility-services/${stageSchema.parse(stage)}/communication/${connectionIdSchema.parse(connectionId)}`;
  return version === undefined
    ? base
    : `${base}/${z.number().int().positive().parse(version)}-${crypto.randomUUID()}`;
}

export function createSsmConnectionSecretStore(options: {
  readonly client?: Pick<SSMClient, "send">;
  readonly stage: string;
}): ConnectionSecretStore {
  const client = options.client ?? new SSMClient({});
  const stage = stageSchema.parse(options.stage);
  return {
    async store({ connectionId, credential, version }) {
      const reference = connectionCredentialParameterName(stage, connectionId, version);
      const output = await client.send(
        new PutParameterCommand({
          Name: reference,
          Value: credential,
          Type: "SecureString",
          Overwrite: false,
        }),
      );
      return { reference, version: version ?? z.number().int().positive().parse(output.Version) };
    },
    async remove(reference) {
      await client.send(
        new DeleteParameterCommand({
          Name: z.string().startsWith(`/utility-services/${stage}/communication/`).parse(reference),
        }),
      );
    },
  };
}
