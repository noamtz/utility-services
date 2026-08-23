import { useCallback, useEffect, useState } from "react";

import type { CreateProjectRequest, Project, ProjectSummary } from "@utility-services/contracts";

import { CreateProjectForm } from "./CreateProjectForm.js";
import { ProjectDetails } from "./ProjectDetails.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectApiError, type ProjectApi } from "./api.js";

const SAFE_PROJECT_ERROR = "The project request could not be completed. Please try again.";

interface ProjectViewProps {
  api: ProjectApi;
  onUnauthorized: () => Promise<void>;
}

export function ProjectView({ api, onUnauthorized }: ProjectViewProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const handleFailure = useCallback(
    async (failure: unknown) => {
      if (failure instanceof ProjectApiError && failure.statusCode === 401) {
        await onUnauthorized().catch(() => undefined);
        return;
      }
      setError(failure instanceof ProjectApiError ? failure.message : SAFE_PROJECT_ERROR);
    },
    [onUnauthorized],
  );

  const loadProjects = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.list(cursor ? { cursor } : undefined);
        setProjects((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (failure) {
        await handleFailure(failure);
      } finally {
        setLoading(false);
      }
    },
    [api, handleFailure],
  );

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function create(input: CreateProjectRequest) {
    setCreating(true);
    setError(undefined);
    try {
      const created = await api.create(input);
      setSelectedProject(created);
      const page = await api.list();
      setProjects(page.items);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      await handleFailure(failure);
    } finally {
      setCreating(false);
    }
  }

  async function select(projectId: string) {
    setError(undefined);
    try {
      setSelectedProject(await api.inspect(projectId));
    } catch (failure) {
      await handleFailure(failure);
    }
  }

  return (
    <div className="project-workspace">
      <CreateProjectForm busy={creating} onCreate={create} />
      <ProjectList
        projects={projects}
        selectedProjectId={selectedProject?.projectId}
        loading={loading}
        error={error}
        hasMore={Boolean(nextCursor)}
        onSelect={(projectId) => void select(projectId)}
        onLoadMore={() => void loadProjects(nextCursor)}
      />
      <ProjectDetails project={selectedProject} />
    </div>
  );
}
