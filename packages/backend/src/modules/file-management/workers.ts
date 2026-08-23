import { createUploadCompletionService } from "./completion.js";
import { getFileManagementRuntime } from "./runtime.js";

let service: ReturnType<typeof createUploadCompletionService> | undefined;

function completionService() {
  if (!service) {
    const runtime = getFileManagementRuntime();
    service = createUploadCompletionService({
      repository: runtime.repository,
      objectStore: runtime.objectStore,
      usage: runtime.usage,
      bucketName: runtime.bucketName,
    });
  }
  return service;
}

export async function processUploadCompletion(event: unknown) {
  return completionService().handleS3Event(event);
}

export async function reconcilePendingUploads() {
  return completionService().reconcileDue();
}
