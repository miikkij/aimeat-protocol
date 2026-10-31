/**
 * @file public/views/home/overview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Overview page: the whole account in one picture. Computers on the left, then the
 *   agents on each, the apps, the knowledge (organisms and their workspaces) and what the person
 *   offers, with how much each was used in the chosen period and a curve for each tie. Pressing a
 *   card shows what it touches and opens it in place when it holds more; its head closes it again.
 *   Every card leads to its own page. It is the accepted canvas "Kokonaiskuva" (board 1, and board 4
 *   for a phone, where the same lanes are nested lists).
 *
 *   ONE READ, LIVE. GET /v1/overview answers everything (services/overview/overview-read.ts, the read
 *   aimeat_overview gives an AI). The page opens the live stream and reads again on a change of
 *   agents, tasks, apps, organisms or workspaces; nothing asks on a timer.
 *
 *   ?focus=<item id> opens the page on one thing, selected and open: the address the other pages'
 *   "Show in the overview" links and the AI's answers give.
 * @structure default OverviewView({ navigate }) · DetailStrip · PhoneList
 * @usage routed at /v1/home?overview=1[&focus=<item id>] by spa.html
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import { h } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { tOr } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { getSession } from '/js/services/auth.js';
import { relayLiveUpdates } from '/lib/live-updates.js';
import { ago } from '/js/format.js';
import { PageFrame } from '/components/PageFrame.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Loud, Action } from '/components/Action.js';
import { FormActions } from '/components/Field.js';
import { HelpTip } from '/components/HelpTip.js';
import { OverviewMap } from '/components/OverviewMap.js';
import { buildLanes, layoutMap, LANE_KEYS, groupIdOf } from './overview-model.js';

const html = htm.bind(h);
const o = (key, fallback, vars) => tOr('home.overview.' + key, fallback, vars);

const HOME = '/v1/home';
const RANGES = ['24h', '7d', '30d'];
const STEP = 10;
/** The live domains whose change can move a number on this page. */
const LIVE = new Set(['agents', 'agent-tasks', 'apps', 'organisms', 'work', 'packages']);
/** The help topic of each lane: `explain.overview.<topic>.*`. */
const TOPIC = { machines: 'computers', agents: 'agents', apps: 'apps', knowledge: 'knowledge', offerings: 'offerings' };

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)} t.` : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} t.` : String(n));

function unitWord(unit) {
  return unit === 'opens' ? o('unit.opens', 'opens') : unit === 'writes' ? o('unit.writes', 'writes') : o('unit.calls', 'calls');
}

/** The name a computers-lane item is shown by. */
function machineLabel(m) {
  if (m.kind === 'unplaced') return o('unplaced', 'No computer');
  if (m.kind === 'chat' && !m.name) return o('kind.chat', 'AI chat app');
  return m.name;
}

/** The group card in the agents lane for one computer or chat client. */
function groupLabel(m) {
  if (m.kind === 'unplaced') return o('unplacedAgents', 'Agents with no computer');
  return o('agentsOn', 'Agents on {name}', { name: machineLabel(m) });
}

/** The line under an item's name. */
function itemSub(i) {
  if (i.quiet_days != null) return o('quietDays', 'Quiet for {n} days', { n: i.quiet_days });
  switch (i.kind) {
    case 'machine': return `${i.online ? o('online', 'Connected now') : o('seen', 'Last seen {when}', { when: ago(i.last_at) })} · ${o('agentsN', '{n} agents', { n: i.agents ?? 0 })}`;
    case 'chat': return `${o('chatSub', 'An AI app over MCP')} · ${o('agentsN', '{n} agents', { n: i.agents ?? 0 })}`;
    case 'unplaced': return o('agentsN', '{n} agents', { n: i.agents ?? 0 });
    case 'app': return i.last_at ? o('opened', 'Last opened {when}', { when: ago(i.last_at) }) : o('notOpened', 'Not opened in 30 days');
    case 'organism': return i.workspaces != null ? o('workspacesN', '{n} workspaces', { n: i.workspaces }) : o('organism', 'Organism');
    case 'workspace': return o('workspace', 'Workspace');
    case 'app-tools': return `${o('toolsSub', '{n} tools, {f} free', { n: i.tools, f: i.free_tools })}${i.exchange ? ` · ${o('onExchange', 'on EXCHANGE')}` : ''}`;
    case 'agent-offer': return i.capability ? o('offerPublic', 'Public, a capability on the node') : o('offerPrivate', 'Private, not yet a capability');
    case 'agent': return i.tasks_done ? o('tasksDone', '{n} tasks done', { n: i.tasks_done }) : o('agent', 'Agent');
    default: return '';
  }
}

/** What kind of thing a card is, as the detail strip's small label says it. */
function kindLabel(entry) {
  if (entry.kind === 'group') return o('kind.group', 'Agents on a computer');
  if (entry.kind === 'more' || entry.kind === 'next') return o('kind.more', 'More');
  return o(`kind.${entry.item.kind}`, entry.item.kind);
}

/** The words an entry's card shows. */
function makeCardText(rangeLabel, laneMax) {
  return (n) => {
    const e = n.entry;
    const open = n.role === 'head';
    if (e.kind === 'group') {
      return {
        name: groupLabel(e.machine), sub: o('agentsN', '{n} agents', { n: e.count }),
        num: fmt(e.use), numTitle: `${e.use} ${unitWord('calls')} / ${rangeLabel}`,
        bar: Math.round((e.use / (laneMax.agents || 1)) * 100), live: !!e.machine.online, quiet: e.quiet,
        sign: open ? '−' : '+', label: groupLabel(e.machine),
      };
    }
    if (e.kind === 'more') {
      const used = (e.hidden || []).filter((i) => i.use > 0).length + (e.children || []).filter((c) => c.item?.use > 0).length;
      const name = o('moreN', '+{n} more', { n: e.count });
      return {
        name, sub: o('moreUsed', '{n} used in this period', { n: used }), num: fmt(e.use || 0),
        numTitle: `${e.use || 0} / ${rangeLabel}`, bar: Math.round(((e.use || 0) / (laneMax[n.lane] || 1)) * 100),
        live: false, quiet: false, sign: n.role === 'row' ? '+' : (open ? '−' : '+'), label: name,
      };
    }
    if (e.kind === 'next') {
      const name = o('next', 'Show {n} more', { n: Math.min(STEP, e.count) });
      return { name, sub: '', num: String(e.count), numTitle: '', bar: 0, live: false, quiet: false, sign: '+', label: name };
    }
    const i = e.item;
    const name = i.lane === 'machines' ? machineLabel(i) : i.name;
    return {
      name, sub: open ? itemSub(i) : itemSub(i), num: fmt(i.use), numTitle: `${i.use} ${unitWord(i.unit)} / ${rangeLabel}`,
      bar: Math.round((i.use / (laneMax[i.lane] || 1)) * 100), live: !!i.online, quiet: i.quiet_days != null,
      sign: e.children?.length ? (open ? '−' : '+') : null, label: name,
    };
  };
}

/** The state that opens the page on one item: its group or organism open, and enough shown. */
function openFor(view, id) {
  const open = new Set();
  const shown = {};
  const item = view.items.find((i) => i.id === id);
  if (!item) return { open, shown };
  if (item.lane === 'agents' && item.parent) {
    const gid = groupIdOf(item.parent);
    open.add(gid);
    const members = view.items.filter((a) => a.lane === 'agents' && a.parent === item.parent).sort((a, b) => b.use - a.use || a.name.localeCompare(b.name));
    const at = members.findIndex((a) => a.id === id);
    if (at >= 6) { open.add(`more:${gid}`); shown[`more:${gid}`] = Math.ceil((at - 5) / STEP) * STEP; }
  }
  if (item.kind === 'workspace' && item.parent) open.add(item.parent);
  return { open, shown };
}

export default function OverviewView({ navigate }) {
  const session = useSession();
  const params = new URLSearchParams(location.search);
  const [range, setRange] = useState(RANGES.includes(params.get('range')) ? params.get('range') : '7d');
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [shown, setShown] = useState({});
  const [sel, setSel] = useState(null);
  const [showQuiet, setShowQuiet] = useState(true);
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [mapWidth, setMapWidth] = useState(0);
  const focused = useRef(false);
  // The map takes the width its column has; a ResizeObserver hands it a new one as the window changes.
  const observer = useRef(null);
  const measure = useCallback((el) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => setMapWidth(Math.floor(entry.contentRect.width)));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);

  const load = useCallback(async () => {
    try {
      const resp = await apiGet(`/v1/overview?range=${encodeURIComponent(range)}`);
      setView(resp?.data ?? null);
      setLoadError('');
    } catch (err) { setLoadError(err?.message || String(err)); }
  }, [range]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { if (session) loadRef.current(); }, [session, range]);
  useEffect(() => (session ? relayLiveUpdates(() => getSession()?.jwt) : undefined), [session]);
  useEffect(() => {
    const handler = (ev) => {
      const domains = ev?.detail?.domains;
      if (!session) return;
      if (Array.isArray(domains) && domains.length && !domains.some((d) => LIVE.has(d) || String(d).startsWith('workspace:'))) return;
      loadRef.current();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [session]);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // ?focus= once, when the first answer arrives.
  useEffect(() => {
    if (!view || focused.current) return;
    focused.current = true;
    const focus = new URLSearchParams(location.search).get('focus');
    if (!focus) return;
    const f = openFor(view, focus);
    setOpen(f.open); setShown(f.shown); setSel(focus);
  }, [view]);

  const state = useMemo(() => ({ open, shown, showQuiet }), [open, shown, showQuiet]);
  const lanes = useMemo(() => (view ? buildLanes(view, state) : null), [view, state]);
  const map = useMemo(() => (lanes ? layoutMap(lanes, view, state, mapWidth) : null), [lanes, view, state, mapWidth]);

  const goHome = useCallback((e) => { e?.preventDefault?.(); navigate(HOME); }, [navigate]);
  const back = html`<${BackLink} href=${HOME} onClick=${goHome}>↩ ${tOr('home.history.back', 'Back to your home')}<//>`;

  if (!session) {
    return html`
      <${PageFrame} width="narrow">
        <header class="poster-intro"><h1 class="poster-intro-title">${o('title', 'Overview')}</h1>
          <p class="poster-intro-sub">${tOr('home.signInDesc', 'Sign in to see where you left off.')}</p></header>
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tOr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }
  if (loadError && !view) return html`<${PageFrame}>${back}<${ErrorNote} text=${loadError} /><//>`;
  if (!view || !map) return html`<${PageFrame} loading=${true}><${Spinner} /><//>`;

  const rangeLabel = o(`range.${range}`, range);
  const laneMax = {};
  for (const n of map.nodes) {
    if (n.role !== 'card') continue;
    const u = n.entry.kind === 'item' ? n.entry.item.use : (n.entry.use || 0);
    laneMax[n.lane] = Math.max(laneMax[n.lane] || 0, u);
  }
  const cardText = makeCardText(rangeLabel, laneMax);

  // What the selection touches: the cards one line away from it or from what is inside it.
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const inside = (id) => sel && nodeById.get(id)?.parent === sel;
  const near = new Set();
  if (sel) {
    for (const e of map.edges) {
      if (e.from === sel || inside(e.from)) near.add(e.to);
      if (e.to === sel || inside(e.to)) near.add(e.from);
    }
  }
  const related = (id) => (!sel ? '' : id === sel ? 'sel' : (inside(id) || near.has(id)) ? 'rel' : 'dim');
  const hotEdge = (e) => e.from === sel || e.to === sel || inside(e.from) || inside(e.to);

  const pick = (n) => {
    const e = n.entry;
    const next = new Set(open);
    if (n.role === 'head') { next.delete(e.id); setOpen(next); setSel(e.id); return; }
    if (e.kind === 'next') { setShown({ ...shown, [e.of]: (shown[e.of] || STEP) + STEP }); return; }
    if (e.kind === 'more' && n.role === 'row') {
      if (!next.has(e.id)) { next.add(e.id); setOpen(next); setShown({ ...shown, [e.id]: STEP }); } else setShown({ ...shown, [e.id]: (shown[e.id] || STEP) + STEP });
      return;
    }
    const openable = e.kind === 'group' || e.kind === 'more' || (e.kind === 'item' && e.children?.length);
    if (openable) { next.add(e.id); setOpen(next); setSel(e.id); return; }
    setSel(sel === e.id ? null : e.id);
  };

  const quietCount = view.totals.quiet;
  const helpFor = (lane) => ({
    term: `overview.${TOPIC[lane]}`,
    label: o(`lane.${lane}`, lane),
    mine: mineFor(view, lane, rangeLabel),
  });
  const selected = sel ? nodeById.get(sel) : null;

  return html`
    <${PageFrame}>
      ${back}
      <div class="ovp-head">
        <div class="ovp-intro">
          <div class="ovp-title-row">
            <h1 class="poster-intro-title">${o('title', 'Overview')}</h1>
            <${HelpTip} term="overview.model" label=${o('title', 'Overview')} mine=${mineFor(view, null, rangeLabel)} />
          </div>
          <p class="poster-intro-sub">${o('sub', 'Everything your account does, in one picture.')}</p>
        </div>
        <div class="ovp-controls">
          <div class="ovp-ranges" role="group" aria-label=${o('rangeLabel', 'Use in')}>
            <span class="poster-label">${o('rangeLabel', 'Use in')}</span>
            ${RANGES.map((r) => html`
              <button type="button" key=${r} class=${`poster-chip ovp-range${r === range ? ' poster-chip--sun' : ''}`} aria-pressed=${r === range ? 'true' : 'false'}
                onClick=${() => setRange(r)}>${o(`range.${r}`, r)}</button>`)}
          </div>
          <div class="ovp-toggles">
            ${open.size ? html`<${Action} onClick=${() => setOpen(new Set())}>${o('collapseAll', 'Close all')}<//>` : null}
            <${Action} onClick=${() => { setShowQuiet(!showQuiet); setSel(null); }}>
              ${showQuiet ? o('hideQuiet', 'Hide quiet ({n})', { n: quietCount }) : o('showQuiet', 'Show quiet ({n})', { n: quietCount })}<//>
          </div>
        </div>
      </div>
      <p class="ovp-totals">
        <span><b>${view.totals.machines}</b> ${o('total.machines', 'computers')}</span>
        <span><b>${view.totals.agents}</b> ${o('total.agents', 'agents')}</span>
        <span><b>${view.totals.apps}</b> ${o('total.apps', 'apps')}</span>
        <span><b>${view.totals.organisms}</b> ${o('total.organisms', 'organisms')}</span>
        <span><b>${view.totals.offerings}</b> ${o('total.offerings', 'on offer')}</span>
      </p>
      <${DetailStrip} node=${selected} near=${near} cardText=${cardText} rangeLabel=${rangeLabel}
        open=${open} onToggle=${(id) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next); }}
        onClear=${() => setSel(null)} navigate=${navigate} />
      ${phone
        ? html`<${PhoneList} map=${map} cardText=${cardText} sel=${sel} near=${near} helpFor=${helpFor} onPick=${pick} open=${open} />`
        : html`<div class="ovp-scroll" ref=${measure}><${OverviewMap} map=${map} sel=${sel} related=${related} hotEdge=${hotEdge} onPick=${pick}
            laneTitle=${(lane) => ({ title: o(`lane.${lane}`, lane), sub: o(`laneSub.${lane}`, '') })}
            laneHelp=${helpFor} cardText=${cardText} /></div>`}
      <div class="ovp-legend">
        <span class="ovp-legend-item"><span class="ovp-legend-dot" aria-hidden="true"></span>${o('legend.live', 'connected now')}</span>
        <span class="ovp-legend-item"><span class="ovp-legend-dash" aria-hidden="true"></span>${o('legend.quiet', 'quiet: not used for 30 days, you can tidy it away')}
          <${HelpTip} term="overview.quiet" label=${o('legend.quietLabel', 'Quiet')} /></span>
        <span class="ovp-legend-item"><span class="ovp-legend-bar" aria-hidden="true"></span>${o('legend.use', 'use in the period, against the busiest in the same lane')}</span>
        <span class="ovp-legend-item">${o('legend.top', 'Each lane shows its five busiest. The rest are in the + card.')}</span>
        ${view.partial?.includes('agent-app-use') ? html`<span class="ovp-legend-item">${o('legend.agentApp', 'A line from an agent to an app is the tie the app states; how much the agent used the app is not counted yet.')}</span>` : null}
      </div>
    <//>`;
}

/** The person's own figures for a help dialog, in the page's words. */
function mineFor(view, lane, rangeLabel) {
  const t = view.totals;
  const items = view.items;
  const used = (l) => items.filter((i) => i.lane === l && i.use > 0 && i.kind !== 'workspace').length;
  switch (lane) {
    case null: return o('mine.model', 'You have now: {m} computers, {a} agents, {p} apps, {g} organisms, {f} on offer.', { m: t.machines, a: t.agents, p: t.apps, g: t.organisms, f: t.offerings });
    case 'machines': return o('mine.machines', 'You have now: {n} computers, {c} connected.', { n: t.machines, c: items.filter((i) => i.lane === 'machines' && i.online).length });
    case 'agents': return o('mine.agents', 'You have now: {n} agents, {u} of them working in the period ({r}).', { n: t.agents, u: used('agents'), r: rangeLabel });
    case 'apps': return o('mine.apps', 'You have now: {n} apps, {u} of them opened in the period ({r}).', { n: t.apps, u: used('apps'), r: rangeLabel });
    case 'knowledge': return o('mine.knowledge', 'You have now: {n} organisms, {u} of them written to in the period ({r}).', { n: t.organisms, u: used('knowledge'), r: rangeLabel });
    case 'offerings': return o('mine.offerings', 'You have now: {n} on offer, {u} of them used in the period ({r}).', { n: t.offerings, u: used('offerings'), r: rangeLabel });
    default: return '';
  }
}

/** The selected card: what it is, its use, what it touches, and where it opens. */
function DetailStrip({ node, near, cardText, rangeLabel, open, onToggle, onClear, navigate }) {
  if (!node) {
    return html`<div class="ovp-detail ovp-detail--empty">
      <p>${o('detail.empty', 'Press any card. You see what it is tied to, and you can open it.')}
        <span class="ovp-dim"> ${o('detail.thickness', 'The thicker the line, the more happened between the two in the period.')}</span></p>
    </div>`;
  }
  const e = node.entry;
  const c = cardText(node);
  const item = e.item;
  const lane = node.lane;
  const openable = e.kind === 'group' || e.kind === 'more' || (e.kind === 'item' && e.children?.length);
  const quiet = item?.quiet_days != null;
  const href = item ? item.href : e.kind === 'group' ? (e.machine.kind === 'machine' ? '/v1/home?computers=1' : '/v1/home?agents=1') : laneHref(lane);
  const internal = href.startsWith('/');
  const go = (ev) => { if (internal) { ev.preventDefault(); navigate(href); } };
  const use = item ? `${fmt(item.use)} ${unitWord(item.unit)} / ${rangeLabel}` : `${fmt(e.use || 0)} / ${rangeLabel}`;
  return html`
    <div class="ovp-detail">
      <div class="ovp-detail-what">
        <div class="ovp-detail-kind"><span class="poster-label">${kindLabel(e)}</span>
          <${HelpTip} term=${`overview.${TOPIC[lane]}`} label=${o(`lane.${lane}`, lane)} /></div>
        <div class="poster-record-title ovp-detail-name">${c.name}</div>
        <div class="ovp-dim">${c.sub}</div>
      </div>
      <div class="ovp-detail-facts">
        <div class="ovp-mono">${quiet && item.use === 0 ? o('detail.unused', 'Not used for {n} days', { n: item.quiet_days }) : use}</div>
        <div>${near.size ? o('detail.links', 'Tied to {n} things. They are marked on the map.', { n: near.size }) : o('detail.noLinks', 'No ties in this period.')}</div>
        ${quiet ? html`<div class="poster-aside poster-aside--small">${o('detail.quiet', 'Nothing has used this for {n} days. You can remove or archive it.', { n: item.quiet_days })}</div>` : null}
      </div>
      <div class="ovp-detail-acts">
        <${Loud} href=${href} onClick=${go} newTab=${!internal}>${o('detail.open', 'Open')} →<//>
        ${openable ? html`<${Action} onClick=${() => onToggle(e.id)}>${open.has(e.id) ? o('detail.close', 'Close') : o('detail.showParts', 'Show what is inside')}<//>` : null}
        <${Action} soft onClick=${onClear}>${o('detail.clear', 'Clear the selection')}<//>
      </div>
    </div>`;
}

/** Where a lane's own page is, for a "+N" card. */
function laneHref(lane) {
  return { machines: '/v1/home?computers=1', agents: '/v1/fleet', apps: '/v1/profile?tab=apps', knowledge: '/v1/profile?tab=organisms', offerings: '/v1/profile?tab=offers' }[lane] || '/v1/home';
}

/** A phone: the same lanes as nested lists; an open card lists what it is tied to under it. */
function PhoneList({ map, cardText, sel, near, helpFor, onPick, open }) {
  const byParent = new Map();
  for (const n of map.nodes) if (n.parent) byParent.set(n.parent, [...(byParent.get(n.parent) || []), n]);
  const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
  const tied = sel ? [...near].map((id) => nodeById.get(id)).filter(Boolean) : [];
  const row = (n, depth) => {
    const c = cardText(n);
    const isSel = sel === n.id;
    const kids = byParent.get(n.id) || [];
    return html`
      <li key=${n.id} class=${`ovp-li ovp-li--d${depth}${c.quiet ? ' is-quiet' : ''}${isSel ? ' is-sel' : ''}`}>
        <button type="button" class="ovp-li-btn" onClick=${() => onPick(n)} aria-pressed=${isSel ? 'true' : 'false'}
          aria-expanded=${c.sign ? (open.has(n.id) ? 'true' : 'false') : undefined}>
          ${c.live ? html`<span class="ovp-legend-dot" aria-hidden="true"></span>` : null}
          <span class="ovp-li-text"><b>${c.name}</b>${c.sub ? html`<span class="ovp-dim">${c.sub}</span>` : null}</span>
          <span class="ovp-mono">${c.num}</span>
          ${c.sign ? html`<span class=${`ovm-sign${n.role === 'head' ? ' is-open' : ''}`} aria-hidden="true">${n.role === 'head' ? '−' : c.sign}</span>` : null}
        </button>
        ${isSel && tied.length ? html`
          <div class="ovp-li-tied"><span class="poster-label">${o('detail.tied', 'Tied to')}</span>
            <ul>${tied.map((t) => html`<li key=${t.id}>${cardText(t).name}</li>`)}</ul></div>` : null}
        ${kids.length ? html`<ul class="ovp-ul">${kids.map((k) => row(k, depth + 1))}</ul>` : null}
      </li>`;
  };
  return html`
    <div class="ovp-phone">
      ${LANE_KEYS.map((lane) => {
        const help = helpFor(lane);
        const top = map.nodes.filter((n) => n.lane === lane && !n.parent);
        return html`
          <section key=${lane} class="ovp-lane">
            <div class="ovm-lane-row"><h2 class="poster-record-title ovm-lane-title">${o(`lane.${lane}`, lane)}</h2>
              <${HelpTip} term=${help.term} label=${help.label} mine=${help.mine} /></div>
            <ul class="ovp-ul">${top.map((n) => row(n, 0))}</ul>
          </section>`;
      })}
    </div>`;
}
