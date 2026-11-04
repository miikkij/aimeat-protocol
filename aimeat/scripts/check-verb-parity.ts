/**
 * @file scripts/check-verb-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The writing verbs of one route path name the same guards, or the difference has a
 *   written reason (codebase analysis 2026-11-03, security-architecture finding 12, proposal 7).
 *
 *   WHY. A route gate asks each verb whether it has A guard; nothing asked whether the verbs of one
 *   resource agree. d1f37bb4a is that class: PUT /v1/admin/config refused an AI a setting it may only
 *   make stricter, and DELETE /v1/admin/config/:path reset the same setting for the same AI. Many
 *   differences are designed (DELETE of a memory record adds memory:purge, invariant 8), and nothing
 *   recorded which ones.
 *
 *   WHAT IT READS. Every `.ts` file under src/routes/, parsed with the TypeScript compiler. A route is
 *   a call `<x>.post|put|patch|delete(<path>, ...middleware, handler)` whose first argument is a
 *   literal path. Its guards are the middleware arguments between the path and the handler, each as
 *   its source text with the white space taken out, leaving out a body check (validateBody) and a rate
 *   limit, which are not about who may call; a middleware array constant of the same file
 *   (`const opOnly = [requireAuth(), requireOperator(storage)]`, spread or not) counts as its
 *   elements, and a file-wide `router.use(...)` with no path counts on every route of that file.
 *   Paths are compared with their parameter names taken out (`/v1/x/:id` and `/v1/x/:name` are one
 *   path). A check made inside the handler is not seen; the reason for such a difference says so.
 *
 *   THE BASELINE. security/verb-parity-baseline.json: per path whose writing verbs name different
 *   guards, each verb's guard list as this script read it and the sentence that says why the
 *   difference is right. The gate fails on a path that differs and has no entry, on an entry whose
 *   guards no longer match the code (the reason was written for other guards; read it again), and on
 *   an entry whose path no longer differs (remove it: the count only falls). `--seed` writes today's
 *   differences, keeping every reason already written; a new entry reads UNTRIAGED, which is a
 *   backlog, not an answer (a reason that starts with UNTRIAGED says what is known and is still one).
 * @structure Route · routesOf(file) · differences() · main()
 * @usage
 *   cd aimeat && pnpm check:verb-parity            # the gate
 *   cd aimeat && pnpm check:verb-parity --list     # every path with two writing verbs, and its guards
 *   cd aimeat && pnpm check:verb-parity --seed     # write today's differences into the baseline
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B4).
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = path.join(ROOT, 'src', 'routes');
const BASELINE = path.join(ROOT, 'security', 'verb-parity-baseline.json');
const WRITE_VERBS = new Set(['post', 'put', 'patch', 'delete']);

export interface Route { file: string; line: number; verb: string; path: string; guards: string[] }
interface Entry { verbs: Record<string, string[]>; why: string }
interface Baseline { note: string; paths: Record<string, Entry> }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * Middleware that is not a guard: a body or query check (a verb without a body has none to check) and
 * a rate limit. Who may make the call is what the verbs must agree on.
 */
const NOT_A_GUARD = /^(validate\w*\(|rateLimit\(|\w*(Limit|Limiter)(\(|$)|express\.(json|raw|text|urlencoded)\()/;

/** Source text with the white space out and one kind of quote, so formatting never makes a difference. */
const norm = (text: string): string => text.replace(/\s+/g, '').replace(/"/g, '\'');

/** A route path with its parameter names out: `/v1/x/:id?` reads `/v1/x/:?`. */
export const pathKey = (p: string): string => p.replace(/:[A-Za-z_$][\w$]*/g, ':');

const literalText = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** The routes one file registers with a writing verb, and their guards. */
export function routesOf(file: string, source = readFileSync(file, 'utf-8')): Route[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  // Middleware array constants of this file: `const auth = [requireAuth(), requireScope('x')]`.
  const arrays = new Map<string, string[]>();
  const fileWide: string[] = [];
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      arrays.set(node.name.text, node.initializer.elements.map(e => norm(e.getText(sf))));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const verb = node.expression.name.text;
      if (verb === 'use' && node.arguments.length > 0 && literalText(node.arguments[0]) === null) {
        fileWide.push(...node.arguments.map(a => norm(a.getText(sf))));
      } else if (WRITE_VERBS.has(verb) && literalText(node.arguments[0])?.startsWith('/')) {
        calls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const expand = (arg: ts.Expression): string[] => {
    const inner = ts.isSpreadElement(arg) ? arg.expression : arg;
    if (ts.isIdentifier(inner) && arrays.has(inner.text)) return arrays.get(inner.text)!;
    if (ts.isArrayLiteralExpression(inner)) return inner.elements.map(e => norm(e.getText(sf)));
    return [norm(arg.getText(sf))];
  };
  return calls.map((call) => {
    const args = call.arguments;
    const middle = args.slice(1, Math.max(1, args.length - 1));
    const guards = [...new Set([...fileWide, ...middle.flatMap(expand)])].filter(g => !NOT_A_GUARD.test(g)).sort();
    const { line } = sf.getLineAndCharacterOfPosition(call.getStart(sf));
    return { file: rel, line: line + 1, verb: (call.expression as ts.PropertyAccessExpression).name.text.toUpperCase(), path: literalText(args[0])!, guards };
  });
}

/** Every path with two or more writing verbs: its verbs' guard lists, and whether they differ. */
export function differences(files = walk(ROUTES)): { all: Map<string, Record<string, string[]>>; differ: Map<string, Record<string, string[]>> } {
  const byPath = new Map<string, Record<string, string[]>>();
  for (const file of files) {
    for (const r of routesOf(file)) {
      const key = pathKey(r.path);
      const verbs = byPath.get(key) ?? {};
      // The same verb on the same path in two places (two routers) with other guards: both lists,
      // the second after a marker naming its file (not its line, which moves with every edit).
      const prior = verbs[r.verb];
      verbs[r.verb] = !prior || prior.join(' ') === r.guards.join(' ') ? r.guards : [...prior, `| ${r.file}`, ...r.guards];
      byPath.set(key, verbs);
    }
  }
  const all = new Map([...byPath].filter(([, v]) => Object.keys(v).length >= 2).sort(([a], [b]) => a.localeCompare(b)));
  const differ = new Map([...all].filter(([, v]) => new Set(Object.values(v).map(g => g.join(' '))).size > 1));
  return { all, differ };
}

const sortVerbs = (v: Record<string, string[]>): Record<string, string[]> =>
  Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
const same = (a: Record<string, string[]>, b: Record<string, string[]>): boolean =>
  JSON.stringify(sortVerbs(a)) === JSON.stringify(sortVerbs(b));

function readBaseline(): Baseline {
  if (!existsSync(BASELINE)) return { note: '', paths: {} };
  return JSON.parse(readFileSync(BASELINE, 'utf-8')) as Baseline;
}

export function main(): boolean {
  const args = process.argv.slice(2);
  const { all, differ } = differences();
  const baseline = readBaseline();

  if (args.includes('--list')) {
    for (const [p, verbs] of all) {
      console.log(`\n${differ.has(p) ? '≠' : '='} ${p}`);
      for (const [verb, guards] of Object.entries(sortVerbs(verbs))) console.log(`    ${verb.padEnd(6)} ${guards.join('  ') || '(none)'}`);
    }
    console.log(`\n${all.size} paths with two or more writing verbs; ${differ.size} name different guards.`);
    return true;
  }

  if (args.includes('--seed')) {
    const paths: Record<string, Entry> = {};
    for (const [p, verbs] of differ) paths[p] = { verbs: sortVerbs(verbs), why: baseline.paths[p]?.why ?? 'UNTRIAGED' };
    const note = baseline.note || 'scripts/check-verb-parity.ts: per route path whose writing verbs name different guards, each verb\'s guards as the script reads them and why the difference is right. Seeded 2026-11-04 (codebase analysis 2026-11-03, B4); UNTRIAGED is the seeding\'s placeholder for a difference nobody has read yet. The list only shrinks.';
    writeFileSync(BASELINE, JSON.stringify({ note, paths }, null, 2) + '\n');
    console.log(`Seeded ${Object.keys(paths).length} paths into ${path.relative(ROOT, BASELINE)}.`);
    return true;
  }

  const problems: string[] = [];
  for (const [p, verbs] of differ) {
    const entry = baseline.paths[p];
    if (!entry) problems.push(`${p}: its writing verbs name different guards (${Object.entries(sortVerbs(verbs)).map(([v, g]) => `${v} ${g.join(' ') || '(none)'}`).join('; ')}). Give them the same guards, or add the path to security/verb-parity-baseline.json with the reason.`);
    else if (!same(entry.verbs, verbs)) problems.push(`${p}: the guards changed since its reason was written. Read the reason again and update the entry (pnpm check:verb-parity --list shows the guards now).`);
  }
  for (const p of Object.keys(baseline.paths)) {
    if (!differ.has(p)) problems.push(`${p}: listed in security/verb-parity-baseline.json and its verbs now agree (or the path is gone). Remove the entry.`);
  }
  if (problems.length > 0) {
    for (const line of problems) console.error(`✖ ${line}`);
    console.error(`\n${problems.length} problem(s). ${differ.size} of ${all.size} paths with two writing verbs differ.`);
    return false;
  }
  const untriaged = Object.values(baseline.paths).filter(e => e.why.startsWith('UNTRIAGED')).length;
  console.log(`✓ verb parity: ${differ.size} of ${all.size} paths with two writing verbs name different guards, each listed (${untriaged} untriaged)`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main() ? 0 : 1);
}
