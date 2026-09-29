/**
 * @file public/views/profile/landing-page.cards.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile home dashboard cards, home sub-components, and the sidebar group model. Extracted from landing-page.js to satisfy max-file-lines.
 * @version-history
 *   v1.20.2 -- 2026-09-29 -- The build-an-app step opens /v1/appcat?create=1 instead of /app-catalog.html (Jouni).
 *   v1.20.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes itself, so an organism, workspace, agent, recent item or display name with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.20.0 -- 2026-09-26 -- Every part is a kit component (the panels are Card panel with its headline door and note, the rows FoldRow and List, the quota bars Meter, the figures FigureStrip and Card figure doors, the band NumberBand, the tags Mark with its live square, the promo a Box with framed Cards, the waiting box the aside Note with a Group): this file writes no class (page group G8).
 *   v1.19.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.18.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.17.0 -- 2026-09-26 -- A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.16.0 -- 2026-09-26 -- The overview's head is the home's head, the Masthead: the picture and the name at the home's sizes, the picture beside the middle of the name block; this AIMEAT's address, the marks, availability, AI chat instructions and Profile stay (a unification: Jouni's decision "Person head").
 *   v1.15.0 -- 2026-09-26 -- The overview's rows that open a recent thing, an agent or the next job are the folded row's event tone (og-fold og-fold--event): the name in bold, the time or the next run at the right; .pf-home-row and its label go (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-26 -- The last labels over a field, a meter or a chart are the row label (.poster-label): the Decide editors' field labels, the overview's quota names, the AI budget chart's title; their own looks go (a unification: Jouni's decision Row label).
 *   v1.13.0 -- 2026-09-25 -- The overview's rows under the AI spend (where it went, by model) are the Listing; their row, name, cost, share and meta rules go, the colour mark keeps its size (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- The P&L result and the overview's commerce, AI spend and agent ledger figures are the figure strip (.og-strip); a profit keeps its green as the fine tone and a loss its red as the danger tone (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- The "Waiting for you" rows are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A note that asks you to look or act is the Attention note (.poster-aside, its small cut; solid for an act that cannot be undone, the waiting tone while an agent onboards) (Jouni's decision "Attention note", a unification).
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.7.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.6.0 -- 2026-09-25 -- A button that is a mark, not a word (a delete or close mark, a menu's
 *     dots, an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's
 *     decision "Icon button").
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 — Compose overview B1 headings and row rules from shared poster classes.
 *   2026-09-13 -- V2w: compose remaining profile section top rules from poster.css.
 *   v1.4.0 -- 2026-09-25 -- The Settings & Controls frame and its side menu are library components (SettingsFrame, SideMenu; settings-frame.css, side-menu.css); the old .pf-shell, .pf-side- and .pf-content names are gone (UI consolidation phase 5, a move).
 *   v1.3.0 -- 2026-09-13 -- V2: compose the avatar with the shared poster frame.
 *   2026-09-03 — The AI page's menu item is route id 'ai' (was 'generator'), and the usage card's
 *     own-key door goes there.
 *   2026-09-03 — "Your agents" heads the Automation group, above the Agents tab it feeds into.
 *   2026-08-28 — The poster overview: a stat is icon, numeral and label in three spans, so the
 *     stylesheet can set the numeral big on the band and drop the emoji.
 *   2026-08-24 — Live update listens on 'scheduler'; 'schedules' is emitted by nobody, so the next-job
 *     card never followed a schedule change.
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
import { Masthead } from '/components/Masthead.js';
import { IndexList, IndexItem } from '/components/NumberedIndex.js';
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import htm from "htm";
const html = htm.bind(h);
import { t } from "/js/i18n.js";
import { fmtMoney } from "/js/utils.js";
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
import { SideMenuItem } from '/components/SideMenu.js';
import { Card, CardGrid } from '/components/Card.js';
import { Box } from '/components/Box.js';
import { NumberBand } from '/components/NumberBand.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Meter, Tinted } from '/components/Figure.js';
import { List, Row, Name, Desc, Num, Cell, Doors, Group } from '/components/List.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Icon } from '/components/Action.js';
import { Row as Line, Split, Space } from '/components/Layout.js';
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
  const words = (it) => {
    if (it.kind === 'review') return html`<b>${(t('profile.landing.draftsToReview') || '{n} drafts to review').replace('{n}', String(it.n))}</b> · ${it.orgName} / ${it.wsName}`;
    if (it.kind === 'join') return html`<b>${it.n === 1 ? (t('profile.landing.joinReqOne') || '1 join request') : (t('profile.landing.joinReqMany') || '{n} join requests').replace('{n}', String(it.n))}</b> · ${it.orgName}`;
    if (it.kind === 'invite') return html`<b>${t('profile.landing.inviteWaiting') || 'You’re invited'}</b> · ${it.orgName}`;
    return null;
  };
  const door = (it) => {
    if (it.kind === 'review') return html`<${Action} small row onClick=${() => (it.wsId ? gotoWorkspace(it.orgId, it.wsId, 'review') : gotoOrganism(it.orgId))}>${t('profile.landing.reviewBtn') || 'Review'}<//>`;
    if (it.kind === 'join') return html`<${Action} small row onClick=${() => gotoOrganism(it.orgId, 'members')}>${t('profile.landing.viewBtn') || 'View'}<//>`;
    if (it.kind === 'invite') return html`<${Action} small row onClick=${() => gotoOrganismsList()}>${t('profile.landing.viewBtn') || 'View'}<//>`;
    return null;
  };
  return html`
    <${Note} kind="aside" size="small">
      <${Group} title=${`📨 ${t('profile.landing.waitingTitle') || 'Waiting for you'}`}>
        <${List} cols="name-state" keepCols>
          ${items.map((it, i) => html`
            <${Row} key=${i}>
              <${Desc}>${words(it)}<//>
              <${Doors}>${door(it)}<//>
            <//>`)}
        <//>
      <//>
    <//>
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
    <${Card} tone="panel" title=${t('profile.landing.continueTitle') || 'Continue'}>
      <${Folds}>
        ${items.map((it) => html`
          <${FoldRow} key=${it.type + it.id} num=${RECENT_ICONS[it.type] || '•'} name=${it.label}
            right=${relTime(it.at)} onClick=${() => openItem(it)} />`)}
      <//>
    <//>
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
  // 'scheduler' is the domain the emitters send; 'schedules' is emitted by nobody.
  useEffect(() => onLiveUpdate(['agents', 'agent-tasks', 'scheduler'], () => liveRef.current()), []);

  if (!agents || (agents.length === 0 && !nextJob)) return null;
  const todayStr = new Date().toDateString();
  const isToday = (s) => s && new Date(s).toDateString() === todayStr;
  const activeToday = agents.filter(a => isToday(a.last_seen)).length;
  const openAgent = (a) => {
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser refusing sessionStorage here IS the answer: the tab still opens, it just does not preselect this agent
    try { sessionStorage.setItem('aimeat.agents.open', a.name); } catch { /* noop */ }
    openProfileTab('agents');
  };
  // An agent active today says so in the fine colour (main's .pf-ok).
  const seen = (a) => (a.last_seen
    ? (isToday(a.last_seen) ? html`<${Tinted} tone="fine">${t('profile.landing.agentActiveToday') || 'active today'}<//>` : relTime(a.last_seen))
    : '—');
  return html`
    <${Card} tone="panel" title=${t('profile.landing.agentsTitle') || 'Agents'} onOpen=${() => openProfileTab('agents')}
      note=${activeToday > 0 ? (t('profile.landing.activeTodayCount') || '{n} active today').replace('{n}', String(activeToday)) : null}>
      <${Folds}>
        ${agents.slice(0, 3).map(a => html`
          <${FoldRow} key=${a.gaii || a.name} num=${'🤖'} name=${a.display_name || a.name} right=${seen(a)} onClick=${() => openAgent(a)} />`)}
        ${nextJob ? html`
          <${FoldRow} key="nextjob" num="⏰" name=${nextJob.name || nextJob.id || ''}
            right=${(t('profile.landing.nextRunAt') || 'next run {time}').replace('{time}', fmtClock(nextJob.nextRunAt))}
            onClick=${() => openProfileTab('scheduler')} />` : null}
      <//>
    <//>
  `;
}

/* "Usage" — quota usage bars (memory / storage) + resource counts. Backed by the
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

  /** One line of the card: the name and what is used, then (for a quota) the bar, then what follows. */
  const line = (key, label, usedText, q, after) => html`
    <${Row} key=${key}>
      <${Cell}>
        <${Line} justify="between" wrap below="small">
          <${Label}>${label}<//>
          <${Note} kind="meta" mono inline>${usedText}<//>
        <//>
        ${q ? html`<${Meter} quota pct=${q.percent >= 0 ? q.percent : 0} />` : null}
        ${after}
      <//>
    <//>`;

  /**
   * The AI limit, which is a limit like the others and was the only one a person could not see.
   *
   * Two different facts, so two different shapes. Own key: there is no house limit, and a bar
   * would imply one. Node key: a bar, because it fills once and never refills — the grant is
   * granted a single time per person and nothing renews it.
   */
  const aiLine = (ai) => {
    if (!ai) return null;
    if (ai.own_key) return line('ai', t('profile.landing.usageAi'), t('profile.landing.usageAiOwnKey'));
    if (!(ai.granted_usd > 0)) return line('ai', t('profile.landing.usageAi'), t('profile.landing.usageAiNoGrant'));
    const spent = (ai.remaining_usd ?? 0) <= 0;
    // A bar at zero states a fact and leaves the person there. The grant is once per person and
    // nothing renews it, so "used up" is permanent unless they do one of two things — and both
    // of them are cheaper than they assume, which is exactly what an empty bar does not say.
    const exhausted = spent ? html`
      <${Line} wrap gap="tight" above="tight">
        <${Note} kind="meta" inline>${t('profile.landing.usageAiSpent')}<//>
        <${Action} small onClick=${() => switchTab('ai')}>${t('profile.landing.usageAiOwnKeyCta')}<//>
        <${Action} small onClick=${() => switchTab('agents')}>${t('profile.landing.usageAiConnectCta')}<//>
      <//>` : null;
    return line('ai', t('profile.landing.usageAi'),
      `$${(ai.remaining_usd ?? 0).toFixed(2)} ${t('profile.landing.usageAiLeftOf')} $${(ai.granted_usd ?? 0).toFixed(2)}`, ai, exhausted);
  };

  const figure = (label, value, tab) => html`<${Card} tone="figure" key=${label} figure=${value} name=${label} onOpen=${tab ? () => switchTab(tab) : undefined} />`;

  const c = u.counts;
  return html`
    <${Card} tone="panel" rule wide title=${t('profile.landing.usageTitle') || 'Usage & quotas'}>
      <${List} cols="name">
        ${line('memory', t('profile.landing.usageMemory') || 'Memory',
          `${u.memory.used_keys}/${u.memory.max_keys} ${t('profile.memory.keysWord') || 'keys'} · ${fmtBytes(u.memory.used_bytes)} / ${fmtBytes(u.memory.max_bytes)}`, u.memory)}
        ${line('storage', t('profile.landing.usageStorage') || 'Files',
          `${u.storage.used_files} ${t('profile.landing.usageFilesWord') || 'files'} · ${fmtBytes(u.storage.used_bytes)} / ${fmtBytes(u.storage.max_bytes)}`, u.storage)}
        ${aiLine(u.ai)}
      <//>
      <${Space} above="large">
        <${CardGrid} cols="figures">
          ${figure(t('profile.landing.usageAgents') || 'Agents', c.agents, 'agents')}
          ${figure(t('profile.landing.usageOrganisms') || 'Organisms', c.organisms, 'organisms')}
          ${figure(t('profile.landing.usageApps') || 'Apps', `${c.apps.used}/${c.apps.max}`, 'apps')}
          ${figure(t('profile.landing.usageEcoApps') || 'Connected apps', c.ecosystem_apps, 'ecosystem')}
          ${figure(t('profile.landing.usageExtensions') || 'Extensions', `${c.extensions.used}/${c.extensions.max}`, 'extensions')}
          ${figure(t('profile.landing.usageCortexes') || 'Cortexes', c.cortexes, 'extensions')}
          ${figure(t('profile.landing.usageServices') || 'Services', `${c.services.used}/${c.services.max}`, 'offers')}
        <//>
      <//>
    <//>
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
  const morsels = t('profile.landing.commerceMorsels') || 'morsels';
  // "10 morsels · 15.00 EUR" — money amounts are micro-units, never summed with morsels.
  const fmtTotals = (by) => Object.entries(by)
    .map(([cur, n]) => cur === 'morsel' ? `${n} ${morsels}` : fmtMoney(n, cur))
    .join(' · ') || `0 ${morsels}`;
  return html`
    <${Card} tone="panel" title=${t('profile.landing.commerceTitle') || 'Commerce'}>
      <${FigureStrip} items=${[
        { key: 'bought', n: String(stats.bought), label: t('profile.landing.commerceBought') || 'Purchases', sub: fmtTotals(stats.spentBy) },
        { key: 'sold', n: String(stats.sold), label: t('profile.landing.commerceSold') || 'Sales', sub: fmtTotals(stats.earnedBy) },
        { key: 'open', n: String(stats.open), label: t('profile.landing.commerceOpen') || 'Open carts', sub: t('profile.landing.commerceOpenSub') || 'checkout sessions' },
      ]} />
    <//>`;
}

/** An app's colour in the stacked chart, as a small square before its name. */
const appDot = (color) => html`<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect width="14" height="14" fill=${color} /></svg>`;

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

  const win = (key, label, w) => ({ key, n: fmtUsd(w && w.cost_usd), label, sub: `${fmtCompact(w && w.tokens)} ${t('profile.landing.aiTokensWord') || 'tokens'}` });

  return html`
    <${Card} tone="panel" wide title=${t('profile.landing.aiSpendTitle') || 'AI apps spend'}>
      <${FigureStrip} items=${[
        win('d1', t('profile.landing.aiWin24h') || 'Today', windows && windows.d1),
        win('d7', t('profile.landing.aiWin7d') || '7 days', windows && windows.d7),
        win('d30', t('profile.landing.aiWin30d') || '30 days', windows && windows.d30),
      ]} />
      ${datasets.length > 0 && html`
        <${Split} heavy above="small" below="large">
          <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${180}
            legend=${false} yFormat=${fmtUsd} />
        <//>`}
      ${topApps.length > 0 && html`
        <${Group} title=${t('profile.landing.aiWhereMoney') || 'Where it went (30d)'}>
          <${List} cols="name-n-n" keepCols>
          ${topApps.map(([app, m]) => {
            const pct = totalCost > 0 ? Math.round((m.cost_usd / totalCost) * 100) : 0;
            return html`
              <${Row} key=${app}>
                <${Name} before=${appDot(colorForIndex(apps.indexOf(app)))}>${app}<//>
                <${Num}>${fmtUsd(m.cost_usd)}<//>
                <${Num} quiet>${pct}%<//>
              <//>`;
          })}
          <//>
        <//>`}
    <//>`;
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

  return html`
    <${Card} tone="panel" wide title=${t('profile.landing.agentLedgerTitle') || 'Agent LLM usage'}>
      <${FigureStrip} items=${[
        { key: 'cost', n: fmtUsd(totals.cost_usd), label: t('profile.landing.agentLedgerCost') || 'Cost' },
        { key: 'tokens', n: fmtCompact(totals.total_tokens), label: t('profile.landing.agentLedgerTokens') || 'Tokens' },
        { key: 'calls', n: fmtCompact(totals.calls), label: t('profile.landing.agentLedgerCalls') || 'LLM calls' },
      ]} />
      ${topModels.length > 0 && html`
        <${Group} title=${t('profile.landing.agentLedgerByModel') || 'By model'}>
          <${List} cols="name-desc-doors" keepCols>
          ${topModels.map((g) => html`
            <${Row} key=${g.key}>
              <${Name}>${g.key}<//>
              <${Desc}>${(g.providers && g.providers.length) ? g.providers.join(', ') + ' · ' : ''}${fmtCompact(g.total_tokens)} ${t('profile.landing.aiTokensWord') || 'tokens'} · ${fmtCompact(g.calls)}<//>
              <${Num}>${fmtUsd(g.cost_usd)}<//>
            <//>`)}
          <//>
        <//>`}
    <//>`;
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
  return html`<${Mark} tone="sun" live>${t('profile.mcpConnected') || 'MCP connected'}<//>`;
}

export function ProfileCard({ tier, stats, session, onEditProfile, switchTab }) {
  const NODE_URL = getNodeUrl();
  const [instrOpen, setInstrOpen] = useState(false);
  const isNew = tier === 'new';
  const isExperienced = tier === 'experienced';
  const avatarSvg = minidenticon(typeof session.owner === 'string' && session.owner ? session.owner : 'user');

  // Stats are NAVIGATION, not decoration — each one opens its own section.
  const stat = (icon, val, labelKey, tabId, fine) => ({ key: labelKey, icon, n: val, label: t(labelKey), onOpen: () => switchTab?.(tabId), fine });
  const hasMorsels = stats.balance != null && stats.balance !== '-' && stats.balance > 0;
  const band = isNew ? [
    stats.memory > 0 && stat('\u{1F9E0}', stats.memory, 'profile.stats.memories', 'memory'),
    hasMorsels && stat('\u{1F48E}', stats.balance, 'profile.stats.morsels', 'wallet', true),
  ] : [
    stats.apps > 0 && stat('\u{1F4F1}', stats.apps, 'profile.stats.apps', 'apps'),
    stats.memory > 0 && stat('\u{1F9E0}', stats.memory, 'profile.stats.memories', 'memory'),
    hasMorsels && stat('\u{1F48E}', stats.balance, 'profile.stats.morsels', 'wallet', true),
    stats.services > 0 && stat('\u{1F50C}', stats.services, 'profile.stats.services', 'actions'),
    isExperienced && stats.agents > 0 && stat('\u{1F916}', stats.agents, 'profile.stats.agents', 'agents'),
  ];
  const federated = typeof stats.nodes === 'number' && stats.nodes > 0;

  return html`
    <${Masthead} avatarSvg=${avatarSvg} name=${session.displayName || session.owner}
      identity=${session.ghii || ''}
      identityTitle=${t('home.identityHint')}
      onAvatar=${() => onEditProfile?.()} avatarTitle=${t('profile.landing.editProfile')}
      plate=${html`
        <${Note} kind="meta" mono>${t('profile.node')}: ${NODE_URL}<//>
        <${Space} above="small"><${Marks}>
          <${McpConnectedBadge} />
          ${federated
            ? html`<${Mark} live>${t('profile.federation.statusConnected').replace('{count}', String(stats.nodes))}<//>`
            : html`<${Mark}>${t('profile.federation.statusStandalone')}<//>`}
        <//><//>`}>
      <${PresencePill} />
      <${Action} onClick=${() => setInstrOpen(true)}
        title=${t('setup.instrBtnHint') || 'The block to paste into your AI chat’s instructions, and where it goes in your tool'}>
        ${t('setup.instrBtn') || 'AI chat instructions'}<//>
      <${Action} onClick=${() => onEditProfile?.()}>${t('profile.landing.profileBtn') || 'Profile'}<//>
    <//>
    <${NumberBand} items=${band} />
    <${InstructionsDialog} open=${instrOpen} onClose=${() => setInstrOpen(false)} />
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

  const buildAppUrl = '/v1/appcat?create=1';
  const steps = [];
  // First and most important until it passes, then gone: a proven connection is the thing the
  // rest of the product is used through.
  if (mcpProven === false) steps.push({ icon: '\u{1F50C}', key: 'helloMcp', go: () => switchTab('mcp') });
  steps.push({ icon: '\u{1F9E0}', key: 'writeNotes', go: () => switchTab('notebook') });
  if (hasPortfolio === false) steps.push({ icon: '\u{1F3A8}', key: 'portfolio', go: () => switchTab('portfolio') });
  if (hasApps === false) steps.push({ icon: '\u{26A1}', key: 'buildApp', go: () => window.open(buildAppUrl, '_blank', 'noopener') });
  steps.push({ icon: '\u{1F91D}', key: 'useSharedAgents', go: () => switchTab('offers') });

  return html`
    <${Space} above="section">
      <${Card} tone="panel" title=${t('profile.landing.nextTitle')}>
        <${IndexList}>
          ${steps.map((s, i) => html`
            <${IndexItem} key=${s.key} first=${i === 0} onClick=${s.go}
              line=${t('profile.landing.next.' + s.key + 'Desc')}>${t('profile.landing.next.' + s.key + 'Title')}<//>
          `)}
        <//>
        <${OpenItemsList} />
      <//>
    <//>
  `;
}

/* Onboarding promo — shown only while the user has fewer than 3 apps, and dismissable for good.
 * After that the same content lives on the Extensions page; for a seasoned user it was dead space. */
export function CortexSection({ switchTab, onDismiss }) {
  const dismiss = html`<${Icon} small label=${t('profile.landing.promoDismiss') || 'Hide'}
    onClick=${(e) => { e.stopPropagation(); onDismiss?.(); }}>✕<//>`;
  return html`
    <${Box} marks=${html`<${Label}>${t('profile.landing.cortexSectionTitle')}<//>`} end=${dismiss}>
      <${CardGrid} cols="two">
        <${Card} tone="framed" mark=${'\u{1F4CA}'} name=${t('profile.landing.cortexCharts')} text=${t('profile.landing.cortexChartsDesc')} onOpen=${() => switchTab('extensions')} />
        <${Card} tone="framed" mark=${'\u{1F3A8}'} name=${t('profile.landing.cortexCanvas')} text=${t('profile.landing.cortexCanvasDesc')} onOpen=${() => switchTab('extensions')} />
      <//>
    <//>
  `;
}

/* (AppStrip removed — the cross-type "Continue" card replaced it: raw filenames in a horizontal
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
  return html`<${SideMenuItem} active=${active} onClick=${onClick} count=${unread}>${t('profile.tabs.inbox')}<//>`;
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
    { id: 'fleet', labelKey: 'profile.tabs.fleet' },
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
    /* The AI page: which model answers, on whose key, within what daily budget. Route id 'ai'
     * since 2026-09-03; 'generator' (the tab it grew out of) still resolves through profile.js. */
    { id: 'ai', labelKey: 'profile.generator.openrouter.title' },
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
