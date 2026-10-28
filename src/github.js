// Everything a dressing room needs to take pull requests from viewers.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { load, PACKAGE } from "./bible.js";

export const DEFAULT_PACKAGE = process.env.CHARACTER_BIBLE_PACKAGE ?? PACKAGE;

export function templates(name, pkg = DEFAULT_PACKAGE) {
  return {
    "CONTRIBUTING.md": `# Changing ${name}

${name} is a character in Future Radio, and you can help shape them. If something in an
episode didn't ring true — or rang so true it should become canon — propose it here.

## Three ways in

1. **Talk to ${name} first.** Load them locally and see how they respond:

   \`\`\`bash
   git clone <this repo> && cd <this repo>
   npx ${pkg} chat .
   \`\`\`

   In the chat, \`/propose <your note>\` writes a viewer note file with the last few
   lines of your conversation attached. Commit it on a branch and open a pull request.

2. **Add a viewer note** — the usual route. Create
   \`memory/viewer-notes/YYYY-MM-DD-short-title.md\`:

   \`\`\`markdown
   ---
   from: your name or handle (or "anonymous")
   experience: what you watched or heard — the episode, the scene, the moment
   episode: E02
   ---
   What should be true about ${name} from now on, in a sentence or two.
   \`\`\`

3. **Edit CHARACTER.md** — for changes to who ${name} *is*: their job, constraints, or
   recurring conflict. These get the closest review.

No GitHub account? Open an issue with the "Viewer note" form instead.

## What can't change in a pull request

- \`history/\` and \`history.jsonl\` are the record of what ${name} actually did in the
  writers' room. They're written by the room only.
- \`memory/notes.md\` is append-only. Respond to an old note with a new one.
- \`bible/\` is generated from everything else. Leave it out of your PR; it's rebuilt on merge.

A check runs on every pull request and explains anything it rejects. Merged notes become
canon: they appear in ${name}'s bible and in the next episode the showrunner projects them into.
`,
    ".github/pull_request_template.md": `## What did you experience?

<!-- The episode, scene, or conversation that prompted this. Links to the workshop feed or a cut help. -->

## What should change about ${name}?

<!-- One or two sentences. What would be true from now on? -->

## Evidence

<!-- Lines from the episode or your local chat, a room event id (ev_000123), or a dressing-room history file. -->

- [ ] I'm proposing a viewer note or a CHARACTER.md change, not editing history/ or bible/
- [ ] I'm happy for this to be credited as written in \`from:\`
`,
    ".github/ISSUE_TEMPLATE/viewer-note.yml": `name: Viewer note
description: Suggest something about ${name} after watching or talking with them
title: "Viewer note: "
labels: ["viewer-note"]
body:
  - type: input
    id: from
    attributes: { label: How should we credit you?, placeholder: a name, a handle, or anonymous }
    validations: { required: true }
  - type: input
    id: episode
    attributes: { label: Which episode or conversation?, placeholder: E02, or "local chat" }
  - type: textarea
    id: experience
    attributes: { label: What did you experience?, description: The scene, the line, the moment. }
    validations: { required: true }
  - type: textarea
    id: note
    attributes: { label: What should be true about ${name} from now on? }
    validations: { required: true }
`,
    ".github/workflows/character-bible.yml": `name: Character bible
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: write
jobs:
  check:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes ${pkg} check . --base origin/\${{ github.base_ref }}
  rebuild:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes ${pkg} build .
      - run: |
          git config user.name "character-bible"
          git config user.email "bible@future.radio"
          git add bible
          git diff --cached --quiet || (git commit -m "Rebuild ${name}'s character bible" && git push)
`,
  };
}

/** Write the contribution scaffolding. Existing files are kept unless `force`. */
export function initGithub(dir, { pkg = DEFAULT_PACKAGE, force = false } = {}) {
  const { name } = load(dir);
  const written = [];
  for (const [rel, content] of Object.entries(templates(name, pkg))) {
    const p = join(dir, rel);
    if (existsSync(p) && !force) continue;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    written.push(rel);
  }
  mkdirSync(join(dir, "memory/viewer-notes"), { recursive: true });
  const keep = join(dir, "memory/viewer-notes/.gitkeep");
  if (!existsSync(keep)) writeFileSync(keep, "");
  return written;
}
