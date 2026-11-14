/**
 * @file src/services/overview/overview-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The overview of one owner's account: machines, agents, apps, knowledge and
 *   offerings, how much each was used in a period, and the lines between them. GET /v1/overview
 *   answers it, the overview page draws it and aimeat_overview reads the same answer, so the page
 *   and an AI cannot tell two stories.
 *
 *   WHERE EACH PART COMES FROM, all through the service functions the other pages call:
 *   - machines and which agents live on each: services/connector-registry.ts (the Computers page);
 *   - an agent that no machine runs but an AI chat client brings in: its `mcpClient`;
 *   - calls per agent: the usage cut `call.actor`; done tasks: storage.countTasksByOwner;
 *   - the apps that show an agent's work, and the workspace its work goes to: services/agent/ties.ts;
 *   - the owner's apps and their use: the app listing and the usage cut `call.app`;
 *   - where an app keeps its data: its data map (overview-sources.ts appPlaces);
 *   - the organisms and workspaces the owner belongs to: services/agent/ties.ts readTieChoices;
 *   - writes per workspace and by which agent: storage.listKeyActivity;
 *   - offerings: the app tool manifests, the agent offers and the EXCHANGE listings.
 *
 *   WORKSPACE NAMES NEED organism:read. The owner in person always sees them. An agent reading its
 *   owner's overview sees the organisms (aimeat_organism_list already names them to it) and their
 *   counts, and the workspaces inside only when it holds organism:read, the word every workspace
 *   tool asks.
 *
 *   NOT YET COUNTED: how much an agent used each app. The usage roll-up has no cut keyed by agent
 *   and app together, and such a cut would also hold people's app visits, which the visit retention
 *   rule (services/usage/visit-retention.ts) has to decide first. The line from an agent to an app is
 *   the tie the app's data map states, with weight 0, and `partial` says so.
 * @structure readOverview · trimOverview · OverviewCaller
 * @usage const view = await readOverview({ config, storage }, caller, '7d');
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AgentRecord } from '../../storage/types/identity.js';
import { listConnectors, wantedInstalls } from '../connector-registry.js';
import { readAgentTies, readTieChoices } from '../agent/ties.js';
import { resolveAppUrls } from '../app/urls.js';
import { logger } from '../../utils/logger.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import {
  RANGE_HOURS, QUIET_DAYS,
  type OverviewRange, type OverviewItem, type OverviewEdge, type OverviewView, type OverviewLane,
} from './overview-types.js';
import { dayOf, usageByActor, appUse, providerUse, workspaceActivity, appPlaces, ownOfferings } from './overview-sources.js';

/** Who reads the overview: always an owner's account, and whether workspace names may be shown. */
export interface OverviewCaller {
  owner: string;
  ownerGhii: string;
  seeWorkspaces: boolean;
}

const DAY_MS = 86_400_000;

/** Days from an instant to now, when that is QUIET_DAYS or more; null otherwise (or never seen). */
function quietDays(lastIso: string | null, now: number, bornIso?: string | null): number | null {
  const last = Date.parse(lastIso ?? '') || Date.parse(bornIso ?? '') || 0;
  if (!last) return null;
  const days = Math.floor((now - last) / DAY_MS);
  return days >= QUIET_DAYS ? days : null;
}

const newer = (a: string | null | undefined, b: string | null | undefined): string | null =>
  !a ? (b ?? null) : !b ? a : (a > b ? a : b);

/** Run one part; a part that fails leaves its default and names itself in `partial`. */
async function part<T>(name: string, partial: string[], fallback: T, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (err) {
    logger.warn('overview: part failed', { part: name, error: String(err) });
    partial.push(name);
    return fallback;
  }
}

/**
 * The overview in one read scope: the owner's agent list is read once (loadOwnerAgents) and shared by
 * the connectors and every other part that needs it.
 */
export function readOverview(
  deps: { config: AimeatConfig; storage: Storage }, caller: OverviewCaller, range: OverviewRange,
): Promise<OverviewView> {
  return runInReadScope(() => readOverviewNow(deps, caller, range));
}

async function readOverviewNow(
  deps: { config: AimeatConfig; storage: Storage }, caller: OverviewCaller, range: OverviewRange,
): Promise<OverviewView> {
  const { config, storage } = deps;
  const { owner, ownerGhii } = caller;
  const nowMs = Date.now();
  const since = new Date(nowMs - RANGE_HOURS[range] * 3_600_000).toISOString();
  const windowFrom = new Date(nowMs - QUIET_DAYS * DAY_MS).toISOString();
  const today = dayOf(new Date(nowMs).toISOString());
  const partial: string[] = ['agent-app-use'];

  const [agents, connectors, wanted, ties, choices, counts, listed] = await Promise.all([
    loadOwnerAgents(storage, owner),
    part('machines', partial, [], () => listConnectors(deps, owner)),
    part('machines', partial, {} as Record<string, string>, () => wantedInstalls(deps, owner)),
    part('agent-ties', partial, { apps: {}, workplaces: {} }, () => readAgentTies(deps, owner)),
    part('knowledge', partial, { places: [], apps: [] }, () => readTieChoices(deps, owner)),
    part('agent-tasks', partial, {} as Awaited<ReturnType<Storage['countTasksByOwner']>>, () => storage.countTasksByOwner(ownerGhii)),
    part('apps', partial, { apps: [], total: 0 }, () => storage.listApps({ ownerGaii: ownerGhii, viewerGhii: ownerGhii, limit: 1000 })),
  ]);

  const organismIds = [...new Set(choices.places.map(p => p.organism_id))];
  const known = {
    organisms: new Set(organismIds),
    workspaces: new Set(choices.places.map(p => `${p.organism_id}/${p.workspace_id}`)),
  };
  const [actorCalls, appsUse, provided, activity, placesOfApps, urls] = await Promise.all([
    part('agent-use', partial, new Map<string, number>(), () => usageByActor(storage, ownerGhii, dayOf(since), today)),
    part('app-use', partial, new Map(), () => appUse(storage, owner, dayOf(windowFrom), dayOf(since), today)),
    part('offering-use', partial, new Map<string, number>(), () => providerUse(storage, ownerGhii, dayOf(since), today)),
    part('knowledge-writes', partial, new Map(), () => workspaceActivity(storage, organismIds, windowFrom, since)),
    part('app-places', partial, new Map(), () => appPlaces(storage, ownerGhii, known)),
    part('apps', partial, {} as Record<string, string>, () => resolveAppUrls(config, storage, listed.apps.map(a => ({ owner, filename: a.filename })))),
  ]);
  const offerings = await part('offerings', partial, [], () => ownOfferings(deps, owner, ownerGhii, agents, provided));

  const items: OverviewItem[] = [];
  const edges: OverviewEdge[] = [];
  const nameOfGaii = new Map(agents.map(a => [a.gaii, a.name]));

  // ── Machines, chat clients, and agents ─────────────────────────────────────────────────────
  const homeOf = new Map<string, string>();
  for (const c of connectors) for (const n of c.agents) homeOf.set(n, c.id);
  const parentOf = (a: AgentRecord): string => {
    const id = homeOf.get(a.name) ?? wanted[a.name];
    if (id && connectors.some(c => c.id === id)) return `machine:${id}`;
    if (a.mcpClient) return `chat:${a.mcpClient}`;
    return 'unplaced';
  };
  const groupUse = new Map<string, { use: number; agents: number; last: string | null; online: boolean }>();
  const doneIn = (c: Record<string, number | string | null> | undefined): number => {
    if (!c) return 0;
    const key = range === '24h' ? 'done24h' : range === '7d' ? 'doneWeek' : 'done30d';
    return Number(c[key] ?? 0);
  };
  for (const a of agents) {
    const parent = parentOf(a);
    const calls = actorCalls.get(a.gaii) ?? 0;
    const c = counts[a.gaii] as unknown as Record<string, number | string | null> | undefined;
    const last = newer(a.lastSeen, (c?.lastTaskUpdateAt as string | null | undefined) ?? null);
    items.push({
      id: `agent:${a.name}`, lane: 'agents', kind: 'agent', name: a.displayName ?? a.name, parent,
      use: calls, unit: 'calls', last_at: last, quiet_days: quietDays(last, nowMs, a.createdAt),
      href: `/v1/home?agent=${encodeURIComponent(a.name)}`, tasks_done: doneIn(c),
    });
    const g = groupUse.get(parent) ?? { use: 0, agents: 0, last: null, online: false };
    g.use += calls; g.agents += 1; g.last = newer(g.last, last);
    if (parent.startsWith('chat:') && a.mcpLastSeen && nowMs - Date.parse(a.mcpLastSeen) < 15 * 60_000) g.online = true;
    groupUse.set(parent, g);
    edges.push({ from: parent, to: `agent:${a.name}`, kind: 'runs', weight: calls });
  }
  for (const c of connectors) {
    const id = `machine:${c.id}`;
    const g = groupUse.get(id);
    const last = newer(c.last_seen, g?.last ?? null);
    items.push({
      id, lane: 'machines', kind: 'machine', name: c.name ?? c.reported_name ?? c.id, parent: null,
      use: g?.use ?? 0, unit: 'calls', last_at: last, quiet_days: c.online ? null : quietDays(last, nowMs, c.first_seen),
      href: '/v1/home?computers=1', online: c.online, agents: g?.agents ?? 0,
    });
  }
  for (const [id, g] of groupUse) {
    if (id.startsWith('machine:')) continue;
    items.push({
      id, lane: 'machines', kind: id === 'unplaced' ? 'unplaced' : 'chat',
      // A client that did not say its name (`unknown`) is named by the page, in the reader's language.
      name: id === 'unplaced' || id === 'chat:unknown' ? '' : id.slice('chat:'.length), parent: null,
      use: g.use, unit: 'calls', last_at: g.last, quiet_days: g.online ? null : quietDays(g.last, nowMs),
      href: '/v1/home?agents=1', online: id === 'unplaced' ? undefined : g.online, agents: g.agents,
    });
  }

  // ── Apps ──────────────────────────────────────────────────────────────────────────────────
  const ownApps = new Set<string>();
  for (const app of listed.apps) {
    ownApps.add(app.filename);
    const u = appsUse.get(app.filename);
    const lastDay = u?.lastDay ? `${u.lastDay}T23:59:59.000Z` : null;
    items.push({
      id: `app:${app.filename}`, lane: 'apps', kind: 'app', name: app.manifest?.name || app.filename, parent: null,
      use: u?.range ?? 0, unit: 'opens', last_at: lastDay, quiet_days: quietDays(lastDay, nowMs, app.createdAt),
      href: urls[`${owner}/${app.filename}`] ?? `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(app.filename)}`,
    });
  }
  for (const [agentName, apps] of Object.entries(ties.apps)) {
    for (const app of apps) {
      if (app.owner !== owner || !ownApps.has(app.filename)) continue;
      edges.push({ from: `agent:${agentName}`, to: `app:${app.filename}`, kind: 'uses', weight: 0 });
    }
  }

  // ── Knowledge ─────────────────────────────────────────────────────────────────────────────
  const orgName = new Map(choices.places.map(p => [p.organism_id, p.organism_name]));
  for (const orgId of organismIds) {
    const act = activity.get(orgId);
    const wss = choices.places.filter(p => p.organism_id === orgId);
    let orgUse = 0;
    for (const p of wss) {
      const w = act?.workspaces.get(p.workspace_id);
      orgUse += w?.range ?? 0;
      if (caller.seeWorkspaces) {
        items.push({
          id: `workspace:${orgId}/${p.workspace_id}`, lane: 'knowledge', kind: 'workspace', name: p.workspace_name,
          parent: `organism:${orgId}`, use: w?.range ?? 0, unit: 'writes', last_at: w?.last ?? null,
          quiet_days: quietDays(w?.last ?? null, nowMs),
          href: `/v1/profile?tab=organisms&org=${encodeURIComponent(orgId)}`,
        });
      }
      // Writes by the owner's agents become lines; other writers are counted in `use`, never named.
      for (const [writer, n] of w?.byWriter ?? []) {
        const agentName = nameOfGaii.get(writer);
        if (!agentName) continue;
        edges.push({
          from: `agent:${agentName}`,
          to: caller.seeWorkspaces ? `workspace:${orgId}/${p.workspace_id}` : `organism:${orgId}`,
          kind: 'writes', weight: n,
        });
      }
    }
    items.push({
      id: `organism:${orgId}`, lane: 'knowledge', kind: 'organism', name: orgName.get(orgId) ?? orgId, parent: null,
      use: orgUse, unit: 'writes', last_at: act?.last ?? null, quiet_days: quietDays(act?.last ?? null, nowMs),
      href: `/v1/profile?tab=organisms&org=${encodeURIComponent(orgId)}`, workspaces: caller.seeWorkspaces ? wss.length : undefined,
    });
    if (act?.truncated) partial.push(`knowledge-writes:${orgId}`);
  }
  for (const [agentName, wp] of Object.entries(ties.workplaces)) {
    if (!known.organisms.has(wp.organism_id)) continue;
    const to = caller.seeWorkspaces ? `workspace:${wp.organism_id}/${wp.workspace_id}` : `organism:${wp.organism_id}`;
    if (!edges.some(e => e.from === `agent:${agentName}` && e.to === to)) {
      edges.push({ from: `agent:${agentName}`, to, kind: 'writes', weight: 0 });
    }
  }
  for (const [filename, places] of placesOfApps) {
    if (!ownApps.has(filename)) continue;
    for (const p of places) {
      const to = p.workspaceId && caller.seeWorkspaces ? `workspace:${p.organismId}/${p.workspaceId}` : `organism:${p.organismId}`;
      const w = p.workspaceId ? activity.get(p.organismId)?.workspaces.get(p.workspaceId) : undefined;
      edges.push({ from: `app:${filename}`, to, kind: 'shows', weight: w?.range ?? 0 });
    }
  }

  // ── Offerings ─────────────────────────────────────────────────────────────────────────────
  for (const o of offerings) {
    const id = o.kind === 'app-tools' ? `tools:${o.source}` : `offer:${o.source}/${o.offerId}`;
    items.push({
      id, lane: 'offerings', kind: o.kind, name: o.name, parent: null,
      use: o.calls, unit: 'calls', last_at: null, quiet_days: null,
      href: o.kind === 'app-tools' ? '/v1/profile?tab=offers' : `/v1/home?agent=${encodeURIComponent(o.source)}`,
      tools: o.tools, free_tools: o.freeTools, priced_tools: o.pricedTools,
      capability: o.capability, exchange: o.exchange, contracts: o.contracts,
    });
    const from = o.kind === 'app-tools' ? `app:${o.source}` : `agent:${o.source}`;
    if (o.kind === 'agent-offer' || ownApps.has(o.source)) edges.push({ from, to: id, kind: 'offers', weight: o.calls });
  }

  const count = (lane: OverviewLane, kinds?: string[]) => items.filter(i => i.lane === lane && (!kinds || kinds.includes(i.kind))).length;
  const lanes: OverviewLane[] = ['machines', 'agents', 'apps', 'knowledge', 'offerings'];
  const perLane = (pick: (i: OverviewItem) => boolean) =>
    Object.fromEntries(lanes.map(l => [l, items.filter(i => i.lane === l && i.kind !== 'workspace' && pick(i)).length])) as Record<OverviewLane, number>;
  return {
    range, since, generated_at: new Date(nowMs).toISOString(),
    totals: {
      machines: count('machines', ['machine', 'chat']),
      agents: count('agents'),
      apps: count('apps'),
      organisms: count('knowledge', ['organism']),
      offerings: count('offerings'),
      quiet: items.filter(i => i.quiet_days !== null && i.kind !== 'workspace').length,
      online: items.filter(i => i.lane === 'machines' && i.online === true).length,
      used: perLane(i => i.use > 0),
      quiet_by_lane: perLane(i => i.quiet_days !== null),
    },
    items, edges, partial: [...new Set(partial)],
  };
}

/**
 * A smaller answer for a reader that cannot take the whole account at once, such as an AI's context.
 * `focus` keeps one item, its group, the items in it, and everything one line away. `limit` keeps the
 * busiest N of each lane, the groups they sit in, and the three busiest workspaces of each kept
 * organism. Totals are the whole account's either way.
 */
export function trimOverview(view: OverviewView, opts: { focus?: string; limit?: number }): OverviewView {
  let keep: Set<string>;
  const byId = new Map(view.items.map(i => [i.id, i]));
  if (opts.focus) {
    const f = byId.get(opts.focus);
    if (!f) return { ...view, items: [], edges: [] };
    keep = new Set([f.id]);
    if (f.parent) keep.add(f.parent);
    for (const i of view.items) if (i.parent === f.id) keep.add(i.id);
    for (const e of view.edges) {
      if (keep.has(e.from) && (e.from === f.id || byId.get(e.from)?.parent === f.id)) keep.add(e.to);
      if (keep.has(e.to) && (e.to === f.id || byId.get(e.to)?.parent === f.id)) keep.add(e.from);
    }
  } else if (opts.limit && opts.limit > 0) {
    keep = new Set();
    const lanes: OverviewLane[] = ['machines', 'agents', 'apps', 'knowledge', 'offerings'];
    for (const lane of lanes) {
      const top = view.items.filter(i => i.lane === lane && i.kind !== 'workspace')
        .sort((a, b) => b.use - a.use || (b.last_at ?? '').localeCompare(a.last_at ?? ''))
        .slice(0, opts.limit);
      for (const i of top) { keep.add(i.id); if (i.parent) keep.add(i.parent); }
    }
    // A kept organism keeps its three busiest workspaces, so an AI still sees where the writes went.
    const byOrg = new Map<string, OverviewItem[]>();
    for (const w of view.items.filter(i => i.kind === 'workspace' && i.parent && keep.has(i.parent))) {
      byOrg.set(w.parent!, [...(byOrg.get(w.parent!) ?? []), w]);
    }
    for (const ws of byOrg.values()) {
      for (const w of ws.sort((a, b) => b.use - a.use).slice(0, 3)) keep.add(w.id);
    }
  } else {
    return view;
  }
  return {
    ...view,
    items: view.items.filter(i => keep.has(i.id)),
    edges: view.edges.filter(e => keep.has(e.from) && keep.has(e.to)),
  };
}
