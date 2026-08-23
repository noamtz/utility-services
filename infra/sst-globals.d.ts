interface SstOutput<T> {
  apply<U>(callback: (value: T) => U): SstOutput<U>;
}

declare const $interpolate: (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => SstOutput<string>;

declare namespace aws.cloudfront {
  class CachePolicy {
    public constructor(
      name: string,
      args: {
        minTtl: number;
        defaultTtl: number;
        maxTtl: number;
        parametersInCacheKeyAndForwardedToOrigin: {
          enableAcceptEncodingBrotli: boolean;
          enableAcceptEncodingGzip: boolean;
          cookiesConfig: { cookieBehavior: "none" };
          headersConfig: { headerBehavior: "none" };
          queryStringsConfig: { queryStringBehavior: "none" };
        };
      },
    );
    public readonly id: SstOutput<string>;
  }

  class OriginRequestPolicy {
    public constructor(
      name: string,
      args: {
        cookiesConfig: { cookieBehavior: "none" };
        headersConfig: { headerBehavior: "whitelist"; headers: { items: string[] } };
        queryStringsConfig: {
          queryStringBehavior: "whitelist";
          queryStrings: { items: string[] };
        };
      },
    );
    public readonly id: SstOutput<string>;
  }
}

declare namespace aws.dynamodb {
  interface TableItemArgs {
    tableName: SstOutput<string> | string;
    hashKey: string;
    rangeKey?: string;
    item: string;
  }

  interface TableItemOptions {
    retainOnDelete?: boolean;
    ignoreChanges?: string[];
  }

  class TableItem {
    public constructor(name: string, args: TableItemArgs, options?: TableItemOptions);
  }
}

declare namespace sst {
  class Linkable {
    public static wrap<T>(
      resource: { new (...args: never[]): T },
      callback: (value: T) => {
        properties: Record<string, unknown>;
        include: unknown[];
      },
    ): void;
  }

  namespace aws {
    function permission(args: { actions: string[]; resources: unknown[] }): unknown;

    interface FunctionDefinition {
      handler: string;
      runtime: "nodejs24.x";
      link?: unknown[];
      permissions?: Array<{ actions: string[]; resources: unknown[] }>;
      transform?: { function?: { tracingConfig?: { mode: "Active" | "PassThrough" } } };
    }

    interface RouteArgs {
      name?: string;
      auth?: { jwt: { authorizer: SstOutput<string> } };
    }

    class ApiGatewayV2 {
      public constructor(name: string, args: { cors: boolean });
      public readonly url: SstOutput<string>;
      public route(route: string, handler: string | FunctionDefinition, args?: RouteArgs): unknown;
      public addAuthorizer(args: {
        name: string;
        jwt: { issuer: SstOutput<string>; audiences: SstOutput<string>[] };
      }): { id: SstOutput<string> };
    }

    interface CognitoUserPoolArgs {
      usernames: Array<"email" | "phone">;
      transform?: {
        userPool?: (args: {
          adminCreateUserConfig?: { allowAdminCreateUserOnly?: boolean };
        }) => void;
      };
    }

    interface CognitoUserPoolClientArgs {
      transform?: {
        client?: (args: {
          generateSecret?: boolean;
          allowedOauthFlowsUserPoolClient?: boolean;
          allowedOauthFlows?: string[];
          allowedOauthScopes?: string[];
          callbackUrls?: string[];
          logoutUrls?: string[];
          explicitAuthFlows?: string[];
          preventUserExistenceErrors?: string;
        }) => void;
      };
    }

    class CognitoUserPoolClient {
      public readonly id: SstOutput<string>;
    }

    class CognitoUserPool {
      public constructor(name: string, args: CognitoUserPoolArgs);
      public readonly id: SstOutput<string>;
      public readonly arn: SstOutput<string>;
      public addClient(name: string, args: CognitoUserPoolClientArgs): CognitoUserPoolClient;
    }

    interface DynamoArgs {
      fields: Record<string, "string" | "number" | "binary">;
      primaryIndex: { hashKey: string; rangeKey?: string };
      globalIndexes?: Record<
        string,
        { hashKey: string; rangeKey?: string; projection?: "all" | "keys-only" | string[] }
      >;
      deletionProtection?: boolean;
      ttl?: string;
    }

    class Dynamo {
      public constructor(name: string, args: DynamoArgs);
      public readonly name: SstOutput<string>;
      public readonly arn: SstOutput<string>;
    }

    interface BucketArgs {
      cors?: false;
      enforceHttps?: boolean;
      policy?: Array<{
        actions: readonly string[];
        effect?: "allow" | "deny";
        principals: "*";
        conditions?: ReadonlyArray<{
          test: string;
          variable: string;
          values: readonly string[];
        }>;
      }>;
      transform?: {
        bucket?: (args: { forceDestroy?: boolean }) => void;
        publicAccessBlock?: (args: {
          blockPublicAcls?: boolean;
          blockPublicPolicy?: boolean;
          ignorePublicAcls?: boolean;
          restrictPublicBuckets?: boolean;
        }) => void;
      };
    }

    interface BucketNotificationArgs {
      notifications: Array<{
        name: string;
        events: Array<"s3:ObjectCreated:Put">;
        filterPrefix: string;
        function: FunctionDefinition;
      }>;
    }

    class Bucket {
      public constructor(name: string, args?: BucketArgs);
      public readonly name: SstOutput<string>;
      public readonly arn: SstOutput<string>;
      public notify(args: BucketNotificationArgs): unknown;
    }

    class Cron {
      public constructor(
        name: string,
        args: { schedule: `rate(${string})` | `cron(${string})`; function: FunctionDefinition },
      );
    }

    interface DistributionOrigin {
      originId: string;
      domainName: string | SstOutput<string>;
      customOriginConfig: {
        httpPort: number;
        httpsPort: number;
        originProtocolPolicy: "https-only";
        originSslProtocols: string[];
      };
    }

    interface DistributionCacheBehavior {
      pathPattern: string;
      targetOriginId: string;
      viewerProtocolPolicy: "redirect-to-https";
      allowedMethods: string[];
      cachedMethods: string[];
      compress: boolean;
      cachePolicyId: SstOutput<string>;
      originRequestPolicyId: SstOutput<string>;
    }

    interface StaticSiteArgs {
      path: string;
      build: { command: string; output: string };
      environment?: Record<string, SstOutput<string>>;
      transform?: {
        cdn?: (args: {
          origins: DistributionOrigin[];
          orderedCacheBehaviors?: DistributionCacheBehavior[];
        }) => void;
      };
    }

    class StaticSite {
      public constructor(name: string, args: StaticSiteArgs);
      public readonly url: SstOutput<string>;
    }
  }
}
