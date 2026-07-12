/**
 * @file ledger.ts
 * @description Owner-scoped read API for the agent LLM usage ledger (LEDGER / TARGET-016).
 *   Reads the daily aggregate rollup (fast, UI-facing) and the raw event stream (per-run
 *   drill-down to a deliverable). Every route scopes to `${req.auth.owner}@nodeId` — the human
 *   owner behind ANY session (owner, the owner's agent, or an app-grant token like AGENCY on the
 *   isolated app origin), strictly cross-owner. The FLEET reads (usage + budget) are app-grant
 *   accessible (mirrors GET /v1/agents); the sensitive billing export stays owner-only.
 *   Backs the AGENCY FLEET COST/USAGE tab.
 *
 *   This router is read-only. Usage is written by the ingest path (services/usage-metering.ts
 *   via the telemetry llm_call event); the backend never renders UI (protocol-only rule).
 * @structure
 *   - GET /v1/ledger/usage       — daily aggregates grouped by day|agent|model|provider|organism|workspace|scope
 *   - GET /v1/ledger/usage/runs  — raw events grouped by run_id (drill to a deliverable)
 *   - GET /v1/ledger/usage/capabilities — events grouped by capability, consumer/producer (TARGET-018)
 *   - GET /v1/ledger/budget      — spend vs daily budget + per-agent breakdown (TARGET-017)
 *   - GET /v1/ledger/billing     — owner monthly rollup, self-host/hosted split, CSV/JSON (TARGET-019)
 * @usage
 *   import { ledgerRouter } from './routes/ledger.js';
 *   app.use(ledgerRouter(config, storage));
 * @version-history
 *   v1.0.0 -- 2026-07-10 -- Initial creation for LEDGER TARGET-016 substrate
 *   v1.1.0 -- 2026-07-11 -- Add GET /v1/ledger/budget (TARGET-017 spend-vs-budget status)
 *   v1.2.0 -- 2026-07-11 -- Add GET /v1/ledger/usage/capabilities (TARGET-018 double-entry)
 *   v1.3.0 -- 2026-07-11 -- Add GET /v1/ledger/billing (TARGET-019 monthly rollup + CSV export)
 *   v1.4.0 -- 2026-07-11 -- FLEET reads scope by req.auth.owner (app-grant accessible for AGENCY);
 *                            billing export stays requireRole('owner').
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentUsageDailyRecord, AgentUsageEvent } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { getOwnerBudgetStatus } from '../services/ledger-budget.js';
import { getOwnerMonthlyBilling, billingToCsv } from '../services/ledger-billing.js';
import { getAdminLedger } from '../services/ledger-admin.js';

type GroupDim = 'day' | 'agent' | 'model' | 'provider' | 'organism' | 'workspace' | 'scope';

const GROUP_KEYS: Record<GroupDim, (r: AgentUsageDailyRecord) => string> = {
  day: r => r.date,
  agent: r => r.agentGaii,
  model: r => r.model,
  provider: r => r.provider,
  organism: r => r.organismId || '(unattributed)',
  workspace: r => r.workspaceId || '(unattributed)',
  scope: r => r.apiKeyScope,
};

interface Totals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  calls: number;
  unpriced_calls: number;
}

function emptyTotals(): Totals {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0, calls: 0, unpriced_calls: 0 };
}

function addDaily(t: Totals, r: AgentUsageDailyRecord): void {
  t.prompt_tokens += r.promptTokens;
  t.completion_tokens += r.completionTokens;
  t.total_tokens += r.promptTokens + r.completionTokens;
  t.cost_usd += r.costUsd;
  t.calls += r.calls;
  t.unpriced_calls += r.unpricedCalls;
}

/** YYYY-MM-DD `days` before today (UTC). */
function dateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ledgerRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  // The ledger is keyed by the human owner GHII (the payer). req.auth!.owner is the
  // server-trusted owner behind ANY session type — owner session, the owner's agent, or an
  // app-grant token (e.g. AGENCY on the isolated app origin). This mirrors GET /v1/agents,
  // so the FLEET reads work from the app grant while staying strictly cross-owner scoped.
  const resolve = (req: Request) => `${req.auth!.owner}@${config.nodeId}`;

  // ── GET /v1/ledger/usage ── daily aggregates, owner-scoped, grouped.
  router.get('/v1/ledger/usage',
    requireAuth(),
    async (req: Request, res: Response) => {
      const ownerGhii = resolve(req);
      const agentGaii = typeof req.query.agent === 'string' ? req.query.agent : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : dateNDaysAgo(30);
      const to = typeof req.query.to === 'string' ? req.query.to : dateNDaysAgo(0);
      const groupParam = typeof req.query.group_by === 'string' ? req.query.group_by : 'day';
      if (!(groupParam in GROUP_KEYS)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `group_by must be one of: ${Object.keys(GROUP_KEYS).join(', ')}`));
      }
      const groupBy = groupParam as GroupDim;

      const rows = await storage.queryUsageDaily({ ownerGhii, agentGaii, from, to });

      const keyOf = GROUP_KEYS[groupBy];
      const buckets = new Map<string, Totals>();
      const bucketProviders = new Map<string, Set<string>>();
      const totals = emptyTotals();
      for (const r of rows) {
        const k = keyOf(r);
        let b = buckets.get(k);
        if (!b) { b = emptyTotals(); buckets.set(k, b); }
        addDaily(b, r);
        addDaily(totals, r);
        // Track the distinct providers behind each group so the UI can show WHERE a model ran
        // (openrouter / nvidia / openai / anthropic / local …) — helps explain unpriced $0 rows.
        if (r.provider && r.provider !== 'unknown') {
          let ps = bucketProviders.get(k);
          if (!ps) { ps = new Set(); bucketProviders.set(k, ps); }
          ps.add(r.provider);
        }
      }

      const groups = [...buckets.entries()]
        .map(([key, t]) => ({ key, ...t, providers: [...(bucketProviders.get(key) ?? [])].sort() }))
        .sort((a, b) => (groupBy === 'day' ? a.key.localeCompare(b.key) : b.cost_usd - a.cost_usd));

      res.json(success(config.nodeId, {
        from, to, group_by: groupBy,
        agent: agentGaii ?? null,
        groups,
        totals,
      }));
    });

  // ── GET /v1/ledger/usage/runs ── raw events grouped by run, owner-scoped (drill to deliverable).
  router.get('/v1/ledger/usage/runs',
    requireAuth(),
    async (req: Request, res: Response) => {
      const ownerGhii = resolve(req);
      const agentGaii = typeof req.query.agent === 'string' ? req.query.agent : undefined;
      const runId = typeof req.query.run_id === 'string' ? req.query.run_id : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const limit = Number(req.query.limit);

      const events = await storage.listUsageEvents({
        ownerGhii, agentGaii, runId, from, to,
        limit: Number.isFinite(limit) ? limit : 200,
      });

      interface RunGroup {
        run_id: string;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        cost_usd: number;
        unpriced_calls: number;
        calls: number;
        models: string[];
        first_ts: string;
        last_ts: string;
      }
      const runs = new Map<string, RunGroup>();
      for (const e of events) {
        const key = e.runId ?? '(no run)';
        let g = runs.get(key);
        if (!g) {
          g = {
            run_id: key,
            prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0,
            unpriced_calls: 0, calls: 0, models: [], first_ts: e.ts, last_ts: e.ts,
          };
          runs.set(key, g);
        }
        g.prompt_tokens += e.promptTokens;
        g.completion_tokens += e.completionTokens;
        g.total_tokens += e.promptTokens + e.completionTokens;
        g.cost_usd += e.costUsd ?? 0;
        g.unpriced_calls += e.costUsd === null ? 1 : 0;
        g.calls += 1;
        if (!g.models.includes(e.model)) g.models.push(e.model);
        if (e.ts < g.first_ts) g.first_ts = e.ts;
        if (e.ts > g.last_ts) g.last_ts = e.ts;
      }

      const groups = [...runs.values()].sort((a, b) => b.last_ts.localeCompare(a.last_ts));
      res.json(success(config.nodeId, { count: events.length, runs: groups }));
    });

  // ── GET /v1/ledger/usage/capabilities ── raw events with a capabilityId, grouped by
  // capability (TARGET-018 double-entry). Owner-scoped to the PRODUCER: an owner sees, for
  // each of their capabilities, who invoked it (consumers) and the real compute cost — the
  // figure that sits next to the morsel escrow. Consumer-side cross-owner views come later
  // with the capability-invoke context wiring.
  router.get('/v1/ledger/usage/capabilities',
    requireAuth(),
    async (req: Request, res: Response) => {
      const ownerGhii = resolve(req);
      const capabilityId = typeof req.query.capability_id === 'string' ? req.query.capability_id : undefined;
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const limit = Number(req.query.limit);

      const events = await storage.listUsageEvents({
        ownerGhii, capabilityId, hasCapability: capabilityId ? undefined : true,
        from, to, limit: Number.isFinite(limit) ? limit : 500,
      });

      interface CapGroup {
        capability_id: string;
        cost_usd: number;
        total_tokens: number;
        calls: number;
        unpriced_calls: number;
        producers: string[];   // agent GAIIs that ran it
        consumers: string[];   // GHIIs that invoked it
        last_ts: string;
      }
      const caps = new Map<string, CapGroup>();
      for (const e of events) {
        const key = e.capabilityId!;
        let g = caps.get(key);
        if (!g) {
          g = {
            capability_id: key, cost_usd: 0, total_tokens: 0, calls: 0, unpriced_calls: 0,
            producers: [], consumers: [], last_ts: e.ts,
          };
          caps.set(key, g);
        }
        g.cost_usd += e.costUsd ?? 0;
        g.total_tokens += e.promptTokens + e.completionTokens;
        g.calls += 1;
        g.unpriced_calls += e.costUsd === null ? 1 : 0;
        if (!g.producers.includes(e.agentGaii)) g.producers.push(e.agentGaii);
        if (e.consumerGhii && !g.consumers.includes(e.consumerGhii)) g.consumers.push(e.consumerGhii);
        if (e.ts > g.last_ts) g.last_ts = e.ts;
      }

      const groups = [...caps.values()].sort((a, b) => b.cost_usd - a.cost_usd);
      res.json(success(config.nodeId, { count: events.length, capabilities: groups }));
    });

  // ── GET /v1/ledger/budget ── owner's spend-vs-budget status for a day (TARGET-017).
  // Backs FLEET's "budget and actual side by side". Reports only — never hard-stops runs.
  router.get('/v1/ledger/budget',
    requireAuth(),
    async (req: Request, res: Response) => {
      const ownerGhii = resolve(req);
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      const s = await getOwnerBudgetStatus(storage, ownerGhii, { date });
      const toSpend = (a: { agentGaii: string; costUsd: number; calls: number }) =>
        ({ agent_gaii: a.agentGaii, cost_usd: a.costUsd, calls: a.calls });
      res.json(success(config.nodeId, {
        date: s.date,
        daily_budget_usd: s.dailyBudgetUsd,
        spent_usd: s.spentUsd,
        remaining_usd: s.remainingUsd,
        ratio: s.ratio,
        level: s.level,
        thresholds: s.thresholds,
        per_agent: s.perAgent.map(toSpend),
        top_consumers: s.topConsumers.map(toSpend),
      }));
    });

  // ── GET /v1/ledger/billing ── owner monthly rollup, self-host/hosted split (TARGET-019).
  // ?format=csv streams an invoice-attachable CSV; default JSON. Meters only — no pricing.
  router.get('/v1/ledger/billing',
    requireAuth(), requireRole('owner'),
    async (req: Request, res: Response) => {
      const ownerGhii = resolve(req);
      const month = typeof req.query.month === 'string' ? req.query.month : undefined;
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'month must be YYYY-MM'));
      }
      const summary = await getOwnerMonthlyBilling(storage, ownerGhii, month);

      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="ledger-${summary.month}.csv"`);
        return res.send(billingToCsv(summary));
      }
      res.json(success(config.nodeId, summary));
    });

  // ── GET /v1/admin/ledger ── OPERATOR-ONLY cross-user aggregate (NOT owner-scoped).
  // requireRole('operator') gates the un-scoped cross-owner read (queryUsageDailyAllOwners).
  // Node-wide totals + per-day series + per-user "top spenders" + per-agent + per-model, so the
  // operator dashboard can show everyone's agent spend and drill per user → per agent.
  router.get('/v1/admin/ledger',
    requireAuth(),
    requireRole('operator'),
    async (req: Request, res: Response) => {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const data = await getAdminLedger(storage, { from, to });
      res.json(success(config.nodeId, data));
    });

  return router;
}
