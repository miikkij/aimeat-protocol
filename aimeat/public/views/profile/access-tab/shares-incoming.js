/**
 * @file views/profile/access-tab/shares-incoming.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Shared with you" — the key spaces other people have opened to this account.
 *
 *   The reader's half of sharing, and the half whose absence made the feature unusable: until this
 *   existed you had to be told someone's identity and the exact key by hand, because nothing on the
 *   node would tell you what you had been given. Everything else on this page answers "who can see
 *   my things"; this one answers "what of other people's may I see".
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (ListRow, Chip, Text); no own classes. The
 *     title is the list's label; the description the Access page hid stays out.
 *   v1.0.0 — 2026-08-11 — Initial, alongside key-space shares.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as sharesApi from '/js/services/shares.js';
import { Stack, ListRow, Chip, Text } from '/components/poster-parts.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';

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

  // The Access page hid this list's own title and description under its section; the title stays as
  // the list's label, because without it these rows would not say they are other people's.
  return html`<${Stack} id="access-shares-incoming" density="compact">
    <${Text} kind="label">${t('profile.access.shIncomingTitle')}<//>
    ${shares === null
      ? html`<${Text} tone="muted">${t('profile.access.sgLoading') || 'Loading...'}<//>`
      : shares.map(s => html`
        <${ListRow} key=${s.id} name=${escHtml(s.key_pattern)} nameTitle=${s.key_pattern}
          detail=${`${t('profile.access.shIncomingFrom')} ${escHtml(s.owner_gaii)}`}
          value=${s.expires_at ? html`<${Chip} tone="muted">${fmtDate(s.expires_at)}<//>` : null} />
      `)
    }
  <//>`;
}
