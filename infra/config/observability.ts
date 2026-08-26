export const ALERT_TOPIC_COMPONENT_NAME = "ProductionAlertTopic";
export const OBSERVABILITY_NAMESPACE = "UtilityServices";
export const OBSERVABILITY_PERIOD_SECONDS = 300;

export const OBSERVABILITY_THRESHOLDS = Object.freeze({
  authenticationFailures: 5,
  rateLimitRejections: 1,
  internalFailures: 1,
  asyncFailures: 1,
  quarantine: 1,
  staleWatermarks: 1,
  incompleteWatermarks: 1,
  apiRequests: 1_200,
  apiServerErrors: 1,
  lambdaErrors: 1,
  lambdaThrottles: 1,
  meteringQueueAgeSeconds: 900,
  deadLetterMessages: 1,
});

export interface CustomAlarmPolicy {
  readonly id: string;
  readonly metricName: string;
  readonly operation: string;
  readonly outcome: string;
  readonly threshold: number;
  readonly evaluationPeriods: number;
  readonly comparisonOperator?: "GreaterThanOrEqualToThreshold" | "LessThanThreshold";
  readonly treatMissingData: "notBreaching" | "breaching";
}

export const CUSTOM_ALARM_POLICIES: readonly CustomAlarmPolicy[] = Object.freeze([
  {
    id: "ProjectAuthenticationFailures",
    metricName: "ProjectAuthenticationFailure",
    operation: "HttpApi",
    outcome: "Rejected",
    threshold: OBSERVABILITY_THRESHOLDS.authenticationFailures,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching",
  },
  {
    id: "ProjectRateLimitRejections",
    metricName: "ProjectRateLimitRejection",
    operation: "HttpApi",
    outcome: "Rejected",
    threshold: OBSERVABILITY_THRESHOLDS.rateLimitRejections,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching",
  },
  {
    id: "HttpInternalFailures",
    metricName: "HttpInternalFailure",
    operation: "HttpApi",
    outcome: "Failed",
    threshold: OBSERVABILITY_THRESHOLDS.internalFailures,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching",
  },
  ...["FileUploadCompletion", "FileUploadReconciliation", "FileTrashPurge"].map((operation) => ({
    id: `${operation}Failures`,
    metricName: "FileWorkerFailure",
    operation,
    outcome: "Failed",
    threshold: OBSERVABILITY_THRESHOLDS.asyncFailures,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching" as const,
  })),
  {
    id: "DownloadMeteringFailures",
    metricName: "DownloadMeteringFailure",
    operation: "DownloadMetering",
    outcome: "Failed",
    threshold: OBSERVABILITY_THRESHOLDS.asyncFailures,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching",
  },
  {
    id: "DownloadMeteringQuarantine",
    metricName: "DownloadMeteringQuarantine",
    operation: "DownloadMetering",
    outcome: "Quarantined",
    threshold: OBSERVABILITY_THRESHOLDS.quarantine,
    evaluationPeriods: 1,
    treatMissingData: "notBreaching",
  },
  {
    id: "MeteringFreshnessCheckFailure",
    metricName: "MeteringFreshnessCheckSuccess",
    operation: "MeteringFreshnessMonitor",
    outcome: "Checked",
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: "LessThanThreshold",
    treatMissingData: "breaching",
  },
  {
    id: "MeteringStaleWatermarks",
    metricName: "MeteringStaleWatermarks",
    operation: "MeteringFreshnessMonitor",
    outcome: "Checked",
    threshold: OBSERVABILITY_THRESHOLDS.staleWatermarks,
    evaluationPeriods: 2,
    treatMissingData: "breaching",
  },
  {
    id: "MeteringIncompleteWatermarks",
    metricName: "MeteringIncompleteWatermarks",
    operation: "MeteringFreshnessMonitor",
    outcome: "Checked",
    threshold: OBSERVABILITY_THRESHOLDS.incompleteWatermarks,
    evaluationPeriods: 2,
    treatMissingData: "breaching",
  },
]);
