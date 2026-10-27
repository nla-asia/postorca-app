import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
} from "lucide-react";
import { Button, Modal } from "./ui";
import Markdown, { type ArtifactLink } from "./Markdown";
import { api } from "../lib/api";
import type { TaskArtifact } from "../lib/tasks";

export type Viewable = { type: "artifact"; id: string };

export function ArtifactRow({
  item,
  onOpen,
}: {
  item: TaskArtifact;
  onOpen: () => void;
}) {
  if (item.kind === "url" && /^https?:\/\//i.test(item.content))
    return (
      <a
        className="artifact-row"
        href={item.content}
        target="_blank"
        rel="noreferrer"
      >
        <span className="artifact-icon">
          <ExternalLink size={18} />
        </span>
        <span>
          <strong>{item.title}</strong>
          <small>{item.content}</small>
        </span>
        <ChevronRight size={16} />
      </a>
    );
  return (
    <button className="artifact-row" onClick={onOpen}>
      <span className="artifact-icon">
        <FileText size={18} />
      </span>
      <span>
        <strong>{item.title}</strong>
        <small>{item.kind === "document" ? "Document" : item.kind}</small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}
function DocumentView({
  taskId,
  artifact,
  readOnly,
  onSaved,
  artifactLink,
}: {
  taskId: string;
  artifact: TaskArtifact;
  readOnly: boolean;
  onSaved: () => Promise<void> | void;
  artifactLink?: ArtifactLink;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(artifact.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setEditing(false);
    setBody(artifact.content);
    setError("");
  }, [artifact.id, artifact.content]);
  const editable = artifact.kind === "document" && !readOnly;
  if (editing)
    return (
      <form
        className="artifact-editor"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void api(`/tasks/${taskId}/artifacts/${artifact.id}`, {
            method: "PATCH",
            body: JSON.stringify({ content: body.trim() }),
          })
            .then(() => onSaved())
            .then(() => setEditing(false))
            .catch((error) =>
              setError(
                error instanceof Error ? error.message : "Unable to save.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label htmlFor="artifact-body">Markdown</label>
        <textarea
          id="artifact-body"
          rows={18}
          value={body}
          autoFocus
          onChange={(e) => setBody(e.target.value)}
        />
        {error && (
          <p className="artifact-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <Button
            type="button"
            onClick={() => {
              setBody(artifact.content);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!body.trim() || busy || body === artifact.content}
          >
            Save changes
          </Button>
        </div>
      </form>
    );
  return (
    <>
      <div className="artifact-document">
        <Markdown text={artifact.content} artifact={artifactLink} />
      </div>
      <div className="form-footer">
        <Button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(artifact.content).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {editable && (
          <Button
            variant="primary"
            type="button"
            onClick={() => setEditing(true)}
          >
            <Pencil size={15} />
            Edit
          </Button>
        )}
      </div>
    </>
  );
}

export function ArtifactViewer({
  taskId,
  artifacts,
  viewing,
  readOnly = false,
  context,
  onClose,
  onSaved,
  artifactLink,
}: {
  taskId: string;
  artifacts: TaskArtifact[];
  viewing: Viewable | null;
  readOnly?: boolean;
  context?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  artifactLink?: ArtifactLink;
}) {
  const artifact = viewing
    ? artifacts.find((item) => item.id === viewing.id)
    : undefined;
  return (
    <Modal
      open={!!artifact}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={artifact?.title ?? "Artifact"}
      description={
        artifact?.kind === "document"
          ? [context, readOnly ? "Read only" : "Changes are saved to this work"]
              .filter(Boolean)
              .join(" · ")
          : context
      }
      className="artifact-modal"
    >
      {artifact &&
        (["image", "audio", "video", "screenshot"].includes(artifact.kind) ? (
          <p>
            Media viewing will be available when file delivery is connected.
          </p>
        ) : (
          <DocumentView
            taskId={taskId}
            artifact={artifact}
            readOnly={readOnly}
            onSaved={onSaved}
            artifactLink={artifactLink}
          />
        ))}
    </Modal>
  );
}
