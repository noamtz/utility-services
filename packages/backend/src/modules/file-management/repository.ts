import type {
  GetCommandOutput,
  QueryCommandOutput,
  TransactWriteCommandOutput,
  UpdateCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  FILE_SORT_PREFIX,
  PENDING_UPLOAD_INDEX_PARTITION,
  QUOTA_SORT_KEY,
  TRASH_PURGE_INDEX_PARTITION,
  fileProjectPartitionKey,
  fileSortKey,
  parseFileItem,
  publicFilePartitionKey,
  publicFileSortKey,
  trashPurgeSortKey,
  UPLOAD_CAPABILITY_EXPIRY_SKEW_MILLISECONDS,
  type CompletionEvidence,
  type FileItem,
} from "./model.js";

export interface ListFilesInput {
  readonly internalProjectId: string;
  readonly limit: number;
  readonly startAfterFileId?: string;
}

export interface ListFilesResult {
  readonly items: FileItem[];
  readonly nextFileId?: string;
}

export interface DuePendingResult {
  readonly items: FileItem[];
  readonly nextStartKey?: Record<string, unknown>;
}

export interface DuePurgeResult {
  readonly items: FileItem[];
  readonly nextStartKey?: Record<string, unknown>;
}

export interface FileRepository {
  get(internalProjectId: string, fileId: string): Promise<FileItem | undefined>;
  getPublic(publicProjectId: string, publicFileId: string): Promise<FileItem | undefined>;
  list(input: ListFilesInput): Promise<ListFilesResult>;
  reservePending(file: FileItem, quotaLimitBytes: bigint): Promise<void>;
  claimCompletion(file: FileItem, evidence: CompletionEvidence, now: string): Promise<FileItem>;
  finalizeReady(file: FileItem, now: string): Promise<FileItem>;
  claimFailure(
    file: FileItem,
    reasonCode: string,
    cleanupRequired: boolean,
    now: string,
  ): Promise<FileItem>;
  completeFailureCleanup(file: FileItem, now: string): Promise<FileItem>;
  finalizeFailed(file: FileItem, now: string): Promise<FileItem>;
  listDuePending(
    dueThrough: string,
    limit: number,
    startKey?: Record<string, unknown>,
  ): Promise<DuePendingResult>;
  trash(file: FileItem, trashedAt: string, purgeAt: string): Promise<FileItem>;
  restore(file: FileItem, now: string): Promise<FileItem>;
  claimPermanentRemoval(file: FileItem, now: string, force: boolean): Promise<FileItem>;
  recordObjectRemoved(file: FileItem, removedAt: string): Promise<FileItem>;
  finalizePermanentRemoval(file: FileItem, now: string): Promise<void>;
  listDuePurge(
    dueThrough: string,
    limit: number,
    startKey?: Record<string, unknown>,
  ): Promise<DuePurgeResult>;
}

export interface FileDocumentClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
  send(command: TransactWriteCommand): Promise<TransactWriteCommandOutput>;
}

export class FileCollisionError extends Error {
  public constructor() {
    super("File identifier collision");
    this.name = "FileCollisionError";
  }
}
export class StorageQuotaExceededError extends Error {
  public constructor() {
    super("Project retained storage quota exceeded");
    this.name = "StorageQuotaExceededError";
  }
}
export class FileStateConflictError extends Error {
  public constructor() {
    super("File state changed");
    this.name = "FileStateConflictError";
  }
}
export class CorruptFileRecordError extends Error {
  public constructor() {
    super("Stored file record is invalid");
    this.name = "CorruptFileRecordError";
  }
}

export const FILE_DOCUMENT_CLIENT_OPTIONS = Object.freeze({
  marshallOptions: { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: (value: string) => BigInt(value) },
});

function cancellationReasons(error: unknown): ReadonlyArray<{ Code?: string }> | undefined {
  if (
    error === null ||
    typeof error !== "object" ||
    !("name" in error) ||
    error.name !== "TransactionCanceledException" ||
    !("CancellationReasons" in error) ||
    !Array.isArray(error.CancellationReasons)
  ) {
    return undefined;
  }
  return error.CancellationReasons as ReadonlyArray<{ Code?: string }>;
}

function isConditionalFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "TransactionCanceledException" ||
      error.name === "ConditionalCheckFailedException")
  );
}

function parseStoredFile(input: unknown, internalProjectId: string): FileItem {
  try {
    const item = parseFileItem(input);
    if (item.internalProjectId !== internalProjectId) throw new CorruptFileRecordError();
    return item;
  } catch (error) {
    if (error instanceof CorruptFileRecordError) throw error;
    throw new CorruptFileRecordError();
  }
}

function parsePublicStoredFile(
  input: unknown,
  publicProjectId: string,
  publicFileId: string,
): FileItem {
  try {
    const item = parseFileItem(input);
    if (
      item.visibility !== "public" ||
      item.publicProjectId !== publicProjectId ||
      item.publicFileId !== publicFileId ||
      item.gsi1pk !== publicFilePartitionKey(publicProjectId) ||
      item.gsi1sk !== publicFileSortKey(publicFileId)
    ) {
      throw new CorruptFileRecordError();
    }
    return item;
  } catch (error) {
    if (error instanceof CorruptFileRecordError) throw error;
    throw new CorruptFileRecordError();
  }
}

function completionMatches(
  left: CompletionEvidence | undefined,
  right: CompletionEvidence,
): boolean {
  return (
    left !== undefined &&
    left.completedAt === right.completedAt &&
    left.sizeBytes === right.sizeBytes &&
    left.mediaType === right.mediaType &&
    left.eTag === right.eTag &&
    left.sequencer === right.sequencer
  );
}

function transactionToken(
  operation: "reserve" | "ready" | "failed" | "purged",
  input: string,
): string {
  const digest = createHash("sha256").update(`${operation}:${input}`).digest("hex").slice(0, 28);
  return `${operation}-${digest}`;
}

export function createDynamoFileRepository(options: {
  readonly client: FileDocumentClient;
  readonly tableName: string;
  readonly publicIndexName: string;
  readonly lifecycleIndexName: string;
}): FileRepository {
  const tableName = z.string().trim().min(1).parse(options.tableName);
  const publicIndexName = z.string().trim().min(1).parse(options.publicIndexName);
  const lifecycleIndexName = z.string().trim().min(1).parse(options.lifecycleIndexName);

  async function get(internalProjectId: string, fileId: string): Promise<FileItem | undefined> {
    const output = await options.client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: fileProjectPartitionKey(internalProjectId), sk: fileSortKey(fileId) },
        ConsistentRead: true,
      }),
    );
    return output.Item ? parseStoredFile(output.Item, internalProjectId) : undefined;
  }

  return {
    get,

    async getPublic(publicProjectId, publicFileId) {
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: publicIndexName,
          KeyConditionExpression: "gsi1pk = :project AND gsi1sk = :file",
          ExpressionAttributeValues: {
            ":project": publicFilePartitionKey(publicProjectId),
            ":file": publicFileSortKey(publicFileId),
          },
          Limit: 2,
        }),
      );
      let items: unknown[];
      try {
        items = z.array(z.unknown()).parse(output.Items ?? []);
      } catch {
        throw new CorruptFileRecordError();
      }
      if (items.length === 0) return undefined;
      if (items.length !== 1) throw new CorruptFileRecordError();
      const indexed = parsePublicStoredFile(items[0], publicProjectId, publicFileId);
      const primary = await get(indexed.internalProjectId, indexed.fileId);
      if (!primary) return undefined;
      return parsePublicStoredFile(primary, publicProjectId, publicFileId);
    },

    async list(input) {
      const internalProjectId = z.uuid().parse(input.internalProjectId);
      const limit = z.number().int().min(1).max(50).parse(input.limit);
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :project AND begins_with(sk, :file)",
          ExpressionAttributeValues: {
            ":project": fileProjectPartitionKey(internalProjectId),
            ":file": FILE_SORT_PREFIX,
          },
          ConsistentRead: true,
          Limit: limit,
          ...(input.startAfterFileId
            ? {
                ExclusiveStartKey: {
                  pk: fileProjectPartitionKey(internalProjectId),
                  sk: fileSortKey(input.startAfterFileId),
                },
              }
            : {}),
        }),
      );
      const items = z
        .array(z.unknown())
        .parse(output.Items ?? [])
        .map((item) => parseStoredFile(item, internalProjectId));
      if (output.LastEvaluatedKey && items.length === 0) throw new CorruptFileRecordError();
      const last = output.LastEvaluatedKey ? items.at(-1) : undefined;
      return { items, ...(last ? { nextFileId: last.fileId } : {}) };
    },

    async reservePending(fileInput, quotaLimitBytes) {
      const file = parseFileItem(fileInput);
      const quotaLimit = z.bigint().positive().parse(quotaLimitBytes);
      if (file.status !== "pending" || file.failureCode !== undefined) {
        throw new FileStateConflictError();
      }
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: transactionToken("reserve", file.fileId),
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: file.pk, sk: QUOTA_SORT_KEY },
                  UpdateExpression:
                    "SET itemType = if_not_exists(itemType, :quotaType), internalProjectId = if_not_exists(internalProjectId, :internal), reservedBytes = if_not_exists(reservedBytes, :zero) + :size, retainedBytes = if_not_exists(retainedBytes, :zero), accountedBytes = if_not_exists(accountedBytes, :zero) + :size, revision = if_not_exists(revision, :zero) + :one, updatedAt = :updatedAt",
                  ConditionExpression:
                    "attribute_not_exists(pk) OR (itemType = :quotaType AND internalProjectId = :internal AND accountedBytes <= :remaining)",
                  ExpressionAttributeValues: {
                    ":quotaType": "file-quota",
                    ":internal": file.internalProjectId,
                    ":zero": 0n,
                    ":one": 1n,
                    ":size": file.sizeBytes,
                    ":remaining": quotaLimit - file.sizeBytes,
                    ":updatedAt": file.updatedAt,
                  },
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: file,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
            ],
          }),
        );
      } catch (error) {
        const reasons = cancellationReasons(error);
        if (reasons?.[0]?.Code === "ConditionalCheckFailed") {
          throw new StorageQuotaExceededError();
        }
        if (reasons?.[1]?.Code === "ConditionalCheckFailed") throw new FileCollisionError();
        if (isConditionalFailure(error)) throw new FileStateConflictError();
        throw error;
      }
    },

    async claimCompletion(fileInput, evidence, now) {
      const file = parseFileItem(fileInput);
      if (file.status !== "pending") {
        if (file.status === "ready" && completionMatches(file.completionEvidence, evidence))
          return file;
        throw new FileStateConflictError();
      }
      if (file.failureCode !== undefined) throw new FileStateConflictError();
      try {
        const output = await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: file.pk, sk: file.sk },
            UpdateExpression:
              "SET completionEvidence = if_not_exists(completionEvidence, :evidence), updatedAt = :updatedAt, revision = revision + :one",
            ConditionExpression:
              "#status = :pending AND internalProjectId = :internal AND fileId = :file AND attribute_not_exists(failureCode) AND (attribute_not_exists(completionEvidence) OR completionEvidence = :evidence)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "pending",
              ":internal": file.internalProjectId,
              ":file": file.fileId,
              ":evidence": evidence,
              ":updatedAt": now,
              ":one": 1n,
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        return parseStoredFile(output.Attributes, file.internalProjectId);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (existing && completionMatches(existing.completionEvidence, evidence)) return existing;
        throw new FileStateConflictError();
      }
    },

    async finalizeReady(fileInput, now) {
      const file = parseFileItem(fileInput);
      if (file.status === "ready") return file;
      if (file.status !== "pending" || file.completionEvidence === undefined) {
        throw new FileStateConflictError();
      }
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: transactionToken(
              "ready",
              `${file.fileId}:${file.revision.toString()}`,
            ),
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: file.pk, sk: file.sk },
                  UpdateExpression:
                    "SET #status = :ready, readyAt = :completedAt, updatedAt = :updatedAt, revision = revision + :one REMOVE gsi2pk, gsi2sk",
                  ConditionExpression:
                    "#status = :pending AND revision = :revision AND completionEvidence = :evidence AND attribute_not_exists(failureCode)",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":ready": "ready",
                    ":pending": "pending",
                    ":completedAt": file.completionEvidence.completedAt,
                    ":updatedAt": now,
                    ":one": 1n,
                    ":revision": file.revision,
                    ":evidence": file.completionEvidence,
                  },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: file.pk, sk: QUOTA_SORT_KEY },
                  UpdateExpression:
                    "SET reservedBytes = reservedBytes - :size, retainedBytes = retainedBytes + :size, revision = revision + :one, updatedAt = :updatedAt",
                  ConditionExpression:
                    "itemType = :quotaType AND internalProjectId = :internal AND reservedBytes >= :size AND accountedBytes >= :size",
                  ExpressionAttributeValues: {
                    ":size": file.sizeBytes,
                    ":one": 1n,
                    ":updatedAt": now,
                    ":quotaType": "file-quota",
                    ":internal": file.internalProjectId,
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) throw new FileStateConflictError();
        throw error;
      }
      const ready = await get(file.internalProjectId, file.fileId);
      if (!ready || ready.status !== "ready") throw new CorruptFileRecordError();
      return ready;
    },

    async claimFailure(fileInput, reasonCode, cleanupRequired, now) {
      const file = parseFileItem(fileInput);
      if (file.status === "failed" && file.failureCode === reasonCode) return file;
      if (file.status !== "pending" || file.completionEvidence !== undefined) {
        throw new FileStateConflictError();
      }
      try {
        const output = await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: file.pk, sk: file.sk },
            UpdateExpression:
              "SET failureCode = if_not_exists(failureCode, :reason), cleanupRequired = if_not_exists(cleanupRequired, :cleanup), updatedAt = :updatedAt, revision = revision + :one",
            ConditionExpression:
              "#status = :pending AND internalProjectId = :internal AND fileId = :file AND attribute_not_exists(completionEvidence) AND (attribute_not_exists(failureCode) OR (failureCode = :reason AND cleanupRequired = :cleanup))",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":pending": "pending",
              ":internal": file.internalProjectId,
              ":file": file.fileId,
              ":reason": z
                .string()
                .regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)
                .parse(reasonCode),
              ":cleanup": cleanupRequired,
              ":updatedAt": now,
              ":one": 1n,
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        return parseStoredFile(output.Attributes, file.internalProjectId);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (
          existing &&
          existing.failureCode === reasonCode &&
          existing.cleanupRequired === cleanupRequired
        ) {
          return existing;
        }
        throw new FileStateConflictError();
      }
    },

    async finalizeFailed(fileInput, now) {
      const file = parseFileItem(fileInput);
      if (file.status === "failed") return file;
      if (
        file.status !== "pending" ||
        file.failureCode === undefined ||
        file.cleanupRequired !== false
      ) {
        throw new FileStateConflictError();
      }
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: transactionToken(
              "failed",
              `${file.fileId}:${file.revision.toString()}`,
            ),
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: file.pk, sk: file.sk },
                  UpdateExpression:
                    "SET #status = :failed, failedAt = :failedAt, updatedAt = :failedAt, revision = revision + :one REMOVE gsi2pk, gsi2sk",
                  ConditionExpression:
                    "#status = :pending AND revision = :revision AND failureCode = :reason AND cleanupRequired = :clean",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":failed": "failed",
                    ":pending": "pending",
                    ":failedAt": now,
                    ":one": 1n,
                    ":revision": file.revision,
                    ":reason": file.failureCode,
                    ":clean": false,
                  },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: file.pk, sk: QUOTA_SORT_KEY },
                  UpdateExpression:
                    "SET reservedBytes = reservedBytes - :size, accountedBytes = accountedBytes - :size, revision = revision + :one, updatedAt = :updatedAt",
                  ConditionExpression:
                    "itemType = :quotaType AND internalProjectId = :internal AND reservedBytes >= :size AND accountedBytes >= :size",
                  ExpressionAttributeValues: {
                    ":size": file.sizeBytes,
                    ":one": 1n,
                    ":updatedAt": now,
                    ":quotaType": "file-quota",
                    ":internal": file.internalProjectId,
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) throw new FileStateConflictError();
        throw error;
      }
      const failed = await get(file.internalProjectId, file.fileId);
      if (!failed || failed.status !== "failed") throw new CorruptFileRecordError();
      return failed;
    },

    async completeFailureCleanup(fileInput, now) {
      const file = parseFileItem(fileInput);
      if (file.status !== "pending" || file.failureCode === undefined) {
        throw new FileStateConflictError();
      }
      if (file.cleanupRequired === false) return file;
      try {
        const output = await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: file.pk, sk: file.sk },
            UpdateExpression:
              "SET cleanupRequired = :clean, updatedAt = :updatedAt, revision = revision + :one",
            ConditionExpression:
              "#status = :pending AND revision = :revision AND failureCode = :reason AND cleanupRequired = :required",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":clean": false,
              ":required": true,
              ":pending": "pending",
              ":revision": file.revision,
              ":reason": file.failureCode,
              ":updatedAt": now,
              ":one": 1n,
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        return parseStoredFile(output.Attributes, file.internalProjectId);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (existing?.failureCode === file.failureCode && existing.cleanupRequired === false) {
          return existing;
        }
        throw new FileStateConflictError();
      }
    },

    async listDuePending(dueThrough, limit, startKey) {
      const through = z.iso.datetime({ offset: true }).parse(dueThrough);
      const boundedLimit = z.number().int().min(1).max(100).parse(limit);
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: lifecycleIndexName,
          KeyConditionExpression: "gsi2pk = :pending AND gsi2sk <= :through",
          ExpressionAttributeValues: {
            ":pending": PENDING_UPLOAD_INDEX_PARTITION,
            ":through": `${through}#\uffff`,
          },
          ScanIndexForward: true,
          Limit: boundedLimit,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      const items = z
        .array(z.unknown())
        .parse(output.Items ?? [])
        .map((item) => {
          try {
            return parseFileItem(item);
          } catch {
            throw new CorruptFileRecordError();
          }
        });
      return {
        items,
        ...(output.LastEvaluatedKey ? { nextStartKey: output.LastEvaluatedKey } : {}),
      };
    },

    async trash(fileInput, trashedAtInput, purgeAtInput) {
      const file = parseFileItem(fileInput);
      if (file.status === "trashed") {
        if (file.purgeStartedAt === undefined) return file;
        throw new FileStateConflictError();
      }
      if (file.status !== "ready") throw new FileStateConflictError();
      const trashedAt = z.iso.datetime({ offset: true }).parse(trashedAtInput);
      const purgeAt = z.iso.datetime({ offset: true }).parse(purgeAtInput);
      const lifecycleSortKey = trashPurgeSortKey(purgeAt, file.internalProjectId, file.fileId);
      try {
        const output = await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: file.pk, sk: file.sk },
            UpdateExpression:
              "SET #status = :trashed, trashedAt = :trashedAt, purgeAt = :purgeAt, gsi2pk = :lifecyclePk, gsi2sk = :lifecycleSk, updatedAt = :updatedAt, revision = revision + :one",
            ConditionExpression:
              "attribute_exists(pk) AND #status = :ready AND revision = :revision AND internalProjectId = :internal AND fileId = :file",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":trashed": "trashed",
              ":ready": "ready",
              ":trashedAt": trashedAt,
              ":purgeAt": purgeAt,
              ":lifecyclePk": TRASH_PURGE_INDEX_PARTITION,
              ":lifecycleSk": lifecycleSortKey,
              ":updatedAt": trashedAt,
              ":one": 1n,
              ":revision": file.revision,
              ":internal": file.internalProjectId,
              ":file": file.fileId,
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        return parseStoredFile(output.Attributes, file.internalProjectId);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (existing?.status === "trashed" && existing.purgeStartedAt === undefined)
          return existing;
        throw new FileStateConflictError();
      }
    },

    async restore(fileInput, nowInput) {
      const file = parseFileItem(fileInput);
      if (file.status === "ready") return file;
      if (file.status !== "trashed" || file.purgeStartedAt !== undefined) {
        throw new FileStateConflictError();
      }
      const now = z.iso.datetime({ offset: true }).parse(nowInput);
      if (new Date(now).getTime() >= new Date(file.purgeAt!).getTime()) {
        throw new FileStateConflictError();
      }
      try {
        const output = await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: file.pk, sk: file.sk },
            UpdateExpression:
              "SET #status = :ready, updatedAt = :updatedAt, revision = revision + :one REMOVE gsi2pk, gsi2sk, trashedAt, purgeAt, purgeStartedAt, objectRemovedAt",
            ConditionExpression:
              "attribute_exists(pk) AND #status = :trashed AND revision = :revision AND internalProjectId = :internal AND fileId = :file AND purgeAt > :now AND attribute_not_exists(purgeStartedAt)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":ready": "ready",
              ":trashed": "trashed",
              ":updatedAt": now,
              ":one": 1n,
              ":revision": file.revision,
              ":internal": file.internalProjectId,
              ":file": file.fileId,
              ":now": now,
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        return parseStoredFile(output.Attributes, file.internalProjectId);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (existing?.status === "ready") return existing;
        throw new FileStateConflictError();
      }
    },

    async claimPermanentRemoval(fileInput, nowInput, force) {
      const file = parseFileItem(fileInput);
      if (file.status === "trashed" && file.purgeStartedAt !== undefined) return file;
      if (
        (file.status !== "ready" && file.status !== "trashed") ||
        (!force && file.status !== "trashed")
      ) {
        throw new FileStateConflictError();
      }
      const now = z.iso.datetime({ offset: true }).parse(nowInput);
      if (!force && new Date(file.purgeAt!).getTime() > new Date(now).getTime()) {
        throw new FileStateConflictError();
      }
      const trashedAt = file.status === "trashed" ? file.trashedAt! : now;
      const purgeAt = force
        ? new Date(
            Math.max(
              new Date(now).getTime(),
              new Date(file.uploadExpiresAt).getTime() + UPLOAD_CAPABILITY_EXPIRY_SKEW_MILLISECONDS,
            ),
          ).toISOString()
        : file.purgeAt!;
      const lifecycleSortKey = trashPurgeSortKey(purgeAt, file.internalProjectId, file.fileId);
      const statusCondition = force
        ? "(#status = :ready OR #status = :trashed)"
        : "#status = :trashed AND purgeAt <= :now";
      try {
        const output = await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: file.pk, sk: file.sk },
            UpdateExpression:
              "SET #status = :trashed, trashedAt = :trashedAt, purgeAt = :purgeAt, purgeStartedAt = :now, gsi2pk = :lifecyclePk, gsi2sk = :lifecycleSk, updatedAt = :now, revision = revision + :one",
            ConditionExpression: `attribute_exists(pk) AND ${statusCondition} AND revision = :revision AND internalProjectId = :internal AND fileId = :file AND attribute_not_exists(purgeStartedAt)`,
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ...(force ? { ":ready": "ready" } : {}),
              ":trashed": "trashed",
              ":trashedAt": trashedAt,
              ":purgeAt": purgeAt,
              ":now": now,
              ":lifecyclePk": TRASH_PURGE_INDEX_PARTITION,
              ":lifecycleSk": lifecycleSortKey,
              ":one": 1n,
              ":revision": file.revision,
              ":internal": file.internalProjectId,
              ":file": file.fileId,
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        return parseStoredFile(output.Attributes, file.internalProjectId);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (existing?.status === "trashed" && existing.purgeStartedAt !== undefined)
          return existing;
        throw new FileStateConflictError();
      }
    },

    async recordObjectRemoved(fileInput, removedAtInput) {
      const file = parseFileItem(fileInput);
      if (file.status !== "trashed" || file.purgeStartedAt === undefined) {
        throw new FileStateConflictError();
      }
      if (file.objectRemovedAt !== undefined) return file;
      const removedAt = z.iso.datetime({ offset: true }).parse(removedAtInput);
      if (
        new Date(removedAt).getTime() < new Date(file.purgeStartedAt).getTime() ||
        new Date(removedAt).getTime() < new Date(file.purgeAt!).getTime()
      ) {
        throw new FileStateConflictError();
      }
      try {
        const output = await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: file.pk, sk: file.sk },
            UpdateExpression:
              "SET objectRemovedAt = :removedAt, updatedAt = :removedAt, revision = revision + :one",
            ConditionExpression:
              "attribute_exists(pk) AND #status = :trashed AND revision = :revision AND purgeStartedAt = :purgeStartedAt AND purgeAt <= :removedAt AND attribute_not_exists(objectRemovedAt)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":trashed": "trashed",
              ":removedAt": removedAt,
              ":purgeStartedAt": file.purgeStartedAt,
              ":revision": file.revision,
              ":one": 1n,
            },
            ReturnValues: "ALL_NEW",
          }),
        );
        return parseStoredFile(output.Attributes, file.internalProjectId);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (existing?.status === "trashed" && existing.objectRemovedAt !== undefined) {
          return existing;
        }
        throw new FileStateConflictError();
      }
    },

    async finalizePermanentRemoval(fileInput, nowInput) {
      const file = parseFileItem(fileInput);
      if (
        file.status !== "trashed" ||
        file.purgeStartedAt === undefined ||
        file.objectRemovedAt === undefined ||
        file.completionEvidence === undefined
      ) {
        throw new FileStateConflictError();
      }
      const now = z.iso.datetime({ offset: true }).parse(nowInput);
      const sizeBytes = file.completionEvidence.sizeBytes;
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: transactionToken("purged", `${file.fileId}:${file.purgeStartedAt}`),
            TransactItems: [
              {
                Delete: {
                  TableName: tableName,
                  Key: { pk: file.pk, sk: file.sk },
                  ConditionExpression:
                    "attribute_exists(pk) AND #status = :trashed AND revision = :revision AND internalProjectId = :internal AND fileId = :file AND purgeStartedAt = :purgeStartedAt AND objectRemovedAt = :objectRemovedAt",
                  ExpressionAttributeNames: { "#status": "status" },
                  ExpressionAttributeValues: {
                    ":trashed": "trashed",
                    ":revision": file.revision,
                    ":internal": file.internalProjectId,
                    ":file": file.fileId,
                    ":purgeStartedAt": file.purgeStartedAt,
                    ":objectRemovedAt": file.objectRemovedAt,
                  },
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: file.pk, sk: QUOTA_SORT_KEY },
                  UpdateExpression:
                    "SET retainedBytes = retainedBytes - :size, accountedBytes = accountedBytes - :size, revision = revision + :one, updatedAt = :updatedAt",
                  ConditionExpression:
                    "attribute_exists(pk) AND itemType = :quotaType AND internalProjectId = :internal AND retainedBytes >= :size AND accountedBytes >= :size",
                  ExpressionAttributeValues: {
                    ":size": sizeBytes,
                    ":one": 1n,
                    ":updatedAt": now,
                    ":quotaType": "file-quota",
                    ":internal": file.internalProjectId,
                  },
                },
              },
            ],
          }),
        );
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await get(file.internalProjectId, file.fileId);
        if (!existing) return;
        throw new FileStateConflictError();
      }
    },

    async listDuePurge(dueThrough, limit, startKey) {
      const through = z.iso.datetime({ offset: true }).parse(dueThrough);
      const boundedLimit = z.number().int().min(1).max(100).parse(limit);
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: lifecycleIndexName,
          KeyConditionExpression: "gsi2pk = :trash AND gsi2sk <= :through",
          ExpressionAttributeValues: {
            ":trash": TRASH_PURGE_INDEX_PARTITION,
            ":through": `${through}#\uffff`,
          },
          ScanIndexForward: true,
          Limit: boundedLimit,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
      const items = z
        .array(z.unknown())
        .parse(output.Items ?? [])
        .map((item) => {
          try {
            return parseFileItem(item);
          } catch {
            throw new CorruptFileRecordError();
          }
        });
      return {
        items,
        ...(output.LastEvaluatedKey ? { nextStartKey: output.LastEvaluatedKey } : {}),
      };
    },
  };
}
