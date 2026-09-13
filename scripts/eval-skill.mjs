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
 *   WHY MEASURE. On 2026-09-13 two identical headless runs of one task cost $0.27 and $0.72, so a
 *   single run says nothing about whether a skill helps. The eval runs every case several times,
 *   once with the skill and once without it, and reports the difference.
 *
 *   WHAT THE BASELINE IS. An eval run loads nothing from the project: no CLAUDE.md, no rules, no
 *   other skills. The without-arm is a bare Claude, not a session in this repo, whose CLAUDE.md
 *   already carries a short version of several skills. Read a positive delta as "the skill alone
 *   moves this", not as "sessions here would get worse without it".
 * @usage
 *   node scripts/eval-skill.mjs <skill> [claude plugin eval options]
 *   pnpm eval:skill aimeat-writing --model sonnet --max-cost-usd 10
 *   Results land in .claude/evals/<skill>/results/<timestamp>/ (gitignored).
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (wish-plugin-evals-for-the-repo-s-skills).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [skill, ...passthrough] = process.argv.slice(2);

if (!skill || skill.startsWith('-')) {
  console.error('usage: node scripts/eval-skill.mjs <skill> [claude plugin eval options]');
  process.exit(1);
}
const skillDir = join(REPO, '.claude', 'skills', skill);
const suiteDir = join(REPO, '.claude', 'evals', skill);
if (!existsSync(join(skillDir, 'SKILL.md'))) {
  console.error(`no skill at ${skillDir}`);
  process.exit(1);
}
if (!existsSync(suiteDir)) {
  console.error(`no eval suite at ${suiteDir}; write cases there first`);
  process.exit(1);
}

const plugin = mkdtempSync(join(tmpdir(), `aimeat-skill-eval-${skill}-`));
let status = 1;
try {
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: `${skill}-eval`,
    version: '0.0.0',
    description: `Throwaway wrapper around .claude/skills/${skill} for claude plugin eval.`,
  }, null, 2));
  cpSync(skillDir, join(plugin, 'skills', skill), { recursive: true });
  cpSync(suiteDir, join(plugin, 'evals'), {
    recursive: true,
    filter: (src) => !src.startsWith(join(suiteDir, 'results')),
  });

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
    for (const stamp of readdirSync(results)) {
      const target = join(suiteDir, 'results', stamp);
      cpSync(join(results, stamp), target, { recursive: true });
      console.log(`results: ${target}`);
    }
  }
} finally {
  rmSync(plugin, { recursive: true, force: true });
}
process.exit(status);
