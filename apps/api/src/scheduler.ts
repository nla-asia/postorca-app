import type { Database } from "./db.js";
import type { AgentRouter } from "./agent/router.js";
import { startDueRuns } from "./repositories/routines.js";
import { staleQueuedTurns } from "./repositories/turns.js";
import { desktopConnections } from "./desktop/connections.js";

const BATCH = 20;

/**
 * Server-owned routine scheduler. PostgreSQL is the source of truth: each tick
 * claims due routines with SKIP LOCKED, records the run (unique per occurrence),
 * creates the work task, advances next_run_at, commits, and only then dispatches
 * Orca. A run missed while the server was down executes once on the next tick;
 * it does not replay every missed occurrence.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  constructor(
    private db: Database,
    private agent: AgentRouter,
    private intervalMs = 30_000,
  ) {}
  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking;
  }
  tick() {
    // Never overlap ticks inside one process.
    this.ticking ??= this.runDue()
      .catch((error) => {
        console.error(
          "Scheduler tick failed:",
          error?.code ?? error?.message ?? error,
        );
      })
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }
  private async runDue() {
    for (;;) {
      const started = await startDueRuns(this.db, BATCH);
      for (const run of started.runs)
        if (run.founderReminder)
          desktopConnections.notify(run.userId, {
            ...run.founderReminder,
            taskId: run.taskId,
          });
        else this.agent.dispatch(run.taskId, run.turnId, run.userId);
      if (started.claimed < BATCH) break;
    }
    // A crash between commit and dispatch leaves a queued turn behind. Dispatching
    // again is safe: the agent loop only claims a turn with an atomic queued→running update.
    const orphaned = await staleQueuedTurns(this.db);
    for (const turn of orphaned)
      this.agent.dispatch(turn.task_id, turn.turn_id, turn.user_id);
  }
}
