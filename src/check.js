// Rules for changes to a dressing room. Run in CI on every pull request.
//
//   history/ and history.jsonl   written only by the writers' room — never edited in a PR
//   memory/notes.md              append-only: a PR may add notes, not remove or rewrite them
//   memory/viewer-notes/*.md     new viewer notes need `from:` and `experience:` frontmatter
//   bible/                       generated: if a PR touches it, it must match a fresh build
//   CHARACTER.md, voice/         open to proposals; the producer reviews them

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { frontmatter, repoPrefix, stale } from "./bible.js";

const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export const PROTECTED = [/^history\//, /^history\.jsonl$/];

/**
 * @param {string} dir dressing room
 * @param {{ base?: string }} opts compare against this ref (e.g. origin/main) to check a PR
 * @returns {{ ok: boolean, problems: string[], notes: string[], changed: Array<{status: string, path: string}> }}
 */
export function check(dir, opts = {}) {
  const problems = [];
  const notes = [];
  let changed = [];

  if (opts.base) {
    const mergeBase = git(dir, ["merge-base", opts.base, "HEAD"]);
    // In a shared repo (extras/yuria/), only this folder's changes count, relative to it.
    const prefix = repoPrefix(dir) ?? "";
    changed = git(dir, ["diff", "--name-status", "--no-renames", `${mergeBase}`, "HEAD", "--", "."])
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [status, path] = l.split("\t");
        return { status, path: path.startsWith(prefix) ? path.slice(prefix.length) : path };
      });

    for (const c of changed) {
      if (PROTECTED.some((re) => re.test(c.path)))
        problems.push(`${c.path} is the writers' room's record and can't be changed in a pull request. Propose a viewer note instead.`);
    }

    if (changed.some((c) => c.path === "memory/notes.md")) {
      const diff = git(dir, ["diff", "--unified=0", mergeBase, "HEAD", "--", "memory/notes.md"]); // pathspec is relative to dir
      const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---") && l.slice(1).trim());
      if (removed.length) problems.push(`memory/notes.md is append-only; this PR removes or rewrites ${removed.length} line(s). Add a new note that responds to the old one instead.`);
      else notes.push("memory/notes.md: additions only ✓");
    }

    for (const c of changed.filter((c) => /^memory\/viewer-notes\/.+\.md$/.test(c.path))) {
      if (c.status !== "A") {
        problems.push(`${c.path}: viewer notes are added, not edited or deleted, once merged.`);
        continue;
      }
      const { data, body } = frontmatter(readFileSync(join(dir, c.path), "utf8"));
      if (!data.from) problems.push(`${c.path}: add 'from:' — who is proposing this (a name, a handle, or "anonymous").`);
      if (!data.experience) problems.push(`${c.path}: add 'experience:' — what you watched or heard that led to this note.`);
      if (!body.trim()) problems.push(`${c.path}: the note itself is empty.`);
      if (data.from && data.experience && body.trim()) notes.push(`${c.path}: viewer note from ${data.from} ✓`);
    }

    if (changed.some((c) => c.path === "CHARACTER.md")) notes.push("CHARACTER.md changes the character itself — the producer reviews this one closely.");
  }

  const touchesBible = !opts.base || changed.some((c) => c.path.startsWith("bible/"));
  if (touchesBible && existsSync(join(dir, "bible"))) {
    const s = stale(dir);
    if (s.length) problems.push(`The bible is out of date (${s.join(", ")}). It's generated: run \`npx future-radio-character-bible build .\`, or leave bible/ out of your PR and it will be rebuilt on merge.`);
    else notes.push("bible/: matches a fresh build ✓");
  }

  return { ok: problems.length === 0, problems, notes, changed };
}
