/**
 * @file public/views/owner-start.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The front page of a node the store sold, until its owner puts a page of their own
 *   there: "This is your own AIMEAT <address>", a sign-in by email link, and where the site's content
 *   is changed. It replaces the public demo front page (the demo texts, the store's call to buy, the
 *   developer slides) on such a node, because a buyer opening their own address met an advert for the
 *   thing they had just bought (Jouni, v27 P3, 2026-10-31).
 *
 *   WHEN IT SHOWS. landing.js renders it on a customer's node (site.js customerNode(): the store set
 *   site.purchase_plan) while the portal layout is the built-in one. The owner's own page replaces it
 *   in two ways the node already has: an own HTML page (POST /v1/site/template) is served before the
 *   SPA at all, and a saved portal layout (PUT /v1/site/layout/portal, the admin's Front page tab)
 *   makes the layout's source `stored`, and then landing.js renders that layout instead.
 *
 *   THE SIGN-IN IS THE EMAIL LINK. POST /v1/ghii/magic-link answers the same whether the address has
 *   an account or not, so this page says the same either way. The link lands on the Home.
 *
 *   Composed from library components (Band, BandNote, NamedRow, TextField, Action, Loud, Actions);
 *   its own sheet sets only the page width (css/views/owner-start.css).
 * @structure OwnerStart({ navigate })
 * @usage html`<${OwnerStart} navigate=${navigate} />` (landing.js)
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (Jouni v27 P3).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiPost } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Band, BandNote } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { TextField } from '/components/TextField.js';
import { Action, Actions, Loud } from '/components/Action.js';

/** True when this browser holds a session for the node. */
function signedIn() {
  try {
    return !!JSON.parse(localStorage.getItem('aimeat_session') || 'null')?.jwt;
  } catch (err) {
    // An unreadable session reads as signed out, which is what it is.
    swallowed('owner-start: session', err);
    return false;
  }
}

export function OwnerStart({ navigate }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | failed
  const [inside, setInside] = useState(signedIn());

  useEffect(() => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/css/views/owner-start.css';
    document.head.appendChild(css);
    const onAuth = () => setInside(signedIn());
    window.addEventListener('aimeat-auth-change', onAuth);
    return () => { css.remove(); window.removeEventListener('aimeat-auth-change', onAuth); };
  }, []);

  const host = window.location.host;
  const admin = `${window.location.origin}/v1/admin?tab=portal`;

  const send = async () => {
    const address = email.trim();
    if (!address || state === 'sending') return;
    setState('sending');
    const r = await apiPost('/v1/ghii/magic-link', { email: address, redirect: '/v1/home' });
    setState(r?.ok ? 'sent' : 'failed');
  };

  return html`
    <div class="owner-start">
      <${Band} title=${t('siteStart.title', { host })}>
        ${inside
          ? html`
            <${BandNote}>${t('siteStart.signedInNote')}<//>
            <${Actions}>
              <${Loud} onClick=${() => navigate?.('/v1/home')}>${t('siteStart.openHome')}<//>
            <//>`
          : html`
            <${BandNote}>${t('siteStart.signInNote')}<//>
            <${NamedRow} stack label=${t('siteStart.signInLabel')}>
              <${TextField}
                label=${t('siteStart.emailField')}
                type="email" autoComplete="email" inputMode="email"
                value=${email} onInput=${setEmail} onEnter=${send}
                disabled=${state === 'sending' || state === 'sent'}
                actions=${html`<${Loud} control onClick=${send} disabled=${state === 'sending' || state === 'sent' || !email.trim()}>${t('siteStart.sendLink')}<//>`} />
            <//>
            ${state === 'sent' && html`<${BandNote}>${t('siteStart.linkSent')}<//>`}
            ${state === 'failed' && html`<${BandNote}>${t('siteStart.linkFailed')}<//>`}`}

        <${NamedRow} stack label=${t('siteStart.contentLabel')}>
          <p class="owner-start-line">${t('siteStart.contentNote')}</p>
          <${Actions}>
            <${Action} small href=${admin}>${admin}<//>
          <//>
        <//>
      <//>
    </div>`;
}

export default OwnerStart;
