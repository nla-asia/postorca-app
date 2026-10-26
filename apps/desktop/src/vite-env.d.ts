/// <reference types="vite/client" />

/** Bridge exposed by Electron; absent in a plain browser. */
interface Window {
  postorca?: {
    session: {
      get(): Promise<string | null>;
      set(session: { token: string; apiUrl: string }): Promise<void>;
      clear(): Promise<void>;
    };
  };
}
