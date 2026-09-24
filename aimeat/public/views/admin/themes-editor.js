/**
 * @file public/views/admin/themes-editor.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles' editor: one theme made or changed, previewed live in light and dark
 *   on the theme sampler (the lab's preview frame wearing the draft), and checked on every change by
 *   the node (POST /v1/themes/check): the same checks a save runs, contrast included, so what the
 *   editor shows is what the node will accept. A new theme starts as a copy of the theme it is
 *   based on; a built-in theme is never edited, only copied.
 *
 *   The colours are the site's own tokens: the eight a person reads a theme by first, the rest
 *   folded. The faces are the ones this node serves. The theme CSS may set a part's theme hooks
 *   only, and the hooks are listed beside it.
 * @structure ThemeEditor (default) · TokenRow · useDraftCheck
 * @usage html`<${ThemeEditor} themeId=${id} basedOn=${from} vocabulary=${v} themes=${list} onDone=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { h } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { apiPost, apiPut } from '/js/api.js';
import { Band } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { TextInput } from '/components/TextInput.js';
import { FormField } from '/components/FormField.js';
import { ModeSwitch } from '/components/ModeSwitch.js';
import { FoldButton } from '/components/FoldButton.js';
import { SwatchPicker } from '/components/SwatchPicker.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { tr } from './themes-tab.js';

const html = htm.bind(h);
const PREVIEW_CHANNEL = 'aimeat-theme-preview';
const HEX6 = /^#[0-9a-f]{6}$/i;
const frameSrc = (mode) => `/v1/design-lab/frame?id=theme:sampler&theme=${mode}&preview=1`;

/**
 * Ask the node about the draft after each pause in typing, and send the stylesheet it answers to the
 * preview frames (they ask for it again when they open late).
 */
function useDraftCheck(body) {
  const [check, setCheck] = useState(/** @type {any} */ (null));
  const latestCss = useRef('');
  const channel = useMemo(() => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(PREVIEW_CHANNEL)), []);
  useEffect(() => {
    if (!channel) return undefined;
    channel.onmessage = (ev) => { if (ev?.data?.type === 'ready' && latestCss.current) channel.postMessage({ type: 'draft', css: latestCss.current }); };
    return () => channel.close();
  }, [channel]);
  const key = JSON.stringify(body);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      apiPost('/v1/themes/check', bodyRef.current).then((r) => {
        if (!alive) return;
        setCheck(r.data);
        if (r.data?.stylesheet) { latestCss.current = r.data.stylesheet; channel?.postMessage({ type: 'draft', css: r.data.stylesheet }); }
      }).catch((e) => { if (alive) setCheck({ ok: false, message: e.message || String(e) }); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [key, channel]);
  return check;
}

/** One token in both modes: its words, a colour well where the value is a plain colour, and the value. */
function TokenRow({ token, light, dark, onChange }) {
  const well = (mode, value) => HEX6.test(value || '')
    ? html`<input type="color" value=${value} aria-label=${`${token.name} ${mode}`} onInput=${(e) => onChange(mode, e.target.value)} />`
    : '';
  const field = (mode, value) => html`
    <span class="text-meta">${mode === 'light' ? tr('themes.light', 'Light') : tr('themes.dark', 'Dark')}</span>
    ${well(mode, value)}
    <${TextInput} id=${`tok-${mode}-${token.name.slice(2)}`} maxLength="400" value=${value || ''} onInput=${(e) => onChange(mode, e.target.value)} />`;
  return html`
    <${NamedRow} label=${token.what}>
      <code>${token.name}</code>
      <div>${field('light', light)}</div>
      <div>${field('dark', dark)}</div>
    <//>`;
}

export default function ThemeEditor({ themeId, basedOn, vocabulary, themes, onDone }) {
  const editing = themeId ? themes.find((th) => th.id === themeId) : null;
  const base = editing ?? themes.find((th) => th.id === (basedOn || 'aimeat')) ?? themes[0];
  const [name, setName] = useState(editing ? editing.name : tr('themes.copyName', '{name} copy', { name: base.name }));
  const [light, setLight] = useState({ ...base.light });
  const [dark, setDark] = useState({ ...base.dark });
  const [faces, setFaces] = useState({ ...base.faces });
  const [css, setCss] = useState(base.css || '');
  const [onlyMode, setOnlyMode] = useState(base.onlyMode || null);
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState({ busy: false, error: '' });

  const fields = { name, light, dark, faces, css: css || null, onlyMode };
  const body = { ...fields, ...(editing ? { id: editing.id } : { basedOn: base.id }) };
  const check = useDraftCheck(body);

  const setToken = (mode, name2, value) => (mode === 'light' ? setLight : setDark)((m) => ({ ...m, [name2]: value }));
  const core = vocabulary.tokens.filter((tk) => vocabulary.core.includes(tk.name));
  const rest = vocabulary.tokens.filter((tk) => !vocabulary.core.includes(tk.name));

  const save = async () => {
    setSaving({ busy: true, error: '' });
    try {
      if (editing) await apiPut(`/v1/themes/${encodeURIComponent(editing.id)}`, fields);
      else await apiPost('/v1/themes', { ...fields, basedOn: base.id });
      onDone();
    } catch (e) {
      setSaving({ busy: false, error: e.message || String(e) });
    }
  };

  const lines = check?.contrast ?? check?.details?.contrast ?? [];
  const hooks = Object.entries(vocabulary.hooks || {});
  return html`
    <${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onDone(); }}>↩ ${tr('themes.back', 'All themes')}<//>
    <${PageIntro} title=${name || tr('themes.untitled', 'A new theme')}
      sub=${editing ? tr('themes.editing', 'Changing a theme of this node.') : tr('themes.basedOn', 'A new theme, starting from {name}.', { name: base.name })} />

    <${FormField} label=${tr('themes.name', 'Name, as the pill shows it')}>
      <${TextInput} id="theme-name" maxLength="60" value=${name} onInput=${(e) => setName(e.target.value)} />
    <//>

    <${Band} title=${tr('themes.preview', 'Preview')} tight=${true}>
      <${Specimens}>
        <${Specimen} label=${tr('themes.light', 'Light')} src=${frameSrc('light')} eager=${true} />
        <${Specimen} label=${tr('themes.dark', 'Dark')} src=${frameSrc('dark')} eager=${true} />
      <//>
    <//>

    <${Band} title=${tr('themes.contrast', 'Contrast')} tight=${true}>
      ${check && !check.ok && check.code !== 'CONTRAST' && html`<${ErrorNote} text=${check.message} />`}
      ${lines.map((r) => html`
        <${NamedRow} key=${r.mode + r.words + r.ground} label=${`${r.mode === 'light' ? tr('themes.light', 'Light') : tr('themes.dark', 'Dark')}: ${r.what}`}>
          ${r.ok ? '✓' : '✗'} ${r.ratio}:1 · ${tr('themes.atLeast', 'at least {min}:1', { min: r.min })}
        <//>`)}
    <//>

    <${Band} title=${tr('themes.colours', 'Colours')} tight=${true}>
      ${core.map((tk) => html`<${TokenRow} key=${tk.name} token=${tk} light=${light[tk.name]} dark=${dark[tk.name]}
        onChange=${(mode, v) => setToken(mode, tk.name, v)} />`)}
      <${FoldButton} on=${all} expanded=${all} onClick=${() => setAll(!all)}>
        ${all ? tr('themes.fewer', 'Show the main colours only') : tr('themes.allTokens', 'Every colour ({n})', { n: vocabulary.tokens.length })}
      <//>
      ${all && rest.map((tk) => html`<${TokenRow} key=${tk.name} token=${tk} light=${light[tk.name]} dark=${dark[tk.name]}
        onChange=${(mode, v) => setToken(mode, tk.name, v)} />`)}
    <//>

    <${Band} title=${tr('themes.faces', 'Faces')} tight=${true}>
      ${['headline', 'body', 'mono'].map((slot) => html`
        <${SwatchPicker} key=${slot} title=${tr('themes.face.' + slot, { headline: 'Headlines', body: 'Running text', mono: 'Code and addresses' }[slot])}
          hint=${tr('themes.facesHint', 'Only the faces this node serves.')} emptyLabel=${faces[slot] || '—'}
          choices=${vocabulary.faces.map((f) => ({ value: f, label: f, active: faces[slot] === f }))}
          onChoose=${(f) => setFaces({ ...faces, [slot]: f })} />`)}
    <//>

    <${Band} title=${tr('themes.modes', 'Light and dark')} tight=${true}>
      <${ModeSwitch} label=${tr('themes.modes', 'Light and dark')}>
        <${FoldButton} on=${!onlyMode} onClick=${() => setOnlyMode(null)}>${tr('themes.bothModes', 'Both, as the person chooses')}<//>
        <${FoldButton} on=${onlyMode === 'light'} onClick=${() => setOnlyMode('light')}>${tr('themes.onlyMode.light', 'Light only')}<//>
        <${FoldButton} on=${onlyMode === 'dark'} onClick=${() => setOnlyMode('dark')}>${tr('themes.onlyMode.dark', 'Dark only')}<//>
      <//>
    <//>

    <${Band} title=${tr('themes.css', 'Theme CSS')} tight=${true}>
      <${Hint}>${tr('themes.cssHint', 'Optional. A rule may set only a part\'s theme hooks, for example .poster-slab { --slab-shadow: var(--accent); }')}<//>
      ${hooks.map(([selector, entry]) => html`
        <${NamedRow} key=${selector} label=${entry.component}>
          <code>${selector}</code> ${entry.hooks.map((hk) => html`<code>${hk.name}</code> `)}
        <//>`)}
      <${FormField} label=${tr('themes.cssLabel', 'Rules')}>
        <textarea id="theme-css" class="input-field" rows="5" value=${css} onInput=${(e) => setCss(e.target.value)}></textarea>
      <//>
    <//>

    ${saving.error && html`<${ErrorNote} text=${saving.error} />`}
    <p>
      <button type="button" class="poster-action" onClick=${onDone}>${tr('themes.cancel', 'Cancel')}</button>
      <button type="button" class="poster-slab poster-slab--control" disabled=${saving.busy || !check?.ok} onClick=${save}>
        ${editing ? tr('themes.save', 'Save the theme') : tr('themes.create', 'Make the theme')}
      </button>
    </p>`;
}
