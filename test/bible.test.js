import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, check, initGithub, load, loadCharacter, offlineReply, propose, reply, stale } from "../src/index.js";

const env = { ...process.env, GIT_AUTHOR_NAME: "Room", GIT_AUTHOR_EMAIL: "r@x", GIT_COMMITTER_NAME: "Room", GIT_COMMITTER_EMAIL: "r@x" };
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const w = (dir, rel, s) => (mkdirSync(join(dir, rel, ".."), { recursive: true }), writeFileSync(join(dir, rel), s));

function dressingRoom() {
  const dir = join(mkdtempSync(join(tmpdir(), "bible-")), "dressing-room-borges");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  w(dir, "CHARACTER.md", "# Borges — Remember\n\nThe room's librarian.\n\n## Job\n\nRetrieve what the room knows.\n\n## Hard constraints\n\n- Cite every claim.\n\n## Recurring conflict\n\nHe remembers too many possibilities. Leonardo teases him for it.\n");
  w(dir, "SHOW_BIBLE.md", "# Future Radio\n\nAn audio-first musical radio drama.\n");
  w(dir, "memory/notes.md", "# Borges's notes\n\n- 2026-10-27 — Prefers the deferred branches _(source: leo)_\n");
  w(dir, "voice/voice.json", JSON.stringify({ character: "borges", provider: "elevenlabs", voice: "Borges — Infinite Overture" }));
  const runs = [
    { runId: "R-B1", at: "2026-10-27T22:00:00Z", ideaId: "I-0008", episodeId: "E02", askedBy: "patron:Ada", eventId: "ev_000070", eventHash: "aa", file: "history/2026-10-27/R-B1.md", text: "The library keeps a volume on Dennis. It was opened in the pitch deck and never closed [ev_000027]." },
    { runId: "R-B2", at: "2026-10-27T22:05:00Z", ideaId: "I-0009", askedBy: "showrunner", eventId: "ev_000080", eventHash: "bb", file: "history/2026-10-27/R-B2.md", text: "The library offers 3 volumes on this." },
  ];
  w(dir, runs[0].file, "---\nrun: R-B1\nmodel: claude-sonnet-5-5\n---\n\n" + runs[0].text);
  w(dir, runs[1].file, "---\nrun: R-B2\nmodel: offline\n---\n\n" + runs[1].text);
  w(dir, "history.jsonl", runs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "Open Borges's dressing room");
  return dir;
}

test("builds a deterministic bible from the dressing room", () => {
  const dir = dressingRoom();
  const first = build(dir);
  assert.deepEqual(first.changed.sort(), ["bible/BIBLE.md", "bible/bible.json", "bible/system-prompt.md"]);
  assert.deepEqual(build(dir).changed, []); // same inputs → same bible
  const bible = readFileSync(join(dir, "bible/BIBLE.md"), "utf8");
  assert.match(bible, /# Borges — character bible/);
  assert.match(bible, /Prefers the deferred branches/);
  assert.match(bible, /volume on Dennis/); // model-voiced line is a voice sample
  assert.doesNotMatch(bible, /offers 3 volumes/); // offline fallback is not
  assert.match(bible, /Leonardo — mentioned/);
  const prompt = readFileSync(join(dir, "bible/system-prompt.md"), "utf8");
  assert.match(prompt, /You are Borges/);
  assert.match(prompt, /An audio-first musical radio drama/);
  assert.match(prompt, /pull request/);
});

test("the bible goes stale when its sources change", () => {
  const dir = dressingRoom();
  build(dir);
  appendFileSync(join(dir, "memory/notes.md"), "- 2026-10-28 — New note _(source: leo)_\n");
  assert.deepEqual(stale(dir).sort(), ["bible/BIBLE.md", "bible/bible.json", "bible/system-prompt.md"]);
});

function branch(dir, name, change) {
  build(dir);
  initGithub(dir, { pkg: "github:test/future-radio-character-bible" });
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "bible + scaffolding");
  git(dir, "branch", "base");
  git(dir, "checkout", "-q", "-b", name);
  change();
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", name);
  return check(dir, { base: "base" });
}

test("a viewer note PR passes", () => {
  const dir = dressingRoom();
  const r = branch(dir, "viewer-note", () => propose(dir, { note: "Borges hums when he finds the right volume.", from: "Ada", experience: "E02 first cut", episode: "E02" }));
  assert.equal(r.ok, true, r.problems.join("\n"));
  assert.ok(r.notes.some((n) => n.includes("viewer note from Ada")));
});

test("a PR that edits history is rejected", () => {
  const dir = dressingRoom();
  const r = branch(dir, "rewrite", () => w(dir, "history/2026-10-27/R-B1.md", "---\nrun: R-B1\n---\nI never said that."));
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("writers' room's record")));
});

test("notes are append-only, viewer notes need provenance, and a hand-edited bible is caught", () => {
  const dir = dressingRoom();
  const r = branch(dir, "messy", () => {
    w(dir, "memory/notes.md", "# Borges's notes\n\n- He is actually cheerful\n");
    w(dir, "memory/viewer-notes/2026-10-28-x.md", "---\nfrom: Bea\n---\nSomething.");
    appendFileSync(join(dir, "bible/BIBLE.md"), "\nBorges is my favourite.\n");
  });
  assert.equal(r.ok, false);
  const all = r.problems.join("\n");
  assert.match(all, /append-only/);
  assert.match(all, /experience:/);
  assert.match(all, /out of date/);
});

test("a CHARACTER.md proposal passes and is flagged for close review", () => {
  const dir = dressingRoom();
  const r = branch(dir, "persona", () => appendFileSync(join(dir, "CHARACTER.md"), "\n## Habits\n\nHe hums.\n"));
  assert.equal(r.ok, true, r.problems.join("\n"));
  assert.ok(r.notes.some((n) => n.includes("reviews this one closely")));
});

test("the character loads locally and answers offline from the bible", async () => {
  const dir = dressingRoom();
  const c = loadCharacter(dir);
  const t = await reply(c, [{ role: "user", content: "What do you know about Dennis?" }], { apiKey: "" });
  assert.match(t, /Dennis/);
  assert.match(offlineReply(c, "what is your job"), /Retrieve/);
});

test("with a key, the character speaks through the model with its system prompt", async () => {
  const dir = dressingRoom();
  const c = loadCharacter(dir);
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "The library is open." }] }) };
  };
  const t = await reply(c, [{ role: "user", content: "Hello" }], { apiKey: "k", fetchImpl });
  assert.equal(t, "The library is open.");
  assert.match(sent.system, /You are Borges/);
});

test("released appearances are the voice of record and are counted apart from runs", () => {
  const dir = dressingRoom();
  const entry = { runId: "E01-v1", at: "2026-10-27T15:34:38Z", episodeId: "E01", askedBy: "released", eventId: "ev_000090", eventHash: "cc", file: "history/appearances/E01-v1.md", text: "I have nothing but time. An unfortunate reader. In a library." };
  w(dir, entry.file, "---\nrun: E01-v1\nmodel: released\n---\n\n- I have nothing but time.\n");
  appendFileSync(join(dir, "history.jsonl"), JSON.stringify(entry) + "\n");
  const { model } = build(dir);
  assert.equal(model.record.runs, 2);
  assert.deepEqual(model.record.appearances.map((a) => a.episode), ["E01"]);
  assert.equal(model.voice.samples[0].line, "I have nothing but time. An unfortunate reader.");
  assert.equal(model.voice.samples[0].episode, "E01");
  const bible = readFileSync(join(dir, "bible/BIBLE.md"), "utf8");
  assert.match(bible, /Released appearances: \*\*E01\*\*/);
  assert.match(bible, /E01, as released/);
  assert.match(readFileSync(join(dir, "bible/system-prompt.md"), "utf8"), /You have appeared in E01/);
});

test("a character folder inside a shared repo builds and checks on its own", () => {
  const root = join(mkdtempSync(join(tmpdir(), "extras-")), "future-radio-extras");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  w(root, "SHOW_BIBLE.md", "# Future Radio\n\nAn audio-first musical radio drama.\n");
  for (const [slug, heading] of [["yuria", "Yuria"], ["the-cat", "The cat"]]) {
    const d = join(root, "extras", slug);
    w(d, "CHARACTER.md", `# ${heading} — Extra\n\nNo set story yet.\n\n## What we know\n\n- Something.\n\n## What we don't know yet\n\n- Everything else.\n`);
    w(d, "voice/voice.json", JSON.stringify({ character: slug }));
    w(d, "memory/notes.md", "# notes\n\n");
    w(d, "history.jsonl", "");
  }
  const yuria = join(root, "extras", "yuria");
  const { model } = build(yuria);
  build(join(root, "extras", "the-cat"));
  assert.equal(model.name, "Yuria");
  assert.equal(load(join(root, "extras", "the-cat")).name, "The cat");
  const bible = readFileSync(join(yuria, "bible/BIBLE.md"), "utf8");
  assert.doesNotMatch(bible, /## Job/); // extras have no job section to leave empty
  assert.match(bible, /## What we don't know yet/);
  assert.match(readFileSync(join(yuria, "bible/system-prompt.md"), "utf8"), /An audio-first musical radio drama/); // show bible from the repo top
  git(root, "add", "-A");
  git(root, "commit", "-qm", "extras");
  git(root, "branch", "base");
  git(root, "checkout", "-q", "-b", "pr");
  w(join(root, "extras", "the-cat"), "history.jsonl", "tampered\n"); // someone else's history
  propose(yuria, { note: "She hums the station ident.", from: "Ada", experience: "E10" });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "pr");
  const r = check(yuria, { base: "base" });
  assert.equal(r.ok, true, r.problems.join("\n")); // Yuria's folder only sees her own change
  assert.ok(r.changed.every((c) => !c.path.startsWith("extras/")));
  assert.equal(check(join(root, "extras", "the-cat"), { base: "base" }).ok, false);
});
