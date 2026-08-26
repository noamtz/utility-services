import {
  DownloadAuthorizationSchema,
  type DownloadAuthorization,
  type FileManagementSettings,
  type TrustedProjectContext,
} from "@utility-services/contracts";

import { HttpError } from "../../core/http/handler.js";
import type { FileItem } from "./model.js";
import type { DownloadPresigner } from "./presigning.js";
import type { FileRepository } from "./repository.js";
import { toPublicFile } from "./service.js";

export interface PublicProjectDownloadSettings {
  readonly internalProjectId: string;
  readonly publicProjectId: string;
  readonly status: "active" | "suspended";
  readonly fileManagement: Pick<FileManagementSettings, "downloadUrlLifetimeMinutes">;
}

export interface PublicProjectReader {
  inspect(publicProjectId: string): Promise<PublicProjectDownloadSettings | undefined>;
}

export interface DownloadService {
  authorizePrivate(project: TrustedProjectContext, fileId: string): Promise<DownloadAuthorization>;
  authorizePublic(publicProjectId: string, publicFileId: string): Promise<string>;
}

export interface DownloadServiceDependencies {
  readonly repository: FileRepository;
  readonly projects: PublicProjectReader;
  readonly presigner: DownloadPresigner;
  readonly now?: () => Date;
}

function fileNotFound(): HttpError {
  return new HttpError(404, "FILE_NOT_FOUND", "File not found");
}

export function createDownloadService(dependencies: DownloadServiceDependencies): DownloadService {
  const now = dependencies.now ?? (() => new Date());

  async function createFreshTransfer(file: FileItem, lifetimeMinutes: number) {
    const issuedAt = now();
    const expiresInSeconds = lifetimeMinutes * 60;
    const expiresAt = new Date(issuedAt.getTime() + expiresInSeconds * 1_000).toISOString();
    const signed = await dependencies.presigner.authorizeGet({
      objectKey: file.objectKey,
      expiresInSeconds,
    });
    return Object.freeze({ url: signed.url, expiresAt });
  }

  return {
    async authorizePrivate(project, fileId) {
      const item = await dependencies.repository.get(project.internalProjectId, fileId);
      if (
        !item ||
        item.internalProjectId !== project.internalProjectId ||
        item.status !== "ready"
      ) {
        throw fileNotFound();
      }
      const download = await createFreshTransfer(
        item,
        project.fileManagement.downloadUrlLifetimeMinutes,
      );
      return DownloadAuthorizationSchema.parse({
        file: toPublicFile(item),
        download: { method: "GET", ...download },
      });
    },

    async authorizePublic(publicProjectId, publicFileId) {
      const project = await dependencies.projects.inspect(publicProjectId);
      if (!project || project.status !== "active" || project.publicProjectId !== publicProjectId) {
        throw fileNotFound();
      }
      const item = await dependencies.repository.getPublic(publicProjectId, publicFileId);
      if (
        !item ||
        item.visibility !== "public" ||
        item.status !== "ready" ||
        item.publicProjectId !== publicProjectId ||
        item.publicFileId !== publicFileId ||
        project.internalProjectId !== item.internalProjectId
      ) {
        throw fileNotFound();
      }
      return (await createFreshTransfer(item, project.fileManagement.downloadUrlLifetimeMinutes))
        .url;
    },
  };
}
