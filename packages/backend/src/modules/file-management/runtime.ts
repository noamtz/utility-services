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

export function createFileManagementRuntime(options: {
  readonly controlTableName: string;
  readonly fileTableName: string;
  readonly usageTableName: string;
  readonly bucketName: string;
}) {
  const controlTableName = z.string().trim().min(1).parse(options.controlTableName);
  const fileTableName = z.string().trim().min(1).parse(options.fileTableName);
  const usageTableName = z.string().trim().min(1).parse(options.usageTableName);
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
  const objectStore = createS3ObjectStore({ client: s3, bucketName });
  const usage = createUsagePricingRuntime({ tableName: usageTableName });
  const service = createFileService({ repository, presigner });
  return Object.freeze({
    authentication,
    repository,
    objectStore,
    usage,
    service,
    bucketName,
  });
}

let runtime: ReturnType<typeof createFileManagementRuntime> | undefined;

export function getFileManagementRuntime() {
  runtime ??= createFileManagementRuntime({
    controlTableName: Resource.ControlTable.name,
    fileTableName: Resource.FileTable.name,
    usageTableName: Resource.UsagePricingTable.name,
    bucketName: Resource.FileBucket.name,
  });
  return runtime;
}

export function getFileHandlers() {
  const composed = getFileManagementRuntime();
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
