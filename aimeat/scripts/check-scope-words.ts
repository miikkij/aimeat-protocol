/**
 * @file scripts/check-scope-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a scope word added to an MCP tool or a REST route that already exists, unless
 *   the same change brings the once-per-node step that hands the word to the agents, ecosystem apps
 *   and app grants approved before it, or writes down why the narrowing is meant.
 *
 *   WHY. The node MCP registers a tool only when the session holds every word on it
 *   (tool-catalog/scopes.ts scopeAllowsTool), so a new word on a tool does not refuse a call: it
 *   REMOVES the tool from every agent approved without the word. On 2026-10-06 `organism:read` went
 *   onto the workspace read tools, neither the node's default agent scopes nor the "standard" consent
 *   preset carried it, and at the deploy every agent approved with them lost workspace read, overview,
 *   organism search and export, with every test green. Four E2E suites had failed and were fixed by
 *   giving their test agents the new word, which is the one fix a real agent never gets. The same
 *   shape broke production in changelog 1.33.1. A REST route is the same: a new requireScope on a
 *   route answers 403 to every grant issued before the word existed, and the owner learns of it from
 *   an app that stops mid-use. Both are consent already given, and a new rule cannot be applied to it.
 *
 *   WHAT IT READS. The scope words each catalog MCP tool names (`scope` on its definition, every word
 *   whether or not `scopeEnforcedFrom` defers it), and the words each route under src/routes names
 *   literally in requireScope('…') or requireRestScope('…') between its path and its handler.
 *   security/scope-word-snapshot.json holds both as they were when it was last written. A tool or
 *   route the snapshot does not have is new and passes; a word that left passes.
 *
 *   THE ANSWER IT ASKS FOR. A word added to an existing tool or route needs one of:
 *     - a keep-working step in scripts/lib/scope-keep-steps.ts that the snapshot does not know yet
 *       and that hands the word out. Write it the way services/tool-scope-words-migration.ts and
 *       services/rest-scope-keep-working-migration.ts are written: claimed once per node
 *       (services/once-only-step.ts), on positive evidence only (the word the principal already held
 *       that reached the tool), never a word that opens more than the reach it had, the list changed on
 *       the list that was read (services/scope/list-swap.ts), run from
 *       server-bootstrap/once-only-keep-steps.ts before the node serves;
 *       For an app grant the step may instead let a grant made before the word pass until its owner
 *       approves the app again: re-consent reissues the grant with the words the app now asks for, so
 *       the exception removes itself (services/scope/vocabulary-migration.ts appGrantPredatesVocabulary);
 *     - or an entry under `accepted` in the snapshot, `"<tool or route> <word>": "<why>"`, for a
 *       narrowing that is meant (a security fix that takes reach away on purpose).
 *   Check the default agent scopes (config.ts SHIPPED_DEFAULT_AGENT_SCOPES) and the consent presets
 *   (public/views/profile/agents/scope-model.js) too: an agent approved tomorrow gets those lists, and
 *   the check prints which of them lack the word.
 *
 *   A test fixed by giving its agent a new scope word is the tell. Ask what happens to the agents in
 *   production that hold yesterday's words.
 * @structure currentTools() · currentRoutes() · stepsNotRunAtBoot() · main()
 * @usage
 *   cd aimeat && pnpm check:scope-words            # the gate (check:fast)
 *   cd aimeat && pnpm check:scope-words --update   # write the snapshot; refused while an addition is unanswered
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial (docs/pitfalls.md §119 and §6, third bullet, now deleted).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../src/tool-catalog/definitions.js';
import { toolScopeWords } from '../src/tool-catalog/scopes.js';
import { SHIPPED_DEFAULT_AGENT_SCOPES } from '../src/config.js';
import { middlewareSection } from './check-route-scopes.js';
import { SCOPE_KEEP_STEPS } from './lib/scope-keep-steps.js';
import {
  addedWords, answerAddition, routeScopeWords, sortedWordMap,
  type Addition, type ScopeWordSnapshot, type WordMap,
} from './lib/scope-word-snapshot.js';

const ROOT = process.cwd();
const SNAPSHOT = join(ROOT, 'security', 'scope-word-snapshot.json');
const NOTE = 'The scope words each MCP tool and each REST route required when this file was last written (scripts/check-scope-words.ts). A word added to a tool or route listed here needs a keep-working step new in scripts/lib/scope-keep-steps.ts, or an entry under `accepted` with its reason. Written by `pnpm check:scope-words --update`; never edited by hand except `accepted`.';

/** Every catalog tool and the words it names; a tool with none is listed with none. */
function currentTools(): WordMap {
  return sortedWordMap(Object.fromEntries(CLI_FALLBACK_TOOL_DEFINITIONS.map(d => [d.name, toolScopeWords(d.scope)])));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every route under src/routes, keyed file:METHOD:path, and the words its middleware names literally. */
function currentRoutes(): WordMap {
  const map: WordMap = {};
  for (const file of walk(join(ROOT, 'src', 'routes'))) {
    const source = readFileSync(file, 'utf-8');
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (const m of source.matchAll(/router\.(post|put|patch|delete|get)\(\s*(['"`])([^'"`]+)\2\s*,?/g)) {
      const key = `${rel}:${m[1].toUpperCase()}:${m[3]}`;
      map[key] = [...(map[key] ?? []), ...routeScopeWords(middlewareSection(source, m.index! + m[0].length))];
    }
  }
  return sortedWordMap(map);
}

/** Steps listed in scope-keep-steps.ts whose function no boot file calls. */
function stepsNotRunAtBoot(): string[] {
  const boot = walk(join(ROOT, 'src', 'server-bootstrap'))
    .map(f => readFileSync(f, 'utf-8').split('\n').filter(l => !/^\s*(\*|\/\/)/.test(l)).join('\n'))
    .join('\n');
  return SCOPE_KEEP_STEPS.filter(s => !new RegExp(`\\b${s.run}\\(`).test(boot)).map(s => `${s.run} (${s.file})`);
}

/** The words of the "standard" consent preset, read from the agent editor's scope model. */
function standardPreset(): string[] {
  const file = join(ROOT, 'public', 'views', 'profile', 'agents', 'scope-model.js');
  if (!existsSync(file)) return [];
  const line = readFileSync(file, 'utf-8').match(/\bstandard:\s*\[([^\]]*)\]/);
  return line ? [...line[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
}

/** The snapshot as text: one line per tool and per route, so two changes to different keys merge. */
function serialize(s: ScopeWordSnapshot): string {
  const map = (m: Record<string, unknown>): string => {
    const lines = Object.keys(m).map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(m[k])}`);
    return lines.length ? `{\n${lines.join(',\n')}\n  }` : '{}';
  };
  return `{\n  "note": ${JSON.stringify(s.note)},\n  "steps": ${JSON.stringify(s.steps)},\n  "accepted": ${map(s.accepted)},\n`
    + `  "tools": ${map(s.tools)},\n  "routes": ${map(s.routes)}\n}\n`;
}

function main(): void {
  const update = process.argv.includes('--update');
  const tools = currentTools();
  const routes = currentRoutes();
  const snapshot: ScopeWordSnapshot = existsSync(SNAPSHOT)
    ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) as ScopeWordSnapshot
    : { note: NOTE, steps: [], accepted: {}, tools: {}, routes: {} };

  const notRun = stepsNotRunAtBoot();
  const additions: Addition[] = [...addedWords('tool', snapshot.tools, tools), ...addedWords('route', snapshot.routes, routes)];
  const answered = additions.map(a => ({ a, by: answerAddition(a, SCOPE_KEEP_STEPS, snapshot) }));
  const open = answered.filter(x => x.by === null).map(x => x.a);

  if (notRun.length > 0) {
    console.error(`✗ scope words: ${notRun.length} keep-working step(s) in scripts/lib/scope-keep-steps.ts are called by no file in src/server-bootstrap/:`);
    for (const s of notRun) console.error(`    ${s}`);
    console.error('  A step that never runs hands nothing to anyone. Call it from server-bootstrap/once-only-keep-steps.ts.');
  }
  if (open.length > 0) {
    console.error(`✗ scope words: ${open.length} word(s) added to an existing MCP tool or REST route with nothing that keeps the principals approved before it working:`);
    for (const a of open) console.error(`    ${a.surface} ${a.key}: + ${a.word}`);
    console.error(`
  The node MCP offers a tool only to a session that holds every word on it, so a new word REMOVES the
  tool from every agent approved without it; a new word on a route answers 403 to every grant made
  before it. On 2026-10-06 organism:read on the workspace read tools took workspace read from every
  agent on aimeat.io at the deploy, with every test green. Answer each word with one of:
    - a keep-working step, as services/tool-scope-words-migration.ts and
      services/rest-scope-keep-working-migration.ts do: claimed once per node (services/once-only-step.ts),
      on positive evidence only, never a word that opens more than the reach the principal had, run from
      server-bootstrap/once-only-keep-steps.ts; list it with its words in scripts/lib/scope-keep-steps.ts;
    - or, for a narrowing that is meant, an entry under "accepted" in security/scope-word-snapshot.json:
      "<tool or route> <word>": "<why>".
  Do not fix a test by giving its agent the new word: that is the one fix a real agent never gets.
  Then run: pnpm check:scope-words --update`);
  }

  const defaults = SHIPPED_DEFAULT_AGENT_SCOPES.split(',').map(s => s.trim());
  const standard = standardPreset();
  for (const { a } of answered.filter(x => x.by !== null)) {
    const lacks = [defaults.includes(a.word) ? '' : 'the default agent scopes', standard.includes(a.word) ? '' : 'the standard consent preset'].filter(Boolean);
    if (lacks.length) console.log(`  note: ${a.word} (${a.key}) is not in ${lacks.join(' or ')}: an agent approved tomorrow with them will not have it.`);
  }
  if (notRun.length > 0 || open.length > 0) process.exit(1);

  const next: ScopeWordSnapshot = {
    note: NOTE,
    steps: [...new Set([...snapshot.steps, ...SCOPE_KEEP_STEPS.map(s => s.key)])].sort(),
    accepted: snapshot.accepted,
    tools,
    routes,
  };
  const text = serialize(next);
  const stored = existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT, 'utf-8').replace(/\r\n/g, '\n') : '';
  if (text === stored) {
    console.log(`✓ scope words: ${Object.keys(tools).length} tools and ${Object.keys(routes).length} routes as the snapshot has them; ${additions.length} added word(s), each answered`);
    return;
  }
  if (update) {
    writeFileSync(SNAPSHOT, text);
    console.log(`✓ scope words: snapshot written (${Object.keys(tools).length} tools, ${Object.keys(routes).length} routes, ${additions.length} added word(s) answered)`);
    return;
  }
  console.error('✗ scope words: the tools, routes or keep-working steps changed and security/scope-word-snapshot.json does not have it yet.');
  console.error('  Nothing in the change narrows an existing tool or route without an answer. Run: pnpm check:scope-words --update, and commit the snapshot.');
  process.exit(1);
}

main();
