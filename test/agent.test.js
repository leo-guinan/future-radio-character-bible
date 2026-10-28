import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, elevenLabsBody, publishAgent, renderAgent, stale } from "../src/index.js";

const env = { ...process.env, GIT_AUTHOR_NAME: "Room", GIT_AUTHOR_EMAIL: "r@x", GIT_COMMITTER_NAME: "Room", GIT_COMMITTER_EMAIL: "r@x" };
const w = (dir, rel, s) => (mkdirSync(join(dir, rel, ".."), { recursive: true }), writeFileSync(join(dir, rel), s));

function room({ voice = { character: "agnolo", provider: "elevenlabs", name: "Old Italian Man", id: "voice123" }, agent } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "agent-")), "dressing-room-agnolo");
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"], { env });
  execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://github.com/leo-guinan/future-radio-dressing-room-agnolo.git"], { env });
  w(dir, "CHARACTER.md", "# Agnolo — Accounting\n\nThe bookkeeper.\n\n## Job\n\nKeep the score.\n\n## Recurring conflict\n\nHe wants receipts.\n");
  w(dir, "SHOW_BIBLE.md", "# Future Radio\n\nA radio drama.\n");
  w(dir, "memory/notes.md", "- The first transmission cost $4.83 of credits\n");
  w(dir, "voice/voice.json", JSON.stringify(voice));
  if (agent) w(dir, "voice/agent.json", JSON.stringify(agent));
  w(dir, "history.jsonl", "");
  return dir;
}

test("a bible becomes a voice agent with a spoken prompt and the production voice", () => {
  const a = renderAgent(room({ agent: { firstMessage: "Ledger's open. Speak." } }));
  assert.equal(a.name, "Agnolo — Future Radio");
  assert.equal(a.voiceId, "voice123");
  assert.equal(a.firstMessage, "Ledger's open. Speak.");
  assert.equal(a.llm, "claude-sonnet-5-5");
  assert.match(a.prompt, /You are Agnolo, a character in Future Radio\./);
  assert.match(a.prompt, /\$4\.83 of credits/); // canon rides along
  assert.match(a.prompt, /live voice call/);
  assert.match(a.prompt, /No lists, headings, markdown/);
  assert.match(a.prompt, /github\.com\/leo-guinan\/future-radio-dressing-room-agnolo/);
  assert.doesNotMatch(a.prompt, /Keep replies short enough to be spoken aloud\.$/m); // the text-chat section is replaced
  const body = elevenLabsBody(a);
  assert.equal(body.conversation_config.tts.voice_id, "voice123");
  assert.equal(body.conversation_config.agent.prompt.llm, "claude-sonnet-5-5");
});

test("a character without an ElevenLabs voice can't become an ElevenLabs agent", () => {
  const a = renderAgent(room({ voice: { character: "agnolo", provider: null, voice: null } }));
  assert.equal(a.voiceId, null);
  assert.throws(() => elevenLabsBody(a), /no ElevenLabs voice/);
});

test("publishing creates once, remembers the id, then updates", async () => {
  const dir = room();
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: JSON.parse(opts.body), key: opts.headers["xi-api-key"] });
    return { ok: true, json: async () => ({ agent_id: "agent_abc" }), text: async () => "" };
  };
  const first = await publishAgent(dir, { apiKey: "k", fetchImpl });
  assert.deepEqual(first, { agentId: "agent_abc", created: true });
  assert.equal(JSON.parse(readFileSync(join(dir, "voice/agent.json"), "utf8")).elevenlabs.agentId, "agent_abc");
  const second = await publishAgent(dir, { apiKey: "k", fetchImpl });
  assert.deepEqual(second, { agentId: "agent_abc", created: false });
  assert.deepEqual(calls.map((c) => [c.method, c.url.split("/agents")[1]]), [["POST", "/create"], ["PATCH", "/agent_abc"]]);
  assert.equal(calls[0].key, "k");
  // The bible links to the agent, and knows it's stale until rebuilt.
  assert.ok(stale(dir).length);
  build(dir);
  assert.match(readFileSync(join(dir, "bible/BIBLE.md"), "utf8"), /talk-to\?agent_id=agent_abc/);
});

test("publishing needs a key", async () => {
  await assert.rejects(() => publishAgent(room(), { apiKey: "" }), /ELEVENLABS_API_KEY/);
});
