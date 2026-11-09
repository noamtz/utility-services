import {
  CommunicationConnectionSchema,
  type CommunicationConnection,
  type CreateCommunicationConnectionRequest,
} from "@utility-services/contracts";

import { HttpError } from "../../core/http/handler.js";
import type { OwnerContext } from "../identity-control/auth/owner-context.js";

export interface ConnectionRecord extends CommunicationConnection {
  readonly ownerId: string;
  readonly secretReference: string;
  readonly secretVersion: number;
}

export interface ConnectionRepository {
  reserveAndCreate(record: ConnectionRecord): Promise<void>;
  inspect(connectionId: string): Promise<ConnectionRecord | undefined>;
}

export interface ConnectionSecretStore {
  store(input: { connectionId: string; credential: string }): Promise<{ reference: string; version: number }>;
  remove(reference: string): Promise<void>;
}

export class DuplicateProviderInstanceError extends Error {}

function toPublicConnection(record: ConnectionRecord): CommunicationConnection {
  return CommunicationConnectionSchema.parse({
    connectionId: record.connectionId,
    projectId: record.projectId,
    provider: record.provider,
    instanceId: record.instanceId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function generateConnectionId(): string {
  return `con_${crypto.randomUUID().replaceAll("-", "").slice(0, 22)}`;
}

export function createCommunicationConnectionService(dependencies: {
  repository: ConnectionRepository;
  secretStore: ConnectionSecretStore;
  now?: () => Date;
  generateId?: () => string;
}) {
  const now = dependencies.now ?? (() => new Date());
  const generateId = dependencies.generateId ?? generateConnectionId;
  return {
    async create(
      owner: OwnerContext,
      projectId: string,
      request: CreateCommunicationConnectionRequest,
    ): Promise<CommunicationConnection> {
      const connectionId = generateId();
      const timestamp = now().toISOString();
      const storedSecret = await dependencies.secretStore.store({
        connectionId,
        credential: request.credential,
      });
      const record: ConnectionRecord = {
        ...CommunicationConnectionSchema.parse({
          connectionId,
          projectId,
          provider: request.provider,
          instanceId: request.instanceId,
          status: "active",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
        ownerId: owner.ownerId,
        secretReference: storedSecret.reference,
        secretVersion: storedSecret.version,
      };
      try {
        await dependencies.repository.reserveAndCreate(record);
      } catch (error) {
        await dependencies.secretStore.remove(storedSecret.reference).catch(() => undefined);
        if (error instanceof DuplicateProviderInstanceError) {
          throw new HttpError(409, "PROVIDER_INSTANCE_ALREADY_BOUND", "Provider instance is already bound");
        }
        throw error;
      }
      return toPublicConnection(record);
    },
    async inspect(owner: OwnerContext, connectionId: string): Promise<CommunicationConnection> {
      const record = await dependencies.repository.inspect(connectionId);
      if (!record || record.ownerId !== owner.ownerId) {
        throw new HttpError(404, "NOT_FOUND", "Communication connection not found");
      }
      return toPublicConnection(record);
    },
  };
}
