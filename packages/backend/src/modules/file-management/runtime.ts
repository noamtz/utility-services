import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import { z } from "zod";

import { safeLogger } from "../../core/observability/powertools.js";
import { createProjectAuthenticationRuntime } from "../project-authentication/runtime.js";
import { createUsagePricingRuntime } from "../usage-pricing/runtime.js";
import {
  createAuthorizeUploadHandler,
  createInspectFileHandler,
  createListFilesHandler,
} from "./handlers.js";
import { createS3ObjectStore } from "./object-store.js";
import { createS3UploadPresigner } from "./presigning.js";
import { createDynamoFileRepository, FILE_DOCUMENT_CLIENT_OPTIONS } from "./repository.js";
import { createFileService } from "./service.js";

export function createFileApiRuntime(options: {
  readonly controlTableName: string;
  readonly fileTableName: string;
  readonly bucketName: string;
}) {
  const controlTableName = z.string().trim().min(1).parse(options.controlTableName);
  const fileTableName = z.string().trim().min(1).parse(options.fileTableName);
  const bucketName = z.string().trim().min(1).parse(options.bucketName);
  const dynamo = new DynamoDBClient({});
  const controlClient = DynamoDBDocumentClient.from(dynamo, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const fileClient = DynamoDBDocumentClient.from(dynamo, FILE_DOCUMENT_CLIENT_OPTIONS);
  const authentication = createProjectAuthenticationRuntime({
    tableName: controlTableName,
    documentClient: controlClient,
  });
  const repository = createDynamoFileRepository({
    client: fileClient,
    tableName: fileTableName,
    lifecycleIndexName: "FileLifecycle",
  });
  const s3 = new S3Client({});
  const presigner = createS3UploadPresigner({ client: s3, bucketName });
  const service = createFileService({ repository, presigner });
  return Object.freeze({ authentication, repository, service });
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
    lifecycleIndexName: "FileLifecycle",
  });
  const objectStore = createS3ObjectStore({ client: new S3Client({}), bucketName });
  const usage = createUsagePricingRuntime({ tableName: usageTableName });
  return Object.freeze({ repository, objectStore, usage, bucketName });
}

let apiRuntime: ReturnType<typeof createFileApiRuntime> | undefined;

export function getFileApiRuntime() {
  apiRuntime ??= createFileApiRuntime({
    controlTableName: Resource.ControlTable.name,
    fileTableName: Resource.FileTable.name,
    bucketName: Resource.FileBucket.name,
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
  });
}
