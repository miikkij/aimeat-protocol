/**
 * @file public/views/home/settings-dialog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The home's own settings: the two things that belong to the home and nowhere else
 *   (whether the achievements strip shows, and which page a sign-in lands on), and the door to
 *   everything else.
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
    <div class="koti-settings-pattern">
      <div class="koti-settings-pattern-words">
        <span class="koti-settings-pattern-title">${tr('home.settings.pattern', 'Margin pattern')}</span>
        <span class="koti-settings-pattern-hint">${tr('home.settings.patternHint', 'A figure on the empty margins, fading toward the middle.')}</span>
      </div>
      <div class="koti-settings-pattern-choices" role="radiogroup" aria-label=${tr('home.settings.pattern', 'Margin pattern')}>
        <button type="button" class=${`koti-settings-pattern-choice ${current === '' ? 'active' : ''}`}
          role="radio" aria-checked=${current === '' ? 'true' : 'false'} onClick=${() => choose('')}>
          ${tr('home.settings.patternOff', 'Off')}
        </button>
        ${MARGIN_PATTERNS.map((p) => html`
          <button type="button" key=${p} class=${`koti-settings-pattern-choice ${current === p ? 'active' : ''}`}
            role="radio" aria-checked=${current === p ? 'true' : 'false'} onClick=${() => choose(p)}>
            ${tr('home.settings.patterns.' + p, p.toUpperCase())}
          </button>
        `)}
      </div>
    </div>`;
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
    <label class="koti-settings-switch koti-ach-toggle">
      <input type="checkbox" checked=${!hidden} onChange=${flip} />
      ${tr('home.settings.showAch', 'Show achievements on the home')}
    </label>`;
}

export function HomeSettingsDialog({ open, onClose }) {
  return html`
    <${Modal} open=${open} onClose=${onClose}
      title=${tr('home.settings.title', 'Home settings')}
      className="koti-settings-modal">
      <div class="koti-settings">
        <${AchievementsToggle} />
        <${MarginPatternSetting} />
        <${StartPageSetting} className="koti-settings-startpage" />
        ${/* Everything that is not the home's own. A full page load rather than a router call: the
              dialog is open over the home, and the cleanest way out of a modal into another shell
              is to leave. */''}
        <a class="koti-settings-door" href="/v1/profile">
          <span class="koti-settings-door-title">${tr('home.settings.allControls', 'All settings and controls')} →</span>
          <span class="koti-settings-door-hint">
            ${tr('home.settings.allControlsHint', 'Agents, memory, apps, access, billing: everything behind the home.')}
          </span>
        </a>
      </div>
    <//>`;
}
