import { afterEach, describe, expect, it, vi } from "vitest";

import { createObservabilityResources } from "./observability.js";

function output<T>(value: T): SstOutput<T> {
  return { apply: (callback) => output(callback(value)) };
}

afterEach(() => vi.unstubAllGlobals());

describe("observability resources", () => {
  it("creates no topic or alarms outside production", () => {
    const Topic = vi.fn();
    const MetricAlarm = vi.fn();
    vi.stubGlobal("aws", { sns: { Topic }, cloudwatch: { MetricAlarm } });
    const resources = createObservabilityResources({
      production: false,
      stage: "dev-rus02",
      apiId: output("api-id"),
      functions: [],
      meteringQueue: { id: "metering", queueName: output("metering") },
      deadLetterQueues: [],
    });
    expect(resources).toMatchObject({ alarms: [], subscriptionRequired: false });
    expect(Topic).not.toHaveBeenCalled();
    expect(MetricAlarm).not.toHaveBeenCalled();
  });

  it("creates encrypted production alerting for custom, API, Lambda, queue, and DLQ signals", () => {
    const topicCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const alarmCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    class Topic {
      public readonly arn = output("alert-topic-arn");
      public constructor(name: string, args: Record<string, unknown>) {
        topicCalls.push({ name, args });
      }
    }
    class MetricAlarm {
      public constructor(name: string, args: Record<string, unknown>) {
        alarmCalls.push({ name, args });
      }
    }
    vi.stubGlobal("aws", { sns: { Topic }, cloudwatch: { MetricAlarm } });
    const resources = createObservabilityResources({
      production: true,
      stage: "production",
      apiId: output("api-id"),
      functions: [
        { id: "FunctionA", functionName: output("function-a") },
        { id: "FunctionB", functionName: output("function-b") },
      ],
      meteringQueue: { id: "Metering", queueName: output("metering-queue") },
      deadLetterQueues: [
        { id: "MeteringDlq", queueName: output("metering-dlq") },
        { id: "FileDlq", queueName: output("file-dlq") },
      ],
    });

    expect(topicCalls).toEqual([
      {
        name: "ProductionAlertTopic",
        args: {
          name: "utility-services-production-alerts",
          kmsMasterKeyId: "alias/aws/sns",
        },
      },
    ]);
    expect(resources.subscriptionRequired).toBe(true);
    expect(alarmCalls).toHaveLength(20);
    expect(alarmCalls.every((call) => call.args["period"] === 300)).toBe(true);
    expect(
      alarmCalls.every(
        (call) => (call.args["alarmActions"] as unknown[])[0] === resources.topic?.arn,
      ),
    ).toBe(true);
    expect(alarmCalls.find((call) => call.name === "ApiUnexpectedVolume")?.args).toMatchObject({
      metricName: "Count",
      threshold: 1_200,
    });
    expect(alarmCalls.find((call) => call.name === "DownloadMeteringQueueAge")?.args).toMatchObject(
      {
        metricName: "ApproximateAgeOfOldestMessage",
        threshold: 900,
        evaluationPeriods: 2,
      },
    );
    expect(
      alarmCalls.find((call) => call.name === "MeteringFreshnessCheckFailure")?.args,
    ).toMatchObject({
      comparisonOperator: "LessThanThreshold",
      treatMissingData: "breaching",
    });
    expect(
      alarmCalls.filter((call) => /Function[AB](?:Errors|Throttles)/u.test(call.name)),
    ).toHaveLength(4);
    expect(JSON.stringify({ topicCalls, alarmCalls })).not.toMatch(/subscription|email|phone/u);
  });
});
