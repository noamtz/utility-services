import {
  ErrorEnvelopeSchema,
  createSuccessEnvelopeSchema,
  type ValidationDetail,
} from "@utility-services/contracts";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

import { getAuthoritativeRequestId } from "../observability/request-context.js";
import { redactSensitiveValues } from "../observability/redact.js";
import { createInvocationMetrics } from "../observability/metrics.js";

type AnySchema = z.ZodType;
type MaybePromise<T> = T | Promise<T>;
type SchemaOutput<TSchema extends AnySchema | undefined> = TSchema extends AnySchema
  ? z.output<TSchema>
  : undefined;

export interface SafeLogger {
  info(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

export interface ParsedHttpRequest<
  TPath extends AnySchema | undefined,
  TQuery extends AnySchema | undefined,
  THeaders extends AnySchema | undefined,
  TBody extends AnySchema | undefined,
  TAuthorization = undefined,
> {
  requestId: string;
  path: SchemaOutput<TPath>;
  query: SchemaOutput<TQuery>;
  headers: SchemaOutput<THeaders>;
  body: SchemaOutput<TBody>;
  authorization: TAuthorization;
}

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly safeMessage: string;
  public readonly details: ValidationDetail[] | undefined;
  public readonly retryAfterSeconds: number | undefined;

  public constructor(
    statusCode: number,
    code: string,
    safeMessage: string,
    details?: ValidationDetail[],
    retryAfterSeconds?: number,
  ) {
    super(safeMessage);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.safeMessage = safeMessage;
    this.details = details;
    this.retryAfterSeconds =
      retryAfterSeconds === undefined
        ? undefined
        : z.number().int().min(1).max(86_400).parse(retryAfterSeconds);
  }
}

const GatewayEventSchema = z
  .object({
    requestContext: z
      .object({
        requestId: z.string(),
        http: z
          .object({
            method: z.string(),
            path: z.string(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    pathParameters: z.record(z.string(), z.string()).nullish(),
    queryStringParameters: z.record(z.string(), z.string()).nullish(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().nullish(),
    isBase64Encoded: z.boolean().optional(),
  })
  .passthrough();

interface HandlerSchemas<
  TPath extends AnySchema | undefined,
  TQuery extends AnySchema | undefined,
  THeaders extends AnySchema | undefined,
  TBody extends AnySchema | undefined,
  TResponse extends AnySchema,
> {
  path?: TPath;
  query?: TQuery;
  headers?: THeaders;
  body?: TBody;
  response: TResponse;
}

interface HandlerOptions<
  TPath extends AnySchema | undefined,
  TQuery extends AnySchema | undefined,
  THeaders extends AnySchema | undefined,
  TBody extends AnySchema | undefined,
  TResponse extends AnySchema,
  TAuthorization,
> {
  schemas: HandlerSchemas<TPath, TQuery, THeaders, TBody, TResponse>;
  callback: (
    request: ParsedHttpRequest<TPath, TQuery, THeaders, TBody, TAuthorization>,
  ) => MaybePromise<z.input<TResponse>>;
  deriveAuthorization?: (
    gatewayEvent: z.output<typeof GatewayEventSchema>,
  ) => MaybePromise<TAuthorization>;
  successStatusCode?: number;
  logger?: SafeLogger;
}

type SuccessRenderer<TResponse extends AnySchema> = (
  data: z.input<TResponse>,
  requestId: string,
  responseSchema: TResponse,
) => APIGatewayProxyStructuredResultV2;

function toDetails(section: string, error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    path: [section, ...issue.path.map(String)].filter(Boolean).join("."),
    message: issue.message,
  }));
}

function parseJsonBody(body: string | null | undefined, isBase64Encoded: boolean): unknown {
  if (body == null || body === "") {
    return undefined;
  }

  const decoded = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed", [
      { path: "body", message: "Body must contain valid JSON" },
    ]);
  }
}

function parseSection(schema: AnySchema | undefined, value: unknown, section: string): unknown {
  if (!schema) {
    return undefined;
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Request validation failed",
      toDetails(section, result.error),
    );
  }

  return result.data;
}

function jsonResponse(
  statusCode: number,
  requestId: string,
  body: unknown,
  headers?: Record<string, string>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(error: HttpError, requestId: string): APIGatewayProxyStructuredResultV2 {
  const errorBody = {
    error: {
      code: error.code,
      message: error.safeMessage,
      ...(error.details ? { details: error.details } : {}),
    },
    requestId,
  };
  return jsonResponse(error.statusCode, requestId, ErrorEnvelopeSchema.parse(errorBody), {
    ...(error.retryAfterSeconds === undefined
      ? {}
      : { "retry-after": String(error.retryAfterSeconds) }),
  });
}

function createBoundaryHandler<
  TPath extends AnySchema | undefined,
  TQuery extends AnySchema | undefined,
  THeaders extends AnySchema | undefined,
  TBody extends AnySchema | undefined,
  TResponse extends AnySchema,
  TAuthorization,
>(
  options: HandlerOptions<TPath, TQuery, THeaders, TBody, TResponse, TAuthorization>,
  successStatusCode: number,
  renderSuccess: SuccessRenderer<TResponse>,
) {
  return async (event: unknown): Promise<APIGatewayProxyStructuredResultV2> => {
    const requestId = getAuthoritativeRequestId(event);
    const invocationMetrics = createInvocationMetrics("HttpApi");

    try {
      const eventResult = GatewayEventSchema.safeParse(event);
      if (!eventResult.success) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Request validation failed",
          toDetails("event", eventResult.error),
        );
      }

      const gatewayEvent = eventResult.data;
      options.logger?.info("http.request.started", {
        requestId,
        method: gatewayEvent.requestContext.http?.method,
        path: gatewayEvent.requestContext.http?.path,
      });

      const authorization = options.deriveAuthorization
        ? await options.deriveAuthorization(gatewayEvent)
        : (undefined as TAuthorization);

      const request = {
        requestId,
        path: parseSection(options.schemas.path, gatewayEvent.pathParameters ?? {}, "path"),
        query: parseSection(
          options.schemas.query,
          gatewayEvent.queryStringParameters ?? {},
          "query",
        ),
        headers: parseSection(options.schemas.headers, gatewayEvent.headers ?? {}, "headers"),
        body: parseSection(
          options.schemas.body,
          parseJsonBody(gatewayEvent.body, gatewayEvent.isBase64Encoded ?? false),
          "body",
        ),
        authorization,
      } as ParsedHttpRequest<TPath, TQuery, THeaders, TBody, TAuthorization>;

      const data = await options.callback(request);
      const response = renderSuccess(data, requestId, options.schemas.response);
      options.logger?.info("http.request.completed", { requestId, statusCode: successStatusCode });
      invocationMetrics.count("HttpRequest", "Success");
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        options.logger?.info("http.request.rejected", {
          requestId,
          statusCode: error.statusCode,
          code: error.code,
        });
        invocationMetrics.count("HttpRequest", "Rejected");
        if (error.statusCode === 401) {
          invocationMetrics.count("ProjectAuthenticationFailure", "Rejected");
        }
        if (error.statusCode === 429 && error.code === "RATE_LIMIT_EXCEEDED") {
          invocationMetrics.count("ProjectRateLimitRejection", "Rejected");
        }
        return errorResponse(error, requestId);
      }

      options.logger?.error("http.request.failed", {
        requestId,
        failure: redactSensitiveValues({
          type: error instanceof Error ? "exception" : typeof error,
        }),
      });
      invocationMetrics.count("HttpInternalFailure", "Failed");
      return errorResponse(
        new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred"),
        requestId,
      );
    } finally {
      invocationMetrics.flush();
    }
  };
}

export function createHttpHandler<
  TPath extends AnySchema | undefined = undefined,
  TQuery extends AnySchema | undefined = undefined,
  THeaders extends AnySchema | undefined = undefined,
  TBody extends AnySchema | undefined = undefined,
  TResponse extends AnySchema = AnySchema,
  TAuthorization = undefined,
>(options: HandlerOptions<TPath, TQuery, THeaders, TBody, TResponse, TAuthorization>) {
  const successStatusCode = options.successStatusCode ?? 200;
  if (!Number.isInteger(successStatusCode) || successStatusCode < 200 || successStatusCode > 299) {
    throw new RangeError("successStatusCode must be an integer between 200 and 299");
  }

  return createBoundaryHandler(options, successStatusCode, (data, requestId, responseSchema) => {
    const envelope = createSuccessEnvelopeSchema(responseSchema).parse({ data, requestId });
    return jsonResponse(successStatusCode, requestId, envelope);
  });
}

export function createHttpRedirectHandler<
  TPath extends AnySchema | undefined = undefined,
  TQuery extends AnySchema | undefined = undefined,
  THeaders extends AnySchema | undefined = undefined,
  TBody extends AnySchema | undefined = undefined,
  TAuthorization = undefined,
>(options: HandlerOptions<TPath, TQuery, THeaders, TBody, z.ZodType<string>, TAuthorization>) {
  const successStatusCode = 302;
  return createBoundaryHandler(options, successStatusCode, (data, requestId, responseSchema) => ({
    statusCode: successStatusCode,
    headers: {
      location: responseSchema.parse(data),
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
    body: "",
  }));
}
