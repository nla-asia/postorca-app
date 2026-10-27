import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileText,
  Film,
  Image,
  Music,
  Pencil,
} from "lucide-react";
import { Button, Modal } from "./ui";
import Markdown, { type ArtifactLink } from "./Markdown";
import MediaAttachment from "./MediaAttachment";
import { api } from "../lib/api";
import type { TaskArtifact } from "../lib/tasks";
import { artifactMedia, type MediaAttachment as Attachment } from "../lib/media";

/** What the artifact viewer shows: a saved artifact, or a file a tool attached to a message. */
export type Viewable =
  | { type: "artifact"; id: string }
  | { type: "media"; attachment: Attachment };

const size = (bytes?: number) =>
  bytes === undefined
    ? ""
    : bytes < 1024 * 1024
      ? ` · ${Math.max(1, Math.round(bytes / 1024))} KB`
      : ` · ${(bytes / 1024 / 1024).toFixed(1)} MB`;
function mediaLabel(attachment: Attachment) {
  const [type, subtype] = attachment.mime_type.split("/");
  const name =
    { image: "Image", audio: "Audio", video: "Video" }[type] ?? "File";
  return `${name}${name === "File" ? "" : ` · ${subtype.replace("mpeg", "mp3").toUpperCase()}`}${size(attachment.bytes)}`;
}

export function MediaIcon({ attachment }: { attachment: Attachment }) {
  const type = attachment.mime_type.split("/")[0];
  return (
    <span className="artifact-icon">
      {type === "image" ? (
        <Image size={18} />
      ) : type === "audio" ? (
        <Music size={18} />
      ) : type === "video" ? (
        <Film size={18} />
      ) : (
        <File size={18} />
      )}
    </span>
  );
}

/** A file a tool attached to Orca's message, shown as a card that opens the viewer. */
export function MediaCard({
  attachment,
  onOpen,
}: {
  attachment: Attachment;
  onOpen: () => void;
}) {
  return (
    <button className="artifact-row" onClick={onOpen}>
      <MediaIcon attachment={attachment} />
      <span>
        <strong>{attachment.title}</strong>
        <small>{mediaLabel(attachment)}</small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

/** One saved artifact (anything but an idea). URLs open in the browser; the rest open the viewer. */
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
  const media = ["image", "audio", "video"].includes(item.kind)
    ? artifactMedia(item)
    : null;
  return (
    <button className="artifact-row" onClick={onOpen}>
      {media ? (
        <MediaIcon attachment={media} />
      ) : (
        <span className="artifact-icon">
          <FileText size={18} />
        </span>
      )}
      <span>
        <strong>{item.title}</strong>
        <small>
          {media
            ? mediaLabel(media)
            : item.kind === "document"
              ? "Document"
              : item.kind}
        </small>
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
              setError(error instanceof Error ? error.message : "Unable to save."),
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
          <Button variant="primary" type="button" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            Edit
          </Button>
        )}
      </div>
    </>
  );
}

/** Opens one artifact or attached file: formatted documents with Edit, or a media player with Download. */
export function ArtifactViewer({
  taskId,
  artifacts,
  viewing: target,
  readOnly = false,
  context,
  onClose,
  onSaved,
  artifactLink,
}: {
  taskId: string;
  /** The work's current artifacts, so the viewer shows saved changes. */
  artifacts: TaskArtifact[];
  viewing: Viewable | null;
  readOnly?: boolean;
  /** Shown under the title, e.g. the platform. */
  context?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  artifactLink?: ArtifactLink;
}) {
  const found =
    target?.type === "artifact"
      ? artifacts.find((item) => item.id === target.id)
      : undefined;
  const viewing =
    target?.type === "media"
      ? target
      : found
        ? { type: "artifact" as const, artifact: found }
        : null;
  const media =
    viewing?.type === "media"
      ? viewing.attachment
      : viewing && ["image", "audio", "video"].includes(viewing.artifact.kind)
        ? artifactMedia(viewing.artifact)
        : null;
  const title =
    viewing?.type === "media"
      ? viewing.attachment.title
      : (viewing?.artifact.title ?? "Artifact");
  const description = media
    ? [context, mediaLabel(media)].filter(Boolean).join(" · ")
    : viewing?.type === "artifact" && viewing.artifact.kind === "document"
      ? [context, readOnly ? "Read only" : "Changes are saved to this work"]
          .filter(Boolean)
          .join(" · ")
      : context;
  return (
    <Modal
      open={viewing !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      description={description}
      className="artifact-modal"
    >
      {media ? (
        <MediaAttachment attachment={media} />
      ) : viewing?.type === "artifact" ? (
        ["image", "audio", "video"].includes(viewing.artifact.kind) ? (
          <p role="alert">This media is unavailable.</p>
        ) : (
          <DocumentView
            taskId={taskId}
            artifact={viewing.artifact}
            readOnly={readOnly}
            onSaved={onSaved}
            artifactLink={artifactLink}
          />
        )
      ) : null}
    </Modal>
  );
}
