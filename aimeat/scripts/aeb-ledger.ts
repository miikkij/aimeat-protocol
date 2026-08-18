/**
 * @file aeb-ledger.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Prints the AI-acceleration tier + per-model proof ledger for every library pack
 *   (the answer to "which models has each lib been tested on, and what happened?"). Reads the
 *   registry directly (source of truth) — no running node needed. See tools/aeb/acceleration-tiers.md.
 * @usage cd aimeat && pnpm aeb:ledger
 * @version-history
 *   v1.0.0 — 2026-07-18 — initial ledger printer (Library Acceleration Program, tier proof ledger).
 */
import { getLibraryPacks } from '../src/data/library-packs.js';

const ORDER: Record<string, number> = { frontier: 0, any: 1, 'needs-doc': 2 };
const packs = getLibraryPacks().slice().sort((a, b) =>
  (ORDER[a.modelTier ?? ''] ?? 9) - (ORDER[b.modelTier ?? ''] ?? 9) || a.id.localeCompare(b.id));

console.log('\nAI-acceleration ledger — tier + per-model proofs (source: src/data/library-packs)\n');
console.log('  ' + 'PACK'.padEnd(18) + 'TIER'.padEnd(11) + 'PROVEN ON (model → verdict, tokens, date)');
console.log('  ' + '-'.repeat(92));
for (const p of packs) {
  if (!p.modelTier && !(p.proofs && p.proofs.length)) continue;
  const proofs = (p.proofs ?? []).map(pr =>
    `${pr.model}→${pr.verdict}${pr.tokens ? ` ${Math.round(pr.tokens / 1000)}k` : ''} ${pr.date}`).join('  |  ') || '— (not yet AEB-run)';
  console.log('  ' + p.id.padEnd(18) + (p.modelTier ?? '—').padEnd(11) + proofs);
  const ev = p.proofs?.[0]?.evidence;
  if (ev) console.log('  ' + ''.padEnd(29) + '↳ ' + ev);
}
console.log('\nAlso queryable at GET /v1/library-packs (modelTier + proofs[] per pack) and shown as a');
console.log('tier badge in the app-catalog "Create new app" pack picker (tooltip = this ledger).');
console.log('Add a proof for any pack/model: pnpm aeb:prove <pack> --model <id>  (see tools/aeb/acceleration-tiers.md)\n');
