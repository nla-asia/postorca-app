/// <reference types="vite/client" />

/** Bridge exposed by Electron; absent in a plain browser. */
interface Window {
  postorca?: {
    session: {
      get(): Promise<string | null>;
      set(session: { token: string; apiUrl: string }): Promise<void>;
      clear(): Promise<void>;
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
