/**
 * @file src/data/atelier-looks-clean.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CLEAN look: the plain design-tool look a builder offers in every proposal, beside
 *   two to four more coloured ones. Neutral greys, the system's own fonts, 1 px hairlines, 6-8 px
 *   corners, shadow only on what floats, nothing moving at idle. Its accent is the viewer's palette;
 *   the clean style kit gives it one blue.
 *
 *   WHERE IT CAME FROM. PANEELI 2.0 drew this look by hand inside its own page (build note
 *   "pn-look (design-tool)": the Book's looks were terminal, riso, lit stage, amber poster, forest
 *   ledger and MTV, and none read as a professional design tool). On 2026-11-07 Jouni asked for the
 *   same look in Pastelair, and asked why it had not been offered: it lived in one app, so no
 *   builder could see it. His words: "haluan tuon perustyylin nyt myös tarjottavaksi yhdeksi
 *   designiksi aina kun tehdään appseja että saadaan selkeitä appseja". The grounds are PANEELI's
 *   own values, so the two read the same.
 * @structure CLEAN_LOOKS
 * @usage
 *   import { CLEAN_LOOKS } from './atelier-looks-clean.js';
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial: clean, from PANEELI's design-tool look.
 */
import type { AtelierLook } from './atelier-look-shape.js';

export const CLEAN_LOOKS: readonly AtelierLook[] = [
  {
    id: 'clean',
    feel: 'a clean working tool: neutral greys, the system\'s own fonts, 1 px hairlines, 6-8 px corners, shadow only on what floats, one accent for what is chosen, and nothing moving at idle',
    imagery: 'simple flat line icons and diagrams in grey and one blue on white, crisp outlines, no gradients, no scenery',
    structures: [],
    grounds: {
      // PANEELI 3.6's --pn-* values (surface, ink, dim), with the page and the hairline one step
      // further from the card: PANEELI's own #f7f7f8 / #e3e5e9 (dark #0e0f11 / #2a2d33) left a
      // tinted card 1.07 off the page and its outline 1.26 on the tint, under the matrix's 1.1 and
      // 1.3 (AK-EDGE), so a card would not read as a card on every palette.
      light: {
        '--ak-bg': '#eff0f2',
        '--ak-surface': '#ffffff',
        '--ak-surface-2': '#f4f5f7',
        '--ak-ink': '#111827',
        '--ak-ink-dim': '#5f6673',
        '--ak-line': '#d8dbe0',
      },
      dark: {
        '--ak-bg': '#0b0c0e',
        '--ak-surface': '#18191d',
        '--ak-surface-2': '#1f2125',
        '--ak-ink': '#e7e9ec',
        '--ak-ink-dim': '#9aa1ad',
        '--ak-line': '#30333a',
      },
    },
    tokens: {
      '--ak-page-image': 'none',
      '--ak-surface-image': 'none',
      '--ak-hero-image': 'none',
      '--ak-grain': 'none',
      '--ak-blur': '0px',
      '--ak-display-shadow': 'none',
      '--ak-display-stroke': '0',
      '--ak-tilt': '0deg',
      '--ak-kinetic': 'none',
      '--ak-ambient': 'none',
      // The bar is a solid strip, not glass.
      '--ak-glass': 'var(--ak-surface)',
      '--ak-grad': 'linear-gradient(135deg, color-mix(in oklab, var(--ak-accent) 86%, var(--ak-ink)), color-mix(in oklab, var(--ak-accent) 86%, var(--ak-ink)))',
      '--ak-radius': '8px',
      '--ak-radius-sm': '6px',
      '--ak-radius-pill': '999px',
      '--ak-line-w': '1px',
      // Cards lie flat on hairlines; a dialog, a menu or a toast floats.
      '--ak-elev-1': 'none',
      '--ak-elev-2': '0 8px 24px color-mix(in oklab, var(--ak-ink) 10%, transparent), 0 1px 2px color-mix(in oklab, var(--ak-ink) 6%, transparent)',
      // One family for headings and text: a design tool does not switch faces.
      '--ak-font-display': "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif",
      '--ak-font': "system-ui, -apple-system, 'Segoe UI', Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif",
      '--ak-font-mono': "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      '--ak-weight-display': '650',
      '--ak-gap': '16px',
      '--ak-enter-distance': '4px',
      '--ak-enter-stagger': '16ms',
      '--ak-motion': '140ms',
      // Settles at once and never restates itself.
      '--ak-spring-stiffness': '300',
      '--ak-spring-damping': '32',
      '--ak-spring-mass': '1',
    },
    note: 'The clean look, taken from PANEELI\'s design-tool look on 2026-11-07 and offered in every proposal beside the coloured ones. The grounds are PANEELI\'s values; like every look it takes its accent from the viewer\'s palette, and the clean style kit makes it one blue.',
  },
];
