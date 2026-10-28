import { useEffect, useState, type ReactNode } from "react";
import { FolderOpen, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "./ui";
import "./AuthScreen.css";
import "./forms.css";

/** Desktop setup must finish before onboarding or the workspace mounts. */
export default function WorkingFolderSetup({
  children,
  onLogOut,
}: {
  children: ReactNode;
  onLogOut: () => void;
}) {
  const folders = window.postorca?.workingFolder;
  const [ready, setReady] = useState(!folders);
  const [checking, setChecking] = useState(!!folders);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!folders) return;
    let cancelled = false;
    void folders.get().then(
      (folder) => {
        if (!cancelled) {
          setReady(!!folder);
          setChecking(false);
        }
      },
      () => {
        if (!cancelled) {
          setError("Unable to check your working folder. Choose a folder to continue.");
          setChecking(false);
        }
      },
    );
    return () => { cancelled = true; };
  }, [folders]);

  if (ready) return children;
  return (
    <div className="auth-screen">
      <div className="auth-titlebar" />
      {checking ? (
        <div className="auth-loading" role="status" aria-label="Checking working folder">
          <LoaderCircle className="loading-icon" size={24} />
        </div>
      ) : (
        <main className="auth-main">
          <div className="auth-panel">
            <div className="auth-brand">
              <span className="brand-mark"><Sparkles size={22} strokeWidth={1.7} /></span>
              <span>PostOrca</span>
            </div>
            <h1>Choose your working folder</h1>
            <div className="form-stack">
              <p>Set a working folder to continue. Orca can read and use files here, such as images, music and notes for your content.</p>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <Button
                variant="primary"
                className="auth-submit"
                disabled={busy}
                onClick={async () => {
                  if (!folders || busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    const folder = await folders.choose();
                    if (folder) setReady(true);
                  } catch {
                    setError("Unable to save your working folder. Please try again.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <LoaderCircle className="loading-icon" size={16} /> : <FolderOpen size={16} />}
                {busy ? "Choosing folder…" : "Choose folder"}
              </Button>
            </div>
            <p className="auth-switch"><button disabled={busy} onClick={onLogOut}>Log out</button></p>
          </div>
        </main>
      )}
    </div>
  );
}
