import { createUploadCompletionService } from "./completion.js";
import { createFileLifecycleService } from "./lifecycle.js";
import { getFileWorkerRuntime } from "./runtime.js";
import {
  createInvocationMetrics,
  type InvocationMetrics,
} from "../../core/observability/metrics.js";
import { safeLogger } from "../../core/observability/powertools.js";
import type { SafeLogger } from "../../core/http/handler.js";

let service: ReturnType<typeof createUploadCompletionService> | undefined;
let lifecycle: ReturnType<typeof createFileLifecycleService> | undefined;

function completionService() {
  if (!service) {
    const runtime = getFileWorkerRuntime();
    service = createUploadCompletionService({
      repository: runtime.repository,
      objectStore: runtime.objectStore,
      usage: runtime.usage,
      bucketName: runtime.bucketName,
    });
  }
  return service;
}

function lifecycleService() {
  if (!lifecycle) {
    const runtime = getFileWorkerRuntime();
    lifecycle = createFileLifecycleService({
      repository: runtime.repository,
      objectStore: runtime.objectStore,
      usage: runtime.usage,
    });
  }
  return lifecycle;
}

type FileWorkerResult = { readonly processed: number; readonly pages?: number };

export async function runFileWorker<T extends FileWorkerResult>(
  operation: "FileUploadCompletion" | "FileUploadReconciliation" | "FileTrashPurge",
  callback: () => Promise<T>,
  invocationMetrics: InvocationMetrics = createInvocationMetrics(operation),
  logger: SafeLogger = safeLogger,
): Promise<T> {
  logger.info("file.worker.started", { operation });
  try {
    const result = await callback();
    invocationMetrics.count("FileWorkerProcessed", "Success", result.processed);
    logger.info("file.worker.completed", {
      operation,
      processed: result.processed,
      ...(result.pages === undefined ? {} : { pages: result.pages }),
    });
    return result;
  } catch (error) {
    invocationMetrics.count("FileWorkerFailure", "Failed");
    logger.error("file.worker.failed", { operation });
    throw error;
  } finally {
    invocationMetrics.flush();
  }
}

export async function processUploadCompletion(event: unknown) {
  return runFileWorker("FileUploadCompletion", () => completionService().handleS3Event(event));
}

export async function reconcilePendingUploads() {
  return runFileWorker("FileUploadReconciliation", () => completionService().reconcileDue());
}

export async function purgeTrashedFiles() {
  return runFileWorker("FileTrashPurge", () => lifecycleService().purgeDue());
}
