/**
 * @file public/components/IntentPool.js
 * @description The intent pool block: one list of what you are going to do here.
 *
 *   Every row carries its PROMPT, not a pair of management buttons. That is the shape the design
 *   drew and the reason the list is worth opening: a row is the thing itself, one click from being
 *   copied into a chat or handed to an agent. A first version put "Done" and "Remove" there instead
 *   and left the prompt out entirely — a to-do list you can tick and delete, which is the one kind
 *   of list nobody comes back to. Done and Remove now live behind the same chevron as everything
 *   else.
 *
 *   Human-written intents and system suggestions share one list, told apart by the second line —
 *   same shape, different author. A suggestion carries no controls at all: it disappears by itself
 *   when its condition is true, so ticking or deleting one is not a thing to offer.
 *
 *   EMPTY RENDERS NOTHING. Not a heading with an encouraging sentence under it: an empty state is
 *   read as broken, and "you have no intentions" is exactly that.
 * @structure IntentPool()
 * @usage html`<${IntentPool} />`
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, phase 3).
 *   v1.1.0 — 2026-08-09 — Rows carry the prompt (copy + chevron) per 03-pinnat-ja-ui.md, instead of
 *     the Done/Remove pair they shipped with. The word for an open item is "waiting", per P5.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { apiGet } from '/js/api.js';
import { PromptCard } from '/components/PromptCard.js';
import { listIntents, updateIntent, deleteIntent, reachableAgents, promoteIntent } from '/js/services/intents.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const MARK = { open: '○', working: '●', done: '✓' };

export function IntentPool() {
  const [intents, setIntents] = useState(null);
  const [agents, setAgents] = useState([]);
  // prompt_ref → text. Fetched once per DISTINCT ref, not once per row: a list of ten items about
  // building apps is one prompt, not ten.
  const [prompts, setPrompts] = useState({});

  const load = useCallback(async () => {
    try { setIntents(await listIntents()); }
    catch (e) { swallowed('IntentPool: load', e); setIntents([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    reachableAgents().then(setAgents).catch(e => swallowed('IntentPool: agents', e));
  }, []);

  // Every surface showing server data re-fetches on this; a pool that goes stale while an agent
  // works through it would be the one list you cannot trust.
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  useEffect(() => {
    const refs = [...new Set((intents ?? []).map(i => i.prompt_ref).filter(Boolean))]
      .filter(ref => !(ref in prompts));
    if (refs.length === 0) return;
    let alive = true;
    Promise.all(refs.map(ref =>
      apiGet(`/v1/prompts/${encodeURIComponent(ref)}`)
        .then(r => [ref, r?.data?.prompt || ''])
        .catch(e => { swallowed('IntentPool: prompt ' + ref, e); return [ref, '']; })))
      .then(pairs => { if (alive) setPrompts(prev => ({ ...prev, ...Object.fromEntries(pairs) })); });
    return () => { alive = false; };
  }, [intents, prompts]);

  const act = useCallback(async (fn) => {
    try { await fn(); await load(); }
    catch (e) { swallowed('IntentPool: act', e); }
  }, [load]);

  // Nothing to show → no block at all. See the file header.
  if (!intents || intents.length === 0) return null;

  return html`
    <section class="koti-pool">
      <h3 class="koti-pool-title">${tr('pool.title', 'What you are going to do')}</h3>
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
            ${/* A suggestion gets no controls: it closes itself, and offering Done would invite a
                 person to tick something the node is about to withdraw anyway. */''}
            ${!i.closes_when && html`
              <div class="koti-pool-control">
                ${i.prompt_ref && prompts[i.prompt_ref]
                  ? html`<${PromptCard}
                      label=""
                      prompt=${prompts[i.prompt_ref]}
                      className="btn-outline btn-sm"
                      copyLabel=${tr('home.rooms.copyPrompt', 'Copy the prompt')}
                      copiedLabel=${tr('home.rooms.copied', 'Copied — paste it in your AI chat')}
                      showPrompt=${false}
                      agents=${i.status === 'open' ? agents : []}
                      onGiveToAgent=${(a) => act(() => promoteIntent(i, a))}
                      extraActions=${poolActions(i, act)} />`
                  : html`<div class="koti-pool-actions">
                      ${poolActions(i, act).map((a, idx) => html`
                        <button type="button" key=${idx} class="btn-ghost btn-sm"
                          onClick=${() => act(a.run)}>${a.label}</button>`)}
                    </div>`}
              </div>`}
          </li>`)}
      </ul>
    </section>`;
}

/** Done and Remove — the two things that are true of any human-written row, prompt or not. */
function poolActions(intent, act) {
  const rows = [];
  if (intent.status !== 'done') {
    rows.push({
      label: tr('pool.markDone', 'Done'),
      run: () => updateIntent(intent.id, { status: 'done' }),
    });
  }
  rows.push({
    label: tr('pool.remove', 'Remove'),
    run: () => deleteIntent(intent.id),
  });
  return rows.map(r => ({ ...r, run: () => act(r.run) }));
}

export default IntentPool;
