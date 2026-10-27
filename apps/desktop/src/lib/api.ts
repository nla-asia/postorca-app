export type AuthUser = { id: string; email: string; name: string };
const baseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001/api";
const tokenKey = "postorca-access-token";
const refreshKey = "postorca-refresh-token";
type Login = { token: string; refreshToken: string };
const desktop = window.postorca;
const hot = import.meta.hot?.data as { token?: string | null } | undefined;
let token: string | null = hot?.token ?? null;
const remember = (value: string | null) => {
  token = value;
  if (hot) hot.token = value;
};
let refreshing: Promise<string | null> | null = null;
/** Exchanges the browser's refresh token for a new access token; null when rejected. */
async function refreshInBrowser() {
  const refreshToken = sessionStorage.getItem(refreshKey);
  if (!refreshToken) return null;
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const login: Login = await response.json();
  sessionStorage.setItem(tokenKey, login.token);
  sessionStorage.setItem(refreshKey, login.refreshToken);
  return login.token;
}

// Electron owns encrypted persistence; browsers use the current window's session.
export const tokenStore = {
  async load() {
    if (desktop) sessionStorage.removeItem(tokenKey);
    remember(
      desktop ? await desktop.session.get() : sessionStorage.getItem(tokenKey),
    );
    return token;
  },
  get: () => token,
  set: (login: Login | string) => {
    // Accept either a full Login object (from authenticate) or a plain token string.
    const value = typeof login === "string" ? login : login.token;
    const refreshToken = typeof login === "string" ? undefined : login.refreshToken;
    remember(value);
    if (desktop) void desktop.session.set({ token: value, refreshToken: refreshToken ?? "", apiUrl: baseUrl });
    else {
      sessionStorage.setItem(tokenKey, value);
      if (typeof login !== "string" && login.refreshToken)
        sessionStorage.setItem(refreshKey, login.refreshToken);
    }
  },
  /**
   * A new access token for the same login, shared by concurrent callers.
   * Returns null when the session was rejected; throws when the server cannot be reached.
   * On desktop, Electron's main process manages token persistence, so this
   * only applies to browser sessions.
   */
  refresh: () =>
    (refreshing ??= refreshInBrowser()
      .then((value) => {
        remember(value);
        return value;
      })
      .finally(() => (refreshing = null))),
  clear: () => {
    remember(null);
    if (desktop) void desktop.session.clear();
    else {
      const refreshToken = sessionStorage.getItem(refreshKey);
      sessionStorage.removeItem(tokenKey);
      sessionStorage.removeItem(refreshKey);
      if (refreshToken)
        void fetch(`${baseUrl}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {});
    }
  },
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// A rejected login anywhere signs the whole app out instead of leaving
// individual panels showing "Please log in." under a signed-in UI.
const unauthorizedListeners = new Set<(message: string) => void>();
export function onUnauthorized(listener: (message: string) => void) {
  unauthorizedListeners.add(listener);
  return () => void unauthorizedListeners.delete(listener);
}
async function apiResponse(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const send = async (token: string | null) => {
    try {
      return await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
        signal: options.signal ?? AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("Unable to reach the server. Please try again.");
    }
  };
  const currentToken = tokenStore.get();
  let response = await send(currentToken);
  const signedIn =
    !!currentToken && !["/auth/login", "/auth/register"].includes(path);
  // An expired access token is routine: refresh once and retry.
  if (response.status === 401 && signedIn) {
    // A request that raced another's refresh retries with the token it got.
    const latest = tokenStore.get();
    let next: string | null;
    try {
      next =
        latest && latest !== currentToken ? latest : await tokenStore.refresh();
    } catch {
      throw new Error("Unable to reach the server. Please try again.");
    }
    if (next) response = await send(next);
  }
  if (response.ok) return response;
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && signedIn) {
    const message =
      result.error ?? "Your session has expired. Please log in again.";
    tokenStore.clear();
    for (const listener of unauthorizedListeners) listener(message);
  }
  throw new ApiError(response.status, result.error ?? "The request failed.");
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await apiResponse(path, options);
  if (response.status === 204) return undefined as T;
  return response.json();
}
/** One of the founder's saved files, loaded through the authenticated API. */
export async function apiFile(
  key: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await apiResponse(`/files?key=${encodeURIComponent(key)}`, {
    signal,
  });
  return response.blob();
}
export async function authenticate(
  mode: "login" | "register",
  data: { email: string; password: string; name?: string },
) {
  const result = await api<{ user: AuthUser } & { token: string; refreshToken: string }>(
    `/auth/${mode}`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
  tokenStore.set(result);
  return result.user;
}
