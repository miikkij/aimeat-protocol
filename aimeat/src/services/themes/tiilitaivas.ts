/**
 * @file src/services/themes/tiilitaivas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shipped theme Tiilitaivas: a dawn turquoise ground, warm brick actions and thick
 *   hard-edged shadows, light by default with a dark mode (Jouni's decision, 2026-11-04 02:03, source
 *   tiilitaivas.json v1.0). It is optional: AIMEAT stays the default theme, and an operator's
 *   themes.offered list decides whether people see this one.
 *
 *   IT GOES THROUGH THE THEME SYSTEM. The colours become the tokens a style sets (tokens.ts), the
 *   corners, frames and shadows the theme's shape values (shapes.ts), and the rest the theme CSS
 *   served in its sheet (sheet.ts), so no component carries a Tiilitaivas colour. Read only, like the
 *   AIMEAT theme; an operator who wants it changed copies it and edits the copy.
 *
 *   TOKEN MAP. The source's `accent` is the site's --accent (links, labels), its `secondary` the sun
 *   and its `textMuted` both quiet text tokens. The source's `border` is the heavy frame, so the site's
 *   --card-border and --control-border take it as it is, and the row hairline --border is the same
 *   colour thinned. The semantic family, which a style does not set (tokens.ts), comes in the theme
 *   CSS, as do the source's names with no site token (--primary and its pair, --focus, --shadow).
 *
 *   THE HEADLINE FACE STOPS AT 20 PX. Pixelify Sans is for headings of 20 px and larger and never for
 *   running text. Several components read the aliases --font-poster, --font-showroom and --font-display
 *   at small sizes, so here those aliases are the body face, and only the large headings name
 *   --font-headline. A component added later reads as body text until someone lists it.
 *
 *   accentDecor (#2EC6B6) is a fill only and takes dark words on it: it reaches the love gradient and
 *   no text token.
 * @structure TIILITAIVAS_ID · TIILITAIVAS_COLOURS · styleTokens · SHAPES · themeCss · tiilitaivasTheme
 * @usage import { tiilitaivasTheme, TIILITAIVAS_ID } from './tiilitaivas.js';
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial, from tiilitaivas.json v1.0.
 */
import type { Style } from './styles.js';
import type { TokenMap } from './builtin.js';

export const TIILITAIVAS_ID = 'tiilitaivas';

/** The source's colours, name for name. test/unit/themes-tiilitaivas.test.ts holds its contrast pairs. */
export const TIILITAIVAS_COLOURS = {
    light: {
        background: '#EAF8F6', surface: '#FFFFFF', surfaceAlt: '#FFF1E2',
        primary: '#B5452A', primaryHover: '#9E3A22', primaryText: '#FFFFFF',
        secondary: '#FFC23D', secondaryText: '#2A2238',
        accent: '#16796F', accentDecor: '#2EC6B6',
        text: '#2A2238', textMuted: '#5A5070', border: '#2A2238', focus: '#1172B8',
        success: '#24784A', warning: '#8A5A00', danger: '#B42843',
        successBg: '#E2F6E8', warningBg: '#FFF2CC', dangerBg: '#FFE3E8',
        shadow: '#2A2238',
    },
    dark: {
        background: '#1B1726', surface: '#262036', surfaceAlt: '#31294A',
        primary: '#FF8A5C', primaryHover: '#FFA27C', primaryText: '#1B1726',
        secondary: '#FFC23D', secondaryText: '#1B1726',
        accent: '#4FE0CF', accentDecor: '#2EC6B6',
        text: '#F6F1FF', textMuted: '#C3B9DC', border: '#9C90B8', focus: '#7FD3FF',
        success: '#6FDB98', warning: '#FFC23D', danger: '#FF7D92',
        successBg: '#1E3A2C', warningBg: '#3D3115', dangerBg: '#45202B',
        shadow: '#0D0A14',
    },
} as const;

type Colours = { readonly [K in keyof typeof TIILITAIVAS_COLOURS.light]: string };

const thinned = (colour: string, percent: number) => `color-mix(in srgb, ${colour} ${percent}%, transparent)`;

/** Every token a style sets, from one mode's colours. */
function styleTokens(c: Colours, mode: 'light' | 'dark'): TokenMap {
    return {
        '--bg': c.background, '--bg-surface': c.surfaceAlt, '--bg-elevated': c.surface,
        '--card-bg': c.surface, '--card-bg-hover': c.surfaceAlt, '--card-bg-solid': c.surface, '--card-bg-alt': c.surfaceAlt, '--card-border': c.border,
        '--accent': c.accent, '--accent-bright': c.accent, '--accent-deep': `color-mix(in srgb, ${c.accent} 86%, ${c.text})`,
        '--accent-glow': thinned(c.accent, 30), '--accent-subtle': thinned(c.accent, 8), '--accent-border': thinned(c.accent, 28),
        '--love1': c.primary, '--love2': c.secondary, '--love3': c.accentDecor, '--love4': c.secondary, '--love5': c.primary,
        '--text': c.text, '--text-bright': c.text, '--text-dim': c.textMuted, '--text-muted': c.textMuted,
        '--border': thinned(c.border, 30), '--border-subtle': thinned(c.border, 16), '--border-focus': c.focus,
        '--bg-input': c.surface, '--bg-input-focus': c.surface, '--control-bg': c.surface, '--control-border': c.border,
        '--code-bg': c.surfaceAlt, '--scrollbar-thumb': c.textMuted,
        '--morsel-bg': c.surfaceAlt, '--pf-hero-gradient': c.background, '--pf-cta-gradient': c.surfaceAlt, '--pf-callout-gradient': c.surfaceAlt,
        '--sun': c.secondary, '--on-sun': c.secondaryText,
        '--ink-ground': mode === 'light' ? c.text : c.shadow, '--on-ink-ground': mode === 'light' ? c.background : c.text,
    };
}

/** The source's radii, frames and shadows as the theme's shape values. */
const SHAPES: Readonly<Record<string, string>> = {
    '--shape-corner': '14px', '--shape-corner-control': '8px', '--shape-corner-pill': '8px', '--shape-corner-dialog': '14px',
    '--shape-corner-soft': '8px', '--shape-corner-card': '14px',
    '--shape-frame': '3px', '--shape-frame-heavy': '3px', '--shape-ring': '3px',
    '--shape-frame-colour': 'var(--card-border)', '--shape-rule-colour': 'var(--card-border)', '--shape-field-colour': 'var(--control-border)',
    '--shape-chosen-ground': 'var(--sun)',
    '--shape-shadow': '6px 6px 0 0 var(--shadow)', '--shape-shadow-raised': '6px 6px 0 0 var(--shadow)', '--shape-shadow-dialog': '6px 6px 0 0 var(--shadow)',
    '--shape-shadow-action': '4px 4px 0 0 var(--shadow)', '--shape-shadow-action-pressed': '1px 1px 0 0 var(--shadow)', '--shape-shadow-chosen': '4px 4px 0 0 var(--shadow)',
    '--shape-case-heading': 'none', '--font-poster-weight': '700', '--font-poster-tracking': '0', '--font-poster-leading': '1.15',
    '--shape-case-action': 'none', '--shape-tracking-action': '0', '--shape-case-label': 'none', '--shape-tracking-label': '0',
};

/** One mode's values for what a style does not set. */
const modeVariables = (c: Colours): string => `
  --primary: ${c.primary}; --primaryHover: ${c.primaryHover}; --primaryText: ${c.primaryText};
  --secondary: ${c.secondary}; --secondaryText: ${c.secondaryText};
  --accentDecor: ${c.accentDecor}; --focus: ${c.focus}; --shadow: ${c.shadow};
  --success: ${c.success}; --success-fg: ${c.success}; --success-bg: ${c.successBg}; --success-border: ${c.success};
  --warn: ${c.warning}; --warn-fg: ${c.warning}; --warn-bg: ${c.warningBg}; --warn-border: ${c.warning};
  --danger: ${c.danger}; --danger-fg: ${c.danger}; --danger-bg: ${c.dangerBg}; --danger-border: ${c.danger};`;

/** The theme CSS, its colours from TIILITAIVAS_COLOURS so a hex is written once. */
function themeCss(): string {
    const { light, dark } = TIILITAIVAS_COLOURS;
    return `/* Tiilitaivas, from tiilitaivas.json v1.0. Hard shadows with no blur, a pixel face for large headings. */
:root {${modeVariables(light)}
  /* Saturated fills with white words stay on the light values in both modes. */
  --badge-wildcard-bg: ${light.danger}; --badge-organism-bg: ${light.success};
  --primary-gradient: var(--primary); --success-gradient: ${light.success}; --success-glow: 4px 4px 0 0 var(--shadow);
  --shadow-sm: 4px 4px 0 0 var(--shadow); --shadow-md: 6px 6px 0 0 var(--shadow); --shadow-lg: 6px 6px 0 0 var(--shadow); --shadow-xl: 6px 6px 0 0 var(--shadow); --shadow-heart: 4px 4px 0 0 var(--shadow);
  --radius: 14px; --radius-sm: 8px; --radius-xs: 4px; --radius-xl: 14px; --radius-full: 999px;
  --aimeat-pill-radius: 8px; --aimeat-pill-cta-shadow: var(--shadow);
  /* Only the large headings below read --font-headline; these aliases go to small text too. */
  --font-poster: var(--font-body); --font-showroom: var(--font-body); --font-display: var(--font-body); --display-tracking: 0;
  --font-mono: ui-monospace, 'Geist Mono', monospace;
  --font-poster-text-weight: 600; --font-poster-strong-weight: 700; --font-poster-section-weight: 600;
  --text-base: 1rem; --text-body: 1rem; --text-body-sm: .95rem;
}
[data-theme="dark"] {${modeVariables(dark)}
}

body { font-family: var(--font-body); font-size: 16px; line-height: 1.45; font-weight: 600; }

/* The headline face, at 20 px and larger only. */
.poster-page-title, .poster-section-title, .poster-record-title, .poster-stat-number, .poster-masthead-name, .og-title { font-family: var(--font-headline); font-weight: 700; }
/* These components read --font-headline directly at sizes under 20 px, so they go back to the body face. */
.poster-foot-brand, .side-menu-title-words, .og-step-n, .og-sec-fold,
.listing.list--history > .listing-row > .listing-name,
.list--index.listing--n-mark-name-desc-state-n-arrow > .listing-row > :is(:nth-child(6), :nth-child(7)) { font-family: var(--font-body); }

/* The dark blocks stay dark in dark mode too, so the sun's labels and links on them keep their contrast. */
.poster-section-title, .poster-foot { background: var(--ink-ground); color: var(--on-ink-ground); }
.poster-section-title small, .pf .og .og-sec h2.poster-section-title small, .og-kp--public .og-sec h2.poster-section-title small, .operator-frame-page .og-sec-h h2.poster-section-title small { color: var(--sun); }
.poster-section-title .poster-count--tally { color: inherit; }

:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }

/* Buttons: primary brick, ghost on the surface, a hard shadow, and a press that moves into it. */
.poster-slab, .btn-primary {
  background: var(--primary); color: var(--primaryText); border: 3px solid var(--card-border); border-radius: 8px;
  padding: 10px 18px; font-weight: 800; box-shadow: 4px 4px 0 0 var(--shadow); transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
}
.btn-outline, .btn-ghost {
  background: var(--card-bg); color: var(--text); border: 3px solid var(--card-border); border-radius: 8px;
  padding: 10px 18px; font-weight: 800; box-shadow: 4px 4px 0 0 var(--shadow); transition: transform 120ms ease, box-shadow 120ms ease;
}
.btn-sm { padding: 6px 12px; }
.poster-slab:hover, .btn-primary:hover { background: var(--primaryHover); color: var(--primaryText); transform: translate(-1px, -1px); box-shadow: 5px 5px 0 0 var(--shadow); }
.btn-outline:hover, .btn-ghost:hover { background: var(--card-bg); color: var(--text); border-color: var(--card-border); transform: translate(-1px, -1px); box-shadow: 5px 5px 0 0 var(--shadow); }
.poster-slab:active, .btn-primary:active, .btn-outline:active, .btn-ghost:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 0 var(--shadow); }
.poster-slab--large { box-shadow: 6px 6px 0 0 var(--shadow); }
.poster-slab.copied, .poster-slab.success, .btn-primary.copied, .btn-primary.success { background: var(--success-bg); color: var(--success-fg); }
.poster-slab--danger, .poster-slab--danger:hover { background: var(--danger); color: ${light.primaryText}; }
[data-theme="dark"] .poster-slab--danger, [data-theme="dark"] .poster-slab--danger:hover { color: ${dark.primaryText}; }
.poster-action--danger { color: var(--danger-fg); border-bottom-color: var(--danger-fg); }

/* Fields: a whole frame on the surface, a focus ring outside it. The page sheets draw these fields
   with many longer selectors (an underline, a page-coloured ground), so the frame is !important. */
.og-input, .og-textarea, .select-field, .input-field, .pj-taginput {
  background: var(--bg-input) !important; border: 3px solid var(--shape-field-colour) !important; border-radius: 8px !important;
}
.og-input:not(.text-field--glyph, .text-field--mark), .og-textarea, .input-field { padding: 8px 12px !important; }
.pj-taginput-field { border: 0 !important; }
:is(.og-input, .og-textarea, .select-field, .input-field):focus, .pj-taginput:focus-within { box-shadow: 0 0 0 3px var(--focus) !important; outline: none; }
:is(.og-input, .og-textarea, .input-field)::placeholder, .og-fields--plain :is(.og-input, .og-textarea)::placeholder { color: var(--text-dim); font-style: normal; opacity: 1; }
.og-input--invalid, .og-textarea--invalid { border-color: var(--danger-fg) !important; }

/* Cards in the classic pages. */
.card, .card-solid { background: var(--card-bg); border: 3px solid var(--card-border); border-radius: 14px; box-shadow: 6px 6px 0 0 var(--shadow); }
.card:hover { box-shadow: 6px 6px 0 0 var(--shadow); }

/* With reduced motion nothing moves; only the shadow changes. */
@media (prefers-reduced-motion: reduce) {
  .poster-slab, .btn-primary, .btn-outline, .btn-ghost { transition: none; }
  .poster-slab:hover, .poster-slab:active, .btn-primary:hover, .btn-primary:active, .btn-outline:hover, .btn-outline:active, .btn-ghost:hover, .btn-ghost:active { transform: none; }
}
`;
}

/** What the theme service reads: the fields of its Theme record, read only. */
export interface ShippedTheme {
    id: string; name: string; builtin: true; styles: Style[]; defaultStyle: string; offeredStyles: string[];
    shapes: Record<string, string>; componentCss: Record<string, string>; css: string; retired: false;
    basedOn: null; createdBy: null; createdAt: null; updatedBy: null; updatedAt: null;
}

/** The theme as a record. `builtin` is false on the style so the theme's sheet draws it (sheet.ts). */
export function tiilitaivasTheme(): ShippedTheme {
    const style: Style = {
        id: TIILITAIVAS_ID, name: 'Tiilitaivas', builtin: false,
        light: styleTokens(TIILITAIVAS_COLOURS.light, 'light'), dark: styleTokens(TIILITAIVAS_COLOURS.dark, 'dark'),
        faces: { headline: 'Pixelify Sans', body: 'Baloo 2', mono: 'Geist Mono' },
        onlyMode: null, retired: false,
    };
    return {
        id: TIILITAIVAS_ID, name: 'Tiilitaivas', builtin: true, styles: [style], defaultStyle: style.id, offeredStyles: [style.id],
        shapes: { ...SHAPES }, componentCss: {}, css: themeCss(), retired: false,
        basedOn: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
    };
}
