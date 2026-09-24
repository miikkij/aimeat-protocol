/**
 * @file public/views/admin/themes-bits.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pieces Themes & Styles' screens share, built from library parts: a style's colour
 *   marks, the pickers for a style and for light or dark, and the CSS editor with its warnings (S5,
 *   S6). A warning comes from the node with a code and a line, and is said here in the reader's
 *   language, because the node's own sentence is English.
 * @structure StyleMarks · Choice · ColourMark · StylePicker · ModePicker · tokenKey · warningText · checkText · CssEditor ·
 *   WarningList · versionLabel
 * @usage import { StyleMarks, CssEditor } from './themes-bits.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles).
 */
import { h } from 'preact';
import { useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { dateTime } from '/js/format.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { QuietNote } from '/components/QuietNote.js';
import { FormField } from '/components/FormField.js';
import { ModeSwitch } from '/components/ModeSwitch.js';
import { FoldButton } from '/components/FoldButton.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { TagList } from '/components/TagList.js';
import { PasteBox } from '/components/PasteBox.js';

const html = htm.bind(h);

/**
 * A style's colours at a glance: page, card, accent and sun, light above dark. An SVG with the
 * colours as fills, because they are the style's data.
 * @param {{ swatch: { light: Record<string,string>, dark: Record<string,string> }, name?: string }} props
 */
export function StyleMarks({ swatch, name }) {
  const row = (s, y) => html`
    <rect x="0" y=${y} width="14" height="10" fill=${s.bg} />
    <rect x="14" y=${y} width="14" height="10" fill=${s.card} />
    <rect x="28" y=${y} width="10" height="10" fill=${s.accent} />
    <rect x="38" y=${y} width="6" height="10" fill=${s.sun} />`;
  return html`<svg width="44" height="20" viewBox="0 0 44 20" role="img" aria-label=${name ? t('themes.marksOf', { name }) : t('themes.marks')}>
    ${row(swatch.light, 0)}${row(swatch.dark, 10)}
    <rect x="0.5" y="0.5" width="43" height="19" fill="none" stroke="currentColor" />
  </svg>`;
}

/** More choices than this and a row would run off a phone's width: a list is used instead. */
const ROW_MAX = 6;

/**
 * One choice among named values: a label, a hint, and the values as a row of fold buttons with the
 * chosen one on (the lab's filter is built the same way), or, for a longer list, a drop-down list.
 * @param {{ label: any, hint?: any, value: string, choices: Array<{ value: string, label: any }>, onChoose: (v: string) => void, id?: string }} props
 */
export function Choice({ label, hint, value, choices, onChoose, id }) {
  if (choices.length > ROW_MAX) {
    return html`<${FormField} label=${label} hint=${hint}>
      <select id=${id} class="input-field" aria-label=${typeof label === 'string' ? label : undefined} value=${value}
        onChange=${(e) => onChoose(e.currentTarget.value)}>
        ${choices.map((c) => html`<option key=${c.value} value=${c.value} selected=${c.value === value}>${c.label}</option>`)}
      </select>
    <//>`;
  }
  return html`<${FormField} label=${label} hint=${hint}>
    <${ModeSwitch} label=${label}>
      ${choices.map((c) => html`<${FoldButton} key=${c.value} on=${c.value === value} onClick=${() => onChoose(c.value)}>${c.label}<//>`)}
    <//>
  <//>`;
}

/** One colour as a small square beside its value, so a value reads as the colour it is. */
export function ColourMark({ value }) {
  // A gradient is not one colour: an SVG fill cannot draw it, so it has no square.
  if (!value || value.includes('gradient(')) return null;
  return html`<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <rect x="0.5" y="0.5" width="17" height="17" fill=${value || 'transparent'} stroke="currentColor" />
  </svg>`;
}

/** Choose one style of the theme. */
export function StylePicker({ theme, value, onChoose, title }) {
  const live = theme.styles.filter((s) => !s.retired);
  const cur = live.find((s) => s.id === value) || live[0];
  return html`<${Choice} label=${title || t('themes.showIn')} hint=${t('themes.showInHint')} value=${cur?.id}
    choices=${live.map((s) => ({ value: s.id, label: s.name }))} onChoose=${onChoose} />`;
}

/** Light or dark, as two tabs. */
export function ModePicker({ value, onChoose }) {
  return html`<${ModeTabs}>
    <${ModeTab} on=${value === 'light'} onClick=${() => onChoose('light')}>${t('themes.light')}<//>
    <${ModeTab} on=${value === 'dark'} onClick=${() => onChoose('dark')}>${t('themes.dark')}<//>
  <//>`;
}

/** '--card-bg-hover' → 'themes.token.cardBgHover', the plain name of a colour a style sets. */
export const tokenKey = (name) => 'themes.token.' + name.slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** A warning from the node's CSS check, in the reader's language. */
export function warningText(w) {
  const vars = { property: w.property || '', line: w.line };
  const key = { hides: 'themes.warn.hides', motion: 'themes.warn.motion', 'literal-colour': 'themes.warn.literalColour',
    face: 'themes.warn.face', outside: 'themes.warn.outside', loads: 'themes.warn.loads' }[w.code];
  return key ? t(key, vars) : w.text;
}

/** A finding the preview frame measured, in the reader's language. */
export function checkText(f) {
  const key = { hidden: 'themes.check.hidden', covered: 'themes.check.covered', 'small-text': 'themes.check.smallText',
    contrast: 'themes.check.contrast', 'small-target': 'themes.check.smallTarget' }[f.code];
  return key ? t(key, { what: f.what, value: f.value || '' }) : `${f.code}: ${f.what}`;
}

/** The warnings under an editor: the node's, with their line, then what the frames measured. */
export function WarningList({ warnings = [], findings = [], error }) {
  if (!warnings.length && !findings.length && !error) return html`<${QuietNote}>${t('themes.noWarnings')}<//>`;
  return html`<div>
    ${error && html`<${NamedRow} label=${t('themes.doesNotParse')}>${error}<//>`}
    ${warnings.map((w, i) => html`<${NamedRow} key=${'w' + i} label=${t('themes.line', { line: w.line })}>${warningText(w)}<//>`)}
    ${findings.map((f, i) => html`<${NamedRow} key=${'f' + i} label=${t('themes.measured')}>${checkText(f)}<//>`)}
  </div>`;
}

/**
 * The CSS editor: a text area, the component's own classes (a click puts the selector in at the
 * cursor) and the usual things to change, then the warnings.
 * @param {{ id: string, label: any, value: string, onInput: (v: string) => void, classes?: string[],
 *   usual?: Array<{ label: any, code: string }>, readOnly?: boolean }} props
 */
export function CssEditor({ id, label, value, onInput, classes = [], usual = [], readOnly = false }) {
  const area = useRef(/** @type {HTMLTextAreaElement|null} */ (null));
  const insert = (cls) => {
    const el = area.current;
    const text = `.${cls} {\n  \n}\n`;
    if (!el) { onInput(value + text); return; }
    const at = el.selectionStart ?? value.length;
    onInput(value.slice(0, at) + text + value.slice(at));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = at + cls.length + 5; });
  };
  return html`<div>
    ${classes.length > 0 && html`<${FormField} label=${t('themes.classes')} hint=${t('themes.classesHint')}>
      <${TagList} tags=${classes} prefix="." onTag=${readOnly ? undefined : insert} />
    <//>`}
    ${usual.length > 0 && html`<${FormField} label=${t('themes.usual')}>
      <div>${usual.map((u) => html`<${NamedRow} key=${u.code} label=${u.label}><code>${u.code}</code><//>`)}</div>
    <//>`}
    ${readOnly
      ? html`<${FormField} label=${label}><pre><code>${value || t('themes.noCss')}</code></pre><//>`
      : html`<${PasteBox} id=${id} label=${label} boxRef=${area} rows="10" value=${value}
          onInput=${(e) => onInput(/** @type {HTMLTextAreaElement} */ (e.currentTarget).value)} />`}
    ${!readOnly && html`<${Hint}>${t('themes.cssFree')}<//>`}
  </div>`;
}

/** "24 Sep, 14:05" in the reader's own format and time zone: short enough for a phone's row. */
export function versionLabel(at) {
  return dateTime(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
