import { describe, expect, it } from "vitest";

import {
  createPendingFile,
  fileObjectKey,
  fileProjectPartitionKey,
  fileSortKey,
  parseFileItem,
  parseFileQuotaItem,
  pendingUploadSortKey,
  trashPurgeSortKey,
  TRASH_PURGE_INDEX_PARTITION,
  TRASH_RETENTION_MILLISECONDS,
} from "./model.js";

const internalProjectId = "11111111-1111-4111-8111-111111111111";
const publicProjectId = "prj_0123456789abcdefghijkl";
const fileId = "fil_0123456789abcdefghijkl";
const publicFileId = "pfil_0123456789abcdefghijkl";
const createdAt = "2026-08-23T08:00:00.000Z";
const expiresAt = "2026-08-23T08:15:00.000Z";
const eligibleAt = "2026-08-23T09:15:00.000Z";

function pending(visibility: "private" | "public" = "private") {
  return createPendingFile({
    internalProjectId,
    publicProjectId,
    fileId,
    ...(visibility === "public" ? { publicFileId } : {}),
    name: "example.txt",
    mediaType: "text/plain",
    sizeBytes: 12n,
    visibility,
    uploadExpiresAt: expiresAt,
    failureEligibleAt: eligibleAt,
    createdAt,
  });
}

describe("file persisted model", () => {
  it("builds exact server-owned keys and sparse indexes", () => {
    const privateFile = pending();
    expect(privateFile).toMatchObject({
      pk: fileProjectPartitionKey(internalProjectId),
      sk: fileSortKey(fileId),
      objectKey: fileObjectKey(internalProjectId, fileId),
      gsi2sk: pendingUploadSortKey(eligibleAt, internalProjectId, fileId),
    });
    expect(privateFile).not.toHaveProperty("gsi1pk");
    expect(pending("public")).toMatchObject({
      publicFileId,
      gsi1pk: `PUBLIC_PROJECT#${publicProjectId}`,
      gsi1sk: `PUBLIC_FILE#${publicFileId}`,
    });
  });

  it("accepts valid ready and failed terminal states", () => {
    const source = pending();
    const evidence = {
      completedAt: createdAt,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
      sequencer: "00AF",
    };
    const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...terminal } = source;
    void _pendingPk;
    void _pendingSk;
    expect(
      parseFileItem({
        ...terminal,
        status: "ready",
        completionEvidence: evidence,
        readyAt: createdAt,
      }).status,
    ).toBe("ready");
    expect(
      parseFileItem({
        ...terminal,
        status: "failed",
        failureCode: "upload-expired",
        cleanupRequired: false,
        failedAt: createdAt,
      }).status,
    ).toBe("failed");
  });

  it("accepts strict trash lifecycle evidence and preserves public identity", () => {
    const source = pending("public");
    const evidence = {
      completedAt: createdAt,
      sizeBytes: 12n,
      mediaType: "text/plain",
      eTag: "etag",
    };
    const { gsi2pk: _pendingPk, gsi2sk: _pendingSk, ...readyBase } = source;
    void _pendingPk;
    void _pendingSk;
    const trashedAt = "2026-08-23T10:00:00.000Z";
    const purgeAt = new Date(
      new Date(trashedAt).getTime() + TRASH_RETENTION_MILLISECONDS,
    ).toISOString();
    const trashed = parseFileItem({
      ...readyBase,
      status: "trashed",
      completionEvidence: evidence,
      readyAt: createdAt,
      trashedAt,
      purgeAt,
      gsi2pk: TRASH_PURGE_INDEX_PARTITION,
      gsi2sk: trashPurgeSortKey(purgeAt, internalProjectId, fileId),
    });
    expect(trashed).toMatchObject({
      status: "trashed",
      publicFileId,
      gsi1pk: `PUBLIC_PROJECT#${publicProjectId}`,
      gsi2pk: TRASH_PURGE_INDEX_PARTITION,
    });
    expect(() => parseFileItem({ ...trashed, purgeAt: trashedAt })).toThrow();
    expect(() =>
      parseFileItem({ ...trashed, purgeStartedAt: trashedAt, gsi2sk: "wrong" }),
    ).toThrow();
    expect(() => parseFileItem({ ...trashed, purgeStartedAt: trashedAt })).toThrow();
    expect(() => parseFileItem({ ...trashed, objectRemovedAt: trashedAt })).toThrow();
    expect(
      parseFileItem({
        ...trashed,
        purgeAt: trashedAt,
        gsi2sk: trashPurgeSortKey(trashedAt, internalProjectId, fileId),
        purgeStartedAt: trashedAt,
        objectRemovedAt: trashedAt,
      }).objectRemovedAt,
    ).toBe(trashedAt);
  });

  it("rejects caller-like keys, cross-state fields, and public identity drift", () => {
    const source = pending();
    expect(() => parseFileItem({ ...source, objectKey: "caller/chosen" })).toThrow();
    expect(() => parseFileItem({ ...source, publicFileId })).toThrow();
    expect(() => parseFileItem({ ...source, status: "ready" })).toThrow();
    expect(() => parseFileItem({ ...source, gsi2sk: "UPLOAD#wrong" })).toThrow();
  });

  it("preserves exact quota arithmetic", () => {
    const quota = {
      pk: fileProjectPartitionKey(internalProjectId),
      sk: "QUOTA",
      itemType: "file-quota",
      internalProjectId,
      reservedBytes: 12n,
      retainedBytes: 20n,
      accountedBytes: 32n,
      revision: 2n,
      updatedAt: createdAt,
    } as const;
    expect(parseFileQuotaItem(quota)).toEqual(quota);
    expect(() => parseFileQuotaItem({ ...quota, accountedBytes: 31n })).toThrow();
  });
});
