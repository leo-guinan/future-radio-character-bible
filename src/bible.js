// Read a dressing room and render its character bible.
//
// A dressing room looks like:
//   CHARACTER.md               who the character is (persona, job, constraints)
//   SHOW_BIBLE.md              the shared world (optional, copied in by the room)
//   memory/notes.md            durable notes, one "- " line each
//   memory/viewer-notes/*.md   notes viewers proposed and the producer merged
//   voice/voice.json           production voice settings
//   history.jsonl              one line per run in the writers' room
//   history/YYYY-MM-DD/*.md    one file per run, with frontmatter
//
// The bible is written to bible/: BIBLE.md (to read), system-prompt.md (to load the
// character into any model), bible.json (structured). Output depends only on the inputs,
// so a stale bible is detectable: `check` rebuilds and compares.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const BIBLE_VERSION = 1;
/** Where this tool lives; used in the instructions written into every bible. */
export const PACKAGE = "github:leo-guinan/future-radio-character-bible";
const CAST = ["Borges", "Leonardo", "Agnolo", "Yuria", "Showrunner", "Patron"];

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const read = (dir, rel) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : null);

/** Parse a small YAML-ish frontmatter block (key: value per line). */
export function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: md };
  const data = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (/^".*"$/.test(v)) {
      try { v = JSON.parse(v); } catch { /* keep raw */ }
    }
    data[line.slice(0, i).trim()] = v;
  }
  return { data, body: md.slice(m[0].length) };
}

/** The folder's path inside its git repo ("" at the root, "extras/yuria/" in a shared repo), or null outside git. */
export function repoPrefix(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-prefix"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The shared show bible: in the folder itself, or at the top of the repo that holds it. */
function showBibleFor(dir) {
  const own = read(dir, "SHOW_BIBLE.md");
  if (own !== null) return own;
  try {
    const top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return read(top, "SHOW_BIBLE.md");
  } catch {
    return null;
  }
}

function gitLog(dir, paths) {
  if (repoPrefix(dir) === null) return [];
  try {
    const out = execFileSync("git", ["-C", dir, "log", "--format=%cs%x09%an%x09%s", "--", ...paths], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out ? out.split("\n").map((l) => { const [date, author, subject] = l.split("\t"); return { date, author, subject }; }) : [];
  } catch {
    return [];
  }
}

/** Load everything the bible is built from. */
export function load(dir) {
  const character = read(dir, "CHARACTER.md");
  if (character === null) throw new Error(`${dir} has no CHARACTER.md — is this a dressing room?`);
  let voiceRaw = null;
  try { voiceRaw = JSON.parse(read(dir, "voice/voice.json") ?? "null"); } catch { voiceRaw = null; }
  const fromDir = basename(resolve(dir)).replace(/^(future-radio-)?dressing-room-/, "");
  const slug = String(voiceRaw?.character ?? (fromDir !== basename(resolve(dir)) ? fromDir : character.match(/^#\s+([^\s—–-]+)/m)?.[1] ?? "character")).toLowerCase();
  // "# The Unspoken Orchestra — Extra" names the character; otherwise the slug does.
  const heading = character.match(/^#\s+(.+?)\s+[—–]\s+/m)?.[1]?.trim();
  const name = heading ?? slug[0].toUpperCase() + slug.slice(1);
  const notes = (read(dir, "memory/notes.md") ?? "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  const viewerDir = join(dir, "memory/viewer-notes");
  const viewerNotes = existsSync(viewerDir)
    ? readdirSync(viewerDir).filter((f) => f.endsWith(".md")).sort().map((f) => {
        const { data, body } = frontmatter(readFileSync(join(viewerDir, f), "utf8"));
        return { file: `memory/viewer-notes/${f}`, from: data.from ?? "a viewer", experience: data.experience ?? "", episode: data.episode ?? "", note: body.trim() };
      })
    : [];
  const voice = voiceRaw;
  const runs = (read(dir, "history.jsonl") ?? "").split("\n").filter(Boolean).map((l) => {
    const entry = JSON.parse(l);
    const file = read(dir, entry.file);
    const meta = file ? frontmatter(file).data : {};
    return { ...entry, model: meta.model ?? "unknown", flagged: !!meta.flags };
  });
  const changelog = gitLog(dir, ["CHARACTER.md", "memory", "voice"]);
  return { dir, name, slug, character, showBible: showBibleFor(dir), notes, viewerNotes, voice, runs, changelog };
}

/** Sections of CHARACTER.md by "## " heading. */
function sections(md) {
  const out = { intro: "", parts: {} };
  const chunks = md.replace(/^# .*\n+/, "").split(/^## /m);
  out.intro = chunks.shift().trim();
  for (const c of chunks) {
    const [head, ...rest] = c.split("\n");
    out.parts[head.trim().toLowerCase()] = rest.join("\n").trim();
  }
  return out;
}

const firstSentences = (t, n = 2) => (t ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).slice(0, n).join(" ");

/** Summarize the record: what the character has done, from history. */
const isAppearance = (r) => r.model === "released";

function record(allRuns) {
  const runs = allRuns.filter((r) => !isAppearance(r));
  const appearances = allRuns.filter(isAppearance).map((r) => ({ id: r.runId, episode: r.episodeId ?? null, at: r.at?.slice(0, 10) ?? null, file: r.file }));
  const ideas = new Map();
  const episodes = new Map();
  const askers = new Set();
  for (const r of runs) {
    if (r.ideaId) ideas.set(r.ideaId, (ideas.get(r.ideaId) ?? 0) + 1);
    if (r.episodeId) episodes.set(r.episodeId, (episodes.get(r.episodeId) ?? 0) + 1);
    if (String(r.askedBy).startsWith("patron:")) askers.add(r.askedBy);
  }
  return {
    runs: runs.length,
    firstSeen: runs[0]?.at?.slice(0, 10) ?? null,
    lastSeen: runs.at(-1)?.at?.slice(0, 10) ?? null,
    ideas: [...ideas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, n]) => ({ id, runs: n })),
    episodes: [...episodes.entries()].sort().map(([id, n]) => ({ id, runs: n })),
    patronsServed: askers.size,
    appearances,
  };
}

/** Lines the character has actually spoken with a model behind them (not offline fallbacks). */
function voiceSamples(runs, k = 8) {
  const spoken = runs.filter((r) => r.model !== "offline" && r.model !== "unknown" && !r.flagged && r.text);
  // Released lines are the strongest evidence of a voice: always keep them, then the latest model runs.
  const released = spoken.filter(isAppearance);
  const rest = spoken.filter((r) => !isAppearance(r)).slice(-(Math.max(0, k - released.length)));
  return [...released, ...rest].map((r) => ({
    line: firstSentences(r.text, 2),
    source: r.file,
    idea: r.ideaId ?? null,
    episode: isAppearance(r) ? r.episodeId ?? null : null,
    at: r.at?.slice(0, 10) ?? null,
  }));
}

function relationships(src, self) {
  return CAST.filter((n) => n.toLowerCase() !== self.toLowerCase())
    .map((n) => ({ name: n, mentions: (src.match(new RegExp(`\\b${n}\\b`, "g")) ?? []).length }))
    .filter((r) => r.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}

/** Build the bible model (pure: depends only on what `load` returned). */
export function model(input) {
  const s = sections(input.character);
  const allText = input.character + "\n" + input.runs.map((r) => r.text).join("\n");
  const inputs = {
    "CHARACTER.md": sha256(input.character),
    "SHOW_BIBLE.md": input.showBible ? sha256(input.showBible) : null,
    "memory/notes.md": sha256(input.notes.join("\n")),
    "memory/viewer-notes": sha256(JSON.stringify(input.viewerNotes)),
    "voice/voice.json": sha256(JSON.stringify(input.voice)),
    "history.jsonl": sha256(JSON.stringify(input.runs.map((r) => [r.runId, r.eventHash]))),
    changelog: sha256(JSON.stringify(input.changelog)),
  };
  return {
    bibleVersion: BIBLE_VERSION,
    character: input.slug,
    name: input.name,
    inputsHash: sha256(JSON.stringify(inputs)),
    inputs,
    identity: { intro: s.intro, job: s.parts["job"] ?? "", constraints: s.parts["hard constraints"] ?? "", conflict: s.parts["recurring conflict"] ?? "", other: Object.fromEntries(Object.entries(s.parts).filter(([k]) => !["job", "hard constraints", "recurring conflict"].includes(k))) },
    canon: { notes: input.notes, viewerNotes: input.viewerNotes },
    voice: { settings: input.voice, samples: voiceSamples(input.runs) },
    record: record(input.runs),
    relationships: relationships(allText, input.name),
    changelog: input.changelog.slice(0, 30),
  };
}

export function renderBible(m) {
  const id = m.identity;
  const lines = [
    `<!-- generated by future-radio-character-bible v${BIBLE_VERSION} · inputs ${m.inputsHash.slice(0, 12)} · do not edit; change the sources and rebuild -->`,
    `# ${m.name} — character bible`,
    "",
    id.intro,
    "",
    ...(id.job ? ["## Job", "", id.job, ""] : []),
    ...(id.constraints ? ["## Hard constraints", "", id.constraints, ""] : []),
    ...(id.conflict ? ["## Recurring conflict", "", id.conflict, ""] : []),
  ];
  for (const [k, v] of Object.entries(id.other)) lines.push(`## ${k[0].toUpperCase()}${k.slice(1)}`, "", v, "");
  lines.push("## Canon they carry", "");
  if (!m.canon.notes.length && !m.canon.viewerNotes.length) lines.push("_Nothing beyond the persona yet._", "");
  for (const n of m.canon.notes) lines.push(`- ${n}`);
  for (const v of m.canon.viewerNotes) lines.push(`- ${v.note.split("\n")[0]} — _from ${v.from}${v.episode ? `, after ${v.episode}` : ""}_ (\`${v.file}\`)`);
  lines.push("", "## How they've sounded", "");
  if (!m.voice.samples.length) lines.push("_No recorded lines yet — so far the character has only run offline._");
  for (const v of m.voice.samples) lines.push(`> ${v.line}`, `> — ${v.episode ? `${v.episode}, as released` : v.at}${v.idea ? `, on ${v.idea}` : ""} (\`${v.source}\`)`, "");
  if (m.voice.settings?.voice) lines.push("", `Production voice: ${m.voice.settings.provider ?? "?"} · ${m.voice.settings.voice}`);
  const r = m.record;
  lines.push(
    "",
    "## The record",
    "",
    `- Released appearances: ${r.appearances.length ? r.appearances.map((a) => `**${a.episode}** (\`${a.file}\`)`).join(", ") : "none yet"}`,
    `- Runs in the writers' room: **${r.runs}**${r.firstSeen ? ` (${r.firstSeen} → ${r.lastSeen})` : ""}`,
    `- Episodes: ${r.episodes.map((e) => `${e.id} (${e.runs})`).join(", ") || "none yet"}`,
    `- Ideas worked on: ${r.ideas.slice(0, 12).map((i) => `${i.id} (${i.runs})`).join(", ") || "none yet"}${r.ideas.length > 12 ? ` and ${r.ideas.length - 12} more` : ""}`,
    `- Patrons who asked them something: ${r.patronsServed}`,
    "",
    "## Relationships",
    "",
    m.relationships.length ? m.relationships.map((x) => `- ${x.name} — mentioned ${x.mentions}×`).join("\n") : "_None on record yet._",
    "",
    "## How this character changed",
    "",
    m.changelog.length ? m.changelog.map((c) => `- ${c.date} — ${c.subject} _(${c.author})_`).join("\n") : "_No changes recorded._",
    "",
    "---",
    "",
    `Talk to this character locally: \`npx ${PACKAGE} chat .\``,
    "Something about them doesn't ring true after an episode? Open a pull request — see CONTRIBUTING.md.",
    "",
  );
  return lines.join("\n");
}

export function renderSystemPrompt(m, showBible) {
  const id = m.identity;
  return [
    `You are ${m.name}, a character in Future Radio.`,
    "",
    showBible ? `# The world\n\n${showBible.trim()}\n` : "",
    `# Who you are\n\n${id.intro}\n`,
    id.job ? `## Your job\n\n${id.job}\n` : "",
    id.constraints ? `## Your constraints\n\n${id.constraints}\n` : "",
    id.conflict ? `## Your recurring conflict\n\n${id.conflict}\n` : "",
    m.canon.notes.length || m.canon.viewerNotes.length
      ? `## Canon — what is true about you\n\n${[...m.canon.notes.map((n) => `- ${n}`), ...m.canon.viewerNotes.map((v) => `- ${v.note.split("\n")[0]}`)].join("\n")}\n`
      : "",
    m.voice.samples.length ? `## How you have sounded\n\n${m.voice.samples.map((v) => `- "${v.line}"`).join("\n")}\n` : "",
    `## What you have done\n\n${m.record.appearances.length ? `You have appeared in ${m.record.appearances.map((a) => a.episode).join(", ")}. ` : ""}You have worked ${m.record.runs} time(s) in the writers' room${m.record.ideas.length ? `, on ideas ${m.record.ideas.slice(0, 8).map((i) => i.id).join(", ")}` : ""}.\n`,
    `## This conversation\n\nYou are talking with a viewer outside the writers' room. Stay in character. The canon above is what is true; anything not in it hasn't happened yet — say so rather than inventing history. Nothing said here becomes canon unless the viewer proposes it as a pull request to your dressing room and the producer merges it. Keep replies short enough to be spoken aloud.`,
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Render all bible files for a dressing room. */
export function render(dir) {
  const input = load(dir);
  const m = model(input);
  return {
    model: m,
    files: {
      "bible/BIBLE.md": renderBible(m),
      "bible/system-prompt.md": renderSystemPrompt(m, input.showBible),
      "bible/bible.json": JSON.stringify(m, null, 2) + "\n",
    },
  };
}

/** Write the bible into the dressing room. Returns which files changed. */
export function build(dir) {
  const { model: m, files } = render(dir);
  mkdirSync(join(dir, "bible"), { recursive: true });
  const changed = [];
  for (const [rel, content] of Object.entries(files)) {
    if (read(dir, rel) !== content) {
      writeFileSync(join(dir, rel), content);
      changed.push(rel);
    }
  }
  return { model: m, changed };
}

/** Is the committed bible what the current sources would produce? */
export function stale(dir) {
  const { files } = render(dir);
  return Object.entries(files).filter(([rel, content]) => read(dir, rel) !== content).map(([rel]) => rel);
}
