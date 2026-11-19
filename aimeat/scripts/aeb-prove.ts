/**
 * @file aeb-prove.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AEB proof scaffolder — `pnpm aeb:prove <pack> [--model <id>] [--url <nodeUrl>]`.
 *   Turns the 4-step "add a proof" loop (tools/aeb/acceleration-tiers.md) into one command: it
 *   builds the controlled A/B build-prompt pair for a pack (A = capability packs stripped, B = the
 *   full prompt), pulls in the shared test set from tools/aeb/specs/, and writes a results-file stub
 *   for the run — so proving a pack on a new model is: run this, hand each arm to a fresh builder on
 *   that model, verify in a browser, fill the stub, append a `proofs` row. No node/bench needed to
 *   scaffold — this only reads the registry + the prompt builder.
 * @usage cd aimeat && pnpm aeb:prove pixi --model claude-haiku-4-5
 * @structure parseArgs() · packBlock() · main() — writes tools/aeb/runs/<pack>/{prompt-A,prompt-B,results-stub}.md
 * @version-history
 *   v2.0.0 — 2026-11-19 — The arms are built on the Atelier specification (paste delivery): A is the
 *     specification, B adds the pack's include lines and usage doc. The Classic specification they
 *     were cut from is retired, so a proof recorded before this date compared a different A and B.
 *   v1.0.0 — 2026-07-17 — initial scaffolder (Library Acceleration Program, tier proof ledger).
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../src/config.js';
import { buildAtelierPrompt } from '../src/services/builder/atelier-prompt.js';
import { getLibraryPack } from '../src/data/library-packs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AEB = resolve(__dirname, '../tools/aeb');

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1] ?? 'true'; i++; }
    else pos.push(argv[i]);
  }
  return { pack: pos[0], model: flags.model || 'MODEL-ID', url: flags.url || 'http://localhost:40050' };
}

/**
 * The pack's own block, the treatment: its include lines and its usage doc, in the shape the front
 * page's long prompt gives a chosen pack (landing-builder.js). The control is the specification
 * without it.
 */
function packBlock(reg: ReturnType<typeof getLibraryPack>): string {
  if (!reg) return '';
  return '\n## Selected capability pack (self-hosted on my node: use it, never a CDN)\n'
    + '### Pack: ' + reg.id + ' — ' + reg.title + '\n'
    + 'Include (in order):\n' + reg.include.join('\n') + '\n'
    + 'Usage:\n' + reg.aiDoc + '\n';
}

function readSpec(pack: string): { spec: string; checklist: string; testSet: string } {
  for (const id of [pack, `${pack}-smoke`]) {
    const specPath = resolve(AEB, `specs/${id}.spec.md`);
    if (existsSync(specPath)) {
      const clPath = resolve(AEB, `specs/${id}.checklist.md`);
      return {
        testSet: id,
        spec: readFileSync(specPath, 'utf8'),
        checklist: existsSync(clPath) ? readFileSync(clPath, 'utf8') : '(no checklist file — write one under tools/aeb/specs/)',
      };
    }
  }
  return { testSet: `${pack} (NONE — write tools/aeb/specs/${pack}.spec.md first)`, spec: '', checklist: '' };
}

function main() {
  const { pack, model, url } = parseArgs(process.argv.slice(2));
  if (!pack) { console.error('Usage: pnpm aeb:prove <pack> [--model <id>] [--url <nodeUrl>]'); process.exit(1); }
  const reg = getLibraryPack(pack);
  if (!reg) console.warn(`⚠ "${pack}" is not a node-scope registry pack — scaffolding anyway (community/new pack).`);

  const config = { baseUrl: url } as AimeatConfig;
  // The Atelier specification in its paste delivery: a fresh builder in a chat cannot connect.
  const full = buildAtelierPrompt(config, { mode: 'new', delivery: 'paste' }).full;
  const promptB = full + packBlock(reg);
  const promptA = full;
  const { spec, checklist, testSet } = readSpec(pack);

  const outDir = resolve(AEB, `runs/${pack}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'prompt-B-packs-shown.md'), promptB);
  writeFileSync(resolve(outDir, 'prompt-A-packs-hidden.md'), promptA);
  if (spec) writeFileSync(resolve(outDir, 'spec.md'), spec);
  if (checklist) writeFileSync(resolve(outDir, 'checklist.md'), checklist);

  const tier = reg?.modelTier ? `\ncurrent tier: \`${reg.modelTier}\`` : '';
  const stub = `# AEB proof — ${pack} on ${model} (${new Date().toISOString().slice(0, 10) /* replace: date is fixed at scaffold time */})

Test set: \`${testSet}\`${tier}
Node: ${url}

## Arms (same spec, one variable = the build prompt)
- A (control): \`prompt-A-packs-hidden.md\` — the Atelier specification (paste delivery), without the pack's own block.
- B (treatment): \`prompt-B-packs-shown.md\` — the same, with the pack's include lines and usage doc.
Hand each to a FRESH one-shot builder on ${model}. Publish both to ${url}, sign in, load demo data,
then verify in a browser (Playwright MCP) against \`checklist.md\`.

## Result (fill in)
| | A (hidden) | B (shown) |
|---|---|---|
| Tokens | | |
| App size | | |
| Renders in browser | | |
| Domain checks passed | | |
| Console errors (app-attributable) | | |

Verdict (protocol v2): B beats A with MORE domain checks (or equal at ≥20% fewer tokens) AND it
renders. Record the exact weak-model failure mode if it fails — that is the warning label.

## Apply the proof
Append to the pack's \`proofs\` in src/data/library-packs/*.ts:
  { model: '${model}', verdict: 'pass' | 'fail', testSet: '${testSet}', evidence: 'tools/aeb/results/aeb3-${pack}-${model}.md', tokens: N, date: 'YYYY-MM-DD' }
and update its \`modelTier\` if this changes the strongest passing tier. Move the row in
tools/aeb/acceleration-tiers.md from [I] to [M].
`;
  writeFileSync(resolve(outDir, 'results-stub.md'), stub);

  console.log(`✓ Scaffolded AEB proof run for "${pack}" on ${model}:`);
  console.log(`  ${outDir}/`);
  console.log('    prompt-A-packs-hidden.md   (control arm build prompt)');
  console.log('    prompt-B-packs-shown.md    (treatment arm build prompt)');
  if (spec) console.log('    spec.md + checklist.md     (the shared test set)');
  console.log('    results-stub.md            (fill this, then append a proofs[] row)');
  if (!spec) console.log(`\n⚠ No test set for "${pack}" — write tools/aeb/specs/${pack}.spec.md + .checklist.md first, then re-run.`);
}

main();
