import {
  CommunicationConnectionResponseSchema,
  CreateCommunicationConnectionRequestSchema,
  RotateCommunicationCredentialRequestSchema,
  type CommunicationConnection,
  type CreateCommunicationConnectionRequest,
} from "@utility-services/contracts";
import { createControlClient } from "../api/control-client.js";
export function createCommunicationApi(dependencies: {
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}) {
  const client = createControlClient(dependencies);
  const base = (id: string) =>
    `/v1/control/projects/${encodeURIComponent(id)}/communication-connections`;
  return {
    register: async (
      id: string,
      input: CreateCommunicationConnectionRequest,
    ): Promise<CommunicationConnection> =>
      (
        await client.request(base(id), CommunicationConnectionResponseSchema, {
          method: "POST",
          body: JSON.stringify(CreateCommunicationConnectionRequestSchema.parse(input)),
        })
      ).data,
    inspect: async (id: string, connectionId: string): Promise<CommunicationConnection> =>
      (
        await client.request(
          `${base(id)}/${encodeURIComponent(connectionId)}`,
          CommunicationConnectionResponseSchema,
        )
      ).data,
    rotate: async (
      id: string,
      connectionId: string,
      credential: string,
    ): Promise<CommunicationConnection> =>
      (
        await client.request(
          `${base(id)}/${encodeURIComponent(connectionId)}/rotate`,
          CommunicationConnectionResponseSchema,
          {
            method: "POST",
            body: JSON.stringify(RotateCommunicationCredentialRequestSchema.parse({ credential })),
          },
        )
      ).data,
    disable: async (id: string, connectionId: string): Promise<CommunicationConnection> =>
      (
        await client.request(
          `${base(id)}/${encodeURIComponent(connectionId)}`,
          CommunicationConnectionResponseSchema,
          { method: "DELETE" },
        )
      ).data,
  };
}
