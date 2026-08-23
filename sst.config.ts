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
    const [{ createApi }, { createDashboard }] = await Promise.all([
      import("./infra/api.js"),
      import("./infra/dashboard.js"),
    ]);
    const api = createApi();
    const dashboard = createDashboard();
    return {
      apiUrl: api.url,
      dashboardUrl: dashboard.url,
    };
  },
});
