/**
 * @file src/services/themes/selkea.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shipped theme Selkeä: a businesslike look for Settings & Controls and every inner
 *   page. A paper ground, white boxes with an ink frame, corners of 3 to 4 px, the sun as a solid
 *   colour (a number tile, a label, the chosen item), one height (40 px) for every button and field,
 *   and outlined and filled buttons instead of underlined words. Light only. Its values were tried as
 *   a custom theme record before it shipped and are ported here as they were saved. It is optional:
 *   AIMEAT stays the default theme, and it is not offered until the operator's themes.offered list
 *   names it.
 *
 *   IT GOES THROUGH THE THEME SYSTEM, like Tiilitaivas. The colours become the tokens a style sets
 *   (tokens.ts), the corners, frames and shadows the theme's shape values (shapes.ts), and the rest the
 *   theme CSS served in its sheet (sheet.ts), so no component carries a Selkeä value. Read only, like
 *   the AIMEAT theme; an operator who wants it changed copies it and edits the copy.
 *
 *   LIGHT ONLY. The one style has onlyMode 'light', and its dark map is the light map, which is how the
 *   tried record was saved: a page that asks for dark mode still gets these values.
 *
 *   THE CASCADE ORDER OF THE THEME CSS IS DELIBERATE. Later rules override earlier ones on purpose (the
 *   one-height rule for buttons comes after the rules that give each button its shape, the narrow-
 *   screen rules after both), so a rule is never moved or merged without checking what it overrides.
 * @structure SELKEA_ID · SELKEA_COLOURS · styleTokens · SHAPES · themeCss · selkeaTheme
 * @usage import { selkeaTheme, SELKEA_ID } from './selkea.js';
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import type { Style } from './styles.js';
import type { TokenMap } from './builtin.js';
import type { ShippedTheme } from './tiilitaivas.js';

export const SELKEA_ID = 'selkea';

/** The palette, one name per colour. test/unit/themes-selkea.test.ts holds its contrast pairs. */
export const SELKEA_COLOURS = {
    paper: '#FAFAF8', paperDeep: '#F1EFE8', paperSoft: '#F7F6F1', white: '#FFFFFF',
    ink: '#1A1A2E', textMuted: '#5A5F6E',
    accent: '#C13A2E', accentBright: '#E8564A', accentDeep: '#A8321F',
    sun: '#FFB52E', chosen: '#FFF1D0',
    rule: '#D5D2C8', ruleSoft: '#E6E3DB', scrollbar: '#8E8B82',
} as const;

const thinned = (colour: string, percent: number) => `color-mix(in srgb, ${colour} ${percent}%, transparent)`;

/** Every token a style sets. The style is light only, so one map serves both modes. */
function styleTokens(): TokenMap {
    const c = SELKEA_COLOURS;
    return {
        '--bg': c.paper, '--bg-surface': c.paperDeep, '--bg-elevated': c.white,
        '--card-bg': c.white, '--card-bg-hover': c.paperSoft, '--card-bg-solid': c.white, '--card-bg-alt': c.paperSoft, '--card-border': c.ink,
        '--accent': c.accent, '--accent-bright': c.accentBright, '--accent-deep': c.accentDeep,
        '--accent-glow': thinned(c.accent, 30), '--accent-subtle': thinned(c.accent, 8), '--accent-border': thinned(c.accent, 28),
        '--love1': c.accentBright, '--love2': c.sun, '--love3': c.accentBright, '--love4': c.sun, '--love5': c.accentBright,
        '--text': c.ink, '--text-bright': c.ink, '--text-dim': c.textMuted, '--text-muted': c.textMuted,
        '--border': c.rule, '--border-subtle': c.ruleSoft, '--border-focus': c.ink,
        '--bg-input': c.white, '--bg-input-focus': c.white, '--control-bg': c.white, '--control-border': c.ink,
        '--code-bg': c.paperDeep, '--scrollbar-thumb': c.scrollbar,
        '--morsel-bg': c.paperSoft, '--pf-hero-gradient': c.paper, '--pf-cta-gradient': c.paperSoft, '--pf-callout-gradient': c.paperSoft,
        '--sun': c.sun, '--on-sun': c.ink,
        '--ink-ground': c.ink, '--on-ink-ground': c.white,
    };
}

/** Small corners, thin ink frames, no shadows, labels in capitals with a little tracking. */
const SHAPES: Readonly<Record<string, string>> = {
    '--shape-corner': '4px', '--shape-corner-control': '3px', '--shape-corner-pill': '3px', '--shape-corner-dialog': '4px',
    '--shape-corner-soft': '3px', '--shape-corner-card': '4px',
    '--shape-frame': '1.5px', '--shape-frame-heavy': '2px', '--shape-ring': '3px',
    '--shape-frame-colour': 'var(--card-border)', '--shape-rule-colour': 'var(--border)', '--shape-field-colour': 'var(--control-border)',
    '--shape-chosen-ground': SELKEA_COLOURS.chosen,
    '--shape-shadow': 'none', '--shape-shadow-raised': 'none', '--shape-shadow-dialog': 'none',
    '--shape-shadow-action': 'none', '--shape-shadow-action-pressed': 'none', '--shape-shadow-chosen': 'none',
    '--shape-case-heading': 'none', '--font-poster-weight': '800', '--font-poster-tracking': '-0.01em', '--font-poster-leading': '1.15',
    '--shape-case-action': 'none', '--shape-tracking-action': '0', '--shape-case-label': 'uppercase', '--shape-tracking-label': '0.07em',
};

/**
 * The theme CSS: what the tokens and shape values do not reach. Every value is a token, so a hex is
 * written once, in SELKEA_COLOURS. The rules stay in this order: later groups override earlier ones.
 */
function themeCss(): string {
    return `/* Selkeä: paper ground, white boxes with an ink frame, the sun as a solid colour, one height for buttons and fields. */

/* A section is a white card on the page ground; a section inside a section is a ruled block. */
.og-sec { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--shape-corner); padding: 24px; margin-top: 20px; }
.og-sec .og-sec { border: 0; border-top: 1px solid var(--border); border-radius: 0; padding: 18px 0 0; margin-top: 18px; background: transparent; }
.og-sec .og-sec .poster-section-title { font-size: 1.15rem; }
.og-sec .og-sec .poster-section-title small.og-sec-num { min-width: 34px; height: 30px; font-size: .8rem; }
.og-sec .og-fold-sec { border-top: 1px solid var(--border); margin-top: 0; padding: 6px 0; }

/* A section's headline is a plain heading with its number in a sun tile, not a dark block. */
.poster-section-title { background: transparent; color: var(--text); border-bottom: 0; padding: 0; display: flex; align-items: center; gap: 12px; font-size: 1.375rem; }
.poster-section-title small.og-sec-num { order: -1; display: inline-flex; align-items: center; justify-content: center; min-width: 40px; height: 40px; padding: 0 10px; white-space: nowrap; border-radius: var(--shape-corner-control); background: var(--sun); color: var(--on-sun); font-family: var(--font-mono); font-size: .95rem; margin: 0; }
.poster-section-title small:not(.og-sec-num) { font-family: var(--font-mono); font-size: .8rem; font-weight: 500; color: var(--text); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--shape-corner-control); padding: 4px 9px; margin: 0; }

/* The side menu's group names are ink words in sentence case. */
.side-menu-group-title { color: var(--text); text-transform: none; letter-spacing: 0; font-weight: 800; font-size: 1rem; }
.og-strip b.og-strip-coral { color: var(--sun); }

/* The loud action is the accent. */
.poster-slab { background: var(--accent); color: var(--card-bg); }
.poster-slab:hover { background: var(--accent-deep); }

/* The figures strip is a dark band with sun figures. */
.og-strip { background: var(--ink-ground); color: var(--on-ink-ground); border: 0; border-radius: var(--shape-corner); padding: 10px 14px; }
.og-strip > div { border-color: color-mix(in srgb, var(--on-ink-ground) 22%, transparent); }
.og-strip b, .og-strip .og-strip-coral { color: var(--sun); }
.og-strip span { color: var(--on-ink-ground); }
.og-strip small { color: color-mix(in srgb, var(--on-ink-ground) 78%, transparent); }

/* The page start is a white box with an ink frame and a solid sun offset; its label stands on the sun. */
.page-start { background: var(--card-bg); border: 2px solid var(--text); border-radius: var(--shape-corner); box-shadow: 6px 6px 0 var(--sun); padding: 16px 20px; margin-bottom: 14px; }
.page-start-head .poster-label { background: var(--sun); color: var(--on-sun); padding: 4px 10px; border-radius: var(--shape-corner-control); }

/* A prompt to copy is a white box with an ink frame, and its copy action is a filled button. */
.poster-prompt { background: var(--card-bg); border: 1.5px solid var(--text); }
.poster-prompt-head { border-bottom: 1px solid var(--border); }
.poster-prompt-actions > .poster-action { background: var(--text); color: var(--card-bg); padding: 6px 14px; border: 0; border-radius: var(--shape-corner-control); text-decoration: none; }
.poster-prompt-actions > .poster-action:hover { background: var(--accent); color: var(--card-bg); }

/* A field is a box, not an underline. */
.og-input, .select-field { border: 1px solid var(--control-border); border-radius: var(--shape-corner-control); background: var(--control-bg); padding: 10px 12px; min-height: 44px; }

/* An action is a button of one shape: filled for the main one, outlined for the rest. No underlined words, no offset shadows. */
:root .poster-action { padding: 9px 16px; border: 1.5px solid var(--text); border-radius: var(--shape-corner-control); background: var(--card-bg); color: var(--text); font-weight: 700; font-size: .95rem; line-height: 1.2; text-decoration: none; text-transform: none; letter-spacing: 0; box-shadow: none; }
:root .poster-action:hover { background: var(--sun); color: var(--on-sun); }
:root .poster-action--small { padding: 6px 12px; font-size: .875rem; }
:root .poster-action--lower, :root .poster-action--soft { border-color: var(--text-dim); }
:root .poster-slab, :root .btn-primary, :root .poster-prompt-actions > .poster-action, :root .field-row > .poster-action { padding: 12px 18px; line-height: 1.2; border: 0; border-radius: var(--shape-corner-control); background: var(--text); color: var(--card-bg); font-weight: 700; text-decoration: none; text-transform: none; letter-spacing: 0; box-shadow: none; }
:root .poster-slab:hover, :root .btn-primary:hover, :root .poster-prompt-actions > .poster-action:hover, :root .field-row > .poster-action:hover { background: var(--accent); color: var(--card-bg); }
:root .og-mast .poster-slab { background: var(--accent); }
:root .og-mast .poster-slab:hover { background: var(--accent-deep); }

/* A field with its action is a boxed field and a button, not an underline inside a dashed box. */
:root .field-row { display: flex; align-items: center; gap: 8px; border: 0; background: transparent; padding: 0; }
:root .field-row > .og-input, :root .search-line > .og-input { flex: 1; min-height: 44px; padding: 0 12px; border: 1.5px solid var(--text); border-radius: var(--shape-corner-control); background: var(--card-bg); }

/* A dialog is a white sheet with an ink frame; a note in it has a frame and a sun label; its foot holds the buttons. */
:root .dlg { background: var(--card-bg); border: 1.5px solid var(--text); border-radius: var(--shape-corner-dialog); box-shadow: 0 24px 64px color-mix(in srgb, var(--text) 30%, transparent); }
:root .dlg-foot { background: var(--card-bg); border-top: 1px solid var(--border); }
:root .poster-aside { border: 1.5px solid var(--text); border-left: 6px solid var(--sun); border-radius: var(--shape-corner); background: var(--card-bg); }
:root .poster-aside > .poster-label { display: block; width: fit-content; background: var(--sun); color: var(--on-sun); padding: 3px 9px; border-radius: var(--shape-corner-control); margin-bottom: 6px; }

/* A list row's line runs unbroken across its columns. */
:root .listing--cols { column-gap: 0; }
:root .listing--cols > .listing-row > * { padding-right: 14px; }
:root .listing--cols > .listing-row > :last-child { padding-right: 0; }
/* A tab is an outlined button; the chosen one stands on the sun. */
:root .poster-tab { padding: 7px 12px; border: 1.5px solid var(--text); border-radius: var(--shape-corner-control); background: var(--card-bg); color: var(--text); font-weight: 700; text-transform: none; letter-spacing: 0; box-shadow: none; }
:root .poster-tab:hover, :root .poster-tab.is-on { background: var(--sun); color: var(--on-sun); }
/* A choice card and the classic outline button take the ink frame. */
:root .poster-choice { border: 1.5px solid var(--text); }
:root .poster-choice:hover { background: var(--sun); }
:root .btn-outline { padding: 6px 12px; border: 1.5px solid var(--text); border-radius: var(--shape-corner-control); background: var(--card-bg); color: var(--text); font-weight: 700; text-transform: none; letter-spacing: 0; text-decoration: none; }
:root .btn-outline:hover { background: var(--sun); color: var(--on-sun); }
/* The access sticker and the quick-install box: no hard shadow, the theme's corner and frame. */
:root .poster-sticker { box-shadow: none; border: 1.5px solid var(--text); border-radius: var(--shape-corner); }
:root .mcpi { border-radius: var(--shape-corner); border-color: var(--text); }
/* A status tag reads as a sentence. */
:root .poster-status { text-transform: none; letter-spacing: 0; font-size: .8rem; }
/* An opened row is a framed box. */
:root .open-card { border: 1.5px solid var(--text); border-radius: var(--shape-corner); padding: 16px 20px; }
/* The on/off switch is large enough to read and to press. */
:root .switch > i { width: 44px; height: 24px; border-radius: 4px; }
:root .switch > i::after { width: 14px; height: 14px; top: 3.5px; left: 4px; border-radius: 2px; }
:root .switch.switch--on > i::after { left: 23px; }
/* A section's state tag is white with a frame, never the page's own tone. */
.poster-section-title small:not(.og-sec-num) { background: var(--card-bg); border-color: var(--text-dim); }

/* One height for every text button: 40px, filled or outlined, large or small. */
:root .poster-action, :root .poster-action--small, :root .poster-slab, :root .btn-primary, :root .btn-outline, :root .poster-tab,
:root .poster-prompt-actions > .poster-action, :root .field-row > .poster-action {
  box-sizing: border-box; height: auto; min-height: 40px; line-height: 19px; padding-top: 9px; padding-bottom: 9px; white-space: normal; max-width: 100%; vertical-align: middle;
  border-width: 1.5px; border-style: solid; font-size: .95rem;
}
:root .poster-slab, :root .btn-primary, :root .poster-prompt-actions > .poster-action, :root .field-row > .poster-action { border-color: var(--text); padding-left: 18px; padding-right: 18px; }
:root .poster-slab:hover, :root .btn-primary:hover, :root .poster-prompt-actions > .poster-action:hover, :root .field-row > .poster-action:hover { border-color: var(--accent); }
:root .og-mast .poster-slab { border-color: var(--accent); }
:root .og-mast .poster-slab:hover { border-color: var(--accent-deep); }
:root .poster-action, :root .poster-action--small, :root .btn-outline, :root .poster-tab { padding-left: 14px; padding-right: 14px; }
:root .field-row > .og-input, :root .search-line > .og-input { min-height: 40px; height: 40px; }
:root .poster-slab--control { min-height: 40px; height: auto; }
:root .tab-row--filter > .poster-tab { font-size: .85rem; }

/* A narrow screen: the boxes give their side padding back, so what is inside keeps its width. */
@media (max-width: 700px) {
  /* A section is a flat block under an ink rule: a frame inside a frame inside a frame leaves a phone no room. */
  .og-sec { border: 0; border-top: 2px solid var(--text); border-radius: 0; background: transparent; padding: 16px 0; }
  .og-sec .og-sec { border-top: 1px solid var(--border); padding: 14px 0 0; }
  :root .open-card { padding: 10px 8px; }
  /* A list cell keeps less space on its right, so a narrow column still holds its words. */
  :root .listing--cols > .listing-row > * { padding-right: 6px; }
  :root .listing--cols > .listing-row > :last-child { padding-right: 0; }
  :root .listing--cols > .listing-row--head > * { padding-right: 0; }
  .page-start { padding: 12px 12px; box-shadow: 4px 4px 0 var(--sun); }
  .og-strip { padding: 6px 8px; }
  .poster-section-title { font-size: 1.2rem; flex-wrap: wrap; }
}

/* An action at the end of a list row is the outlined button, a little narrower than elsewhere. The list's
   action column grows to its content (listing.css v1.37.0), so the button always fits. */
:root .poster-action--row, :root .listing-row .poster-action { padding-left: 12px; padding-right: 12px; max-width: none; white-space: nowrap; }
/* The text tone of an action is plain text: a memory key or a name that opens something. */
:root .poster-action--text, :root .listing-row .poster-action--text { border-color: transparent; background: transparent; color: inherit; padding: 0; min-height: 0; font-weight: inherit; font-size: inherit; line-height: inherit; white-space: normal; text-align: left; }
:root .poster-action--text:hover { background: transparent; color: var(--accent); text-decoration: underline; }
/* A row's actions stand in one line with a small gap. */
:root .listing-row > .listing-doors { gap: 8px; }
/* A new row is marked with a sun dot after its name, not with a bar under it. */
:root .list-flag--new::after { position: static; display: inline-block; width: 9px; height: 9px; margin-left: 8px; border-radius: 2px; background: var(--sun); vertical-align: middle; }
/* The tag filter's label stands on the middle line of its buttons. */
:root .tab-row--filter { align-items: center; }
/* A name that opens its row is bold, with no line under it until the pointer is on it. */
:root .list-name-link { border-bottom-color: transparent; }
:root .list-name-link:hover { border-bottom-color: var(--text); }

/* A list's column heads are set a little tighter: this face is wider than the built-in one, and a head stood 4px past a 4rem column. */
:root .listing-row--head > .poster-label { letter-spacing: 0.02em; }

/* A select is as high as a button, and a tick box is large enough to see and stands at its first line. */
:root .select-field { min-height: 40px; height: 40px; padding-top: 0; padding-bottom: 0; }
:root .check-line > input[type=checkbox], :root .check-line > input[type=radio] { width: 18px; height: 18px; accent-color: var(--text); flex: 0 0 auto; }
:root .check-line:not(.check--inline) { align-items: flex-start; }
:root .check-line:not(.check--inline) > input { margin-top: 4px; }

/* Every field is a box as high as a button. A button stays on one line and never shrinks on a wide screen. */
:root .og-input, :root input.og-input, :root textarea.og-input, :root input.question-desk-field, :root input.input-field { border: 1.5px solid var(--text); border-radius: var(--shape-corner-control); background: var(--card-bg); padding: 0 12px; min-height: 40px; }
:root input.og-input { height: 40px; }
:root textarea.og-input { padding: 8px 12px; }
:root .og-input:focus { outline: 2px solid var(--sun); outline-offset: 1px; }
:root .poster-action, :root .poster-slab, :root .btn-primary, :root .btn-outline, :root .poster-tab { flex-shrink: 0; white-space: nowrap; }
:root .poster-action--text { white-space: normal; flex-shrink: 1; }
:root .poster-tab--filter { height: 40px; }
:root .poster-tab--filter > * { line-height: 1; }
@media (max-width: 700px) {
  :root .poster-action, :root .poster-slab, :root .btn-primary, :root .btn-outline, :root .poster-tab { white-space: normal; flex-shrink: 1; }
  :root .poster-action--row, :root .listing-row .poster-action { white-space: nowrap; flex-shrink: 0; }
}
`;
}

/** The theme as a record. `builtin` is false on the style so the theme's sheet draws it (sheet.ts). */
export function selkeaTheme(): ShippedTheme {
    const tokens = styleTokens();
    const style: Style = {
        id: SELKEA_ID, name: 'Selkeä', builtin: false,
        light: tokens, dark: { ...tokens },
        faces: { headline: 'Hanken Grotesk', body: 'Hanken Grotesk', mono: 'JetBrains Mono' },
        onlyMode: 'light', retired: false,
    };
    return {
        id: SELKEA_ID, name: 'Selkeä', builtin: true, styles: [style], defaultStyle: style.id, offeredStyles: [style.id],
        shapes: { ...SHAPES }, componentCss: {}, css: themeCss(), retired: false,
        basedOn: null, createdBy: null, createdAt: null, updatedBy: null, updatedAt: null,
    };
}
