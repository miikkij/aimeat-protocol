/**
 * @file src/services/overview/overview-sources.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The counted parts of the overview, each read once for the whole account: calls per
 *   agent, opens per app, calls on the owner's offerings, writes per workspace, and what the owner
 *   offers. services/overview/overview-read.ts puts them together.
 *
 *   EVERY READ IS PINNED TO THE OWNER. The usage cuts are read with the owner in `ownerGhii` or, for
 *   what others used of theirs, in `counterpartyGhii`. One cut names no person, `call.app`, which is
 *   keyed by app only; it is read node-wide and cut to the owner's own app ids here, before anything
 *   leaves this module, because the usage store has no prefix filter on the app id and a read per app
 *   would be 227 reads for one account on aimeat.io.
 *
 *   WRITES PER WORKSPACE COME FROM THE KEYS, NOT THE VALUES. storage.listKeyActivity returns the key,
 *   the writer and the time of each record changed since an instant, never its value, so an account
 *   in 43 organisms costs 43 small reads. The writer of an organism record is the identity it is
 *   stored under, which is how a write by one of the owner's agents is told from anybody else's;
 *   writes by other people are counted, never named.
 * @structure usageByActor · appUse · providerUse · workspaceActivity · ownOfferings · OwnOffering
 * @usage const calls = await usageByActor(storage, ownerGhii, fromDay, toDay);
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AgentRecord } from '../../storage/types/identity.js';
import { queryUsageRollupLive } from '../usage/usage-read.js';
import { ownPublicManifests } from '../../commerce/app-tool-catalog.js';
import { isToolPriced } from '../../models/app-tool-schemas.js';
import { loadAgentOffers } from '../agent-offers-write.js';
import { listOfferings, appToolCoordinate } from '../exchange-market.js';
import { listEntitlementsByProvider } from '../metered-entitlements.js';
import { logger } from '../../utils/logger.js';

/** The most records one organism's activity read returns; a busier organism counts what fits. */
const ACTIVITY_ROWS_PER_ORGANISM = 5_000;

/** The day an ISO instant falls on, as the usage roll-up names its day buckets. */
export const dayOf = (iso: string): string => iso.slice(0, 10);

/** Calls each of the owner's principals made in the period: `call.actor`, keyed by the owner. */
export async function usageByActor(storage: Storage, ownerGhii: string, fromDay: string, toDay: string): Promise<Map<string, number>> {
  const rows = await queryUsageRollupLive(storage, { cut: 'call.actor', grain: 'day', from: fromDay, to: toDay, ownerGhii }, 'call');
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.actorGaii) continue;
    out.set(r.actorGaii, (out.get(r.actorGaii) ?? 0) + r.calls);
  }
  return out;
}

/** Opens and tool calls of one app: in the period, and the last day it saw any in the 30-day window. */
export interface AppUse { range: number; lastDay: string | null }

/**
 * Use of the owner's own apps, by filename. `call.app` is keyed by app id (`<owner>/<filename>`) and
 * names nobody, so the node-wide read is cut to the owner's prefix here (see the header).
 */
export async function appUse(storage: Storage, ownerName: string, windowFromDay: string, sinceDay: string, toDay: string): Promise<Map<string, AppUse>> {
  const rows = await queryUsageRollupLive(storage, { cut: 'call.app', grain: 'day', from: windowFromDay, to: toDay }, 'call');
  const prefix = `${ownerName}/`;
  const out = new Map<string, AppUse>();
  for (const r of rows) {
    if (!r.appId || !r.appId.startsWith(prefix)) continue;
    const filename = r.appId.slice(prefix.length);
    const cur = out.get(filename) ?? { range: 0, lastDay: null };
    if (r.bucket >= sinceDay) cur.range += r.calls;
    if (r.calls > 0 && (!cur.lastDay || r.bucket > cur.lastDay)) cur.lastDay = r.bucket;
    out.set(filename, cur);
  }
  return out;
}

/** Calls other people made on what this owner provides, by metered coordinate (`<ext>/<action>`). */
export async function providerUse(storage: Storage, ownerGhii: string, fromDay: string, toDay: string): Promise<Map<string, number>> {
  const rows = await queryUsageRollupLive(storage, { cut: 'call.provider.coordinate', grain: 'day', from: fromDay, to: toDay, counterpartyGhii: ownerGhii }, 'call');
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.coordinate) continue;
    out.set(r.coordinate, (out.get(r.coordinate) ?? 0) + r.calls);
  }
  return out;
}

/** Writes into one workspace: in the period, the newest write in the window, and by which writer. */
export interface WorkspaceActivity {
  range: number;
  last: string | null;
  /** Writes in the period by each writer identity (GHII or GAII). */
  byWriter: Map<string, number>;
}

/** Writes into an organism's workspaces, keyed by workspace id, plus the organism's newest write. */
export interface OrganismActivity { last: string | null; workspaces: Map<string, WorkspaceActivity>; truncated: boolean }

/**
 * Writes per workspace for each organism, from the record keys changed since `windowFrom`
 * (`organism.<org>.w.<ws>.<rest>`). A key outside a workspace (the organism's registry, its meta)
 * moves the organism's `last` and no workspace.
 */
export async function workspaceActivity(
  storage: Storage, organismIds: string[], windowFromIso: string, sinceIso: string,
): Promise<Map<string, OrganismActivity>> {
  const out = new Map<string, OrganismActivity>();
  await Promise.all(organismIds.map(async (orgId) => {
    const root = `organism.${orgId}.`;
    const act: OrganismActivity = { last: null, workspaces: new Map(), truncated: false };
    try {
      const rows = await storage.listKeyActivity(root, windowFromIso, ACTIVITY_ROWS_PER_ORGANISM);
      act.truncated = rows.length >= ACTIVITY_ROWS_PER_ORGANISM;
      for (const r of rows) {
        if (!act.last || r.updatedAt > act.last) act.last = r.updatedAt;
        const rest = r.key.slice(root.length);
        if (!rest.startsWith('w.')) continue;
        const [wsId, area] = rest.slice(2).split('.');
        if (!wsId) continue;
        // The workspace's own description (`<root>.meta.manifest`, its readme) is not a record or a
        // document someone wrote into it; it moves the organism's `last` and nothing else.
        if (area === 'meta') continue;
        const w = act.workspaces.get(wsId) ?? { range: 0, last: null, byWriter: new Map<string, number>() };
        if (!w.last || r.updatedAt > w.last) w.last = r.updatedAt;
        if (r.updatedAt >= sinceIso) {
          w.range += 1;
          w.byWriter.set(r.ownerGaii, (w.byWriter.get(r.ownerGaii) ?? 0) + 1);
        }
        act.workspaces.set(wsId, w);
      }
    } catch (err) {
      logger.warn('overview: workspace activity read failed', { orgId, error: String(err) });
    }
    out.set(orgId, act);
  }));
  return out;
}

/** Where one app keeps data, as its data map states it: an organism, and a workspace when named. */
export interface AppPlace { organismId: string; workspaceId: string | null }

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const WS_ID = /\bws-[a-z0-9]+\b/i;

/**
 * The organisms and workspaces each of the owner's apps keeps data in, read from the apps' data maps
 * (one tagged memory query, the read services/agent-ties.ts makes). A row in an organism states the
 * place in its free-text `whereExactly`; the ids found there are kept only when they name one of
 * `known` (the reader's own places), so a map cannot draw a line to somewhere the reader is not.
 * An app with no data map has no line, which is what its card then says.
 */
export async function appPlaces(
  storage: Storage, ownerGhii: string, known: { organisms: Set<string>; workspaces: Set<string> },
): Promise<Map<string, AppPlace[]>> {
  const out = new Map<string, AppPlace[]>();
  const records = await storage.listMemory(ownerGhii, { tags: ['datamap'] });
  for (const rec of records) {
    const appId = /^apps\.(.+)\.datamap$/.exec(rec.key)?.[1];
    const map = rec.value as { held?: Array<{ where?: string; whereExactly?: string }> } | undefined;
    if (!appId || !Array.isArray(map?.held)) continue;
    const filename = appId.endsWith('.html') ? appId : `${appId}.html`;
    const seen = new Set<string>();
    const places: AppPlace[] = [];
    for (const row of map.held) {
      if (!row || typeof row.where !== 'string' || !row.where.startsWith('organism-')) continue;
      const text = typeof row.whereExactly === 'string' ? row.whereExactly : '';
      const org = UUID.exec(text)?.[0]?.toLowerCase();
      if (!org || !known.organisms.has(org)) continue;
      const ws = WS_ID.exec(text)?.[0] ?? null;
      const wsKnown = ws && known.workspaces.has(`${org}/${ws}`) ? ws : null;
      const key = `${org}/${wsKnown ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push({ organismId: org, workspaceId: wsKnown });
    }
    if (places.length) out.set(filename, places);
  }
  return out;
}

/** One offering of the owner's, before it is shaped as an overview item. */
export interface OwnOffering {
  kind: 'app-tools' | 'agent-offer';
  /** The app's filename, or the agent's name. */
  source: string;
  /** For an agent offer: the offer's id. */
  offerId?: string;
  name: string;
  tools: number;
  freeTools: number;
  pricedTools: number;
  capability: boolean;
  exchange: boolean;
  contracts: number;
  /** Calls by others in the period, from the metered coordinates. */
  calls: number;
}

/**
 * What the owner offers: each app's public tool manifest as one item (every tool in it is a
 * capability on the node), and each agent offer (a capability when public). EXCHANGE listings and
 * their contracts come from the marketplace's own records.
 */
export async function ownOfferings(
  deps: { storage: Storage; config: AimeatConfig }, ownerName: string, ownerGhii: string, agents: AgentRecord[], callsByCoordinate: Map<string, number>,
): Promise<OwnOffering[]> {
  const { storage, config } = deps;
  const out: OwnOffering[] = [];
  const [manifests, listings, entitlements] = await Promise.all([
    ownPublicManifests(storage, ownerGhii),
    listOfferings(storage).then(all => all.filter(o => o.providerGhii === ownerGhii))
      .catch((err) => { logger.warn('overview: EXCHANGE listings read failed', { error: String(err) }); return []; }),
    listEntitlementsByProvider(storage, ownerGhii)
      .catch((err) => { logger.warn('overview: contracts read failed', { error: String(err) }); return []; }),
  ]);
  const contractsOn = (ext: string, action?: string) =>
    entitlements.filter(e => e.ext === ext && (action === undefined || e.action === action)).length;
  const listedExt = new Set(listings.map(o => o.ext));

  for (const { appId, tools } of manifests) {
    if (tools.length === 0) continue;
    const filename = appId.endsWith('.html') ? appId : `${appId}.html`;
    const ext = appToolCoordinate(ownerName, appId, '').ext;
    let priced = 0;
    let calls = 0;
    for (const t of tools) {
      if (isToolPriced(t)) priced += 1;
      calls += callsByCoordinate.get(`${ext}/${t.name}`) ?? 0;
    }
    out.push({
      kind: 'app-tools', source: filename, name: filename.replace(/\.html$/i, ''),
      tools: tools.length, freeTools: tools.length - priced, pricedTools: priced,
      capability: true,
      exchange: listedExt.has(ext) || tools.some(t => (t as { exchange?: boolean }).exchange === true && isToolPriced(t)),
      contracts: contractsOn(ext), calls,
    });
  }

  await Promise.all(agents.map(async (a) => {
    try {
      const read = await loadAgentOffers({ storage, config }, ownerName, a.name);
      if (!read.ok) return;
      for (const offer of read.offers) {
        const o = offer as { id: string; title: string; visibility?: string; exchange?: boolean; priceMoney?: { amount?: number } | null };
        const priced = !!o.priceMoney?.amount;
        const ext = `agentwork:${ownerName}/${a.name}`;
        out.push({
          kind: 'agent-offer', source: a.name, offerId: o.id, name: o.title,
          tools: 1, freeTools: priced ? 0 : 1, pricedTools: priced ? 1 : 0,
          capability: o.visibility === 'public',
          exchange: o.exchange === true || listedExt.has(ext),
          contracts: contractsOn(ext, o.id), calls: callsByCoordinate.get(`${ext}/${o.id}`) ?? 0,
        });
      }
    } catch (err) {
      logger.warn('overview: agent offers read failed', { agent: a.name, error: String(err) });
    }
  }));
  return out;
}
