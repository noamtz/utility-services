import {
  PriceVersionSchema,
  USAGE_METRICS,
  type PriceRate,
  type PriceSource,
  type PriceVersion,
} from "@utility-services/contracts";

export const USAGE_PRICING_TABLE_COMPONENT_NAME = "UsagePricingTable";
export const USAGE_PRICING_TTL_ATTRIBUTE = "expiresAt";
export const USAGE_WATERMARK_INDEX_NAME = "UsageWatermarkFreshness";
export const USAGE_FRESHNESS_MONITOR_COMPONENT_NAME = "UsageFreshnessMonitor";
export const USAGE_FRESHNESS_MONITOR_SCHEDULE = "rate(5 minutes)";
export const USAGE_FRESHNESS_STALE_AFTER_SECONDS = 24 * 60 * 60;
export const USAGE_FRESHNESS_SOURCE_KINDS = ["cloudtrail-download"] as const;
export const USAGE_PRICING_TABLE_LINK_ACTIONS = ["dynamodb:Query"] as const;
export const CURRENT_MONTH_USAGE_CONTROL_ROUTE = {
  name: "GetCurrentMonthUsageRoute",
  route: "GET /v1/control/projects/{projectId}/usage/current-month",
  handler: "packages/backend/src/functions/control/get-current-month-usage.handler",
} as const;

export const USAGE_PRICING_TABLE_POLICY = {
  billingMode: "PAY_PER_REQUEST",
  fields: { pk: "string", sk: "string", gsi1pk: "string", gsi1sk: "string" },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  ttl: USAGE_PRICING_TTL_ATTRIBUTE,
  globalIndexes: {
    [USAGE_WATERMARK_INDEX_NAME]: { hashKey: "gsi1pk", rangeKey: "gsi1sk", projection: "all" },
  },
} as const;

export const PRICE_SERVICE_PAGE_CROSS_CHECKS = [
  "https://aws.amazon.com/s3/pricing/",
  "https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer",
  "https://aws.amazon.com/cloudtrail/pricing/",
] as const;

const AMAZON_S3_SOURCE: PriceSource = {
  url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/index.json",
  publicationDate: "2026-08-18T18:11:13.000Z",
  version: "20260818181113",
  sha256: "db4d624b864898103444dfbed7af76beb33087195d6814331f1ece6e58a97b32",
};

const AWS_DATA_TRANSFER_SOURCE: PriceSource = {
  url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/index.json",
  publicationDate: "2026-07-20T18:46:45.000Z",
  version: "20260720184645",
  sha256: "31d6c55839cd94cab241375e6fea959bdfe393e642232de46f8d796c4159e9f4",
};

const AWS_CLOUDTRAIL_SOURCE: PriceSource = {
  url: "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSCloudTrail/current/index.json",
  publicationDate: "2026-07-16T21:50:01.000Z",
  version: "20260716215001",
  sha256: "5851b806e3e44358a2a676e678e905b51dd85a9bc872d41e253fb75604a9b488",
};

const CURRENT_RATES: PriceRate[] = [
  {
    metric: "s3-storage-byte-milliseconds",
    serviceCode: "AmazonS3",
    productFamily: "Storage",
    sku: "RJ7BUHG2D92QSTS3",
    rateCode: "RJ7BUHG2D92QSTS3.JRTCKXETXF.PGHJ3S3EYE",
    unit: "GB-Mo",
    unitQuantity: "1",
    beginRange: "0",
    endRange: "51200",
    usdPerUnit: "0.025",
    sourcePricePerUnitUsd: "0.0250000000",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    description: "$0.025 per GB - first 50 TB / month of S3 Standard storage used",
  },
  {
    metric: "s3-upload-requests",
    serviceCode: "AmazonS3",
    productFamily: "API Request",
    sku: "Q2RMUYRD6HY2B5CD",
    rateCode: "Q2RMUYRD6HY2B5CD.JRTCKXETXF.6YS6EN2CT7",
    unit: "Requests",
    unitQuantity: "1000",
    beginRange: "0",
    endRange: "Inf",
    usdPerUnit: "0.0055",
    sourcePricePerUnitUsd: "0.0000055000",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    description: "$0.0055 per 1,000 S3 PUT, COPY, POST, or LIST requests",
  },
  {
    metric: "s3-download-requests",
    serviceCode: "AmazonS3",
    productFamily: "API Request",
    sku: "WD988PZJAZGRGP65",
    rateCode: "WD988PZJAZGRGP65.JRTCKXETXF.6YS6EN2CT7",
    unit: "Requests",
    unitQuantity: "10000",
    beginRange: "0",
    endRange: "Inf",
    usdPerUnit: "0.0044",
    sourcePricePerUnitUsd: "0.0000004400",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    description: "$0.0044 per 10,000 S3 GET and all other requests",
  },
  {
    metric: "s3-download-bytes-out",
    serviceCode: "AWSDataTransfer",
    productFamily: "Data Transfer",
    sku: "CMEYEEYC485JXPYQ",
    rateCode: "CMEYEEYC485JXPYQ.JRTCKXETXF.Q3Z75P77EN",
    unit: "GB",
    unitQuantity: "1",
    beginRange: "0",
    endRange: "10240",
    usdPerUnit: "0.11",
    sourcePricePerUnitUsd: "0.1100000000",
    effectiveAt: "2026-06-01T00:00:00.000Z",
    description:
      "$0.110 per GB for the first 10 TB per month outbound beyond the excluded global free tier",
  },
  {
    metric: "cloudtrail-s3-data-events",
    serviceCode: "AWSCloudTrail",
    productFamily: "Management Tools - AWS CloudTrail Data Events Recorded",
    sku: "BTY5KZ6BGX64ARHX",
    rateCode: "BTY5KZ6BGX64ARHX.JRTCKXETXF.6YS6EN2CT7",
    unit: "Events",
    unitQuantity: "100000",
    beginRange: "0",
    endRange: "Inf",
    usdPerUnit: "0.1",
    sourcePricePerUnitUsd: "0.0000010000",
    effectiveAt: "2026-07-01T00:00:00.000Z",
    description: "$0.10 per 100,000 CloudTrail data events delivered to S3",
  },
];

export const PRICE_VERSIONS: readonly PriceVersion[] = Object.freeze([
  PriceVersionSchema.parse({
    versionId: "aws-il-central-1-2026-08-01",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    publishedAt: AMAZON_S3_SOURCE.publicationDate,
    currency: "USD",
    productRegion: "il-central-1",
    rates: CURRENT_RATES,
    sources: [AMAZON_S3_SOURCE, AWS_DATA_TRANSFER_SOURCE, AWS_CLOUDTRAIL_SOURCE],
  }),
]);

export function usagePricingTableDeletionProtection(production: boolean): boolean {
  return production;
}

export function validateAppendOnlyPriceVersions(input: readonly unknown[]): PriceVersion[] {
  const versions = input.map((version) => PriceVersionSchema.parse(version));
  let previous = "";
  const ids = new Set<string>();
  for (const version of versions) {
    if (ids.has(version.versionId) || version.effectiveAt <= previous) {
      throw new Error("Pricing history must be append-only with unique, ascending identities");
    }
    ids.add(version.versionId);
    previous = version.effectiveAt;
  }
  return versions;
}

type AttributeValue =
  { S: string } | { L: AttributeValue[] } | { M: Record<string, AttributeValue> };

function stringMap(value: Record<string, string>): { M: Record<string, AttributeValue> } {
  return { M: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, { S: item }])) };
}

export function pricingVersionSortKey(version: PriceVersion): string {
  return `VERSION#${version.effectiveAt}#${version.versionId}`;
}

export function toPriceSeedItem(input: unknown): string {
  const version = PriceVersionSchema.parse(input);
  const item: Record<string, AttributeValue> = {
    pk: { S: "PRICING" },
    sk: { S: pricingVersionSortKey(version) },
    itemType: { S: "price-version" },
    versionId: { S: version.versionId },
    effectiveAt: { S: version.effectiveAt },
    publishedAt: { S: version.publishedAt },
    currency: { S: version.currency },
    productRegion: { S: version.productRegion },
    rates: { L: version.rates.map((rate) => stringMap(rate)) },
    sources: { L: version.sources.map((source) => stringMap(source)) },
  };
  return JSON.stringify(item);
}

validateAppendOnlyPriceVersions(PRICE_VERSIONS);
if (new Set(PRICE_VERSIONS[0]?.rates.map((rate) => rate.metric)).size !== USAGE_METRICS.length) {
  throw new Error("Published price version is incomplete");
}
