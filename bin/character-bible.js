#!/usr/bin/env node
// character-bible build|check|chat|init-github|show <dressing-room-dir>

import { build, check, initGithub, render, repl } from "../src/index.js";

const [cmd, dir = ".", ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i < 0 ? undefined : rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : true;
};

const HELP = `character-bible — load a Future Radio character from their dressing room

  build <dir>                     Write bible/BIBLE.md, bible/system-prompt.md, bible/bible.json
  check <dir> [--base origin/main]  Verify the bible is fresh; with --base, apply pull-request rules
  chat <dir> [--from name]        Talk with the character locally; /propose turns a moment into a viewer note
  show <dir>                      Print the system prompt (paste it into any model)
  init-github <dir> [--package spec] [--force]  Add CONTRIBUTING, PR template, issue form, CI workflow
`;

try {
  switch (cmd) {
    case "build": {
      const { model, changed } = build(dir);
      console.log(changed.length ? `Rebuilt ${model.name}'s bible: ${changed.join(", ")}` : `${model.name}'s bible is up to date.`);
      break;
    }
    case "check": {
      const r = check(dir, { base: flag("base") });
      for (const n of r.notes) console.log(`  ${n}`);
      for (const p of r.problems) console.log(`✗ ${p}`);
      console.log(r.ok ? "✓ Checks passed." : `\n${r.problems.length} problem(s).`);
      process.exit(r.ok ? 0 : 1);
    }
    case "chat":
      await repl(dir, { from: flag("from") });
      break;
    case "show":
      process.stdout.write(render(dir).files["bible/system-prompt.md"]);
      break;
    case "init-github": {
      const w = initGithub(dir, { pkg: flag("package"), force: !!flag("force") });
      console.log(w.length ? `Wrote ${w.join(", ")}` : "Already set up (use --force to overwrite).");
      break;
    }
    default:
      console.log(HELP);
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
