import { useEffect, useState, type FormEvent } from "react";

import {
  UpdateFileManagementPolicyRequestSchema,
  type FileManagementPolicyLimits,
  type Project,
  type UpdateFileManagementPolicyRequest,
} from "@utility-services/contracts";

import { ProjectApiError } from "./api.js";

interface ProjectDetailsProps {
  project?: Project | undefined;
  policyLimits?: FileManagementPolicyLimits | undefined;
  policyUpdating?: boolean;
  onUpdatePolicy?: ((input: UpdateFileManagementPolicyRequest) => Promise<void>) | undefined;
}

export function ProjectDetails({
  project,
  policyLimits,
  policyUpdating = false,
  onUpdatePolicy,
}: ProjectDetailsProps) {
  const [storageQuotaBytes, setStorageQuotaBytes] = useState("");
  const [trashRetentionDays, setTrashRetentionDays] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    setStorageQuotaBytes(project ? String(project.fileManagement.storageQuotaBytes) : "");
    setTrashRetentionDays(project ? String(project.fileManagement.trashRetentionDays) : "");
    setError(undefined);
  }, [project]);

  async function updatePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onUpdatePolicy) return;
    const parsed = UpdateFileManagementPolicyRequestSchema.safeParse({
      storageQuotaBytes: Number(storageQuotaBytes),
      trashRetentionDays: Number(trashRetentionDays),
    });
    if (!parsed.success) {
      setError("Enter a whole-number quota and trash duration within the allowed range.");
      return;
    }
    setError(undefined);
    try {
      await onUpdatePolicy(parsed.data);
    } catch (failure) {
      setError(
        failure instanceof ProjectApiError && failure.code === "STORAGE_QUOTA_BELOW_ACCOUNTED"
          ? "The quota cannot be lower than the storage already used by this project."
          : "The File Management policy could not be updated. Please try again.",
      );
    }
  }

  return (
    <section className="panel project-details" aria-labelledby="details-title">
      <p className="eyebrow">Project details</p>
      <h2 id="details-title">{project ? project.name : "Select a project"}</h2>
      {!project && <p>Choose a project to inspect its public configuration.</p>}
      {project && (
        <dl>
          <div>
            <dt>Public project ID</dt>
            <dd>{project.projectId}</dd>
          </div>
          <div>
            <dt>Enabled utility</dt>
            <dd>File Management</dd>
          </div>
          <div>
            <dt>Upload URL lifetime</dt>
            <dd>{project.fileManagement.uploadUrlLifetimeMinutes} minutes</dd>
          </div>
          <div>
            <dt>Download URL lifetime</dt>
            <dd>{project.fileManagement.downloadUrlLifetimeMinutes} minutes</dd>
          </div>
          <div>
            <dt>Storage quota</dt>
            <dd>{project.fileManagement.storageQuotaBytes.toLocaleString()} bytes</dd>
          </div>
          <div>
            <dt>Trash retention</dt>
            <dd>{project.fileManagement.trashRetentionDays} days</dd>
          </div>
        </dl>
      )}
      {project && onUpdatePolicy && (
        <form className="policy-form" onSubmit={(event) => void updatePolicy(event)}>
          <h3>File Management policy</h3>
          <div className="field-grid">
            <label htmlFor="edit-storage-quota-bytes">
              Storage quota (bytes)
              <input
                id="edit-storage-quota-bytes"
                type="number"
                min={policyLimits?.minStorageQuotaBytes}
                max={policyLimits?.maxStorageQuotaBytes}
                step={1}
                required
                disabled={policyUpdating}
                value={storageQuotaBytes}
                onChange={(event) => setStorageQuotaBytes(event.target.value)}
              />
            </label>
            <label htmlFor="edit-trash-retention-days">
              Trash retention (days)
              <input
                id="edit-trash-retention-days"
                type="number"
                min={policyLimits?.minTrashRetentionDays}
                max={policyLimits?.maxTrashRetentionDays}
                step={1}
                required
                disabled={policyUpdating}
                value={trashRetentionDays}
                onChange={(event) => setTrashRetentionDays(event.target.value)}
              />
            </label>
          </div>
          <p className="field-note">
            Deleted files still count toward quota and may affect usage cost.
          </p>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={policyUpdating}>
            {policyUpdating ? "Saving…" : "Save policy"}
          </button>
        </form>
      )}
      {project && (
        <p className="field-note">
          File Management is the project&apos;s enabled utility. Transfer lifetimes are fixed at
          project creation within the 1–60 minute bounds (defaults: 15 upload, 5 download). Request
          a fresh URL after expiry.
        </p>
      )}
    </section>
  );
}
