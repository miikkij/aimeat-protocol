/**
 * @file src/services/app-ui/signature-tokens.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SIGNATURE TOKENS — the bounded `--ak-*` subset a stored layout may override
 *   to give one app its own hand. A pure extraction from registry.ts on 2026-09-05 (the registry
 *   stood at 798 lines against the 800 cap); registry.ts re-exports the name, so every importer
 *   keeps the address it had. The list is append-only, and the words beside each token are what
 *   the catalogue hands an AI.
 * @structure SIGNATURE_TOKENS
 * @usage
 *   import { SIGNATURE_TOKENS } from './signature-tokens.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Pure extraction from registry.ts v1.20.0
 *     (wish-atelier-post-process-effects, stage 1).
 */

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
  '--ak-font': 'The body face (a stack; the platform webfonts are already loaded).',
  '--ak-font-display': 'The display face for titles and figures.',
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
