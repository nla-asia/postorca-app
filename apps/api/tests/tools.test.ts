import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrate.js";
import { memoryIndex } from "../src/memory.js";
import { createUser } from "../src/repositories/users.js";
import {
  appendMessage,
  createTask,
  createTurn,
  createWorkTask,
  reviewTask,
} from "../src/repositories/tasks.js";
import {
  createArtifact,
  updateDocumentArtifact,
} from "../src/repositories/artifacts.js";
import { completeTurn } from "../src/repositories/turns.js";
import { executeTool, toolsForTask, type DispatchTask } from "../src/tools/index.js";
import { temporaryPostgres } from "./postgres.js";

let fixture: Awaited<ReturnType<typeof temporaryPostgres>>;
let storage: string;
const originalStorage = process.env.STORAGE_DIR;
let accountNumber = 0;
before(async () => {
  fixture = await temporaryPostgres();
  await migrate(fixture.db);
  storage = await mkdtemp(join(tmpdir(), "postorca-tools-storage-"));
  process.env.STORAGE_DIR = storage;
});
after(async () => {
  if (originalStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = originalStorage;
  await rm(storage, { recursive: true, force: true });
  await fixture?.close();
});

async function account() {
  const user = await createUser(
    fixture.db,
    "Founder",
    `tools-${++accountNumber}@example.com`,
    "tools-test-password",
  );
  return user.id as string;
}
type Context = { userId: string; taskId: string; turnId: string };
const run = (
  context: Context,
  name: string,
  args: unknown,
  dispatch?: DispatchTask,
) => executeTool(fixture.db, context, name, args, dispatch) as Promise<any>;
const workContext = async (userId: string, title = "Drafts") => {
  const { task, turn } = await createWorkTask(fixture.db, userId, title, title);
  return { userId, taskId: task.id as string, turnId: turn.id as string };
};
const noDispatch: DispatchTask = () =>
  assert.fail("a refused tool call must not dispatch work");

test("each task kind gets its tools; chat-only tools stay out of background work", () => {
  const names = (kind: "chat" | "onboarding" | "work") =>
    toolsForTask(kind).map((tool) => tool.name);
  const chatOnly = ["start_task", "get_task", "follow_up_task", "request_user_input"];
  for (const kind of ["chat", "onboarding"] as const)
    for (const name of chatOnly) assert.ok(names(kind).includes(name), `${name} in ${kind}`);
  assert.ok(chatOnly.every((name) => !names("work").includes(name)));
  for (const kind of ["chat", "onboarding", "work"] as const) {
    assert.equal(new Set(names(kind)).size, names(kind).length);
    for (const name of [
      "read_brand_profile",
      "save_brand_link",
      "create_artifact",
      "edit_document",
      "save_memory",
      "list_my_posts",
      "search_my_posts",
      "save_my_post",
      "mark_my_posts_synced",
      "delete_my_post",
      "list_content_feedback",
    ])
      assert.ok(names(kind).includes(name), `${name} in ${kind}`);
  }
  for (const tool of toolsForTask("chat"))
    assert.equal(tool.parameters.additionalProperties, false, tool.name);
});

test("unknown tools are refused with a message the model can act on", async () => {
  const context = await workContext(await account());
  await assert.rejects(run(context, "send_email", {}), {
    status: 400,
    message: "Unknown tool send_email.",
  });
});

test("link tools save or delete one owned link and profile updates leave links alone", async () => {
  const userId = await account();
  const other = await account();
  const context = { userId, taskId: "unused", turnId: "unused" };
  const first = await run(context, "save_brand_link", {
    name: "Website",
    url: "https://example.com",
    kind: "website",
  });
  // A website alone is context; onboarding needs a social account.
  await assert.rejects(
    run(context, "update_brand_profile", {
      company: "Product",
      topics: "Research",
      onboarding_status: "completed",
    }),
    /social account link/,
  );
  const second = await run(context, "save_brand_link", {
    name: "X Profile",
    url: "https://x.com/founder",
    kind: "x",
  });
  assert.ok(first.id && second.id && first.id !== second.id);
  assert.equal(second.access_status, "not_granted");
  const updated = await run(context, "save_brand_link", {
    id: first.id,
    name: "Product Website",
    url: "https://example.com/about",
  });
  assert.equal(updated.id, first.id);
  assert.equal(updated.kind, "website");
  let profile = await run(context, "read_brand_profile", {});
  assert.equal(profile.links.length, 2);
  assert.deepEqual(
    profile.links.find((link: { id: string }) => link.id === second.id),
    second,
  );

  await run(context, "update_brand_profile", {
    company: "Product",
    topics: "Research",
    audience: "Builders",
    onboarding_status: "completed",
  });
  profile = await run(context, "read_brand_profile", {});
  assert.equal(profile.links.length, 2);
  assert.equal(profile.audience, "Builders");
  assert.equal(profile.onboarding_status, "completed");

  // Links change only through the link tools, and only with valid, owned IDs.
  await assert.rejects(run(context, "update_brand_profile", { links: [] }));
  for (const bad of [
    { id: first.id, name: "Bad", url: "javascript:alert(1)" },
    { id: "bad-id", name: "Bad", url: "https://example.com" },
  ])
    await assert.rejects(run(context, "save_brand_link", bad));
  const foreign = { ...context, userId: other };
  await assert.rejects(
    run(foreign, "save_brand_link", { ...first, name: "Stolen" }),
    { status: 404 },
  );
  await assert.rejects(run(foreign, "delete_brand_link", { id: first.id }), {
    status: 404,
  });

  assert.deepEqual(await run(context, "delete_brand_link", { id: first.id }), {
    id: first.id,
    deleted: true,
  });
  await assert.rejects(run(context, "save_brand_link", { ...first }), {
    status: 404,
  });
  await assert.rejects(run(context, "delete_brand_link", { id: first.id }), {
    status: 404,
  });
  profile = await run(context, "read_brand_profile", {});
  assert.deepEqual(profile.links, [second]);
  assert.equal(profile.onboarding_status, "completed");
  // Removing the last link reopens onboarding without losing other details.
  await run(context, "delete_brand_link", { id: second.id });
  profile = await run(context, "read_brand_profile", {});
  assert.deepEqual(profile.links, []);
  assert.equal(profile.onboarding_status, "in_progress");
  assert.equal(profile.audience, "Builders");
});

test("completing a profile seeds default routines, and deleting their link pauses them", async () => {
  const userId = await account();
  await fixture.db.query("UPDATE users SET timezone='Asia/Bangkok' WHERE id=$1", [userId]);
  const context = { userId, taskId: "unused", turnId: "unused" };
  const link = await run(context, "save_brand_link", {
    name: "X Profile",
    url: "https://x.com/founder",
    kind: "x",
  });
  assert.equal(link.default_routines_created, undefined);
  const profile = await run(context, "update_brand_profile", {
    company: "Product",
    topics: "Research",
    onboarding_status: "completed",
  });
  assert.ok(profile.default_routines_created.length > 0);
  // The posts sync and voice review cover every account, so only the link's own routines pause.
  const deleted = await run(context, "delete_brand_link", { id: link.id });
  assert.equal(
    deleted.routines_paused,
    profile.default_routines_created.length - 2,
  );
  const { rows } = await fixture.db.query(
    "SELECT platform, active FROM routines WHERE user_id=$1",
    [userId],
  );
  assert.ok(
    rows.length &&
      rows.every((row) => row.active === (row.platform === null)),
  );
});

test("artifact tools deliver text, links and ideas to their own task only", async () => {
  const userId = await account();
  const first = await workContext(userId);
  const other = await workContext(userId, "Other");
  const idea = await run(first, "create_artifact", {
    kind: "idea",
    title: "Hook",
    content: "A short hook",
  });
  assert.equal(idea.kind, "idea");
  const link = await run(first, "create_artifact", {
    kind: "url",
    title: "Source",
    content: "https://example.com/source",
  });
  assert.equal(link.content, "https://example.com/source");
  await assert.rejects(
    run(first, "create_artifact", { kind: "url", title: "Bad", content: "javascript:alert(1)" }),
  );
  // Media needs a saved file, which no tool here can produce.
  await assert.rejects(
    run(first, "create_artifact", { kind: "image", title: "Photo", content: "abc12345" }),
  );
  await assert.rejects(run(other, "delete_artifact", { id: idea.id }), {
    status: 404,
    message: "No artifact with that id in this task.",
  });
  assert.deepEqual(await run(first, "delete_artifact", { id: idea.id }), {
    id: idea.id,
    title: "Hook",
    deleted: true,
  });
  assert.deepEqual(await run(first, "read_artifact", {}), {
    artifacts: [{ id: link.id, kind: "url", title: "Source" }],
  });
});

test("edit_document revises the current document in place by unique find and replace", async () => {
  const userId = await account();
  const first = await workContext(userId);
  const other = await workContext(userId, "Other");
  const draft = await run(first, "create_artifact", {
    kind: "document",
    title: "Draft 1",
    content: "Hook line.\n\nBody one.\n\nBody two.\n\nCTA.",
  });
  // The founder edits by hand; Orca reads that version.
  await updateDocumentArtifact(
    fixture.db,
    first.taskId,
    draft.id,
    "Hook line.\n\nBody one, founder's words.\n\nBody two.\n\nCTA.",
  );
  assert.match(
    (await run(first, "read_artifact", { id: draft.id })).content,
    /founder's words/,
  );
  const edited = await run(first, "edit_document", {
    id: draft.id,
    edits: [
      { find: "Hook line.", replace: "A sharper hook." },
      { find: "CTA.", replace: "" },
    ],
  });
  assert.deepEqual(edited, {
    id: draft.id,
    title: "Draft 1",
    content: "A sharper hook.\n\nBody one, founder's words.\n\nBody two.\n\n",
  });
  // Ambiguous or missing text saves nothing.
  await assert.rejects(
    run(first, "edit_document", {
      id: draft.id,
      edits: [
        { find: "A sharper hook.", replace: "Changed." },
        { find: "Body", replace: "X" },
      ],
    }),
    /Edit 2: the find text appears 2 times/,
  );
  await assert.rejects(
    run(first, "edit_document", { id: draft.id, edits: [{ find: "Missing", replace: "X" }] }),
    /is not in the current document; read_artifact/,
  );
  await assert.rejects(
    run(first, "edit_document", {
      id: draft.id,
      edits: [{ find: "Body", replace: "" }],
      content: "Both",
    }),
    /Pass either edits or content/,
  );
  await assert.rejects(
    run(first, "edit_document", {
      id: draft.id,
      edits: [{ find: edited.content, replace: "   " }],
    }),
    /must be non-empty/,
  );
  assert.match((await run(first, "read_artifact", { id: draft.id })).content, /^A sharper hook\./);
  // A full rewrite, still one document; other tasks cannot read or edit it.
  await run(first, "edit_document", { id: draft.id, content: "Rewritten." });
  await assert.rejects(
    run(other, "edit_document", { id: draft.id, content: "Nope" }),
    /No document with that id in this task/,
  );
  await assert.rejects(
    run(other, "read_artifact", { id: draft.id }),
    /No artifact with that id in this task/,
  );
  // Only documents are editable.
  const idea = await run(first, "create_artifact", { kind: "idea", title: "Idea", content: "Text" });
  await assert.rejects(run(first, "edit_document", { id: idea.id, content: "New" }), {
    status: 404,
  });
  const { rows } = await fixture.db.query(
    "SELECT content FROM artifacts WHERE task_id=$1 AND kind='document'",
    [first.taskId],
  );
  assert.deepEqual(rows, [{ content: "Rewritten." }]);
});

test("list_content_ideas returns the founder's recent ideas, newest first", async () => {
  const userId = await account();
  const otherUser = await account();
  const ideaTask = async (owner: string, title: string, platform: string) => {
    const task = await createTask(fixture.db, owner, "work", title);
    await fixture.db.query("UPDATE tasks SET platform=$2 WHERE id=$1", [task.id, platform]);
    const turn = await createTurn(fixture.db, owner, task.id, "Find ideas");
    return { task, turn };
  };
  const idea = (work: Awaited<ReturnType<typeof ideaTask>>, kind: "idea" | "document", title: string) =>
    createArtifact(fixture.db, work.task.id, work.turn.id, { kind, title, content: title });
  const x = await ideaTask(userId, "Content ideas", "X");
  const older = await idea(x, "idea", "Older X idea");
  await idea(x, "idea", "Newer X idea");
  await idea(x, "document", "Not an idea");
  const linkedIn = await ideaTask(userId, "LinkedIn ideas", "LinkedIn");
  await idea(linkedIn, "idea", "LinkedIn idea");
  const archived = await ideaTask(userId, "Archived ideas", "X");
  await idea(archived, "idea", "Archived idea");
  await fixture.db.query("UPDATE tasks SET archived_at=now() WHERE id=$1", [archived.task.id]);
  await idea(await ideaTask(otherUser, "Content ideas", "X"), "idea", "Someone else's idea");
  const stale = await idea(x, "idea", "Stale idea");
  await fixture.db.query("UPDATE artifacts SET created_at=now()-interval '30 days' WHERE id=$1", [stale.id]);
  // An idea already turned into queued content says so.
  await fixture.db.query(
    `INSERT INTO routines(user_id,title,instructions,timezone,active,next_run_at,run_at,source_artifact_id)
     VALUES ($1,'Queued','x','UTC',true,now()+interval '1 day',now()+interval '1 day',$2)`,
    [userId, older.id],
  );
  const context = { userId, taskId: "unused", turnId: "unused" };
  const list = async (args: unknown) =>
    (await run(context, "list_content_ideas", args)).ideas.map(
      (item: { title: string; platform: string; content_queued: boolean }) =>
        [item.title, item.platform, item.content_queued],
    );
  assert.deepEqual(await list({ platform: "X" }), [
    ["Newer X idea", "X", false],
    ["Older X idea", "X", true],
  ]);
  assert.deepEqual(await list({ limit: 1 }), [["LinkedIn idea", "LinkedIn", false]]);
  assert.equal((await list({ days: 60, platform: "X" })).length, 3);
  assert.deepEqual(
    await run({ ...context, userId: await account() }, "list_content_ideas", {}),
    { ideas: [], message: "No content ideas in the last 7 days." },
  );
  await assert.rejects(run(context, "list_content_ideas", { days: 61 }));
});

test("list_content_feedback returns the founder's messages in content tasks of the last day", async () => {
  const userId = await account();
  const call = (name: string, args: unknown) => ({
    callId: randomUUID(),
    name,
    arguments: JSON.stringify(args),
  });
  // A routine's run: its instructions, a first draft, then the founder's change requests.
  const contentTask = async (owner: string, workType = "content") => {
    const { task, turn } = await createWorkTask(
      fixture.db,
      owner,
      "Daily quote",
      "Read the daily-quote skill with read_skill, then follow it.",
      "X",
    );
    await fixture.db.query("UPDATE tasks SET work_type=$2 WHERE id=$1", [task.id, workType]);
    await appendMessage(fixture.db, turn.id, "tool_call", call("create_artifact", {
      kind: "document",
      title: "Post",
      content: "Shipping beats planning. What do you think? 🚀",
    }));
    await createArtifact(fixture.db, task.id, turn.id, {
      kind: "document",
      title: "Post",
      content: "Shipping beats planning. What do you think? 🚀",
    });
    await appendMessage(fixture.db, turn.id, "assistant", { text: "Here is today's draft." });
    await completeTurn(fixture.db, turn.id);
    return task.id as string;
  };
  const feedback = async (taskId: string, text: string) => {
    const turn = await createTurn(fixture.db, userId, taskId, text);
    await appendMessage(fixture.db, turn.id, "tool_call", call("edit_document", {
      id: randomUUID(),
      edits: [{ find: " What do you think? 🚀", replace: "" }],
    }));
    await appendMessage(fixture.db, turn.id, "assistant", { text: "Done: no question, no emoji." });
    await completeTurn(fixture.db, turn.id);
    return turn.id as string;
  };
  const edited = await contentTask(userId);
  await feedback(edited, "don't end on a question, and drop the emoji");
  // Feedback older than the window, a task with no feedback, other work, another founder.
  const old = await contentTask(userId);
  const oldTurn = await feedback(old, "shorter");
  await fixture.db.query("UPDATE messages SET created_at=now()-interval '2 days' WHERE turn_id=$1", [oldTurn]);
  await contentTask(userId);
  await feedback(await contentTask(userId, "general"), "make it about pricing");
  const context = { userId, taskId: "unused", turnId: "unused" };
  const { tasks } = await run(context, "list_content_feedback", {});
  assert.deepEqual(tasks.map((task: any) => task.task_id), [edited]);
  const [task] = tasks;
  assert.equal(task.platform, "X");
  assert.deepEqual(task.first_drafts, ["Shipping beats planning. What do you think? 🚀"]);
  assert.equal(task.feedback.length, 1);
  assert.equal(task.feedback[0].founder, "don't end on a question, and drop the emoji");
  assert.deepEqual(task.feedback[0].changes, [[{ find: " What do you think? 🚀", replace: "" }]]);
  assert.equal(task.feedback[0].orca, "Done: no question, no emoji.");
  assert.equal(task.drafts_now[0].title, "Post");
  // A wider window reaches the older feedback, only from that day on.
  const week = (await run(context, "list_content_feedback", { hours: 72 })).tasks;
  assert.deepEqual(week.map((task: any) => task.task_id), [edited, old]);
  assert.deepEqual(
    await run({ ...context, userId: await account() }, "list_content_feedback", {}),
    { tasks: [], message: "The founder sent no messages in content tasks in the last 24 hours." },
  );
  await assert.rejects(run(context, "list_content_feedback", { hours: 169 }));
});

test("memory: save, grep, edit, read and delete Markdown files per founder", async () => {
  const founder = randomUUID();
  const other = randomUUID();
  // Memory lives in files; it never needs the founder's task.
  const memory = (name: string, args: unknown, userId = founder) =>
    run({ userId, taskId: randomUUID(), turnId: randomUUID() }, name, args);

  assert.deepEqual(await memory("search_memory", {}), {
    files: [],
    message: "Your memory is empty.",
  });
  await memory("save_memory", {
    path: "founder.md",
    content:
      "---\ndescription: Founder's rules for posts\n---\n# Founder\n\n- 2026-10-24: Never mention the company in posts.\n- 2026-10-24: No emojis.\n",
  });
  await memory("save_memory", {
    path: "x/strategy-peers.md",
    content:
      "---\ndescription: Peer founders on X for the weekly strategy report\n---\n# X peers\n\n- @alice — 12K followers, posts twice a day\n- @bob — 900 followers\n",
  });
  const listed = await memory("search_memory", {});
  assert.deepEqual(
    listed.files.map((file: { path: string }) => file.path),
    ["founder.md", "x/strategy-peers.md"],
  );
  assert.equal(
    await memoryIndex(founder),
    "- founder.md: Founder's rules for posts\n- x/strategy-peers.md: Peer founders on X for the weekly strategy report",
  );
  assert.equal(await memoryIndex(other), "");

  // Case-insensitive, with alternatives, like grep -i -E.
  assert.deepEqual((await memory("search_memory", { pattern: "EMOJI|followers" })).matches, [
    { path: "founder.md", line: 7, text: "- 2026-10-24: No emojis." },
    { path: "x/strategy-peers.md", line: 6, text: "- @alice — 12K followers, posts twice a day" },
    { path: "x/strategy-peers.md", line: 7, text: "- @bob — 900 followers" },
  ]);
  assert.equal(
    (await memory("search_memory", { pattern: "pasta" })).message,
    "No memory lines match.",
  );
  await assert.rejects(memory("search_memory", { pattern: "(" }), /not a valid regular expression/);

  // Editing part of a file keeps the rest.
  await memory("save_memory", {
    path: "founder.md",
    edits: [{ find: "No emojis.", replace: "Emojis are fine on X." }],
  });
  assert.match(
    (await memory("read_memory", { path: "founder.md" })).content,
    /Never mention the company[\s\S]*Emojis are fine on X\./,
  );
  await assert.rejects(
    memory("save_memory", { path: "founder.md", edits: [{ find: "not there", replace: "x" }] }),
    /is not in the current file; read_memory/,
  );
  await assert.rejects(memory("save_memory", { path: "founder.md" }), /Pass either edits or content/);

  // Paths stay inside the founder's own folder.
  for (const path of ["../other.md", "/etc/passwd.md", "Founder.md", "notes.txt", "a/b/c/d.md"])
    await assert.rejects(
      memory("save_memory", { path, content: "---\ndescription: x\n---\nx" }),
      /lowercase path/,
    );
  await assert.rejects(
    memory("save_memory", { path: "big.md", content: "x".repeat(20_001) }),
    /at most 20000/,
  );
  // Every file needs a description line and content after it.
  for (const content of ["Just notes", "---\ndescription:\n---\nNotes", "---\ndescription: Notes\n---\n  "])
    await assert.rejects(
      memory("save_memory", { path: "notes.md", content }),
      /Start the file with a description line/,
    );

  // Another founder sees none of it.
  assert.deepEqual((await memory("search_memory", { pattern: "peers" }, other)).matches, []);
  await assert.rejects(memory("read_memory", { path: "founder.md" }, other), /No memory file/);

  await memory("delete_memory", { path: "x/strategy-peers.md" });
  // The emptied x/ folder goes too.
  assert.deepEqual(await readdir(join(storage, "users", founder, "memory")), ["founder.md"]);
  await assert.rejects(memory("delete_memory", { path: "x/strategy-peers.md" }), /No memory file/);
});

test("request_user_input asks one valid question, from the founder's own chat only", async () => {
  const userId = await account();
  const chat = await createTask(fixture.db, userId, "onboarding", "Orca");
  const turn = await createTurn(fixture.db, userId, chat.id, "Hi");
  const context = { userId, taskId: chat.id, turnId: turn.id };
  const args = {
    questions: [{ question: "Which topics?", options: ["Growth", "Product"], multiple: true }],
  };
  assert.deepEqual(await run(context, "request_user_input", args), {
    status: "awaiting_user_input",
    ...args,
  });
  // Style choices carry the full sample post; plain and card options can mix.
  const styles = {
    questions: [
      {
        question: "Which sounds most like you?",
        options: [
          { label: "Blunt and opinionated", preview: "Most launch advice is wrong.\n\nShip it ugly." },
          "Calm teacher who explains",
        ],
      },
    ],
  };
  assert.deepEqual(await run(context, "request_user_input", styles), {
    status: "awaiting_user_input",
    ...styles,
  });
  for (const questions of [
    [],
    [{ question: "Pick", options: [{ label: "A" }, { label: "B", preview: "x" }] }],
    [{ question: "Pick", options: [{ label: "A", preview: "x".repeat(1501) }, "B"] }],
    [{ question: "Choose", options: [""] }],
    [{ question: "What are you building?", options: [] }],
    [
      { question: "How should X content be published?", options: ["Manually", "Browser"] },
      { question: "How should Instagram content be published?", options: ["Manually", "Browser"] },
    ],
  ])
    await assert.rejects(run(context, "request_user_input", { questions }));
  const work = await workContext(userId);
  await assert.rejects(run({ ...context, taskId: work.taskId }, "request_user_input", args), {
    status: 400,
    message: "Interactive questions are available from Agent chat only.",
  });
  await assert.rejects(
    run({ ...context, userId: await account() }, "request_user_input", args),
    { status: 404 },
  );
});

test("task tools start, read and follow up the founder's own background work", async () => {
  const userId = await account();
  const chat = await createTask(fixture.db, userId, "chat", "Orca");
  const context = { userId, taskId: chat.id, turnId: "unused" };
  const dispatched: string[][] = [];
  const dispatch: DispatchTask = (...args) => void dispatched.push(args);

  // Without a worker, nothing is created.
  await assert.rejects(
    run(context, "start_task", { title: "Work", instructions: "Draft a post" }),
    { status: 503 },
  );
  const started = await run(
    context,
    "start_task",
    { title: "Queued work", instructions: "Draft a post", platform: "X" },
    dispatch,
  );
  assert.equal(started.status, "queued");
  assert.deepEqual(dispatched, [[started.task_id, started.turn_id, userId]]);
  const detail = await run(context, "get_task", { task_id: started.task_id }, noDispatch);
  assert.equal(detail.id, started.task_id);
  assert.equal(detail.platform, "X");

  // A running task, a chat task, or someone else's task takes no follow-up.
  await assert.rejects(
    run(context, "follow_up_task", { task_id: started.task_id, message: "Busy" }, noDispatch),
    { status: 409 },
  );
  await assert.rejects(
    run(context, "follow_up_task", { task_id: chat.id, message: "Feedback" }, noDispatch),
    { status: 400, message: "Use an execution task ID." },
  );
  const foreign = await workContext(await account(), "Private work");
  for (const name of ["get_task", "follow_up_task"])
    await assert.rejects(
      run(
        context,
        name,
        { task_id: foreign.taskId, ...(name === "follow_up_task" ? { message: "Feedback" } : {}) },
        noDispatch,
      ),
      { status: 404 },
    );
  // Background work cannot start more work.
  await assert.rejects(
    run(
      { ...context, taskId: started.task_id },
      "start_task",
      { title: "Nested", instructions: "Draft" },
      noDispatch,
    ),
    { status: 400, message: "Task-management tools are available from Agent chat only." },
  );

  await fixture.db.query(
    "UPDATE turns SET status='completed',finished_at=now() WHERE task_id=$1",
    [started.task_id],
  );
  const followed = await run(
    context,
    "follow_up_task",
    { task_id: started.task_id, message: "Shorter, please" },
    dispatch,
  );
  assert.equal(followed.task_id, started.task_id);
  assert.deepEqual(dispatched.at(-1), [started.task_id, followed.turn_id, userId]);

  await fixture.db.query(
    "UPDATE turns SET status='completed',finished_at=now() WHERE task_id=$1",
    [started.task_id],
  );
  await reviewTask(fixture.db, userId, started.task_id, "archive");
  await assert.rejects(
    run(context, "follow_up_task", { task_id: started.task_id, message: "Archived" }, noDispatch),
    { status: 409 },
  );
});

test("create_reply delivers one validated reply card", async () => {
  const context = await workContext(await account());
  const target = {
    url: "https://x.com/maya/status/2115224722745307543",
    author: "Maya Chen",
    handle: "@maya",
    text: "Looking to connect with people building AI agents.",
    posted_at: "2026-10-28T06:30:00Z",
    stats: { replies: 22, likes: 10, views: 427, author_followers: 830 },
  };
  const card = await run(context, "create_reply", {
    platform: "X",
    intent: "connect",
    target,
    text: "Followed! Agents for real work is the fun part.",
    why: "Builds agent tooling for small teams.",
  });
  assert.equal(card.kind, "reply");
  assert.equal(card.title, "Connect with @maya");
  assert.deepEqual(JSON.parse(card.content), {
    platform: "X",
    kind: "reply",
    intent: "connect",
    target,
    text: "Followed! Agents for real work is the fun part.",
    why: "Builds agent tooling for small teams.",
  });
  for (const bad of [
    { platform: "X", intent: "connect", target: { ...target, url: "javascript:alert(1)" }, text: "Hi" },
    { platform: "Myspace", intent: "connect", target, text: "Hi" },
    { platform: "X", intent: "connect", target, text: "  " },
    { platform: "X", intent: "connect", target, text: "Hi", note: "extra" },
  ])
    await assert.rejects(run(context, "create_reply", bad));
});
