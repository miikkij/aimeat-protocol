/**
 * @file public/views/home/settings-dialog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Basic account settings through the shared profile/password forms, then home
 *   appearance and the door to all settings and controls.
 *
 *   It used to carry four tabs of the profile's sections (OpenRouter, access, wallet,
 *   notifications) imported into a modal, from the time the home and the profile were two
 *   alternatives and a person on the home was not expected to visit the other side. Settings and
 *   controls is one click away in the header now, and the same setting reachable in two places is
 *   two places it can disagree, so the dialog shrank to what is the home's own.
 *
 *   One rule survives from the tabbed version: **module-level component identity.** The pieces are
 *   defined here rather than inside HomeView, because HomeView re-renders on every
 *   `aimeat-live-update` and a component whose identity is recreated per render makes Preact
 *   unmount and remount the OPEN dialog, the documented strobe in components/Modal.js.
 * @structure HomeSettingsDialog({ open, onClose })
 * @usage
 *   import { HomeSettingsDialog } from '/views/home/settings-dialog.js';
 *   html`<${HomeSettingsDialog} open=${open} onClose=${close} />`
 * @version-history
 *   2026-09-13: Shared dialog, sections and fields own all home-settings appearance.
 *   2026-09-13: Compose the existing home shapes with shared poster classes.
 *   2026-09-13: The dialog is the site's one dialog at its medium size; its two sections open on the
 *     page's own slab (poster-section-title) and the door out is a row under an ink rule.
 *   2026-09-09: Account actions use the same underlined control as the home header.
 *   2026-09-09: Home journey starts with a connected AI; useful prompts and account settings are within reach.
 *   v2.1.1 — 2026-08-29 — A preview box above the chips shows the chosen figure without leaving the dialog.
 *   v2.1.0 — 2026-08-29 — The margin pattern: off or one of eight figures for the empty margins of the
 *     home, the chat and the settings. Same home.prefs record (marginPattern), applied to the page
 *     the moment it is chosen.
 *   v2.0.0 — 2026-08-27 — Shrunk to the home's own two settings and a door to settings and
 *     controls. The start-page setting (components/StartPageSetting.js) replaces the switch between
 *     "the new home" and "the old profile", which changed the landing page every time somebody used
 *     it to go and look at the other side.
 *   v1.1.0 — 2026-08-08 — The switch is the shared components/HomeUiSwitch.js, mounted here and on
 *     the old profile's Home view, so the two sides cannot say different things.
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Dialog, Section, Stack, Surface, Text, Field, Action, ListRow } from '/components/poster-parts.js';
import { StartPageSetting } from '/components/StartPageSetting.js';
import { EditProfileModal, ChangePasswordModal } from '../profile/landing-page.modals.js';
import { MARGIN_PATTERNS, applyMarginPattern, marginPatternOf } from '/js/margin-pattern.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/**
 * The margin pattern: which figure sits on the empty margins of the home, the chat and the
 * settings, or none. Kept in the same home.prefs record; the page changes the moment the choice
 * is made, and the record follows.
 */
function MarginPatternSetting() {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    apiGet('/v1/memory/home.prefs?soft=1')
      .then((r) => setPrefs(r?.data?.exists === false ? {} : (r?.data?.value ?? {})))
      .catch((e) => { swallowed('home settings: prefs', e); setPrefs({}); });
  }, []);
  if (prefs === null) return null;
  const current = marginPatternOf(prefs);
  const choose = async (value) => {
    const next = { ...prefs, marginPattern: value };
    setPrefs(next);
    applyMarginPattern(value);
    await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: 'home.prefs', value: next, visibility: 'private' }) })
      .catch((e) => swallowed('home settings: prefs write', e));
  };
  return html`
    <${Stack}>
      <${Text} kind="label">${tr('home.settings.pattern', 'Margin pattern')}<//>
      <${Text} tone="muted">${tr('home.settings.patternHint', 'A figure on the empty margins, fading toward the middle.')}<//>
      <${Surface} kind="preview">
        ${current ? html`<div class=${'mp-swatch mp-swatch--'+current} aria-hidden="true"></div>`
          : html`<${Text} tone="muted">${tr('home.settings.patternOff','Off')}<//>`}
      <//>
      <${Stack} direction="wrap" role="radiogroup" label=${tr('home.settings.pattern','Margin pattern')}>
        <${Action} kind="tab" semantics="radio" selected=${current===''} onClick=${()=>choose('')}>${tr('home.settings.patternOff','Off')}<//>
        ${MARGIN_PATTERNS.map(p=>html`<${Action} key=${p} kind="tab" semantics="radio" selected=${current===p} onClick=${()=>choose(p)}>
          ${tr('home.settings.patterns.'+p,p.toUpperCase())}<//>`)}
      <//>
    <//>`;
}

/**
 * Whether the achievements strip shows on the home. Stored in the home.prefs memory record the
 * home itself reads, so the strip and this switch cannot disagree about where the truth lives.
 */
function AchievementsToggle() {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    apiGet('/v1/memory/home.prefs?soft=1')
      .then((r) => setPrefs(r?.data?.exists === false ? {} : (r?.data?.value ?? {})))
      .catch((e) => { swallowed('home settings: prefs', e); setPrefs({}); });
  }, []);
  if (prefs === null) return null;
  const hidden = !!prefs.hideAchievements;
  const flip = async () => {
    const next = { ...prefs, hideAchievements: !hidden };
    setPrefs(next);
    await api('/v1/memory', { method: 'POST', body: JSON.stringify({ key: 'home.prefs', value: next, visibility: 'private' }) })
      .catch((e) => swallowed('home settings: prefs write', e));
    window.dispatchEvent(new Event('aimeat-live-update'));
  };
  return html`
    <${Field} type="checkbox" value=${!hidden} onChange=${flip}
      label=${tr('home.settings.showAch','Show achievements on the home')} />`;
}

export function HomeSettingsDialog({ open, onClose, session, showToast }) {
  const [panel, setPanel] = useState('settings');
  useEffect(() => { if (!open) setPanel('settings'); }, [open]);
  if (!open) return null;
  if (panel === 'profile') return html`<${EditProfileModal} session=${session}
    onClose=${() => setPanel('settings')} onSaved=${() => setPanel('settings')}
    onChangePassword=${() => setPanel('password')} />`;
  if (panel === 'password') return html`<${ChangePasswordModal}
    onClose=${() => setPanel('settings')}
    onChanged=${() => { setPanel('settings'); showToast?.(t('profile.landing.passwordChanged')); }} />`;
  return html`
    <${Dialog} open=${open} onClose=${onClose} title=${tr('home.settings.title','Home settings')}>
      <${Stack}>
        <${Section} title=${t('homeJourney.account')} size="small"><${Stack} align="start">
          <${Action} onClick=${()=>setPanel('password')}>${t('profile.landing.changePasswordBtn')}<//>
          <${Action} onClick=${()=>setPanel('profile')}>${t('homeJourney.profileLanguage')}<//>
          <${Action} href="/v1/profile?tab=access">${t('homeJourney.security')} →<//>
          <${Text} tone="muted">${t('homeJourney.securityHint')}<//>
        <//><//>
        <${Section} title=${t('homeJourney.appearance')} size="small"><${Stack}>
          <${AchievementsToggle} /><${MarginPatternSetting} /><${StartPageSetting} />
        <//><//>
        <${ListRow} href="/v1/profile" detailKind="text" name=${tr('home.settings.allControls','All settings and controls')+' →'}
          detail=${tr('home.settings.allControlsHint','Agents, memory, apps, access, billing: everything behind the home.')} />
      <//>
    <//>`;
}
