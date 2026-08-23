import { useState, type FormEvent } from "react";

import { CreateProjectRequestSchema, type CreateProjectRequest } from "@utility-services/contracts";

interface CreateProjectFormProps {
  busy?: boolean;
  onCreate: (input: CreateProjectRequest) => Promise<void>;
}

export function CreateProjectForm({ busy = false, onCreate }: CreateProjectFormProps) {
  const [name, setName] = useState("");
  const [uploadLifetime, setUploadLifetime] = useState("15");
  const [downloadLifetime, setDownloadLifetime] = useState("5");
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CreateProjectRequestSchema.safeParse({
      name,
      enabledUtilities: ["file-management"],
      fileManagement: {
        uploadUrlLifetimeMinutes: Number(uploadLifetime),
        downloadUrlLifetimeMinutes: Number(downloadLifetime),
      },
    });
    if (!parsed.success) {
      setError("Enter a project name and whole-number lifetimes from 1 to 60 minutes.");
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
