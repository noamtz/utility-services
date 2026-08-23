import { describe, expect, it } from "vitest";

import {
  FILE_MANAGEMENT_SORT_KEY,
  PROJECT_METADATA_SORT_KEY,
  assembleProject,
  ownerPartitionKey,
  ownerProjectSortKey,
  parseProjectMetadataItem,
  projectPartitionKey,
  toEnabledUtilityItem,
  toProjectMetadataItem,
  type InternalProject,
} from "./model.js";

const project: InternalProject = {
  internalProjectId: "11111111-1111-4111-8111-111111111111",
  publicProjectId: "prj_0123456789abcdefghijkl",
  ownerId: "owner-1",
  name: "Control project",
  enabledUtilities: ["file-management"],
  fileManagement: { uploadUrlLifetimeMinutes: 15, downloadUrlLifetimeMinutes: 5 },
  createdAt: "2026-08-23T08:00:00.000Z",
  updatedAt: "2026-08-23T08:00:00.000Z",
};

describe("project model", () => {
  it("constructs deterministic project and owner keys", () => {
    expect(projectPartitionKey(project.publicProjectId)).toBe(`PROJECT#${project.publicProjectId}`);
    expect(ownerPartitionKey(project.ownerId)).toBe("OWNER#owner-1");
    expect(ownerProjectSortKey(project.createdAt, project.publicProjectId)).toBe(
      `PROJECT#${project.createdAt}#${project.publicProjectId}`,
    );
  });

  it("maps a project into separate strict metadata and utility items", () => {
    const metadata = toProjectMetadataItem(project);
    const utility = toEnabledUtilityItem(
      project.publicProjectId,
      project.fileManagement,
      project.createdAt,
      project.updatedAt,
    );

    expect(metadata).toMatchObject({
      pk: `PROJECT#${project.publicProjectId}`,
      sk: PROJECT_METADATA_SORT_KEY,
      gsi1pk: "OWNER#owner-1",
      itemType: "project-metadata",
    });
    expect(metadata).not.toHaveProperty("fileManagement");
    expect(utility).toMatchObject({
      pk: metadata.pk,
      sk: FILE_MANAGEMENT_SORT_KEY,
      utility: "file-management",
      uploadUrlLifetimeMinutes: 15,
      downloadUrlLifetimeMinutes: 5,
    });
    expect(utility).not.toHaveProperty("ownerId");
    expect(assembleProject(metadata, utility)).toEqual(project);
  });

  it("fails closed for unknown fields and mismatched partitions", () => {
    const metadata = toProjectMetadataItem(project);
    const utility = toEnabledUtilityItem(
      project.publicProjectId,
      project.fileManagement,
      project.createdAt,
      project.updatedAt,
    );

    expect(() => assembleProject({ ...metadata, secret: "leak" }, utility)).toThrow();
    expect(() => assembleProject(metadata, { ...utility, pk: "PROJECT#other" })).toThrow(
      "Project items belong to different partitions",
    );
  });

  it("fails closed for valid-format metadata keys that disagree with embedded fields", () => {
    const metadata = toProjectMetadataItem(project);
    const utility = toEnabledUtilityItem(
      project.publicProjectId,
      project.fileManagement,
      project.createdAt,
      project.updatedAt,
    );
    const otherProjectId = "prj_0123456789abcdefghijkm";

    expect(() =>
      assembleProject(
        { ...metadata, pk: `PROJECT#${otherProjectId}` },
        { ...utility, pk: `PROJECT#${otherProjectId}` },
      ),
    ).toThrow("Project metadata keys are inconsistent");
    expect(() => parseProjectMetadataItem({ ...metadata, gsi1pk: "OWNER#owner-2" })).toThrow(
      "Project metadata keys are inconsistent",
    );
    expect(() =>
      parseProjectMetadataItem({
        ...metadata,
        gsi1sk: ownerProjectSortKey(project.createdAt, otherProjectId),
      }),
    ).toThrow("Project metadata keys are inconsistent");
  });

  it("rejects malformed external Dynamo item values", () => {
    const metadata = toProjectMetadataItem(project);
    const utility = toEnabledUtilityItem(
      project.publicProjectId,
      project.fileManagement,
      project.createdAt,
      project.updatedAt,
    );

    expect(() =>
      assembleProject({ ...metadata, internalProjectId: "caller-id" }, utility),
    ).toThrow();
    expect(() => assembleProject(metadata, { ...utility, uploadUrlLifetimeMinutes: 61 })).toThrow();
  });
});
