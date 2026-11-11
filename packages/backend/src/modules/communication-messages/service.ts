import { timingSafeEqual, createHash } from "node:crypto";
import type { IncomingTextMessage, TrustedProjectContext } from "@utility-services/contracts";
import { HttpError } from "../../core/http/handler.js";
import type {
  ConnectionRecord,
  ConnectionRepository,
} from "../communication-connections/service.js";

export interface MessageRepository {
  persist(
    message: IncomingTextMessage,
    connection: ConnectionRecord,
  ): Promise<"created" | "duplicate">;
  list(input: {
    internalProjectId: string;
    connectionId: string;
    conversationId: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: IncomingTextMessage[];
    nextCursor?: string;
    knownRecordStartedAt?: string;
    watermark?: string;
  }>;
}
export interface MessageQueue {
  send(message: IncomingTextMessage): Promise<void>;
}
function hash(secret: string) {
  return createHash("sha256").update(secret).digest("base64url");
}
function validSecret(secret: string, digest: string | undefined) {
  if (!digest) return false;
  const left = Buffer.from(hash(secret));
  const right = Buffer.from(digest);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function createCommunicationMessageService(deps: {
  connections: ConnectionRepository;
  messages: MessageRepository;
  queue: MessageQueue;
}) {
  return {
    async receive(input: {
      connectionId: string;
      bearer: string | undefined;
      message: IncomingTextMessage;
    }) {
      const connection = await deps.connections.inspect(input.connectionId);
      if (
        !connection ||
        connection.status !== "active" ||
        !input.bearer ||
        !validSecret(input.bearer, connection.webhookSecretHash)
      )
        throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
      if (connection.instanceId !== input.message.instanceId)
        throw new HttpError(404, "NOT_FOUND", "Webhook not found");
      await deps.queue.send(input.message);
    },
    async process(message: IncomingTextMessage) {
      const connection = await deps.connections.inspect(message.connectionId);
      if (
        !connection ||
        connection.status !== "active" ||
        connection.instanceId !== message.instanceId
      )
        return;
      await deps.messages.persist(message, connection);
    },
    async history(
      context: TrustedProjectContext,
      input: { connectionId: string; conversationId: string; limit: number; cursor?: string },
    ) {
      const connection = await deps.connections.inspect(input.connectionId);
      if (!connection || connection.projectId !== context.publicProjectId)
        throw new HttpError(404, "NOT_FOUND", "Conversation not found");
      // Connection ownership was resolved from the verified key's public project ID; never accept it from callers.
      return deps.messages.list({ ...input, internalProjectId: context.publicProjectId });
    },
  };
}
