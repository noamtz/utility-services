import { z } from "zod";

export const USAGE_METRICS = [
  "s3-storage-byte-milliseconds",
  "s3-upload-requests",
  "s3-download-requests",
  "s3-download-bytes-out",
  "cloudtrail-s3-data-events",
] as const;

export const UsageMetricSchema = z.enum(USAGE_METRICS);
export const UsageCurrencySchema = z.literal("USD");
export const UsagePeriodSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
export const CanonicalUnsignedDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u);
export const PublishedUnsignedDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/u);

export const USAGE_COST_LABEL = "AWS-equivalent usage cost" as const;
export const USAGE_COST_EXCLUSIONS = [
  "free-tiers",
  "discounts",
  "credits",
  "taxes",
  "shared-infrastructure",
] as const;

const TimestampSchema = z.iso.datetime({ offset: true });
const IdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);

export const PriceRateSchema = z
  .object({
    metric: UsageMetricSchema,
    serviceCode: z.enum(["AmazonS3", "AWSDataTransfer", "AWSCloudTrail"]),
    productFamily: z.string().trim().min(1).max(256),
    sku: z.string().regex(/^[A-Z0-9]{8,32}$/u),
    rateCode: z.string().regex(/^[A-Z0-9.]{8,128}$/u),
    unit: z.enum(["GB-Mo", "GB", "Requests", "Events"]),
    unitQuantity: z.string().regex(/^[1-9]\d*$/u),
    beginRange: PublishedUnsignedDecimalSchema,
    endRange: z.union([PublishedUnsignedDecimalSchema, z.literal("Inf")]),
    usdPerUnit: PublishedUnsignedDecimalSchema,
    sourcePricePerUnitUsd: PublishedUnsignedDecimalSchema,
    effectiveAt: TimestampSchema,
    description: z.string().trim().min(1).max(512),
  })
  .strict();

export const PriceSourceSchema = z
  .object({
    url: z.url().startsWith("https://"),
    publicationDate: TimestampSchema,
    version: z.string().regex(/^\d{14}$/u),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const PriceVersionSchema = z
  .object({
    versionId: IdentifierSchema,
    effectiveAt: TimestampSchema,
    publishedAt: TimestampSchema,
    currency: UsageCurrencySchema,
    productRegion: z.literal("il-central-1"),
    rates: z.array(PriceRateSchema).length(USAGE_METRICS.length),
    sources: z.array(PriceSourceSchema).min(1),
  })
  .strict()
  .superRefine((version, context) => {
    const metrics = version.rates.map((rate) => rate.metric);
    for (const metric of USAGE_METRICS) {
      if (metrics.filter((value) => value === metric).length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["rates"],
          message: `Price version must contain exactly one ${metric} rate`,
        });
      }
    }
  });

const SortedPriceVersionIdsSchema = z.array(IdentifierSchema).superRefine((values, context) => {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => value !== [...values].sort()[index])
  ) {
    context.addIssue({
      code: "custom",
      message: "Price version identifiers must be sorted and unique",
    });
  }
});

export const UsageMetricBreakdownSchema = z
  .object({
    metric: UsageMetricSchema,
    quantity: CanonicalUnsignedDecimalSchema,
    costUsd: CanonicalUnsignedDecimalSchema,
    priceVersionIds: SortedPriceVersionIdsSchema,
  })
  .strict();

export const MeteringFreshnessSchema = z
  .object({
    state: z.enum(["fresh", "stale", "incomplete", "not-yet-metered"]),
    lastMeteredAt: TimestampSchema.nullable(),
    evaluatedAt: TimestampSchema,
  })
  .strict();

export const MonthlyUsageProjectionSchema = z
  .object({
    label: z.literal(USAGE_COST_LABEL),
    currency: UsageCurrencySchema,
    period: UsagePeriodSchema,
    totalCostUsd: CanonicalUnsignedDecimalSchema,
    metrics: z.array(UsageMetricBreakdownSchema),
    priceVersionIds: SortedPriceVersionIdsSchema,
    exclusions: z.tuple([
      z.literal("free-tiers"),
      z.literal("discounts"),
      z.literal("credits"),
      z.literal("taxes"),
      z.literal("shared-infrastructure"),
    ]),
    freshness: MeteringFreshnessSchema,
  })
  .strict();

export type UsageMetric = z.infer<typeof UsageMetricSchema>;
export type PriceRate = z.infer<typeof PriceRateSchema>;
export type PriceSource = z.infer<typeof PriceSourceSchema>;
export type PriceVersion = z.infer<typeof PriceVersionSchema>;
export type UsageMetricBreakdown = z.infer<typeof UsageMetricBreakdownSchema>;
export type MeteringFreshness = z.infer<typeof MeteringFreshnessSchema>;
export type MonthlyUsageProjection = z.infer<typeof MonthlyUsageProjectionSchema>;
