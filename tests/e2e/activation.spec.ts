import { expect, test } from "@playwright/test";

import {
  bestEffortForceDelete,
  authorizePrivateDownload,
  authorizeUpload,
  createFileJourneyContexts,
  disposeFileJourneyContexts,
  downloadOpaqueTransfer,
  expectExpiredTransfer,
  expectPublicError,
  forceDeleteFile,
  listFiles,
  pollReadyFile,
  putAuthorizedUpload,
  restoreFile,
  stablePublicRedirect,
  trashFile,
  type FileJourneyContexts,
} from "./support/file-journey.js";
import {
  bestEffortRevokeOwnerKey,
  createOwnerProject,
  issueOwnerKey,
  refreshUsage,
  replaceOwnerKey,
  revokeOwnerKey,
  signInInvitedOwner,
  signOutOwner,
} from "./support/owner-journey.js";
import { RELEASE_CASES, requireAuthorizedReleaseEnvironment } from "./support/release-config.js";

const GUESSED_FILE_ID = "fil_aaaaaaaaaaaaaaaaaaaaaa";
const GUESSED_PUBLIC_FILE_ID = "pfil_aaaaaaaaaaaaaaaaaaaaaa";
const RESULT_PREFIX = "RUS_RELEASE_RESULT:";

test.describe.configure({ mode: "serial" });

test("proves two-owner activation and release boundaries", async ({ browser }) => {
  const config = requireAuthorizedReleaseEnvironment();
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  let filesA: FileJourneyContexts | undefined;
  let filesB: FileJourneyContexts | undefined;
  let replacementA: FileJourneyContexts | undefined;
  const cleanupA: string[] = [];
  const cleanupB: string[] = [];
  const cases: Array<{ name: string; status: "pass" }> = [];
  let activeKeyA: string | undefined;
  let activeKeyB: string | undefined;
  let activationSeconds = 300;
  let cleanupComplete = false;

  try {
    await signInInvitedOwner(pageA, config.ownerA);
    await signInInvitedOwner(pageB, config.ownerB);
    cases.push({ name: RELEASE_CASES.twoOwnerSignIn, status: "pass" });

    const runScope = `${config.runLabel}-${Date.now().toString(36)}`;
    const projectA = await createOwnerProject(pageA, `${runScope}-owner-a`);
    const projectB = await createOwnerProject(pageB, `${runScope}-owner-b`);
    expect(projectA).not.toBe(projectB);
    cases.push({ name: RELEASE_CASES.twoOwnerProjects, status: "pass" });

    const keyA = await issueOwnerKey(pageA);
    activeKeyA = keyA.keyId;
    const activationStartedAt = performance.now();
    const keyB = await issueOwnerKey(pageB);
    activeKeyB = keyB.keyId;
    filesA = await createFileJourneyContexts(config.apiUrl, keyA.apiKey);
    filesB = await createFileJourneyContexts(config.apiUrl, keyB.apiKey);
    cases.push({ name: RELEASE_CASES.oneTimeKeyIssuance, status: "pass" });

    const privateContent = Buffer.from("rus11-private-disposable", "utf8");
    const privateUpload = await authorizeUpload(filesA.api, {
      name: `${runScope}-private.txt`,
      mediaType: "text/plain",
      content: privateContent,
      visibility: "private",
    });
    cleanupA.push(privateUpload.file.fileId);
    await putAuthorizedUpload(filesA.transfer, privateUpload, privateContent);
    const privateReady = await pollReadyFile(
      filesA.api,
      privateUpload.file.fileId,
      config.completionTimeoutSeconds,
    );
    expect((await listFiles(filesA.api)).some((file) => file.fileId === privateReady.fileId)).toBe(
      true,
    );
    const firstDownloadUrl = await authorizePrivateDownload(filesA.api, privateReady.fileId);
    expect(await downloadOpaqueTransfer(filesA.transfer, firstDownloadUrl)).toEqual(privateContent);
    activationSeconds = (performance.now() - activationStartedAt) / 1_000;
    expect(activationSeconds).toBeLessThan(300);
    cases.push({ name: RELEASE_CASES.fiveMinutePrivateActivation, status: "pass" });

    const publicContent = Buffer.from("rus11-public-disposable", "utf8");
    const publicUpload = await authorizeUpload(filesA.api, {
      name: `${runScope}-public.txt`,
      mediaType: "text/plain",
      content: publicContent,
      visibility: "public",
    });
    cleanupA.push(publicUpload.file.fileId);
    await putAuthorizedUpload(filesA.transfer, publicUpload, publicContent);
    const publicReady = await pollReadyFile(
      filesA.api,
      publicUpload.file.fileId,
      config.completionTimeoutSeconds,
    );
    if (!publicReady.publicFileId)
      throw new Error("Public file did not receive a public identifier");
    const publicLocation = await stablePublicRedirect(
      filesA.publicApi,
      projectA,
      publicReady.publicFileId,
    );
    expect(await downloadOpaqueTransfer(filesA.transfer, publicLocation)).toEqual(publicContent);
    cases.push({ name: RELEASE_CASES.stablePublicAccess, status: "pass" });

    const ownerBContent = Buffer.from("rus11-owner-b-disposable", "utf8");
    const ownerBUpload = await authorizeUpload(filesB.api, {
      name: `${runScope}-owner-b.txt`,
      mediaType: "text/plain",
      content: ownerBContent,
      visibility: "private",
    });
    cleanupB.push(ownerBUpload.file.fileId);
    await putAuthorizedUpload(filesB.transfer, ownerBUpload, ownerBContent);
    await pollReadyFile(filesB.api, ownerBUpload.file.fileId, config.completionTimeoutSeconds);

    await expectPublicError(await filesA.api.get(`/v1/files/${ownerBUpload.file.fileId}`), 404, [
      "FILE_NOT_FOUND",
    ]);
    await expectPublicError(
      await filesB.api.post(`/v1/files/${privateReady.fileId}/downloads`),
      404,
      ["FILE_NOT_FOUND"],
    );
    await expectPublicError(await filesA.api.get(`/v1/files/${GUESSED_FILE_ID}`), 404, [
      "FILE_NOT_FOUND",
    ]);
    await expectPublicError(
      await filesA.publicApi.get(`/files/public/${projectA}/${GUESSED_PUBLIC_FILE_ID}`, {
        maxRedirects: 0,
      }),
      404,
      ["FILE_NOT_FOUND"],
    );
    await expectPublicError(
      await filesB.publicApi.get(`/files/public/${projectB}/${publicReady.publicFileId}`, {
        maxRedirects: 0,
      }),
      404,
      ["FILE_NOT_FOUND"],
    );
    cases.push({ name: RELEASE_CASES.crossProjectAndGuessedIdDenial, status: "pass" });

    await trashFile(filesA.api, privateReady.fileId);
    await expectPublicError(
      await filesA.api.post(`/v1/files/${privateReady.fileId}/downloads`),
      404,
      ["FILE_NOT_FOUND"],
    );
    const restored = await restoreFile(filesA.api, privateReady.fileId);
    expect(restored.fileId).toBe(privateReady.fileId);
    cases.push({ name: RELEASE_CASES.trashRestoreIdentity, status: "pass" });

    const residualUrl = await authorizePrivateDownload(filesA.api, privateReady.fileId);
    const replacementKey = await replaceOwnerKey(pageA, keyA.keyId);
    activeKeyA = replacementKey.keyId;
    replacementA = await createFileJourneyContexts(config.apiUrl, replacementKey.apiKey);
    await expectPublicError(await filesA.api.get("/v1/files?limit=20"), 401, ["UNAUTHORIZED"]);
    expect(await downloadOpaqueTransfer(filesA.transfer, residualUrl)).toEqual(privateContent);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(config.expiryTimeoutSeconds, 70) * 1_000),
    );
    const expired = await filesA.transfer.get(residualUrl);
    expectExpiredTransfer(expired);
    await authorizePrivateDownload(replacementA.api, privateReady.fileId);
    cases.push({ name: RELEASE_CASES.keyReplacementAndUrlExpiry, status: "pass" });

    await forceDeleteFile(replacementA.api, privateReady.fileId, config.expiryTimeoutSeconds);
    await forceDeleteFile(replacementA.api, publicReady.fileId, config.expiryTimeoutSeconds);
    await forceDeleteFile(filesB.api, ownerBUpload.file.fileId, config.expiryTimeoutSeconds);
    cleanupA.length = 0;
    cleanupB.length = 0;
    cases.push({ name: RELEASE_CASES.forceDelete, status: "pass" });

    await refreshUsage(pageA);
    await expect(
      pageA.locator("section.project-details").getByText(projectA, { exact: true }),
    ).toBeVisible();
    await refreshUsage(pageB);
    cases.push({ name: RELEASE_CASES.usageFreshness, status: "pass" });

    await revokeOwnerKey(pageA, replacementKey.keyId);
    activeKeyA = undefined;
    await revokeOwnerKey(pageB, keyB.keyId);
    activeKeyB = undefined;
    await expectPublicError(await replacementA.api.get("/v1/files?limit=20"), 401, [
      "UNAUTHORIZED",
    ]);
    cases.push({ name: RELEASE_CASES.keyRevocation, status: "pass" });

    await signOutOwner(pageA);
    await signOutOwner(pageB);
    cleanupComplete = true;
  } finally {
    const cleanupResults = await Promise.all([
      bestEffortForceDelete(replacementA?.api ?? filesA?.api, cleanupA),
      bestEffortForceDelete(filesB?.api, cleanupB),
    ]);
    const keyCleanupResults = await Promise.all([
      bestEffortRevokeOwnerKey(pageA, activeKeyA),
      bestEffortRevokeOwnerKey(pageB, activeKeyB),
    ]);
    cleanupComplete =
      cleanupComplete && cleanupResults.every(Boolean) && keyCleanupResults.every(Boolean);
    await Promise.all(
      [replacementA, filesA, filesB]
        .filter((value): value is FileJourneyContexts => value !== undefined)
        .map((value) => disposeFileJourneyContexts(value)),
    );
    await Promise.all([contextA.close(), contextB.close()]);
  }

  if (!cleanupComplete) throw new Error("Release journey left unexpected file or key cleanup work");
  const result = {
    decision: "pass",
    stage: config.stage,
    runTimestamp: new Date().toISOString(),
    activationSeconds: Number(activationSeconds.toFixed(3)),
    cases,
    caseCounts: { passed: cases.length, failed: 0 },
    projectResidue: true,
    externalGatesPending: [
      "cloudtrail-transfer-matrix",
      "production-alert-delivery",
      "two-user-product-experiment",
    ],
  };
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
});
