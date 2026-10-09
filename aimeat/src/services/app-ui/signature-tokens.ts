/**
 * @file src/services/app-ui/signature-tokens.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SIGNATURE TOKENS — the bounded `--ak-*` subset a stored layout may override
 *   to give one app its own hand. A pure extraction from registry.ts on 2026-09-05 (the registry
 *   stood at 798 lines against the 800 cap); registry.ts re-exports the name, so every importer
 *   keeps the address it had. The list is append-only, and the words beside each token are what
 *   the catalogue hands an AI.
 * @structure SIGNATURE_TOKENS · SPRING_BOUNDS · SERVED_FONT_FAMILIES · servedFontFamilies() · unservedFirstFamily()
 * @usage
 *   import { SIGNATURE_TOKENS } from './signature-tokens.js';
 * @version-history
 *   v1.6.0 — 2026-10-09 — SERVED_FONT_FAMILIES takes IBM Plex Sans and IBM Plex Mono (aimeat-fonts.css v1.4.0).
 *   v1.5.0 — 2026-10-03 — servedFontFamilies(): the base list and the faces the operator added to the
 *     running node (the font manager); unservedFirstFamily() reads it, so the bench accepts an added face.
 *   v1.4.0 — 2026-10-03 — SERVED_FONT_FAMILIES takes Press Start 2P and Selawik (aimeat-fonts.css v1.3.0).
 *   v1.3.0 — 2026-10-02 — SERVED_FONT_FAMILIES takes the eleven faces vendored that day (aimeat-fonts.css v1.2.0).
 *   v1.2.0 — 2026-09-28 — The spring hand joins the signature: --ak-spring-stiffness, -damping and
 *     -mass, each a plain number inside SPRING_BOUNDS, so a layout and a Design Book motion part
 *     can say how the kit's springs feel (the ten motion parts).
 *   v1.1.0 — 2026-09-20 — The two font tokens name the faces this node serves, and
 *     unservedFirstFamily() is what the token bench refuses with.
 *   v1.0.0 — 2026-09-05 — Pure extraction from registry.ts v1.20.0
 *     (wish-atelier-post-process-effects, stage 1).
 */
import { addedFamilyNames } from '../themes/font-registry.js';

/**
 * Every face /lib/aimeat-fonts.css declares, which the kit's stylesheet imports, so a page on the
 * kit has them with nothing to load. test/unit/served-fonts.test.ts holds this list against that
 * file. A look on production named Bungee while nothing served it (2026-09-20): its title fell
 * back to the system face, and the look read like every other look.
 */
export const SERVED_FONT_FAMILIES: readonly string[] = [
  'Archivo', 'Archivo Black', 'Bungee', 'DM Sans', 'Fjalla One', 'Fraunces', 'Inter', 'JetBrains Mono', 'Space Grotesk', 'VT323',
  'Instrument Serif', 'Instrument Sans', 'Schibsted Grotesk', 'Bricolage Grotesque', 'Syne', 'Unbounded', 'Gloock',
  'Mona Sans', 'Hubot Sans', 'Geist Mono', 'Martian Mono',
  'Press Start 2P', 'Selawik',
  'IBM Plex Sans', 'IBM Plex Mono',
];

/** Faces a browser has without a download, and the generic keywords. Lower case. */
const SYSTEM_FONT_FAMILIES: ReadonlySet<string> = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'verdana', 'tahoma',
  'trebuchet ms', 'georgia', 'times new roman', 'times', 'palatino', 'garamond', 'courier new', 'courier', 'consolas', 'menlo',
  'monaco', 'impact', 'inherit',
]);

/**
 * The faces a look may name now: the base list above, then the faces the operator added to the
 * running node (the font manager, services/themes/font-registry.ts) once a file of each has arrived.
 */
export function servedFontFamilies(): string[] {
  const base = new Set(SERVED_FONT_FAMILIES.map(f => f.toLowerCase()));
  return [...SERVED_FONT_FAMILIES, ...addedFamilyNames().filter(f => !base.has(f.toLowerCase()))];
}

/** Null when the stack's first family will render as named; otherwise the family that will not. */
export function unservedFirstFamily(stack: string): string | null {
  const first = stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '').trim();
  if (!first || first.startsWith('var(')) return null;
  const known = SYSTEM_FONT_FAMILIES.has(first.toLowerCase()) || servedFontFamilies().some(f => f.toLowerCase() === first.toLowerCase());
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
  '--ak-font': `The body face, as a stack. Its FIRST family is one this node serves (${SERVED_FONT_FAMILIES.join(', ')}, and the faces its operator added, which aimeat_theme_list names under fonts.added) or a system face (Georgia, Courier New, system-ui, serif, monospace…): a face nobody serves falls back in silence and the page reads like every other page.`,
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
  '--ak-spring-stiffness': 'How hard the look\'s spring pulls toward where a thing is going, a plain number from 60 to 600: higher is snappier, 170 is the house hand. The tab ink, the switch, the menus, the island and every spring() read it.',
  '--ak-spring-damping': 'How quickly the spring stops swinging, a plain number from 8 to 60: with stiffness 170, 26 lands without overshoot, 20 overshoots a little, 12 bounces.',
  '--ak-spring-mass': 'How heavy the moving thing feels, a plain number from 0.5 to 3: 1 is the house hand, 1.6 is slow and weighty, 0.8 is light.',
};

/**
 * The bounds a spring token's number must sit in. Outside them a control either crawls, rings
 * for seconds or jumps; inside them every combination settles within the kit's own time budget.
 */
export const SPRING_BOUNDS: Readonly<Record<string, readonly [number, number]>> = {
  '--ak-spring-stiffness': [60, 600],
  '--ak-spring-damping': [8, 60],
  '--ak-spring-mass': [0.5, 3],
};
