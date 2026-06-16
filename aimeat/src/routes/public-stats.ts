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
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';

interface CacheSlot<T> { at: number; value: T | null; }

export function publicStatsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const tickerCache: CacheSlot<unknown> = { at: 0, value: null };
  const statsCache: CacheSlot<unknown> = { at: 0, value: null };

  const agentNameOf = (gaii: string) => (gaii.includes('#') ? gaii.split('#')[0] : gaii.split('@')[0]);
  const isToday = (iso?: string) => !!iso && iso.slice(0, 10) === new Date().toISOString().slice(0, 10);

  // GET /v1/public/activity-ticker — newest public memory writes + agents-online count.
  router.get('/v1/public/activity-ticker', rateLimit({ windowMs: 60_000, max: 60 }), async (_req, res) => {
    if (Date.now() - tickerCache.at < 10_000 && tickerCache.value) {
      res.json(success(config.nodeId, tickerCache.value));
      return;
    }
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
    const payload = { items, agents_online: agentsOnline };
    tickerCache.at = Date.now();
    tickerCache.value = payload;
    res.json(success(config.nodeId, payload));
  });

  // GET /v1/public/node-stats-today — aggregate counters for today. Real numbers,
  // never hardcoded; the frontend omits zero counters from the sentence.
  router.get('/v1/public/node-stats-today', rateLimit({ windowMs: 60_000, max: 30 }), async (_req, res) => {
    if (Date.now() - statsCache.at < 60_000 && statsCache.value) {
      res.json(success(config.nodeId, statsCache.value));
      return;
    }
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
    const payload = { public_writes: publicWrites, tasks_completed: tasksCompleted, schedules_fired: schedulesFired };
    statsCache.at = Date.now();
    statsCache.value = payload;
    res.json(success(config.nodeId, payload));
  });

  return router;
}
