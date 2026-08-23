/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  async app(input) {
    const { createAppPolicy } = await import("./infra/config/app.js");
    const policy = createAppPolicy(input.stage);
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
    const [
      { createApi },
      { createControlResources },
      { createDashboard },
      { createUsagePricingResources },
    ] = await Promise.all([
      import("./infra/api.js"),
      import("./infra/control.js"),
      import("./infra/dashboard.js"),
      import("./infra/usage-pricing.js"),
    ]);
    const control = createControlResources({ production: $app.stage === "production" });
    const usagePricing = createUsagePricingResources({ production: $app.stage === "production" });
    const api = createApi(control);
    const dashboard = createDashboard({
      apiUrl: api.url,
      userPoolId: control.userPool.id,
      userPoolClientId: control.userPoolClient.id,
    });
    return {
      apiUrl: api.url,
      dashboardUrl: dashboard.url,
      ownerUserPoolId: control.userPool.id,
      dashboardClientId: control.userPoolClient.id,
      controlTableName: control.table.name,
      usagePricingTableName: usagePricing.table.name,
    };
  },
});
