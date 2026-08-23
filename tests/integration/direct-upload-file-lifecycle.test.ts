/* eslint-disable @typescript-eslint/require-await -- deterministic in-memory integration boundary */
import {
  USAGE_METRICS,
  type PriceVersion,
  type TrustedProjectContext,
} from "@utility-services/contracts";
import { describe, expect, it, vi } from "vitest";

import { createAuthorizeUploadHandler } from "../../packages/backend/src/modules/file-management/handlers.js";
import {
  parseFileItem,
  type CompletionEvidence,
  type FileItem,
} from "../../packages/backend/src/modules/file-management/model.js";
import type {
  ObjectStore,
  StoredObjectEvidence,
} from "../../packages/backend/src/modules/file-management/object-store.js";
import type { UploadPresigner } from "../../packages/backend/src/modules/file-management/presigning.js";
import {
  FileCollisionError,
  StorageQuotaExceededError,
  type DuePendingResult,
  type FileRepository,
  type ListFilesInput,
} from "../../packages/backend/src/modules/file-management/repository.js";
import { createFileService } from "../../packages/backend/src/modules/file-management/service.js";
import { createUploadCompletionService } from "../../packages/backend/src/modules/file-management/completion.js";
import {
  encodeSecretHash,
  hashApiKeySecret,
} from "../../packages/backend/src/modules/identity-control/credentials/credential.js";
import { toCredentialItems } from "../../packages/backend/src/modules/identity-control/credentials/model.js";
import type { CredentialRepository } from "../../packages/backend/src/modules/identity-control/credentials/repository.js";
import type { InternalProject } from "../../packages/backend/src/modules/identity-control/projects/model.js";
import { createProjectAuthenticationService } from "../../packages/backend/src/modules/project-authentication/service.js";
import type {
  AggregateItem,
  RecordEventResult,
  UsagePricingRepository,
} from "../../packages/backend/src/modules/usage-pricing/repository.js";
import {
  UsageCheckpointConflictError,
  UsageSourceConflictError,
} from "../../packages/backend/src/modules/usage-pricing/repository.js";
import type {
  DedupeItem,
  QuarantineItem,
  StorageCheckpointItem,
  UsageEventItem,
  WatermarkItem,
} from "../../packages/backend/src/modules/usage-pricing/model.js";
import { createUsagePricingService } from "../../packages/backend/src/modules/usage-pricing/service.js";

const timestamp = "2026-08-23T08:00:00.000Z";
const completedAt = "2026-08-23T08:10:00.000Z";
const internalProjectId = "11111111-1111-4111-8111-111111111111";
const publicProjectId = "prj_0123456789abcdefghijkl";
const keyId = "key_0123456789abcdefghijkl";
const secret = "s".repeat(43);
const apiKey = `rus_v1.${keyId}.${secret}`;
const fileId = "fil_0123456789abcdefghijkl";
const publicFileId = "pfil_0123456789abcdefghijkl";

const project: InternalProject = {
  internalProjectId,
  publicProjectId,
  ownerId: "private-owner",
  name: "Upload project",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: timestamp,
  updatedAt: timestamp,
};
const credentialItems = toCredentialItems({
  internalProjectId,
  publicProjectId,
  keyId,
  secretHash: encodeSecretHash(hashApiKeySecret(secret)),
  createdAt: timestamp,
});

class MemoryFiles implements FileRepository {
  public readonly items = new Map<string, FileItem>();
  public reservedBytes = 0n;
  public retainedBytes = 0n;

  private key(projectId: string, requestedFileId: string) {
    return `${projectId}|${requestedFileId}`;
  }
  public async get(projectId: string, requestedFileId: string) {
    return this.items.get(this.key(projectId, requestedFileId));
  }
  public async list(input: ListFilesInput) {
    const items = [...this.items.values()]
      .filter((item) => item.internalProjectId === input.internalProjectId)
      .sort((left, right) => left.fileId.localeCompare(right.fileId));
    const start = input.startAfterFileId
      ? items.findIndex((item) => item.fileId === input.startAfterFileId) + 1
      : 0;
    const page = items.slice(start, start + input.limit);
    return {
      items: page,
      ...(start + page.length < items.length && page.at(-1)
        ? { nextFileId: page.at(-1)!.fileId }
        : {}),
    };
  }
  public async reservePending(file: FileItem, quotaLimit: bigint) {
    const key = this.key(file.internalProjectId, file.fileId);
    if (this.items.has(key)) throw new FileCollisionError();
    if (this.reservedBytes + this.retainedBytes + file.sizeBytes > quotaLimit) {
      throw new StorageQuotaExceededError();
    }
    this.items.set(key, file);
    this.reservedBytes += file.sizeBytes;
  }
  public async claimCompletion(file: FileItem, evidence: CompletionEvidence, now: string) {
    const current = (await this.get(file.internalProjectId, file.fileId))!;
    if (current.completionEvidence) return current;
    const next = parseFileItem({
      ...current,
      completionEvidence: evidence,
      updatedAt: now,
      revision: current.revision + 1n,
    });
    this.items.set(this.key(next.internalProjectId, next.fileId), next);
    return next;
  }
  public async finalizeReady(file: FileItem, now: string) {
    const { gsi2pk: _pk, gsi2sk: _sk, ...terminal } = file;
    void _pk;
    void _sk;
    const next = parseFileItem({
      ...terminal,
      status: "ready",
      readyAt: file.completionEvidence!.completedAt,
      updatedAt: now,
      revision: file.revision + 1n,
    });
    this.items.set(this.key(next.internalProjectId, next.fileId), next);
    this.reservedBytes -= file.sizeBytes;
    this.retainedBytes += file.sizeBytes;
    return next;
  }
  public async claimFailure(file: FileItem, reason: string, cleanup: boolean, now: string) {
    const next = parseFileItem({
      ...file,
      failureCode: reason,
      cleanupRequired: cleanup,
      updatedAt: now,
      revision: file.revision + 1n,
    });
    this.items.set(this.key(next.internalProjectId, next.fileId), next);
    return next;
  }
  public async completeFailureCleanup(file: FileItem, now: string) {
    const next = parseFileItem({
      ...file,
      cleanupRequired: false,
      updatedAt: now,
      revision: file.revision + 1n,
    });
    this.items.set(this.key(next.internalProjectId, next.fileId), next);
    return next;
  }
  public async finalizeFailed(file: FileItem, now: string) {
    const { gsi2pk: _pk, gsi2sk: _sk, ...terminal } = file;
    void _pk;
    void _sk;
    const next = parseFileItem({
      ...terminal,
      status: "failed",
      failedAt: now,
      updatedAt: now,
      revision: file.revision + 1n,
    });
    this.items.set(this.key(next.internalProjectId, next.fileId), next);
    this.reservedBytes -= file.sizeBytes;
    return next;
  }
  public async listDuePending(): Promise<DuePendingResult> {
    return { items: [...this.items.values()].filter((item) => item.status === "pending") };
  }
}

function priceVersion(): PriceVersion {
  return {
    versionId: "integration-v1",
    effectiveAt: "2026-01-01T00:00:00.000Z",
    publishedAt: "2026-01-01T00:00:00.000Z",
    currency: "USD",
    productRegion: "il-central-1",
    rates: USAGE_METRICS.map((metric) => ({
      metric,
      serviceCode: "AmazonS3",
      productFamily: "integration",
      sku: "ABCDEFGH",
      rateCode: "ABCDEFGH.JRTCKXETXF.6YS6EN2CT7",
      unit: metric.includes("storage") ? "GB-Mo" : "Requests",
      unitQuantity: "1",
      beginRange: "0",
      endRange: "Inf",
      usdPerUnit: "0.001",
      sourcePricePerUnitUsd: "0.001",
      effectiveAt: "2026-01-01T00:00:00.000Z",
      description: "integration",
    })),
    sources: [
      {
        url: "https://example.com",
        publicationDate: "2026-01-01T00:00:00.000Z",
        version: "20260101000000",
        sha256: "a".repeat(64),
      },
    ],
  };
}

class MemoryUsage implements UsagePricingRepository {
  public readonly events = new Map<string, UsageEventItem>();
  public readonly dedupe = new Map<string, string>();
  public readonly checkpoints = new Map<string, StorageCheckpointItem>();
  public readonly watermarks = new Map<string, WatermarkItem>();
  public async listPriceVersions() {
    return [priceVersion()];
  }
  public async findEffectivePrice() {
    return priceVersion();
  }
  public async recordEvent(event: UsageEventItem, dedupe: DedupeItem): Promise<RecordEventResult> {
    const prior = this.dedupe.get(dedupe.pk);
    if (prior && prior !== dedupe.inputFingerprint) throw new UsageSourceConflictError();
    const key = `${event.pk}|${event.sk}`;
    const existing = this.events.get(key);
    if (existing) return { status: "duplicate", event: existing };
    this.dedupe.set(dedupe.pk, dedupe.inputFingerprint);
    this.events.set(key, event);
    return { status: "recorded" };
  }
  public async listEvents() {
    return [...this.events.values()];
  }
  public async getAggregates(): Promise<AggregateItem[]> {
    return [];
  }
  public async replaceAggregates() {}
  public async getCheckpoint(_project: string, digest: string) {
    return this.checkpoints.get(digest);
  }
  public async createCheckpoint(item: StorageCheckpointItem) {
    if (this.checkpoints.has(item.subjectDigest)) throw new UsageCheckpointConflictError();
    this.checkpoints.set(item.subjectDigest, item);
  }
  public async replaceCheckpoint(item: StorageCheckpointItem) {
    this.checkpoints.set(item.subjectDigest, item);
  }
  public async listWatermarks() {
    return [...this.watermarks.values()];
  }
  public async advanceWatermark(projectId: string, source: string, at: string) {
    this.watermarks.set(`${projectId}|${source}`, {
      pk: `PROJECT#${projectId}`,
      sk: `WATERMARK#${source}`,
      itemType: "usage-watermark",
      internalProjectId: projectId,
      sourceKind: source,
      lastMeteredAt: at,
      incompleteSince: null,
    });
  }
  public async markWatermarkIncomplete() {}
  public async putQuarantine(_item: QuarantineItem) {
    void _item;
  }
}

function authRepository(): CredentialRepository {
  return {
    getLookup: vi.fn().mockResolvedValue(credentialItems.lookup),
    getVerificationSnapshot: vi.fn().mockResolvedValue({ ...credentialItems, project }),
  } as unknown as CredentialRepository;
}

function gatewayEvent(body: unknown) {
  return {
    requestContext: {
      requestId: "upload-integration-request",
      http: { method: "POST", path: "/v1/files/uploads" },
    },
    headers: { authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  };
}

describe("assembled direct upload file lifecycle", () => {
  it("authenticates, authorizes direct PUT, completes once, and isolates project reads", async () => {
    const files = new MemoryFiles();
    const presigner: UploadPresigner = {
      authorizePut: vi.fn().mockResolvedValue({
        url: "https://private-bucket.s3.il-central-1.amazonaws.com/object?X-Amz-Signature=synthetic",
        requiredHeaders: {
          "content-type": "text/plain",
          "content-length": "12",
          "if-none-match": "*",
        },
      }),
    };
    const service = createFileService({
      repository: files,
      presigner,
      generateIds: () => ({ fileId, publicFileId }),
      now: () => new Date(timestamp),
    });
    const authentication = createProjectAuthenticationService({ repository: authRepository() });
    const response = await createAuthorizeUploadHandler(
      service,
      authentication,
    )(
      gatewayEvent({
        name: "file.txt",
        mediaType: "text/plain",
        sizeBytes: 12,
        visibility: "private",
      }),
    );
    expect(response.statusCode).toBe(201);
    const publicJson = response.body ?? "";
    expect(publicJson).toContain("https://private-bucket.s3.il-central-1.amazonaws.com");
    for (const forbidden of [
      internalProjectId,
      "objectKey",
      "PROJECT#",
      "FILE#",
      "secretHash",
      apiKey,
    ]) {
      expect(publicJson).not.toContain(forbidden);
    }

    const objects = new Map<string, StoredObjectEvidence>([
      [
        `projects/${internalProjectId}/files/${fileId}`,
        {
          sizeBytes: 12n,
          mediaType: "text/plain",
          eTag: "etag",
          lastModified: completedAt,
        },
      ],
    ]);
    const objectStore: ObjectStore = {
      head: vi.fn().mockImplementation(async (key: string) => objects.get(key)),
      delete: vi.fn().mockImplementation(async (key: string) => {
        objects.delete(key);
      }),
    };
    const usageRepository = new MemoryUsage();
    const usage = createUsagePricingService({
      repository: usageRepository,
      now: () => completedAt,
    });
    const completion = createUploadCompletionService({
      repository: files,
      objectStore,
      usage,
      bucketName: "private-bucket",
      now: () => completedAt,
    });
    const s3Event = {
      Records: [
        {
          eventName: "ObjectCreated:Put",
          eventTime: completedAt,
          s3: {
            bucket: { name: "private-bucket" },
            object: {
              key: `projects/${internalProjectId}/files/${fileId}`,
              size: 12,
              eTag: "etag",
              sequencer: "0010",
            },
          },
        },
      ],
    };
    await completion.handleS3Event(s3Event);
    await completion.handleS3Event(s3Event);
    expect((await service.inspect(projectContext(), fileId)).status).toBe("ready");
    expect((await service.list(projectContext(), { limit: 20 })).items).toHaveLength(1);
    expect(usageRepository.events).toHaveLength(1);
    expect(usageRepository.checkpoints).toHaveLength(1);
    expect(files.reservedBytes).toBe(0n);
    expect(files.retainedBytes).toBe(12n);

    const otherProject: TrustedProjectContext = {
      ...projectContext(),
      internalProjectId: "22222222-2222-4222-8222-222222222222",
      publicProjectId: "prj_abcdefghijkl0123456789",
    };
    await expect(service.inspect(otherProject, fileId)).rejects.toMatchObject({
      statusCode: 404,
      code: "FILE_NOT_FOUND",
    });
  });

  it("rejects byte/key fields at the API and atomically admits only one last-slot reservation", async () => {
    const files = new MemoryFiles();
    const presigner: UploadPresigner = {
      authorizePut: vi.fn().mockResolvedValue({
        url: "https://bucket.example.com/object?X-Amz-Signature=synthetic",
        requiredHeaders: {
          "content-type": "text/plain",
          "content-length": "12",
          "if-none-match": "*",
        },
      }),
    };
    const service = createFileService({
      repository: files,
      presigner,
      quotaLimitBytes: 12n,
      generateIds: (() => {
        let count = 0;
        return () => ({
          fileId: count++ === 0 ? fileId : "fil_abcdefghijkl0123456789",
          publicFileId,
        });
      })(),
      now: () => new Date(timestamp),
    });
    const authentication = createProjectAuthenticationService({ repository: authRepository() });
    const rejected = await createAuthorizeUploadHandler(
      service,
      authentication,
    )(
      gatewayEvent({
        name: "file.txt",
        mediaType: "text/plain",
        sizeBytes: 12,
        visibility: "private",
        objectKey: "caller/key",
        bytes: "base64-body",
      }),
    );
    expect(rejected.statusCode).toBe(400);
    expect(files.items).toHaveLength(0);

    const results = await Promise.allSettled([
      service.authorizeUpload(projectContext(), {
        name: "one.txt",
        mediaType: "text/plain",
        sizeBytes: 12,
        visibility: "private",
      }),
      service.authorizeUpload(projectContext(), {
        name: "two.txt",
        mediaType: "text/plain",
        sizeBytes: 12,
        visibility: "private",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(files.reservedBytes).toBe(12n);
  });
});

function projectContext(): TrustedProjectContext {
  return {
    internalProjectId,
    publicProjectId,
    keyId,
    enabledUtilities: ["file-management"],
    fileManagement: project.fileManagement,
  };
}
