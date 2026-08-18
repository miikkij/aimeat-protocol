/**
 * @file public/components/OpenItemsList.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The open items list: what you are going to do here, and the one prompt that takes the
 *   whole thing into your AI chat.
 *
 *   ONE prompt, at the top, not one per row. An earlier version gave every row its own copy button
 *   and that made a screen of six buttons with no obvious next move. The prompt does not contain the
 *   items either: they go stale the moment they are copied. It tells the AI where to read them, so
 *   what the chat sees is always what is on the list right now.
 *
 *   Rows carry the same three dots the cards do, in the same corner, and nothing else. There is no
 *   Done and no Remove, because there is no done and no remove: an item is switched on or it is not.
 *
 *   NO AGENT PICKER. A row once carried a native select listing every reachable agent — seventy of
 *   them on a real account, an unstyled dropdown taller than the page. Handing work to a named agent
 *   does not belong in a list whose whole point is that you take it into your own chat, and P20 says
 *   that chat IS the agent.
 *
 *   A row the AI switched on says so. That is the point where this stops being a to-do list: a
 *   person opens their home and sees that their AI put something there while they were away.
 *
 *   EMPTY RENDERS NOTHING. Not a heading with an encouraging sentence under it: an empty state reads
 *   as broken, and "you have no open items" is exactly that.
 * @structure OpenItemsList({ maxAgeDays })
 * @usage html`<${OpenItemsList} />` — or `maxAgeDays={7}` to hide rows that have gone stale
 * @version-history
 *   v1.1.0 — 2026-08-18 — `maxAgeDays`: a surface can ask for fresh items only. An eight-day-old
 *     "Haluan luoda" at the top of the home is an inbox of guilt, not a status; a row an agent is
 *     WORKING on stays regardless of age, because active work never goes stale by sitting there.
 *   v1.0.0 — 2026-08-09 — Replaces components/IntentPool.js. One prompt at the top instead of one
 *     per row, a state control instead of Done/Remove, and the AI's own rows are marked.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { apiGet } from '/js/api.js';
import { CopyButton } from '/components/CopyButton.js';
import { listOpenItems, switchOff } from '/js/services/open-items.js';
import { CardMenu } from '/components/CardMenu.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The managed prompt that teaches a chat how to work this list. Served, never inlined. */
const LIST_PROMPT = 'open-items';


/**
 * Where an item came from, in words.
 *
 * `origin` is a machine key — "home.rooms.create", "app-catalog" — and it was being printed raw
 * under every row. It is written for measurement, not for reading, and a person seeing it learns
 * nothing except that something leaked.
 */
function originLabel(origin) {
  if (!origin) return tr('openItems.yours', 'Yours');
  const key = `openItems.origin.${origin}`;
  const named = t(key);
  if (named && named !== key) return named;
  // An origin nobody has named yet says nothing rather than saying a key out loud.
  return tr('openItems.yours', 'Yours');
}

/** @param {{ maxAgeDays?: number }} [props] */
export function OpenItemsList({ maxAgeDays } = {}) {
  const [items, setItems] = useState(null);
  const [prompt, setPrompt] = useState('');

  const load = useCallback(async () => {
    try {
      let list = await listOpenItems();
      // Freshness is opt-in per surface. A row being WORKED on never counts as stale: an agent in
      // the middle of something is exactly the status the surface wants.
      if (Number.isFinite(maxAgeDays)) {
        const cutoff = Date.now() - maxAgeDays * 86400000;
        list = list.filter(i => i.status === 'working' || (Date.parse(i.createdAt) || 0) >= cutoff);
      }
      setItems(list);
    }
    catch (e) { swallowed('OpenItemsList: load', e); setItems([]); }
  }, [maxAgeDays]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiGet(`/v1/prompts/${LIST_PROMPT}`)
      .then(r => setPrompt(r?.data?.prompt || ''))
      .catch(e => swallowed('OpenItemsList: prompt', e));
  }, []);

  // Every surface showing server data re-fetches on this. It matters more here than anywhere: the
  // AI switches these on and off while the person is looking at the page.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  // The menu closes itself on the click, so there is no row-level busy state to show: the list
  // simply reloads under it.
  const act = useCallback(async (id, fn) => {
    try { await fn(); await load(); }
    catch (e) { swallowed('OpenItemsList: act', e); }
  }, [load]);

  // Nothing on the list → no block at all. See the file header.
  if (!items || items.length === 0) return null;

  return html`
    <section class="open-items">
      <div class="open-items-head">
        <h3 class="open-items-title">
          ${tr('openItems.title', 'Open items')} <span class="open-items-count">${items.length}</span>
        </h3>
        <${CopyButton}
          text=${prompt}
          className="btn-primary btn-sm"
          label=${tr('openItems.copyPrompt', 'Take these into your AI chat')}
          copiedLabel=${tr('openItems.copied', 'Copied — paste it in your chat')} />
      </div>

      <ul class="open-items-list">
        ${items.map(i => html`
          <li key=${i.id} class="open-items-row open-items-row--${i.status}">
            ${/* No second state mark. There used to be a ring on the left AND the dots on the
                 right, and on a working row they disagreed: coral circle, green dots, one item.
                 One state, one place, and the place is the corner every card uses. */''}
            <div class="open-items-main">
              <div class="open-items-item">${escHtml(i.title)}</div>
            ${/* WHO put this here is a separate fact from WHAT is happening to it, and it used to be
                 the last arm of one ternary — so a row the AI switched on stopped saying so the
                 moment an agent picked it up or it turned out to be a suggestion. Measured: one row
                 in three said it. Two lines, two facts. */''}
              <div class="open-items-meta">
                ${i.closes_when
                  ? tr('openItems.suggestion', 'Suggestion — it goes away once this is done')
                  : i.agent
                    ? `${escHtml(String(i.agent).split('#')[0])} ${tr('openItems.isDoing', 'is doing this')}`
                    : `${originLabel(i.origin)} · ${timeAgo(i.createdAt)}`}
                ${i.by === 'ai' && html`
                  <span class="open-items-byai">${tr('openItems.byAi', 'your AI put this here')}</span>`}
              </div>
            </div>

            ${/* A suggestion gets no control: it goes away by itself when its condition is true,
                 so offering to switch it off invites a person to act on something the node is
                 about to withdraw anyway. */''}
            ${!i.closes_when && html`
              <div class="open-items-control">
                <${CardMenu} state=${i.status === 'working' ? 'working' : 'open'} label=${i.title}
                  actions=${[{
                    label: tr('openItems.off', 'Take it off'),
                    run: () => act(i.id, () => switchOff(i.id)),
                  }]} />
              </div>`}
          </li>`)}
      </ul>
    </section>`;
}

export default OpenItemsList;
