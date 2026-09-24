/**
 * @file public/views/admin/themes-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles: the looks this AIMEAT's own pages can wear, and who chooses. Jouni:
 *   "themes & styles on siis hallinta näkymä useille teemoille ja tyyleille että niitä voi muokata ja
 *   luoda uusia teemoja ja tyylejä joita sitten käyttäjätkin voivat valita sieltä pill:stä missä on
 *   teemat. light & dark on otettava huomioon tässä myös."
 *
 *   Two parts. Who chooses: whether people pick their own theme in the pill, the one theme for
 *   everybody when they do not, which themes the pill offers and the theme a person sees first
 *   (the four themes.* settings, saved through the admin config like every other setting). The
 *   themes: each with its light and dark colours, whether it is built in, retired or in the pill,
 *   and the doors to edit it, copy it or retire it. Editing opens themes-editor.js.
 *
 *   Separate from aimeat-design-lab: the lab shows the parts and decides their looks; this view
 *   manages themes. Published apps are not affected. Built only from library parts.
 * @structure ThemesTab (default) · ThemeSwatch · WhoChooses · ThemeRow
 * @usage Mounted by the admin dashboard tab router (views/admin.js), group Design.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { saveConfig } from '/js/services/admin.js';
import { Band } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { QuietNote } from '/components/QuietNote.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { SettingsSwitch } from '/components/SettingsSwitch.js';
import { SwatchPicker } from '/components/SwatchPicker.js';
import ThemeEditor from './themes-editor.js';

const html = htm.bind(h);
/** A locale string, or its English fallback, with {name} placeholders filled either way. */
export const tr = (key, fallback, vars = {}) => {
  const v = t(key, vars);
  if (v && v !== key) return v;
  return Object.entries(vars).reduce((s, [k, x]) => s.replaceAll(`{${k}}`, String(x)), fallback);
};

/**
 * A theme's colours at a glance: the page, a card, the accent and the sun, light above dark. An
 * SVG with the colours as fills, because they are the theme's data.
 */
export function ThemeSwatch({ swatch, sun }) {
  const row = (s, y) => html`
    <rect x="0" y=${y} width="28" height="16" fill=${s.bg} />
    <rect x="28" y=${y} width="28" height="16" fill=${s.card} />
    <rect x="56" y=${y} width="20" height="16" fill=${s.accent} />
    <rect x="76" y=${y} width="12" height="16" fill=${sun || '#FFB52E'} />`;
  return html`<svg width="88" height="32" viewBox="0 0 88 32" role="img" aria-label=${tr('themes.swatch', 'Light and dark colours')}>
    ${row(swatch.light, 0)}${row(swatch.dark, 16)}
    <rect x="0.5" y="0.5" width="87" height="31" fill="none" stroke="currentColor" />
  </svg>`;
}

/** The operator's four choices, edited here and saved together. */
function WhoChooses({ policy, themes, onSaved }) {
  const live = themes.filter((th) => !th.retired);
  const [personal, setPersonal] = useState(policy.personalChoice);
  const [fixed, setFixed] = useState(policy.fixed);
  const [offered, setOffered] = useState(policy.offered);
  const [def, setDef] = useState(policy.default);
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const nameOf = (id) => themes.find((th) => th.id === id)?.name ?? id;
  const toggle = (id) => setOffered(offered.includes(id) ? offered.filter((x) => x !== id) : [...offered, id]);

  const save = async () => {
    setState({ busy: true, error: '', saved: false });
    const list = live.map((th) => th.id).filter((id) => offered.includes(id));
    // Every theme offered is written as empty, which also offers a theme made later.
    const csv = list.length === live.length ? '' : list.join(',');
    const theDefault = list.includes(def) ? def : (list[0] ?? 'aimeat');
    try {
      await saveConfig([
        { path: 'themes.personal_choice', value: personal },
        { path: 'themes.fixed', value: fixed },
        { path: 'themes.offered', value: csv },
        { path: 'themes.default', value: theDefault },
      ]);
      setState({ busy: false, error: '', saved: true });
      onSaved();
    } catch (e) {
      setState({ busy: false, error: e.message || String(e), saved: false });
    }
  };

  return html`
    <${Band} title=${tr('themes.whoChooses', 'Who chooses')}>
      <${SettingsSwitch} checked=${personal} onChange=${() => setPersonal(!personal)}>
        ${tr('themes.personalChoice', 'People choose their own theme in the pill')}
      <//>
      ${personal ? html`
        <${Hint}>${tr('themes.offeredHint', 'The themes the pill offers. A signed-in person\'s choice is saved to their account and follows them to every device.')}<//>
        ${live.map((th) => html`
          <${SettingsSwitch} key=${th.id} checked=${offered.includes(th.id)} onChange=${() => toggle(th.id)}>
            ${tr('themes.inThePill', 'In the pill: {name}', { name: th.name })}
          <//>`)}
        <${SwatchPicker} title=${tr('themes.default', 'Before a person chooses')}
          hint=${tr('themes.defaultHint', 'The theme a visitor and a new person see first.')}
          emptyLabel=${nameOf(def)}
          choices=${live.filter((th) => offered.includes(th.id)).map((th) => ({ value: th.id, label: th.name, active: th.id === def }))}
          onChoose=${setDef} />`
      : html`
        <${SwatchPicker} title=${tr('themes.fixed', 'The theme for everybody')}
          hint=${tr('themes.fixedHint', 'Every page wears this theme and the pill shows no choice.')}
          emptyLabel=${nameOf(fixed)}
          choices=${live.map((th) => ({ value: th.id, label: th.name, active: th.id === fixed }))}
          onChoose=${setFixed} />`}
      <p>
        <button type="button" class="poster-slab poster-slab--control" disabled=${state.busy} onClick=${save}>
          ${tr('themes.saveChoices', 'Save who chooses')}
        </button>
        ${state.saved && html` <span class="text-meta">${tr('themes.saved', 'Saved. The next page load wears it.')}</span>`}
      </p>
      ${state.error && html`<${ErrorNote} text=${state.error} />`}
    <//>`;
}

/** One theme: its colours, what it is, and what can be done with it. */
function ThemeRow({ theme, offered, onEdit, onCopy, onRetire }) {
  const failing = (theme.contrast || []).filter((r) => !r.ok).length;
  const facts = [
    theme.builtin ? tr('themes.builtin', 'built in, read only') : tr('themes.own', 'this node\'s own'),
    theme.retired ? tr('themes.retired', 'retired') : offered ? tr('themes.offered', 'in the pill') : tr('themes.notOffered', 'not in the pill'),
    theme.onlyMode ? tr('themes.onlyMode.' + theme.onlyMode, theme.onlyMode + ' only') : '',
    failing ? tr('themes.contrastMisses', '{n} contrast lines miss', { n: failing }) : '',
  ].filter(Boolean).join(' · ');
  return html`
    <${NamedRow} label=${theme.name}>
      <${ThemeSwatch} swatch=${theme.swatch} sun=${theme.light['--sun']} />
      <span class="text-meta"> ${facts}</span>
      <div>
        ${!theme.builtin && html`<button type="button" class="poster-action" onClick=${onEdit}>${tr('themes.edit', 'Edit')}</button> `}
        <button type="button" class="poster-action" onClick=${onCopy}>${tr('themes.copy', 'Make a copy')}</button>
        ${!theme.builtin && html` <button type="button" class="poster-action" onClick=${onRetire}>
          ${theme.retired ? tr('themes.restore', 'Bring back') : tr('themes.retire', 'Retire')}</button>`}
      </div>
    <//>`;
}

export default function ThemesTab() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(/** @type {null | { id?: string, basedOn?: string }} */ (null));

  const load = useCallback(() => {
    apiGet('/v1/themes/all').then((r) => { setData(r.data); setError(''); }).catch((e) => setError(e.message || String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('aimeat-live-update', load);
    return () => window.removeEventListener('aimeat-live-update', load);
  }, [load]);

  const retire = async (theme) => {
    try { await apiPut(`/v1/themes/${encodeURIComponent(theme.id)}`, { retired: !theme.retired }); load(); }
    catch (e) { setError(e.message || String(e)); }
  };

  if (error && !data) return html`<${ErrorNote} text=${error} />`;
  if (!data) return html`<${QuietNote}>…<//>`;
  if (editing) {
    return html`<${ThemeEditor} themeId=${editing.id} basedOn=${editing.basedOn} vocabulary=${data.vocabulary}
      themes=${data.themes} onDone=${() => { setEditing(null); load(); }} />`;
  }
  return html`
    <${Hint}>${tr('themes.intro', 'The looks this AIMEAT\'s own pages can wear, each in light and dark. Published apps keep their own. A theme changes colours and faces; its own CSS may change a part only through the part\'s theme hooks.')}<//>
    ${error && html`<${ErrorNote} text=${error} />`}
    <${WhoChooses} policy=${data.policy} themes=${data.themes} onSaved=${load} />
    <${Band} title=${tr('themes.themes', 'Themes')}>
      <p><button type="button" class="poster-slab poster-slab--control" onClick=${() => setEditing({ basedOn: 'aimeat' })}>
        ${tr('themes.new', 'Make a theme')}</button></p>
      ${data.themes.map((th) => html`
        <${ThemeRow} key=${th.id} theme=${th} offered=${data.policy.offered.includes(th.id)}
          onEdit=${() => setEditing({ id: th.id })}
          onCopy=${() => setEditing({ basedOn: th.id })}
          onRetire=${() => retire(th)} />`)}
    <//>`;
}
