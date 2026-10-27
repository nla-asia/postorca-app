import { useCallback, useEffect, useState } from "react";
import { Check, FolderOpen, Mail } from "lucide-react";
import { api } from "../lib/api";
import { Button, Modal } from "./ui";

type Connection = {
  id: "gmail" | "google_drive";
  name: string;
  description: string;
  connected: boolean;
  email: string | null;
};

export default function ConnectApps({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [filter, setFilter] = useState("All apps");
  const [apps, setApps] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(
    null,
  );

  const reload = useCallback(async () => {
    try {
      const result = await api<Connection[]>("/connectors");
      setApps(result);
      setError("");
      setLoading(false);
      return result;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to load apps.",
      );
      setLoading(false);
      return [];
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDisconnect(null);
    void reload();
    const refresh = () => void reload();
    window.addEventListener("focus", refresh);
    const timer = setInterval(
      () => {
        void reload().then((result) => {
          if (
            authorizing &&
            result.some((app) => app.id === authorizing && app.connected)
          ) {
            setAuthorizing(null);
            setAuthUrl("");
          }
        });
      },
      authorizing ? 2000 : 15000,
    );
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [open, reload, authorizing]);

  const connect = async (app: Connection) => {
    setPending(app.id);
    setError("");
    try {
      const result = await api<{ url: string }>(
        `/connectors/${app.id}/connect`,
        { method: "POST", body: "{}" },
      );
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.google.com")
        throw new Error(
          "The server returned an invalid Google authorization URL.",
        );
      setAuthUrl(url.href);
      setAuthorizing(app.id);
      window.open(url.href, "_blank", "noopener,noreferrer");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to connect app.",
      );
    } finally {
      setPending(null);
    }
  };

  const disconnect = async (app: Connection) => {
    setPending(app.id);
    setError("");
    try {
      await api(`/connectors/${app.id}`, { method: "DELETE" });
      setConfirmDisconnect(null);
      setAuthorizing(null);
      setAuthUrl("");
      await reload();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to disconnect app.",
      );
    } finally {
      setPending(null);
    }
  };

  const connected = apps.filter((app) => app.connected);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Connect Apps" wide>
      <div className="connectors-content">
        <div className="section-toolbar">
          <div className="tabs">
            {["All apps", "Connected"].map((name) => (
              <button
                type="button"
                key={name}
                className={filter === name ? "selected" : ""}
                aria-pressed={filter === name}
                onClick={() => setFilter(name)}
              >
                {name}
                {name === "Connected" && <span>{connected.length}</span>}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading…</p>
        ) : (
          <div className="connectors-grid">
            {(filter === "Connected" ? connected : apps).map((app) => (
              <article className="connector-card" key={app.id}>
                <span className="connector-icon" aria-hidden="true">
                  {app.id === "gmail" ? (
                    <Mail size={24} />
                  ) : (
                    <FolderOpen size={24} />
                  )}
                </span>
                <div className="connector-info">
                  <h3>{app.name}</h3>
                  <p>{app.description}</p>
                  {app.connected && (
                    <span className="connector-status">
                      <Check size={12} aria-hidden="true" />
                      {app.email}
                    </span>
                  )}
                  {authorizing === app.id && !app.connected && (
                    <a href={authUrl} target="_blank" rel="noreferrer">
                      Continue in Google
                    </a>
                  )}
                </div>
                <Button
                  disabled={pending !== null}
                  aria-label={`${app.connected ? "Disconnect" : "Connect"} ${app.name}`}
                  onClick={() =>
                    app.connected
                      ? confirmDisconnect === app.id
                        ? void disconnect(app)
                        : setConfirmDisconnect(app.id)
                      : void connect(app)
                  }
                >
                  {pending === app.id
                    ? "Working…"
                    : app.connected
                      ? confirmDisconnect === app.id
                        ? "Confirm disconnect"
                        : "Disconnect"
                      : "Connect"}
                </Button>
              </article>
            ))}
            {filter === "Connected" && !connected.length && (
              <p className="connectors-empty">No connected apps.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
