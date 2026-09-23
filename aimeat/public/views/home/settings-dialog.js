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
 *   2026-09-23: Composed from library components (SettingsStack, SettingsAccount, SettingsSwitch,
 *     SwatchPicker, SettingsDoor, Hint), which emit the markup this file wrote (UI consolidation
 *     phase 1, a move).
 *   2026-09-23: Composed from the shared parts in css/parts.css and css/parts-steps.css (class names by role, values moved from views/home.css unchanged; UI consolidation slice 1).
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
import { Modal } from '/components/Modal.js';
import { StartPageSetting } from '/components/StartPageSetting.js';
import { EditProfileModal, ChangePasswordModal } from '../profile/landing-page.modals.js';
import { MARGIN_PATTERNS, applyMarginPattern, marginPatternOf } from '/js/margin-pattern.js';
import { SettingsStack } from '/components/SettingsStack.js';
import { SettingsAccount } from '/components/SettingsAccount.js';
import { SettingsSwitch } from '/components/SettingsSwitch.js';
import { SwatchPicker } from '/components/SwatchPicker.js';
import { SettingsDoor } from '/components/SettingsDoor.js';
import { Hint } from '/components/Hint.js';

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
  // The preview: the same variables the page's strips read, so it shows what the margin will show,
  // fading to the right the way the left strip fades toward the middle.
  return html`
    <${SwatchPicker}
      title=${tr('home.settings.pattern', 'Margin pattern')}
      hint=${tr('home.settings.patternHint', 'A figure on the empty margins, fading toward the middle.')}
      preview=${current ? html`<div class=${`mp-swatch mp-swatch--${current}`}></div>` : null}
      emptyLabel=${tr('home.settings.patternOff', 'Off')}
      choices=${[
        { value: '', label: tr('home.settings.patternOff', 'Off'), active: current === '' },
        ...MARGIN_PATTERNS.map((p) => ({ value: p, label: tr('home.settings.patterns.' + p, p.toUpperCase()), active: current === p })),
      ]}
      onChoose=${choose} />`;
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
    <${SettingsSwitch} checked=${!hidden} onChange=${flip}>
      ${tr('home.settings.showAch', 'Show achievements on the home')}
    <//>`;
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
    <${Modal} open=${open} onClose=${onClose} size="md"
      title=${tr('home.settings.title', 'Home settings')}>
      <${SettingsStack}>
        ${/* Inside a dialog a section starts the way it does on the page: the slab, a size smaller. */''}
        <${SettingsAccount} title=${t('homeJourney.account')}>
          <button type="button" class="poster-action" onClick=${() => setPanel('password')}>${t('profile.landing.changePasswordBtn')}</button>
          <button type="button" class="poster-action" onClick=${() => setPanel('profile')}>${t('homeJourney.profileLanguage')}</button>
          <a class="poster-action" href="/v1/profile?tab=access">${t('homeJourney.security')} →</a>
          <${Hint}>${t('homeJourney.securityHint')}<//>
        <//>
        <section class="poster-section">
          <h3 class="poster-section-title">${t('homeJourney.appearance')}</h3>
          <${AchievementsToggle} />
          <${MarginPatternSetting} />
          <${StartPageSetting} className="poster-settings-startpage" />
        </section>
        ${/* Everything that is not the home's own. A full page load rather than a router call: the
              dialog is open over the home, and the cleanest way out of a modal into another shell
              is to leave. */''}
        <${SettingsDoor} href="/v1/profile"
          title=${tr('home.settings.allControls', 'All settings and controls') + ' →'}
          hint=${tr('home.settings.allControlsHint', 'Agents, memory, apps, access, billing: everything behind the home.')} />
      <//>
    <//>`;
}
