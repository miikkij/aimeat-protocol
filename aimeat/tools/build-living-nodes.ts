/**
 * @file tools/build-living-nodes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE NODE VOCABULARY IS READ OUT OF THE SOURCE, never typed twice. Each node-type
 *   module under src/static/sdk-libs/living/nodes/ declares, in its own file JSDoc, what that type
 *   takes, what it answers with, what it may be given and one worked example — `@node`, `@inputs`,
 *   `@outputs`, `@options`, `@example`, one line each — and this tool reads those lines into
 *   src/static/sdk-libs/living/describe-data.js, which is what `AIMEAT.living.describe(type)`
 *   answers with.
 *
 *   THAT INDIRECTION IS THE POINT, and the Atelier kit's parts list (tools/build-atelier-parts.ts)
 *   is the same mechanism for the same reason: a hand-kept list beside the code is a list that
 *   goes stale, and this one is read by an AI that is about to WRITE a document with it. A wrong
 *   answer here is a document that does not run. `--check` fails when the generated file no longer
 *   matches the sources, so the drift is a refused commit rather than a wrong answer served.
 *
 *   THE LINE FORMAT, one per type per tag:
 *     @node       <type> <one sentence: what this kind of node is>
 *     @inputs     <type> <what it reads> · <…>
 *     @outputs    <type> <what it answers with> · <…>
 *     @options    <type> <the fields it may carry> · <…>
 *     @languages  <type> <the fields that may be a language map instead of a string> · <…>
 *     @example    <type> <one line of JSON — parsed by this tool, so it cannot be wrong>
 * @structure readTags() → per-type records · emit() → the generated module · main(): write or --check
 * @usage cd aimeat && pnpm exec tsx tools/build-living-nodes.ts [--check]
 *   (or: pnpm build:living-nodes / pnpm check:living-nodes)
 * @version-history
 *   v1.1.0 — 2026-09-06 — `@languages`: which of a node's fields may be written as a language map.
 *     It is generated for the same reason the rest is — the AI writing a bilingual record asks the
 *     library which fields take two languages, and a hand-kept answer would go stale on the next
 *     node type.
 *   v1.0.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../src/static/sdk-libs/living/', import.meta.url));
const NODES_DIR = join(SRC, 'nodes');
const OUT = join(SRC, 'describe-data.js');

/** One node type's answer to "what is this, and how do I write one". */
type Record_ = {
  id: string;
  summary: string;
  inputs: string[];
  outputs: string[];
  options: string[];
  /** The fields this type may carry as `{ fi: …, en: … }` instead of a plain string. */
  languages: string[];
  example: unknown;
  file: string;
};

/** Read every `@<tag> <type> …` line out of the node-type modules. */
export function readTags(): Record_[] {
  const found = new Map<string, Record_>();
  const files = readdirSync(NODES_DIR).filter(f => f.endsWith('.js') && f !== 'index.js').sort();
  for (const file of files) {
    const text = readFileSync(join(NODES_DIR, file), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/^\s*\*\s?/, '').trim();
      const m = /^@(node|inputs|outputs|options|languages|example)\s+([a-z][A-Za-z0-9]*)\s+(.+)$/.exec(line);
      if (!m) continue;
      const [, tag, id, rest] = m;
      let rec = found.get(id);
      if (!rec) {
        rec = {
          id, summary: '', inputs: [], outputs: [], options: [], languages: [],
          example: null, file: 'nodes/' + file,
        };
        found.set(id, rec);
      }
      if (tag === 'node') { rec.summary = rest.trim(); continue; }
      if (tag === 'example') {
        try {
          rec.example = JSON.parse(rest.trim());
        } catch (e) {
          console.error(`\n✖ nodes/${file}: the @example for "${id}" is not valid JSON — ${(e as Error).message}\n`);
          process.exit(1);
        }
        continue;
      }
      // "none" is a type saying out loud that it has no such field, which is an answer worth
      // having in the source and an empty list worth having in the generated data.
      const parts = /^none\b/i.test(rest.trim())
        ? []
        : rest.split('·').map(s => s.trim()).filter(Boolean);
      rec[tag as 'inputs' | 'outputs' | 'options' | 'languages'] = parts;
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The generated module: data only, so the library's own describe() is the single reader. */
function emit(records: Record_[]): string {
  const body = records.map(r => (
    `  ${JSON.stringify(r.id)}: {\n`
    + `    summary: ${JSON.stringify(r.summary)},\n`
    + `    inputs: ${JSON.stringify(r.inputs)},\n`
    + `    outputs: ${JSON.stringify(r.outputs)},\n`
    + `    options: ${JSON.stringify(r.options)},\n`
    + `    languages: ${JSON.stringify(r.languages)},\n`
    + `    example: ${JSON.stringify(r.example)},\n`
    + `    file: ${JSON.stringify(r.file)},\n`
    + `  },`
  )).join('\n');
  return `/**
 * @file living/describe-data.js
 * @description GENERATED — do not edit. Every node type's summary, inputs, outputs, options,
 *   language-map fields and worked example, read out of the node modules' own JSDoc by
 *   tools/build-living-nodes.ts.
 *   \`AIMEAT.living.describe(type)\` answers from this, so what an AI reads at run time and what
 *   the source says are the same thing by construction. Run \`pnpm build:living-nodes\` after
 *   changing an @node / @inputs / @outputs / @options / @languages / @example line;
 *   \`pnpm check:living-nodes\` refuses a commit where the two have drifted.
 * @structure NODES: one entry per node type
 * @usage  import { NODES } from './describe-data.js';
 * @version-history
 *   v1.1.0 — 2026-09-06 — Generated: \`languages\` joins each entry.
 *   v1.0.0 — 2026-09-05 — Generated (the living document, stage 1).
 */
export const NODES = {
${body}
};
`;
}

/** Write the generated module, or (with --check) refuse when it has drifted from the sources. */
export function main(): void {
  const want = emit(readTags());
  if (process.argv.includes('--check')) {
    let have = '';
    try { have = readFileSync(OUT, 'utf8'); } catch { have = ''; }
    if (have.replace(/\r\n/g, '\n') !== want.replace(/\r\n/g, '\n')) {
      console.error('\n✖ src/static/sdk-libs/living/describe-data.js drifts from the node modules\' @node/@inputs/@outputs/@options/@example lines — run `pnpm build:living-nodes` and commit the result.\n');
      process.exit(1);
    }
    console.log(`  ok   describe-data.js matches the source (${readTags().length} node types)`);
    return;
  }
  writeFileSync(OUT, want, 'utf8');
  console.log(`  wrote describe-data.js (${readTags().length} node types)`);
}

// Only when this file IS the command. The drift test imports readTags() to compare the generated
// module against the sources, and an import that rewrote the file it is checking would prove
// nothing — it would make itself pass.
if (process.argv[1] && /build-living-nodes\.[tj]s$/.test(process.argv[1])) main();
