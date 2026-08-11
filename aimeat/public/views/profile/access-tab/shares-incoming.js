/**
 * @file views/profile/access-tab/shares-incoming.js
 * @description "Shared with you" — the key spaces other people have opened to this account.
 *
 *   The reader's half of sharing, and the half whose absence made the feature unusable: until this
 *   existed you had to be told someone's identity and the exact key by hand, because nothing on the
 *   node would tell you what you had been given. Everything else on this page answers "who can see
 *   my things"; this one answers "what of other people's may I see".
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, alongside key-space shares.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as sharesApi from '/js/services/shares.js';
import { swallowed } from '/js/swallowed.js';

export function SharesIncomingSection() {
  const [shares, setShares] = useState(null);

  const load = useCallback(async () => {
    try {
      const resp = await sharesApi.listIncoming();
      setShares(resp?.data?.shares || []);
    } catch (err) {
      swallowed('shares-incoming: load', err);
      setShares([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch on the live-update event: a share can appear or be withdrawn while this is open, and a
  // stale list here reads as "you still have access" after somebody stopped giving it.
  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  // Nothing shared with you is the ordinary state for most accounts, so it is not worth a card.
  if (shares !== null && shares.length === 0) return null;

  return html`
    <h3 class="card-h3 access-h3 mt-section" id="access-shares-incoming">${t('profile.access.shIncomingTitle')}</h3>
    <div class="section-desc">${t('profile.access.shIncomingDesc')}</div>
    ${shares === null
      ? html`<div class="empty">${t('profile.access.sgLoading') || 'Loading...'}</div>`
      : shares.map(s => html`
        <div class="mem-item" key=${s.id}>
          <span class="mem-key" title=${s.key_pattern}>${escHtml(s.key_pattern)}</span>
          <span class="text-meta-sm">${t('profile.access.shIncomingFrom')} ${escHtml(s.owner_gaii)}</span>
          ${s.expires_at && html`<span class="badge badge-muted">${new Date(s.expires_at).toLocaleDateString()}</span>`}
        </div>
      `)
    }
  `;
}
