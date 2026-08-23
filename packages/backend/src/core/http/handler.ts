import {
  ErrorEnvelopeSchema,
  createSuccessEnvelopeSchema,
  type ValidationDetail,
} from "@utility-services/contracts";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

import { getAuthoritativeRequestId } from "../observability/request-context.js";
import { redactSensitiveValues } from "../observability/redact.js";

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
> {
  requestId: string;
  path: SchemaOutput<TPath>;
  query: SchemaOutput<TQuery>;
  headers: SchemaOutput<THeaders>;
  body: SchemaOutput<TBody>;
}

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly safeMessage: string;
  public readonly details: ValidationDetail[] | undefined;

  public constructor(
    statusCode: number,
    code: string,
    safeMessage: string,
    details?: ValidationDetail[],
  ) {
    super(safeMessage);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.safeMessage = safeMessage;
    this.details = details;
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
> {
  schemas: HandlerSchemas<TPath, TQuery, THeaders, TBody, TResponse>;
  callback: (
    request: ParsedHttpRequest<TPath, TQuery, THeaders, TBody>,
  ) => MaybePromise<z.input<TResponse>>;
  logger?: SafeLogger;
}

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
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
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
  return jsonResponse(error.statusCode, requestId, ErrorEnvelopeSchema.parse(errorBody));
}

export function createHttpHandler<
  TPath extends AnySchema | undefined = undefined,
  TQuery extends AnySchema | undefined = undefined,
  THeaders extends AnySchema | undefined = undefined,
  TBody extends AnySchema | undefined = undefined,
  TResponse extends AnySchema = AnySchema,
>(options: HandlerOptions<TPath, TQuery, THeaders, TBody, TResponse>) {
  return async (event: unknown): Promise<APIGatewayProxyStructuredResultV2> => {
    const requestId = getAuthoritativeRequestId(event);

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
      } as ParsedHttpRequest<TPath, TQuery, THeaders, TBody>;

      const data = await options.callback(request);
      const envelope = createSuccessEnvelopeSchema(options.schemas.response).parse({
        data,
        requestId,
      });
      options.logger?.info("http.request.completed", { requestId, statusCode: 200 });
      return jsonResponse(200, requestId, envelope);
    } catch (error) {
      if (error instanceof HttpError) {
        options.logger?.info("http.request.rejected", {
          requestId,
          statusCode: error.statusCode,
          code: error.code,
        });
        return errorResponse(error, requestId);
      }

      options.logger?.error("http.request.failed", {
        requestId,
        failure: redactSensitiveValues({
          type: error instanceof Error ? "exception" : typeof error,
        }),
      });
      return errorResponse(
        new HttpError(500, "INTERNAL_ERROR", "An unexpected error occurred"),
        requestId,
      );
    }
  };
}
