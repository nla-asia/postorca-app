export type AuthUser = { id: string; email: string; name: string };
const baseUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:3001/api";
const tokenKey = "postorca-access-token";
const hot = import.meta.hot?.data as { token?: string | null } | undefined;
let token: string | null = hot?.token ?? null;
const remember = (value: string | null) => {
  token = value;
  if (hot) hot.token = value;
};

// Session storage retains sign-in across reloads in the current window.
export const tokenStore = {
  async load() {
    remember(sessionStorage.getItem(tokenKey));
    return token;
  },
  get: () => token,
  set: (value: string) => {
    remember(value);
    sessionStorage.setItem(tokenKey, value);
  },
  clear: () => {
    remember(null);
    sessionStorage.removeItem(tokenKey);
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
  const token = tokenStore.get();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
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
  if (response.ok) return response;
  const result = await response.json().catch(() => ({}));
  if (
    response.status === 401 &&
    !["/auth/login", "/auth/register"].includes(path)
  ) {
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
export async function authenticate(
  mode: "login" | "register",
  data: { email: string; password: string; name?: string },
) {
  const result = await api<{ user: AuthUser; token: string }>(`/auth/${mode}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  tokenStore.set(result.token);
  return result.user;
}
