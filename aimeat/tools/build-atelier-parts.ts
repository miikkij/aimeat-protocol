/**
 * @file tools/build-atelier-parts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE PARTS LIST IS READ OUT OF THE SOURCE, never typed twice. Each Atelier
 *   component module declares, in its own file JSDoc, what a builder may change without forking
 *   it — `@parts`, `@slots`, `@variants`, `@tokens` and `@fork`, one line per component — and this
 *   tool reads those lines into src/static/sdk-libs/atelier/describe-data.js, which is what
 *   `AIMEAT.atelier.describe(name)` answers with and what the Design Book's "make it yours" line
 *   shows.
 *
 *   That indirection is the whole point. A hand-kept list beside the code is a list that goes
 *   stale, and the Design Book already lost a session to exactly that: its guard warned visitors
 *   about seven components that were on the wall in front of them. `--check` fails when the
 *   generated file no longer matches the sources, so the drift is a refused commit rather than a
 *   wrong answer served to an AI builder.
 *
 *   THE LINE FORMAT, one per component per tag:
 *     @parts    <component> <part> · <part> · …     every element the kit builds, by name
 *     @slots    <component> <name>(<args>) · …      what `parts: { … }` accepts
 *     @variants <component> <name> · …              what `variant:` accepts (default is implied)
 *     @tokens   <component> --ak-… · …              the properties an app may set on its own box
 *     @fork     <component> <one sentence>          what copying it out costs
 *     @use      <component> <use> · <use> · …        what the component is for, from USES below
 *
 *   `@use` is what lets a builder choose a component by what a screen is for instead of reading
 *   the whole list. Its words are a closed list, the same words the node's own component catalogue
 *   uses (src/services/ui-library) plus two an app needs: a word outside the list fails the build,
 *   because a use nobody else can ask for selects nothing.
 *
 *   A SECOND OUTPUT, FOR A BUILDER WITH NO BROWSER. describe() answers in a browser. A builder
 *   working over MCP from a terminal has none, and five measured builds on 2026-11-27 each
 *   downloaded the kit's bundle and searched it for `function form(spec)` and its like, 110 calls
 *   in all. readReference() takes the JSDoc above each component's function, with the types it
 *   names, into src/services/builder/atelier-kit-reference.generated.ts, which the node serves as
 *   the specification's sections `kit` and `kit-<name>` (services/builder/atelier-kit.ts).
 * @structure USES · readTags() → per-component records · emit() → the generated module ·
 *   readReference() · emitReference() → the server-side module · main(): write or --check
 * @usage cd aimeat && pnpm exec tsx tools/build-atelier-parts.ts [--check]
 *   (or: pnpm build:atelier-parts / pnpm check:atelier-parts)
 * @version-history
 *   v1.2.0 — 2026-11-28 — readReference() and the second generated file: each component's call and
 *     options, for the specification's sections `kit` and `kit-<name>`.
 *   v1.1.0 — 2026-11-27 — `@use`, held to the closed list USES; the generated record carries
 *     `use` (wish-atelier-contextual-templates-pyynt-lohko-ask).
 *   v1.0.0 — 2026-09-05 — Initial (wish-atelier-always-excellent, part 3).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../src/static/sdk-libs/atelier/', import.meta.url));
const OUT = join(SRC, 'describe-data.js');
const OUT_REFERENCE = fileURLToPath(new URL('../src/services/builder/atelier-kit-reference.generated.ts', import.meta.url));

/** One component's answer to "what can I change without forking this". */
type Record_ = {
  id: string;
  parts: string[];
  slots: string[];
  variants: string[];
  tokens: string[];
  use: string[];
  fork: string;
  file: string;
};

const TAGS = ['parts', 'slots', 'variants', 'tokens', 'use'] as const;

/**
 * What a component is for. The first eighteen are the words of the node's own component
 * catalogue; `decorate` (an ornament, an ambient, an effect, a motion piece) and `play` (a game
 * part) are the two an app's kit adds.
 */
export const USES = [
  'layout', 'navigate', 'view', 'list', 'count', 'status', 'compare', 'search', 'open',
  'pick', 'edit', 'act', 'confirm', 'copy', 'converse', 'notify', 'wait', 'explain',
  'decorate', 'play',
] as const;

/** Read every `@<tag> <component> …` line out of the atelier sources. */
export function readTags(): Record_[] {
  const found = new Map<string, Record_>();
  const files = readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'describe-data.js').sort();
  for (const file of files) {
    const text = readFileSync(join(SRC, file), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/^\s*\*\s?/, '').trim();
      const m = /^@(parts|slots|variants|tokens|fork|use)\s+([A-Za-z][A-Za-z0-9]*)\s+(.+)$/.exec(line);
      if (!m) continue;
      const [, tag, id, rest] = m;
      let rec = found.get(id);
      if (!rec) {
        rec = { id, parts: [], slots: [], variants: [], tokens: [], use: [], fork: '', file };
        found.set(id, rec);
      }
      if (tag === 'fork') { rec.fork = rest.trim(); continue; }
      if (!(TAGS as readonly string[]).includes(tag)) continue;
      const items = rest.split('·').map((s) => s.trim()).filter(Boolean);
      if (tag === 'use') {
        const unknown = items.filter((u) => !(USES as readonly string[]).includes(u));
        if (unknown.length) {
          throw new Error(`${file}: @use ${id} names ${unknown.join(', ')}; the closed list is ${USES.join(', ')}`);
        }
      }
      rec[tag as (typeof TAGS)[number]] = items;
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The generated module: data only, no logic, so the kit's own describe() is the only reader. */
function emit(records: Record_[]): string {
  const body = records.map((r) => {
    const j = (v: string[]) => JSON.stringify(v);
    return `  ${JSON.stringify(r.id)}: {\n`
      + `    parts: ${j(r.parts)},\n`
      + `    slots: ${j(r.slots)},\n`
      + `    variants: ${j(r.variants)},\n`
      + `    tokens: ${j(r.tokens)},\n`
      + `    use: ${j(r.use)},\n`
      + `    fork: ${JSON.stringify(r.fork)},\n`
      + `    file: ${JSON.stringify(r.file)},\n`
      + `  },`;
  }).join('\n');
  return `/**
 * @file atelier/describe-data.js
 * @description GENERATED — do not edit. Every component's parts, slots, variants, tokens, uses and
 *   fork sentence, read out of the component modules' own JSDoc by tools/build-atelier-parts.ts.
 *   \`AIMEAT.atelier.describe(name)\` answers from this, so what an app reads at run time and what
 *   the source says are the same thing by construction. Run \`pnpm build:atelier-parts\` after
 *   changing an @parts / @slots / @variants / @tokens / @use / @fork line; \`pnpm
 *   check:atelier-parts\` refuses a commit where the two have drifted.
 * @structure PARTS: one entry per public component
 * @usage  import { PARTS } from './describe-data.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Generated (wish-atelier-always-excellent, part 3).
 */
export const PARTS = {
${body}
};
`;
}

// ── The reference a builder reads without a browser ──────────────────────────────────────────────

/** One component's call and the options it takes, as its own module documents them. */
type Reference = Record_ & { call: string; doc: string };

/**
 * A JSDoc block's text with the comment frame taken away. A type named through its module
 * (`import('./ambient.js').AmbientWish`) is left as its name: the path is the source's own, and a
 * builder calls the kit, not its modules.
 */
const unframe = (block: string): string => block.split(/\r?\n/)
  .map((l) => l.replace(/^\s*\*\s?/, '').replace(/\s+$/, '').replace(/import\((['"])[^'"]+\1\)\./g, ''))
  .join('\n').trim();

/**
 * The JSDoc block above `function <id>(` and the parameter list, from the component's own file
 * first and any other atelier module after it (a component's function can live beside its parts).
 * The `@typedef` blocks of that file whose names the block uses follow it, so `fields: FormField[]`
 * comes with what a FormField is.
 */
export function readReference(records: Record_[]): Reference[] {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'describe-data.js').sort();
  const text = new Map(files.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));
  // Every function the kit's public object carries, with the components describe() knows first:
  // a builder calls app(), mosaic() and toast() as often as a component that declares parts.
  const known = new Set(records.map((r) => r.id));
  const all: Record_[] = [
    ...records,
    ...publicNames(text.get('index.js') ?? '').filter((n) => !known.has(n))
      .map((id) => ({ id, parts: [], slots: [], variants: [], tokens: [], use: [], fork: '', file: '' })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  return all.map((r) => {
    const fn = new RegExp(String.raw`/\*\*((?:(?!\*/)[\s\S])*?)\*/\s*(?:export\s+)?(?:async\s+)?function\s+` + r.id.replace(/\$/g, String.raw`\$`) + String.raw`\s*\(([^)]*)\)`);
    for (const file of [...(r.file ? [r.file] : []), ...files.filter((f) => f !== r.file)]) {
      const m = fn.exec(text.get(file) ?? '');
      if (!m || !/@param|@returns/.test(m[1])) continue;
      let doc = unframe(m[1]);
      const typedefs = [...(text.get(file) ?? '').matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?@typedef\s+\{[^}]*\}\s+([A-Za-z][A-Za-z0-9]*)(?:(?!\*\/)[\s\S])*?)\*\//g)];
      for (const [, block, name] of typedefs) {
        if (new RegExp(String.raw`\b${name}\b`).test(doc)) doc += '\n\n' + unframe(block);
      }
      return { ...r, file: r.file || file, call: `${r.id}(${m[2].replace(/\s+/g, ' ').trim()})`, doc };
    }
    return { ...r, call: '', doc: '' };
    // A public name with no documented function and no parts has nothing to say: it is left out.
  }).filter((r) => r.doc || r.parts.length > 0);
}

/**
 * The functions the kit's public object carries: the names its object literal lists in shorthand
 * (`app, section, tabs, bottomNav,`), below the `version` member. Constants in capitals are data.
 */
function publicNames(index: string): string[] {
  const names = new Set<string>();
  const from = index.indexOf("version: '");
  if (from < 0) throw new Error('index.js: the public object\'s `version` member was not found; publicNames() reads the members below it');
  for (const line of index.slice(from).split(/\r?\n/)) {
    if (!/^\s{2}(?:[A-Za-z_$][\w$]*\s*,\s*)+$/.test(line)) continue;
    for (const n of line.split(',').map((s) => s.trim()).filter(Boolean)) if (!/^[A-Z0-9_]+$/.test(n)) names.add(n);
  }
  return [...names];
}

/** The generated server-side module: one line per component, so its size follows the kit and not the docs. */
function emitReference(refs: Reference[]): string {
  const body = refs.map((r) => `  ${JSON.stringify(r.id)}: ${JSON.stringify({ call: r.call, doc: r.doc, use: r.use, parts: r.parts, slots: r.slots, variants: r.variants, tokens: r.tokens, fork: r.fork, file: r.file })},`).join('\n');
  return `/**
 * @file src/services/builder/atelier-kit-reference.generated.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GENERATED — do not edit. Every Atelier kit component's call, the options it takes
 *   (the JSDoc above its function, with the types it names) and the parts, slots, variants, tokens,
 *   uses and fork sentence \`AIMEAT.atelier.describe(name)\` answers, read out of the component
 *   modules by tools/build-atelier-parts.ts. services/builder/atelier-kit.ts serves it as the
 *   specification's sections \`kit\` and \`kit-<name>\`, for a builder that has no browser to ask the
 *   library in. Run \`pnpm build:atelier-parts\` after changing a component's JSDoc; \`pnpm
 *   check:atelier-parts\` refuses a commit where the two have drifted.
 * @structure KIT_REFERENCE: one entry per public component
 * @version-history
 *   v1.0.0 — 2026-11-28 — Generated (wish-atelier-kirjaston-osan-asetukset-saa-yhdell-kutsulla-ilman-s).
 */
export interface KitReference {
  call: string; doc: string; use: string[]; parts: string[]; slots: string[]; variants: string[]; tokens: string[]; fork: string; file: string;
}

export const KIT_REFERENCE: Record<string, KitReference> = {
${body}
};
`;
}

const records = readTags();
const want = emit(records);
const wantReference = emitReference(readReference(records));
const same = (a: string, b: string): boolean => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
const read = (path: string): string => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
if (process.argv.includes('--check')) {
  if (!same(read(OUT), want)) {
    console.error('\n✖ src/static/sdk-libs/atelier/describe-data.js drifts from the modules\' @parts/@slots/@variants/@tokens lines — run `pnpm build:atelier-parts` and commit the result.\n');
    process.exit(1);
  }
  if (!same(read(OUT_REFERENCE), wantReference)) {
    console.error('\n✖ src/services/builder/atelier-kit-reference.generated.ts drifts from the component modules\' JSDoc — run `pnpm build:atelier-parts` and commit the result.\n');
    process.exit(1);
  }
  console.log(`  ok   describe-data.js and atelier-kit-reference.generated.ts match the source (${records.length} components)`);
} else {
  writeFileSync(OUT, want, 'utf8');
  writeFileSync(OUT_REFERENCE, wantReference, 'utf8');
  console.log(`  wrote describe-data.js and atelier-kit-reference.generated.ts (${records.length} components)`);
}
