import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";

export const SERVICE_NAME = "utility-services";

export const logger = new Logger({ serviceName: SERVICE_NAME });
export const tracer = new Tracer({
  serviceName: SERVICE_NAME,
  captureHTTPsRequests: false,
});
export const metrics = new Metrics({
  namespace: "UtilityServices",
  serviceName: SERVICE_NAME,
});

export const safeLogger = {
  info(message: string, attributes?: Record<string, unknown>): void {
    if (attributes) {
      logger.info(message, attributes);
    } else {
      logger.info(message);
    }
  },
  error(message: string, attributes?: Record<string, unknown>): void {
    if (attributes) {
      logger.error(message, attributes);
    } else {
      logger.error(message);
    }
  },
};
