/**
 * @file public/views/admin/themes-theme.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One theme in Themes & Styles, opened: its name, and four tabs. Styles (S2): each
 *   style with its colours in light and dark, whether the pill offers it, which one is the default,
 *   and the doors to open (S3, themes-style.js), copy and retire it. Components (S4 and S5,
 *   themes-components.js). Theme CSS (S6, themes-css.js). On real pages (S7, themes-pages.js).
 *
 *   A built-in theme is shown read only, with the door to copy it (07: "copy them to change them").
 * @structure ThemeScreen (default) · StylesTab
 * @usage html`<${ThemeScreen} themeId=${id} policy=${p} vocabulary=${v} onBack=${fn} onCopied=${fn} />`
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4, Themes & Styles S2).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';
import { Band } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { QuietNote } from '/components/QuietNote.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { SettingsSwitch } from '/components/SettingsSwitch.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { Modal } from '/components/Modal.js';
import { FormField } from '/components/FormField.js';
import { TextInput } from '/components/TextInput.js';
import { ActionRow } from '/components/ActionRow.js';
import { StyleMarks, useOpenAtTop } from './themes-bits.js';
import StyleScreen from './themes-style.js';
import ComponentsTab from './themes-components.js';
import ThemeCssTab from './themes-css.js';
import PagesTab from './themes-pages.js';

const html = htm.bind(h);

/** S2: the styles of the theme. */
function StylesTab({ theme, readOnly, onOpen, onChange, onRename }) {
  const put = (body) => onChange(() => apiPut(`/v1/themes/${encodeURIComponent(theme.id)}`, body));
  const toggleOffer = (id) => put({ offeredStyles: theme.offeredStyles.includes(id) ? theme.offeredStyles.filter((x) => x !== id) : [...theme.offeredStyles, id] });
  const copy = (s) => onChange(() => apiPost(`/v1/themes/${encodeURIComponent(theme.id)}/styles`, { basedOn: s.id, name: t('themes.copyName', { name: s.name }) }));
  const retire = (s) => onChange(() => apiPut(`/v1/themes/${encodeURIComponent(theme.id)}/styles/${encodeURIComponent(s.id)}`, { retired: !s.retired }));
  return html`
    <${Band}>
      <${Hint}>${t('themes.stylesHint')}<//>
      ${!readOnly && html`<${ActionRow}>
        <button type="button" class="poster-slab poster-slab--control" onClick=${() => copy(theme.styles.find((s) => s.id === theme.defaultStyle) || theme.styles[0])}>${t('themes.newStyle')}</button>
        <button type="button" class="poster-action" onClick=${onRename}>${t('themes.renameTheme')}</button>
      <//>`}
      ${theme.styles.map((s) => html`
        <${NamedRow} key=${s.id} label=${s.name}><div>
          <${StyleMarks} swatch=${s.swatch} name=${s.name} />
          <p class="text-meta">${[
            // The switch below says whether the look picker offers it. Without a switch (a built-in
            // theme) only the exception is said: a style the picker leaves out.
            s.retired ? t('themes.retired') : readOnly && !theme.offeredStyles.includes(s.id) ? t('themes.notInPill') : '',
            theme.defaultStyle === s.id ? t('themes.isDefaultStyle') : '',
            s.onlyMode === 'light' ? t('themes.factLightOnly') : s.onlyMode === 'dark' ? t('themes.factDarkOnly') : '',
            s.contrastMissing?.length ? t('themes.contrastMisses', { n: s.contrastMissing.length }) : '',
          ].filter(Boolean).join(' · ')}</p>
          ${!readOnly && !s.retired && html`
            <${SettingsSwitch} checked=${theme.offeredStyles.includes(s.id)} onChange=${() => toggleOffer(s.id)}>${t('themes.offerInPill')}<//>`}
          <${ActionRow}>
            <button type="button" class="poster-action" onClick=${() => onOpen(s.id)}>${t('themes.open')}</button>
            ${!readOnly && html`<button type="button" class="poster-action" onClick=${() => copy(s)}>${t('themes.copy')}</button>`}
            ${!readOnly && theme.defaultStyle !== s.id && !s.retired && html`<button type="button" class="poster-action" onClick=${() => put({ defaultStyle: s.id })}>${t('themes.makeDefault')}</button>`}
            ${!readOnly && theme.defaultStyle !== s.id && html`<button type="button" class="poster-action" onClick=${() => retire(s)}>${s.retired ? t('themes.bringBack') : t('themes.retire')}</button>`}
          <//>
        </div><//>`)}
    <//>`;
}

/** Rename the theme. */
function RenameDialog({ theme, onClose, onSaved }) {
  const [name, setName] = useState(theme.name);
  const [error, setError] = useState('');
  const save = async () => {
    try { await apiPut(`/v1/themes/${encodeURIComponent(theme.id)}`, { name }); onSaved(); } catch (e) { setError(e.message || String(e)); }
  };
  const footer = html`
    <button type="button" class="poster-action" onClick=${onClose}>${t('themes.cancel')}</button>
    <button type="button" class="poster-slab poster-slab--control" onClick=${save}>${t('themes.save')}</button>`;
  return html`<${Modal} open=${true} onClose=${onClose} size="sm" title=${t('themes.rename')} footer=${footer}>
    <${FormField} label=${t('themes.name')} hint=${t('themes.nameHint')}>
      <${TextInput} id="theme-rename" maxLength="60" value=${name} onInput=${(e) => setName(e.target.value)} />
    <//>
    ${error && html`<${ErrorNote} text=${error} />`}
  <//>`;
}

export default function ThemeScreen({ themeId, policy, vocabulary, onBack, onCopied }) {
  const [theme, setTheme] = useState(/** @type {any} */ (null));
  const [warnings, setWarnings] = useState(/** @type {any} */ (null));
  const [tab, setTab] = useState('styles');
  const [style, setStyle] = useState(/** @type {string|null} */ (null));
  const [renaming, setRenaming] = useState(false);
  const [pages, setPages] = useState(/** @type {{ path?: string, draft?: any }} */ ({}));
  const [error, setError] = useState('');
  useOpenAtTop(`${themeId}|${style || ''}`);

  const load = useCallback(async () => {
    try {
      const [one, all] = await Promise.all([apiGet(`/v1/themes/${encodeURIComponent(themeId)}`), apiGet('/v1/themes/all')]);
      // The whole record from /:id, and each style's colour marks and missed contrast lines from /all.
      const listed = all.data.themes.find((th) => th.id === themeId);
      const styles = one.data.theme.styles.map((s) => ({ ...s, ...(listed?.styles.find((x) => x.id === s.id) || {}) }));
      setTheme({ ...one.data.theme, styles, componentCssState: listed?.componentCssState || {} });
      setWarnings(one.data.warnings);
      setError('');
    } catch (e) {
      setError(e.message || String(e));
    }
  }, [themeId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('aimeat-live-update', load);
    return () => window.removeEventListener('aimeat-live-update', load);
  }, [load]);

  const change = async (fn) => { try { await fn(); await load(); } catch (e) { setError(e.message || String(e)); } };
  const copyTheme = async () => {
    try {
      const r = await apiPost('/v1/themes', { name: t('themes.copyName', { name: theme.name }), basedOn: theme.id });
      onCopied(r.data.theme.id);
    } catch (e) { setError(e.message || String(e)); }
  };

  const back = html`<${BackLink} href="#" onClick=${(e) => { e.preventDefault(); onBack(); }}>↩ ${t('themes.allThemes')}<//>`;
  if (error && !theme) return html`${back}<${ErrorNote} text=${error} />`;
  if (!theme) return html`${back}<${QuietNote}>${t('themes.loading')}<//>`;
  const readOnly = theme.builtin;
  if (style) {
    return html`<${StyleScreen} theme=${theme} styleId=${style} vocabulary=${vocabulary} readOnly=${readOnly}
      onBack=${() => { setStyle(null); load(); }} />`;
  }
  const facts = [
    // A built-in theme says so once, in the hint under the title.
    readOnly ? '' : t('themes.own'),
    // Whether people can choose it is said by its switch under "Who chooses", on the first screen.
    policy.default === theme.id ? t('themes.isDefault') : '',
    theme.retired ? t('themes.retired') : '',
  ].filter(Boolean).join(' · ');
  return html`
    ${back}
    <${PageIntro} title=${theme.name} sub=${facts} />
    ${readOnly
      ? html`<${Hint}>${t('themes.builtinHint')}<//>
        <p><button type="button" class="poster-slab poster-slab--control" onClick=${copyTheme}>${t('themes.copyToChange')}</button></p>`
      : ''}
    ${error && html`<${ErrorNote} text=${error} />`}
    <${ModeTabs}>
      <${ModeTab} on=${tab === 'styles'} onClick=${() => setTab('styles')}>${t('themes.tab.styles')}<//>
      <${ModeTab} on=${tab === 'components'} onClick=${() => setTab('components')}>${t('themes.tab.components')}<//>
      <${ModeTab} on=${tab === 'css'} onClick=${() => setTab('css')}>${t('themes.tab.css')}<//>
      <${ModeTab} on=${tab === 'pages'} onClick=${() => { setPages({}); setTab('pages'); }}>${t('themes.tab.pages')}<//>
    <//>
    ${tab === 'styles' && html`<${StylesTab} theme=${theme} readOnly=${readOnly} onOpen=${setStyle} onChange=${change} onRename=${() => setRenaming(true)} />`}
    ${tab === 'components' && html`<${ComponentsTab} theme=${theme} readOnly=${readOnly} onSaved=${load}
      onOpenPage=${(path, draft) => { setPages({ path, draft }); setTab('pages'); }} />`}
    ${tab === 'css' && html`<${ThemeCssTab} theme=${theme} warnings=${warnings} readOnly=${readOnly} onSaved=${load} />`}
    ${tab === 'pages' && html`<${PagesTab} theme=${theme} path=${pages.path} draft=${pages.draft} />`}
    ${renaming && html`<${RenameDialog} theme=${theme} onClose=${() => setRenaming(false)} onSaved=${() => { setRenaming(false); load(); }} />`}`;
}
