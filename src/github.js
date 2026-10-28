// Everything a dressing room needs to take pull requests from viewers.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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

/** Character folders in a shared repo: every subfolder of `dir` that has a CHARACTER.md. */
export function characterFolders(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "CHARACTER.md")))
    .map((e) => join(dir, e.name))
    .sort();
}

export function extrasTemplates(pkg = DEFAULT_PACKAGE) {
  return {
    "CONTRIBUTING.md": `# Shaping the extras

Extras are Future Radio characters who keep turning up without a story of their own yet.
Each lives in a folder of their own here (\`yuria/\`, \`the-cat/\`): what we know, what we don't know yet, and every appearance.
What you notice about them is how they get a story — and if enough people care about one,
they get promoted to a dressing room of their own, history and all.

## Talk to one

\`\`\`bash
git clone <this repo> && cd <this repo>
npx ${pkg} chat yuria
\`\`\`

\`/propose <note>\` in the chat writes a viewer note into that extra's folder.

## Propose something

- **A viewer note** — \`<name>/memory/viewer-notes/YYYY-MM-DD-short-title.md\`:

  \`\`\`markdown
  ---
  from: your name or handle (or "anonymous")
  experience: what you watched or heard — the episode, the scene, the moment
  episode: E01
  ---
  What should be true about them from now on, in a sentence or two.
  \`\`\`

- **An answer to an open question** — edit "What we don't know yet" in their \`CHARACTER.md\`
  and say where the answer comes from.
- **A new extra** — someone you noticed in an episode who isn't here yet. Open an issue with
  the "New extra" form, or add a folder with a \`CHARACTER.md\` in the same shape as the others.

No GitHub account? The "Viewer note" issue form works too.

## What can't change in a pull request

- Any extra's \`history/\` and \`history.jsonl\` — the writers' room writes those.
- Any extra's \`memory/notes.md\` is append-only.
- \`bible/\` folders are generated; leave them out and they're rebuilt on merge.

A check runs on every pull request, once per extra the PR touches, and explains anything it rejects.
`,
    ".github/pull_request_template.md": `## Which extra?

<!-- yuria, the-cat, ... or a new one -->

## What did you experience?

<!-- The episode, scene, or conversation that prompted this. -->

## What should be true about them from now on?

- [ ] I'm proposing a viewer note, a CHARACTER.md change, or a new extra — not editing history/ or bible/
- [ ] I'm happy for this to be credited as written in \`from:\`
`,
    ".github/ISSUE_TEMPLATE/viewer-note.yml": `name: Viewer note
description: Suggest something about one of the extras after watching or talking with them
title: "Viewer note: "
labels: ["viewer-note"]
body:
  - type: input
    id: extra
    attributes: { label: Which extra?, placeholder: Yuria }
    validations: { required: true }
  - type: input
    id: from
    attributes: { label: How should we credit you?, placeholder: a name, a handle, or anonymous }
    validations: { required: true }
  - type: input
    id: episode
    attributes: { label: Which episode or conversation?, placeholder: E01, or "local chat" }
  - type: textarea
    id: experience
    attributes: { label: What did you experience? }
    validations: { required: true }
  - type: textarea
    id: note
    attributes: { label: What should be true about them from now on? }
    validations: { required: true }
`,
    ".github/ISSUE_TEMPLATE/new-extra.yml": `name: New extra
description: Someone keeps turning up in Future Radio without a folder of their own
title: "New extra: "
labels: ["new-extra"]
body:
  - type: input
    id: name
    attributes: { label: Who?, placeholder: the voice in the static, the cat, Dennis }
    validations: { required: true }
  - type: textarea
    id: where
    attributes: { label: Where have they appeared?, description: Episodes, scenes, timestamps. }
    validations: { required: true }
  - type: textarea
    id: known
    attributes: { label: What do we know about them? }
  - type: input
    id: from
    attributes: { label: How should we credit you? }
`,
    ".github/workflows/character-bible.yml": `name: Character bibles
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
      - run: npx --yes ${pkg} check-each . --base origin/\${{ github.base_ref }}
  rebuild:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes ${pkg} build-each .
      - run: |
          git config user.name "character-bible"
          git config user.email "bible@future.radio"
          git add -A
          git diff --cached --quiet || (git commit -m "Rebuild the extras' character bibles" && git push)
`,
  };
}

/** Scaffolding for a shared repo of character folders (extras). Existing files are kept unless \`force\`. */
export function initExtrasGithub(root, { pkg = DEFAULT_PACKAGE, force = false } = {}) {
  const written = [];
  for (const [rel, content] of Object.entries(extrasTemplates(pkg))) {
    const p = join(root, rel);
    if (existsSync(p) && !force) continue;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    written.push(rel);
  }
  return written;
}
