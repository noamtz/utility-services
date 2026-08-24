interface SstOutput<T> {
  apply<U>(callback: (value: T) => U): SstOutput<U>;
}

declare const $interpolate: (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => SstOutput<string>;

declare const $app: { readonly stage: string };

interface ComponentResourceOptions {
  readonly dependsOn?: unknown[];
  readonly parent?: unknown;
}

declare namespace aws.iam {
  function getPolicyDocumentOutput(args: {
    statements: Array<{
      sid?: string;
      effect?: "Allow" | "Deny";
      actions: readonly string[];
      resources: readonly (SstOutput<string> | string)[];
      principals: Array<{ type: string; identifiers: readonly string[] }>;
      conditions?: Array<{
        test: string;
        variable: string;
        values: readonly (SstOutput<string> | string)[];
      }>;
    }>;
  }): { json: SstOutput<string> };
}

declare namespace aws.s3 {
  class BucketPolicy {
    public constructor(
      name: string,
      args: { bucket: SstOutput<string> | string; policy: SstOutput<string> | string },
      options?: ComponentResourceOptions,
    );
  }

  class BucketNotification {
    public constructor(
      name: string,
      args: {
        bucket: SstOutput<string> | string;
        queues: Array<{
          id?: string;
          events: string[];
          filterPrefix?: string;
          filterSuffix?: string;
          queueArn: SstOutput<string> | string;
        }>;
      },
      options?: ComponentResourceOptions,
    );
  }
}

declare namespace aws.sqs {
  class QueuePolicy {
    public constructor(
      name: string,
      args: { queueUrl: SstOutput<string> | string; policy: SstOutput<string> | string },
      options?: ComponentResourceOptions,
    );
  }
}

declare namespace aws.cloudtrail {
  class Trail {
    public readonly arn: SstOutput<string>;
    public constructor(
      name: string,
      args: {
        name: string;
        s3BucketName: SstOutput<string> | string;
        advancedEventSelectors:
          | SstOutput<
              Array<{
                name?: string;
                fieldSelectors: ReadonlyArray<{
                  field: string;
                  equals?: readonly string[];
                  startsWiths?: readonly string[];
                }>;
              }>
            >
          | Array<{
              name?: string;
              fieldSelectors: ReadonlyArray<{
                field: string;
                equals?: readonly string[];
                startsWiths?: readonly string[];
              }>;
            }>;
        enableLogFileValidation?: boolean;
        enableLogging?: boolean;
        includeGlobalServiceEvents?: boolean;
        isMultiRegionTrail?: boolean;
        isOrganizationTrail?: boolean;
      },
      options?: ComponentResourceOptions,
    );
  }
}

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
      environment?: Record<string, string | SstOutput<string>>;
      link?: unknown[];
      memory?: `${number} MB` | `${number} GB`;
      permissions?: Array<{ actions: string[]; resources: unknown[] }>;
      timeout?: `${number} seconds` | `${number} minutes`;
      transform?: { function?: { tracingConfig?: { mode: "Active" | "PassThrough" } } };
    }

    class Function {
      public constructor(
        name: string,
        args: FunctionDefinition,
        options?: ComponentResourceOptions,
      );
      public readonly name: SstOutput<string>;
      public readonly arn: SstOutput<string>;
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
      lifecycle?: Array<{
        id?: string;
        prefix?: string;
        enabled?: boolean;
        expiresIn?: `${number} days`;
      }>;
      policy?: Array<{
        actions: readonly string[];
        effect?: "allow" | "deny";
        principals:
          | "*"
          | Array<{
              type: "aws" | "service" | "federated" | "canonical";
              identifiers: readonly string[];
            }>;
        paths?: readonly string[];
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
        filterSuffix?: string;
        function?: FunctionDefinition;
        queue?: Queue | SstOutput<string> | string;
      }>;
    }

    class Bucket {
      public constructor(name: string, args?: BucketArgs);
      public readonly name: SstOutput<string>;
      public readonly arn: SstOutput<string>;
      public readonly nodes: { bucket: unknown };
      public notify(args: BucketNotificationArgs): unknown;
    }

    interface QueueArgs {
      fifo?: boolean;
      visibilityTimeout?: `${number} seconds` | `${number} minutes` | `${number} hours`;
      dlq?: SstOutput<string> | string | { queue: SstOutput<string> | string; retry: number };
      transform?: {
        queue?: (args: {
          messageRetentionSeconds?: number;
          sqsManagedSseEnabled?: boolean;
        }) => void;
      };
    }

    interface QueueSubscriberArgs {
      batch?: { size?: number; window?: `${number} seconds`; partialResponses?: boolean };
    }

    class Queue {
      public constructor(name: string, args?: QueueArgs, options?: ComponentResourceOptions);
      public readonly arn: SstOutput<string>;
      public readonly url: SstOutput<string>;
      public subscribe(
        subscriber: SstOutput<string> | string | FunctionDefinition,
        args?: QueueSubscriberArgs,
        options?: ComponentResourceOptions,
      ): unknown;
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
