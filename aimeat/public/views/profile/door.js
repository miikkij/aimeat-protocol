/**
 * @file door.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The door of /v1/profile for a visitor without a session: what a shared link, a
 *   notification or a bookmark into the account shows before sign-in. It says where the address
 *   leads (Settings & Controls → the tab the URL names), that the page opens only for its owner,
 *   and offers the sign-in dialog, an account, and the story of what this is. Showroom face, since
 *   the visitor is outside; the shell (spa.html SiteFooter) renders the site footer under it.
 * @structure openSignIn(); default SignedOutDoor({ navigate, tabLabel })
 * @usage Rendered by views/profile.js when there is no session; tabLabel is the asked tab's
 *   translated name, or null when the URL names no tab the registry knows.
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial. Replaces the "Your AIMEAT Profile / Sign in to see your agents,
 *     wallet…" wall: the classic shell's words under an aurora theme.css had already turned off, so a
 *     visitor got a title on a blank page, no footer, and no word on where the address led.
 */
import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { showLoginModal } from '/js/services/auth.js';

/**
 * Open the sign-in dialog the header's pill opens, through the session service so the sign-in
 * reaches every subscriber the same way (the profile view itself listens with onAuthChange).
 * `tab: 'register'` opens it on the account step. Without the auth lib, the front page is the door.
 */
function openSignIn(navigate, tab) {
  if (!showLoginModal(tab ? { tab } : {})) navigate('/v1/portal');
}

export default function SignedOutDoor({ navigate, tabLabel }) {
  const address = `${window.location.host}${window.location.pathname}${window.location.search}`;
  const profile = t('nav.profile');
  const signIn = useCallback(() => openSignIn(navigate), [navigate]);
  const createAccount = useCallback(() => openSignIn(navigate, 'register'), [navigate]);
  const goHowItWorks = useCallback((e) => { e.preventDefault(); navigate('/v1/how-it-works'); }, [navigate]);

  return html`
    <div class="pf-door">
      <div class="pf-door-kicker">
        <span class="pf-door-address">${address}</span>
        <span class="pf-door-label">${t('profile.door.kicker')}</span>
      </div>
      <h1 class="pf-door-title">
        <span>${t('profile.door.title')}</span>
        <span class="pf-door-title-accent">${t('profile.door.titleAccent')}</span>
      </h1>
      <div class="pf-door-target">
        <div class="pf-door-target-path">
          <span class="pf-door-label">${t('profile.door.targetLabel')}</span>
          ${tabLabel
            ? html`<span class="pf-door-crumb">
                <span class="pf-door-crumb-root">${profile}</span>
                <span class="pf-door-crumb-arrow">→</span>
                <span>${tabLabel}</span>
              </span>`
            : html`<span class="pf-door-crumb">${profile}</span>`}
        </div>
        <span class="pf-door-chip">${t('profile.door.ownerOnly')}</span>
      </div>
      <div class="pf-door-cols">
        <div class="pf-door-say">
          <p class="pf-door-lead">${t('profile.door.lead', { profile })}</p>
          <div class="pf-door-actions">
            <button type="button" class="pf-door-slab" onClick=${signIn}>${t('profile.door.signIn')}</button>
            <button type="button" class="pf-door-door" onClick=${createAccount}>${t('profile.door.createAccount')}</button>
          </div>
          <p class="pf-door-after">${t('profile.door.after')}</p>
        </div>
        <aside class="pf-door-what">
          <div class="pf-door-what-head">
            <span class="pf-door-label">${t('profile.door.whatLabel')}</span>
            <span class="pf-door-what-title">${t('profile.door.whatTitle')}</span>
          </div>
          <p class="pf-door-what-text">${t('profile.door.whatText')}</p>
          <a class="pf-door-door" href="/v1/how-it-works" onClick=${goHowItWorks}>${t('profile.door.howItWorks')}</a>
        </aside>
      </div>
    </div>`;
}
