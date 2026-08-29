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
 *   v1.1.0 — 2026-08-28 — The NESTING GUARD: every look's block (the bare default included)
 *     declares the never-inherited trio (--ak-hero-ink, --ak-hero-ink-dim, --ak-scrim) — its
 *     own value or the contract default — so a look previewed inside another look never wears
 *     the outer look's band type. Found by the Book's stage-controls run: an editorial preview
 *     inside the carnival gallery drew a light title on a pale ground. The vivid block carries
 *     no @preset-block marker (that tag names the base contract in the entry stylesheet).
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074, the look factory).
 */
import { writeFileSync } from 'node:fs';
import { LOOKS, STRUCTURES } from '../src/data/atelier-looks.js';

const structById = new Map(STRUCTURES.map((s) => [s.id, s]));

/**
 * Tokens a look must never INHERIT from an enclosing look: the inverse-band trio. A gallery on
 * carnival previewing an editorial part would otherwise hand the editorial hero carnival's
 * light type on a pale ground (found in the Book's first stage-controls run). Every emitted
 * block declares them — its own value when the look sets one, the contract default when not —
 * so nesting one look inside another is always safe.
 */
const NEVER_INHERITED: Record<string, string> = {
  '--ak-hero-ink': 'var(--ak-ink)',
  '--ak-hero-ink-dim': 'var(--ak-hero-ink)',
  '--ak-scrim': 'color-mix(in oklab, var(--ak-bg) 78%, transparent)',
  // A calm look nested inside a loud one must not inherit the letter-throw masthead.
  '--ak-kinetic': 'none',
  // Substitution happens at the DECLARING element: --ak-glass declared only at :root resolves
  // against the PALETTE surface, so a world's chrome floated on white glass over a night page
  // (found by the terminal ground). Re-declared per block, it follows the block's own surface.
  '--ak-glass': 'color-mix(in oklab, var(--ak-surface) 74%, transparent)',
};

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

  // EVERY look emits a block — even one with no overrides of its own carries the
  // never-inherited trio, because the bare default look (vivid) is exactly the one most often
  // nested inside another.
  for (const look of LOOKS) {
    const sel = `[data-ak-look='${look.id}']`;
    out.push('');
    // The base look's block carries NO @preset-block marker: that tag names the BASE CONTRACT
    // in the entry stylesheet, and a second one here would shadow it in the matrix's parser.
    // The block itself still emits — it is the nesting guard for the default look.
    if (look.id === 'vivid') {
      out.push(`/* ${look.id} — ${look.feel}.`);
    } else {
      out.push(`/* @preset-block ${look.id} — ${look.feel}.`);
    }
    out.push(`   ${look.note} */`);
    // A WORLD's ground rides in the same block (light) plus a `@dark` twin the dark cascade
    // layers on top. Only the ground tokens may carry literals; the tool refuses anything else
    // so the freed purity rule cannot leak.
    const GROUND_TOKENS = ['--ak-bg', '--ak-surface', '--ak-surface-2', '--ak-ink', '--ak-ink-dim', '--ak-line'];
    if (look.grounds) {
      for (const half of [look.grounds.light, look.grounds.dark]) {
        for (const name of Object.keys(half)) {
          if (!GROUND_TOKENS.includes(name)) {
            throw new Error(`look "${look.id}" grounds may only set ${GROUND_TOKENS.join(', ')} — got ${name}`);
          }
        }
      }
    }
    const tokens: Record<string, string> = { ...look.tokens, ...(look.grounds ? look.grounds.light : {}) };
    for (const [name, fallback] of Object.entries(NEVER_INHERITED)) {
      if (!(name in tokens)) tokens[name] = fallback;
    }
    out.push(`${sel} {`);
    const width = Math.max(...Object.keys(tokens).map((k) => k.length)) + 1;
    for (const [name, value] of Object.entries(tokens)) {
      out.push(`  ${(name + ':').padEnd(width + 1)} ${value};`);
    }
    out.push('}');
    if (look.grounds || look.dusk) {
      out.push(`/* @preset-block ${look.id}@dark — the world's dark ground (layered by the dark cascade). */`);
      out.push(`[data-theme='dark'] ${sel}, ${sel}[data-theme='dark'] {`);
      const darkDecls = { ...(look.grounds ? look.grounds.dark : {}), ...(look.dusk || {}) };
      const dw = Math.max(...Object.keys(darkDecls).map((k) => k.length)) + 1;
      for (const [name, value] of Object.entries(darkDecls)) {
        out.push(`  ${(name + ':').padEnd(dw + 1)} ${value};`);
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
