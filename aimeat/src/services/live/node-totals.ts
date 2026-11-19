/**
 * @file src/services/live/node-totals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's public counters (GET /v1/public/node-totals) and the live domain that says
 *   they changed, `node-totals`, so the front page reads them again when they move instead of
 *   asking every 60 seconds (feature audit 2026-11-19, 4.6; CLAUDE.md: live data arrives as an
 *   event, never by polling).
 *
 *   WHERE THE CHANGE IS SEEN. The counters move on writes in four domains (apps, organisms, agents,
 *   a public memory record) and on two things no route writes as an event: an app opened (the
 *   download count) and an agent that stops being seen (the "awake right now" figure counts agents
 *   seen in the last ten minutes). So the watcher computes the counters again after a write in one
 *   of those domains, at most once per CHECK_GAP_MS, and once a minute for the two quiet ones, and
 *   emits `node-totals` only when a number differs from the last one it saw. One computation per
 *   node per minute replaces one request per open front page per minute, and the cached read
 *   (services/cache.ts, the same entry the route serves) keeps a busy minute to one computation.
 *
 *   WHO HEARS IT. The domain carries no owner, so every signed-in stream hears it, and it is the one
 *   domain a visitor's stream carries (routes/sse.ts PUBLIC_STREAM_DOMAINS): the counters are public.
 * @structure NODE_TOTALS_DOMAIN · NodeTotals · computeNodeTotals · readNodeTotals ·
 *   startNodeTotalsLive · stopNodeTotalsLive
 * @usage startNodeTotalsLive(storage, config); // at boot, beside the other process buffers
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: the computation moved from routes/public-stats.ts unchanged, and
 *     the live domain (feature audit 2026-11-19, 4.6).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { cached, TTL } from '../cache.js';
import { emitChange, onChangeEvent, offChangeEvent, isRemoteEvent, type ChangeEvent } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { runAsNode } from '../../utils/gaii.js';

/** The live domain: the public counters changed. Public, so a visitor's stream carries it. */
export const NODE_TOTALS_DOMAIN = 'node-totals';

/** The domains whose writes can move a counter. A memory change counts only when it is not one owner's. */
const WATCHED = new Set(['apps', 'organisms', 'agents', 'memory']);
/** At most one computation per this many ms after writes; the cache entry lives 30 s anyway. */
const CHECK_GAP_MS = 5_000;
/** The quiet figures (app opens, agents that stop being seen) are looked at this often. */
const SWEEP_MS = 60_000;

export interface NodeTotals {
  apps: number;
  downloads: number;
  organisms: number;
  agents: number;
  agents_online: number;
  knowledge_packages: number;
}

/**
 * Cumulative public counters. Always-meaningful "this node has X" figures so the landing never reads
 * as broken-empty. All real numbers; on very large nodes the bounded sweeps make a figure a floor,
 * not a lie. Each part that fails counts 0 and says so in the log.
 */
export async function computeNodeTotals(storage: Storage): Promise<NodeTotals> {
  let apps = 0, downloads = 0, organisms = 0, agents = 0, agentsOnline = 0, knowledgePackages = 0;
  try {
    // No ownerGaii/viewerGhii → public, latest-version, non-parked apps only.
    const { apps: list, total } = await storage.listApps({ limit: 1000 });
    apps = total || list.length;
    // One query for every app's count (getAppDownloadsForApps), where one query per app ran at
    // once against a pool of 20. Summed per listed app, as before; a failed read counts 0.
    const counts = await storage.getAppDownloadsForApps(list.map(a => ({ ownerGaii: a.ownerGaii, filename: a.filename })))
      .catch((err: unknown): Record<string, number> => { logger.warn('GET /v1/public/node-totals: continuing after a suppressed failure', { error: String(err) }); return {}; });
    downloads = list.reduce((s, a) => s + (Number(counts[`${a.ownerGaii} ${a.filename}`]) || 0), 0);
  } catch (err) { logger.warn('GET /v1/public/node-totals: continuing after a suppressed failure', { error: String(err) }); }
  try {
    const orgs = await storage.listOrganisms({ visibility: 'public', perPage: 1000, archived: 'exclude' });
    organisms = orgs.length;
  } catch (err) { logger.warn('GET /v1/public/node-totals: continuing after a suppressed failure', { error: String(err) }); }
  try {
    const all = await storage.listAgents();
    agents = all.length;
    const cutoff = Date.now() - 10 * 60 * 1000;
    agentsOnline = all.filter(a => a.lastSeen && new Date(a.lastSeen).getTime() > cutoff).length;
  } catch (err) { logger.warn('GET /v1/public/node-totals: continuing after a suppressed failure', { error: String(err) }); }
  try {
    // Public knowledge packages are public memory entries keyed packages/{id}/manifest.
    // Scope the query to the packages/ prefix — an unscoped recent-1000 scan of all public
    // memory gets swamped by the public activity feed (activity/…) on busy nodes, pushing
    // the manifests past the limit and undercounting to 0 (catalogue is unaffected: it
    // queries per-owner with the same prefix).
    const mem = await storage.listAllMemoryMeta({ visibility: 'public', prefix: 'packages/', limit: 1000 });
    knowledgePackages = mem.items.filter(m => /^packages\/[^/]+\/manifest$/.test(m.key)).length;
  } catch (err) { logger.warn('GET /v1/public/node-totals: continuing after a suppressed failure', { error: String(err) }); }
  return {
    apps, downloads, organisms,
    agents, agents_online: agentsOnline,
    knowledge_packages: knowledgePackages,
  };
}

/** The counters through the read cache the route serves from: 30 s, dropped on a write in a counted domain. */
export function readNodeTotals(storage: Storage): Promise<NodeTotals> {
  return cached('public:node-totals', TTL.catalogue, () => computeNodeTotals(storage),
    ['domain:apps', 'domain:organisms', 'domain:agents', 'domain:memory']);
}

// process-local: the one watcher of this process, so a second start is a no-op and the stop finds it.
let watcher: { stop: () => void } | null = null;

/** Start watching the counters and telling the streams when they change. A second call is a no-op. */
export function startNodeTotalsLive(storage: Storage, config: AimeatConfig): void {
  if (watcher) return;
  let last: string | null = null;
  let lastCheck = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const check = async (): Promise<void> => {
    lastCheck = Date.now();
    const now = JSON.stringify(await readNodeTotals(storage));
    if (stopped) return;
    if (last !== null && now !== last) runAsNode(config.nodeId, () => emitChange(NODE_TOTALS_DOMAIN));
    last = now;
  };
  const run = (): void => {
    void check().catch((err: unknown) => logger.warn('node-totals: the counters could not be read, nothing was told this time', { error: String(err) }));
  };
  const schedule = (): void => {
    if (pending || stopped) return;
    pending = setTimeout(() => { pending = null; run(); }, Math.max(1_000, lastCheck + CHECK_GAP_MS - Date.now()));
    pending.unref?.();
  };
  // A write this process made; another process's write is checked by that process (the origin rule
  // in services/event-bus.ts), and its `node-totals` reaches the streams here through the bus.
  const onChange = (evt: ChangeEvent): void => {
    if (isRemoteEvent(evt) || !WATCHED.has(evt.domain)) return;
    if (evt.domain === 'memory' && evt.ownerGaii) return;
    schedule();
  };
  onChangeEvent(onChange);
  // process-local: every process sweeps the counters; with two processes each one tells the streams of a change it sees, so a page may hear one change twice and read the counters twice.
  const sweep = setInterval(run, SWEEP_MS);
  sweep.unref?.();
  run();

  watcher = {
    stop: () => {
      stopped = true;
      offChangeEvent(onChange);
      clearInterval(sweep);
      if (pending) clearTimeout(pending);
      watcher = null;
    },
  };
}

/** Stop the watcher, at shutdown. A second call is a no-op. */
export function stopNodeTotalsLive(): void {
  watcher?.stop();
}
