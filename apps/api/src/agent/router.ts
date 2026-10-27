import type { Database } from "../db.js";
import type { Provider } from "../providers/types.js";
import { AgentLoop } from "./loop.js";

/** Starts turns in the background and waits for them on shutdown. */
export class AgentRouter {
  private running = new Set<Promise<void>>();
  constructor(private loop: AgentLoop) {}

  /** Call only after the turn is committed, so the loop can claim it. */
  dispatch(taskId: string, turnId: string, userId: string) {
    const promise = this.loop.run(taskId, turnId, userId).catch(() => {
      console.error("Agent execution failed; inspect the turn status.");
    });
    this.running.add(promise);
    void promise.finally(() => this.running.delete(promise));
  }

  async shutdown() {
    this.loop.stop();
    await Promise.allSettled([...this.running]);
  }
}

/** A router whose loop can dispatch background work (start_task) through it. */
export function createAgent(db: Database, provider: Provider) {
  const router: AgentRouter = new AgentRouter(
    new AgentLoop(db, provider, (taskId, turnId, userId) =>
      router.dispatch(taskId, turnId, userId),
    ),
  );
  return router;
}
