import { MetricUnit } from "@aws-lambda-powertools/metrics";
import { z } from "zod";

import { metrics } from "./powertools.js";

type MetricUnitValue = (typeof MetricUnit)[keyof typeof MetricUnit];

export const OperationalMetricNameSchema = z.enum([
  "HttpRequest",
  "ProjectAuthenticationFailure",
  "ProjectRateLimitRejection",
  "HttpInternalFailure",
  "FileWorkerProcessed",
  "FileWorkerFailure",
  "DownloadMeteringProcessed",
  "DownloadMeteringFailure",
  "DownloadMeteringQuarantine",
  "DownloadMeteringDuplicate",
  "MeteringStaleWatermarks",
  "MeteringIncompleteWatermarks",
  "MeteringFreshnessCheckSuccess",
]);

const DimensionValueSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/u);
const StageDimensionSchema = z.string().trim().min(1).max(128);
const SstAppResourceSchema = z
  .object({
    stage: StageDimensionSchema,
  })
  .passthrough();

export function resolveMetricsStage(environment: NodeJS.ProcessEnv = process.env): string {
  const explicitStage = environment["SST_STAGE"];
  if (explicitStage !== undefined) return StageDimensionSchema.parse(explicitStage);

  const appResource = environment["SST_RESOURCE_App"];
  if (appResource !== undefined) {
    return SstAppResourceSchema.parse(JSON.parse(appResource) as unknown).stage;
  }

  return "local";
}

export interface MetricsClient {
  addDimension(name: string, value: string): unknown;
  addMetric(name: string, unit: MetricUnitValue, value: number): unknown;
  publishStoredMetrics(): unknown;
  clearMetrics(): void;
}

export interface InvocationMetrics {
  count(name: z.infer<typeof OperationalMetricNameSchema>, outcome: string, value?: number): void;
  gauge(name: z.infer<typeof OperationalMetricNameSchema>, outcome: string, value: number): void;
  flush(): void;
}

interface PendingMetric {
  readonly name: z.infer<typeof OperationalMetricNameSchema>;
  readonly outcome: string;
  readonly value: number;
  readonly unit: MetricUnitValue;
}

export function createInvocationMetrics(
  operationInput: string,
  client: MetricsClient = metrics,
  stageInput = resolveMetricsStage(),
): InvocationMetrics {
  const operation = DimensionValueSchema.parse(operationInput);
  const stage = StageDimensionSchema.parse(stageInput);
  const pending: PendingMetric[] = [];

  function add(
    nameInput: z.infer<typeof OperationalMetricNameSchema>,
    outcomeInput: string,
    valueInput: number,
    unit: MetricUnitValue,
  ) {
    const name = OperationalMetricNameSchema.parse(nameInput);
    const outcome = DimensionValueSchema.parse(outcomeInput);
    const value = z.number().finite().nonnegative().parse(valueInput);
    pending.push({ name, outcome, value, unit });
  }

  const invocation: InvocationMetrics = Object.freeze({
    count(name: z.infer<typeof OperationalMetricNameSchema>, outcome: string, value = 1) {
      add(name, outcome, value, MetricUnit.Count);
    },
    gauge(name: z.infer<typeof OperationalMetricNameSchema>, outcome: string, value: number) {
      add(name, outcome, value, MetricUnit.Count);
    },
    flush() {
      try {
        for (const item of pending.splice(0)) {
          client.clearMetrics();
          client.addDimension("Stage", stage);
          client.addDimension("Operation", operation);
          client.addDimension("Outcome", item.outcome);
          client.addMetric(item.name, item.unit, item.value);
          client.publishStoredMetrics();
        }
      } finally {
        pending.length = 0;
        client.clearMetrics();
      }
    },
  });
  return invocation;
}
