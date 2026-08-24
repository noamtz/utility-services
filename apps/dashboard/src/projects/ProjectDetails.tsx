import type { Project } from "@utility-services/contracts";

export function ProjectDetails({ project }: { project?: Project | undefined }) {
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
        </dl>
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
