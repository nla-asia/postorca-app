import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { apiFile } from "../lib/api";
import type { MediaAttachment as Attachment } from "../lib/media";
import "./MediaAttachment.css";

/** Loads a saved file through the authenticated API as a temporary object URL. */
export function useMediaUrl(attachment: Attachment) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    void apiFile(attachment.file, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        if (blob.type !== attachment.mime_type)
          throw new Error("Unexpected media format.");
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Unable to load media.",
          );
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.file, attachment.mime_type, attempt]);
  return { url, error, setError, retry: () => setAttempt((value) => value + 1) };
}

export default function MediaAttachment({
  attachment,
}: {
  attachment: Attachment;
}) {
  const { url, error, setError, retry } = useMediaUrl(attachment);
  const audio = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4"].includes(
    attachment.mime_type,
  );
  const video = ["video/mp4", "video/webm"].includes(attachment.mime_type);
  const image = ["image/png", "image/jpeg", "image/webp"].includes(
    attachment.mime_type,
  );
  const extension =
    (
      {
        "image/png": "png",
        "image/jpeg": "jpg",
        "audio/mpeg": "mp3",
        "video/mp4": "mp4",
      } as Record<string, string>
    )[attachment.mime_type] || "bin";
  const filename =
    attachment.filename?.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") ||
    `${attachment.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 100) || "media"}.${extension}`;
  return (
    <figure className="media-attachment">
      {error ? (
        <div className="media-error" role="alert">
          {error}{" "}
          <button type="button" onClick={retry}>
            Retry loading
          </button>
        </div>
      ) : !url ? (
        <p role="status">Loading media…</p>
      ) : video ? (
        <video
          controls
          playsInline
          preload="metadata"
          src={url}
          aria-label={attachment.title}
          onError={() => setError("Unable to play this video.")}
        />
      ) : audio ? (
        <audio
          controls
          preload="metadata"
          src={url}
          aria-label={attachment.title}
        />
      ) : image ? (
        <img
          src={url}
          alt={attachment.title}
          onError={() => setError("Unable to display this image.")}
        />
      ) : (
        <p>
          File attachment
          {attachment.bytes
            ? ` · ${(attachment.bytes / 1024).toFixed(1)} KB`
            : ""}
        </p>
      )}
      {url && (
        <a className="media-download" href={url} download={filename}>
          <Download size={15} aria-hidden="true" />
          Download
        </a>
      )}
    </figure>
  );
}
