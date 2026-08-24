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

import {
  USAGE_DOCUMENT_CLIENT_OPTIONS,
  addDynamoIntegers,
  assertDynamoInteger,
} from "./fixed-point.js";
import {
  CHECKPOINT_SORT_KEY,
  DEDUPE_SORT_KEY,
  DOWNLOAD_EVIDENCE_SORT_KEY,
  DOWNLOAD_QUARANTINE_SORT_KEY,
  PRICE_PARTITION_KEY,
  TOTAL_AGGREGATE_SORT_KEY,
  downloadEvidencePartitionKey,
  downloadQuarantinePartitionKey,
  metricAggregateSortKey,
  parseDedupeItem,
  parseDownloadMeteringQuarantineItem,
  parseMetricAggregateItem,
  parsePriceVersionItem,
  parseProcessedDownloadEvidenceItem,
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
  type DownloadMeteringQuarantineItem,
  type MetricAggregateItem,
  type QuarantineItem,
  type ProcessedDownloadEvidenceItem,
  type StorageCheckpointItem,
  type TotalAggregateItem,
  type UsageEventItem,
  type WatermarkItem,
} from "./model.js";

export type AggregateItem = MetricAggregateItem | TotalAggregateItem;
export type RecordEventResult =
  { status: "recorded" } | { status: "duplicate"; event: UsageEventItem };
export type ObserveDownloadEvidenceResult = {
  readonly status: "observed" | "duplicate";
  readonly evidence: ProcessedDownloadEvidenceItem;
};
export type RecordDownloadEventResult = {
  readonly status: "recorded" | "duplicate";
  readonly evidence: ProcessedDownloadEvidenceItem;
  readonly events: readonly [UsageEventItem, UsageEventItem, UsageEventItem];
};
export type PutDownloadQuarantineResult = { readonly status: "recorded" | "duplicate" };

export interface UsagePricingRepository {
  listPriceVersions(): Promise<PriceVersion[]>;
  findEffectivePrice(occurredAt: string): Promise<PriceVersion | undefined>;
  recordEvent(event: UsageEventItem, dedupe: DedupeItem, now: string): Promise<RecordEventResult>;
  getDownloadEvidence?(
    eventDigest: string,
    now: string,
  ): Promise<ProcessedDownloadEvidenceItem | undefined>;
  observeDownloadEvidence?(
    evidence: ProcessedDownloadEvidenceItem,
    now: string,
  ): Promise<ObserveDownloadEvidenceResult>;
  recordDownloadEvent?(
    evidence: ProcessedDownloadEvidenceItem,
    events: readonly [UsageEventItem, UsageEventItem, UsageEventItem],
    now: string,
  ): Promise<RecordDownloadEventResult>;
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
  putDownloadQuarantine?(
    item: DownloadMeteringQuarantineItem,
    now: string,
  ): Promise<PutDownloadQuarantineResult>;
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

function parseDownloadEvidence(input: unknown): ProcessedDownloadEvidenceItem {
  try {
    const item = parseProcessedDownloadEvidenceItem(input);
    if (!item) throw new Error("Evidence unexpectedly expired without a reference time");
    return item;
  } catch {
    throw new CorruptUsageRecordError();
  }
}

function parseDownloadQuarantine(input: unknown): DownloadMeteringQuarantineItem {
  try {
    const item = parseDownloadMeteringQuarantineItem(input);
    if (!item) throw new Error("Quarantine unexpectedly expired without a reference time");
    return item;
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

function downloadClientToken(evidence: ProcessedDownloadEvidenceItem): string {
  return `download-${evidence.fingerprint.slice(0, 27)}`;
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

  async function getDownloadEvidenceRaw(
    eventDigest: string,
  ): Promise<ProcessedDownloadEvidenceItem | undefined> {
    const output = await options.client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: downloadEvidencePartitionKey(eventDigest), sk: DOWNLOAD_EVIDENCE_SORT_KEY },
        ConsistentRead: true,
      }),
    );
    if (!output.Item) return undefined;
    try {
      return parseProcessedDownloadEvidenceItem(output.Item);
    } catch {
      throw new CorruptUsageRecordError();
    }
  }

  async function getDownloadEvidence(
    eventDigest: string,
    now: string,
  ): Promise<ProcessedDownloadEvidenceItem | undefined> {
    const evidence = await getDownloadEvidenceRaw(eventDigest);
    return evidence && evidence.expiresAt > Math.floor(new Date(now).getTime() / 1_000)
      ? evidence
      : undefined;
  }

  async function readExistingDownload(
    evidence: ProcessedDownloadEvidenceItem,
    events: readonly [UsageEventItem, UsageEventItem, UsageEventItem],
  ): Promise<RecordDownloadEventResult> {
    const output = await options.client.send(
      new TransactGetCommand({
        TransactItems: [
          { Get: { TableName: tableName, Key: { pk: evidence.pk, sk: evidence.sk } } },
          ...events.map((event) => ({
            Get: { TableName: tableName, Key: { pk: event.pk, sk: event.sk } },
          })),
        ],
      }),
    );
    const existingEvidenceRaw = output.Responses?.[0]?.Item;
    const existingEventsRaw = output.Responses?.slice(1).map((response) => response.Item);
    const existingEvidence = existingEvidenceRaw
      ? parseDownloadEvidence(existingEvidenceRaw)
      : undefined;
    const existingEvents = existingEventsRaw?.map((item) => (item ? parseEvent(item) : undefined));
    if (existingEvidence && existingEvidence.fingerprint !== evidence.fingerprint) {
      throw new UsageSourceConflictError();
    }
    if (
      existingEvents?.some(
        (event, index) =>
          event !== undefined && event.inputFingerprint !== events[index]?.inputFingerprint,
      )
    ) {
      throw new UsageSourceConflictError();
    }
    if (
      existingEvents?.length === events.length &&
      existingEvents.every((event) => event !== undefined) &&
      (!existingEvidence || existingEvidence.pricingStatus === "priced")
    ) {
      return {
        status: "duplicate",
        evidence: existingEvidence ?? evidence,
        events: existingEvents as [UsageEventItem, UsageEventItem, UsageEventItem],
      };
    }
    throw new UsageRepositoryConflictError();
  }

  async function readWatermark(
    internalProjectId: string,
    sourceKind: string,
  ): Promise<WatermarkItem | undefined> {
    const output = await options.client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: projectPartitionKey(internalProjectId), sk: watermarkSortKey(sourceKind) },
        ConsistentRead: true,
      }),
    );
    if (!output.Item) return undefined;
    try {
      return parseWatermarkItem(output.Item);
    } catch {
      throw new CorruptUsageRecordError();
    }
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

    getDownloadEvidence,

    async observeDownloadEvidence(evidenceInput) {
      const evidence = parseDownloadEvidence(evidenceInput);
      if (evidence.pricingStatus !== "observed-unpriced") throw new CorruptUsageRecordError();
      try {
        await options.client.send(
          new PutCommand({
            TableName: tableName,
            Item: evidence,
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
        return { status: "observed", evidence };
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        // DynamoDB TTL deletion is asynchronous. A physically present matching root remains a
        // duplicate even after its logical expiry, rather than becoming a transient conflict.
        const existing = await getDownloadEvidenceRaw(evidence.eventDigest);
        if (existing?.fingerprint === evidence.fingerprint) {
          return { status: "duplicate", evidence: existing };
        }
        if (existing) throw new UsageSourceConflictError();
        throw new UsageRepositoryConflictError();
      }
    },

    async recordDownloadEvent(evidenceInput, eventsInput, now) {
      const evidence = parseDownloadEvidence(evidenceInput);
      const events = eventsInput.map(parseEvent) as [
        UsageEventItem,
        UsageEventItem,
        UsageEventItem,
      ];
      const expectedMetrics = new Set([
        "s3-download-requests",
        "s3-download-bytes-out",
        "cloudtrail-s3-data-events",
      ]);
      if (
        evidence.pricingStatus !== "priced" ||
        events.length !== 3 ||
        new Set(events.map((event) => event.metric)).size !== 3 ||
        events.some(
          (event) =>
            !expectedMetrics.has(event.metric) ||
            event.internalProjectId !== evidence.internalProjectId ||
            event.occurredAt !== evidence.occurredAt ||
            event.pk !== projectMonthPartitionKey(evidence.internalProjectId, event.period),
        )
      ) {
        throw new CorruptUsageRecordError();
      }
      const existing = await getDownloadEvidence(evidence.eventDigest, now);
      if (existing?.fingerprint !== undefined && existing.fingerprint !== evidence.fingerprint) {
        throw new UsageSourceConflictError();
      }
      if (existing?.pricingStatus === "priced") return readExistingDownload(evidence, events);

      const rootAction = existing
        ? {
            Update: {
              TableName: tableName,
              Key: { pk: evidence.pk, sk: evidence.sk },
              UpdateExpression: "SET pricingStatus = :priced",
              ConditionExpression:
                "itemType = :type AND fingerprint = :fingerprint AND pricingStatus = :observed",
              ExpressionAttributeValues: {
                ":priced": "priced",
                ":observed": "observed-unpriced",
                ":type": "processed-download-evidence",
                ":fingerprint": evidence.fingerprint,
              },
            },
          }
        : {
            Put: {
              TableName: tableName,
              Item: evidence,
              ConditionExpression: "attribute_not_exists(pk)",
            },
          };
      const totalCost = addDynamoIntegers(...events.map((event) => event.costAtoms));
      try {
        await options.client.send(
          new TransactWriteCommand({
            ClientRequestToken: downloadClientToken(evidence),
            TransactItems: [
              rootAction,
              ...events.map((event) => ({
                Put: {
                  TableName: tableName,
                  Item: event,
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              })),
              ...events.map((event) => ({
                Update: {
                  TableName: tableName,
                  Key: { pk: event.pk, sk: metricAggregateSortKey(event.metric) },
                  UpdateExpression:
                    "SET itemType = if_not_exists(itemType, :metricType), internalProjectId = if_not_exists(internalProjectId, :internal), #period = if_not_exists(#period, :period), metric = if_not_exists(metric, :metric) ADD quantityAtoms :quantity, costAtoms :cost, revision :one, priceVersionIds :versions",
                  ConditionExpression:
                    "attribute_not_exists(pk) OR (itemType = :metricType AND internalProjectId = :internal AND #period = :period AND metric = :metric)",
                  ExpressionAttributeNames: { "#period": "period" },
                  ExpressionAttributeValues: {
                    ":metricType": "usage-aggregate-metric",
                    ":internal": event.internalProjectId,
                    ":period": event.period,
                    ":metric": event.metric,
                    ":one": 1n,
                    ":quantity": event.quantityAtoms,
                    ":cost": event.costAtoms,
                    ":versions": new Set([event.priceVersionId]),
                  },
                },
              })),
              {
                Update: {
                  TableName: tableName,
                  Key: { pk: events[0].pk, sk: TOTAL_AGGREGATE_SORT_KEY },
                  UpdateExpression:
                    "SET itemType = if_not_exists(itemType, :totalType), internalProjectId = if_not_exists(internalProjectId, :internal), #period = if_not_exists(#period, :period) ADD costAtoms :cost, revision :revision, priceVersionIds :versions",
                  ConditionExpression:
                    "attribute_not_exists(pk) OR (itemType = :totalType AND internalProjectId = :internal AND #period = :period)",
                  ExpressionAttributeNames: { "#period": "period" },
                  ExpressionAttributeValues: {
                    ":totalType": "usage-aggregate-total",
                    ":internal": evidence.internalProjectId,
                    ":period": events[0].period,
                    ":cost": totalCost,
                    ":revision": 3n,
                    ":versions": new Set(events.map((event) => event.priceVersionId)),
                  },
                },
              },
            ],
          }),
        );
        return { status: "recorded", evidence, events };
      } catch (error) {
        const reasons = cancellationReasons(error);
        if (reasons?.slice(0, 4).some((reason) => reason.Code === "ConditionalCheckFailed")) {
          return readExistingDownload(evidence, events);
        }
        if (
          isConditionalFailure(error) ||
          reasons?.some((reason) => reason.Code === "TransactionConflict")
        ) {
          throw new UsageRepositoryConflictError();
        }
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
      try {
        await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: projectPartitionKey(internalProjectId), sk: watermarkSortKey(sourceKind) },
            UpdateExpression:
              "SET itemType = :type, internalProjectId = :internal, sourceKind = :source, lastMeteredAt = :meteredAt, incompleteSince = if_not_exists(incompleteSince, :complete)",
            ConditionExpression:
              "attribute_not_exists(lastMeteredAt) OR lastMeteredAt < :meteredAt",
            ExpressionAttributeValues: {
              ":type": "usage-watermark",
              ":internal": internalProjectId,
              ":source": sourceKind,
              ":meteredAt": meteredAt,
              ":complete": null,
            },
          }),
        );
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await readWatermark(internalProjectId, sourceKind);
        if (existing && existing.lastMeteredAt >= meteredAt) return;
        throw new UsageRepositoryConflictError();
      }
    },

    async markWatermarkIncomplete(internalProjectId, sourceKind, observedAt) {
      try {
        await options.client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: projectPartitionKey(internalProjectId), sk: watermarkSortKey(sourceKind) },
            UpdateExpression:
              "SET itemType = :type, internalProjectId = :internal, sourceKind = :source, lastMeteredAt = if_not_exists(lastMeteredAt, :observed), incompleteSince = :observed",
            ConditionExpression:
              "attribute_not_exists(incompleteSince) OR incompleteSince = :complete OR :observed < incompleteSince",
            ExpressionAttributeValues: {
              ":type": "usage-watermark",
              ":internal": internalProjectId,
              ":source": sourceKind,
              ":observed": observedAt,
              ":complete": null,
            },
          }),
        );
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const existing = await readWatermark(internalProjectId, sourceKind);
        if (existing?.incompleteSince && existing.incompleteSince <= observedAt) return;
        throw new UsageRepositoryConflictError();
      }
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

    async putDownloadQuarantine(itemInput) {
      const item = parseDownloadQuarantine(itemInput);
      try {
        await options.client.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
        return { status: "recorded" };
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const output = await options.client.send(
          new GetCommand({
            TableName: tableName,
            Key: {
              pk: downloadQuarantinePartitionKey(item.evidenceHash),
              sk: DOWNLOAD_QUARANTINE_SORT_KEY,
            },
            ConsistentRead: true,
          }),
        );
        if (!output.Item) throw new UsageRepositoryConflictError();
        // Treat a matching physical record as a duplicate while DynamoDB TTL catches up.
        const existing = parseDownloadMeteringQuarantineItem(output.Item);
        if (!existing) throw new UsageRepositoryConflictError();
        if (
          existing.evidenceHash === item.evidenceHash &&
          existing.reasonCode === item.reasonCode &&
          existing.internalProjectId === item.internalProjectId
        ) {
          return { status: "duplicate" };
        }
        throw new UsageSourceConflictError();
      }
    },
  };
}
