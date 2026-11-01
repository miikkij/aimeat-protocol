/**
 * @file public/views/home/away.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Sillä aikaa kun olit poissa": when a buyer comes back to the Home after a while away,
 *   a few lines on what happened meanwhile, newest first: what their agents did and anything new from
 *   the node or its operator (Jouni, 2.11 00.52, "three visits", visit 2).
 *
 *   TWO EXISTING SOURCES, NO NEW ONE. What happened on the account is the Home feed's record
 *   (GET /v1/home/feed, its sentences from feed.js line()), and what the node or the operator said is
 *   the unread notifications (GET /v1/notifications?unread=1, titleOf()). The card only picks the rows
 *   newer than the start of the absence.
 *
 *   THE LAST VISIT IS KEPT IN THIS BROWSER. A record on the node would be a memory write on every
 *   visit, and each one would show in the activity log as "saved a note". So the time the person was
 *   last here is a per-browser convenience (localStorage `aimeat.home.visit`): a new device starts
 *   without a card, and blocked storage only means no card.
 *
 *   ONLY ON A NODE THE STORE SOLD (site.js customerNode()), and only from the second visit.
 * @structure AwayCard() · internal: readVisit, noteVisit, AWAY_AFTER_MS, ROWS
 * @usage html`<${AwayCard} />`
 * @version-history
 *   v1.1.0 — 2026-11-02 — An agent is named by the name the person sees (GET /v1/agents), a title that
 *     repeats it is left out, and a new agent reads "Uusi agentti on käytössä: <nimi>" instead of the
 *     feed's "on kotona" (commercial's crew59 test).
 *   v1.0.0 — 2026-11-02 — Initial (three visits, visit 2; aimeat-commercial-1c).
 */
import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { ago } from '/js/format.js';
import { customerNode } from '/js/site.js';
import { useShared } from '/views/surface/shared-read.js';
import { Timeline, TimelineRow } from '/components/Timeline.js';
import { Note } from '/components/Note.js';
import { line, kindCategory } from './feed.js';
import { titleOf } from '/js/services/notifications.js';
import { getSession } from '/js/services/auth.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const VISIT_KEY = 'aimeat.home.visit';
/** A gap this long between two looks at the Home starts a new visit, and the card speaks of the gap. */
const AWAY_AFTER_MS = 60 * 60 * 1000;
/** How often the last-seen time is written while the person stays. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;
/** A glance, not an archive: the rest is in the feed's history and the notifications. */
const ROWS = 5;

/** { lastSeenAt, awaySince } from this browser, or {} when there is nothing or storage is blocked. */
function readVisit() {
  try {
    const v = JSON.parse(localStorage.getItem(VISIT_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (err) {
    console.warn('[away] the last visit could not be read:', err.message);
    return {};
  }
}

/**
 * Note this look at the Home and answer when the absence it ends began, or '' on a first visit.
 * A look after a gap of AWAY_AFTER_MS starts a visit: the gap's start is kept as `awaySince` for the
 * whole visit, so a reload does not empty the card.
 */
function noteVisit(now = Date.now()) {
  const v = readVisit();
  const last = Date.parse(v.lastSeenAt || '') || 0;
  const awaySince = last && now - last > AWAY_AFTER_MS ? new Date(last).toISOString() : (v.awaySince || '');
  if (!last || now - last > TOUCH_EVERY_MS || awaySince !== v.awaySince) {
    try {
      localStorage.setItem(VISIT_KEY, JSON.stringify({ lastSeenAt: new Date(now).toISOString(), awaySince }));
    } catch (err) {
      console.warn('[away] the last visit could not be kept:', err.message);
    }
  }
  return awaySince;
}

/** The events whose `data.agent` is an agent's short name (services/agent-task-fanout.ts and friends). */
const AGENT_KINDS = new Set(['agent_task_done', 'agent_task_failed', 'agent_task_declined']);

/**
 * One feed row in the card's words. An agent is named by the name the person sees, not its short
 * name; a title that only repeats that name is left out; a new agent is said plainly, not as the
 * feed's "is home" (commercial's crew59 test: "morning-digest sai valmiiksi: Aamukatsaus" and
 * "morning-digest on kotona").
 */
function awayLine(item, shownName) {
  const d = item.data || {};
  if (item.kind === 'agent_connected') {
    const name = shownName(d.name || d.agent || '');
    return name ? tr('home.away.agentNew', 'A new agent is at work: {name}').replace('{name}', name) : '';
  }
  if (!AGENT_KINDS.has(item.kind)) return line(item);
  const agent = shownName(d.agent || '');
  const title = String(d.title || '').trim().toLowerCase() === agent.toLowerCase() ? '' : d.title;
  return line({ ...item, data: { ...d, agent, title } });
}

/** A notification's own address when it is a page of this node, else the Notifications page. */
const notifHref = (n) => (typeof n?.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : '/v1/profile?tab=notifications');

export function AwayCard() {
  const customer = customerNode();
  const since = useMemo(() => (customer ? noteVisit() : ''), [customer]);
  const { data: feed } = useShared('home-feed', since ? '/v1/home/feed' : null, ['home'], (d) => d?.items ?? []);
  const { data: notes } = useShared('notifications-unread', since ? '/v1/notifications?unread=1&limit=50' : null,
    ['notifications'], (d) => d?.notifications ?? []);
  // The names the person sees for their agents, by short name (GET /v1/agents, as the Agents page).
  const owner = getSession()?.owner || '';
  const { data: names } = useShared('away-agent-names', since && owner ? `/v1/agents?owner=${encodeURIComponent(owner)}` : null,
    ['agents'], (d) => Object.fromEntries((d?.agents || d || []).map((a) => [a.name, a.display_name || a.displayName || a.name])));
  if (!since || !feed || !notes) return null;

  const shownName = (short) => (names && names[short]) || short;
  const after = Date.parse(since);
  const rows = [
    ...feed.filter((it) => Date.parse(it.at) > after && it.kind !== 'agent_knocking')
      .map((it) => ({ at: it.at, category: kindCategory(it.kind), href: it.link, text: awayLine(it, shownName) }))
      .filter((r) => r.text),
    ...notes.filter((n) => Date.parse(n.createdAt) > after && titleOf(n))
      .map((n) => ({ at: n.createdAt, category: 'system', href: notifHref(n), text: titleOf(n) })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const title = tr('home.away.title', 'While you were away');
  if (!rows.length) {
    return html`<${Note} kind="quiet">${tr('home.away.nothing', 'Nothing new happened while you were away.')}<//>`;
  }
  return html`
    <${Timeline} title=${title} band=${true}
      more=${rows.length > ROWS ? { href: '/v1/home?history=1', text: tr('home.away.more', 'See everything that has happened') } : null}>
      ${rows.slice(0, ROWS).map((r, i) => html`
        <${TimelineRow} key=${i} category=${r.category} href=${r.href} text=${r.text} when=${ago(r.at, { horizonDays: Infinity })} />`)}
    <//>`;
}

export default AwayCard;
