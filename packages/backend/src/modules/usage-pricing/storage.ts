import type { PriceVersion } from "@utility-services/contracts";
import { z } from "zod";

import { assertDynamoInteger } from "./fixed-point.js";
import { sha256, usagePeriod } from "./model.js";
import { validatePriceVersionHistory } from "./pricing.js";

const TimestampSchema = z.iso.datetime({ offset: true });
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export interface StorageUsageSegment {
  readonly startAt: string;
  readonly endAt: string;
  readonly period: string;
  readonly quantityAtoms: bigint;
  readonly sourceId: string;
  readonly sourceDigest: string;
}

function canonical(timestamp: string): string {
  return new Date(TimestampSchema.parse(timestamp)).toISOString();
}

function nextUtcMonthStart(timestamp: string): string {
  const value = new Date(timestamp);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1)).toISOString();
}

export function splitStorageInterval(input: {
  readonly subjectDigest: string;
  readonly byteSize: bigint;
  readonly startAt: string;
  readonly endAt: string;
  readonly priceVersions: readonly PriceVersion[];
}): StorageUsageSegment[] {
  const subjectDigest = DigestSchema.parse(input.subjectDigest);
  const byteSize = assertDynamoInteger(input.byteSize);
  const startAt = canonical(input.startAt);
  const endAt = canonical(input.endAt);
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (end < start) throw new RangeError("Storage interval end precedes start");
  if (end === start) return [];
  const versions = validatePriceVersionHistory(input.priceVersions);
  const boundaries = versions.map((version) => canonical(version.effectiveAt));
  const segments: StorageUsageSegment[] = [];
  let cursor = startAt;
  while (new Date(cursor).getTime() < end) {
    const candidates = [
      endAt,
      nextUtcMonthStart(cursor),
      ...boundaries.filter((boundary) => boundary > cursor),
    ];
    const segmentEnd = candidates.filter((candidate) => candidate > cursor).sort()[0];
    if (!segmentEnd) throw new Error("Storage interval could not make progress");
    const boundedEnd = segmentEnd > endAt ? endAt : segmentEnd;
    const durationMilliseconds = BigInt(
      new Date(boundedEnd).getTime() - new Date(cursor).getTime(),
    );
    const quantityAtoms = assertDynamoInteger(byteSize * durationMilliseconds);
    const sourceId = `storage-segment:${subjectDigest}:${cursor}:${boundedEnd}`;
    segments.push(
      Object.freeze({
        startAt: cursor,
        endAt: boundedEnd,
        period: usagePeriod(cursor),
        quantityAtoms,
        sourceId,
        sourceDigest: sha256(sourceId),
      }),
    );
    cursor = boundedEnd;
  }
  return segments;
}
