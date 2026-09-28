#!/usr/bin/env node
/**
 * @file eval-skill.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Measures what one of this repo's skills changes, with `claude plugin eval`.
 *
 *   WHY A RUNNER. `claude plugin eval` scores a plugin, and the skills here are plain skills in
 *   .claude/skills/, which every session loads as they are. Giving a skill folder a plugin
 *   manifest would turn it into `<name>@skills-dir` and change how sessions load it, and a second
 *   copy of the skill under a plugin directory would be a second home that drifts. So the suite is
 *   committed at .claude/evals/<skill>/, and each run assembles a throwaway plugin in the temp
 *   directory: a manifest, a copy of .claude/skills/<skill>/, and a copy of the suite. The skill
 *   stays in one place and the eval reads exactly what sessions read.
 *
 *   NODE SKILLS. The node's built-in skills have no folder: their one home is the `skillMd`
 *   string of an entry in BUILTIN_SKILLS (aimeat/src/data/builtin-skills.ts). `--node-skill
 *   <name>` reads that string by importing the TypeScript module in a child `node --import tsx`
 *   process run in aimeat/ (the package that has tsx), which prints the entry as JSON on stdout.
 *   The runner writes it as skills/<name>/SKILL.md inside the throwaway plugin only, so the eval
 *   reads exactly what the node seeds and no copy of the skill lands in the repo. The suite is
 *   .claude/evals/<name>/, the same place as for a file skill.
 *
 *   WHY MEASURE. On 2026-09-13 two identical headless runs of one task cost $0.27 and $0.72, so a
 *   single run says nothing about whether a skill helps. The eval runs every case several times,
 *   once with the skill and once without it, and reports the difference.
 *
 *   WHAT THE BASELINE IS. An eval run loads nothing from the project: no CLAUDE.md, no rules, no
 *   other skills. The without-arm is a bare Claude, not a session in this repo, whose CLAUDE.md
 *   already carries a short version of several skills. Read a positive delta as "the skill alone
 *   moves this", not as "sessions here would get worse without it".
 *
 *   IMPORTING. `buildPlugin(source)` assembles the plugin directory and returns its path without
 *   calling `claude`, and `readNodeSkill(name)` returns a built-in skill's text; both are exported
 *   so the assembly can be checked without a paid run. The CLI runs only when this file is the
 *   entry script.
 * @usage
 *   node scripts/eval-skill.mjs <skill> [claude plugin eval options]
 *   node scripts/eval-skill.mjs --node-skill <name> [claude plugin eval options]
 *   pnpm eval:skill aimeat-writing --model sonnet --max-cost-usd 10
 *   pnpm eval:skill --node-skill aimeat-ai-capabilities --model opus --max-cost-usd 10
 *   Results land in .claude/evals/<skill>/results/<timestamp>/ (gitignored).
 * @version-history
 *   v1.1.0 — 2026-09-28 — `--node-skill <name>`: evaluates a built-in node skill from its
 *     BUILTIN_SKILLS entry without copying it into the repo; plugin assembly exported as
 *     buildPlugin() (V5 of the System 2 plan).
 *   v1.0.0 — 2026-09-13 — Initial (wish-plugin-evals-for-the-repo-s-skills).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AIMEAT_DIR = join(REPO, 'aimeat');
const BUILTIN_SKILLS_TS = join(AIMEAT_DIR, 'src', 'data', 'builtin-skills.ts');
const USAGE = [
  'usage: node scripts/eval-skill.mjs <skill> [claude plugin eval options]',
  '       node scripts/eval-skill.mjs --node-skill <name> [claude plugin eval options]',
].join('\n');

/** A failure the CLI reports as one line and exit status 1. */
class EvalSkillError extends Error {}

/** The suite directory for a skill name; the same place for a file skill and a node skill. */
export function suiteDirFor(name) {
  return join(REPO, '.claude', 'evals', name);
}

/**
 * Returns the `skillMd` text of the BUILTIN_SKILLS entry named `name`. The TypeScript module is
 * imported in a child process with the tsx loader, run in aimeat/ so `--import tsx` resolves to
 * that package's tsx, and the child prints `{ names, skillMd }` as JSON.
 */
export function readNodeSkill(name) {
  const code = [
    "const { pathToFileURL } = await import('node:url');",
    'const { BUILTIN_SKILLS } = await import(pathToFileURL(process.env.AIMEAT_BUILTIN_SKILLS_TS).href);',
    'const hit = BUILTIN_SKILLS.find((s) => s.name === process.env.AIMEAT_NODE_SKILL);',
    'process.stdout.write(JSON.stringify({ names: BUILTIN_SKILLS.map((s) => s.name), skillMd: hit ? hit.skillMd : null }));',
  ].join('\n');
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: AIMEAT_DIR,
    env: { ...process.env, AIMEAT_BUILTIN_SKILLS_TS: BUILTIN_SKILLS_TS, AIMEAT_NODE_SKILL: name },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new EvalSkillError(`could not read BUILTIN_SKILLS from ${BUILTIN_SKILLS_TS} (is aimeat/ installed?):\n${run.stderr || run.error}`);
  }
  const { names, skillMd } = JSON.parse(run.stdout);
  if (typeof skillMd !== 'string') {
    throw new EvalSkillError(`no built-in skill named "${name}" in BUILTIN_SKILLS; known: ${names.join(', ')}`);
  }
  return skillMd;
}

/**
 * Assembles the throwaway plugin in the temp directory and returns its path. `source` is
 * `{ skill }` for .claude/skills/<skill>/ or `{ nodeSkill }` for a BUILTIN_SKILLS entry. The
 * caller removes the directory. Throws EvalSkillError when the skill or its suite is missing,
 * before anything is created.
 */
export function buildPlugin(source) {
  const name = source.nodeSkill ?? source.skill;
  if (!name || name.startsWith('-')) throw new EvalSkillError(USAGE);
  const suiteDir = suiteDirFor(name);
  let skillDir = null;
  let skillMd = null;
  if (source.nodeSkill) {
    skillMd = readNodeSkill(name);
  } else {
    skillDir = join(REPO, '.claude', 'skills', name);
    if (!existsSync(join(skillDir, 'SKILL.md'))) throw new EvalSkillError(`no skill at ${skillDir}`);
  }
  if (!existsSync(suiteDir)) throw new EvalSkillError(`no eval suite at ${suiteDir}; write cases there first`);

  const origin = skillMd === null ? `.claude/skills/${name}` : `the BUILTIN_SKILLS entry ${name}`;
  const plugin = mkdtempSync(join(tmpdir(), `aimeat-skill-eval-${name}-`));
  try {
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
      name: `${name}-eval`,
      version: '0.0.0',
      description: `Throwaway wrapper around ${origin} for claude plugin eval.`,
    }, null, 2));
    if (skillMd === null) {
      cpSync(skillDir, join(plugin, 'skills', name), { recursive: true });
    } else {
      mkdirSync(join(plugin, 'skills', name), { recursive: true });
      writeFileSync(join(plugin, 'skills', name, 'SKILL.md'), skillMd);
    }
    cpSync(suiteDir, join(plugin, 'evals'), {
      recursive: true,
      filter: (src) => !src.startsWith(join(suiteDir, 'results')),
    });
  } catch (err) {
    rmSync(plugin, { recursive: true, force: true });
    throw err;
  }
  return plugin;
}

function main(argv) {
  let source;
  let passthrough;
  if (argv[0] === '--node-skill') {
    source = { nodeSkill: argv[1] };
    passthrough = argv.slice(2);
  } else {
    source = { skill: argv[0] };
    passthrough = argv.slice(1);
  }
  const name = source.nodeSkill ?? source.skill;

  let plugin;
  try {
    plugin = buildPlugin(source);
  } catch (err) {
    if (!(err instanceof EvalSkillError)) throw err;
    console.error(err.message);
    return 1;
  }

  let status = 1;
  try {
    // --trust-plugin: the wrapper is assembled from this repo's own files a moment ago.
    // --no-publish: reports stay on this machine unless the caller asks otherwise.
    const args = ['plugin', 'eval', plugin, '--trust-plugin', ...passthrough];
    if (!passthrough.includes('--publish-report')) args.push('--no-publish');
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const run = spawnSync('claude', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
    status = run.status ?? 1;

    const results = join(plugin, 'evals', 'results');
    if (existsSync(results)) {
      const suiteDir = suiteDirFor(name);
      for (const stamp of readdirSync(results)) {
        const target = join(suiteDir, 'results', stamp);
        cpSync(join(results, stamp), target, { recursive: true });
        console.log(`results: ${target}`);
      }
    }
  } finally {
    rmSync(plugin, { recursive: true, force: true });
  }
  return status;
}

// import.meta.main arrived in Node 24.2; the realpath comparison covers 24.0 and 24.1.
const isEntry = import.meta.main
  ?? (Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)));
if (isEntry) process.exit(main(process.argv.slice(2)));
