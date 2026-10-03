/**
 * @file public/views/admin/themes-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles (07-themes-and-styles.md). Jouni: "themes & styles on siis hallinta
 *   näkymä useille teemoille ja tyyleille että niitä voi muokata ja luoda uusia teemoja ja tyylejä
 *   joita sitten käyttäjätkin voivat valita sieltä pill:stä missä on teemat. light & dark on otettava
 *   huomioon tässä myös."
 *
 *   A theme holds styles. This file is the view's first screen and its map: the themes (S1), each
 *   with its styles' colours, what it is and what can be done with it, "Back to the version of" one
 *   click away; and who chooses (S8). Opening a theme goes to themes-theme.js.
 *
 *   THE VIEW NEVER WEARS THE NODE'S OWN CSS: while it is open the page wears the built-in theme
 *   (window.__aimeatLook.hold), so a theme that breaks pages cannot break the tool that repairs it.
 *   Built only from library parts, with no sheet of its own.
 * @structure ThemesTab (default) · ThemeRow · WhoChooses · NewThemeDialog; the "Ask your AI" section
 *   is themes-ai.js, the Fonts tab themes-fonts.js
 * @usage Mounted by the admin dashboard tab router (views/admin.js), group Design.
 * @version-history
 *   v2.3.0 — 2026-10-03 — Two tabs on the first screen: Themes, and Fonts (themes-fonts.js, the font
 *     manager); ?view=fonts in the address opens the second.
 *   v2.2.0 — 2026-10-02 — "Ask your AI" between the themes and who chooses: the prompts for an AI with
 *     and without the MCP theme tools, and the paste box for a JSON answer (themes-ai.js).
 *   v2.1.0 — 2026-09-27 — No class written any more: the action links are Action, the loud actions
 *     Loud (control), the small grey facts and "saved" the meta Note (admin page group G8).
 *   v2.0.0 — 2026-09-24 — The two-level model of 07: S1 and S8 here, the theme's own screens in
 *     themes-theme.js; the view holds the built-in look; every word through t().
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Band } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { QuietNote } from '/components/QuietNote.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { SettingsSwitch } from '/components/SettingsSwitch.js';
import { Modal } from '/components/Modal.js';
import { FormField } from '/components/FormField.js';
import { TextInput } from '/components/TextInput.js';
import { ActionRow } from '/components/ActionRow.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Choice, StyleMarks, versionLabel } from './themes-bits.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import ThemeScreen from './themes-theme.js';
import { AskAiBand } from './themes-ai.js';
import FontsTab from './themes-fonts.js';

const html = htm.bind(h);

/** The operator's choices: whether people choose, which themes are available, the default. */
function WhoChooses({ policy, themes, onSaved }) {
  const live = themes.filter((th) => !th.retired);
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const available = live.filter((th) => policy.offered.includes(th.id));

  /** Save one change at once, with the default kept among the available themes. */
  const save = async (next) => {
    const list = live.map((th) => th.id).filter((id) => next.offered.includes(id));
    if (!list.length) return;
    const theDefault = list.includes(next.default) ? next.default : list[0];
    setState({ busy: true, error: '', saved: false });
    try {
      // The same door aimeat_theme_policy_set uses: it checks every id and saves as the Config tab does.
      await apiPut('/v1/themes/policy', { personalChoice: next.personalChoice, offered: list, default: theDefault });
      setState({ busy: false, error: '', saved: true });
      onSaved();
    } catch (e) {
      setState({ busy: false, error: e.message || String(e), saved: false });
    }
  };
  const toggle = (id) => {
    const on = policy.offered.includes(id);
    // The last available theme stays on: somebody has to see something.
    if (on && available.length === 1) return;
    save({ ...policy, offered: on ? policy.offered.filter((x) => x !== id) : [...policy.offered, id] });
  };

  return html`
    <${Band} title=${t('themes.whoChooses')}>
      <${Hint}>${t('themes.whoChoosesHint')}<//>
      ${live.map((th) => html`
        <${SettingsSwitch} key=${th.id} checked=${policy.offered.includes(th.id)} onChange=${() => toggle(th.id)}
          disabled=${state.busy || (policy.offered.includes(th.id) && available.length === 1)}>
          ${t('themes.available', { name: th.name })}
        <//>`)}
      ${available.length === 1 && html`<${Hint}>${t('themes.lastTheme')}<//>`}
      <${Choice} label=${t('themes.default')} hint=${t('themes.defaultHint')} value=${policy.default}
        choices=${available.map((th) => ({ value: th.id, label: th.name }))} onChoose=${(id) => save({ ...policy, default: id })} />
      <${SettingsSwitch} checked=${policy.personalChoice} onChange=${() => save({ ...policy, personalChoice: !policy.personalChoice })}>${t('themes.personalChoice')}<//>
      <${Hint}>${policy.personalChoice ? t('themes.personalOn') : t('themes.personalOff')}<//>
      ${state.saved && html`<${Note} kind="meta">${t('themes.savedNextLoad')}<//>`}
      ${state.error && html`<${ErrorNote} text=${state.error} />`}
    <//>`;
}

/** One theme: its styles' colours, what it is, and what can be done with it. */
function ThemeRow({ theme, policy, versions, onOpen, onCopy, onRetire, onRestore }) {
  // Whether people can choose it is said once, by its switch under "Who chooses".
  const facts = [
    theme.builtin ? t('themes.builtinShort') : t('themes.own'),
    theme.retired ? t('themes.retired') : '',
    policy.default === theme.id ? t('themes.isDefault') : '',
    t('themes.styleCount', { n: theme.styles.filter((s) => !s.retired).length }),
  ].filter(Boolean).join(' · ');
  const last = versions?.[0];
  return html`
    <${NamedRow} label=${theme.name}><div>
      <span>${theme.styles.filter((s) => !s.retired).map((s) => html`<${StyleMarks} key=${s.id} swatch=${s.swatch} name=${s.name} /> `)}</span>
      <${Note} kind="meta">${facts}<//>
      <${ActionRow}>
        <${Action} onClick=${onOpen}>${t('themes.open')}<//>
        <${Action} onClick=${onCopy}>${t('themes.copy')}<//>
        ${!theme.builtin && html`<${Action} onClick=${onRetire}>
          ${theme.retired ? t('themes.bringBack') : t('themes.retire')}<//>`}
        ${last && html`<${Action} onClick=${() => onRestore(last)}>
          ${t('themes.backTo', { date: versionLabel(last.at) })}<//>`}
      <//>
    </div><//>`;
}

/** A new theme: a copy of a chosen theme (AIMEAT by default), named. */
function NewThemeDialog({ themes, basedOn, onClose, onMade }) {
  const [from, setFrom] = useState(basedOn || 'aimeat');
  const base = themes.find((th) => th.id === from) || themes[0];
  const [name, setName] = useState('');
  const [state, setState] = useState({ busy: false, error: '' });
  const make = async () => {
    setState({ busy: true, error: '' });
    try {
      const r = await apiPost('/v1/themes', { name: name.trim() || t('themes.copyName', { name: base.name }), basedOn: from });
      onMade(r.data.theme.id);
    } catch (e) {
      setState({ busy: false, error: e.message || String(e) });
    }
  };
  const footer = html`
    <${Action} onClick=${onClose}>${t('themes.cancel')}<//>
    <${Loud} control disabled=${state.busy} onClick=${make}>${t('themes.makeIt')}<//>`;
  return html`<${Modal} open=${true} onClose=${onClose} size="sm" title=${t('themes.newTheme')} footer=${footer}>
    <${Choice} label=${t('themes.copyOf')} hint=${t('themes.copyOfHint')} value=${from}
      choices=${themes.map((th) => ({ value: th.id, label: th.name }))} onChoose=${setFrom} />
    <${FormField} label=${t('themes.name')} hint=${t('themes.newNameHint', { name: t('themes.copyName', { name: base.name }) })}>
      <${TextInput} id="theme-new-name" maxLength="60" value=${name} onInput=${(e) => setName(e.target.value)} />
    <//>
    ${state.error && html`<${ErrorNote} text=${state.error} />`}
  <//>`;
}

export default function ThemesTab() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [versions, setVersions] = useState(/** @type {Record<string, any[]>} */ ({}));
  const [error, setError] = useState('');
  const [open, setOpen] = useState(/** @type {string|null} */ (null));
  const [making, setMaking] = useState(/** @type {null | { basedOn: string }} */ (null));
  // The first screen's two tabs: the themes, and the faces they may choose (the font manager).
  // ?view=fonts opens the second (the Compliance page's way to a face without licence data).
  const [tab, setTab] = useState(() => (new URLSearchParams(location.search).get('view') === 'fonts' ? 'fonts' : 'themes'));

  // While this view is open the page wears the built-in theme: a theme cannot break its own repair tool.
  useEffect(() => {
    const L = /** @type {any} */ (window).__aimeatLook;
    L?.hold(true);
    return () => L?.hold(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/themes/all');
      setData(r.data);
      setError('');
      const own = r.data.themes.filter((th) => !th.builtin);
      const lists = await Promise.all(own.map((th) => apiGet(`/v1/themes/${encodeURIComponent(th.id)}/versions`).then((v) => [th.id, v.data.versions]).catch((e) => { swallowed('themes: versions', e); return [th.id, []]; })));
      setVersions(Object.fromEntries(lists));
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('aimeat-live-update', load);
    return () => window.removeEventListener('aimeat-live-update', load);
  }, [load]);

  const act = async (fn) => { try { await fn(); await load(); } catch (e) { setError(e.message || String(e)); } };
  const retire = (theme) => act(() => apiPut(`/v1/themes/${encodeURIComponent(theme.id)}`, { retired: !theme.retired }));
  const restore = (theme, v) => act(() => apiPost(`/v1/themes/${encodeURIComponent(theme.id)}/versions/${v.version}/restore`, {}));

  if (error && !data) return html`<${ErrorNote} text=${error} />`;
  if (!data) return html`<${QuietNote}>${t('themes.loading')}<//>`;
  if (open) {
    return html`<${ThemeScreen} themeId=${open} policy=${data.policy} vocabulary=${data.vocabulary}
      onBack=${() => { setOpen(null); load(); }} onCopied=${(id) => { setOpen(id); load(); }} />`;
  }
  const tabs = html`
    <${ModeTabs}>
      <${ModeTab} on=${tab === 'themes'} onClick=${() => setTab('themes')}>${t('themes.tab.themes')}<//>
      <${ModeTab} on=${tab === 'fonts'} onClick=${() => setTab('fonts')}>${t('themes.tab.fonts')}<//>
    <//>`;
  if (tab === 'fonts') return html`${tabs}<${FontsTab} />`;
  return html`
    ${tabs}
    <${Hint}>${t('themes.intro')}<//>
    ${error && html`<${ErrorNote} text=${error} />`}
    <${Band} title=${t('themes.themes')}>
      <${Actions}><${Loud} control onClick=${() => setMaking({ basedOn: 'aimeat' })}>${t('themes.newTheme')}<//><//>
      ${data.themes.map((th) => html`
        <${ThemeRow} key=${th.id} theme=${th} policy=${data.policy} versions=${versions[th.id]}
          onOpen=${() => setOpen(th.id)} onCopy=${() => setMaking({ basedOn: th.id })}
          onRetire=${() => retire(th)} onRestore=${(v) => restore(th, v)} />`)}
    <//>
    <${AskAiBand} data=${data} onMade=${(id) => { setOpen(id); load(); }} />
    <${WhoChooses} policy=${data.policy} themes=${data.themes} onSaved=${load} />
    ${making && html`<${NewThemeDialog} themes=${data.themes} basedOn=${making.basedOn} onClose=${() => setMaking(null)}
      onMade=${(id) => { setMaking(null); setOpen(id); load(); }} />`}`;
}
