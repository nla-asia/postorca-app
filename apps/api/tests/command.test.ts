import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commandArgs } from "../src/tools/command.js";
import { toolsForTask } from "../src/tools/index.js";
import { desktopConnections } from "../src/desktop/connections.js";
import { settleDesktopTool } from "../src/desktop/calls.js";
import { desktopToolset } from "../src/tools/desktop.js";
import type { WebSocket } from "ws";
import type { ToolContext } from "../src/tools/shared.js";

test("one command tool is available independently of plugins in every task kind", () => {
  for (const kind of ["chat", "work", "onboarding"] as const) {
    const tools = toolsForTask(kind).filter((tool) => tool.name === "command");
    assert.equal(tools.length, 1);
    assert.equal(tools[0].parameters.additionalProperties, false);
  }
});

test("command schema distinguishes starting a process from literal input to a session", () => {
  const session_id = `${randomUUID()}:${randomUUID()}`;
  for (const args of [
    { action: "run", command: "npm run dev", cwd: "/project", wait_ms: 0 },
    { action: "run", session_id, input: "i\r" },
    { action: "list" },
    { action: "read", session_id, cursor: 100 },
    { action: "kill", session_id },
  ]) assert.ok(commandArgs.safeParse(args).success, JSON.stringify(args));
  for (const args of [
    { action: "run" },
    { action: "run", session_id, command: "npm run dev" },
    { action: "run", command: "npm run dev", input: "yes" },
    { action: "run", session_id, input: "yes", cwd: "/project" },
    { action: "list", session_id },
    { action: "read" },
    { action: "read", session_id, input: "yes" },
    { action: "kill", session_id, cursor: 0 },
    { action: "run", command: "echo hi", roots: ["/etc"] },
    { action: "read", session_id, wait_ms: 10001 },
  ]) assert.equal(commandArgs.safeParse(args).success, false, JSON.stringify(args));
});

test("session calls route back to their original desktop and receive server-owned project roots", async () => {
  const userId = randomUUID();
  const first = randomUUID();
  const second = randomUUID();
  const calls: any[] = [];
  const socket = (deviceId: string) => ({
    readyState: 1,
    send(raw: string) {
      const { data: call } = JSON.parse(raw);
      calls.push({ deviceId, ...call });
      settleDesktopTool({ userId, deviceId }, call.executionId, { ok: true, result: { deviceId } });
    },
  }) as unknown as WebSocket;
  const one = socket(first), two = socket(second);
  desktopConnections.add(userId, first, one);
  desktopConnections.add(userId, second, two);
  // Exercise the actual desktop tool wrapper with the two repository queries it
  // needs. Ownership and project isolation are also covered by projects.test.ts.
  const db = { query: async (sql: string) => ({ rows: sql.includes("FROM tasks")
    ? [{ id: "task", user_id: userId, project_id: "project" }]
    : [{ id: "project", folders: ["/project"] }, { id: "other", folders: ["/other"] }] }) };
  const context = { db, userId, taskId: "task", turnId: "turn" } as unknown as ToolContext;
  const tool = desktopToolset.find((tool) => tool.definition.name === "command")!;
  try {
    assert.deepEqual(await tool.run(context, { action: "run", command: "npm run dev", cwd: "/project" }), { deviceId: second });
    const session_id = `${first}:${randomUUID()}`;
    assert.deepEqual(await tool.run(context, { action: "read", session_id }), { deviceId: first });
    assert.deepEqual(calls[0].arguments.roots, ["/project"]);
    assert.deepEqual(calls[1].arguments.roots, ["/project"]);
    assert.equal(calls[0].timeoutMs, 30_000);
    desktopConnections.remove(first, one);
    await assert.rejects(tool.run(context, { action: "kill", session_id }), /not connected/);
    assert.equal(calls.length, 2, "must not send session input to another desktop");
  } finally {
    desktopConnections.remove(first, one);
    desktopConnections.remove(second, two);
  }
});
