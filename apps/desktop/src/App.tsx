import { useCallback, useEffect, useState } from "react";
import AuthScreen from "./components/AuthScreen";
import BrandMark from "./components/BrandMark";
import Workspace from "./components/Workspace";
import WorkingFolderSetup from "./components/WorkingFolderSetup";
import {
  api,
  ApiError,
  onUnauthorized,
  tokenStore,
  type AuthUser,
} from "./lib/api";
import { useTheme } from "./lib/useTheme";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useTheme();
  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(
    () =>
      onUnauthorized((message) => {
        setNotice(message);
        signOut();
      }),
    [signOut],
  );

  useEffect(() => {
    let cancelled = false;
    void tokenStore
      .load()
      .then(async (saved) => {
        if (!saved) return;
        const result = await api<{ user: AuthUser }>("/auth/me");
        if (!cancelled) setUser(result.user);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401)
          tokenStore.clear();
        setNotice(
          error instanceof Error
            ? error.message
            : "Unable to restore your session.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading)
    return (
      <div className="auth-screen">
        <div className="auth-titlebar" />
        <div
          className="auth-loading"
          role="status"
          aria-label="Loading account"
        >
          <BrandMark large />
        </div>
      </div>
    );
  if (!user)
    return (
      <AuthScreen
        notice={notice}
        onComplete={(account) => {
          setNotice("");
          setUser(account);
        }}
      />
    );
  return (
    <WorkingFolderSetup key={user.id} onLogOut={signOut}>
      <Workspace
        key={user.id}
        user={user}
        onLogOut={() => {
          setNotice("");
          signOut();
        }}
        theme={theme}
        onThemeChange={setTheme}
      />
    </WorkingFolderSetup>
  );
}
