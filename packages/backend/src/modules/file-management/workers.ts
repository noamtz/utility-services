import { createUploadCompletionService } from "./completion.js";
import { createFileLifecycleService } from "./lifecycle.js";
import { getFileWorkerRuntime } from "./runtime.js";

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

export async function processUploadCompletion(event: unknown) {
  return completionService().handleS3Event(event);
}

export async function reconcilePendingUploads() {
  return completionService().reconcileDue();
}

export async function purgeTrashedFiles() {
  return lifecycleService().purgeDue();
}
