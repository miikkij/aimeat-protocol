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
 *   v1.6.0 — 2026-09-26 — Every part is a component that takes data, and the file writes no class
 *     (component plan, page group G3): the heading is the SubHeading with its intro, the shares a
 *     List (its loading line the List's), the date a dim tag as main's muted badge. `inRow` leaves
 *     out the heading and intro where the page's section says what they are (Access 06).
 *   v1.5.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.4.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.3.0 — 2026-09-25 — What others share with you is the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.2.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.1.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { date as fmtDate } from '/js/format.js';
import { List, Row, Name, Cell } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { SubHeading } from '/components/SubHeading.js';
import { Space } from '/components/Layout.js';

/**
 * @param {{ inRow?: boolean }} props `inRow`: the list stands inside a page section that already says
 *   what it is (Access, 06), so it leaves out its own heading and intro, as .ac-kept hid them on main.
 */
export function SharesIncomingSection({ inRow } = {}) {
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
    ${inRow ? null : html`<${Space} above="section"><${SubHeading} level=${3} id="access-shares-incoming" desc=${t('profile.access.shIncomingDesc')}>${t('profile.access.shIncomingTitle')}<//><//>`}
    <${List} cols="name-state" keepCols loading=${shares === null ? (t('profile.access.sgLoading') || 'Loading...') : false}>
      ${(shares || []).map(s => html`
        <${Row} key=${s.id}>
          <${Name} title=${s.key_pattern} meta=${`${t('profile.access.shIncomingFrom')} ${escHtml(s.owner_gaii)}`}>${escHtml(s.key_pattern)}<//>
          <${Cell}>${s.expires_at && html`<${Mark} tone="dim">${fmtDate(s.expires_at)}<//>`}<//>
        <//>
      `)}
    <//>
  `;
}
