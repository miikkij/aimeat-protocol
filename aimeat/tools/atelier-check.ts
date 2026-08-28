/**
 * @file tools/atelier-check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Verifies the Atelier look system arithmetically: EVERY preset against EVERY
 *   palette in BOTH modes, the full matrix always, because it is seconds for a program and was
 *   only ever unsustainable for a human. Human review is the diagonal; this tool is the floor
 *   under it (TARGET-074).
 *
 *   THE ARITHMETIC LIVES IN src/services/atelier-contrast.ts NOW (extracted 2026-08-28 so the
 *   validator can prove a signature's colour override with the same matrix) — this file keeps
 *   the two jobs that belong beside the build: the DRIFT GATE (looks.css on disk must be exactly
 *   what the registry emits, or the matrix would be proving a stylesheet nobody ships) and the
 *   report that fails CI and the pre-commit hook.
 * @usage cd aimeat && pnpm exec tsx tools/atelier-check.ts     (or: pnpm check:atelier)
 *   Exits non-zero on any failure, so it gates CI and the pre-commit hook.
 * @version-history
 *   v2.0.0 — 2026-08-28 — The maths, the parsers and the checks moved whole to
 *     src/services/atelier-contrast.ts (pure extraction); this file is the drift gate + report.
 *   v1.0.0 — 2026-08-27 — Initial: the 70-combination matrix (TARGET-074 phase 1, slice 2).
 */
import { readFileSync } from 'node:fs';
import { loadAtelierSheets, runMatrix } from '../src/services/atelier-contrast.js';

// THE DRIFT GATE: the look stylesheet is generated from src/data/atelier-looks.ts, and the file
// on disk must be exactly what the registry emits — otherwise the matrix would be proving a
// stylesheet nobody ships, which is this codebase's oldest failure shape.
const looksCssOnDisk = readFileSync(new URL('../public/lib/aimeat-atelier/looks.css', import.meta.url), 'utf8');
const { emitLooksCss } = await import('./build-atelier-looks.js');
if (looksCssOnDisk.replace(/\r\n/g, '\n') !== emitLooksCss().replace(/\r\n/g, '\n')) {
  console.error('\n✖ public/lib/aimeat-atelier/looks.css drifts from src/data/atelier-looks.ts — run `pnpm build:atelier-looks` and commit the result.\n');
  process.exit(1);
}

const { themes, presetNames } = loadAtelierSheets();
const results = runMatrix();

// ── Report ───────────────────────────────────────────────────────────────────────────────────
const combos = presetNames.length * themes.size;
console.log(`\nAtelier look matrix — ${presetNames.length} presets × ${themes.size} palette-modes = ${combos} combinations, ${results.length} checks\n`);
let failed = 0;
for (const r of results) {
  if (r.ok) continue;
  failed++;
  console.log(`  FAIL ${r.combo.padEnd(26)} ${r.label.padEnd(38)} ${r.actual.toFixed(2).padStart(6)} < ${r.min}   <- ${r.why}`);
}
if (failed) {
  console.error(`\n${failed} of ${results.length} checks failed. Fix the token expression, not the check.\n`);
  process.exit(1);
}
console.log(`  ok   every combination meets every minimum (${results.length} checks green)\n`);
