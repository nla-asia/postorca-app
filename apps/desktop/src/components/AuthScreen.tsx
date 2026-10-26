import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "./ui";

import { authenticate, type AuthUser } from "../lib/api";
import "./AuthScreen.css";
import "./forms.css";
export type { AuthUser } from "../lib/api";
export default function AuthScreen({
  onComplete,
  notice = "",
}: {
  onComplete: (user: AuthUser) => void | Promise<void>;
  /** Why the user was signed out, shown until they act. */
  notice?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);
  const register = mode === "register";
  const switchMode = () => {
    setMode(register ? "login" : "register");
    setPassword("");
    setConfirmation("");
    setError("");
    setVisible(false);
  };
  return (
    <div className="auth-screen">
      <div className="auth-titlebar" />
      <main className="auth-main">
        <div className="auth-panel">
          <div className="auth-brand">
            <span className="brand-mark">
              <Sparkles size={22} strokeWidth={1.7} />
            </span>
            <span>PostOrca</span>
          </div>
          <h1>{register ? "Create account" : "Log in"}</h1>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError("");
              if (register && !name.trim()) {
                setError("Enter your name.");
                return;
              }
              if (register && password !== confirmation) {
                setError("Passwords don’t match.");
                return;
              }
              setBusy(true);
              try {
                const user = await authenticate(mode, {
                  email: email.trim(),
                  password,
                  ...(register ? { name: name.trim() } : {}),
                });
                setPassword("");
                setConfirmation("");
                await onComplete(user);
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : "Unable to log in.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy} className="form-stack">
              {register && (
                <label htmlFor="auth-name">
                  Name
                  <input
                    id="auth-name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              <label htmlFor="auth-email">
                Email
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label htmlFor="auth-password">
                Password
                <span className="password-field">
                  <input
                    id="auth-password"
                    type={visible ? "text" : "password"}
                    autoComplete={
                      register ? "new-password" : "current-password"
                    }
                    required
                    minLength={register ? 8 : 1}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-describedby={register ? "password-hint" : undefined}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    aria-pressed={visible}
                    onClick={() => setVisible((value) => !value)}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
                {register && (
                  <small id="password-hint" className="auth-field-hint">
                    At least 8 characters.
                  </small>
                )}
              </label>
              {register && (
                <label htmlFor="auth-confirm">
                  Confirm password
                  <input
                    id="auth-confirm"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      setError("");
                    }}
                    aria-invalid={!!error}
                    aria-describedby={error ? "auth-error" : undefined}
                  />
                </label>
              )}
              {error && (
                <p className="auth-error" id="auth-error" role="alert">
                  {error}
                </p>
              )}
              <Button variant="primary" className="auth-submit" type="submit">
                {busy ? (
                  <>
                    <LoaderCircle className="loading-icon" size={16} />
                    {register ? "Creating account…" : "Logging in…"}
                  </>
                ) : (
                  <>
                    {register ? "Create account" : "Log in"}
                    <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </fieldset>
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "Don’t have an account?"}
            <button disabled={busy} onClick={switchMode}>
              {register ? "Log in" : "Sign up"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
