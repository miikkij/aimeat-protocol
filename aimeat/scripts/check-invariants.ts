/**
 * @file scripts/check-invariants.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The five gates that read the compiler's own program, run in one process against one
 *   program: runtime read targets, identity resolution, owner-principal refusals, federation write
 *   signatures and credential-free write doors.
 *
 *   WHY ONE PROCESS. Each of the five builds a full TypeScript program of src/ before it looks at
 *   anything, and building one is 8–10 s. Run as five hook lines they took 62 s of every commit
 *   (measured 2026-09-05: 15.4 + 12.7 + 11.5 + 11.2 + 11.1) on what was the same parse five times.
 *   `scripts/inventory/program.ts` now builds it once per process and every gate reuses it, so the
 *   five together cost one build plus five walks. Every gate is still its own `pnpm check:<name>`
 *   with its own `--seed`, `--list` and `--report` for the person triaging its backlog; this is the
 *   hook's and CI's door, and it is always strict.
 *
 *   ALL FIVE RUN before anything exits. A red gate is reported and the next one still runs, so one
 *   commit sees every refusal it earned rather than the first.
 * @structure GATES: name → the gate's main(); main(): run all, time each, exit 1 if any refused
 * @usage
 *   cd aimeat && pnpm check:invariants
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial. Written from the pipeline-cost analysis of the same day.
 */
import { main as runtimeReadTargets } from './check-runtime-read-targets.js';
import { main as identityResolution } from './check-identity-resolution.js';
import { main as ownerPrincipal } from './check-owner-principal.js';
import { main as federationSignatures } from './check-federation-signatures.js';
import { main as openWrites } from './check-open-writes.js';

const GATES: [string, () => boolean][] = [
    ['check:runtime-read-targets', runtimeReadTargets],
    ['check:identity-resolution', identityResolution],
    ['check:owner-principal', ownerPrincipal],
    ['check:federation-signatures', federationSignatures],
    ['check:open-writes', openWrites],
];

function main(): void {
    const t0 = Date.now();
    const refused: string[] = [];
    const rows: string[] = [];
    for (const [name, gate] of GATES) {
        const t = Date.now();
        const ok = gate();
        rows.push(`  ${ok ? '✓' : '✗'} ${name.padEnd(30)} ${((Date.now() - t) / 1000).toFixed(1).padStart(5)}s`);
        if (!ok) refused.push(name);
    }
    console.log('');
    console.log('  The five program-reading gates, one compiler program');
    console.log('  ' + '─'.repeat(62));
    for (const r of rows) console.log(r);
    console.log(`  ${'total'.padEnd(32)} ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`);
    console.log('');
    if (refused.length > 0) {
        console.error(`✖ ${refused.length} gate(s) refused: ${refused.join(', ')}. Each one printed what and why above.`);
        process.exit(1);
    }
    console.log('  ✓ all five gates pass');
}

main();
