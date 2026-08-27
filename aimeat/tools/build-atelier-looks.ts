/**
 * @file tools/build-atelier-looks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Emits public/lib/aimeat-atelier/looks.css from the look registry
 *   (src/data/atelier-looks.ts) — every look's @preset-block token override plus the structure
 *   recipes it uses, scoped to its selector. ONE registry, generated stylesheet, and
 *   pnpm check:atelier refuses drift between the two, so the file on disk can never quietly
 *   diverge from the data that documents it.
 * @structure emitLooksCss() · main (writes the file)
 * @usage pnpm build:atelier-looks   (or: pnpm exec tsx tools/build-atelier-looks.ts)
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074, the look factory).
 */
import { writeFileSync } from 'node:fs';
import { LOOKS, STRUCTURES } from '../src/data/atelier-looks.js';

const structById = new Map(STRUCTURES.map((s) => [s.id, s]));

/** The whole generated stylesheet, deterministically — the drift gate compares against this. */
export function emitLooksCss(): string {
  const out: string[] = [];
  out.push(`/*
 * @file aimeat-atelier/looks.css
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GENERATED — do not edit. Source: src/data/atelier-looks.ts, emitted by
 *   tools/build-atelier-looks.ts (pnpm build:atelier-looks). Every look's token block and the
 *   structure recipes it uses. pnpm check:atelier refuses drift against the registry and runs
 *   the full preset x palette x mode matrix over every block below.
 * @usage  Imported by ../aimeat-atelier.css — never link this part directly.
 */`);

  for (const look of LOOKS) {
    if (Object.keys(look.tokens).length === 0 && look.structures.length === 0) continue;
    const sel = `[data-ak-look='${look.id}']`;
    out.push('');
    out.push(`/* @preset-block ${look.id} — ${look.feel}.`);
    out.push(`   ${look.note} */`);
    if (Object.keys(look.tokens).length) {
      out.push(`${sel} {`);
      const width = Math.max(...Object.keys(look.tokens).map((k) => k.length)) + 1;
      for (const [name, value] of Object.entries(look.tokens)) {
        out.push(`  ${(name + ':').padEnd(width + 1)} ${value};`);
      }
      out.push('}');
    }
    for (const sid of look.structures) {
      const s = structById.get(sid);
      if (!s) throw new Error(`look "${look.id}" uses unknown structure "${sid}"`);
      out.push(`/* structure: ${sid} — ${s.summary} */`);
      out.push(s.css(sel).trim());
    }
  }
  out.push('');
  return out.join('\n');
}

// Written straight through when invoked as a script (the import.meta check keeps the checker's
// import of emitLooksCss from re-writing the file during a gate run).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  const target = new URL('../public/lib/aimeat-atelier/looks.css', import.meta.url);
  writeFileSync(target, emitLooksCss(), 'utf8');
  console.log(`✓ looks.css emitted from ${LOOKS.length} looks and ${STRUCTURES.length} structures`);
}
