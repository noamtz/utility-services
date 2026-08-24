import { gunzipSync } from "node:zlib";

import { z } from "zod";

import { parseFileObjectKey } from "../file-management/model.js";
import { parseUnsignedInteger } from "./fixed-point.js";
import { canonicalCloudTrailEventId, sha256 } from "./model.js";

const TimestampSchema = z.iso.datetime({ offset: true });
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const SqsEventSchema = z
  .object({
    Records: z
      .array(
        z
          .object({
            eventSource: z.literal("aws:sqs"),
            messageId: z.string().min(1).max(256),
            body: z.string().min(1).max(1_048_576),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();
const S3NotificationSchema = z
  .object({
    Records: z
      .array(
        z
          .object({
            eventName: z.literal("ObjectCreated:Put"),
            s3: z
              .object({
                bucket: z.object({ name: z.string().min(1) }).passthrough(),
                object: z.object({ key: z.string().min(1) }).passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();
const ReconcileJobSchema = z
  .object({
    kind: z.literal("reconcile-download-metering"),
    logKeys: z.array(z.string().min(1).max(1_024)).min(1).max(100),
  })
  .strict();
const CloudTrailArchiveSchema = z.object({ Records: z.array(z.unknown()).min(1) }).passthrough();
const CloudTrailRecordSchema = z
  .object({
    eventID: z.string(),
    eventTime: TimestampSchema,
    eventType: z.string(),
    eventSource: z.string(),
    eventName: z.string(),
    eventCategory: z.string(),
    readOnly: z.boolean(),
    awsRegion: z.string(),
    recipientAccountId: z.string(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    resources: z.array(
      z
        .object({
          type: z.string(),
          ARN: z.string(),
        })
        .passthrough(),
    ),
    additionalEventData: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export interface CloudTrailLogStore {
  get(logKey: string): Promise<Uint8Array>;
}

export interface AcceptedDownloadEvidence {
  readonly kind: "accepted";
  readonly eventId: string;
  readonly internalProjectId: string;
  readonly fileId: string;
  readonly occurredAt: string;
  readonly bytesTransferredOut: bigint;
  readonly accountId: string;
  readonly region: string;
  readonly rawLogDigest: string;
  readonly evidenceHash: string;
}

export interface QuarantinedDownloadEvidence {
  readonly kind: "quarantine";
  readonly reasonCode: string;
  readonly evidenceHash: string;
  readonly observedAt: string;
  readonly internalProjectId?: string;
}

export type DownloadRecordClassification = AcceptedDownloadEvidence | QuarantinedDownloadEvidence;

export type MeteringInvocation =
  | { readonly kind: "queue"; readonly logKeys: readonly [string]; readonly requestHash: string }
  | {
      readonly kind: "reconcile";
      readonly logKeys: readonly string[];
      readonly requestHash: string;
    }
  | QuarantinedDownloadEvidence;

export interface CloudTrailArchiveResult {
  readonly logDigest: string;
  readonly records: readonly DownloadRecordClassification[];
}

export interface CloudTrailLogReaderOptions {
  readonly store: CloudTrailLogStore;
  readonly logBucketName: string;
  readonly logPrefix: string;
  readonly fileBucketName: string;
  readonly accountId: string;
  readonly region: string;
  readonly maxCompressedBytes: number;
  readonly maxInflatedBytes: number;
  readonly maxRecords: number;
  readonly now?: () => string;
}

function boundedPositiveInteger(value: number): number {
  return z.number().int().positive().safe().parse(value);
}

function digestUnknown(value: unknown): string {
  try {
    return sha256(
      JSON.stringify(value, (_key: string, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    );
  } catch {
    return sha256(Object.prototype.toString.call(value));
  }
}

function decodedS3Key(value: string): string | undefined {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return undefined;
  }
}

function decodedArnKey(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function parseTransferredBytes(value: unknown): bigint | undefined {
  try {
    if (typeof value === "string") return parseUnsignedInteger(value);
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return parseUnsignedInteger(String(value));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function invalidInvocation(reasonCode: string, raw: unknown, observedAt: string) {
  return Object.freeze({
    kind: "quarantine" as const,
    reasonCode,
    evidenceHash: digestUnknown(raw),
    observedAt,
  });
}

export function parseMeteringInvocation(
  rawEvent: unknown,
  options: Pick<CloudTrailLogReaderOptions, "logBucketName" | "logPrefix" | "now">,
): MeteringInvocation {
  const now = options.now ?? (() => new Date().toISOString());
  const observedAt = new Date(TimestampSchema.parse(now())).toISOString();
  const reconcile = ReconcileJobSchema.safeParse(rawEvent);
  if (reconcile.success) {
    if (
      reconcile.data.logKeys.some(
        (key) => !key.startsWith(options.logPrefix) || !key.endsWith(".json.gz"),
      )
    ) {
      return invalidInvocation("invalid-reconcile-key", rawEvent, observedAt);
    }
    return Object.freeze({
      kind: "reconcile" as const,
      logKeys: Object.freeze([...new Set(reconcile.data.logKeys)]),
      requestHash: digestUnknown(rawEvent),
    });
  }
  const sqs = SqsEventSchema.safeParse(rawEvent);
  if (!sqs.success) return invalidInvocation("invalid-sqs-envelope", rawEvent, observedAt);
  let body: unknown;
  try {
    body = JSON.parse(sqs.data.Records[0]!.body);
  } catch {
    return invalidInvocation("invalid-s3-notification", sqs.data.Records[0]!.body, observedAt);
  }
  const notification = S3NotificationSchema.safeParse(body);
  if (!notification.success) return invalidInvocation("invalid-s3-notification", body, observedAt);
  const record = notification.data.Records[0]!;
  const key = decodedS3Key(record.s3.object.key);
  if (
    record.s3.bucket.name !== options.logBucketName ||
    key === undefined ||
    !key.startsWith(options.logPrefix) ||
    !key.endsWith(".json.gz")
  ) {
    return invalidInvocation("outside-log-boundary", body, observedAt);
  }
  const logKeys: readonly [string] = [key];
  return Object.freeze({
    kind: "queue" as const,
    logKeys: Object.freeze(logKeys),
    requestHash: digestUnknown({ messageId: sqs.data.Records[0]!.messageId }),
  });
}

export function createCloudTrailLogReader(options: CloudTrailLogReaderOptions) {
  z.string().trim().min(1).parse(options.logBucketName);
  const logPrefix = z.string().min(1).max(512).parse(options.logPrefix);
  const fileBucketName = z.string().trim().min(3).max(63).parse(options.fileBucketName);
  const accountId = z
    .string()
    .regex(/^\d{12}$/u)
    .parse(options.accountId);
  const region = z
    .string()
    .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/u)
    .parse(options.region);
  const maxCompressedBytes = boundedPositiveInteger(options.maxCompressedBytes);
  const maxInflatedBytes = boundedPositiveInteger(options.maxInflatedBytes);
  const maxRecords = boundedPositiveInteger(options.maxRecords);
  const now = options.now ?? (() => new Date().toISOString());
  const objectArnPrefix = `arn:aws:s3:::${fileBucketName}/projects/`;

  function quarantine(
    reasonCode: string,
    evidenceHash: string,
    observedAt: string,
    internalProjectId?: string,
  ): QuarantinedDownloadEvidence {
    return Object.freeze({
      kind: "quarantine",
      reasonCode,
      evidenceHash: DigestSchema.parse(evidenceHash),
      observedAt: new Date(TimestampSchema.parse(observedAt)).toISOString(),
      ...(internalProjectId ? { internalProjectId } : {}),
    });
  }

  function classifyRecord(
    rawRecord: unknown,
    rawLogDigest: string,
    fallbackObservedAt: string,
  ): DownloadRecordClassification {
    const recordHash = sha256(rawLogDigest, digestUnknown(rawRecord));
    const parsed = CloudTrailRecordSchema.safeParse(rawRecord);
    if (!parsed.success)
      return quarantine("invalid-cloudtrail-record", recordHash, fallbackObservedAt);
    const record = parsed.data;
    let eventId: string;
    try {
      eventId = canonicalCloudTrailEventId(record.eventID);
    } catch {
      return quarantine("invalid-event-id", recordHash, record.eventTime);
    }
    if (
      record.eventType !== "AwsApiCall" ||
      record.eventSource !== "s3.amazonaws.com" ||
      record.eventName !== "GetObject" ||
      record.eventCategory !== "Data" ||
      record.readOnly !== true ||
      record.recipientAccountId !== accountId ||
      record.awsRegion !== region
    ) {
      return quarantine("outside-download-boundary", recordHash, record.eventTime);
    }
    const matchingResources = record.resources.filter(
      (resource) => resource.type === "AWS::S3::Object" && resource.ARN.startsWith(objectArnPrefix),
    );
    if (matchingResources.length !== 1) {
      return quarantine("ambiguous-object-resource", recordHash, record.eventTime);
    }
    const encodedKey = matchingResources[0]!.ARN.slice(`arn:aws:s3:::${fileBucketName}/`.length);
    const objectKey = decodedArnKey(encodedKey);
    if (!objectKey) return quarantine("invalid-object-key", recordHash, record.eventTime);
    let identity: ReturnType<typeof parseFileObjectKey>;
    try {
      identity = parseFileObjectKey(objectKey);
    } catch {
      return quarantine("invalid-object-key", recordHash, record.eventTime);
    }
    if (record.errorCode !== undefined || record.errorMessage !== undefined) {
      return quarantine(
        "failed-get-object",
        recordHash,
        record.eventTime,
        identity.internalProjectId,
      );
    }
    const bytesTransferredOut = parseTransferredBytes(
      record.additionalEventData?.["bytesTransferredOut"],
    );
    if (bytesTransferredOut === undefined) {
      return quarantine(
        "invalid-bytes-transferred-out",
        recordHash,
        record.eventTime,
        identity.internalProjectId,
      );
    }
    return Object.freeze({
      kind: "accepted" as const,
      eventId,
      internalProjectId: identity.internalProjectId,
      fileId: identity.fileId,
      occurredAt: new Date(record.eventTime).toISOString(),
      bytesTransferredOut,
      accountId,
      region,
      rawLogDigest,
      evidenceHash: recordHash,
    });
  }

  async function readLog(logKeyInput: string): Promise<CloudTrailArchiveResult> {
    const logKey = z.string().min(1).max(1_024).parse(logKeyInput);
    const observedAt = new Date(TimestampSchema.parse(now())).toISOString();
    if (!logKey.startsWith(logPrefix) || !logKey.endsWith(".json.gz")) {
      const logDigest = digestUnknown(logKey);
      return { logDigest, records: [quarantine("outside-log-boundary", logDigest, observedAt)] };
    }
    const compressed = await options.store.get(logKey);
    const logDigest = sha256(Buffer.from(compressed).toString("base64"));
    if (compressed.byteLength === 0 || compressed.byteLength > maxCompressedBytes) {
      return {
        logDigest,
        records: [quarantine("invalid-compressed-size", logDigest, observedAt)],
      };
    }
    let inflated: Buffer;
    try {
      inflated = gunzipSync(compressed, { maxOutputLength: maxInflatedBytes });
    } catch {
      return { logDigest, records: [quarantine("invalid-gzip", logDigest, observedAt)] };
    }
    if (inflated.byteLength === 0 || inflated.byteLength > maxInflatedBytes) {
      return { logDigest, records: [quarantine("invalid-inflated-size", logDigest, observedAt)] };
    }
    let rawArchive: unknown;
    try {
      rawArchive = JSON.parse(inflated.toString("utf8"));
    } catch {
      return { logDigest, records: [quarantine("invalid-cloudtrail-json", logDigest, observedAt)] };
    }
    const archive = CloudTrailArchiveSchema.safeParse(rawArchive);
    if (!archive.success || archive.data.Records.length > maxRecords) {
      return { logDigest, records: [quarantine("invalid-record-count", logDigest, observedAt)] };
    }
    return Object.freeze({
      logDigest,
      records: Object.freeze(
        archive.data.Records.map((record) => classifyRecord(record, logDigest, observedAt)),
      ),
    });
  }

  return Object.freeze({ readLog, classifyRecord });
}
