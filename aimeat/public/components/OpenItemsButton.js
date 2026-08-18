/**
 * @file public/components/OpenItemsButton.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The header's open-items button: how many things you are going to do here, from
 *   wherever you happen to be.
 *
 *   It is in the SPA header rather than on one page because the list is only useful if you can put
 *   something on it anywhere and see the count anywhere. An earlier decision put this in the
 *   notification bell and was reversed: the bell is what happened TO you, this is what YOU are
 *   going to do, and mixing them makes both unreadable.
 *
 *   The count is one key read on the server (`/v1/open-items/count`), not the list, so the header
 *   never pays for a payload it does not show. It refreshes on `aimeat-live-update`, which matters
 *   here more than anywhere else: the person's own AI switches these on and off while they are
 *   looking at the page.
 *
 *   Zero renders nothing. A badge reading 0 is a thing to explain, and an empty state reads as
 *   broken.
 * @structure OpenItemsButton({ t, onNavigate })
 * @usage html`<${OpenItemsButton} t=${t} onNavigate=${(p) => navigate(p)} />`
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (P14: the button is in the header, and P7's rejection of the
 *     header is overruled — if it does not fit, the header gets fixed).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { openItemsCount } from '/js/services/open-items.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** Where the list itself renders. The button leads there; it does not duplicate the list. */
const LIST_PATH = '/profile';

export function OpenItemsButton({ t, onNavigate }) {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try { setCount(await openItemsCount()); }
    catch (e) { swallowed('OpenItemsButton: count', e); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  if (count === 0) return null;

  const label = (t?.('openItems.headerLabel') && t('openItems.headerLabel') !== 'openItems.headerLabel')
    ? t('openItems.headerLabel') : 'Open items';

  // The name is an aria-label, not a hidden span. A `.sr-only` span looked equivalent and was not:
  // that class is not defined in this stylesheet, so the text rendered at full size and pushed the
  // header 70px past a 390px screen — measured, and exactly the crowding P7 warned about.
  return html`
    <button type="button" class="open-items-btn" title=${label} aria-label=${`${label}: ${count}`}
      onClick=${(e) => { e.preventDefault(); onNavigate?.(LIST_PATH); }}>
      <span class="open-items-btn-mark" aria-hidden="true">○</span>
      <span class="open-items-btn-count">${count}</span>
    </button>`;
}

export default OpenItemsButton;
