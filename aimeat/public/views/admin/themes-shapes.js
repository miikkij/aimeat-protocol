/**
 * @file public/views/admin/themes-shapes.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A theme's shapes in Themes & Styles: its corners, frames, shadows and letter case,
 *   the values every component reads (07 "New components follow the theme"). Jouni: "katsoo että
 *   pebble syntyy myös niille uusille tehdyille komponenteille mitä tullaan tekemään kun tehdään
 *   settings & controls kirjastoon."
 *
 *   Each value is named by what it shapes, with the built-in value beside it; an empty field keeps
 *   the built-in one. The frames show the edited shapes live on the sample page and on the
 *   components that read them most, in a style and a mode chosen above them. A value that does not
 *   fit its kind is named by the node and left out of the frames, and Save is off until it fits.
 * @structure ShapesTab (default) · keyOf · GROUPS · spaced · SHOWN
 * @usage html`<${ShapesTab} theme=${theme} vocabulary=${v} readOnly=${false} onSaved=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiPut } from '/js/api.js';
import { Band } from '/components/Band.js';
import { ActionRow } from '/components/ActionRow.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { TextInput } from '/components/TextInput.js';
import { Specimens, Specimen } from '/components/Specimen.js';
import { StylePicker, ModePicker } from './themes-bits.js';
import { useDraftSheets, componentFrame } from './themes-draft.js';

const html = htm.bind(h);

/** '--shape-corner-control' → 'shapeCornerControl', the key of its plain name. */
const keyOf = (name) => name.slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const GROUPS = ['corners', 'frames', 'shadows', 'type'];

/** 'prompt-card' → 'Prompt card', as the Components tab names a component. */
const spaced = (id) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');

/** The sample page, then the components that read the shapes most. */
const SHOWN = ['theme:sampler', 'dialog', 'record', 'choice', 'text-input', 'prompt-card'];

export default function ShapesTab({ theme, vocabulary, readOnly, onSaved }) {
  const saved = theme.shapes || {};
  const [values, setValues] = useState(/** @type {Record<string, string>} */ ({ ...saved }));
  const [style, setStyle] = useState(theme.defaultStyle);
  const [mode, setMode] = useState('light');
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const shapes = vocabulary.shapes || [];

  // Only what is filled in is the theme's own; an empty field keeps the built-in value.
  const own = useMemo(() => Object.fromEntries(Object.entries(values).filter(([, v]) => String(v || '').trim())), [values]);
  const out = useDraftSheets({ shapes: { ...theme, shapes: own } });
  const refused = out.shapes?.refused ?? [];
  const changed = JSON.stringify(own) !== JSON.stringify(Object.fromEntries(Object.entries(saved).filter(([, v]) => String(v || '').trim())));

  const save = async () => {
    setState({ busy: true, error: '', saved: false });
    // Every value the theme had and no longer has goes back as empty, which puts the built-in one back.
    const body = { ...Object.fromEntries(Object.keys(saved).filter((k) => !own[k]).map((k) => [k, ''])), ...own };
    try {
      await apiPut(`/v1/themes/${encodeURIComponent(theme.id)}`, { shapes: body });
      setState({ busy: false, error: '', saved: true });
      onSaved();
    } catch (e) {
      setState({ busy: false, error: e.message || String(e), saved: false });
    }
  };

  return html`
    <${Band}>
      <${Hint}>${t('themes.shapesHint')}<//>
      <${StylePicker} theme=${{ ...theme, styles: theme.styles.filter((s) => !s.retired) }} value=${style} onChoose=${setStyle} />
      <${ModePicker} value=${mode} onChoose=${setMode} />
      <${Specimens}>
        ${SHOWN.map((id) => html`<${Specimen} key=${id + style + mode} label=${id === 'theme:sampler' ? t('themes.sampler') : spaced(id)}
          src=${componentFrame({ id, mode, key: 'shapes', style })} eager=${id === 'theme:sampler'} />`)}
      <//>
    <//>
    ${!readOnly && html`<${Hint}>${t('themes.shapeEmpty')}<//>`}
    ${GROUPS.map((group) => html`
      <${Band} key=${group} title=${t('themes.shapeGroup.' + group)} tight=${true}>
        ${shapes.filter((s) => s.group === group).map((s) => html`
          <${NamedRow} key=${s.name} label=${t('themes.shape.' + keyOf(s.name))}><div>
            ${readOnly
              ? html`<code>${values[s.name] || s.builtin || ''}</code>`
              : html`<${TextInput} id=${'shape' + s.name.slice(1)} maxLength="200" value=${values[s.name] || ''} placeholder=${s.builtin || ''}
                  onInput=${(e) => setValues({ ...values, [s.name]: e.target.value })} />`}
            <p class="text-meta">${t('themes.shapeBuiltin', { value: s.builtin ?? '' })}</p>
          </div><//>`)}
      <//>`)}
    ${refused.map((r) => html`<${ErrorNote} key=${r} text=${t('themes.shapeRefused', { reason: r })} />`)}
    ${!readOnly && html`
      ${state.error && html`<${ErrorNote} text=${state.error} />`}
      <${ActionRow}>
        <button type="button" class="poster-action" disabled=${!changed} onClick=${() => setValues({ ...saved })}>${t('themes.undo')}</button>
        <button type="button" class="poster-slab poster-slab--control" disabled=${state.busy || !changed || refused.length > 0} onClick=${save}>${t('themes.saveShapes')}</button>
        ${state.saved && html`<span class="text-meta">${t('themes.saved')}</span>`}
      <//>`}`;
}
