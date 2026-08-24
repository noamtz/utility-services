import { useCallback, useEffect, useRef, useState } from "react";

import type { CreateProjectRequest, Project, ProjectSummary } from "@utility-services/contracts";

import { CreateProjectForm } from "./CreateProjectForm.js";
import { ApiKeyPanel } from "../credentials/ApiKeyPanel.js";
import type { CredentialApi } from "../credentials/api.js";
import { IntegrationGuide } from "../integration/IntegrationGuide.js";
import { UsagePanel } from "../usage/UsagePanel.js";
import type { UsageApi } from "../usage/api.js";
import { ProjectDetails } from "./ProjectDetails.js";
import { ProjectList } from "./ProjectList.js";
import { ProjectApiError, type ProjectApi } from "./api.js";

const SAFE_PROJECT_ERROR = "The project request could not be completed. Please try again.";

interface ProjectViewProps {
  api: ProjectApi;
  credentialApi?: CredentialApi;
  usageApi?: UsageApi;
  apiBaseUrl?: string;
  onUnauthorized: () => Promise<void>;
}

interface LoadProjectsOptions {
  supersede?: boolean;
}

export function ProjectView({
  api,
  credentialApi,
  usageApi,
  apiBaseUrl,
  onUnauthorized,
}: ProjectViewProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const listGeneration = useRef(0);
  const inFlightListRequests = useRef(new Map<string, number>());

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
    async (cursor?: string, { supersede = false }: LoadProjectsOptions = {}) => {
      const requestKey = cursor ?? "initial";
      if (!supersede && inFlightListRequests.current.has(requestKey)) return;

      const generation = listGeneration.current + 1;
      listGeneration.current = generation;
      if (supersede) inFlightListRequests.current.clear();
      inFlightListRequests.current.set(requestKey, generation);
      setLoading(true);
      setError(undefined);
      try {
        const page = await api.list(cursor ? { cursor } : undefined);
        if (generation !== listGeneration.current) return;
        setProjects((current) => (cursor ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (failure) {
        if (generation === listGeneration.current) await handleFailure(failure);
      } finally {
        if (inFlightListRequests.current.get(requestKey) === generation) {
          inFlightListRequests.current.delete(requestKey);
        }
        if (generation === listGeneration.current) setLoading(false);
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
      await loadProjects(undefined, { supersede: true });
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
      {selectedProject && credentialApi && usageApi && apiBaseUrl && (
        <div className="project-experience">
          <ApiKeyPanel projectId={selectedProject.projectId} api={credentialApi} />
          <UsagePanel projectId={selectedProject.projectId} api={usageApi} />
          <IntegrationGuide project={selectedProject} apiBaseUrl={apiBaseUrl} />
        </div>
      )}
    </div>
  );
}
