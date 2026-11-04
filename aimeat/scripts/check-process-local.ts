/**
 * @file scripts/check-process-local.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description State that lives in one node process, and timers that run in every process, may only
 *   become fewer unless each new one says what breaks when a second process runs.
 *
 *   WHY. The supported shape is one active process and a standby (IT adoption page 18, ruled
 *   2026-11-04). A standby that takes over, or a second process later, sees none of the first one's
 *   memory: a Map that holds sign-in steps, a cache of a registry an operator changes, a timer that
 *   sends mail. The codebase analysis of 2026-11-03 counted module-level `new Map` declarations in
 *   aimeat/src going from 103 to 160 in four weeks, with nothing asking whether each one was safe
 *   with two processes; nine of the per-process states it found were on no list, and three of them
 *   were security properties (an emergency de-peering, a closed internet opening, maintenance mode).
 *
 *   WHAT IT READS. Every .ts file under aimeat/src except src/cli (the connector, a process of its
 *   own), src/static and src/generated, through the TypeScript parser:
 *   - `map`/`set`: a module-level `new Map(...)` or `new Set(...)`. A constant lookup table is not
 *     state and is skipped: a `const` whose argument is an array of literals (or of arrays of
 *     literals).
 *   - `let`: a module-level `let`: a value the process changes while it runs.
 *   - `interval`: a `setInterval(` call anywhere in the file, keyed by the function it is in.
 *   An item is named `<file> :: <kind> :: <name>`, and a file's count per name is what the baseline
 *   holds, so moving a line does not change it.
 *
 *   THE RULE. The baseline is security/process-local-baseline.json, seeded 2026-11-04 from the code of
 *   that day: each entry holds a count and the reason it is per process. Seeded entries say DEBT,
 *   which is "known, not judged yet". A count above the baseline fails: put
 *   `// process-local: <what breaks with a second process>` on the line or the line above, and add the
 *   entry with that reason. A count below the baseline fails too, until the baseline is lowered, so
 *   the list only shrinks. The list is the input to page 18's table of what stays per process.
 * @structure collect(root) · compare(found, baseline) · main()
 * @usage
 *   cd aimeat && pnpm check:process-local          # the gate (in check:fast)
 *   cd aimeat && pnpm check:process-local --list   # every item found, and nothing is judged
 *   cd aimeat && pnpm check:process-local --seed   # rewrite the baseline from today's code (ask first)
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, high-availability report section 8).
 */
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASELINE = 'security/process-local-baseline.json';
const SKIP_DIRS = new Set(['cli', 'static', 'generated']);
const MARKER = /\/\/\s*process-local:\s*\S/;

export type Kind = 'map' | 'set' | 'let' | 'interval';

export interface Item { file: string; kind: Kind; name: string; line: number; marked: boolean }

export interface Baseline {
  note: string;
  /** `<file> :: <kind> :: <name>` → { count, reason } */
  entries: Record<string, { count: number; reason: string }>;
}

/** Whether an expression is a literal a lookup table is made of. */
function isLiteral(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isArrayLiteralExpression(node) && node.elements.every((e) => isLiteral(e as ts.Expression)))
    || (ts.isAsExpression(node) && isLiteral(node.expression));
}

/** `const X = new Set([...literals])` or `new Map([[k, v], ...])` of literals: a constant table. */
function isConstantTable(init: ts.NewExpression, isConst: boolean): boolean {
  if (!isConst) return false;
  const arg = init.arguments?.[0];
  if (!arg) return false;
  const inner = ts.isAsExpression(arg) ? arg.expression : arg;
  return ts.isArrayLiteralExpression(inner) && inner.elements.every((e) => isLiteral(e as ts.Expression));
}

/** The name of the function a node is in, or `<module>`. */
function enclosingName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
    if (ts.isClassDeclaration(n) && n.name) return `${n.name.text}.<class>`;
  }
  return '<module>';
}

function marked(source: ts.SourceFile, node: ts.Node, lines: string[]): boolean {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  return MARKER.test(lines[line] ?? '') || MARKER.test(lines[line - 1] ?? '');
}

/** Every item in one file. */
export function itemsOf(file: string, text: string): Item[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = text.split('\n');
  const out: Item[] = [];
  const at = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0;
    for (const decl of stmt.declarationList.declarations) {
      const name = decl.name.getText(source);
      if (isLet) { out.push({ file, kind: 'let', name, line: at(decl), marked: marked(source, stmt, lines) }); continue; }
      let init = decl.initializer;
      while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
      if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression)) continue;
      const ctor = init.expression.text;
      if (ctor !== 'Map' && ctor !== 'Set') continue;
      if (isConstantTable(init, isConst)) continue;
      out.push({ file, kind: ctor === 'Map' ? 'map' : 'set', name, line: at(decl), marked: marked(source, stmt, lines) });
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'setInterval') {
      out.push({ file, kind: 'interval', name: enclosingName(node), line: at(node), marked: marked(source, node, lines) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Every item under src/, with posix paths relative to aimeat/. */
export function collect(root: string): Item[] {
  const items: Item[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (dir === path.join(root, 'src') && SKIP_DIRS.has(name)) continue;
        walk(full);
      } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        items.push(...itemsOf(rel, readFileSync(full, 'utf8')));
      }
    }
  };
  walk(path.join(root, 'src'));
  return items;
}

export const keyOf = (i: Pick<Item, 'file' | 'kind' | 'name'>) => `${i.file} :: ${i.kind} :: ${i.name}`;

export function counts(items: Item[]): Map<string, Item[]> {
  const by = new Map<string, Item[]>();
  for (const i of items) by.set(keyOf(i), [...(by.get(keyOf(i)) ?? []), i]);
  return by;
}

/** The refusals: counts above the baseline (new state), and counts below it (a baseline to lower). */
export function compare(found: Map<string, Item[]>, baseline: Baseline): { added: string[]; fallen: string[] } {
  const added: string[] = [];
  const fallen: string[] = [];
  for (const [key, items] of found) {
    const allowed = baseline.entries[key]?.count ?? 0;
    if (items.length > allowed) {
      const lines = items.map((i) => `${i.line}${i.marked ? ' (marked)' : ''}`).join(', ');
      added.push(`${key}: ${items.length} found, ${allowed} in the baseline (lines ${lines})`);
    }
  }
  for (const [key, entry] of Object.entries(baseline.entries)) {
    const now = found.get(key)?.length ?? 0;
    if (now < entry.count) fallen.push(`${key}: ${entry.count} in the baseline, ${now} found`);
  }
  return { added, fallen };
}

function main(): void {
  const root = process.cwd();
  const items = collect(root);
  const found = counts(items);
  if (process.argv.includes('--list')) {
    for (const [key, list] of [...found].sort(([a], [b]) => a.localeCompare(b))) console.log(`${key}  x${list.length}`);
    const byKind = items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {});
    console.log(`\n${items.length} items: ${JSON.stringify(byKind)}`);
    return;
  }
  if (process.argv.includes('--seed')) {
    const old: Baseline | null = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline : null;
    const entries: Baseline['entries'] = {};
    for (const [key, list] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
      entries[key] = { count: list.length, reason: old?.entries[key]?.reason ?? 'DEBT' };
    }
    const note = old?.note ?? 'Process-local state and timers in aimeat/src (scripts/check-process-local.ts). Seeded 2026-11-04 from the code of that day (codebase analysis 2026-11-03, HA stage 1). Each entry is a count per file, kind and name, and the reason it is per process; DEBT means known, not judged yet. A count may only fall: a new one needs a `// process-local: <what breaks with a second process>` marker and an entry here with that reason, and a fallen count is lowered here.';
    writeFileSync(BASELINE, `${JSON.stringify({ note, entries }, null, 2)}\n`);
    console.log(`seeded ${BASELINE}: ${Object.keys(entries).length} entries, ${items.length} items`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  const { added, fallen } = compare(found, baseline);
  if (added.length === 0 && fallen.length === 0) {
    console.log(`✓ process-local state and timers: ${items.length} items in ${found.size} entries, none new, none gone unrecorded`);
    return;
  }
  if (added.length) {
    console.error(`✗ ${added.length} new piece(s) of process-local state or timers:`);
    for (const a of added) console.error(`    ${a}`);
    console.error('  A standby or a second process does not see this. Keep it in storage, or say what breaks with a');
    console.error('  second process: put `// process-local: <what breaks>` on the line or the line above, and add the');
    console.error(`  entry with that reason and its new count to ${BASELINE}.`);
  }
  if (fallen.length) {
    console.error(`✗ ${fallen.length} baseline entr(y/ies) above what the code holds; lower them in ${BASELINE}:`);
    for (const f of fallen) console.error(`    ${f}`);
  }
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, '') === path.resolve(path.join('scripts', 'check-process-local')).replace(/\.ts$/, '')) main();
