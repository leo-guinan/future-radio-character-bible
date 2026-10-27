// Load a character from their bible and talk with them locally.
// With ANTHROPIC_API_KEY set, the character speaks through the model; without it,
// they answer from the bible itself (canon, voice, record) so you can still explore.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { build, render } from "./bible.js";

const MODEL = process.env.CHARACTER_MODEL ?? "claude-sonnet-5-5";

/** Load the character: their system prompt and bible model, rebuilding if stale. */
export function loadCharacter(dir, { rebuild = true } = {}) {
  if (rebuild) build(dir);
  const { model, files } = render(dir);
  const prompt = existsSync(join(dir, "bible/system-prompt.md")) ? readFileSync(join(dir, "bible/system-prompt.md"), "utf8") : files["bible/system-prompt.md"];
  return { model, prompt };
}

/** One turn. `history` is [{role, content}] including the new user turn. */
export async function reply(character, history, { apiKey = process.env.ANTHROPIC_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) return offlineReply(character, history.at(-1).content);
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, system: character.prompt, messages: history }),
  });
  if (!res.ok) throw new Error(`Model call failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

export function offlineReply(character, question) {
  const m = character.model;
  const q = words(question);
  const pool = [
    ...m.canon.notes.map((t) => ({ t, kind: "canon" })),
    ...m.canon.viewerNotes.map((v) => ({ t: v.note, kind: `a viewer (${v.from})` })),
    ...m.voice.samples.map((v) => ({ t: v.line, kind: "said before" })),
    { t: m.identity.intro, kind: "who I am" },
    { t: m.identity.job, kind: "my job" },
    { t: m.identity.conflict, kind: "my trouble" },
  ].filter((x) => x.t);
  const scored = pool.map((x) => ({ ...x, s: [...words(x.t)].filter((w) => q.has(w)).length })).sort((a, b) => b.s - a.s);
  const hits = scored.filter((x) => x.s > 0).slice(0, 2);
  const picked = hits.length ? hits : scored.slice(0, 1);
  return `(${m.name}, offline — answering from the bible) ${picked.map((x) => `${x.t.replace(/\s+/g, " ").trim()} [${x.kind}]`).join(" · ")}`;
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "note";

/** Write a viewer note, ready to commit and open as a pull request. */
export function propose(dir, { note, from = "anonymous", experience = "a local conversation", episode = "", transcript = [] }) {
  const day = new Date().toISOString().slice(0, 10);
  const rel = `memory/viewer-notes/${day}-${slugify(note)}.md`;
  const excerpt = transcript.slice(-6).map((t) => `> **${t.role === "user" ? "Viewer" : "Character"}:** ${t.content.replace(/\n/g, " ")}`).join("\n>\n");
  const body = `---\nfrom: ${JSON.stringify(from)}\nexperience: ${JSON.stringify(experience)}\n${episode ? `episode: ${episode}\n` : ""}---\n${note.trim()}\n${excerpt ? `\n## From the conversation\n\n${excerpt}\n` : ""}`;
  mkdirSync(join(dir, "memory/viewer-notes"), { recursive: true });
  writeFileSync(join(dir, rel), body);
  return rel;
}

export async function repl(dir, { from } = {}) {
  const character = loadCharacter(dir);
  const name = character.model.name;
  const rl = createInterface({ input: process.stdin, terminal: process.stdin.isTTY ?? false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => {
    process.stdout.write(q);
    const r = await lines.next();
    if (!process.stdin.isTTY && !r.done) process.stdout.write(`${r.value}\n`);
    return r.done ? null : r.value;
  };
  const history = [];
  console.log(`\n${name} is here.${process.env.ANTHROPIC_API_KEY ? "" : " (offline: set ANTHROPIC_API_KEY to hear them speak)"}\nType to talk. /propose <note> to suggest a change · /bible to read it · /quit\n`);
  for (;;) {
    const raw = await ask("you › ");
    if (raw === null) break;
    const line = raw.trim();
    if (!line) continue;
    if (line === "/quit" || line === "/exit") break;
    if (line === "/bible") {
      console.log(readFileSync(join(dir, "bible/BIBLE.md"), "utf8"));
      continue;
    }
    if (line.startsWith("/propose")) {
      const note = line.slice("/propose".length).trim();
      if (!note) { console.log("Usage: /propose <what should be true about them>"); continue; }
      const who = from ?? ((await ask("credit as (name/handle/anonymous) › "))?.trim() || "anonymous");
      const rel = propose(dir, { note, from: who, transcript: history });
      console.log(`\nWrote ${rel}. To send it:\n  git checkout -b viewer-note && git add ${rel} && git commit -m "Viewer note: ${note.slice(0, 50)}"\n  git push -u origin viewer-note   # then open a pull request\n`);
      continue;
    }
    history.push({ role: "user", content: line });
    try {
      const text = await reply(character, history);
      history.push({ role: "assistant", content: text });
      console.log(`\n${name.toLowerCase()} › ${text}\n`);
    } catch (e) {
      history.pop();
      console.log(`\n(the line crackled: ${e.message})\n`);
    }
  }
  rl.close();
}
