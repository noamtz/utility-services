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
  updateLifecycle?(
    connectionId: string,
    expectedVersion: number,
    patch: Pick<ConnectionRecord, "secretReference" | "secretVersion" | "status" | "updatedAt">,
  ): Promise<void>;
  listForProject?(projectId: string): Promise<readonly ConnectionRecord[]>;
}

export interface ConnectionSecretStore {
  store(input: {
    connectionId: string;
    credential: string;
    version?: number;
  }): Promise<{ reference: string; version: number }>;
  remove(reference: string): Promise<void>;
}

export class DuplicateProviderInstanceError extends Error {}
export class ProjectCommunicationAlreadyBoundError extends Error {}

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
          throw new HttpError(
            409,
            "PROVIDER_INSTANCE_ALREADY_BOUND",
            "Provider instance is already bound",
          );
        }
        if (error instanceof ProjectCommunicationAlreadyBoundError) {
          throw new HttpError(
            409,
            "PROJECT_COMMUNICATION_ALREADY_BOUND",
            "Project already has a communication connection",
          );
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
    async rotate(
      owner: OwnerContext,
      connectionId: string,
      credential: string,
    ): Promise<CommunicationConnection> {
      const current = await dependencies.repository.inspect(connectionId);
      if (!current || current.ownerId !== owner.ownerId)
        throw new HttpError(404, "NOT_FOUND", "Communication connection not found");
      if (current.status === "disabled")
        throw new HttpError(409, "CONNECTION_DISABLED", "Communication connection is disabled");
      const stored = await dependencies.secretStore.store({
        connectionId,
        credential,
        version: current.secretVersion + 1,
      });
      const updatedAt = now().toISOString();
      try {
        if (!dependencies.repository.updateLifecycle)
          throw new Error("Connection lifecycle repository is unavailable");
        await dependencies.repository.updateLifecycle(connectionId, current.secretVersion, {
          secretReference: stored.reference,
          secretVersion: stored.version,
          status: "active",
          updatedAt,
        });
      } catch {
        await dependencies.secretStore.remove(stored.reference).catch(() => undefined);
        throw new HttpError(409, "CONNECTION_CHANGED", "Communication connection changed; retry");
      }
      await dependencies.secretStore.remove(current.secretReference).catch(() => undefined);
      return toPublicConnection({
        ...current,
        secretReference: stored.reference,
        secretVersion: stored.version,
        status: "active",
        updatedAt,
      });
    },
    async list(
      owner: OwnerContext,
      projectId: string,
    ): Promise<readonly CommunicationConnection[]> {
      if (!dependencies.repository.listForProject)
        throw new Error("Connection list repository is unavailable");
      const records = await dependencies.repository.listForProject(projectId);
      return records.filter((record) => record.ownerId === owner.ownerId).map(toPublicConnection);
    },
    async disable(owner: OwnerContext, connectionId: string): Promise<CommunicationConnection> {
      const current = await dependencies.repository.inspect(connectionId);
      if (!current || current.ownerId !== owner.ownerId)
        throw new HttpError(404, "NOT_FOUND", "Communication connection not found");
      const updatedAt = now().toISOString();
      if (!dependencies.repository.updateLifecycle)
        throw new Error("Connection lifecycle repository is unavailable");
      await dependencies.repository.updateLifecycle(connectionId, current.secretVersion, {
        secretReference: current.secretReference,
        secretVersion: current.secretVersion,
        status: "disabled",
        updatedAt,
      });
      return toPublicConnection({ ...current, status: "disabled", updatedAt });
    },
  };
}
