import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { USAGE_METRICS, type PriceVersion } from "@utility-services/contracts";
import { describe, expect, it } from "vitest";

import {
  DEDUPE_SORT_KEY,
  DOWNLOAD_EVIDENCE_SORT_KEY,
  DOWNLOAD_QUARANTINE_SORT_KEY,
  TOTAL_AGGREGATE_SORT_KEY,
  dedupePartitionKey,
  downloadEvidencePartitionKey,
  downloadMetricSourceDigest,
  downloadQuarantinePartitionKey,
  inputFingerprint,
  ledgerExpiry,
  metricAggregateSortKey,
  projectMonthPartitionKey,
  retentionExpiry,
  sourceDigest,
  usageEventSortKey,
  type DedupeItem,
  type DownloadMeteringQuarantineItem,
  type MetricAggregateItem,
  type ProcessedDownloadEvidenceItem,
  type StorageCheckpointItem,
  type TotalAggregateItem,
  type UsageEventItem,
} from "./model.js";
import {
  UsageCheckpointConflictError,
  UsageProjectionConflictError,
  UsageRepositoryConflictError,
  UsageSourceConflictError,
  createDynamoUsagePricingRepository,
  type UsageDocumentClient,
} from "./repository.js";

class StubClient {
  public readonly commands: unknown[] = [];
  public constructor(private readonly responses: unknown[]) {}
  public send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    const response = this.responses.shift();
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response ?? {});
  }
}

const projectId = "11111111-1111-4111-8111-111111111111";
const occurredAt = "2026-08-15T12:00:00.000Z";
const rate = {
  metric: "s3-upload-requests" as const,
  serviceCode: "AmazonS3" as const,
  productFamily: "API Request",
  sku: "Q2RMUYRD6HY2B5CD",
  rateCode: "Q2RMUYRD6HY2B5CD.JRTCKXETXF.6YS6EN2CT7",
  unit: "Requests" as const,
  unitQuantity: "1000",
  beginRange: "0",
  endRange: "Inf" as const,
  usdPerUnit: "0.0055",
  sourcePricePerUnitUsd: "0.0000055000",
  effectiveAt: "2026-08-01T00:00:00.000Z",
  description: "published rate",
};

function priceVersion(): PriceVersion {
  return {
    versionId: "v1",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    publishedAt: "2026-08-18T18:11:13.000Z",
    currency: "USD",
    productRegion: "il-central-1",
    rates: USAGE_METRICS.map((metric) => ({
      ...rate,
      metric,
      unit: metric.includes("storage")
        ? "GB-Mo"
        : metric.includes("bytes")
          ? "GB"
          : metric.includes("events")
            ? "Events"
            : "Requests",
    })),
    sources: [
      {
        url: "https://example.com",
        publicationDate: "2026-08-18T18:11:13.000Z",
        version: "20260818181113",
        sha256: "a".repeat(64),
      },
    ],
  };
}

function priceItem() {
  const value = priceVersion();
  return {
    ...value,
    pk: "PRICING",
    sk: `VERSION#${value.effectiveAt}#${value.versionId}`,
    itemType: "price-version",
  };
}

function ledger(): { event: UsageEventItem; dedupe: DedupeItem } {
  const digest = sourceDigest(projectId, "s3-event", "source-1");
  const fingerprint = inputFingerprint({
    internalProjectId: projectId,
    metric: "s3-upload-requests",
    quantityAtoms: 1n,
    sourceKind: "s3-event",
    sourceId: "source-1",
    occurredAt,
  });
  const event: UsageEventItem = {
    pk: projectMonthPartitionKey(projectId, "2026-08"),
    sk: usageEventSortKey(occurredAt, digest),
    itemType: "usage-event",
    internalProjectId: projectId,
    period: "2026-08",
    metric: "s3-upload-requests",
    quantityAtoms: 1n,
    occurredAt,
    sourceKind: "s3-event",
    sourceDigest: digest,
    inputFingerprint: fingerprint,
    priceVersionId: "v1",
    priceEffectiveAt: rate.effectiveAt,
    rate,
    costAtoms: 5_500_000_000_000n,
    createdAt: occurredAt,
    expiresAt: ledgerExpiry(occurredAt),
  };
  const dedupe: DedupeItem = {
    pk: dedupePartitionKey(digest),
    sk: DEDUPE_SORT_KEY,
    itemType: "usage-dedupe",
    sourceDigest: digest,
    inputFingerprint: fingerprint,
    eventPk: event.pk,
    eventSk: event.sk,
    createdAt: occurredAt,
    expiresAt: retentionExpiry(occurredAt, 90),
  };
  return { event, dedupe };
}

function repository(client: StubClient) {
  return createDynamoUsagePricingRepository({
    client: client as unknown as UsageDocumentClient,
    tableName: "usage-table",
  });
}

const downloadEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const downloadEventDigestValue = "e".repeat(64);

function downloadLedger(status: "observed-unpriced" | "priced" = "priced"): {
  evidence: ProcessedDownloadEvidenceItem;
  events: [UsageEventItem, UsageEventItem, UsageEventItem];
} {
  const evidence: ProcessedDownloadEvidenceItem = {
    pk: downloadEvidencePartitionKey(downloadEventDigestValue),
    sk: DOWNLOAD_EVIDENCE_SORT_KEY,
    itemType: "processed-download-evidence",
    eventDigest: downloadEventDigestValue,
    fingerprint: "f".repeat(64),
    internalProjectId: projectId,
    fileDigest: "a".repeat(64),
    occurredAt,
    observedAt: occurredAt,
    bytesTransferredOut: 42n,
    pricingStatus: status,
    expiresAt: retentionExpiry(occurredAt, 90),
  };
  const metrics = [
    ["s3-download-requests", 1n],
    ["s3-download-bytes-out", 42n],
    ["cloudtrail-s3-data-events", 1n],
  ] as const;
  const version = priceVersion();
  const events = metrics.map(([metric, quantityAtoms], index) => {
    const source = downloadMetricSourceDigest(projectId, downloadEventId, metric);
    const metricRate = version.rates.find((candidate) => candidate.metric === metric)!;
    return {
      pk: projectMonthPartitionKey(projectId, "2026-08"),
      sk: usageEventSortKey(occurredAt, source),
      itemType: "usage-event" as const,
      internalProjectId: projectId,
      period: "2026-08",
      metric,
      quantityAtoms,
      occurredAt,
      sourceKind: "cloudtrail-download",
      sourceDigest: source,
      inputFingerprint: String(index + 1).repeat(64),
      priceVersionId: version.versionId,
      priceEffectiveAt: version.effectiveAt,
      rate: metricRate,
      costAtoms: BigInt(index + 1),
      createdAt: occurredAt,
      expiresAt: ledgerExpiry(occurredAt),
    };
  }) as [UsageEventItem, UsageEventItem, UsageEventItem];
  return { evidence, events };
}

function cancellation(reasons: string[]): Error {
  return Object.assign(new Error("cancelled"), {
    name: "TransactionCanceledException",
    CancellationReasons: reasons.map((Code) => ({ Code })),
  });
}

describe("usage pricing repository price and record paths", () => {
  it("observes once and atomically prices all three download dimensions", async () => {
    const observed = downloadLedger("observed-unpriced").evidence;
    const observeClient = new StubClient([{}]);
    await expect(
      repository(observeClient).observeDownloadEvidence!(observed, occurredAt),
    ).resolves.toMatchObject({ status: "observed" });
    expect(observeClient.commands[0]).toBeInstanceOf(PutCommand);

    const { evidence, events } = downloadLedger();
    const client = new StubClient([{}, {}]);
    await expect(
      repository(client).recordDownloadEvent!(evidence, events, occurredAt),
    ).resolves.toMatchObject({ status: "recorded" });
    expect(client.commands[0]).toBeInstanceOf(GetCommand);
    const transaction = client.commands[1] as TransactWriteCommand;
    expect(transaction.input.TransactItems).toHaveLength(8);
    expect(transaction.input.TransactItems?.slice(1, 4).every((item) => item.Put)).toBe(true);
    expect(
      transaction.input.TransactItems?.slice(4, 7).map((item) => {
        const values = item.Update?.ExpressionAttributeValues as
          Record<string, unknown> | undefined;
        return values?.[":quantity"];
      }),
    ).toEqual([1n, 42n, 1n]);
    expect(transaction.input.TransactItems?.[7]?.Update?.ExpressionAttributeValues?.[":cost"]).toBe(
      6n,
    );
    expect(
      JSON.stringify(transaction.input, (_key: string, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toMatch(/Scan|\*|aaaaaaaa-aaaa/u);
  });

  it("promotes observed evidence and classifies priced duplicates or divergence", async () => {
    const observedLedger = downloadLedger("observed-unpriced");
    const pricedLedger = downloadLedger();
    const promotionClient = new StubClient([{ Item: observedLedger.evidence }, {}]);
    await expect(
      repository(promotionClient).recordDownloadEvent!(
        pricedLedger.evidence,
        pricedLedger.events,
        occurredAt,
      ),
    ).resolves.toMatchObject({ status: "recorded" });
    expect(
      (promotionClient.commands[1] as TransactWriteCommand).input.TransactItems?.[0]?.Update
        ?.ConditionExpression,
    ).toContain("pricingStatus = :observed");

    const duplicateClient = new StubClient([
      { Item: pricedLedger.evidence },
      {
        Responses: [
          { Item: pricedLedger.evidence },
          ...pricedLedger.events.map((event) => ({ Item: event })),
        ],
      },
    ]);
    await expect(
      repository(duplicateClient).recordDownloadEvent!(
        pricedLedger.evidence,
        pricedLedger.events,
        occurredAt,
      ),
    ).resolves.toMatchObject({ status: "duplicate" });

    const divergentClient = new StubClient([
      { Item: { ...pricedLedger.evidence, fingerprint: "b".repeat(64) } },
    ]);
    await expect(
      repository(divergentClient).recordDownloadEvent!(
        pricedLedger.evidence,
        pricedLedger.events,
        occurredAt,
      ),
    ).rejects.toBeInstanceOf(UsageSourceConflictError);
  });
  it("queries the effective immutable price strongly, descending, and bounded", async () => {
    const client = new StubClient([{ Items: [priceItem()] }]);
    await expect(repository(client).findEffectivePrice(occurredAt)).resolves.toMatchObject({
      versionId: "v1",
    });
    expect(client.commands[0]).toBeInstanceOf(QueryCommand);
    expect((client.commands[0] as QueryCommand).input).toMatchObject({
      TableName: "usage-table",
      KeyConditionExpression: "pk = :pricing AND sk <= :upper",
      ConsistentRead: true,
      ScanIndexForward: false,
      Limit: 1,
    });
    expect((client.commands[0] as QueryCommand).input).not.toHaveProperty("FilterExpression");
    expect((client.commands[0] as QueryCommand).input).not.toHaveProperty("IndexName");
  });

  it("records dedupe, event, metric, and total atomically with integer ADD", async () => {
    const client = new StubClient([{}]);
    const { event, dedupe } = ledger();
    await expect(repository(client).recordEvent(event, dedupe, occurredAt)).resolves.toEqual({
      status: "recorded",
    });
    const command = client.commands[0] as TransactWriteCommand;
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.ClientRequestToken).toHaveLength(36);
    expect(command.input.TransactItems).toHaveLength(4);
    expect(command.input.TransactItems?.[0]?.Put).toMatchObject({
      Item: dedupe,
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(command.input.TransactItems?.[1]?.Put).toMatchObject({
      Item: event,
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(command.input.TransactItems?.[2]?.Update?.UpdateExpression).toContain(
      "ADD quantityAtoms :quantity, costAtoms :cost, revision :one",
    );
    expect(command.input.TransactItems?.[3]?.Update?.Key?.["sk"]).toBe(TOTAL_AGGREGATE_SORT_KEY);
  });

  it("classifies an identical durable condition failure as a duplicate", async () => {
    const { event, dedupe } = ledger();
    const client = new StubClient([
      cancellation(["ConditionalCheckFailed", "None", "None", "None"]),
      { Responses: [{ Item: dedupe }, { Item: event }] },
    ]);
    await expect(repository(client).recordEvent(event, dedupe, occurredAt)).resolves.toEqual({
      status: "duplicate",
      event,
    });
    expect(client.commands[1]).toBeInstanceOf(TransactGetCommand);
  });

  it("classifies divergent source evidence and retryable aggregate conflicts", async () => {
    const { event, dedupe } = ledger();
    const divergent = { ...dedupe, inputFingerprint: "b".repeat(64) };
    const sourceClient = new StubClient([
      cancellation(["ConditionalCheckFailed", "None", "None", "None"]),
      { Responses: [{ Item: divergent }, {}] },
    ]);
    await expect(
      repository(sourceClient).recordEvent(event, dedupe, occurredAt),
    ).rejects.toBeInstanceOf(UsageSourceConflictError);
    const conflictClient = new StubClient([
      cancellation(["None", "None", "TransactionConflict", "None"]),
    ]);
    await expect(
      repository(conflictClient).recordEvent(event, dedupe, occurredAt),
    ).rejects.toBeInstanceOf(UsageRepositoryConflictError);
  });
});

describe("usage pricing repository projection and operations paths", () => {
  const metricAggregate: MetricAggregateItem = {
    pk: projectMonthPartitionKey(projectId, "2026-08"),
    sk: metricAggregateSortKey("s3-upload-requests"),
    itemType: "usage-aggregate-metric",
    internalProjectId: projectId,
    period: "2026-08",
    metric: "s3-upload-requests",
    quantityAtoms: 1n,
    costAtoms: 2n,
    revision: 1n,
    priceVersionIds: new Set(["v1"]),
  };
  const totalAggregate: TotalAggregateItem = {
    pk: metricAggregate.pk,
    sk: TOTAL_AGGREGATE_SORT_KEY,
    itemType: "usage-aggregate-total",
    internalProjectId: projectId,
    period: "2026-08",
    costAtoms: 2n,
    revision: 1n,
    priceVersionIds: new Set(["v1"]),
  };

  it("paginates strong event queries and uses no scan, filter, or GSI", async () => {
    const { event } = ledger();
    const client = new StubClient([
      { Items: [event], LastEvaluatedKey: { pk: event.pk, sk: event.sk } },
      { Items: [event] },
    ]);
    await expect(repository(client).listEvents(projectId, "2026-08")).resolves.toHaveLength(2);
    expect(client.commands).toHaveLength(2);
    for (const command of client.commands) {
      expect(command).toBeInstanceOf(QueryCommand);
      const query = command as QueryCommand;
      expect(query.input.ConsistentRead).toBe(true);
      expect(query.input).not.toHaveProperty("FilterExpression");
      expect(query.input).not.toHaveProperty("IndexName");
    }
  });

  it("reads bounded aggregates and conditionally replaces rebuild projections", async () => {
    const client = new StubClient([{ Items: [metricAggregate, totalAggregate] }, {}]);
    const repo = repository(client);
    const aggregates = await repo.getAggregates(projectId, "2026-08");
    await repo.replaceAggregates(
      aggregates,
      new Map([
        [metricAggregate.sk, 1n],
        [totalAggregate.sk, 1n],
      ]),
    );
    expect((client.commands[0] as QueryCommand).input.Limit).toBe(10);
    const transaction = client.commands[1] as TransactWriteCommand;
    expect(
      transaction.input.TransactItems?.every(
        (item) => item.Put?.ConditionExpression === "revision = :expected",
      ),
    ).toBe(true);
    const conflict = new StubClient([cancellation(["ConditionalCheckFailed"])]);
    await expect(
      repository(conflict).replaceAggregates(
        [metricAggregate],
        new Map([[metricAggregate.sk, 1n]]),
      ),
    ).rejects.toBeInstanceOf(UsageProjectionConflictError);
  });

  it("gets, creates, and revision-replaces checkpoints", async () => {
    const subject = "c".repeat(64);
    const checkpoint: StorageCheckpointItem = {
      pk: `STORAGE#${projectId}#${subject}`,
      sk: "CHECKPOINT",
      itemType: "storage-checkpoint",
      internalProjectId: projectId,
      subjectDigest: subject,
      status: "active",
      byteSize: 10n,
      openedAt: occurredAt,
      checkpointedThrough: occurredAt,
      revision: 0n,
    };
    const client = new StubClient([{ Item: checkpoint }, {}, {}]);
    const repo = repository(client);
    await expect(repo.getCheckpoint(projectId, subject)).resolves.toEqual(checkpoint);
    await repo.createCheckpoint(checkpoint);
    await repo.replaceCheckpoint({ ...checkpoint, revision: 1n }, 0n);
    expect(client.commands[0]).toBeInstanceOf(GetCommand);
    expect(client.commands[1]).toBeInstanceOf(PutCommand);
    expect((client.commands[2] as PutCommand).input.ConditionExpression).toContain(
      "revision = :expected",
    );
    const conflict = new StubClient([
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }),
    ]);
    await expect(repository(conflict).createCheckpoint(checkpoint)).rejects.toBeInstanceOf(
      UsageCheckpointConflictError,
    );
  });

  it("advances monotonic watermarks, marks incomplete, and writes safe quarantine", async () => {
    const quarantine = {
      pk: "QUARANTINE#2026-08",
      sk: "OBSERVED#2026-08-15T12:00:00.000Z#22222222-2222-4222-8222-222222222222",
      itemType: "usage-quarantine" as const,
      quarantineId: "22222222-2222-4222-8222-222222222222",
      observedAt: occurredAt,
      reasonCode: "ambiguous-source",
      sourceKind: "cloudtrail",
      evidenceHash: "d".repeat(64),
      internalProjectId: projectId,
      expiresAt: retentionExpiry(occurredAt, 90),
    };
    const client = new StubClient([{}, {}, {}]);
    const repo = repository(client);
    await repo.advanceWatermark(projectId, "cloudtrail", occurredAt);
    await repo.markWatermarkIncomplete(projectId, "cloudtrail", occurredAt);
    await repo.putQuarantine(quarantine);
    expect(client.commands[0]).toBeInstanceOf(UpdateCommand);
    expect((client.commands[0] as UpdateCommand).input.ConditionExpression).toContain(
      "lastMeteredAt < :meteredAt",
    );
    expect((client.commands[0] as UpdateCommand).input.UpdateExpression).toContain(
      "if_not_exists(incompleteSince, :complete)",
    );
    expect((client.commands[1] as UpdateCommand).input.ConditionExpression).toContain(
      "incompleteSince = :complete",
    );
    expect(client.commands[2]).toBeInstanceOf(PutCommand);
    expect((client.commands[2] as PutCommand).input.Item).not.toHaveProperty("rawEvent");
  });

  it("treats older watermark updates as verified no-ops and deduplicates through TTL lag", async () => {
    const watermark = {
      pk: `PROJECT#${projectId}`,
      sk: "WATERMARK#cloudtrail-download",
      itemType: "usage-watermark",
      internalProjectId: projectId,
      sourceKind: "cloudtrail-download",
      lastMeteredAt: occurredAt,
      incompleteSince: "2026-08-10T00:00:00.000Z",
    } as const;
    const oldClient = new StubClient([
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }),
      { Item: watermark },
    ]);
    await expect(
      repository(oldClient).advanceWatermark(
        projectId,
        "cloudtrail-download",
        "2026-08-01T00:00:00.000Z",
      ),
    ).resolves.toBeUndefined();

    const item: DownloadMeteringQuarantineItem = {
      pk: downloadQuarantinePartitionKey("d".repeat(64)),
      sk: DOWNLOAD_QUARANTINE_SORT_KEY,
      itemType: "download-metering-quarantine",
      evidenceHash: "d".repeat(64),
      reasonCode: "missing-bytes",
      sourceKind: "cloudtrail-download",
      observedAt: occurredAt,
      internalProjectId: projectId,
      expiresAt: retentionExpiry(occurredAt, 90),
    };
    const duplicateClient = new StubClient([
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }),
      { Item: item },
    ]);
    await expect(
      repository(duplicateClient).putDownloadQuarantine!(item, "2027-01-01T00:00:00.000Z"),
    ).resolves.toEqual({ status: "duplicate" });

    const expiredEvidence = downloadLedger("observed-unpriced").evidence;
    const evidenceClient = new StubClient([
      Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }),
      { Item: expiredEvidence },
    ]);
    await expect(
      repository(evidenceClient).observeDownloadEvidence!(
        expiredEvidence,
        "2027-01-01T00:00:00.000Z",
      ),
    ).resolves.toMatchObject({ status: "duplicate" });
  });
});
