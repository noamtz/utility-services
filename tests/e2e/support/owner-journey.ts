import { expect, type Page } from "@playwright/test";

import { ProjectApiKeySchema, PublicProjectIdSchema } from "@utility-services/contracts";

import type { ReleaseOwnerCredentials } from "./release-config.js";

export interface IssuedOwnerKey {
  apiKey: string;
  keyId: string;
}

function projectSection(page: Page) {
  return page.locator("section.project-details");
}

function keySection(page: Page) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: "Project API keys" }),
  });
}

export async function signInInvitedOwner(
  page: Page,
  credentials: ReleaseOwnerCredentials,
): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const projectHeading = page.getByRole("heading", { name: "Project control" });
  const passwordHeading = page.getByRole("heading", { name: "Choose a new password" });
  await expect(projectHeading.or(passwordHeading)).toBeVisible();
  if (await passwordHeading.isVisible()) {
    if (!credentials.newPassword) {
      throw new Error("Invited owner requires an authorized permanent password value");
    }
    await page.getByLabel("New password").fill(credentials.newPassword);
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(projectHeading).toBeVisible();
  }
}

export async function createOwnerProject(page: Page, name: string): Promise<string> {
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("Upload URL lifetime (minutes)").fill("1");
  await page.getByLabel("Download URL lifetime (minutes)").fill("1");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(projectSection(page).getByRole("heading", { name })).toBeVisible();
  const projectId = await projectSection(page)
    .locator("div")
    .filter({ has: page.getByText("Public project ID", { exact: true }) })
    .locator("dd")
    .textContent();
  return PublicProjectIdSchema.parse(projectId?.trim());
}

export async function issueOwnerKey(page: Page): Promise<IssuedOwnerKey> {
  const section = keySection(page);
  await section.getByRole("button", { name: "Create API key" }).click();
  const reveal = section.locator(".secret-reveal");
  await expect(reveal).toBeVisible();
  const apiKey = ProjectApiKeySchema.parse((await reveal.locator("code").textContent())?.trim());
  const keyId = apiKey.split(".")[1];
  if (!keyId) throw new Error("Issued credential did not contain a public key identifier");
  await reveal.getByRole("button", { name: "I saved it" }).click();
  await expect(reveal).toBeHidden();
  return { apiKey, keyId };
}

export async function replaceOwnerKey(page: Page, keyId: string): Promise<IssuedOwnerKey> {
  const section = keySection(page);
  const item = section.locator("li").filter({ hasText: keyId });
  await item.getByRole("button", { name: "Replace" }).click();
  await section.getByRole("button", { name: "Confirm replacement" }).click();
  const reveal = section.locator(".secret-reveal");
  await expect(reveal).toBeVisible();
  const apiKey = ProjectApiKeySchema.parse((await reveal.locator("code").textContent())?.trim());
  const replacementKeyId = apiKey.split(".")[1];
  if (!replacementKeyId) throw new Error("Replacement credential is missing its identifier");
  await reveal.getByRole("button", { name: "I saved it" }).click();
  await expect(reveal).toBeHidden();
  await expect(item.locator(".status-replaced")).toHaveText("replaced");
  return { apiKey, keyId: replacementKeyId };
}

export async function revokeOwnerKey(page: Page, keyId: string): Promise<void> {
  const section = keySection(page);
  const item = section.locator("li").filter({ hasText: keyId });
  await item.getByRole("button", { name: "Revoke" }).click();
  await section.getByRole("button", { name: "Confirm revocation" }).click();
  await expect(item.locator(".status-revoked")).toHaveText("revoked");
}

export async function bestEffortRevokeOwnerKey(
  page: Page,
  keyId: string | undefined,
): Promise<boolean> {
  if (!keyId) return true;
  try {
    await revokeOwnerKey(page, keyId);
    return true;
  } catch {
    return false;
  }
}

export async function refreshUsage(page: Page): Promise<string> {
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "AWS-equivalent usage cost" }),
  });
  const refresh = section.getByRole("button", { name: "Refresh" });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(
    section.getByText(/Metering: (?:fresh|stale|incomplete|not yet metered)/u),
  ).toBeVisible();
  const text = await section.textContent();
  if (!text?.includes("not an allocated AWS invoice")) {
    throw new Error("Usage presentation lost its AWS-equivalent cost boundary");
  }
  return text;
}

export async function signOutOwner(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}
