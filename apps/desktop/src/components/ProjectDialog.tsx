import { useState, type FormEvent } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import type { BrandProject } from "../lib/brand";
import { folderError } from "../lib/folders";
import { api } from "../lib/api";
import { Button, Modal } from "./ui";
import "./forms.css";
import "./Projects.css";

export default function ProjectDialog({
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
        folderError(failure, "Unable to save project."),
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
            placeholder="Enter your project name"
          />
        </label>
        <label>
          What is this project about?
          <textarea
            maxLength={500}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            placeholder="Describe the project and its purpose."
          />
        </label>
        <div className="project-folder-heading">
          <strong>Source folders <span className="pill">Read-only</span></strong>
          <span className="muted">{folders.length}/20</span>
        </div>
        <p className="muted">
          Orca’s file tools can read these repositories, designs, or notes, but cannot write to them. Generated content goes in your separate working folder.
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
