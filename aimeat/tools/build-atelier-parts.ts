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
 * @structure readTags() → per-component records · emit() → the generated module · main(): write
 *   or --check
 * @usage cd aimeat && pnpm exec tsx tools/build-atelier-parts.ts [--check]
 *   (or: pnpm build:atelier-parts / pnpm check:atelier-parts)
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (wish-atelier-always-excellent, part 3).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../src/static/sdk-libs/atelier/', import.meta.url));
const OUT = join(SRC, 'describe-data.js');

/** One component's answer to "what can I change without forking this". */
type Record_ = {
  id: string;
  parts: string[];
  slots: string[];
  variants: string[];
  tokens: string[];
  fork: string;
  file: string;
};

const TAGS = ['parts', 'slots', 'variants', 'tokens'] as const;

/** Read every `@<tag> <component> …` line out of the atelier sources. */
export function readTags(): Record_[] {
  const found = new Map<string, Record_>();
  const files = readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'describe-data.js').sort();
  for (const file of files) {
    const text = readFileSync(join(SRC, file), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/^\s*\*\s?/, '').trim();
      const m = /^@(parts|slots|variants|tokens|fork)\s+([A-Za-z][A-Za-z0-9]*)\s+(.+)$/.exec(line);
      if (!m) continue;
      const [, tag, id, rest] = m;
      let rec = found.get(id);
      if (!rec) {
        rec = { id, parts: [], slots: [], variants: [], tokens: [], fork: '', file };
        found.set(id, rec);
      }
      if (tag === 'fork') { rec.fork = rest.trim(); continue; }
      const items = rest.split('·').map((s) => s.trim()).filter(Boolean);
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
      + `    fork: ${JSON.stringify(r.fork)},\n`
      + `    file: ${JSON.stringify(r.file)},\n`
      + `  },`;
  }).join('\n');
  return `/**
 * @file atelier/describe-data.js
 * @description GENERATED — do not edit. Every component's parts, slots, variants, tokens and
 *   fork sentence, read out of the component modules' own JSDoc by tools/build-atelier-parts.ts.
 *   \`AIMEAT.atelier.describe(name)\` answers from this, so what an app reads at run time and what
 *   the source says are the same thing by construction. Run \`pnpm build:atelier-parts\` after
 *   changing an @parts / @slots / @variants / @tokens / @fork line; \`pnpm check:atelier-parts\`
 *   refuses a commit where the two have drifted.
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

const want = emit(readTags());
if (process.argv.includes('--check')) {
  let have = '';
  try { have = readFileSync(OUT, 'utf8'); } catch { have = ''; }
  if (have.replace(/\r\n/g, '\n') !== want.replace(/\r\n/g, '\n')) {
    console.error('\n✖ src/static/sdk-libs/atelier/describe-data.js drifts from the modules\' @parts/@slots/@variants/@tokens lines — run `pnpm build:atelier-parts` and commit the result.\n');
    process.exit(1);
  }
  const n = readTags().length;
  console.log(`  ok   describe-data.js matches the source (${n} components)`);
} else {
  writeFileSync(OUT, want, 'utf8');
  console.log(`  wrote describe-data.js (${readTags().length} components)`);
}
