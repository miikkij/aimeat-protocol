/**
 * @file public/components/IntentPool.js
 * @description The intent pool block: one list of what you mean to do here.
 *
 *   Human-written intents and system suggestions share one list, told apart by a word on the second
 *   line rather than by separate blocks — same shape, different author. A suggestion says it will
 *   disappear by itself, so leaving it does not read as neglect.
 *
 *   EMPTY RENDERS NOTHING. Not a heading with an encouraging sentence under it: an empty state is
 *   read as broken, and "you have no intentions" is exactly that. The block appears when there is
 *   something in it and is absent otherwise.
 *
 *   It re-fetches on `aimeat-live-update`, like every other surface showing server data.
 * @structure IntentPool({ onOpenPrompt })
 * @usage html`<${IntentPool} />`
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, phase 3).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { listIntents, updateIntent, deleteIntent } from '/js/services/intents.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const MARK = { open: '○', working: '●', done: '✓' };

export function IntentPool() {
  const [intents, setIntents] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try { setIntents(await listIntents()); }
    catch (e) { swallowed('IntentPool: load', e); setIntents([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Every surface showing server data re-fetches on this; a pool that goes stale while an agent
  // works through it would be the one list you cannot trust.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  async function act(id, fn) {
    setBusy(id);
    try { await fn(); await load(); }
    catch (e) { swallowed('IntentPool: act', e); }
    finally { setBusy(null); }
  }

  // Nothing to show → no block at all. See the file header.
  if (!intents || intents.length === 0) return null;

  return html`
    <section class="koti-pool">
      <h3 class="koti-pool-title">${tr('pool.title', 'What you mean to do')}</h3>
      <ul class="koti-pool-list">
        ${intents.map(i => html`
          <li key=${i.id} class="koti-pool-row koti-pool-row--${i.status}">
            <span class="koti-pool-mark" aria-hidden="true">${MARK[i.status] ?? '○'}</span>
            <div class="koti-pool-main">
              <div class="koti-pool-item">${escHtml(i.title)}</div>
              <div class="koti-pool-meta">
                ${i.closes_when
                  ? tr('pool.suggestion', 'Suggestion — it disappears once this is done')
                  : i.agent
                    ? `${escHtml(String(i.agent).split('#')[0])} ${tr('pool.isDoing', 'is doing this')}`
                    : `${i.origin ? escHtml(i.origin) : tr('pool.yours', 'Yours')} · ${timeAgo(i.createdAt)}`}
              </div>
            </div>
            <div class="koti-pool-actions">
              ${i.status !== 'done' && !i.closes_when && html`
                <button type="button" class="btn-ghost btn-sm" disabled=${busy === i.id}
                  onClick=${() => act(i.id, () => updateIntent(i.id, { status: 'done' }))}>
                  ${tr('pool.markDone', 'Done')}
                </button>`}
              ${!i.closes_when && html`
                <button type="button" class="btn-ghost btn-sm" disabled=${busy === i.id}
                  onClick=${() => act(i.id, () => deleteIntent(i.id))}>
                  ${tr('pool.remove', 'Remove')}
                </button>`}
            </div>
          </li>`)}
      </ul>
    </section>`;
}

export default IntentPool;
