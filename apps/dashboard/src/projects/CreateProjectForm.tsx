import { useState, type FormEvent } from "react";

import {
  CreateProjectRequestSchema,
  DEFAULT_STORAGE_QUOTA_BYTES,
  DEFAULT_TRASH_RETENTION_DAYS,
  type CreateProjectRequest,
  type FileManagementPolicyLimits,
} from "@utility-services/contracts";

interface CreateProjectFormProps {
  busy?: boolean;
  policyLimits?: FileManagementPolicyLimits | undefined;
  onCreate: (input: CreateProjectRequest) => Promise<void>;
}

export function CreateProjectForm({
  busy = false,
  policyLimits,
  onCreate,
}: CreateProjectFormProps) {
  const [name, setName] = useState("");
  const [uploadLifetime, setUploadLifetime] = useState("15");
  const [downloadLifetime, setDownloadLifetime] = useState("5");
  const [storageQuotaBytes, setStorageQuotaBytes] = useState(String(DEFAULT_STORAGE_QUOTA_BYTES));
  const [trashRetentionDays, setTrashRetentionDays] = useState(
    String(DEFAULT_TRASH_RETENTION_DAYS),
  );
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CreateProjectRequestSchema.safeParse({
      name,
      enabledUtilities: ["file-management"],
      fileManagement: {
        uploadUrlLifetimeMinutes: Number(uploadLifetime),
        downloadUrlLifetimeMinutes: Number(downloadLifetime),
        storageQuotaBytes: Number(storageQuotaBytes),
        trashRetentionDays: Number(trashRetentionDays),
      },
    });
    if (!parsed.success) {
      setError(
        "Enter whole-number lifetimes from 1 to 60 minutes and valid File Management settings.",
      );
      return;
    }
    setError(undefined);
    await onCreate(parsed.data);
    setName("");
  }

  return (
    <form className="panel create-form" onSubmit={(event) => void submit(event)}>
      <div>
        <p className="eyebrow">New project</p>
        <h2>Create a project</h2>
      </div>
      <div className="field-grid">
        <label htmlFor="storage-quota-bytes">
          Storage quota (bytes)
          <input
            id="storage-quota-bytes"
            type="number"
            min={policyLimits?.minStorageQuotaBytes}
            max={policyLimits?.maxStorageQuotaBytes}
            step={1}
            required
            value={storageQuotaBytes}
            onChange={(event) => setStorageQuotaBytes(event.target.value)}
          />
        </label>
        <label htmlFor="trash-retention-days">
          Trash retention (days)
          <input
            id="trash-retention-days"
            type="number"
            min={policyLimits?.minTrashRetentionDays}
            max={policyLimits?.maxTrashRetentionDays}
            step={1}
            required
            value={trashRetentionDays}
            onChange={(event) => setTrashRetentionDays(event.target.value)}
          />
        </label>
      </div>
      <p className="field-note">
        Deleted files remain in trash for the selected period. They still count toward storage quota
        and can affect usage cost.
      </p>
      <label htmlFor="project-name">Project name</label>
      <input
        id="project-name"
        required
        maxLength={100}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p className="field-note">File Management is enabled for every MVP project.</p>
      <div className="field-grid">
        <label htmlFor="upload-lifetime">
          Upload URL lifetime (minutes)
          <input
            id="upload-lifetime"
            type="number"
            min={1}
            max={60}
            step={1}
            required
            value={uploadLifetime}
            onChange={(event) => setUploadLifetime(event.target.value)}
          />
        </label>
        <label htmlFor="download-lifetime">
          Download URL lifetime (minutes)
          <input
            id="download-lifetime"
            type="number"
            min={1}
            max={60}
            step={1}
            required
            value={downloadLifetime}
            onChange={(event) => setDownloadLifetime(event.target.value)}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
