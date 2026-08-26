import {
  ALERT_TOPIC_COMPONENT_NAME,
  CUSTOM_ALARM_POLICIES,
  OBSERVABILITY_NAMESPACE,
  OBSERVABILITY_PERIOD_SECONDS,
  OBSERVABILITY_THRESHOLDS,
} from "./config/observability.js";

interface FunctionMetricTarget {
  readonly id: string;
  readonly functionName: SstOutput<string>;
}

interface QueueMetricTarget {
  readonly id: string;
  readonly queueName: SstOutput<string>;
}

export function createObservabilityResources(options: {
  readonly production: boolean;
  readonly stage: string;
  readonly apiId: SstOutput<string>;
  readonly functions: readonly FunctionMetricTarget[];
  readonly meteringQueue: QueueMetricTarget;
  readonly deadLetterQueues: readonly QueueMetricTarget[];
}) {
  if (!options.production) {
    return Object.freeze({ topic: undefined, alarms: [], subscriptionRequired: false as const });
  }

  const topic = new aws.sns.Topic(ALERT_TOPIC_COMPONENT_NAME, {
    name: `utility-services-${options.stage}-alerts`,
    kmsMasterKeyId: "alias/aws/sns",
  });
  const alarmActions = [topic.arn];
  const alarms: aws.cloudwatch.MetricAlarm[] = [];
  const createAlarm = (id: string, args: Record<string, unknown>) => {
    const alarm = new aws.cloudwatch.MetricAlarm(id, {
      actionsEnabled: true,
      alarmActions,
      insufficientDataActions: [],
      okActions: [],
      period: OBSERVABILITY_PERIOD_SECONDS,
      statistic: "Sum",
      datapointsToAlarm: args["evaluationPeriods"],
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      ...args,
      alarmDescription: `${id}: investigate the component logs and runbook before changing service state.`,
    });
    alarms.push(alarm);
  };

  for (const policy of CUSTOM_ALARM_POLICIES) {
    createAlarm(policy.id, {
      namespace: OBSERVABILITY_NAMESPACE,
      metricName: policy.metricName,
      dimensions: {
        service: "utility-services",
        Stage: options.stage,
        Operation: policy.operation,
        Outcome: policy.outcome,
      },
      threshold: policy.threshold,
      evaluationPeriods: policy.evaluationPeriods,
      comparisonOperator: policy.comparisonOperator ?? "GreaterThanOrEqualToThreshold",
      treatMissingData: policy.treatMissingData,
    });
  }

  createAlarm("ApiUnexpectedVolume", {
    namespace: "AWS/ApiGateway",
    metricName: "Count",
    dimensions: { ApiId: options.apiId },
    threshold: OBSERVABILITY_THRESHOLDS.apiRequests,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching",
  });
  createAlarm("ApiServerErrors", {
    namespace: "AWS/ApiGateway",
    metricName: "5xx",
    dimensions: { ApiId: options.apiId },
    threshold: OBSERVABILITY_THRESHOLDS.apiServerErrors,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching",
  });

  for (const target of options.functions) {
    for (const metricName of ["Errors", "Throttles"] as const) {
      createAlarm(`${target.id}${metricName}`, {
        namespace: "AWS/Lambda",
        metricName,
        dimensions: { FunctionName: target.functionName },
        threshold:
          metricName === "Errors"
            ? OBSERVABILITY_THRESHOLDS.lambdaErrors
            : OBSERVABILITY_THRESHOLDS.lambdaThrottles,
        evaluationPeriods: 1,
        treatMissingData: "notBreaching",
      });
    }
  }

  createAlarm("DownloadMeteringQueueAge", {
    namespace: "AWS/SQS",
    metricName: "ApproximateAgeOfOldestMessage",
    dimensions: { QueueName: options.meteringQueue.queueName },
    threshold: OBSERVABILITY_THRESHOLDS.meteringQueueAgeSeconds,
    evaluationPeriods: 2,
    treatMissingData: "notBreaching",
  });
  for (const target of options.deadLetterQueues) {
    createAlarm(`${target.id}VisibleMessages`, {
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensions: { QueueName: target.queueName },
      threshold: OBSERVABILITY_THRESHOLDS.deadLetterMessages,
      evaluationPeriods: 1,
      treatMissingData: "notBreaching",
    });
  }

  return Object.freeze({ topic, alarms, subscriptionRequired: true as const });
}
