declare namespace sst.aws {
  interface FunctionDefinition {
    handler: string;
    runtime: "nodejs24.x";
    transform?: {
      function?: {
        tracingConfig?: { mode: "Active" | "PassThrough" };
      };
    };
  }

  class ApiGatewayV2 {
    public constructor(name: string, args: { cors: boolean });
    public readonly url: unknown;
    public route(
      route: string,
      handler: string | FunctionDefinition,
      args?: { name?: string },
    ): unknown;
  }

  interface StaticSiteArgs {
    path: string;
    build: {
      command: string;
      output: string;
    };
  }

  class StaticSite {
    public constructor(name: string, args: StaticSiteArgs);
    public readonly url: unknown;
  }
}
