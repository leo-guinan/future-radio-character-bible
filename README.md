# future-radio-character-bible

Load a Future Radio character from their dressing room, talk with them locally, and let
viewers propose changes to them by pull request.

Every character in the writers' room has a **dressing room**: a git repo with their
persona (`CHARACTER.md`), everything they've done (`history/`), and what they carry
forward (`memory/`). This tool reads a dressing room and writes its **character bible**:

| File | For |
|---|---|
| `bible/BIBLE.md` | Reading: identity, canon, how they've sounded, their record, relationships, how they changed |
| `bible/system-prompt.md` | Loading the character into any model |
| `bible/bible.json` | Tools: the same, structured, with a hash of every input |

The bible is generated and deterministic: the same sources always produce the same bible,
so a stale or hand-edited bible is detectable.

## Use

```bash
npx github:leo-guinan/future-radio-character-bible build ./dressing-room-borges
npx github:leo-guinan/future-radio-character-bible chat  ./dressing-room-borges     # ANTHROPIC_API_KEY optional
npx github:leo-guinan/future-radio-character-bible show  ./dressing-room-borges     # print the system prompt
npx github:leo-guinan/future-radio-character-bible check ./dressing-room-borges --base origin/main
npx github:leo-guinan/future-radio-character-bible init-github ./dressing-room-borges --package github:leo-guinan/future-radio-character-bible
```

In `chat`, type `/propose <what should be true about them>` and the moment becomes a viewer
note — `memory/viewer-notes/…md` with your credit, the experience that prompted it, and the
last few lines of the conversation — ready to commit and open as a pull request.

Without an API key the character answers offline, straight from their bible.
`CHARACTER_MODEL` picks the model (default `claude-sonnet-5-5`).

## Shared repos (extras)

A character doesn't need a repo of their own. Any folder with a \`CHARACTER.md\` works,
including one inside a bigger repo — the bible reads the show bible from the repo's top,
and \`check\` only counts changes inside that folder.

```bash
npx github:leo-guinan/future-radio-character-bible build-each .
npx github:leo-guinan/future-radio-character-bible check-each . --base origin/main
npx github:leo-guinan/future-radio-character-bible chat yuria
npx github:leo-guinan/future-radio-character-bible init-extras .
```

A character folder's \`CHARACTER.md\` can skip Job, Hard constraints and Recurring conflict;
the bible leaves out sections that aren't written.

## Pull request rules (`check --base`)

- `history/` and `history.jsonl` belong to the writers' room. Never edited in a PR.
- `memory/notes.md` is append-only.
- New viewer notes need `from:` and `experience:` frontmatter and a body. Merged notes aren't edited later.
- `bible/` is generated. Leave it out of a PR (it's rebuilt on merge), or it must match a fresh build.
- `CHARACTER.md` and `voice/` are open to proposals, flagged for close review.

`init-github` adds `CONTRIBUTING.md`, a PR template, a "Viewer note" issue form for people
without a GitHub account, and a workflow that runs `check` on pull requests and rebuilds
the bible on every push to `main`.

## As a library

```js
import { build, check, loadCharacter, reply, propose } from "future-radio-character-bible";
// npm install github:leo-guinan/future-radio-character-bible
```

Zero dependencies. Node 20+.

Part of [Future Radio](https://github.com/leo-guinan/future-radio-writers-room), made in public.

License: [CC0 1.0](LICENSE). Public domain; use it, change it, ship it.
