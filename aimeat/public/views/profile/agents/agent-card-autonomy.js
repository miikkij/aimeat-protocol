/**
 * @file public/views/profile/agents/agent-card-autonomy.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent card's two lines a person decides on: where the agent runs (with what it
 *   thinks with and who pays), and whether it starts work by itself (guided journey P4, brief
 *   doc-mupor242l3cq).
 *
 *   WHY A SWITCH FOR THE MODE. The node starts a queued task without asking only for an agent whose
 *   mode is `task-runner` (services/agent-task-rules.ts). That is the most consequential setting an
 *   agent has, and it sat in a five-value mode word with a tooltip. Here it is one switch with the
 *   sentence of what it does. The five modes stay in the API; the switch moves a worker between
 *   `task-runner` and `autonomous` only, and is not shown for a chat connection (`interactive`,
 *   `workstation`) or a coordinator, whose mode means something else.
 * @structure FactsLine({ agent }) · PurchaseLimitLine({ agent, showToast }) · AutonomyLine({ agent, showToast })
 * @usage <${FactsLine} agent=${agent} /> <${PurchaseLimitLine} agent=${agent} showToast=${showToast} />
 * @version-history
 *   v1.1.0 — 2026-10-02 — PurchaseLimitLine: the agent's daily money limit for purchases, set here
 *     (decision D5, Jouni 2026-10-02).
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPatch, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { CardLine } from '/components/OpenCard.js';
import { Switch } from '/components/Switch.js';
import { Choice } from '/components/Choice.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Stack } from '/components/Layout.js';
import { agentFacts, placeOf } from './agent-facts.js';

const f = (key, vars) => t('profile.agents.facts.' + key, vars);

/** "Runs on … · thinks with … · paid by …", read from what the node knows (agent-facts.js). */
export function FactsLine({ agent }) {
  const facts = agentFacts(agent);
  const doneWeek = agent?.stats?.tasks?.doneWeek;
  return html`
    <${CardLine} label=${f('label')}>
      <span>${f('line', { runsOn: facts.runsOn, thinksWith: facts.thinksWith, paidBy: facts.paidBy })}</span>
    <//>
    ${typeof doneWeek === 'number' && html`<${CardLine} label=${f('weekLabel')}>
      <span>${doneWeek > 0 ? f('weekDone', { n: doneWeek }) : f('weekNone')}</span>
    <//>`}
  `;
}

/**
 * "Purchases per day": how much money this agent may spend on purchases in a day, and what it spent
 * today (GET/PUT /v1/agents/:name/purchase-limit). With no limit the agent does not spend money; the
 * node refuses its checkout and names this card (commerce/agent-purchase-limit.ts). Setting it
 * needs the owner signed in themselves, which this page is.
 */
export function PurchaseLimitLine({ agent, showToast }) {
  const [view, setView] = useState(null);
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState('EUR');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const path = `/v1/agents/${encodeURIComponent(agent.name)}/purchase-limit`;

  useEffect(() => {
    apiGet(path).then(r => setView(r?.data ?? null)).catch(err => { swallowed('agent-card: purchase limit', err); setView(null); });
  }, [path]);

  const rows = (view?.limits ?? []).filter(l => l.per_day !== null);
  // The field starts at the limit the chosen currency has, so changing it is editing a number.
  const pickCurrency = (c) => { setCurrency(c); const r = rows.find(l => l.currency === c); setAmount(r ? String(r.per_day) : ''); };
  const toggleOpen = () => { if (!open) pickCurrency(currency); setOpen(v => !v); };
  const words = rows.length
    ? rows.map(l => f('buyLine', { amount: l.per_day, currency: l.currency, spent: l.spent_today })).join(' · ')
    : f('buyNone');

  async function save(perDay) {
    setSaving(true);
    try {
      const r = await apiPut(path, { currency, per_day: perDay });
      setView(r?.data ?? null);
      setOpen(false);
      showToast?.(perDay === null ? f('buyCleared', { currency }) : f('buySaved', { amount: perDay, currency }), 'success');
    } catch (err) {
      swallowed('agent-card: purchase limit save', err);
      showToast?.(err?.message || f('selfStartFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }
  const n = Number(String(amount).replace(',', '.'));
  const valid = amount !== '' && Number.isFinite(n) && n >= 0;

  return html`
    <${CardLine} label=${f('buyLabel')} below=${open && html`
      <${Stack} gap="medium">
        <${Fields}>
          <${Choice} label=${f('buyCurrency')} value=${currency} onChange=${pickCurrency}
            options=${[['EUR', 'EUR'], ['USD', 'USD']]} />
          <${TextField} label=${f('buyAmount')} hint=${f('buyHint')} value=${amount} onInput=${setAmount} />
        <//>
        <${Actions}>
          <${Loud} control disabled=${!valid || saving} onClick=${() => save(n)}>${f('buySave')}<//>
          ${rows.some(l => l.currency === currency) && html`<${Action} small soft disabled=${saving} onClick=${() => save(null)}>${f('buyRemove', { currency })}<//>`}
        <//>
      <//>`}>
      <span>${view ? words : t('common.loading')}</span>
      <${Action} small soft onClick=${toggleOpen}>${open ? t('profile.agents.page.close') : f('buyChange')} →<//>
    <//>
  `;
}

/** The two modes the switch moves between; it never writes any other, so pressing twice returns. */
const SWITCHABLE = new Set(['task-runner', 'autonomous']);

/**
 * "Starts work by itself": on is `task-runner`, off is `autonomous`. Shown only for a worker: a chat
 * connection (`interactive`, `workstation`) answers while the person talks, and changing its mode
 * also changes its onboarding steps, which a browser check measured on 2026-10-01.
 */
export function AutonomyLine({ agent, showToast }) {
  const [mode, setMode] = useState(agent.mode || 'interactive');
  const [saving, setSaving] = useState(false);
  if (!SWITCHABLE.has(mode) || placeOf(agent) === 'chat') return null;
  const on = mode === 'task-runner';

  async function toggle() {
    if (saving) return;
    const next = on ? 'autonomous' : 'task-runner';
    const previous = mode;
    setSaving(true);
    setMode(next);
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(agent.name)}/mode`, { mode: next });
      showToast?.(next === 'task-runner' ? f('selfStartOnSaved') : f('selfStartOffSaved'), 'success');
    } catch (err) {
      // Put it back: a switch that disagrees with the node is worse than the failed write.
      setMode(previous);
      swallowed('agent-card: self-start', err);
      showToast?.(f('selfStartFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return html`
    <${CardLine} label=${f('selfStart')}>
      <${Switch} on=${on} onToggle=${toggle} label=${on ? f('yes') : f('no')} />
      <span>${on ? f('selfStartOn') : f('selfStartOff')}</span>
    <//>
  `;
}
