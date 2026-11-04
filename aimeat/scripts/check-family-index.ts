/**
 * @file scripts/check-family-index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps a service family's index free of import cycles for whoever imports it.
 *
 *   WHY. An index (`services/<family>/index.ts`) re-exports a family's files so that the rest of
 *   the code imports one path. It is safe only while no file it exports reaches, through run-time
 *   imports, a module outside the family that itself imports the family: that module, importing
 *   the index, would close a cycle, and a run-time cycle loads in an order in which a top-level
 *   read can meet a const that is not set yet. An index over the whole classification family was
 *   tried in October 2026 and reverted after it made 54 cycles; the four files that act on the rest
 *   of the node (the classifier, the scan, the audience settle and the switch) moved to
 *   services/classification-run/ on 2026-11-04 and the other 31 got the index. check:deps sees a
 *   cycle only once a module imports the index, so this check holds the rule before that happens.
 *
 *   WHAT IT DOES. For each index in FAMILIES it reads the files the index re-exports, follows their
 *   run-time imports (static imports and re-exports that are not type-only, and dynamic imports)
 *   through src/, and refuses when a module it reaches outside the family imports the family at
 *   run time, or when a family file imports its own index. The refusal prints the import path from
 *   the index to that module. Only the modules reached are parsed, so the check is fast.
 *
 *   WHAT TO DO ON A REFUSAL. Move the family file that reaches out to the family's `-run` folder
 *   (services/classification-run/ for classification) and have it import the family through the
 *   index, or remove the outward import.
 * @structure FAMILIES · importsOf(file) · resolveSpec(from, spec) · checkFamily(index) · main()
 * @usage
 *   cd aimeat && pnpm check:family-index
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item D-g).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The indexes this check holds, relative to aimeat/. The family is the index's own folder. */
const FAMILIES = ['src/services/classification/index.ts'];

interface Edge { to: string; runtime: boolean; reexport: boolean }

const rel = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/');

/** Resolves a relative specifier the way tsc's NodeNext does for this repo: .js to .ts, a folder to its index. */
function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base.replace(/\.js$/, '.ts'), base.replace(/\.mjs$/, '.mts'), base, `${base}.ts`, path.join(base, 'index.ts')];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

const cache = new Map<string, Edge[]>();

/** The relative imports and re-exports of one file, each marked run-time or type-only. */
function importsOf(file: string): Edge[] {
  const hit = cache.get(file);
  if (hit) return hit;
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const edges: Edge[] = [];
  const add = (spec: string, runtime: boolean, reexport: boolean): void => {
    const to = resolveSpec(file, spec);
    if (to) edges.push({ to, runtime, reexport });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      let typeOnly = !!clause?.isTypeOnly;
      if (clause && !typeOnly && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const els = clause.namedBindings.elements;
        typeOnly = els.length > 0 && els.every(e => e.isTypeOnly);
      }
      add(node.moduleSpecifier.text, !typeOnly, false);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      let typeOnly = node.isTypeOnly;
      if (!typeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
        const els = node.exportClause.elements;
        typeOnly = els.length > 0 && els.every(e => e.isTypeOnly);
      }
      add(node.moduleSpecifier.text, !typeOnly, true);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteralLike(arg)) add(arg.text, true, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  cache.set(file, edges);
  return edges;
}

/** The refusals for one index, each with the import path that leads to it. */
function checkFamily(indexRel: string): { problems: string[]; exported: number; reached: number } {
  const index = path.join(ROOT, indexRel);
  const famDir = path.dirname(index) + path.sep;
  const inFamily = (f: string): boolean => f.startsWith(famDir) && !f.slice(famDir.length).includes(path.sep);
  const problems: string[] = [];
  if (!existsSync(index)) return { problems: [`${indexRel} does not exist`], exported: 0, reached: 0 };

  const exported = importsOf(index).filter(e => e.reexport && e.runtime).map(e => e.to);
  for (const f of exported) if (!inFamily(f)) problems.push(`${indexRel} re-exports ${rel(f)}, which is outside its folder`);

  // Breadth-first over run-time edges from the exported files, remembering how each module was reached.
  const parent = new Map<string, string>();
  const queue = [...exported];
  for (const f of exported) parent.set(f, index);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of importsOf(cur)) {
      if (!e.runtime) continue;
      if (e.to === index && inFamily(cur)) problems.push(`${rel(cur)} imports its own family's index; import the file by name`);
      if (parent.has(e.to) || e.to === index) continue;
      parent.set(e.to, cur);
      queue.push(e.to);
    }
  }
  const chain = (f: string): string => {
    const out = [rel(f)];
    for (let p = parent.get(f); p; p = parent.get(p)) { out.unshift(rel(p)); if (p === index) break; }
    return out.join(' → ');
  };
  let reached = 0;
  for (const m of parent.keys()) {
    if (inFamily(m)) continue;
    reached++;
    const back = importsOf(m).find(e => e.runtime && inFamily(e.to));
    if (back) problems.push(`${chain(m)} → ${rel(back.to)}: ${rel(m)} imports the family, so it could not import the index without a cycle`);
  }
  return { problems, exported: exported.length, reached };
}

function main(): void {
  let failed = false;
  for (const idx of FAMILIES) {
    const { problems, exported, reached } = checkFamily(idx);
    if (problems.length === 0) {
      console.log(`✓ ${idx}: ${exported} files exported, ${reached} modules reached outside the family, none imports the family back`);
      continue;
    }
    failed = true;
    console.error(`✗ ${idx}: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  ${p}`);
  }
  if (failed) {
    console.error('\nA file the index exports reaches a module that imports the family, so that module cannot use the index.');
    console.error('Move the file that reaches out to the family\'s -run folder (services/classification-run/ for classification)');
    console.error('and have it import the family through the index, or remove the outward import.');
    process.exit(1);
  }
}

main();
