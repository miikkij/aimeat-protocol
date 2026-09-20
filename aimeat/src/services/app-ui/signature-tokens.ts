/**
 * @file src/services/app-ui/signature-tokens.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SIGNATURE TOKENS — the bounded `--ak-*` subset a stored layout may override
 *   to give one app its own hand. A pure extraction from registry.ts on 2026-09-05 (the registry
 *   stood at 798 lines against the 800 cap); registry.ts re-exports the name, so every importer
 *   keeps the address it had. The list is append-only, and the words beside each token are what
 *   the catalogue hands an AI.
 * @structure SIGNATURE_TOKENS · SERVED_FONT_FAMILIES · unservedFirstFamily()
 * @usage
 *   import { SIGNATURE_TOKENS } from './signature-tokens.js';
 * @version-history
 *   v1.1.0 — 2026-09-20 — The two font tokens name the faces this node serves, and
 *     unservedFirstFamily() is what the token bench refuses with.
 *   v1.0.0 — 2026-09-05 — Pure extraction from registry.ts v1.20.0
 *     (wish-atelier-post-process-effects, stage 1).
 */

/**
 * Every face /lib/aimeat-fonts.css declares, which the kit's stylesheet imports, so a page on the
 * kit has them with nothing to load. test/unit/served-fonts.test.ts holds this list against that
 * file. A look on production named Bungee while nothing served it (2026-09-20): its title fell
 * back to the system face, and the look read like every other look.
 */
export const SERVED_FONT_FAMILIES: readonly string[] = [
  'Archivo', 'Archivo Black', 'Bungee', 'DM Sans', 'Fjalla One', 'Fraunces', 'Inter', 'JetBrains Mono', 'Space Grotesk', 'VT323',
];

/** Faces a browser has without a download, and the generic keywords. Lower case. */
const SYSTEM_FONT_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'verdana', 'tahoma',
  'trebuchet ms', 'georgia', 'times new roman', 'times', 'palatino', 'garamond', 'courier new', 'courier', 'consolas', 'menlo',
  'monaco', 'impact', 'inherit',
]);

/** Null when the stack's first family will render as named; otherwise the family that will not. */
export function unservedFirstFamily(stack: string): string | null {
  const first = stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '').trim();
  if (!first || first.startsWith('var(')) return null;
  const known = SYSTEM_FONT_FAMILIES.has(first.toLowerCase()) || SERVED_FONT_FAMILIES.some(f => f.toLowerCase() === first.toLowerCase());
  return known ? null : first;
}

/**
 * The SIGNATURE TOKENS: the bounded `--ak-*` subset a layout may override to give one app its own
 * hand — colour, shape, typography, density and motion. COLOUR IS ONE TOKEN AND IT IS A PAIR:
 * measurement proved no single hex survives every palette in both modes (the house coral fails 32
 * light-mode checks and passes dark completely), so `--ak-accent` takes "light/dark" and the
 * validator runs the full contrast matrix per mode before accepting it — colour ships proven, not
 * on trust. Growing this list is append-only, and every other entry stays provable-safe by
 * construction (a radius cannot break contrast).
 */
export const SIGNATURE_TOKENS: Record<string, string> = {
  '--ak-accent': 'The signature colour, as a LIGHT/DARK PAIR "#hex/#hex" — the light-mode value first, the dark-mode value second, e.g. "#0e7c66/#e8564a". Both values run the full contrast matrix at validation, each against its own mode, and a pair that breaks readability anywhere refuses with the numbers. Every accent derivation (text tint, gradient, spectrum, focus ring) follows the pair.',
  '--ak-radius': 'Corner rounding of cards and surfaces, e.g. "2px" for a sharp hand, "18px" for a soft one.',
  '--ak-radius-sm': 'Corner rounding of rows and inputs.',
  '--ak-radius-pill': 'Rounding of pills and chips.',
  '--ak-gap': 'The grid gap between blocks.',
  '--ak-pad': 'The base padding inside surfaces.',
  '--ak-main-max': 'The content column width, e.g. "56rem" for a tight editorial measure.',
  '--ak-font': `The body face, as a stack. Its FIRST family is one this node serves (${SERVED_FONT_FAMILIES.join(', ')}) or a system face (Georgia, Courier New, system-ui, serif, monospace…): a face nobody serves falls back in silence and the page reads like every other page.`,
  '--ak-font-display': `The display face for titles and figures, as a stack. Same rule as --ak-font. The loud ones this node serves: Bungee (a sign-painter's shout), Archivo Black (the poster), Fjalla One (the condensed headline), Fraunces (the soft serif), VT323 (the terminal).`,
  '--ak-weight-display': 'The display weight, e.g. "900" for a heavy masthead.',
  '--ak-text-hero': 'The hero title size, e.g. "clamp(2.2rem, 7vw, 4.4rem)".',
  '--ak-kinetic': 'The masthead letter-throw: "letters" (each glyph arrives on the look\'s spring), "words", or "none". One kinetic headline per screen; the hero runs it, apps call nothing.',
  '--ak-tilt': 'The playful tilt of cards and tiles, e.g. "1.2deg". "0deg" is calm.',
  '--ak-motion': 'The base transition duration, e.g. "120ms" for a snappy hand.',
  '--ak-ease': 'The curve every transition and entrance rides, e.g. "cubic-bezier(0.34, 1.56, 0.64, 1)" for a springy overshoot, "linear" for a machine hand.',
  '--ak-enter-distance': 'How far content travels on entry, e.g. "0px" turns reveals off.',
  '--ak-enter-stagger': 'The gap between one entering element and the next, e.g. "0ms" lands everything at once, "90ms" deals them like cards.',
  '--ak-blur': 'The glass blur of the chrome, e.g. "0px" for solid chrome.',
};
