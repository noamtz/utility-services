import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../core/observability/powertools.js";
import { createDynamoProjectRepository } from "../identity-control/projects/repository.js";
import { createProjectAuthenticationRuntime } from "../project-authentication/runtime.js";
import { createUsagePricingRuntime } from "../usage-pricing/runtime.js";
import { createDownloadService } from "./downloads.js";
import {
  createAuthorizeDownloadHandler,
  createAuthorizeUploadHandler,
  createDeleteFileHandler,
  createInspectFileHandler,
  createListFilesHandler,
  createPublicDownloadHandler,
  createRestoreFileHandler,
} from "./handlers.js";
import { createFileLifecycleService, type LifecycleUsageService } from "./lifecycle.js";
import { createS3ObjectStore, type ObjectStore } from "./object-store.js";
import {
  createS3DownloadPresigner,
  createS3UploadPresigner,
  type DownloadPresigner,
  type UploadPresigner,
} from "./presigning.js";
import { createDynamoFileRepository, FILE_DOCUMENT_CLIENT_OPTIONS } from "./repository.js";
import { createFileService } from "./service.js";

export function createFileApiRuntime(options: {
  readonly controlTableName: string;
  readonly fileTableName: string;
  readonly bucketName?: string;
  readonly uploadPresigner?: UploadPresigner;
  readonly downloadPresigner?: DownloadPresigner;
}) {
  const controlTableName = z.string().trim().min(1).parse(options.controlTableName);
  const fileTableName = z.string().trim().min(1).parse(options.fileTableName);
  const bucketName = options.bucketName
    ? z.string().trim().min(1).parse(options.bucketName)
    : undefined;
  if (!bucketName && (!options.uploadPresigner || !options.downloadPresigner)) {
    throw new Error("File API runtime requires a bucket or both transfer presigners");
  }
  const controlClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const fileClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({}),
    FILE_DOCUMENT_CLIENT_OPTIONS,
  );
  const authentication = createProjectAuthenticationRuntime({
    tableName: controlTableName,
    documentClient: controlClient,
  });
  const repository = createDynamoFileRepository({
    client: fileClient,
    tableName: fileTableName,
    publicIndexName: "PublicFiles",
    lifecycleIndexName: "FileLifecycle",
  });
  const projects = createDynamoProjectRepository({
    client: controlClient,
    tableName: controlTableName,
  });
  const s3 = bucketName ? new S3Client({}) : undefined;
  const presigner =
    options.uploadPresigner ?? createS3UploadPresigner({ client: s3!, bucketName: bucketName! });
  const downloadPresigner =
    options.downloadPresigner ??
    createS3DownloadPresigner({ client: s3!, bucketName: bucketName! });
  const service = createFileService({ repository, presigner });
  const downloads = createDownloadService({ repository, projects, presigner: downloadPresigner });
  return Object.freeze({ authentication, repository, projects, service, downloads });
}

export function createFileWorkerRuntime(options: {
  readonly fileTableName: string;
  readonly usageTableName: string;
  readonly bucketName: string;
}) {
  const fileTableName = z.string().trim().min(1).parse(options.fileTableName);
  const usageTableName = z.string().trim().min(1).parse(options.usageTableName);
  const bucketName = z.string().trim().min(1).parse(options.bucketName);
  const dynamo = new DynamoDBClient({});
  const fileClient = DynamoDBDocumentClient.from(dynamo, FILE_DOCUMENT_CLIENT_OPTIONS);
  const repository = createDynamoFileRepository({
    client: fileClient,
    tableName: fileTableName,
    publicIndexName: "PublicFiles",
    lifecycleIndexName: "FileLifecycle",
  });
  const objectStore = createS3ObjectStore({ client: new S3Client({}), bucketName });
  const usage = createUsagePricingRuntime({ tableName: usageTableName });
  return Object.freeze({ repository, objectStore, usage, bucketName });
}

export function createFileLifecycleRuntime(options: {
  readonly controlTableName: string;
  readonly fileTableName: string;
  readonly objectStore: ObjectStore;
  readonly usage: LifecycleUsageService;
}) {
  const controlTableName = z.string().trim().min(1).parse(options.controlTableName);
  const fileTableName = z.string().trim().min(1).parse(options.fileTableName);
  const controlClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const fileClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({}),
    FILE_DOCUMENT_CLIENT_OPTIONS,
  );
  const authentication = createProjectAuthenticationRuntime({
    tableName: controlTableName,
    documentClient: controlClient,
  });
  const repository = createDynamoFileRepository({
    client: fileClient,
    tableName: fileTableName,
    publicIndexName: "PublicFiles",
    lifecycleIndexName: "FileLifecycle",
  });
  const lifecycle = createFileLifecycleService({
    repository,
    objectStore: options.objectStore,
    usage: options.usage,
  });
  return Object.freeze({ authentication, repository, lifecycle });
}

let apiRuntime: ReturnType<typeof createFileApiRuntime> | undefined;

let transferRuntime:
  Readonly<{ uploadPresigner: UploadPresigner; downloadPresigner: DownloadPresigner }> | undefined;

function getFileTransferRuntime() {
  if (!transferRuntime) {
    const bucketName = Resource.FileBucket.name;
    const client = new S3Client({});
    transferRuntime = Object.freeze({
      uploadPresigner: createS3UploadPresigner({ client, bucketName }),
      downloadPresigner: createS3DownloadPresigner({ client, bucketName }),
    });
  }
  return transferRuntime;
}

export function getFileApiRuntime() {
  apiRuntime ??= createFileApiRuntime({
    controlTableName: Resource.ControlTable.name,
    fileTableName: Resource.FileTable.name,
    uploadPresigner: {
      authorizePut: (input) => getFileTransferRuntime().uploadPresigner.authorizePut(input),
    },
    downloadPresigner: {
      authorizeGet: (input) => getFileTransferRuntime().downloadPresigner.authorizeGet(input),
    },
  });
  return apiRuntime;
}

let workerRuntime: ReturnType<typeof createFileWorkerRuntime> | undefined;

export function getFileWorkerRuntime() {
  workerRuntime ??= createFileWorkerRuntime({
    fileTableName: Resource.FileTable.name,
    usageTableName: Resource.UsagePricingTable.name,
    bucketName: Resource.FileBucket.name,
  });
  return workerRuntime;
}

let lifecycleRuntime: ReturnType<typeof createFileLifecycleRuntime> | undefined;

export function getFileLifecycleRuntime() {
  lifecycleRuntime ??= createFileLifecycleRuntime({
    controlTableName: Resource.ControlTable.name,
    fileTableName: Resource.FileTable.name,
    objectStore: {
      head: (objectKey) => getFileWorkerRuntime().objectStore.head(objectKey),
      delete: (objectKey) => getFileWorkerRuntime().objectStore.delete(objectKey),
    },
    usage: {
      closeStorage: (input) => getFileWorkerRuntime().usage.closeStorage(input),
    },
  });
  return lifecycleRuntime;
}

export function getFileHandlers() {
  const composed = getFileApiRuntime();
  return Object.freeze({
    authorizeUpload: createAuthorizeUploadHandler(
      composed.service,
      composed.authentication,
      safeLogger,
    ),
    listFiles: createListFilesHandler(composed.service, composed.authentication, safeLogger),
    inspectFile: createInspectFileHandler(composed.service, composed.authentication, safeLogger),
    authorizeDownload: createAuthorizeDownloadHandler(
      composed.downloads,
      composed.authentication,
      safeLogger,
    ),
    publicDownload: createPublicDownloadHandler(composed.downloads, safeLogger),
  });
}

export function getFileLifecycleHandlers() {
  const composed = getFileLifecycleRuntime();
  return Object.freeze({
    deleteFile: createDeleteFileHandler(composed.lifecycle, composed.authentication, safeLogger),
    restoreFile: createRestoreFileHandler(composed.lifecycle, composed.authentication, safeLogger),
  });
}
