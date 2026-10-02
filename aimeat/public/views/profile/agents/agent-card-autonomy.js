/**
 * @file public/views/profile/agents/agent-card-autonomy.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent card's two lines a person decides on: where the agent runs (with what it
 *   thinks with and who pays), and whether it starts work by itself (guided journey P4, brief
 *   doc-mupor242l3cq).
 *
 *   WHY A SWITCH. Whether an agent starts work without asking is the most consequential setting it
 *   has. Since 2026-10-02 it is its own field, `task_start` (PATCH /v1/agents/:name/task-start,
 *   services/agent-task-rules.ts), so the switch works for every agent that takes tasks, the
 *   concierge included; until then it flipped `mode` between `task-runner` and `autonomous`, and an
 *   `interactive` front door could not have it at all. It is not shown for a chat connection, which
 *   is the person's own AI and is not given tasks. When the agent can spend money, send mail or
 *   delete as the owner, its work always waits, and the switch says so instead of moving.
 * @structure FactsLine({ agent }) · LastTaskLine({ agent }) · PurchaseLimitLine({ agent, showToast }) ·
 *   AutonomyLine({ agent, showToast }) · WildcardLine({ agent, showToast })
 * @usage <${FactsLine} agent=${agent} /> <${PurchaseLimitLine} agent=${agent} showToast=${showToast} />
 * @version-history
 *   v1.5.0 — 2026-10-02 — The question marks that explain "Starts work by itself" (agent.self_start)
 *     and the daily purchase limit (agent.purchase_limit, which carries what buyHint said)
 *     (components/HelpTip.js).
 *   v1.4.0 — 2026-10-02 — LastTaskLine: the newest task's title, who ordered it (you, an agent, an app) and when.
 *   v1.3.0 — 2026-10-02 — WildcardLine: an agent holding all permissions (`*`) says how far the record
 *     of what it uses is, and offers the narrowing to those permissions with one press (ruling C).
 *   v1.2.0 — 2026-10-02 — AutonomyLine writes `task_start` instead of `mode`, is shown for every
 *     agent that takes tasks, and says why when the permission floor holds its work.
 *   v1.1.0 — 2026-10-02 — PurchaseLimitLine: the agent's daily money limit for purchases, set here
 *     (decision D5, Jouni 2026-10-02).
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPatch, apiPut, apiPost } from '/js/api.js';
import { areaLine } from '/js/consent-vocab.js';
import { swallowed } from '/js/swallowed.js';
import { timeAgo } from '/js/utils.js';
import { CardLine } from '/components/OpenCard.js';
import { HelpLabel } from '/components/HelpTip.js';
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

/** Who ordered a task, in words: you, another of your agents, an app, or nobody recorded (before 2026-08-15). */
function orderedBy(createdBy) {
  if (!createdBy) return '';
  const local = String(createdBy).split('@')[0];
  if (!local.includes('#')) return f('byYou');
  const who = local.split('#')[0];
  return who.startsWith('eco:') ? f('byApp', { name: who.slice(4) }) : f('byAgent', { name: who });
}

/** "Last task": its title, who ordered it and when, from the agent's newest task. Read when the card opens. */
export function LastTaskLine({ agent }) {
  const [task, setTask] = useState(undefined);
  useEffect(() => {
    apiGet(`/v1/agents/${encodeURIComponent(agent.name)}/tasks?per_page=1`)
      .then(r => setTask((r?.data?.tasks ?? [])[0] ?? null))
      .catch(err => { swallowed('agent-card: last task', err); setTask(null); });
  }, [agent.name]);
  if (task === undefined) return null;
  const who = task ? orderedBy(task.createdBy) : '';
  return html`
    <${CardLine} label=${f('lastLabel')}>
      <span>${!task ? f('lastNone')
        : who ? f('lastTask', { title: task.title, who, when: timeAgo(task.updatedAt) })
        : f('lastTaskNoWho', { title: task.title, when: timeAgo(task.updatedAt) })}</span>
    <//>
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
          <${TextField} label=${f('buyAmount')} help="agent.purchase_limit" value=${amount} onInput=${setAmount} />
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

/** What applies when the node has not said (an older node): the old rule, `task-runner` starts. */
const effectiveOf = (agent) => agent.task_start_effective || (agent.mode === 'task-runner' ? 'automatic' : 'confirm');

/**
 * "Starts work by itself": on is `task_start: automatic`, off is `confirm`. Not shown for a chat
 * connection or a workstation, the person's own AI, which is not given tasks. When the permission
 * floor holds the agent's work (`task_start_held_by`), the switch stays off and the line says why.
 */
export function AutonomyLine({ agent, showToast }) {
  const [start, setStart] = useState(effectiveOf(agent));
  const [saving, setSaving] = useState(false);
  if (agent.mode === 'workstation' || placeOf(agent) === 'chat') return null;
  const held = (agent.task_start_held_by ?? []).length > 0;
  const on = !held && start === 'automatic';

  async function toggle() {
    if (saving || held) return;
    const next = on ? 'confirm' : 'automatic';
    const previous = start;
    setSaving(true);
    setStart(next);
    try {
      await apiPatch(`/v1/agents/${encodeURIComponent(agent.name)}/task-start`, { task_start: next });
      showToast?.(next === 'automatic' ? f('selfStartOnSaved') : f('selfStartOffSaved'), 'success');
    } catch (err) {
      // Put it back: a switch that disagrees with the node is worse than the failed write.
      setStart(previous);
      swallowed('agent-card: self-start', err);
      showToast?.(f('selfStartFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return html`
    <${CardLine} label=${html`<${HelpLabel} term="agent.self_start" label=${f('selfStart')}>${f('selfStart')}<//>`}>
      <${Switch} on=${on} disabled=${held} onToggle=${toggle} label=${on ? f('yes') : f('no')} ariaLabel=${f('selfStart')} />
      <span>${held ? f('selfStartHeld') : on ? f('selfStartOn') : f('selfStartOff')}</span>
    <//>
  `;
}

/**
 * "All permissions" (`*`), for an agent that holds it (`task_start_wildcard` on the agent list,
 * services/scope-use.ts). While the node is still noting what it uses, the line says how many days
 * are left; once the record is ready the agent's tasks wait for the owner, and the line offers the
 * narrowing to the permissions it used with one press (POST /v1/agents/:name/scope-narrowing).
 */
export function WildcardLine({ agent, showToast }) {
  const w = agent.task_start_wildcard;
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!w || done) return null;
  const n = w.proposal.length;

  async function narrow() {
    if (saving) return;
    setSaving(true);
    try {
      await apiPost(`/v1/agents/${encodeURIComponent(agent.name)}/scope-narrowing`, {});
      setDone(true);
      showToast?.(f('wildcardNarrowed', { n }), 'success');
    } catch (err) {
      swallowed('agent-card: narrow', err);
      showToast?.(f('wildcardFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return html`
    <${CardLine} label=${f('wildcardLabel')}>
      <span>${w.ready
        ? f('wildcardReady', { n, areas: areaLine(w.proposal, t) })
        : f('wildcardCollecting', { days: w.days_left })}</span>
      ${w.used.length > 0 && html`<${Action} small soft onClick=${narrow}>${f('wildcardNarrow', { n })} →<//>`}
    <//>
  `;
}
