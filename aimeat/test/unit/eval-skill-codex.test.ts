/**
 * @file test/unit/eval-skill-codex.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Codex arm of `pnpm eval:skill` (scripts/eval-skill-codex.mjs), without a paid
 *   run: the suite is read as the Claude arm reads it, each grader kind can fail, the skill-fired
 *   indicator is read from codex's shell commands and left out of the score, the isolated
 *   CODEX_HOME turns the person's own skills off, and a renewed sign-in is copied back only when
 *   the person's own is unchanged.
 * @version-history
 *   v1.1.0 — 2026-11-27 — quoteArg: the Windows argv backslash rule (code scanning 1843).
 *   v1.0.0 — 2026-11-26 — Initial (wish-same-repo-tooling-for-codex-and-claude-code-agents-md-held-t).
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gradeRegex, loadSuite, parseCodexArgs, parseFrontmatter, planCalls, quoteArg, readEvents, scoreRun, skillFired,
  syncAuthBack, writeCodexHome, type Grader,
} from '../../../scripts/eval-skill-codex.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WRITING = join(REPO, '.claude', 'evals', 'aimeat-writing');

describe('reading a suite', () => {
  it('reads the aimeat-writing suite with its three grader kinds and the llm rubric', () => {
    const cases = loadSuite(WRITING);
    expect(cases.map(c => c.name)).toEqual(['commit-message', 'finnish-ui-copy', 'operator-help-line']);
    const commit = cases[0];
    expect(commit.prompt).toMatch(/^Write the commit message/);
    expect(commit.graders.map(g => g.type).sort()).toEqual(['llm', 'regex', 'regex', 'regex', 'regex', 'tool_used']);
    expect(commit.graders.find(g => g.type === 'llm')?.rubric).toMatch(/^PASS if/);
    expect(planCalls(cases, 3)).toBe(cases.reduce((n, c) => n + 3 * 2 * (1 + c.graders.filter(g => g.type === 'llm').length), 0));
  });

  it('a case filter keeps only the matching cases', () => {
    expect(loadSuite(WRITING, 'commit-*').map(c => c.name)).toEqual(['commit-message']);
    expect(() => loadSuite(WRITING, 'no-such-*')).toThrow(/no cases/);
  });

  it('a double-quoted YAML pattern keeps its regex escape', () => {
    const { meta } = parseFrontmatter('---\ntype: regex\npattern: "\\\\b(simply)\\\\b"\nflags: i\n---\n');
    expect(meta.pattern).toBe('\\b(simply)\\b');
  });
});

describe('grading', () => {
  const [commit] = loadSuite(WRITING, 'commit-message');
  const g = (file: string) => commit.graders.find(x => x.file === file) as Grader;

  it('the em-dash grader fails an answer with an em-dash and passes one without', () => {
    expect(gradeRegex(g('no-em-dash.md'), 'One path — not two')).toBe(false);
    expect(gradeRegex(g('no-em-dash.md'), 'One path, not two')).toBe(true);
  });

  it('the hook-limit grader fails a 73-character subject and passes a 72-character one', () => {
    expect(gradeRegex(g('within-hook-limits.md'), `${'a'.repeat(73)}\n\nWhy.`)).toBe(false);
    expect(gradeRegex(g('within-hook-limits.md'), `${'a'.repeat(72)}\n\nWhy.`)).toBe(true);
  });

  it('a contains grader fails when the words are missing', () => {
    expect(gradeRegex({ pattern: 'models=anthropic', match: 'contains' }, 'no meta here')).toBe(false);
  });

  it('the skill-fired indicator is reported and left out of the score; a failed judge counts', () => {
    const graders: Grader[] = [
      { file: 'a.md', type: 'regex', pattern: 'x', match: 'contains' },
      { file: 'b.md', type: 'regex', pattern: 'y', match: 'contains' },
      { file: 'c.md', type: 'llm', rubric: 'PASS if good' },
      { file: 'd.md', type: 'tool_used', tool: 'Skill' },
    ];
    const r = scoreRun(graders, 'x alone', { 'c.md': { pass: false, why: 'not good' } }, false);
    expect(r.score).toBeCloseTo(1 / 3);
    expect(r.results.find(x => x.file === 'd.md')).toEqual({ file: 'd.md', indicator: true, pass: false });
  });
});

describe('reading codex exec --json', () => {
  const jsonl = [
    '{"type":"thread.started","thread_id":"t"}',
    'not json',
    JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: '"pwsh.exe" -Command "Get-Content -LiteralPath \'.agents\\\\skills\\\\aimeat-writing\\\\SKILL.md\'"' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } }),
  ].join('\n');

  it('collects the shell commands and the token usage', () => {
    const ev = readEvents(jsonl);
    expect(ev.commands).toHaveLength(1);
    expect(ev.usage).toEqual({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 });
  });

  it('a read of the skill\'s SKILL.md counts as fired, with either slash; another skill does not', () => {
    const { commands } = readEvents(jsonl);
    expect(skillFired(commands, 'aimeat-writing')).toBe(true);
    expect(skillFired(['cat .agents/skills/aimeat-writing/SKILL.md'], 'aimeat-writing')).toBe(true);
    expect(skillFired(commands, 'aimeat-ai-capabilities')).toBe(false);
    expect(skillFired(['ls .agents/skills/aimeat-writing'], 'aimeat-writing')).toBe(false);
  });
});

describe('the isolated Codex home', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-arm-test-'));
    const realHome = join(root, 'real');
    const userSkills = join(root, 'agents-skills');
    mkdirSync(realHome);
    mkdirSync(join(userSkills, 'house-rules'), { recursive: true });
    writeFileSync(join(userSkills, 'house-rules', 'SKILL.md'), '---\nname: house-rules\n---\n');
    writeFileSync(join(realHome, 'auth.json'), '{"v":1}');
    return { root, realHome, userSkills, home: join(root, 'eval-home') };
  };

  it('copies the sign-in, uses the non-elevated sandbox and turns the person\'s own skills off', () => {
    const s = setup();
    try {
      const original = writeCodexHome(s.home, { realHome: s.realHome, userSkills: s.userSkills });
      expect(original).toBe('{"v":1}');
      const config = readFileSync(join(s.home, 'config.toml'), 'utf8');
      expect(config).toContain('sandbox = "unelevated"');
      expect(config).toContain(`path = '${join(s.userSkills, 'house-rules', 'SKILL.md')}'`);
      expect(config).toContain('enabled = false');
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('a renewed sign-in goes back only when the person\'s own is unchanged', () => {
    const s = setup();
    try {
      const original = writeCodexHome(s.home, { realHome: s.realHome, userSkills: s.userSkills });
      expect(syncAuthBack(s.home, original, s.realHome)).toBe('unchanged');
      writeFileSync(join(s.home, 'auth.json'), '{"v":2}');
      expect(syncAuthBack(s.home, original, s.realHome)).toBe('copied back');
      expect(readFileSync(join(s.realHome, 'auth.json'), 'utf8')).toBe('{"v":2}');
      writeFileSync(join(s.home, 'auth.json'), '{"v":3}');
      expect(syncAuthBack(s.home, original, s.realHome)).toBe('both changed');
      expect(readFileSync(join(s.realHome, 'auth.json'), 'utf8')).toBe('{"v":2}');
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });

  it('refuses a sign-in that does not exist', () => {
    const s = setup();
    try {
      rmSync(join(s.realHome, 'auth.json'));
      expect(() => writeCodexHome(s.home, { realHome: s.realHome, userSkills: s.userSkills })).toThrow(/codex login/);
    } finally { rmSync(s.root, { recursive: true, force: true }); }
  });
});

describe('options', () => {
  it('refuses an option the Codex arm does not take, so none is silently ignored', () => {
    expect(() => parseCodexArgs(['--max-cost-usd', '3'])).toThrow(/does not take --max-cost-usd/);
    expect(() => parseCodexArgs(['-j', '9'])).toThrow(/-j is 1 to 4/);
    expect(parseCodexArgs(['--runs', '2', '--case', 'commit-*', '--dry-run'])).toMatchObject({ runs: 2, caseGlob: 'commit-*', dryRun: true, concurrency: 2 });
  });
});

describe('quoting an argument for the codex shim', () => {
  it('leaves a plain argument and the backslashes of a path alone', () => {
    expect(quoteArg('exec')).toBe('exec');
    expect(quoteArg('C:\\dev\\x')).toBe('C:\\dev\\x');
    expect(quoteArg('C:\\my dir\\x')).toBe('"C:\\my dir\\x"');
  });
  it('doubles the backslashes before a quote and before the closing quote', () => {
    expect(quoteArg('a\\"b c')).toBe('"a\\\\\\"b c"');
    expect(quoteArg('C:\\my dir\\')).toBe('"C:\\my dir\\\\"');
  });
});
