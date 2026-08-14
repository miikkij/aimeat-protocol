/**
 * @file public/views/profile/landing-page.cards.js
 * @description Profile home dashboard cards, home sub-components, and the sidebar group model. Extracted from landing-page.js to satisfy max-file-lines.
 * @version-history
 *   2026-07-19 — Re-add the orphaned OpenRouter Settings item (route id 'generator') to the Build & Share
 *     group — it lost its menu entry when the Generator feature was removed, leaving the AI-provider key
 *     config reachable only by deep link.
 *   2026-07-19 — AppDev tab (KB UI): learned-pitfall + template management surface, start-prompt copy, model badge
 *   v1.2.0 — 2026-07-16 — Drop the per-item emoji icons from SIDEBAR_GROUPS and the Inbox nav
 *     button — the sidebar renders label-only now.
 *   v1.1.0 — 2026-07-16 — Contacts tab in the Activity sidebar group.
 *   v1.0.0 — 2026-07-13 — Extracted from views/profile/landing-page.js (max-file-lines)
 */
import { h } from "preact";
import { OpenItemsList } from '/components/OpenItemsList.js';
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);
import { t, getLocale } from "/js/i18n.js";
import { escHtml, fmtMoney } from "/js/utils.js";
import { getNodeUrl } from "/js/services/auth.js";
import { listAgents } from "/js/services/agents.js";
import { listAllSchedules } from "/js/services/schedules.js";
import * as orgService from "/js/services/organisms.js";
import { onLiveUpdate } from "/lib/live-updates.js";
import { listRecents } from "/js/recents.js";
import { listInbox } from "/js/services/messages.js";
import { apiGet } from "/js/api.js";
import { checkHelloMcp } from "/js/services/hello-mcp.js";
import { InstructionsDialog } from "/views/profile/ai-setup-guide.js";
import { UsageChart, colorForIndex } from "/components/UsageChart.js";
import { minidenticon } from "/lib/minidenticons.min.js";
import { PresencePill } from "./landing-page.modals.js";
import { swallowed } from '/js/swallowed.js';
import {
  relTime, fmtClock, openProfileTab, gotoWorkspace, gotoOrganism, gotoOrganismsList,
  fmtBytes, fmtUsd, fmtCompact,
} from "./landing-page.helpers.js";

/* ───── Home dashboard cards ───── */

/* "Waiting for you" — everything that needs the user's decision, aggregated across organisms:
 * pending publish approvals (per workspace), pending join requests (orgs they manage), and
 * incoming organism invitations. Renders nothing when there is nothing to do. */
export function WaitingForYou() {
  const [items, setItems] = useState(null);
  // ONE aggregated request replaces the old per-org fan-out (listOrganisms → per-org listApprovals +
  // listJoinRequests + listWorkspaces + a final listMyInvitations). The server returns the same flat
  // {kind:'review'|'join'|'invite', …} items this widget renders.
  const load = useCallback(async () => { setItems(await orgService.getWaiting()); }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  // Only re-run the per-organism approvals/join-requests fan-out when ORGANISMS actually
  // change — not on every unrelated event (agent churn, memory, etc.), which on an account in
  // many organisms turned into a hundreds-of-requests storm.
  useEffect(() => onLiveUpdate(['organisms'], () => liveRef.current()), []);

  if (!items || items.length === 0) return null;
  return html`
    <div class="pf-waiting">
      <div class="pf-waiting-title">${'📨 '}${t('profile.landing.waitingTitle') || 'Waiting for you'}</div>
      ${items.map((it, i) => html`
        <div class="pf-waiting-row" key=${i}>
          <span class="pf-waiting-text">
            ${it.kind === 'review' ? html`
              <b>${(t('profile.landing.draftsToReview') || '{n} drafts to review').replace('{n}', String(it.n))}</b>
              <span class="pf-waiting-where"> · ${escHtml(it.orgName)} / ${escHtml(it.wsName)}</span>` : null}
            ${it.kind === 'join' ? html`
              <b>${it.n === 1 ? (t('profile.landing.joinReqOne') || '1 join request') : (t('profile.landing.joinReqMany') || '{n} join requests').replace('{n}', String(it.n))}</b>
              <span class="pf-waiting-where"> · ${escHtml(it.orgName)}</span>` : null}
            ${it.kind === 'invite' ? html`
              <b>${t('profile.landing.inviteWaiting') || 'You’re invited'}</b>
              <span class="pf-waiting-where"> · ${escHtml(it.orgName)}</span>` : null}
          </span>
          ${it.kind === 'review' ? html`
            <button class="btn-outline btn-sm" onClick=${() => (it.wsId ? gotoWorkspace(it.orgId, it.wsId, 'review') : gotoOrganism(it.orgId))}>${t('profile.landing.reviewBtn') || 'Review'}</button>` : null}
          ${it.kind === 'join' ? html`
            <button class="btn-outline btn-sm" onClick=${() => gotoOrganism(it.orgId, 'members')}>${t('profile.landing.viewBtn') || 'View'}</button>` : null}
          ${it.kind === 'invite' ? html`
            <button class="btn-outline btn-sm" onClick=${() => gotoOrganismsList()}>${t('profile.landing.viewBtn') || 'View'}</button>` : null}
        </div>
      `)}
    </div>
  `;
}

/* "Continue" — the last opened things across types (workspace / app / organism), with real
 * display names. Backed by /js/recents.js (device-local). Renders nothing when empty. */
const RECENT_ICONS = { workspace: '🗂', app: '▦', organism: '🏢', board: '📋' };
export function ContinueCard() {
  const [items] = useState(() => listRecents(5));
  if (!items.length) return null;
  const openItem = (it) => {
    if (it.type === 'workspace' && it.data?.orgId) gotoWorkspace(it.data.orgId, it.data.wsId);
    else if (it.type === 'organism' && it.data?.orgId) gotoOrganism(it.data.orgId);
    else if (it.type === 'app' && it.data?.filename) window.open(`/v1/apps/${encodeURIComponent(it.data.owner)}/${encodeURIComponent(it.data.filename)}?mode=inline`, '_blank');
  };
  return html`
    <div class="pf-home-card">
      <div class="pf-home-card-title">${t('profile.landing.continueTitle') || 'Continue'}</div>
      ${items.map(it => html`
        <button class="pf-home-row" key=${it.type + it.id} onClick=${() => openItem(it)}>
          <span class="pf-home-row-ico">${RECENT_ICONS[it.type] || '•'}</span>
          <span class="pf-home-row-label">${escHtml(it.label)}</span>
          <span class="pf-home-row-meta">${relTime(it.at)}</span>
        </button>
      `)}
    </div>
  `;
}

/* "Agents" — who has been active today, who is idle, and the next scheduled run. */
export function AgentsCard({ owner, initialAgents }) {
  // The Home /v1/owner/home composite already resolves the owner's agent list (initialAgents) — seed from
  // it and skip the mount /v1/agents fetch (dropping that duplicate). The next-scheduled-job row still
  // needs the schedules call (not in the composite); live-update refreshes both.
  // Excluded from the HOME card (both still live in the Agents tab):
  //   session-*  — per-session scratch identities, never user-facing.
  //   app        — the built-in agent registration creates for in-app calls. Counting it made a
  //                brand-new account read "1 agent active today" when the person had connected
  //                nothing, which is a claim about work that never happened (UX-remake v3, P5).
  const seedAgents = (list) => (Array.isArray(list) ? list : [])
    .filter(a => !String(a.name || '').startsWith('session-') && String(a.name || '') !== 'app')
    .slice().sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
  const [agents, setAgents] = useState(initialAgents ? seedAgents(initialAgents) : null);
  const [nextJob, setNextJob] = useState(null);
  const loadAgents = useCallback(async () => {
    try { setAgents(seedAgents(await listAgents(owner))); } catch (err) { swallowed('landing-page.cards', err); setAgents([]); }
  }, [owner]);
  const loadSchedules = useCallback(async () => {
    try {
      const r = await listAllSchedules();
      const all = [...(r?.data?.managed || []), ...(r?.data?.extensions || []), ...(r?.data?.agentInternal || [])]
        .filter(s => s.enabled !== false && s.nextRunAt && new Date(s.nextRunAt).getTime() > Date.now())
        .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)));
      setNextJob(all[0] || null);
    } catch (err) { swallowed('landing-page.cards: seedAgents', err); }
  }, []);
  const load = useCallback(async () => { await Promise.all([loadAgents(), loadSchedules()]); }, [loadAgents, loadSchedules]);
  useEffect(() => { if (initialAgents) setAgents(seedAgents(initialAgents)); }, [initialAgents]);
  useEffect(() => { loadSchedules(); }, [loadSchedules]);   // schedules aren't in the composite
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['agents', 'agent-tasks', 'schedules'], () => liveRef.current()), []);

  if (!agents || (agents.length === 0 && !nextJob)) return null;
  const todayStr = new Date().toDateString();
  const isToday = (s) => s && new Date(s).toDateString() === todayStr;
  const activeToday = agents.filter(a => isToday(a.last_seen)).length;
  return html`
    <div class="pf-home-card">
      <button class="pf-home-card-title pf-home-card-link" onClick=${() => openProfileTab('agents')}>
        ${t('profile.landing.agentsTitle') || 'Agents'}
        ${activeToday > 0 ? html`<span class="pf-home-card-note"> · ${(t('profile.landing.activeTodayCount') || '{n} active today').replace('{n}', String(activeToday))}</span>` : null}
      </button>
      ${agents.slice(0, 3).map(a => html`
        <button class="pf-home-row" key=${a.gaii || a.name}
          onClick=${() => {
            // eslint-disable-next-line aimeat/no-silent-catch -- a browser refusing sessionStorage here IS the answer: the tab still opens, it just does not preselect this agent
            try { sessionStorage.setItem('aimeat.agents.open', a.name); } catch { /* noop */ }
            openProfileTab('agents');
          }}>
          <span class="pf-home-row-ico">${'🤖'}</span>
          <span class="pf-home-row-label">${escHtml(a.display_name || a.name)}</span>
          <span class="pf-home-row-meta ${isToday(a.last_seen) ? 'pf-ok' : ''}">
            ${a.last_seen ? (isToday(a.last_seen) ? (t('profile.landing.agentActiveToday') || 'active today') : relTime(a.last_seen)) : '—'}
          </span>
        </button>
      `)}
      ${nextJob ? html`
        <button class="pf-home-row" key="nextjob" onClick=${() => openProfileTab('scheduler')}>
          <span class="pf-home-row-ico">⏰</span>
          <span class="pf-home-row-label">${escHtml(nextJob.name || nextJob.id || '')}</span>
          <span class="pf-home-row-meta">${(t('profile.landing.nextRunAt') || 'next run {time}').replace('{time}', fmtClock(nextJob.nextRunAt))}</span>
        </button>` : null}
    </div>
  `;
}

/* "Usage" — quota usage bars (memory / storage / micro-memory) + resource counts. Backed by the
 * cached GET /v1/owner/usage endpoint (60s server-side TTL), so it's cheap to refetch on each
 * live-update. Surfaces the same kind of quota bar the Memory tab shows, for the whole account. */

export function UsageCard({ switchTab, initialUsage }) {
  // The Home landing is the only place this renders, and its /v1/owner/home composite already carries the
  // usage summary — so we seed from initialUsage and never mount-fetch /v1/owner/usage (dropping that
  // duplicate). We still refresh on live-update for freshness after a real change.
  const [u, setU] = useState(initialUsage ?? null);
  const load = useCallback(async () => {
    try { const r = await apiGet('/v1/owner/usage'); setU(r?.data || null); } catch (err) { swallowed('landing-page.cards', err); setU(null); }
  }, []);
  useEffect(() => { if (initialUsage) setU(initialUsage); }, [initialUsage]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['memory', 'files', 'agents', 'apps', 'organisms'], () => liveRef.current()), []);

  if (!u) return null;

  const bar = (label, q, usedText) => {
    const pct = q.percent >= 0 ? Math.max(0, Math.min(100, q.percent)) : 0;
    return html`
      <div class="pf-usage-row">
        <div class="pf-usage-head">
          <span class="pf-usage-label">${label}</span>
          <span class="text-meta-sm">${usedText}</span>
        </div>
        <div class="pf-usage-bar"><div class="pf-usage-fill ${pct >= 90 ? 'pf-usage-fill--danger' : ''}" style=${`width:${pct}%`}></div></div>
      </div>`;
  };

  const chip = (label, value, tab) => html`
    <button class="pf-usage-chip" onClick=${tab ? () => switchTab(tab) : undefined} disabled=${!tab}>
      <span class="pf-usage-chip-val">${value}</span>
      <span class="pf-usage-chip-label">${label}</span>
    </button>`;

  const c = u.counts;
  return html`
    <div class="pf-home-card pf-usage-card">
      <div class="pf-home-card-title">${t('profile.landing.usageTitle') || 'Usage & quotas'}</div>
      ${bar(t('profile.landing.usageMemory') || 'Memory', u.memory,
        `${u.memory.used_keys}/${u.memory.max_keys} ${t('profile.memory.keysWord') || 'keys'} · ${fmtBytes(u.memory.used_bytes)} / ${fmtBytes(u.memory.max_bytes)}`)}
      ${bar(t('profile.landing.usageStorage') || 'Files', u.storage,
        `${u.storage.used_files} ${t('profile.landing.usageFilesWord') || 'files'} · ${fmtBytes(u.storage.used_bytes)} / ${fmtBytes(u.storage.max_bytes)}`)}
      ${bar(t('profile.landing.usageMicro') || 'Micro-memory', u.micro_memory,
        `${u.micro_memory.used_sets}/${u.micro_memory.max_sets} ${t('profile.landing.usageSetsWord') || 'sets'} · ${fmtBytes(u.micro_memory.used_bytes)} / ${fmtBytes(u.micro_memory.max_bytes)}`)}
      <div class="pf-usage-chips">
        ${chip(t('profile.landing.usageAgents') || 'Agents', c.agents, 'agents')}
        ${chip(t('profile.landing.usageOrganisms') || 'Organisms', c.organisms, 'organisms')}
        ${chip(t('profile.landing.usageApps') || 'Apps', `${c.apps.used}/${c.apps.max}`, 'apps')}
        ${chip(t('profile.landing.usageEcoApps') || 'Connected apps', c.ecosystem_apps, 'ecosystem')}
        ${chip(t('profile.landing.usageExtensions') || 'Extensions', `${c.extensions.used}/${c.extensions.max}`, 'extensions')}
        ${chip(t('profile.landing.usageCortexes') || 'Cortexes', c.cortexes, 'extensions')}
        ${chip(t('profile.landing.usageServices') || 'Services', `${c.services.used}/${c.services.max}`, 'offers')}
      </div>
    </div>
  `;
}

/* "AI spend" — token/cost analytics for the owner's AI apps over the last 24h / 7d / 30d,
 * plus a per-app stacked bar of the last 30 days. Backed by GET /v1/ai/usage/history (reads the
 * retained per-day ai-usage records). Hidden until there is any spend, so it never shows an empty
 * chart to users who don't run AI apps. */

/* "Commerce" — the owner's marketplace status: purchases (checkout sessions), sales received,
 * and morsels moved, from /v1/commerce. Hidden when commerce is disabled on the node (503). */
export function CommerceCard() {
  const [stats, setStats] = useState(null);
  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([
        apiGet('/v1/commerce/checkout-sessions?limit=100'),
        apiGet('/v1/commerce/orders?limit=100'),
      ]);
      const sessions = s?.data?.sessions ?? [];
      const orders = o?.data?.orders ?? [];
      const completed = sessions.filter((x) => x.status === 'completed');
      // Currencies never mix: morsels and each money code (minor units) total separately.
      const sumBy = (list, pick) => {
        const by = {};
        for (const x of list) {
          const cur = x.currency || 'morsel';
          by[cur] = (by[cur] || 0) + (pick(x) || 0);
        }
        return by;
      };
      setStats({
        bought: completed.length,
        open: sessions.filter((x) => x.status === 'open').length,
        spentBy: sumBy(completed, (x) => x.receipt && x.receipt.charged),
        sold: orders.length,
        earnedBy: sumBy(orders, (x) => x.receipt && x.receipt.earned),
      });
    } catch (err) { swallowed('landing-page.cards', err); setStats(null); /* commerce disabled or unreachable — render nothing */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['agent-tasks', 'memory'], () => liveRef.current()), []);

  if (!stats) return null;
  const chip = (label, main, sub) => html`
    <div class="pf-ai-win">
      <span class="pf-ai-win-label">${label}</span>
      <span class="pf-ai-win-cost">${main}</span>
      <span class="pf-ai-win-sub">${sub}</span>
    </div>`;
  const morsels = t('profile.landing.commerceMorsels') || 'morsels';
  // "10 morsels · 15.00 EUR" — money amounts are micro-units, never summed with morsels.
  const fmtTotals = (by) => Object.entries(by)
    .map(([cur, n]) => cur === 'morsel' ? `${n} ${morsels}` : fmtMoney(n, cur))
    .join(' · ') || `0 ${morsels}`;
  return html`
    <div class="pf-home-card pf-commerce-card">
      <div class="pf-home-card-title">${t('profile.landing.commerceTitle') || 'Commerce'}</div>
      <div class="pf-ai-windows">
        ${chip(t('profile.landing.commerceBought') || 'Purchases', String(stats.bought), fmtTotals(stats.spentBy))}
        ${chip(t('profile.landing.commerceSold') || 'Sales', String(stats.sold), fmtTotals(stats.earnedBy))}
        ${chip(t('profile.landing.commerceOpen') || 'Open carts', String(stats.open), t('profile.landing.commerceOpenSub') || 'checkout sessions')}
      </div>
    </div>`;
}

export function AiSpendCard() {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try { const r = await apiGet('/v1/ai/usage/history?days=30'); setData(r?.data || null); }
    catch (err) { swallowed('landing-page.cards', err); setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['apps', 'memory'], () => liveRef.current()), []);

  if (!data || !Array.isArray(data.days) || data.days.length === 0) return null;

  const { days, apps = [], windows } = data;
  const labels = days.map((d) => d.date.slice(5));
  const datasets = apps.map((app, i) => ({
    label: app,
    data: days.map((d) => (d.per_app && d.per_app[app] ? d.per_app[app].cost_usd : 0) || 0),
    backgroundColor: colorForIndex(i),
  }));

  const d30 = (windows && windows.d30) || { cost_usd: 0, per_app: {} };
  const totalCost = d30.cost_usd || 0;
  const topApps = Object.entries(d30.per_app || {})
    .sort((a, b) => b[1].cost_usd - a[1].cost_usd).slice(0, 5);

  const win = (label, w) => html`
    <div class="pf-ai-win">
      <span class="pf-ai-win-label">${label}</span>
      <span class="pf-ai-win-cost">${fmtUsd(w && w.cost_usd)}</span>
      <span class="pf-ai-win-sub">${fmtCompact(w && w.tokens)} ${t('profile.landing.aiTokensWord') || 'tokens'}</span>
    </div>`;

  return html`
    <div class="pf-home-card pf-ai-card">
      <div class="pf-home-card-title">${t('profile.landing.aiSpendTitle') || 'AI apps spend'}</div>
      <div class="pf-ai-windows">
        ${win(t('profile.landing.aiWin24h') || 'Today', windows && windows.d1)}
        ${win(t('profile.landing.aiWin7d') || '7 days', windows && windows.d7)}
        ${win(t('profile.landing.aiWin30d') || '30 days', windows && windows.d30)}
      </div>
      ${datasets.length > 0 && html`
        <div class="pf-ai-chart">
          <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${180}
            legend=${false} yFormat=${fmtUsd} />
        </div>`}
      ${topApps.length > 0 && html`
        <div class="pf-ai-apps">
          <div class="pf-ai-apps-head">${t('profile.landing.aiWhereMoney') || 'Where it went (30d)'}</div>
          ${topApps.map(([app, m]) => {
            const pct = totalCost > 0 ? Math.round((m.cost_usd / totalCost) * 100) : 0;
            return html`
              <div class="pf-ai-app-row" key=${app}>
                <span class="pf-ai-app-dot" style=${`background:${colorForIndex(apps.indexOf(app))}`}></span>
                <span class="pf-ai-app-name">${app}</span>
                <span class="pf-ai-app-cost">${fmtUsd(m.cost_usd)}</span>
                <span class="pf-ai-app-pct">${pct}%</span>
              </div>`;
          })}
        </div>`}
    </div>`;
}

/* "Agent LLM usage" — the owner's own agent LLM ledger (priced per-call usage of the owner's
 * agents), grouped by model. A DIFFERENT system from AiSpendCard (which shows AI-apps spend) — the
 * two are never summed. Backed by the owner-scoped GET /v1/ledger/usage?group_by=model. Hidden
 * until there is any agent LLM spend, so users who don't run agents never see an empty card. */
export function AgentLedgerCard() {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try { const r = await apiGet('/v1/ledger/usage?group_by=model'); setData(r?.data || null); }
    catch (err) { swallowed('landing-page.cards', err); setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['agents', 'agent-tasks'], () => liveRef.current()), []);

  if (!data || !data.totals || data.totals.calls === 0) return null;

  const { totals, groups = [] } = data;
  const topModels = [...groups].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0)).slice(0, 5);

  const tile = (label, value) => html`
    <div class="pf-ai-win">
      <span class="pf-ai-win-label">${label}</span>
      <span class="pf-ai-win-cost">${value}</span>
    </div>`;

  return html`
    <div class="pf-home-card pf-ai-card">
      <div class="pf-home-card-title">${t('profile.landing.agentLedgerTitle') || 'Agent LLM usage'}</div>
      <div class="pf-ai-windows">
        ${tile(t('profile.landing.agentLedgerCost') || 'Cost', fmtUsd(totals.cost_usd))}
        ${tile(t('profile.landing.agentLedgerTokens') || 'Tokens', fmtCompact(totals.total_tokens))}
        ${tile(t('profile.landing.agentLedgerCalls') || 'LLM calls', fmtCompact(totals.calls))}
      </div>
      ${topModels.length > 0 && html`
        <div class="pf-ai-apps">
          <div class="pf-ai-apps-head">${t('profile.landing.agentLedgerByModel') || 'By model'}</div>
          ${topModels.map((g) => html`
            <div class="pf-ai-app-row" key=${g.key}>
              <span class="pf-ai-app-name">${g.key}</span>
              <span class="pf-ai-app-meta">${(g.providers && g.providers.length) ? g.providers.join(', ') + ' · ' : ''}${fmtCompact(g.total_tokens)} ${t('profile.landing.aiTokensWord') || 'tokens'} · ${fmtCompact(g.calls)}</span>
              <span class="pf-ai-app-cost">${fmtUsd(g.cost_usd)}</span>
            </div>`)}
        </div>`}
    </div>`;
}

/* ───── Sub-components ───── */

/* The MCP-connected mark. DERIVED from the Hello MCP proof key on every read, never stored and
 * never settable by the user: only their AI can produce it, by writing through the connection.
 * Renders nothing at all until the read resolves, and nothing when unproven — an unproven state
 * belongs in the next-steps list as an action, not in the identity card as a complaint. */
function McpConnectedBadge() {
  const [proven, setProven] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    checkHelloMcp()
      .then(r => { if (!cancelled) setProven(r.passed); })
      .catch((err) => { swallowed('landing-page.cards: McpConnectedBadge', err); });
    return () => { cancelled = true; };
  }, []);
  if (!proven) return null;
  return html`<div class="pf-federation-badge pf-mcp-badge">
    <span class="pf-fed-dot"></span>${t('profile.mcpConnected') || 'MCP connected'}
  </div>`;
}

export function ProfileCard({ tier, stats, session, onEditProfile, switchTab }) {
  const NODE_URL = getNodeUrl();
  const [instrOpen, setInstrOpen] = useState(false);
  const isNew = tier === 'new';
  const isExperienced = tier === 'experienced';
  const avatarSvg = minidenticon(typeof session.owner === 'string' && session.owner ? session.owner : 'user');

  // Stats are NAVIGATION, not decoration \u2014 each one opens its own section.
  const stat = (icon, val, labelKey, tabId, green) => html`
    <button class="pf-lp-stat pf-lp-stat-link" onClick=${() => switchTab?.(tabId)}>
      ${icon} <span class="pf-lp-stat-val${green ? ' pf-lp-stat-green' : ''}">${val}</span> ${t(labelKey)}
    </button>`;

  return html`
    <div class="pf-lp-card">
      <div class="pf-lp-card-header">
        <div class="pf-lp-avatar" role="button" tabindex="0" title=${t('profile.landing.editProfile')}
          onClick=${() => onEditProfile?.()} dangerouslySetInnerHTML=${{ __html: avatarSvg }}></div>
        <div class="pf-lp-info">
          <div class="pf-lp-name-row">
            <span class="pf-lp-name">${escHtml(session.displayName || session.owner)}</span>
          </div>
          <div class="pf-lp-ghii">${escHtml(session.ghii || '')}</div>
          <div class="pf-lp-node">${t('profile.node')}: ${escHtml(NODE_URL)}</div>
          <${McpConnectedBadge} />
          ${typeof stats.nodes === 'number' && stats.nodes > 0
            ? html`<div class="pf-federation-badge">
                <span class="pf-fed-dot"></span>
                ${t('profile.federation.statusConnected').replace('{count}', String(stats.nodes))}
              </div>`
            : html`<div class="pf-federation-badge pf-federation-standalone">
                ${t('profile.federation.statusStandalone')}
              </div>`
          }
        </div>
        <div class="pf-lp-actions">
          <${PresencePill} />
          <button class="btn-outline btn-sm" onClick=${() => setInstrOpen(true)}
            title=${t('setup.instrBtnHint') || 'The block to paste into your AI chat’s instructions, and where it goes in your tool'}>
            ${t('setup.instrBtn') || 'AI chat instructions'}</button>
          <button class="btn-outline btn-sm" onClick=${() => onEditProfile?.()}>
            ${t('profile.landing.profileBtn') || 'Profile'}</button>
        </div>
      </div>
      <div class="pf-lp-stats">
        ${isNew ? html`
          ${stats.memory > 0 && stat('\u{1F9E0}', stats.memory, 'profile.stats.memories', 'memory')}
          ${(stats.balance != null && stats.balance !== '-' && stats.balance > 0)
            && stat('\u{1F48E}', stats.balance, 'profile.stats.morsels', 'wallet', true)}
        ` : html`
          ${stats.apps > 0 && stat('\u{1F4F1}', stats.apps, 'profile.stats.apps', 'apps')}
          ${stats.memory > 0 && stat('\u{1F9E0}', stats.memory, 'profile.stats.memories', 'memory')}
          ${(stats.balance != null && stats.balance !== '-' && stats.balance > 0)
            && stat('\u{1F48E}', stats.balance, 'profile.stats.morsels', 'wallet', true)}
          ${stats.services > 0 && stat('\u{1F50C}', stats.services, 'profile.stats.services', 'actions')}
          ${isExperienced && stats.agents > 0 && stat('\u{1F916}', stats.agents, 'profile.stats.agents', 'agents')}
        `}
      </div>
      <${InstructionsDialog} open=${instrOpen} onClose=${() => setInstrOpen(false)} />
    </div>
  `;
}

/* "Suggested next steps" — a curated, value-first card pointing at the genuinely useful
 * but under-used surfaces (replaces the old four-path onboarding hero that flashed for
 * everyone because tier starts 'new' before stats load). First item highlighted:
 *   1. Write self-organizing notes → Notebook (always; the highest-value habit)
 *   2. Create your portfolio → Portfolio — ONLY if the user hasn't published one yet
 *      (under-used; tell others who you are)
 *   3. Build an app → the app catalog's create flow (prompt builder), in the portal's
 *      current language (?lang=) with the builder auto-opened (?create=1) — ONLY if the
 *      user has no app of their own yet
 *   4. Use agents others shared → the Offers "Do" surface (always)
 * The two conditional steps render only once their data is KNOWN to be "missing" (apps
 * loaded → 0; portfolio config fetched → not enabled), so an existing user never sees a
 * step flash in then disappear. Each step carries its own `go()` so it can switch a tab
 * OR open an external page. */
export function NextSteps({ switchTab, hasApps }) {
  // hasPortfolio: undefined = loading, true = published config exists, false = none yet.
  const [hasPortfolio, setHasPortfolio] = useState(undefined);
  // Hello MCP outranks everything else while it is unproven: until the connection is verified,
  // every other suggestion here is advice the user cannot act on properly. undefined = still
  // reading, so the step never flashes in for someone who already passed.
  const [mcpProven, setMcpProven] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    checkHelloMcp()
      .then(r => { if (!cancelled) setMcpProven(r.passed); })
      .catch((err) => { swallowed('landing-page.cards: helloMcp', err); if (!cancelled) setMcpProven(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    apiGet('/v1/portfolio/config')
      .then(r => { if (!cancelled) setHasPortfolio(!!(r?.data?.config?.enabled)); })
      .catch((err) => { swallowed('landing-page.cards', err); if (!cancelled) setHasPortfolio(false); });
    return () => { cancelled = true; };
  }, []);

  const buildAppUrl = `/app-catalog.html?lang=${encodeURIComponent(getLocale())}&create=1`;
  const steps = [];
  // First and most important until it passes, then gone: a proven connection is the thing the
  // rest of the product is used through.
  if (mcpProven === false) steps.push({ icon: '\u{1F50C}', key: 'helloMcp', go: () => switchTab('mcp') });
  steps.push({ icon: '\u{1F9E0}', key: 'writeNotes', go: () => switchTab('notebook') });
  if (hasPortfolio === false) steps.push({ icon: '\u{1F3A8}', key: 'portfolio', go: () => switchTab('portfolio') });
  if (hasApps === false) steps.push({ icon: '\u{26A1}', key: 'buildApp', go: () => window.open(buildAppUrl, '_blank', 'noopener') });
  steps.push({ icon: '\u{1F91D}', key: 'useSharedAgents', go: () => switchTab('offers') });

  return html`
    <div class="pf-next">
      <div class="pf-next-title">${t('profile.landing.nextTitle')}</div>
      <div class="pf-next-grid">
        ${steps.map((s, i) => html`
          <button class=${'pf-next-card' + (i === 0 ? ' pf-next-card--primary' : '')} key=${s.key}
            onClick=${s.go}>
            <span class="pf-next-ico">${s.icon}</span>
            <span class="pf-next-body">
              <span class="pf-next-card-title">${t('profile.landing.next.' + s.key + 'Title')}</span>
              <span class="pf-next-card-desc">${t('profile.landing.next.' + s.key + 'Desc')}</span>
            </span>
            <span class="pf-next-arrow" aria-hidden="true">→</span>
          </button>
        `)}
      </div>
      <${OpenItemsList} />
    </div>
  `;
}

/* Onboarding promo — shown only while the user has fewer than 3 apps, and dismissable for good.
 * After that the same content lives on the Extensions page; for a seasoned user it was dead space. */
export function CortexSection({ switchTab, onDismiss }) {
  return html`
    <div class="pf-landing-section pf-promo">
      <div class="pf-menu-title">${t('profile.landing.cortexSectionTitle')}
        <button class="pf-promo-dismiss" title=${t('profile.landing.promoDismiss') || 'Hide'}
          onClick=${(e) => { e.stopPropagation(); onDismiss?.(); }}>✕</button>
      </div>
      <div class="pf-cortex-grid">
        <div class="pf-cortex-card" onClick=${() => switchTab('extensions')}>
          <div class="pf-cortex-header">
            <span>\u{1F4CA}</span><span>${t('profile.landing.cortexCharts')}</span>
          </div>
          <p class="pf-cortex-desc">${t('profile.landing.cortexChartsDesc')}</p>
        </div>
        <div class="pf-cortex-card" onClick=${() => switchTab('extensions')}>
          <div class="pf-cortex-header">
            <span>\u{1F3A8}</span><span>${t('profile.landing.cortexCanvas')}</span>
          </div>
          <p class="pf-cortex-desc">${t('profile.landing.cortexCanvasDesc')}</p>
        </div>
      </div>
    </div>
  `;
}

/* (AppStrip removed \u2014 the cross-type "Continue" card replaced it: raw filenames in a horizontal
 * scroller duplicated the Apps tab and read as a file listing.) */

/* ───── Inbox nav button — fixed under Home (non-movable), with an unread badge ───── */

export function InboxNavButton({ active, onClick }) {
  const [unread, setUnread] = useState(0);
  const load = useCallback(async () => {
    try { const d = await listInbox(); setUnread(d?.unread || 0); } catch (err) { swallowed('landing-page.cards: InboxNavButton', err); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const ref = useRef(load); ref.current = load;
  useEffect(() => onLiveUpdate(['messages'], () => ref.current()), []);
  return html`
    <button class="pf-side-item${active ? ' pf-side-item--active' : ''}" onClick=${onClick}>
      <span class="pf-side-label">${t('profile.tabs.inbox')}</span>
      ${unread > 0 ? html`<span class="pf-side-badge">${unread}</span>` : null}
    </button>`;
}

/* ───── Persistent sidebar groups (replaces the tier-adaptive menu) ─────
 * Every tab is always present and grouped into stable sections — no activity-based
 * hiding, so humans and agentic developers can predict where each tab lives.
 * Group titles reuse existing i18n keys; tab labels reuse profile.tabs.* / *.tabLabel. */
/* Grouping follows the information-refinement pipeline and usage frequency, not an
 * abstract taxonomy (the old Daily/Personal/Technical groups are gone). Badges remain
 * reserved for action-required counts only — never static totals. */
export const SIDEBAR_GROUPS = [
  { titleKey: 'profile.landing.menuInformation', items: [   // find-anything → raw → curated → governed
    { id: 'discover', labelKey: 'discover.tabLabel' },
    { id: 'organisms', labelKey: 'profile.tabs.organisms' },
    { id: 'memory', labelKey: 'profile.tabs.memory' },
    { id: 'notebook', labelKey: 'profile.tabs.notebook' },
    { id: 'living', labelKey: 'profile.tabs.living' },
    { id: 'knowledge', labelKey: 'knowledge.tabLabel' },
    { id: 'boards', labelKey: 'profile.tabs.boards' },
  ] },
  { titleKey: 'profile.landing.menuAutomation', items: [    // agents + their infrastructure
    { id: 'agents', labelKey: 'profile.tabs.agents' },
    { id: 'ecosystem', labelKey: 'profile.tabs.ecosystem' },
    { id: 'offers', labelKey: 'profile.tabs.offers' },
    { id: 'scheduler', labelKey: 'profile.tabs.scheduler' },
    { id: 'workflows', labelKey: 'profile.tabs.workflows' },
    { id: 'actions', labelKey: 'profile.tabs.services' },
    { id: 'mcp', labelKey: 'profile.tabs.mcp' },
  ] },
  { titleKey: 'profile.landing.menuActivity', items: [      // communication + events
    { id: 'contacts', labelKey: 'contacts.tabLabel' },
    { id: 'notifications', labelKey: 'profile.tabs.notifications' },
    { id: 'email', labelKey: 'profile.tabs.email' },
    { id: 'chatsessions', labelKey: 'profile.tabs.chatSessions' },
  ] },
  { titleKey: 'profile.landing.menuBusiness', items: [     // the company and its money
    { id: 'companies', labelKey: 'profile.tabs.companies' },
    { id: 'pnl', labelKey: 'profile.tabs.pnl' },
    { id: 'usage', labelKey: 'profile.tabs.usage' },
  ] },
  { titleKey: 'profile.landing.menuBuildShare', items: [
    { id: 'apps', labelKey: 'profile.tabs.apps' },
    { id: 'appdev', labelKey: 'profile.tabs.appDev' },
    /* foundry removed from the menu 2026-06-10 (owner: not in use). The tab module and
     * its route id still exist — restore by re-adding this item. */
    { id: 'extensions', labelKey: 'profile.tabs.extensions' },
    { id: 'libraries', labelKey: 'librariesTab.tabLabel' },
    { id: 'capabilities', labelKey: 'capabilities.tabLabel' },
    { id: 'skills', labelKey: 'skills.tabLabel' },
    { id: 'packages', labelKey: 'profile.tabs.packages' },
    { id: 'portfolio', labelKey: 'portfolio.tabLabel' },
    /* AI-provider (OpenRouter) key + spend budget. Route id is still 'generator' — the Generator tab
     * was repurposed to host only these settings when the Generator feature was removed (2026-07-18).
     * Re-added to the menu 2026-07-19 after it was orphaned (reachable only by ?tab=generator). */
    { id: 'generator', labelKey: 'profile.generator.openrouter.title' },
    { id: 'calibrator', labelKey: 'profile.calibrator.tabLabel' },
    /* TODO(owner 2026-06-10): "work" placement is undecided — parked at the bottom of
     * Build & Share until re-evaluated. */
    { id: 'work', labelKey: 'profile.tabs.work' },
  ] },
  { titleKey: 'profile.landing.menuAccount', items: [
    { id: 'wallet', labelKey: 'profile.tabs.wallet' },
    { id: 'dataWallet', labelKey: 'profile.tabs.dataWallet' },
    { id: 'access', labelKey: 'profile.tabs.access' },
  ] },
  /* Operator-only: the group AND its routes are gated on the operator role (open()
   * refuses these ids for non-operators; the underlying APIs enforce server-side).
   * nodeStats left the menu — it lives as a tab on the Nodes page now. */
  { titleKey: 'profile.landing.menuInfra', adminOnly: true, items: [
    { id: 'federation', labelKey: 'profile.tabs.federation' },
    { id: 'nodes', labelKey: 'profile.tabs.nodes' },
    { id: 'security', labelKey: 'profile.tabs.security' },
  ] },
];

/**
 * The BASIC menu: what a person needs before they have built anything on the node. 38 items in
 * one flat list was a measured wall for a non-technical newcomer (UX-remake v3, K5), and the
 * chat-first model says the profile's deeper surfaces are for technical users. Everything else
 * is one "Show all tools" toggle away, and the toggle state is remembered — nothing is removed.
 * Operator-only groups are never in the basic set (they are role-gated anyway).
 */
export const BASIC_TAB_IDS = new Set([
  'companies',                                  // your company: address, legal identity, sender
  'organisms', 'memory', 'notebook',            // where the work and knowledge live
  'agents', 'mcp',                              // the chat/agent connection
  'notifications', 'contacts',                  // what happened, who with
  'apps', 'portfolio',                          // what you made
  'wallet', 'access',                           // account
]);

// Flat item lookup (pinned section renders items by id).
export const SIDEBAR_ITEM_BY_ID = Object.fromEntries(SIDEBAR_GROUPS.flatMap(g => g.items.map(it => [it.id, it])));
export const INFRA_TAB_IDS = new Set(['federation', 'nodes', 'nodeStats', 'security']);
// Defaults stay inside BASIC_TAB_IDS: a default pin to a tool the basic menu hides (scheduler,
// until 2026-08-07) contradicted the two-level menu the moment it shipped.
export const DEFAULT_PINS = ['organisms', 'agents', 'memory', 'mcp'];
