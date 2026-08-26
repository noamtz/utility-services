import { request, type APIRequestContext, type APIResponse } from "@playwright/test";

import {
  DeleteFileResponseSchema,
  DownloadAuthorizationResponseSchema,
  ErrorEnvelopeSchema,
  FileListResponseSchema,
  FileResponseSchema,
  UploadAuthorizationResponseSchema,
  type File,
  type UploadAuthorization,
} from "@utility-services/contracts";

const FORBIDDEN_PUBLIC_EVIDENCE =
  /(?:arn:aws|amazonaws\.com|\b\d{12}\b|bucket(?:name)?|internalProjectId|object[-_ ]?key|(?:object|project)[-_ ]?prefix|PROJECT#|FILE#|secretHash|stack|X-Amz-|projects\/|authorization|bearer|credential|token|secret|rus_v1\.|eyJ[A-Za-z0-9_-]{10,}|signature=|https?:\/\/[^"\s?]+\?|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|(?:error|exception):)/iu;

export interface FileJourneyContexts {
  api: APIRequestContext;
  publicApi: APIRequestContext;
  transfer: APIRequestContext;
}

export async function createFileJourneyContexts(
  apiUrl: string,
  apiKey: string,
): Promise<FileJourneyContexts> {
  const api = await request.newContext({
    baseURL: apiUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${apiKey}` },
  });
  const publicApi = await request.newContext({ baseURL: apiUrl });
  const transfer = await request.newContext();
  return { api, publicApi, transfer };
}

export async function disposeFileJourneyContexts(contexts: FileJourneyContexts): Promise<void> {
  await Promise.all([
    contexts.api.dispose(),
    contexts.publicApi.dispose(),
    contexts.transfer.dispose(),
  ]);
}

async function parseJson(response: APIResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Release API returned a non-JSON response");
  }
}

export async function expectPublicError(
  response: APIResponse,
  status: number,
  allowedCodes?: readonly string[],
): Promise<string> {
  if (response.status() !== status) throw new Error("Release API returned an unexpected status");
  if (response.headers()["location"])
    throw new Error("Denied request exposed a redirect capability");
  const parsed = ErrorEnvelopeSchema.safeParse(await parseJson(response));
  if (!parsed.success) throw new Error("Release API error did not use the shared envelope");
  const serialized = JSON.stringify(parsed.data);
  if (FORBIDDEN_PUBLIC_EVIDENCE.test(serialized)) {
    throw new Error("Release API error exposed forbidden implementation evidence");
  }
  if (allowedCodes && !allowedCodes.includes(parsed.data.error.code)) {
    throw new Error("Release API returned an unexpected public error code");
  }
  return parsed.data.error.code;
}

export async function authorizeUpload(
  context: APIRequestContext,
  input: { name: string; mediaType: string; content: Buffer; visibility: "private" | "public" },
): Promise<UploadAuthorization> {
  const response = await context.post("/v1/files/uploads", {
    data: {
      name: input.name,
      mediaType: input.mediaType,
      sizeBytes: input.content.byteLength,
      visibility: input.visibility,
    },
  });
  if (response.status() !== 201) throw new Error("Upload authorization failed");
  const parsed = UploadAuthorizationResponseSchema.safeParse(await parseJson(response));
  if (!parsed.success) throw new Error("Upload authorization response was invalid");
  return parsed.data.data;
}

export async function putAuthorizedUpload(
  transfer: APIRequestContext,
  authorization: UploadAuthorization,
  content: Buffer,
): Promise<void> {
  const response = await transfer.put(authorization.upload.url, {
    data: content,
    headers: authorization.upload.requiredHeaders,
  });
  if (!response.ok()) throw new Error("Direct upload transfer failed");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pollReadyFile(
  context: APIRequestContext,
  fileId: string,
  timeoutSeconds: number,
): Promise<File> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const response = await context.get(`/v1/files/${encodeURIComponent(fileId)}`);
    if (response.status() !== 200)
      throw new Error("File inspection failed while polling completion");
    const parsed = FileResponseSchema.safeParse(await parseJson(response));
    if (!parsed.success) throw new Error("File inspection response was invalid");
    if (parsed.data.data.status === "ready") return parsed.data.data;
    if (parsed.data.data.status === "failed")
      throw new Error("Upload completion entered failed state");
    await delay(1_000);
  }
  throw new Error("Upload completion exceeded the bounded acceptance timeout");
}

export async function listFiles(context: APIRequestContext): Promise<File[]> {
  const response = await context.get("/v1/files?limit=20");
  if (response.status() !== 200) throw new Error("File list failed");
  const parsed = FileListResponseSchema.safeParse(await parseJson(response));
  if (!parsed.success) throw new Error("File list response was invalid");
  return parsed.data.data.items;
}

export async function authorizePrivateDownload(
  context: APIRequestContext,
  fileId: string,
): Promise<string> {
  const response = await context.post(`/v1/files/${encodeURIComponent(fileId)}/downloads`);
  if (response.status() !== 200) throw new Error("Private download authorization failed");
  const parsed = DownloadAuthorizationResponseSchema.safeParse(await parseJson(response));
  if (!parsed.success) throw new Error("Private download authorization response was invalid");
  return parsed.data.data.download.url;
}

export async function downloadOpaqueTransfer(
  transfer: APIRequestContext,
  url: string,
): Promise<Buffer> {
  const response = await transfer.get(url);
  if (!response.ok()) throw new Error("Opaque download transfer failed");
  return response.body();
}

export function expectExpiredTransfer(response: APIResponse): void {
  if (response.status() !== 403) {
    throw new Error("Expired transfer capability did not return the expected denial");
  }
}

export async function stablePublicRedirect(
  publicApi: APIRequestContext,
  publicProjectId: string,
  publicFileId: string,
): Promise<string> {
  const response = await publicApi.get(
    `/files/public/${encodeURIComponent(publicProjectId)}/${encodeURIComponent(publicFileId)}`,
    { maxRedirects: 0 },
  );
  if (response.status() !== 302) throw new Error("Stable public access did not redirect");
  if (response.headers()["cache-control"] !== "no-store") {
    throw new Error("Stable public access lost its no-store policy");
  }
  const location = response.headers()["location"];
  if (!location?.startsWith("https://"))
    throw new Error("Stable public redirect was not opaque HTTPS");
  return location;
}

export async function trashFile(context: APIRequestContext, fileId: string): Promise<void> {
  const response = await context.delete(`/v1/files/${encodeURIComponent(fileId)}`);
  if (response.status() !== 200) throw new Error("File trash transition failed");
  const parsed = DeleteFileResponseSchema.safeParse(await parseJson(response));
  if (!parsed.success || parsed.data.data.disposition !== "trashed") {
    throw new Error("File trash response was invalid");
  }
}

export async function restoreFile(context: APIRequestContext, fileId: string): Promise<File> {
  const response = await context.post(`/v1/files/${encodeURIComponent(fileId)}/restore`);
  if (response.status() !== 200) throw new Error("File restore transition failed");
  const parsed = FileResponseSchema.safeParse(await parseJson(response));
  if (!parsed.success || parsed.data.data.status !== "ready") {
    throw new Error("File restore response was invalid");
  }
  return parsed.data.data;
}

export async function forceDeleteFile(
  context: APIRequestContext,
  fileId: string,
  timeoutSeconds = 90,
): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const response = await context.delete(`/v1/files/${encodeURIComponent(fileId)}?force=true`);
    if (response.status() !== 200) throw new Error("File force deletion failed");
    const parsed = DeleteFileResponseSchema.safeParse(await parseJson(response));
    if (!parsed.success) throw new Error("File force deletion response was invalid");
    if (parsed.data.data.disposition === "purged") return;
    if (parsed.data.data.disposition !== "purge-pending") {
      throw new Error("File force deletion response was invalid");
    }
    await delay(1_000);
  }
  throw new Error("File force deletion exceeded the bounded acceptance timeout");
}

export async function bestEffortForceDelete(
  context: APIRequestContext | undefined,
  fileIds: readonly string[],
): Promise<boolean> {
  if (!context) return fileIds.length === 0;
  let complete = true;
  for (const fileId of fileIds) {
    try {
      const response = await context.delete(`/v1/files/${encodeURIComponent(fileId)}?force=true`);
      if (![200, 404].includes(response.status())) complete = false;
    } catch {
      complete = false;
    }
  }
  return complete;
}
