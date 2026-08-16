/**
 * @file src/routes/admin-usage.ts
 * @description The operator's cross-owner usage surface: node-wide reports off the precomputed
 *   layer, a per-owner drill, the raw call list, and the two maintenance actions (rebuild a rollup
 *   range, prune the archive). Design: docs/internal/telemetria/02-design.md
 *
 *   WHY THE OPERATOR SEES PER-USER DETAIL AT ALL. The operator carries liability for what happens
 *   on this node, so anything that can become a legal matter has to be visible to them. That is a
 *   decision about consequences, not about convenience, and it is why this router exposes the raw
 *   call level rather than only aggregates.
 *
 *   AND WHY LOOKING IS ITSELF AN EVENT. GET /v1/admin/usage/calls writes a UsageCall of its own —
 *   surface 'operator', the inspected owner as the counterparty — which folds into the same rollups
 *   as everything else. So an owner can see that their activity was inspected, and the operator's
 *   access history is a first-class record instead of a line in a log file that rotates. No new
 *   table for it: the same fact in the same stream is the whole reason there is one stream.
 * @structure
 *   - GET  /v1/admin/usage/summary        -- any node report, or one owner's slice of it
 *   - GET  /v1/admin/usage/calls          -- raw call rows (audited)
 *   - GET  /v1/admin/usage/status         -- fold freshness + hot-window settings
 *   - POST /v1/admin/usage/rollup/rebuild -- clear a bucket range and re-fold it
 *   - POST /v1/admin/usage/archive/prune  -- destroy archived rows before an explicit date
 * @usage
 *   import { adminUsageRouter } from './routes/admin-usage.js';
 *   app.use(adminUsageRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: the operator usage surface.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, UsageSurface, UsageOutcome } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import {
  readUsageReport, NODE_REPORTS, OWNER_REPORTS, UnknownReportError,
  usageComputedThrough, dayNDaysAgo,
} from '../services/usage/usage-read.js';
import { rebuildUsageRollup } from '../services/usage/rollup-engine.js';
import { recordUsageCall, pendingUsageCalls } from '../services/usage/usage-buffer.js';
import { logger } from '../utils/logger.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOT_DAYS = Number(process.env.AIMEAT_USAGE_HOT_DAYS) || 90;

export function adminUsageRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/admin/usage/summary ── node-wide, or scoped to one owner.
  //
  // `owner` is what makes this two endpoints in one: absent, it reads a cross-owner cut; present,
  // it reads the owner-scoped cut for that person. The operator role is the gate on BOTH — there is
  // no shape of this request a non-operator can reach.
  router.get('/v1/admin/usage/summary',
    requireAuth(), requireRole('operator'),
    async (req: Request, res: Response) => {
      const report = typeof req.query.report === 'string' ? req.query.report : 'day';
      const owner = typeof req.query.owner === 'string' && req.query.owner ? req.query.owner : null;
      const from = typeof req.query.from === 'string' ? req.query.from : dayNDaysAgo(30);
      const to = typeof req.query.to === 'string' ? req.query.to : dayNDaysAgo(0);
      if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'from and to must be YYYY-MM-DD'));
      }
      const grain = req.query.grain === 'hour' ? 'hour' : 'day';

      try {
        const data = await readUsageReport(storage, {
          report,
          scope: owner ? 'owner' : 'node',
          // A bare owner name and a full GHII both work; the operator types whichever they have.
          ownerGhii: owner ? (owner.includes('@') ? owner : `${owner}@${config.nodeId}`) : undefined,
          from, to, grain,
          series: req.query.series !== 'false',
          limit: Number(req.query.limit) || undefined,
        });
        res.json(success(config.nodeId, data, [
          { description: 'Raw calls behind these numbers', method: 'GET', url: '/v1/admin/usage/calls' },
          { description: 'How fresh the serving layer is', method: 'GET', url: '/v1/admin/usage/status' },
        ]));
      } catch (err) {
        if (err instanceof UnknownReportError) {
          return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', err.message));
        }
        throw err;
      }
    });

  // ── GET /v1/admin/usage/reports ── what may be asked for, in both scopes.
  router.get('/v1/admin/usage/reports',
    requireAuth(), requireRole('operator'),
    (_req: Request, res: Response) => {
      res.json(success(config.nodeId, {
        node: Object.keys(NODE_REPORTS),
        per_owner: Object.keys(OWNER_REPORTS),
        note: 'Pass ?owner=<name|ghii> to read a per_owner report for one person; omit it for a node report.',
      }));
    });

  // ── GET /v1/admin/usage/calls ── the raw drill. Audited, because this is where an operator reads
  // one identifiable person's activity.
  router.get('/v1/admin/usage/calls',
    requireAuth(), requireRole('operator'),
    async (req: Request, res: Response) => {
      const ownerParam = typeof req.query.owner === 'string' && req.query.owner ? req.query.owner : '';
      const ownerGhii = ownerParam
        ? (ownerParam.includes('@') ? ownerParam : `${ownerParam}@${config.nodeId}`)
        : undefined;
      const filter = {
        ownerGhii,
        actorGaii: typeof req.query.actor === 'string' ? req.query.actor : undefined,
        surface: typeof req.query.surface === 'string' ? req.query.surface as UsageSurface : undefined,
        appId: typeof req.query.app_id === 'string' ? req.query.app_id : undefined,
        outcome: typeof req.query.outcome === 'string' ? req.query.outcome as UsageOutcome : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        limit: Number(req.query.limit) || 200,
      };

      const stored = await storage.listUsageCalls(filter);
      // Reader and writer share a process, so a call made seconds ago is shown rather than made to
      // wait out a flush interval. An operator who cannot see the event they are investigating
      // reasonably concludes the system is not recording it.
      const buffered = pendingUsageCalls(filter);
      const calls = [...buffered, ...stored]
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, Math.min(Math.max(filter.limit, 1), 2000));

      // The audit row. Written BEFORE the response is sent, so an inspection cannot be performed
      // and then have its record fail to exist because the operator disconnected.
      const operatorGhii = ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));
      recordUsageCall({
        ownerGhii: operatorGhii,
        actorGaii: operatorGhii,
        actorKind: 'operator',
        surface: 'operator',
        coordinate: 'usage.calls',
        counterpartyGhii: ownerGhii ?? '',
        outcome: 'ok',
        meta: { inspected: ownerGhii ?? '(all owners)', returned: calls.length, from: filter.from, to: filter.to },
      });
      logger.info('admin-usage: operator read raw calls', {
        operator: operatorGhii, inspected: ownerGhii ?? '(all owners)', returned: calls.length,
      });

      res.json(success(config.nodeId, {
        count: calls.length,
        hot_window_days: HOT_DAYS,
        note: `Raw calls are kept ${HOT_DAYS} days here; older ones are in the archive and are not served by this endpoint.`,
        audited: true,
        calls,
      }));
    });

  // ── GET /v1/admin/usage/status ── how fresh the serving layer is, and what the windows are.
  router.get('/v1/admin/usage/status',
    requireAuth(), requireRole('operator'),
    async (_req: Request, res: Response) => {
      const [llm, call, computedThrough] = await Promise.all([
        storage.getUsageCursor('llm'),
        storage.getUsageCursor('call'),
        usageComputedThrough(storage),
      ]);
      res.json(success(config.nodeId, {
        computed_through: computedThrough,
        streams: {
          llm: llm ? { last_ts: llm.lastTs, updated_at: llm.updatedAt } : null,
          call: call ? { last_ts: call.lastTs, updated_at: call.updatedAt } : null,
        },
        hot_window_days: HOT_DAYS,
        hour_rollup_days: Number(process.env.AIMEAT_USAGE_HOUR_ROLLUP_DAYS) || 30,
      }));
    });

  // ── GET /v1/admin/usage/house ── the money question, answered in one read.
  //
  // WHAT AN OPERATOR ACTUALLY WANTS TO KNOW and could not find anywhere: is the house key set, what
  // does the house grant a newcomer, how much of the spend is the house's rather than people's own
  // keys, and — the one nobody could see at all — which spending is NOT metered here.
  //
  // The split is `apiKeyScope`, the same field the monthly billing rollup splits on: `own` is the
  // person's own OpenRouter account and costs the operator nothing, `node` is the house key. The
  // chat agent is reported beside them and deliberately NOT summed with them: it is a `goose acp`
  // child with one process-wide provider key, so its turns never pass prepareAiCall, never land in
  // the ledger, and are invisible to every figure on this page. Stating that plainly here is the
  // difference between an operator who knows their exposure is bounded by the key's own cap and one
  // who thinks these totals are the whole bill.
  router.get('/v1/admin/usage/house',
    requireAuth(), requireRole('operator'),
    async (req: Request, res: Response) => {
      const to = typeof req.query.to === 'string' ? req.query.to : dayNDaysAgo(0);
      const from = typeof req.query.from === 'string' ? req.query.from : dayNDaysAgo(29);

      const rows = await storage.queryUsageDailyAllOwners({ from, to });
      const scopes: Record<string, { cost_usd: number; calls: number; owners: Set<string> }> = {
        node: { cost_usd: 0, calls: 0, owners: new Set() },
        own: { cost_usd: 0, calls: 0, owners: new Set() },
      };
      const nodeByOwner = new Map<string, { owner_ghii: string; cost_usd: number; calls: number }>();
      for (const r of rows) {
        const bucket = scopes[r.apiKeyScope === 'node' ? 'node' : 'own'];
        bucket.cost_usd += r.costUsd || 0;
        bucket.calls += r.calls || 0;
        bucket.owners.add(r.ownerGhii);
        if (r.apiKeyScope !== 'node') continue;
        const seen = nodeByOwner.get(r.ownerGhii)
          ?? { owner_ghii: r.ownerGhii, cost_usd: 0, calls: 0 };
        seen.cost_usd += r.costUsd || 0;
        seen.calls += r.calls || 0;
        nodeByOwner.set(r.ownerGhii, seen);
      }

      res.json(success(config.nodeId, {
        from,
        to,
        house_key_configured: !!config.openrouterInstanceKey,
        free_allowance_usd: config.chatFreeAllowanceUsd,
        free_fallback_model: config.modelFreeFallback || null,
        by_key_scope: {
          node: { cost_usd: scopes.node.cost_usd, calls: scopes.node.calls, people: scopes.node.owners.size },
          own: { cost_usd: scopes.own.cost_usd, calls: scopes.own.calls, people: scopes.own.owners.size },
        },
        top_house_spenders: [...nodeByOwner.values()]
          .sort((a, b) => b.cost_usd - a.cost_usd)
          .slice(0, 10),
        chat_agent: {
          enabled: !!(config.gooseBin || '').trim(),
          model: config.gooseModel || null,
          key_configured: !!config.gooseProviderApiKey,
          // The honest half. Everything above is metered per person; this is not.
          metered_here: false,
        },
      }));
    });

  // ── POST /v1/admin/usage/rollup/rebuild ── recompute a bucket range from raw.
  //
  // Needed after a new cut is declared (its history is otherwise empty, which on a chart is
  // indistinguishable from "this was never used"). Clears the range first, because the fold ADDS.
  router.post('/v1/admin/usage/rollup/rebuild',
    requireAuth(), requireRole('operator'),
    async (req: Request, res: Response) => {
      const from = typeof req.body?.from === 'string' ? req.body.from : '';
      if (!ISO_DAY.test(from)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'from is required, as YYYY-MM-DD'));
      }
      const hotStart = dayNDaysAgo(HOT_DAYS);
      if (from < hotStart) {
        // Refuse before doing anything. A rebuild reaching past the hot window would DELETE rollup
        // rows it then cannot refill, because the raw behind them is in the archive — turning a
        // correction into permanent data loss. Named rather than silently clamped, so the operator
        // decides what they actually want.
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `Raw data only goes back to ${hotStart} (${HOT_DAYS}-day hot window). Rebuilding from ${from} would delete rollups that cannot be recomputed.`));
      }

      const grain = req.body?.grain === 'hour' ? 'hour' : req.body?.grain === 'day' ? 'day' : undefined;
      const result = await rebuildUsageRollup(storage, { from, grain });
      logger.info('admin-usage: rollup rebuilt', { from, grain: grain ?? 'all', cleared: result.cleared });
      res.json(success(config.nodeId, {
        from, grain: grain ?? 'all',
        cleared_rows: result.cleared,
        folded: result.folded,
      }));
    });

  // ── POST /v1/admin/usage/archive/prune ── destroy archived rows before a date.
  //
  // Deliberately NOT a scheduled job. These rows are what answers a billing dispute or a legal
  // question months later, and a cron that quietly destroys them is a cron nobody remembers
  // approving. The date is required and is never defaulted.
  router.post('/v1/admin/usage/archive/prune',
    requireAuth(), requireRole('operator'),
    async (req: Request, res: Response) => {
      const before = typeof req.body?.before === 'string' ? req.body.before : '';
      if (!ISO_DAY.test(before)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          'before is required, as YYYY-MM-DD. This destroys archived usage records and is never defaulted.'));
      }
      if (req.body?.confirm !== true) {
        return res.status(400).json(error(config.nodeId, 'CONFIRMATION_REQUIRED',
          `This permanently deletes archived usage records before ${before}. Repeat with confirm: true.`));
      }
      const deleted = await storage.pruneUsageArchive(`${before}T00:00:00.000Z`);
      logger.warn('admin-usage: archive pruned by operator', {
        before, calls: deleted.usageCalls, events: deleted.usageEvents,
      });
      res.json(success(config.nodeId, { before, deleted }));
    });

  return router;
}
