/// <reference types="vite/client" />

/** Bridge exposed by Electron; absent in a plain browser. */
interface Window {
  postorca?: {
    session: {
      get(): Promise<string | null>;
      set(session: { token: string; refreshToken: string; apiUrl: string }): Promise<void>;
      refresh(): Promise<string | null>;
      clear(): Promise<void>;
    };
    /** Picks a folder for a Brand Profile project; doesn't save it. */
    projectFolder: {
      choose(): Promise<string | null>;
    };
    /** Subscribes to notifications the OS wouldn't show; returns unsubscribe. */
    onNotification(
      callback: (notification: {
        title: string;
        body: string;
        taskId?: string;
      }) => void,
    ): () => void;
    /** Subscribes to notification clicks that should open a task; returns unsubscribe. */
    onOpenTask(callback: (taskId: string) => void): () => void;
  };
}
