import type {
  GetCommandOutput,
  PutCommandOutput,
  QueryCommandOutput,
  TransactGetCommandOutput,
  TransactWriteCommandOutput,
  UpdateCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { PriceVersion } from "@utility-services/contracts";
import { z } from "zod";

import { USAGE_DOCUMENT_CLIENT_OPTIONS, assertDynamoInteger } from "./fixed-point.js";
import {
  CHECKPOINT_SORT_KEY,
  DEDUPE_SORT_KEY,
  PRICE_PARTITION_KEY,
  TOTAL_AGGREGATE_SORT_KEY,
  metricAggregateSortKey,
  parseDedupeItem,
  parseMetricAggregateItem,
  parsePriceVersionItem,
  parseStorageCheckpointItem,
  parseTotalAggregateItem,
  parseUsageEventItem,
  parseWatermarkItem,
  priceVersionSortKey,
  projectMonthPartitionKey,
  projectPartitionKey,
  storagePartitionKey,
  watermarkSortKey,
  type DedupeItem,
  type MetricAggregateItem,
  type QuarantineItem,
  type StorageCheckpointItem,
  type TotalAggregateItem,
  type UsageEventItem,
  type WatermarkItem,
} from "./model.js";

export type AggregateItem = MetricAggregateItem | TotalAggregateItem;
export type RecordEventResult =
  { status: "recorded" } | { status: "duplicate"; event: UsageEventItem };

export interface UsagePricingRepository {
  listPriceVersions(): Promise<PriceVersion[]>;
  findEffectivePrice(occurredAt: string): Promise<PriceVersion | undefined>;
  recordEvent(event: UsageEventItem, dedupe: DedupeItem, now: string): Promise<RecordEventResult>;
  listEvents(internalProjectId: string, period: string): Promise<UsageEventItem[]>;
  getAggregates(internalProjectId: string, period: string): Promise<AggregateItem[]>;
  replaceAggregates(
    items: AggregateItem[],
    expectedRevisions: ReadonlyMap<string, bigint | undefined>,
  ): Promise<void>;
  getCheckpoint(
    internalProjectId: string,
    subjectDigest: string,
  ): Promise<StorageCheckpointItem | undefined>;
  createCheckpoint(item: StorageCheckpointItem): Promise<void>;
  replaceCheckpoint(item: StorageCheckpointItem, expectedRevision: bigint): Promise<void>;
  listWatermarks(internalProjectId: string): Promise<WatermarkItem[]>;
  advanceWatermark(internalProjectId: string, sourceKind: string, meteredAt: string): Promise<void>;
  markWatermarkIncomplete(
    internalProjectId: string,
    sourceKind: string,
    observedAt: string,
  ): Promise<void>;
  putQuarantine(item: QuarantineItem): Promise<void>;
}

export interface UsageDocumentClient {
  send(command: GetCommand): Promise<GetCommandOutput>;
  send(command: PutCommand): Promise<PutCommandOutput>;
  send(command: QueryCommand): Promise<QueryCommandOutput>;
  send(command: TransactGetCommand): Promise<TransactGetCommandOutput>;
  send(command: TransactWriteCommand): Promise<TransactWriteCommandOutput>;
  send(command: UpdateCommand): Promise<UpdateCommandOutput>;
}

export class CorruptUsageRecordError extends Error {
  public constructor() {
    super("Stored usage/pricing record is invalid");
    this.name = "CorruptUsageRecordError";
  }
}
export class UsageSourceConflictError extends Error {
  public constructor() {
    super("Usage source identity was reused with different evidence");
    this.name = "UsageSourceConflictError";
  }
}
export class UsageRepositoryConflictError extends Error {
  public constructor() {
    super("Usage repository state changed; retry safely");
    this.name = "UsageRepositoryConflictError";
  }
}
export class UsageProjectionConflictError extends Error {
  public constructor() {
    super("Usage projection changed during rebuild");
    this.name = "UsageProjectionConflictError";
  }
}
export class UsageCheckpointConflictError extends Error {
  public constructor() {
    super("Storage checkpoint changed");
    this.name = "UsageCheckpointConflictError";
  }
}

export function usageDocumentClientOptions() {
  return USAGE_DOCUMENT_CLIENT_OPTIONS;
}

function cancellationReasons(error: unknown): ReadonlyArray<{ Code?: string }> | undefined {
  if (
    error === null ||
    typeof error !== "object" ||
    !("name" in error) ||
    error.name !== "TransactionCanceledException" ||
    !("CancellationReasons" in error) ||
    !Array.isArray(error.CancellationReasons)
  )
    return undefined;
  return error.CancellationReasons as ReadonlyArray<{ Code?: string }>;
}

function isConditionalFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error.name === "ConditionalCheckFailedException" ||
      error.name === "TransactionCanceledException")
  );
}

function parsePrice(input: unknown): PriceVersion {
  try {
    const item = parsePriceVersionItem(input);
    return {
      versionId: item.versionId,
      effectiveAt: item.effectiveAt,
      publishedAt: item.publishedAt,
      currency: item.currency,
      productRegion: item.productRegion,
      rates: item.rates,
      sources: item.sources,
    };
  } catch {
    throw new CorruptUsageRecordError();
  }
}

function parseEvent(input: unknown): UsageEventItem {
  try {
    return parseUsageEventItem(input);
  } catch {
    throw new CorruptUsageRecordError();
  }
}
function parseAggregate(input: unknown): AggregateItem {
  try {
    if (
      typeof input === "object" &&
      input !== null &&
      "itemType" in input &&
      input.itemType === "usage-aggregate-metric"
    )
      return parseMetricAggregateItem(input);
    return parseTotalAggregateItem(input);
  } catch {
    throw new CorruptUsageRecordError();
  }
}

async function queryAll(
  client: UsageDocumentClient,
  input: ConstructorParameters<typeof QueryCommand>[0],
): Promise<unknown[]> {
  const items: unknown[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const output = await client.send(
      new QueryCommand({
        ...input,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    items.push(...z.array(z.unknown()).parse(output.Items ?? []));
    exclusiveStartKey = output.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

function clientToken(event: UsageEventItem): string {
  return `usage-${event.inputFingerprint.slice(0, 30)}`;
}

export function createDynamoUsagePricingRepository(options: {
  client: UsageDocumentClient;
  tableName: string;
}): UsagePricingRepository {
  const tableName = z.string().trim().min(1).parse(options.tableName);

  async function readExistingEvidence(
    event: UsageEventItem,
    dedupe: DedupeItem,
    now: string,
  ): Promise<RecordEventResult> {
    const output = await options.client.send(
      new TransactGetCommand({
        TransactItems: [
          { Get: { TableName: tableName, Key: { pk: dedupe.pk, sk: DEDUPE_SORT_KEY } } },
          { Get: { TableName: tableName, Key: { pk: event.pk, sk: event.sk } } },
        ],
      }),
    );
    const dedupeRaw = output.Responses?.[0]?.Item;
    const eventRaw = output.Responses?.[1]?.Item;
    let existingDedupe: DedupeItem | undefined;
    try {
      existingDedupe = dedupeRaw ? parseDedupeItem(dedupeRaw, now) : undefined;
    } catch {
      throw new CorruptUsageRecordError();
    }
    const existingEvent = eventRaw ? parseEvent(eventRaw) : undefined;
    const fingerprint = existingEvent?.inputFingerprint ?? existingDedupe?.inputFingerprint;
    if (fingerprint === event.inputFingerprint && existingEvent)
      return { status: "duplicate", event: existingEvent };
    if (fingerprint !== undefined && fingerprint !== event.inputFingerprint)
      throw new UsageSourceConflictError();
    throw new UsageRepositoryConflictError();
  }

  return {
    async listPriceVersions() {
      const items = await queryAll(options.client, {
        TableName: tableName,
        KeyConditionExpression: "pk = :pricing AND begins_with(sk, :version)",
        ExpressionAttributeValues: { ":pricing": PRICE_PARTITION_KEY, ":version": "VERSION#" },
        ConsistentRead: true,
        ScanIndexForward: true,
      });
      return items.map(parsePrice);
    },

    async findEffectivePrice(occurredAt) {
      const output = await options.client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pricing AND sk <= :upper",
          ExpressionAttributeValues: {
            ":pricing": PRICE_PARTITION_KEY,
            ":upper": priceVersionSortKey(occurredAt),
          },
          ConsistentRead: true,
          ScanIndexForward: false,
          Limit: 1,
        }),
      );
      const item = output.Items?.[0];
      return item ? parsePrice(item) : undefined;
    },

    async recordEvent(eventInput, dedupeInput, now) {
      const event = parseEvent(eventInput);
      const dedupe = parseDedupeItem(dedupeInput);
      if (
        !dedupe ||
        dedupe.eventPk !== event.pk ||
        dedupe.eventSk !== event.sk ||
        dedupe.inputFingerprint !== event.inputFingerprint ||
        dedupe.sourceDigest !== event.sourceDigest
      )
        throw new CorruptUsageRecordError();
      assertDynamoInteger(event.quantityAtoms);
      assertDynamoInteger(event.costAtoms);
      const metricValues = {
        ":metricType": "usage-aggregate-metric",
        ":internal": event.internalProjectId,
        ":period": event.period,
        ":metric": event.metric,
        ":one": 1n,
        ":quantity": event.quantityAtoms,
        ":cost": event.costAtoms,
        ":versions": new Set([event.priceVersionId]),
      };
      const totalValues = {
        ":totalType": "usage-aggregate-total",
        ":internal": event.internalProjectId,
        ":period": event.period,
        ":one": 1n,
        ":cost": event.costAtoms,
        ":versions": new Set([event.priceVersionId]),
      };
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: clientToken(event),
            TransactItems: [
              {
                Put: {
                  TableName: tableName,
                  Item: dedupe,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: event,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: event.pk, sk: metricAggregateSortKey(event.metric) },
                  UpdateExpression:
                    "SET itemType = if_not_exists(itemType, :metricType), internalProjectId = if_not_exists(internalProjectId, :internal), #period = if_not_exists(#period, :period), metric = if_not_exists(metric, :metric) ADD quantityAtoms :quantity, costAtoms :cost, revision :one, priceVersionIds :versions",
                  ConditionExpression:
                    "attribute_not_exists(pk) OR (itemType = :metricType AND internalProjectId = :internal AND #period = :period AND metric = :metric)",
                  ExpressionAttributeNames: { "#period": "period" },
                  ExpressionAttributeValues: metricValues,
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: event.pk, sk: TOTAL_AGGREGATE_SORT_KEY },
                  UpdateExpression:
                    "SET itemType = if_not_exists(itemType, :totalType), internalProjectId = if_not_exists(internalProjectId, :internal), #period = if_not_exists(#period, :period) ADD costAtoms :cost, revision :one, priceVersionIds :versions",
                  ConditionExpression:
                    "attribute_not_exists(pk) OR (itemType = :totalType AND internalProjectId = :internal AND #period = :period)",
                  ExpressionAttributeNames: { "#period": "period" },
                  ExpressionAttributeValues: totalValues,
                },
              },
            ],
          }),
        );
        return { status: "recorded" };
      } catch (error) {
        const reasons = cancellationReasons(error);
        if (reasons?.slice(0, 2).some((reason) => reason.Code === "ConditionalCheckFailed"))
          return readExistingEvidence(event, dedupe, now);
        if (
          isConditionalFailure(error) ||
          reasons?.some((reason) => reason.Code === "TransactionConflict")
        )
          throw new UsageRepositoryConflictError();
        throw error;
      }
    },

    async listEvents(internalProjectId, period) {
      const items = await queryAll(options.client, {
        TableName: tableName,
        KeyConditionExpression: "pk = :projectMonth AND begins_with(sk, :event)",
        ExpressionAttributeValues: {
          ":projectMonth": projectMonthPartitionKey(internalProjectId, period),
          ":event": "EVENT#",
        },
        ConsistentRead: true,
        ScanIndexForward: true,
      });
      return items.map(parseEvent);
    },

    async getAggregates(internalProjectId, period) {
      const items = await queryAll(options.client, {
        TableName: tableName,
        KeyConditionExpression: "pk = :projectMonth AND begins_with(sk, :aggregate)",
        ExpressionAttributeValues: {
          ":projectMonth": projectMonthPartitionKey(internalProjectId, period),
          ":aggregate": "AGGREGATE#",
        },
        ConsistentRead: true,
        ScanIndexForward: true,
        Limit: 10,
      });
      return items.map(parseAggregate);
    },

    async replaceAggregates(itemsInput, expectedRevisions) {
      const items = itemsInput.map(parseAggregate);
      if (items.length === 0 || items.length > 10)
        throw new RangeError("Aggregate replacement must be bounded");
      try {
        await options.client.send(
          new TransactWriteCommand({
            TransactItems: items.map((item) => {
              const expected = expectedRevisions.get(item.sk);
              return {
                Put: {
                  TableName: tableName,
                  Item: item,
                  ConditionExpression:
                    expected === undefined ? "attribute_not_exists(pk)" : "revision = :expected",
                  ...(expected === undefined
                    ? {}
                    : { ExpressionAttributeValues: { ":expected": expected } }),
                },
              };
            }),
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) throw new UsageProjectionConflictError();
        throw error;
      }
    },

    async getCheckpoint(internalProjectId, subjectDigest) {
      const output = await options.client.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            pk: storagePartitionKey(internalProjectId, subjectDigest),
            sk: CHECKPOINT_SORT_KEY,
          },
          ConsistentRead: true,
        }),
      );
      if (!output.Item) return undefined;
      try {
        return parseStorageCheckpointItem(output.Item);
      } catch {
        throw new CorruptUsageRecordError();
      }
    },

    async createCheckpoint(itemInput) {
      const item = parseStorageCheckpointItem(itemInput);
      try {
        await options.client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) throw new UsageCheckpointConflictError();
        throw error;
      }
    },

    async replaceCheckpoint(itemInput, expectedRevision) {
      const item = parseStorageCheckpointItem(itemInput);
      assertDynamoInteger(expectedRevision);
      try {
        await options.client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: "revision = :expected AND itemType = :type AND byteSize = :bytes",
            ExpressionAttributeValues: {
              ":expected": expectedRevision,
              ":type": "storage-checkpoint",
              ":bytes": item.byteSize,
            },
          }),
        );
      } catch (error) {
        if (isConditionalFailure(error)) throw new UsageCheckpointConflictError();
        throw error;
      }
    },

    async listWatermarks(internalProjectId) {
      const items = await queryAll(options.client, {
        TableName: tableName,
        KeyConditionExpression: "pk = :project AND begins_with(sk, :watermark)",
        ExpressionAttributeValues: {
          ":project": projectPartitionKey(internalProjectId),
          ":watermark": "WATERMARK#",
        },
        ConsistentRead: true,
        Limit: 20,
      });
      return items.map((item) => {
        try {
          return parseWatermarkItem(item);
        } catch {
          throw new CorruptUsageRecordError();
        }
      });
    },

    async advanceWatermark(internalProjectId, sourceKind, meteredAt) {
      await options.client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: projectPartitionKey(internalProjectId), sk: watermarkSortKey(sourceKind) },
          UpdateExpression:
            "SET itemType = :type, internalProjectId = :internal, sourceKind = :source, lastMeteredAt = :meteredAt, incompleteSince = :complete",
          ConditionExpression: "attribute_not_exists(lastMeteredAt) OR lastMeteredAt <= :meteredAt",
          ExpressionAttributeValues: {
            ":type": "usage-watermark",
            ":internal": internalProjectId,
            ":source": sourceKind,
            ":meteredAt": meteredAt,
            ":complete": null,
          },
        }),
      );
    },

    async markWatermarkIncomplete(internalProjectId, sourceKind, observedAt) {
      await options.client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: projectPartitionKey(internalProjectId), sk: watermarkSortKey(sourceKind) },
          UpdateExpression:
            "SET itemType = :type, internalProjectId = :internal, sourceKind = :source, lastMeteredAt = if_not_exists(lastMeteredAt, :observed), incompleteSince = if_not_exists(incompleteSince, :observed)",
          ExpressionAttributeValues: {
            ":type": "usage-watermark",
            ":internal": internalProjectId,
            ":source": sourceKind,
            ":observed": observedAt,
          },
        }),
      );
    },

    async putQuarantine(item) {
      await options.client.send(
        new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
    },
  };
}
