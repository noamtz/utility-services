import {
  PriceVersionSchema,
  UsageMetricSchema,
  type PriceRate,
  type PriceVersion,
  type UsageMetric,
} from "@utility-services/contracts";
import { z } from "zod";

import {
  BINARY_GIB_BYTES,
  USD_SCALE,
  assertDynamoInteger,
  multiplyDivideHalfUp,
  parseUnsignedDecimalToAtoms,
  parseUnsignedInteger,
} from "./fixed-point.js";

const TimestampSchema = z.iso.datetime({ offset: true });

export class NoEffectivePriceVersionError extends Error {
  public constructor() {
    super("No published price version is effective for the usage occurrence time");
    this.name = "NoEffectivePriceVersionError";
  }
}

export interface CalculatedUsageCharge {
  readonly metric: UsageMetric;
  readonly quantityAtoms: bigint;
  readonly costAtoms: bigint;
  readonly priceVersionId: string;
  readonly priceEffectiveAt: string;
  readonly rate: PriceRate;
}

function instant(timestamp: string): number {
  return new Date(TimestampSchema.parse(timestamp)).getTime();
}

export function millisecondsInUtcMonth(timestamp: string): bigint {
  const value = new Date(TimestampSchema.parse(timestamp));
  const start = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1);
  const end = Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1);
  return BigInt(end - start);
}

export function validatePriceVersionHistory(input: readonly unknown[]): PriceVersion[] {
  const versions = input.map((version) => PriceVersionSchema.parse(version));
  const identifiers = new Set<string>();
  let previousInstant: number | undefined;
  for (const version of versions) {
    const effectiveInstant = instant(version.effectiveAt);
    if (
      identifiers.has(version.versionId) ||
      (previousInstant !== undefined && effectiveInstant <= previousInstant)
    ) {
      throw new Error(
        "Price versions must have unique identifiers and strictly increasing effective times",
      );
    }
    identifiers.add(version.versionId);
    previousInstant = effectiveInstant;
  }
  return versions;
}

export function selectEffectivePriceVersion(
  versionsInput: readonly unknown[],
  occurredAt: string,
): PriceVersion {
  const occurred = instant(occurredAt);
  const versions = validatePriceVersionHistory(versionsInput);
  const selected = versions.filter((version) => instant(version.effectiveAt) <= occurred).at(-1);
  if (!selected) throw new NoEffectivePriceVersionError();
  return selected;
}

function rateDenominator(metric: UsageMetric, rate: PriceRate, occurredAt: string): bigint {
  const unitQuantity = parseUnsignedInteger(rate.unitQuantity);
  if (metric === "s3-storage-byte-milliseconds") {
    if (rate.unit !== "GB-Mo") throw new Error("Storage price must use GB-Mo");
    return unitQuantity * BINARY_GIB_BYTES * millisecondsInUtcMonth(occurredAt);
  }
  if (metric === "s3-download-bytes-out") {
    if (rate.unit !== "GB") throw new Error("Outbound transfer price must use GB");
    return unitQuantity * BINARY_GIB_BYTES;
  }
  const expectedUnit = metric === "cloudtrail-s3-data-events" ? "Events" : "Requests";
  if (rate.unit !== expectedUnit) throw new Error(`Metric ${metric} must use ${expectedUnit}`);
  return unitQuantity;
}

export function calculateUsageCharge(input: {
  readonly version: unknown;
  readonly metric: UsageMetric;
  readonly quantityAtoms: bigint;
  readonly occurredAt: string;
}): CalculatedUsageCharge {
  const version = PriceVersionSchema.parse(input.version);
  const metric = UsageMetricSchema.parse(input.metric);
  const occurredAt = TimestampSchema.parse(input.occurredAt);
  if (instant(version.effectiveAt) > instant(occurredAt)) throw new NoEffectivePriceVersionError();
  const quantityAtoms = assertDynamoInteger(input.quantityAtoms);
  const rate = version.rates.find((candidate) => candidate.metric === metric);
  if (!rate) throw new Error(`Price version does not contain ${metric}`);
  const rateAtoms = parseUnsignedDecimalToAtoms(rate.usdPerUnit, USD_SCALE);
  const costAtoms = multiplyDivideHalfUp(
    quantityAtoms,
    rateAtoms,
    rateDenominator(metric, rate, occurredAt),
  );
  return Object.freeze({
    metric,
    quantityAtoms,
    costAtoms,
    priceVersionId: version.versionId,
    priceEffectiveAt: version.effectiveAt,
    rate: Object.freeze({ ...rate }),
  });
}
