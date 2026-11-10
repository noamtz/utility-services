/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  async app(input) {
    const { createAppPolicy } = await import("./infra/config/app.js");
    const { resolveSstAppInstallation } = await import("./infra/config/installation-target.js");
    const installation = resolveSstAppInstallation(input.stage, process.env);
    const policy = createAppPolicy(installation.name, installation.stage.name);
    return {
      name: policy.name,
      home: policy.home,
      providers: {
        aws: {
          region: policy.provider.region,
          version: policy.provider.version,
        },
      },
      removal: policy.removal,
      protect: policy.protect,
    };
  },
  async run() {
    const { resolveInstallationEnvironment } =
      await import("./infra/config/installation-target.js");
    const installation = resolveInstallationEnvironment($app.stage, process.env);
    const [
      { createApi },
      { createControlResources },
      { createDashboard },
      { createDownloadMeteringResources },
      { createFileManagementResources },
      { createObservabilityResources },
      { createUsagePricingResources },
    ] = await Promise.all([
      import("./infra/api.js"),
      import("./infra/control.js"),
      import("./infra/dashboard.js"),
      import("./infra/download-metering.js"),
      import("./infra/file-management.js"),
      import("./infra/observability.js"),
      import("./infra/usage-pricing.js"),
    ]);
    const control = createControlResources({ production: $app.stage === "production" });
    const usagePricing = createUsagePricingResources({
      production: $app.stage === "production",
      installation,
    });
    const files = createFileManagementResources({
      production: $app.stage === "production",
      controlTable: control.table,
      usageTable: usagePricing.table,
    });
    const downloadMetering = createDownloadMeteringResources({
      production: $app.stage === "production",
      installation,
      fileBucket: files.bucket,
      usageTable: usagePricing.table,
    });
    const api = createApi(control, installation.region, usagePricing, files);
    const dashboard = createDashboard({
      apiUrl: api.url,
      userPoolId: control.userPool.id,
      userPoolClientId: control.userPoolClient.id,
    });
    const observability = createObservabilityResources({
      production: $app.stage === "production",
      stage: $app.stage,
      apiId: api.api.nodes.api.id,
      functions: [
        ...api.routes.map((route, index) => ({
          id: `ApiRoute${String(index + 1).padStart(2, "0")}`,
          functionName: route.nodes.function.apply((fn) => fn.name),
        })),
        { id: "FileUploadCompletion", functionName: files.completionWorker.name },
        {
          id: "FileUploadReconciliation",
          functionName: files.reconciler.nodes.function.apply((fn) => fn.name),
        },
        {
          id: "FileTrashPurge",
          functionName: files.purge.nodes.function.apply((fn) => fn.name),
        },
        { id: "DownloadMetering", functionName: downloadMetering.processor.name },
        {
          id: "UsageFreshnessMonitor",
          functionName: usagePricing.freshnessMonitor.nodes.function.apply((fn) => fn.name),
        },
      ],
      meteringQueue: {
        id: "DownloadMeteringQueue",
        queueName: downloadMetering.queue.nodes.queue.name,
      },
      deadLetterQueues: [
        {
          id: "DownloadMeteringDeadLetterQueue",
          queueName: downloadMetering.deadLetterQueue.nodes.queue.name,
        },
        {
          id: "FileOperationsDeadLetterQueue",
          queueName: files.operationsDlq.nodes.queue.name,
        },
      ],
    });
    return {
      stage: $app.stage,
      installationTarget: installation.name,
      apiUrl: api.url,
      dashboardUrl: dashboard.url,
      ownerUserPoolId: control.userPool.id,
      dashboardClientId: control.userPoolClient.id,
      controlTableName: control.table.name,
      usagePricingTableName: usagePricing.table.name,
      fileTableName: files.table.name,
      downloadMeteringProcessorName: downloadMetering.processor.name,
      downloadMeteringLogBucketName: downloadMetering.logBucket.name,
      downloadMeteringQueueUrl: downloadMetering.queue.url,
      downloadMeteringDeadLetterQueueUrl: downloadMetering.deadLetterQueue.url,
      alertTopicArn: observability.topic?.arn ?? "not-created-for-stage",
      alertSubscriptionRequired: observability.subscriptionRequired,
    };
  },
});
