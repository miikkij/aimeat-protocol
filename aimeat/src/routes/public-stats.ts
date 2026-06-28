/**
 * @file public-stats.ts
 * @description Public, unauthenticated landing-page data: a live activity ticker and
 *   today's node activity counters. Serves ONLY public-visibility data (public memory
 *   entries + aggregate counts) — never private keys, organisms or per-user details.
 *   Both endpoints are cached in-process (ticker 10 s, stats 60 s) and rate-limited.
 * @structure publicStatsRouter() — GET /v1/public/activity-ticker, GET /v1/public/node-stats-today
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial: landing redesign (live ticker + today's counters).
 *   v1.1.0 — 2026-06-16 — Exclude synthetic 'activity/' public-activity-feed entries from
 *     both the ticker and today's public_writes count (they have their own feed).
 *   v1.2.0 — 2026-06-20 — Add GET /v1/public/node-totals: cumulative public counters
 *     (apps, organisms, agents+online, knowledge packages, downloads) for the landing
 *     panel that replaced the often-empty activity feed.
 *   v1.3.0 — 2026-06-22 — Migrate the three hand-rolled CacheSlot caches onto the generic cache
 *     layer (services/cache.ts): same 10/60/30s TTLs, now also event-bus invalidated by domain tag.
 *   v1.3.1 — 2026-06-28 — Fix node-totals knowledge_packages reading 0 on busy nodes: scope the
 *     count query to the packages/ prefix so it isn't swamped out of the recent-1000 window by
 *     public activity-feed writes.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { cached, TTL } from '../services/cache.js';

export function publicStatsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const agentNameOf = (gaii: string) => (gaii.includes('#') ? gaii.split('#')[0] : gaii.split('@')[0]);
  const isToday = (iso?: string) => !!iso && iso.slice(0, 10) === new Date().toISOString().slice(0, 10);

  // GET /v1/public/activity-ticker — newest public memory writes + agents-online count.
  // Cached 10s; invalidated when public memory or agents change.
  router.get('/v1/public/activity-ticker', rateLimit({ windowMs: 60_000, max: 60 }), async (_req, res) => {
    const payload = await cached('public:ticker', TTL.public, async () => {
      let items: Array<{ actor: string; key: string; at: string }> = [];
      let agentsOnline = 0;
      try {
        const result = await storage.listAllMemory({ visibility: 'public', limit: 100 });
        items = result.items
          // Exclude synthetic public-activity-feed entries (system@; key 'activity/…') —
          // they have their own feed and would otherwise double-up in this ticker.
          .filter(m => m.updatedAt && !m.key.startsWith('activity/'))
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          .slice(0, 10)
          .map(m => ({
            actor: agentNameOf(m.ownerGaii || ''),
            // Only the key TAIL — full keys can encode organism/workspace structure.
            key: m.key.split('.').slice(-2).join('.'),
            at: m.updatedAt!,
          }));
      } catch { /* fall through to empty — frontend has a static fallback */ }
      try {
        const agents = await storage.listAgents();
        const cutoff = Date.now() - 10 * 60 * 1000;
        agentsOnline = agents.filter(a => a.lastSeen && new Date(a.lastSeen).getTime() > cutoff).length;
      } catch { /* count stays 0 */ }
      return { items, agents_online: agentsOnline };
    }, ['domain:memory', 'domain:agents']);
    res.json(success(config.nodeId, payload));
  });

  // GET /v1/public/node-stats-today — aggregate counters for today. Real numbers,
  // never hardcoded; the frontend omits zero counters from the sentence. Cached 60s.
  router.get('/v1/public/node-stats-today', rateLimit({ windowMs: 60_000, max: 30 }), async (_req, res) => {
    const payload = await cached('public:node-stats-today', TTL.dashboard, async () => {
      let publicWrites = 0;
      let schedulesFired = 0;
      let tasksCompleted = 0;
      try {
        const mem = await storage.listAllMemory({ visibility: 'public', limit: 500 });
        // Exclude synthetic public-activity-feed entries — they would inflate the count.
        publicWrites = mem.items.filter(m => isToday(m.updatedAt) && !m.key.startsWith('activity/')).length;
      } catch { /* 0 */ }
      try {
        const jobs = await storage.listScheduledJobs();
        schedulesFired = jobs.filter(j => isToday((j as { lastRunAt?: string }).lastRunAt)).length;
      } catch { /* 0 */ }
      try {
        // Bounded sweep: first 50 agents × first 50 done tasks. The 60 s cache keeps
        // this cheap; on very large nodes the figure is a floor, not a lie.
        const agents = (await storage.listAgents()).slice(0, 50);
        for (const a of agents) {
          const r = await storage.listAgentTasks(a.gaii, { status: 'done', perPage: 50 });
          tasksCompleted += r.tasks.filter(tk => isToday((tk as { completedAt?: string }).completedAt)).length;
        }
      } catch { /* 0 */ }
      return { public_writes: publicWrites, tasks_completed: tasksCompleted, schedules_fired: schedulesFired };
    }, ['domain:memory', 'domain:scheduler', 'domain:agent-tasks']);
    res.json(success(config.nodeId, payload));
  });

  // GET /v1/public/node-totals — cumulative public counters for the landing panel.
  // Always-meaningful "this node has X" figures so the landing never reads as broken-empty.
  // All real numbers; on very large nodes the bounded sweeps make a figure a floor, not a lie. Cached 30s.
  router.get('/v1/public/node-totals', rateLimit({ windowMs: 60_000, max: 60 }), async (_req, res) => {
    const payload = await cached('public:node-totals', TTL.catalogue, async () => {
      let apps = 0, downloads = 0, organisms = 0, agents = 0, agentsOnline = 0, knowledgePackages = 0;
      try {
        // No ownerGaii/viewerGhii → public, latest-version, non-parked apps only.
        const { apps: list, total } = await storage.listApps({ limit: 1000 });
        apps = total || list.length;
        const counts = await Promise.all(
          list.map(a => storage.getAppDownloads(a.ownerGaii, a.filename).catch(() => 0)),
        );
        downloads = counts.reduce((s, n) => s + (Number(n) || 0), 0);
      } catch { /* 0 */ }
      try {
        const orgs = await storage.listOrganisms({ visibility: 'public', perPage: 1000, archived: 'exclude' });
        organisms = orgs.length;
      } catch { /* 0 */ }
      try {
        const all = await storage.listAgents();
        agents = all.length;
        const cutoff = Date.now() - 10 * 60 * 1000;
        agentsOnline = all.filter(a => a.lastSeen && new Date(a.lastSeen).getTime() > cutoff).length;
      } catch { /* 0 */ }
      try {
        // Public knowledge packages are public memory entries keyed packages/{id}/manifest.
        // Scope the query to the packages/ prefix — an unscoped recent-1000 scan of all public
        // memory gets swamped by the public activity feed (activity/…) on busy nodes, pushing
        // the manifests past the limit and undercounting to 0 (catalogue is unaffected: it
        // queries per-owner with the same prefix).
        const mem = await storage.listAllMemory({ visibility: 'public', prefix: 'packages/', limit: 1000 });
        knowledgePackages = mem.items.filter(m => /^packages\/[^/]+\/manifest$/.test(m.key)).length;
      } catch { /* 0 */ }
      return {
        apps, downloads, organisms,
        agents, agents_online: agentsOnline,
        knowledge_packages: knowledgePackages,
      };
    }, ['domain:apps', 'domain:organisms', 'domain:agents', 'domain:memory']);
    res.json(success(config.nodeId, payload));
  });

  return router;
}
