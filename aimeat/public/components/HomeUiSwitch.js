/**
 * @file HomeUiSwitch.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The switch between the new home and the old profile — ONE component, mounted on
 *   both sides, because a person has to be able to get back from wherever they are.
 *
 *   It was in neither place for longer than it should have been. It started inside the new home's
 *   settings, which you had to already be in; briefly on the landing page, where an internal
 *   UI-version toggle has no business sitting above the sentence that says what this company is;
 *   and then nowhere on the old profile at all, which left the only route a hand-typed URL.
 *
 *   It reads which side you are on rather than guessing, so the words are never wrong, and it says
 *   where it goes rather than what it is called: "beta", "remake" and a version number mean
 *   nothing to the person reading them.
 *
 *   Switching records the choice on the ACCOUNT (so it follows to another device) and increments
 *   `switched`. It never rewrites `track` — that is which path the account was CREATED on, and a
 *   cohort whose membership moves as people wander measures nothing.
 * @structure HomeUiSwitch({ className })
 * @usage
 *   import { HomeUiSwitch } from '/components/HomeUiSwitch.js';
 *   html`<${HomeUiSwitch} />`
 * @version-history
 *   v1.0.0 — 2026-08-08 — Extracted so the old profile and the new home mount the same control.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { api, apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export function HomeUiSwitch({ className = '' }) {
  const [ui, setUi] = useState(null);      // 'home' | 'profile'
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet('/v1/home/ui-track')
      .then(r => { if (alive) setUi(r?.data?.ui ?? null); })
      .catch(e => swallowed('HomeUiSwitch: ui-track', e));
    return () => { alive = false; };
  }, []);

  const flip = useCallback(async () => {
    const next = ui === 'home' ? 'profile' : 'home';
    setBusy(true);
    try {
      const r = await api('/v1/home/ui-track', { method: 'PUT', body: JSON.stringify({ ui: next }) });
      // A full load, not an in-app route change: the two sides are different shells, and the
      // server decides where this account lands.
      window.location.href = r?.data?.landing || (next === 'home' ? '/v1/home' : '/v1/profile');
    } catch (e) {
      swallowed('HomeUiSwitch: switch', e);
      setBusy(false);
    }
  }, [ui]);

  // Render nothing until the side is known — a control that flips its own label a moment after you
  // read it is worse than one that arrives a moment late.
  if (!ui) return null;

  return html`
    <div class="ui-switch ${className}">
      <span class="ui-switch-state">
        ${ui === 'home'
          ? tr('home.switch.here', 'You are using the new home view.')
          : tr('home.switch.hereProfile', 'You are using the old profile.')}
      </span>
      <button type="button" class="btn-outline ui-switch-btn" disabled=${busy} onClick=${flip}>
        ${ui === 'home'
          ? tr('home.switch.toProfile', 'Go back to the old profile')
          : tr('home.switch.toHome', 'Try the new home')}
      </button>
    </div>`;
}
