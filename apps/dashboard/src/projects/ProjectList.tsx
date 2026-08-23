import type { ProjectSummary } from "@utility-services/contracts";

interface ProjectListProps {
  projects: ProjectSummary[];
  selectedProjectId?: string | undefined;
  loading: boolean;
  error?: string | undefined;
  hasMore: boolean;
  onSelect: (projectId: string) => void;
  onLoadMore: () => void;
}

export function ProjectList({
  projects,
  selectedProjectId,
  loading,
  error,
  hasMore,
  onSelect,
  onLoadMore,
}: ProjectListProps) {
  return (
    <section className="panel project-list" aria-labelledby="projects-title" aria-busy={loading}>
      <div>
        <p className="eyebrow">Owner projects</p>
        <h2 id="projects-title">Projects</h2>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && projects.length === 0 && <p role="status">Loading projects…</p>}
      {!loading && projects.length === 0 && !error && <p>No projects yet.</p>}
      {projects.length > 0 && (
        <ul>
          {projects.map((project) => (
            <li key={project.projectId}>
              <button
                type="button"
                aria-pressed={project.projectId === selectedProjectId}
                onClick={() => onSelect(project.projectId)}
              >
                <strong>{project.name}</strong>
                <span>{project.projectId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <button type="button" disabled={loading} onClick={onLoadMore}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
