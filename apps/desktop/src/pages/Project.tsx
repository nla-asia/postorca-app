import { useState, type FormEvent } from "react";
import { ArrowRight, FolderOpen, Plus, Settings2, Trash2 } from "lucide-react";
import type { BrandProject } from "../lib/brand";
import type { WorkTask } from "../lib/schedules";
import { api } from "../lib/api";
import { workState } from "../lib/useWorkTasks";
import { Button, Modal, Pill } from "../components/ui";
import "../components/forms.css";
import "./Project.css";

const stateLabels = {
  working: "Orca is working",
  failed: "Needs attention",
  review: "Ready for review",
  approved: "Approved",
  archived: "Archived",
};

export function ProjectEditor({
  project,
  onClose,
  onSaved,
  onDeleted,
}: {
  project: BrandProject | null;
  onClose: () => void;
  onSaved: (project: BrandProject) => void;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [folders, setFolders] = useState(
    project?.folders ?? (project?.path ? [project.path] : []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save project.",
      );
    } finally {
      setBusy(false);
    }
  };
  const chooseFolder = () =>
    act(async () => {
      if (!window.postorca?.projectFolder)
        throw new Error("Open the desktop app to choose a source folder.");
      const path = await window.postorca.projectFolder.choose();
      if (!path) return;
      setFolders((current) =>
        current.includes(path) ? current : [...current, path],
      );
      if (!name.trim())
        setName(path.split(/[\\/]/).filter(Boolean).at(-1) ?? "");
    });
  const save = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const result = await api<BrandProject | { project: BrandProject }>(
        project
          ? `/brand-profile/projects/${project.id}`
          : "/brand-profile/projects",
        {
          method: project ? "PATCH" : "POST",
          body: JSON.stringify({ name, description, folders }),
        },
      );
      onSaved("project" in result ? result.project : result);
      onClose();
    });
  };
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={project ? "Project settings" : "Add project"}
      description="Give Orca the product context and source folders it needs to create content."
    >
      <form className="form-stack" onSubmit={save}>
        <label>
          Project name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            placeholder="e.g. KG Scholar"
          />
        </label>
        <label>
          What are you building?
          <textarea
            maxLength={500}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            placeholder="Describe the product and what makes it useful."
          />
        </label>
        <div className="project-folder-heading">
          <strong>Source folders</strong>
          <span className="muted">{folders.length}/20</span>
        </div>
        <p className="muted">
          Add repositories, designs, or notes for this project. Orca can read
          files in these folders.
        </p>
        <ul className="project-folder-list">
          {folders.map((folder) => (
            <li key={folder}>
              <FolderOpen size={17} />
              <span>{folder}</span>
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label={`Remove ${folder}`}
                onClick={() =>
                  setFolders((current) =>
                    current.filter((path) => path !== folder),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
        <Button
          disabled={busy || folders.length >= 20}
          onClick={() => void chooseFolder()}
        >
          <Plus size={16} />
          Add source folder
        </Button>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <div className="project-form-actions">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !folders.length}
          >
            {busy ? "Saving…" : project ? "Save changes" : "Add project"}
          </Button>
        </div>
        {project && (
          <div className="project-delete">
            <p className="muted">
              Removing a project keeps its content work and files. Orca stops
              using its source folders for that project.
            </p>
            {confirmDelete ? (
              <>
                <p>Remove {project.name}?</p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(`/brand-profile/projects/${project.id}`, {
                        method: "DELETE",
                      });
                      await onDeleted();
                      onClose();
                    })
                  }
                >
                  Remove project
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep project
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={15} />
                Remove project
              </Button>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}

export default function Project({
  project,
  tasks,
  loading,
  error,
  onRetry,
  onSettings,
  onOpenWork,
  onCreated,
}: {
  project: BrandProject;
  tasks: WorkTask[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSettings: () => void;
  onOpenWork: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const shown = tasks.filter((task) => showArchived || !task.archived_at);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setCreateError("");
    try {
      const task = await api<{ id: string }>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          kind: "work",
          work_type: "content",
          title,
          project_id: project.id,
          message: request,
        }),
      });
      setCreating(false);
      setTitle("");
      setRequest("");
      onCreated(task.id);
    } catch (failure) {
      setCreateError(
        failure instanceof Error
          ? failure.message
          : "Unable to create content.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-content project-page">
      <header className="project-header">
        <div className="project-heading">
          <span className="project-eyebrow">
            <FolderOpen size={16} />
            Project
          </span>
          <h1>{project.name}</h1>
          <p className="muted">
            {project.description ||
              "Add a description in project settings to help Orca understand this product."}
          </p>
        </div>
        <Button onClick={onSettings}>
          <Settings2 size={16} />
          Project settings
        </Button>
      </header>
      <div className="project-context">
        <FolderOpen size={18} />
        <div>
          <strong>
            {project.folders.length} source{" "}
            {project.folders.length === 1 ? "folder" : "folders"}
          </strong>
          <p className="muted">
            {project.folders
              .map((folder) => folder.split(/[\\/]/).filter(Boolean).at(-1))
              .join(" · ")}
          </p>
        </div>
        <Button variant="ghost" onClick={onSettings}>
          Manage folders
        </Button>
      </div>
      <div className="section-toolbar">
        <h2>Content work</h2>
        <div className="project-form-actions">
          <label className="project-archive-filter">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            Create content
          </Button>
        </div>
      </div>
      {error && (
        <div role="alert">
          <p className="auth-error">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
      {loading && !error ? (
        <p role="status" className="muted">
          Loading content work…
        </p>
      ) : (
        <div className="project-work-list">
          {shown.map((task) => (
            <button
              className="project-work-card"
              key={task.id}
              onClick={() => onOpenWork(task.id)}
            >
              <div>
                <strong>{task.title}</strong>
                <p className="muted">
                  {task.summary?.replace(/[*#`]/g, "").slice(0, 180) ||
                    "Open the conversation, plan, and deliverables."}
                </p>
              </div>
              <Pill>{stateLabels[workState(task)]}</Pill>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      )}
      {!loading && !error && !shown.length && (
        <div className="empty-state">
          <FolderOpen size={30} />
          <h3>Create your first piece of content</h3>
          <p>
            Ask Orca for a launch video, feature announcement, or product
            walkthrough for {project.name}.
          </p>
          <Button variant="primary" onClick={() => setCreating(true)}>
            Create content
          </Button>
        </div>
      )}
      <Modal
        open={creating}
        onOpenChange={(open) => {
          if (!busy) setCreating(open);
        }}
        title="Create content"
        description={`Orca will use ${project.name} and its source folders, then prepare a plan and script for your review.`}
      >
        <form className="form-stack" onSubmit={(event) => void create(event)}>
          <label>
            Title
            <input
              required
              maxLength={200}
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Android release announcement"
            />
          </label>
          <label>
            What would you like to create?
            <textarea
              required
              rows={5}
              maxLength={30000}
              disabled={busy}
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="Describe the content, audience, and where you want to share it."
            />
          </label>
          {createError && (
            <p role="alert" className="auth-error">
              {createError}
            </p>
          )}
          <div className="project-form-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Starting…" : "Start creating"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
