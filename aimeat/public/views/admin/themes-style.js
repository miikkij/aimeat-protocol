/**
 * @file public/views/admin/themes-style.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One style of a theme (S3): its colours in light and dark side by side, grouped by what
 *   they do and each called by a plain name (the token's own name only under Details); its three
 *   faces, from the faces this server serves; its mode, both or one. The contrast lines are worked
 *   out by the node on every pause in editing ("words on the page: 11.2, needs 4.5"); a line under
 *   its minimum is a warning, and the style can still be saved (07, Q2). Two preview frames show
 *   the style on the theme sampler in light and dark while it is edited.
 * @structure StyleScreen (default) · GROUPS · tokenKey · ColourRow · contrastKey
 * @usage html`<${StyleScreen} theme=${theme} styleId=${id} vocabulary=${v} readOnly=${false} onBack=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles S3).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiPut } from '/js/api.js';
import { Band } from '/components/Band.js';
import { ActionRow } from '/components/ActionRow.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { TextInput } from '/components/TextInput.js';
import { FormField } from '/components/FormField.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { Collapsible } from '/components/Collapsible.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { useDraftSheets, componentFrame } from './themes-draft.js';
import { Choice, ColourMark, tokenKey } from './themes-bits.js';

const html = htm.bind(h);
const HEX6 = /^#[0-9a-f]{6}$/i;

/** The eight colours a person reads a style by: shown first, the rest folded under them. */
const MAIN = ['--bg', '--card-bg', '--text', '--text-dim', '--accent', '--sun', '--on-sun', '--border'];

/**
 * The colours by what they do, in the order a person reads a style.
 * @type {Array<[string, string[]]>}
 */
const GROUPS = [
  ['page', ['--bg', '--bg-surface', '--bg-elevated']],
  ['words', ['--text', '--text-bright', '--text-dim', '--text-muted']],
  ['accent', ['--accent', '--accent-bright', '--accent-deep', '--accent-glow', '--accent-subtle', '--accent-border']],
  ['sun', ['--sun', '--on-sun']],
  ['cards', ['--card-bg', '--card-bg-hover', '--card-bg-solid', '--card-bg-alt', '--card-border']],
  ['lines', ['--border', '--border-subtle', '--border-focus']],
  ['fields', ['--bg-input', '--bg-input-focus', '--control-bg', '--control-border', '--code-bg', '--scrollbar-thumb']],
  ['love', ['--love1', '--love2', '--love3', '--love4', '--love5']],
  ['gradients', ['--morsel-bg', '--pf-hero-gradient', '--pf-cta-gradient', '--pf-callout-gradient']],
];


/** A contrast line's words, by the pair it measures. */
const CONTRAST_KEYS = {
  '--text|--bg': 'themes.contrast.wordsOnPage', '--text|--card-bg': 'themes.contrast.wordsOnCard',
  '--text-dim|--bg': 'themes.contrast.quietOnPage', '--text-dim|--card-bg': 'themes.contrast.quietOnCard',
  '--accent|--bg': 'themes.contrast.accentOnPage', '--accent|--card-bg': 'themes.contrast.accentOnCard',
  '--on-sun|--sun': 'themes.contrast.wordsOnSun',
};
const contrastWhat = (r) => (CONTRAST_KEYS[`${r.words}|${r.ground}`] ? t(CONTRAST_KEYS[`${r.words}|${r.ground}`]) : r.what);

/** One colour in both modes: its plain name, a colour well where the value is a plain colour, the value. */
function ColourRow({ name, light, dark, readOnly, onChange }) {
  const field = (mode, value) => html`<div>
    <span class="text-meta">${mode === 'light' ? t('themes.light') : t('themes.dark')} </span>
    ${(readOnly || !HEX6.test(value || '')) && html`<${ColourMark} value=${value} /> `}
    ${readOnly
      ? html`<code>${value}</code>`
      : html`${HEX6.test(value || '') && html`<input type="color" value=${value} aria-label=${t('themes.colourIn', { name: t(tokenKey(name)), mode: mode === 'light' ? t('themes.light') : t('themes.dark') })}
            onInput=${(e) => onChange(mode, e.currentTarget.value)} /> `}
        <${TextInput} id=${`tok-${mode}-${name.slice(2)}`} maxLength="400" value=${value || ''} onInput=${(e) => onChange(mode, e.target.value)} />`}
  </div>`;
  return html`<${NamedRow} label=${t(tokenKey(name))}>${field('light', light)}${field('dark', dark)}<//>`;
}

export default function StyleScreen({ theme, styleId, vocabulary, readOnly, onBack }) {
  const saved = theme.styles.find((s) => s.id === styleId);
  const [light, setLight] = useState({ ...saved.light });
  const [dark, setDark] = useState({ ...saved.dark });
  const [faces, setFaces] = useState({ ...saved.faces });
  const [onlyMode, setOnlyMode] = useState(saved.onlyMode || null);
  const [name, setName] = useState(saved.name);
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const [details, setDetails] = useState(false);
  const [every, setEvery] = useState(false);

  // The theme with this style as edited; useDraftSheets sends it again only when its content changes.
  const draftStyle = { ...saved, name, light, dark, faces, onlyMode };
  const out = useDraftSheets({ style: { ...theme, styles: theme.styles.map((s) => (s.id === styleId ? draftStyle : s)) } });
  const lines = out.style?.warnings?.contrast?.[styleId] ?? [];
  const failing = lines.filter((r) => !r.ok);
  const refused = out.style?.refused ?? [];

  const set = (mode, token, value) => (mode === 'light' ? setLight : setDark)((m) => ({ ...m, [token]: value }));
  const changed = JSON.stringify({ name, light, dark, faces, onlyMode }) !== JSON.stringify({ name: saved.name, light: saved.light, dark: saved.dark, faces: saved.faces, onlyMode: saved.onlyMode || null });
  const undo = () => { setLight({ ...saved.light }); setDark({ ...saved.dark }); setFaces({ ...saved.faces }); setOnlyMode(saved.onlyMode || null); setName(saved.name); };
  const save = async () => {
    setState({ busy: true, error: '', saved: false });
    try {
      await apiPut(`/v1/themes/${encodeURIComponent(theme.id)}/styles/${encodeURIComponent(styleId)}`, { name, light, dark, faces, onlyMode: onlyMode || '' });
      setState({ busy: false, error: '', saved: true });
    } catch (e) {
      setState({ busy: false, error: e.message || String(e), saved: false });
    }
  };
  const frame = (mode) => componentFrame({ id: 'theme:sampler', mode, key: 'style', style: styleId });

  return html`
    <${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${t('themes.backToTheme', { name: theme.name })}<//>
    <${PageIntro} title=${name} sub=${readOnly ? t('themes.builtinStyle') : t('themes.styleOf', { name: theme.name })} />
    ${readOnly && html`<${Hint}>${t('themes.builtinHint')}<//>`}
    ${!readOnly && html`<${FormField} label=${t('themes.name')} hint=${t('themes.nameHint')}>
      <${TextInput} id="style-name" maxLength="60" value=${name} onInput=${(e) => setName(e.target.value)} />
    <//>`}

    <${Band} title=${t('themes.preview')} tight=${true}>
      <${Specimens}>
        <${Specimen} label=${t('themes.light')} src=${frame('light')} eager=${true} />
        <${Specimen} label=${t('themes.dark')} src=${frame('dark')} eager=${true} />
      <//>
    <//>

    <${Band} title=${t('themes.contrastTitle')} tight=${true}>
      ${lines.length > 0 && html`<p>${failing.length ? t('themes.contrastSome', { n: failing.length, total: lines.length }) : t('themes.contrastAll', { total: lines.length })}</p>`}
      ${failing.length > 0 && html`<${Hint}>${t('themes.contrastHint')}<//>`}
      ${failing.map((r) => html`
        <${NamedRow} key=${r.mode + r.words + r.ground} label=${`${r.mode === 'light' ? t('themes.light') : t('themes.dark')}: ${contrastWhat(r)}`}>
          ✗ ${t('themes.contrastLine', { ratio: Math.round(r.ratio * 10) / 10, min: r.min })}
        <//>`)}
      ${refused.map((x) => html`<${ErrorNote} key=${x} text=${x} />`)}
    <//>

    <${Band} title=${t('themes.mainColours')} tight=${true}>
      <${Hint}>${t('themes.accentOthers')}<//>
      ${MAIN.map((tk) => html`<${ColourRow} key=${tk} name=${tk} light=${light[tk]} dark=${dark[tk]} readOnly=${readOnly} onChange=${(mode, v) => set(mode, tk, v)} />`)}
    <//>
    <${Collapsible} title=${t('themes.everyColour', { n: GROUPS.flatMap(([, tokens]) => tokens).filter((tk) => !MAIN.includes(tk)).length })} open=${every} onToggle=${() => setEvery(!every)}>
      ${/* A group whose colours are all among the main ones has nothing left to show here. */''}
      ${GROUPS.filter(([, tokens]) => tokens.some((tk) => !MAIN.includes(tk))).map(([group, tokens]) => html`
        <section key=${group}>
          <h3 class="poster-section-title">${t('themes.group.' + group)}</h3>
          ${tokens.filter((tk) => !MAIN.includes(tk)).map((tk) => html`<${ColourRow} key=${tk} name=${tk} light=${light[tk]} dark=${dark[tk]} readOnly=${readOnly} onChange=${(mode, v) => set(mode, tk, v)} />`)}
        </section>`)}
    <//>

    <${Band} title=${t('themes.faces')} tight=${true}>
      ${!readOnly && html`<${Hint}>${t('themes.facesHint')}<//>`}
      ${['headline', 'body', 'mono'].map((slot) => html`
        ${readOnly
          ? html`<${NamedRow} key=${slot} label=${t('themes.face.' + slot)}>${faces[slot] || t('themes.faceAsBuilt')}<//>`
          : html`<${Choice} key=${slot} label=${t('themes.face.' + slot)} value=${faces[slot] || ''}
            choices=${[{ value: '', label: t('themes.faceAsBuilt') }, ...vocabulary.faces.map((f) => ({ value: f, label: f }))]}
            onChoose=${(f) => setFaces({ ...faces, [slot]: f || undefined })} />`}`)}
    <//>

    <${Band} title=${t('themes.mode')} tight=${true}>
      <${Hint}>${t('themes.modeHint')}<//>
      ${readOnly
        ? html`<p>${onlyMode === 'light' ? t('themes.lightOnly') : onlyMode === 'dark' ? t('themes.darkOnly') : t('themes.bothModes')}</p>`
        : html`<${ModeTabs}>
          <${ModeTab} on=${!onlyMode} onClick=${() => setOnlyMode(null)}>${t('themes.bothModes')}<//>
          <${ModeTab} on=${onlyMode === 'light'} onClick=${() => setOnlyMode('light')}>${t('themes.lightOnly')}<//>
          <${ModeTab} on=${onlyMode === 'dark'} onClick=${() => setOnlyMode('dark')}>${t('themes.darkOnly')}<//>
        <//>`}
    <//>

    <${Collapsible} title=${t('themes.details')} open=${details} onToggle=${() => setDetails(!details)}>
      ${GROUPS.flatMap(([, tokens]) => tokens).map((tk) => html`<${NamedRow} key=${tk} label=${t(tokenKey(tk))}><code>${tk}</code><//>`)}
    <//>

    ${!readOnly && html`
      ${state.error && html`<${ErrorNote} text=${state.error} />`}
      <${ActionRow}>
        <button type="button" class="poster-action" disabled=${!changed} onClick=${undo}>${t('themes.undo')}</button>
        <button type="button" class="poster-slab poster-slab--control" disabled=${state.busy || refused.length > 0} onClick=${save}>${t('themes.saveStyle')}</button>
        ${state.saved && html`<span class="text-meta">${t('themes.saved')}</span>`}
      <//>`}`;
}
