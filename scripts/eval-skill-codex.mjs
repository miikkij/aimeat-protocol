/**
 * @file eval-skill-codex.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Codex arm of `pnpm eval:skill`: runs one skill's suite in .claude/evals/<skill>/
 *   through `codex exec`, once with the skill and once without it, and scores the answers with the
 *   suite's own graders, as `claude plugin eval` does for the Claude arm.
 *
 *   WHY A SECOND ARM. A skill in this repo is read by Claude Code and by Codex (AGENTS.md sends
 *   Codex to .claude/skills/). The Claude arm says what a skill changes for Claude; this arm says
 *   what the same text changes for Codex, from the same cases and the same graders.
 *
 *   WHAT THE BASELINE IS. Each run gets a temporary CODEX_HOME holding a copy of the person's
 *   sign-in (auth.json) and a config written here: the non-elevated Windows sandbox, and every
 *   skill under ~/.agents/skills turned off. So neither arm loads the person's AGENTS.md, plugins,
 *   memories or own skills, only Codex's built-in system skills. The with-arm puts the skill at
 *   <run dir>/.agents/skills/<name>/, where Codex discovers a repository's skills. If Codex renews
 *   the sign-in during the eval, the renewed auth.json is copied back, so the person's own Codex
 *   stays signed in.
 *
 *   SCORING, the same as the Claude arm. A run's score is the share of its scored graders that
 *   passed. `regex` graders read the answer (match contains or not_contains, with flags). `llm`
 *   graders are judged by a separate `codex exec` that sees only the rubric and the answer and
 *   replies PASS or FAIL. A `tool_used: Skill` grader is the "skill fired" indicator and is not
 *   scored: the arm counts it as fired when a shell command of the run read the skill's SKILL.md.
 *   A case's score is the mean of its runs; the delta is with minus without.
 *
 *   WHAT IT DOES NOT MODEL. max_turns (codex exec has no turn limit; timeout_seconds bounds a run),
 *   allowed_tools (every run is in the read-only sandbox, which covers Read, Glob and Grep), and
 *   case.yaml cases (the suites here use prompt.md and graders/*.md).
 * @structure loadSuite, parseFrontmatter — read a suite · gradeRegex, scoreRun, skillFired,
 *   readEvents — score a run · writeCodexHome, syncAuthBack — the isolated home · planCalls,
 *   runCodexEval — the run · parseCodexArgs — the CLI options
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-same-repo-tooling-for-codex-and-claude-code-agents-md-held-t).
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { parse: parseYaml } = createRequire(join(REPO, 'aimeat', 'package.json'))('yaml');

const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_S = 300;
const JUDGE_TIMEOUT_S = 180;
const MAX_CONCURRENCY = 4;

/** A failure the CLI reports as one line and exit status 1. */
export class CodexEvalError extends Error {}

/** Splits a Markdown file into its YAML frontmatter object and the body after it. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  return { meta: parseYaml(m[1]) ?? {}, body: m[2].trim() };
}

/** Turns a case-name glob (`*` and `?`) into a RegExp over the whole name. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Reads every case of a suite: a folder with prompt.md and graders/*.md. Returns
 * [{ name, prompt, meta, graders: [{ file, type, pattern?, flags?, match?, tool?, rubric? }] }].
 */
export function loadSuite(suiteDir, caseGlob) {
  const only = caseGlob ? globToRegExp(caseGlob) : null;
  const cases = [];
  for (const name of readdirSync(suiteDir).sort()) {
    const dir = join(suiteDir, name);
    if (name === 'results' || (only && !only.test(name))) continue;
    if (existsSync(join(dir, 'case.yaml'))) throw new CodexEvalError(`${name}: case.yaml cases are not supported by the Codex arm; use prompt.md and graders/`);
    if (!existsSync(join(dir, 'prompt.md'))) continue;
    const { meta, body } = parseFrontmatter(readFileSync(join(dir, 'prompt.md'), 'utf8'));
    const graderDir = join(dir, 'graders');
    const graders = existsSync(graderDir)
      ? readdirSync(graderDir).filter(f => f.endsWith('.md')).sort().map((file) => {
        const g = parseFrontmatter(readFileSync(join(graderDir, file), 'utf8'));
        return { file, ...g.meta, rubric: g.meta.type === 'llm' ? g.body : undefined };
      })
      : [];
    for (const g of graders) {
      if (!['regex', 'llm', 'tool_used'].includes(g.type)) throw new CodexEvalError(`${name}/${g.file}: grader type "${g.type}" is not supported by the Codex arm`);
      if (g.type === 'tool_used' && g.tool !== 'Skill') throw new CodexEvalError(`${name}/${g.file}: only tool_used: Skill is supported by the Codex arm`);
    }
    cases.push({ name, prompt: body, meta, graders });
  }
  if (cases.length === 0) throw new CodexEvalError(`no cases in ${suiteDir}${caseGlob ? ` matching ${caseGlob}` : ''}`);
  return cases;
}

/** One regex grader on one answer: contains passes on a match, not_contains on none. */
export function gradeRegex(grader, answer) {
  const hit = new RegExp(grader.pattern, grader.flags ?? '').test(answer);
  return (grader.match ?? 'contains') === 'not_contains' ? !hit : hit;
}

/** Reads `codex exec --json` output: the shell commands it ran and the token usage. */
export function readEvents(jsonl) {
  const commands = [];
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'item.completed' && ev.item?.type === 'command_execution') commands.push(String(ev.item.command ?? ''));
    if (ev.type === 'turn.completed' && ev.usage) {
      for (const k of Object.keys(usage)) usage[k] += Number(ev.usage[k] ?? 0);
    }
  }
  return { commands, usage };
}

/** True when a shell command of the run read the skill's SKILL.md (either slash). */
export function skillFired(commands, name) {
  const re = new RegExp(`skills[\\\\/]+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/]+SKILL\\.md`, 'i');
  return commands.some(c => re.test(c));
}

/**
 * Scores one run. `judged` maps an llm grader's file to { pass, why }. The tool_used grader is
 * reported as the indicator and left out of the score, as the Claude arm's ablation does.
 */
export function scoreRun(graders, answer, judged, fired) {
  const results = [];
  for (const g of graders) {
    if (g.type === 'tool_used') { results.push({ file: g.file, indicator: true, pass: fired }); continue; }
    if (g.type === 'regex') { results.push({ file: g.file, pass: gradeRegex(g, answer) }); continue; }
    const j = judged[g.file];
    results.push({ file: g.file, pass: Boolean(j?.pass), why: j?.why ?? 'not judged' });
  }
  const scored = results.filter(r => !r.indicator);
  const score = scored.length === 0 ? 1 : scored.filter(r => r.pass).length / scored.length;
  return { score, results };
}

/** How many codex calls an eval makes: every case, run and arm, plus one judge call per llm grader. */
export function planCalls(cases, runs) {
  let calls = 0;
  for (const c of cases) {
    const n = c.meta.runs ?? runs;
    const llm = c.graders.filter(g => g.type === 'llm').length;
    calls += n * 2 * (1 + llm);
  }
  return calls;
}

/**
 * Writes the isolated CODEX_HOME: a copy of the sign-in and a config with the non-elevated
 * sandbox and every skill under the person's ~/.agents/skills turned off. Returns the copied
 * auth text, so syncAuthBack can tell whether Codex renewed it.
 */
export function writeCodexHome(home, { realHome = join(homedir(), '.codex'), userSkills = join(homedir(), '.agents', 'skills') } = {}) {
  const auth = join(realHome, 'auth.json');
  if (!existsSync(auth)) throw new CodexEvalError(`no Codex sign-in at ${auth}; run codex login first`);
  mkdirSync(home, { recursive: true });
  const authText = readFileSync(auth, 'utf8');
  writeFileSync(join(home, 'auth.json'), authText);
  const lines = ['[windows]', 'sandbox = "unelevated"', ''];
  if (existsSync(userSkills)) {
    for (const name of readdirSync(userSkills).sort()) {
      const md = join(userSkills, name, 'SKILL.md');
      if (!existsSync(md)) continue;
      lines.push('[[skills.config]]', `path = '${md}'`, 'enabled = false', '');
    }
  }
  writeFileSync(join(home, 'config.toml'), lines.join('\n'));
  return authText;
}

/**
 * Copies a renewed sign-in back to the person's own CODEX_HOME, but only when theirs is still the
 * one this eval copied. Returns 'unchanged', 'copied back' or 'both changed'.
 */
export function syncAuthBack(home, original, realHome = join(homedir(), '.codex')) {
  const now = readFileSync(join(home, 'auth.json'), 'utf8');
  if (now === original) return 'unchanged';
  const realPath = join(realHome, 'auth.json');
  if (readFileSync(realPath, 'utf8') !== original) return 'both changed';
  writeFileSync(realPath, now);
  return 'copied back';
}

/** Quotes one argument for the Windows shell that runs the npm `codex` shim. */
function quoteArg(a) {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

/** Runs one `codex exec` in `cwd` with the prompt on stdin. Resolves { answer, events, timedOut }. */
function codexExec({ cwd, prompt, home, model, timeoutS }) {
  const out = join(cwd, '.codex-last-message.txt');
  const args = ['exec', '--ephemeral', '--ignore-rules', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd, '--json', '-o', out];
  if (model) args.push('-m', model);
  args.push('-');
  const bin = process.env.CODEX_BIN || 'codex';
  const cmdline = [bin, ...args].map(quoteArg).join(' ');
  return new Promise((done) => {
    const child = spawn(cmdline, { cwd, shell: true, env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutS * 1000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => {});
    child.on('close', () => {
      clearTimeout(timer);
      const answer = existsSync(out) ? readFileSync(out, 'utf8').trim() : '';
      done({ answer, events: readEvents(stdout), timedOut });
    });
    child.stdin.end(prompt);
  });
}

/** Asks a separate codex run, which sees only the rubric and the answer, for PASS or FAIL. */
async function judge({ rubric, answer, home, model }) {
  const cwd = mkdtempSync(join(tmpdir(), 'aimeat-codex-judge-'));
  try {
    const prompt = [
      'You grade one answer against a rubric. Do not run any command. Reply with exactly PASS or FAIL on the first line, then one sentence that says why.',
      '', 'Rubric:', rubric, '', 'Answer:', answer || '(empty)',
    ].join('\n');
    const r = await codexExec({ cwd, prompt, home, model, timeoutS: JUDGE_TIMEOUT_S });
    const first = r.answer.split(/\r?\n/)[0]?.trim().toUpperCase() ?? '';
    return { pass: first.startsWith('PASS'), why: r.timedOut ? 'the judge timed out' : r.answer.split(/\r?\n/).slice(1).join(' ').trim(), usage: r.events.usage };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** Runs async jobs with at most `limit` at once, keeping their order in the result. */
async function pool(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

function addUsage(total, u) {
  for (const k of Object.keys(total)) total[k] += Number(u?.[k] ?? 0);
}

/**
 * Parses the options the Codex arm takes after `--codex`. Anything else is refused, so an option
 * the Claude arm knows is never silently ignored.
 */
export function parseCodexArgs(argv) {
  const o = { runs: undefined, model: undefined, judgeModel: undefined, caseGlob: undefined, concurrency: 2, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new CodexEvalError(`${a} needs a value`);
      return v;
    };
    if (a === '--runs') o.runs = Number(val());
    else if (a === '--model') o.model = val();
    else if (a === '--judge-model') o.judgeModel = val();
    else if (a === '--case') o.caseGlob = val();
    else if (a === '-j' || a === '--concurrency') o.concurrency = Number(val());
    else if (a === '--dry-run') o.dryRun = true;
    else throw new CodexEvalError(`the Codex arm does not take ${a}; it takes --runs, --model, --judge-model, --case, -j and --dry-run`);
  }
  if (o.runs !== undefined && !(Number.isInteger(o.runs) && o.runs >= 1 && o.runs <= 10)) throw new CodexEvalError('--runs is 1 to 10');
  if (!(Number.isInteger(o.concurrency) && o.concurrency >= 1 && o.concurrency <= MAX_CONCURRENCY)) throw new CodexEvalError(`-j is 1 to ${MAX_CONCURRENCY}`);
  return o;
}

function codexVersion() {
  const r = spawnSync(process.env.CODEX_BIN || 'codex', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  return (r.stdout || '').trim() || 'unknown';
}

/**
 * Runs the suite for one skill through Codex. `skill` is { name, dir } for a file skill or
 * { name, skillMd } for a node skill. Writes <suite>/results/<stamp>-codex/aggregate-result.json
 * and returns the result object; with dryRun, returns the plan and runs nothing.
 */
export async function runCodexEval({ skill, suiteDir, options, log = console.log }) {
  const cases = loadSuite(suiteDir, options.caseGlob);
  const runs = options.runs ?? DEFAULT_RUNS;
  const calls = planCalls(cases, runs);
  if (options.dryRun) {
    log(`codex arm, ${skill.name}: ${cases.length} cases, ${runs} runs per case per arm, ${calls} codex calls; nothing run`);
    return { dryRun: true, cases: cases.map(c => c.name), calls };
  }
  const root = mkdtempSync(join(tmpdir(), `aimeat-codex-eval-${skill.name}-`));
  const home = join(root, 'codex-home');
  const original = writeCodexHome(home);
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  log(`codex arm, ${skill.name}: ${cases.length} cases, ${runs} runs per case per arm, ${calls} codex calls, ${options.concurrency} at once`);
  try {
    const jobs = [];
    for (const c of cases) {
      const n = c.meta.runs ?? runs;
      for (const arm of ['with', 'without']) {
        for (let r = 0; r < n; r++) {
          jobs.push(async () => {
            const cwd = mkdtempSync(join(root, `${c.name}-${arm}-`));
            if (arm === 'with') {
              const target = join(cwd, '.agents', 'skills', skill.name);
              if (skill.dir) cpSync(skill.dir, target, { recursive: true });
              else { mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'SKILL.md'), skill.skillMd); }
            }
            const run = await codexExec({ cwd, prompt: c.prompt, home, model: options.model, timeoutS: c.meta.timeout_seconds ?? DEFAULT_TIMEOUT_S });
            addUsage(usage, run.events.usage);
            const judged = {};
            for (const g of c.graders.filter(x => x.type === 'llm')) {
              const j = await judge({ rubric: g.rubric, answer: run.answer, home, model: options.judgeModel ?? options.model });
              addUsage(usage, j.usage);
              judged[g.file] = j;
            }
            const fired = skillFired(run.events.commands, skill.name);
            const scored = scoreRun(c.graders, run.answer, judged, fired);
            log(`  ${c.name} ${arm} #${r + 1}: ${scored.score.toFixed(2)}${arm === 'with' ? (fired ? ', skill read' : ', skill NOT read') : ''}${run.timedOut ? ', timed out' : ''}`);
            return { case: c.name, arm, run: r + 1, score: scored.score, fired, timedOut: run.timedOut, graders: scored.results, answer: run.answer, usage: run.events.usage };
          });
        }
      }
    }
    const all = await pool(jobs, options.concurrency);
    const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const perCase = cases.map((c) => {
      const w = all.filter(x => x.case === c.name && x.arm === 'with');
      const wo = all.filter(x => x.case === c.name && x.arm === 'without');
      const withScore = mean(w.map(x => x.score));
      const withoutScore = mean(wo.map(x => x.score));
      return { name: c.name, with: withScore, without: withoutScore, delta: withScore - withoutScore, fired: `${w.filter(x => x.fired).length}/${w.length}`, runs: [...w, ...wo] };
    });
    const result = {
      vendor: 'codex', codex: codexVersion(), skill: skill.name, model: options.model ?? 'codex default',
      judge_model: options.judgeModel ?? options.model ?? 'codex default', runs_per_case: runs,
      finished_at: new Date().toISOString(), usage, cases: perCase,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = join(suiteDir, 'results', `${stamp}-codex`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'aggregate-result.json'), JSON.stringify(result, null, 2));
    log('');
    log('case                               with  without  delta  skill read');
    for (const c of perCase) log(`${c.name.padEnd(34)} ${c.with.toFixed(2)}  ${c.without.toFixed(2)}     ${(c.delta >= 0 ? '+' : '') + c.delta.toFixed(2)}  ${c.fired}`);
    log(`mean delta ${(mean(perCase.map(c => c.delta)) >= 0 ? '+' : '')}${mean(perCase.map(c => c.delta)).toFixed(2)}; tokens in ${usage.input_tokens} (cached ${usage.cached_input_tokens}), out ${usage.output_tokens}; ${result.codex}, model ${result.model}`);
    log(`results: ${join(outDir, 'aggregate-result.json')}`);
    return result;
  } finally {
    const sync = syncAuthBack(home, original);
    if (sync === 'both changed') log('note: Codex renewed its sign-in during the eval and your own sign-in changed too; yours was left as it is.');
    rmSync(root, { recursive: true, force: true });
  }
}
