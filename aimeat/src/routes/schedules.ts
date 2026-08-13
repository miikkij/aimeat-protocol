/**
 * @file schedules.ts
 * @description Owner-facing REST API for recurring agent/profile schedules. The
 *   server owns the clock (reuses the Scheduler + ScheduledJobRecord); this
 *   router lets the owner (and same-owner agents) create/list/edit/pause/cancel
 *   schedules and trigger them now. Four kinds are supported:
 *     - extension       : run an installed extension action (zero-token)
 *     - ai              : server-side OpenRouter completion over predefined memory keys
 *     - agent_task      : materialise a task into an agent's queue on each fire
 *     - eco-capability  : invoke a connected ecosystem app's capability over the connect-tunnel
 *     - connections-publish : post to one of the owner's OWN connected accounts. A one-shot
 *       ("publish on Tuesday at 09:00") is this kind plus a max_runs:1 constraint — the clock, the
 *       DST-correct timezone, the run log and /occurrences all come from this same machinery, so
 *       there is no separate publish queue.
 *   GET /v1/schedules also aggregates the owner's extension cron jobs and each
 *   agent's self-reported internal scheduler (agents.<name>.scheduler) for the
 *   master Profile › Scheduler view.
 * @structure
 *   - GET    /v1/schedules                  master aggregate (managed + ext + agent-internal)
 *   - POST   /v1/schedules                  create (profile-level or agent-targeted)
 *   - GET    /v1/schedules/occurrences      project enabled crons into a [from,to] window (calendar)
 *   - GET    /v1/schedules/:id              detail + recent execution log
 *   - PATCH  /v1/schedules/:id              edit cron/enabled/constraints/input/...
 *   - DELETE /v1/schedules/:id              cancel (owner can delete agent-created)
 *   - POST   /v1/schedules/:id/trigger      run now
 *   - GET    /v1/agents/:name/schedules     per-agent view (managed + that agent's mirror)
 *   - POST   /v1/agents/:name/schedules     create targeting this agent
 * @usage
 *   import { schedulesRouter } from './routes/schedules.js';
 *   app.use(schedulesRouter(config, storage, scheduler));
 * @version-history
 *   v1.7.0 — 2026-08-13 — "Run now" moved to services/schedule-write.ts alongside create, edit and
 *     cancel, and this route calls it. It was the last schedule operation that existed on HTTP only,
 *     which is why an agent could set up a morning job and had no way to prove it worked.
 *   v1.6.0 — 2026-08-11 — August 2026 audit step 8: the record build, the per-kind input checks and the
 *     write moved to services/schedule-write.ts, which the MCP schedule tools now call too. They built
 *     their own record next to this one and the two had drifted: no length cut on description/purpose,
 *     no cron validation on edit, and a target-agent check for one kind only.
 *   v1.4.0 — 2026-08-10 — Security audit C-2: an `ai` schedule's `input_namespaces` may only name the
 *     owner's own identities, checked on create and on patch. The executor reads each namespace with
 *     the raw composite-key lookup and pastes the value into the prompt, so an unchecked entry was a
 *     verbatim cross-owner read of private memory by anyone who could register an account.
 *   v1.3.0 — 2026-07-27 — Only the extension's owner may put its actions on a clock: the scheduler runs
 *     as a system caller, so a cron on someone else's extension is a standing unpriced call on their
 *     capability with no door where a price could be asked.
 *   v1.2.0 — 2026-07-16 — Add GET /v1/scheduler/tab composite (schedule aggregate + agent names) folding
 *     the Scheduler mount; extracted aggregateSchedules shared with GET /v1/schedules (behavior unchanged).
 *   v1.1.0 — 2026-07-16 — buildRecordFromBody reuses the loaded agent record (was getAgent twice)
 *   v1.0.0 — 2026-06-03 — Initial: agent/profile recurring schedules
 *   v1.1.0 — 2026-06-15 — Add the `eco-capability` kind: schedule a connected ecosystem app's
 *     capability; validates the app is connected and the capability is declared.
 *   v1.2.0 — 2026-06-24 — Add the `secretary` kind (Secretary Phase 4 autonomous tick); no extra body
 *     fields — the executor reads the owner's secretary.config at fire time.
 *   v1.3.0 — 2026-07-03 — Add GET /v1/schedules/occurrences: projects each enabled, cron-bearing schedule
 *     (managed + owner-installed extension crons) into a [from,to] window via croner, so the Profile ›
 *     Scheduler calendar can show day/week/month cadence. Window clamped to ~2 months; per-schedule and
 *     total occurrence caps guard against sub-minute crons; returns { occurrences:[{scheduleId,at}], truncated }.
 *   v1.5.0 — 2026-08-02 — Add the `connections-publish` kind (LÄHETIN): post to one of the owner's OWN
 *     connected accounts on this scheduler's clock. Deliberately a KIND rather than a second queue —
 *     the durable job row, the DST-correct IANA timezone, the one-shot (max_runs:1 auto-disable), the
 *     execution log, /occurrences and the whole REST surface already exist here. Validated at CREATE
 *     time (connection is yours and active, a named file exists), because discovering either at 07:00
 *     is a post that never appears with nobody awake to see why. Needs `connections:use`.
 *   v1.4.0 — 2026-07-17 — /occurrences now splits schedules by cadence: continuous / high-frequency crons
 *     (≥ ~6 fires/day, from the median gap of the first fire-times) are summarized in a new `frequent`
 *     array ({scheduleId, cron, intervalMinutes, approxPerDay}) instead of enumerated, so per-minute /
 *     hourly jobs no longer flood the grid or exhaust the occurrence cap and hide the daily+ events.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { Cron } from 'croner';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII, resolveIdentity } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { createScheduleRecord, updateScheduleRecord, deleteScheduleRecord, triggerScheduleRecord } from '../services/schedule-write.js';
import type { ScheduleWriteCaller } from '../services/schedule-write.js';

// The record build, the per-kind input checks and the write moved to services/schedule-write.ts on
// 2026-08-11, so the MCP tools that create, edit and cancel schedules produce the same record this
// router does. The scope-and-cron gate sits in services/schedule-gate.ts, called from there. What is
// left here is HTTP: reading the request and rendering the envelope.

/** Parse a query timestamp: absent → fallback, invalid → null (caller 400s). */
function parseWhen(q: unknown, fallback: Date): Date | null {
  if (q == null || q === '') return fallback;
  const s = Array.isArray(q) ? q[0] : q;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function schedulesRouter(config: AimeatConfig, storage: Storage, scheduler: Scheduler): Router {
  const router = Router();

  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;
  const isOwnerSession = (req: Express.Request) =>
    req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');

  /** This session in the terms services/schedule-write.ts speaks. */
  const writeCaller = (req: Express.Request): ScheduleWriteCaller => ({
    owner: req.auth!.owner as string,
    identity: resolveIdentity(req.auth!, config.nodeId),
    isOwnerSession: isOwnerSession(req),
    scopes: req.auth!.scopes ?? [],
  });

  /** Read an agent's self-reported internal scheduler mirror (display-only). */
  async function readAgentInternal(agentName: string, agentGaii: string): Promise<unknown[]> {
    const rec = await storage.getMemory(agentGaii, `agents.${agentName}.scheduler`);
    const val = rec?.value as { entries?: unknown[] } | undefined;
    return Array.isArray(val?.entries) ? val!.entries! : [];
  }

  async function createSchedule(req: Request, res: Response, forcedAgentName?: string): Promise<void> {
    const out = await createScheduleRecord(
      { storage, config, scheduler }, writeCaller(req),
      (req.body ?? {}) as Record<string, unknown>, forcedAgentName,
    );
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.status(201).json(success(config.nodeId, { schedule: out.schedule }));
  }

  // Master schedule aggregate — managed jobs + the owner's extension cron jobs + each agent's
  // self-reported internal scheduler. Also returns the resolved agents so a caller can reuse them without
  // a second getAgentsByOwner. Shared by GET /v1/schedules and the /v1/scheduler/tab composite.
  async function aggregateSchedules(owner: string, ownerName: string) {
    const managed = await storage.listScheduledJobs({ ownerScope: owner });
    const managedIds = new Set(managed.map(j => j.id));

    // Owner's extension cron jobs not already captured as managed schedules.
    const allExtJobs = await storage.listScheduledJobs({ type: 'extension' });
    const extensions: ScheduledJobRecord[] = [];
    for (const job of allExtJobs) {
      if (managedIds.has(job.id)) continue;
      if (job.ownerScope === owner) { extensions.push(job); continue; }
      if (!job.extensionName) continue;
      const ext = await storage.getExtension(job.extensionName);
      if (ext?.installedBy === ownerName) extensions.push(job);
    }

    // Each agent's self-reported internal scheduler (display-only mirror).
    const agents = await storage.getAgentsByOwner(ownerName);
    const agentInternal = await Promise.all(agents.map(async a => ({
      agentName: a.name,
      gaii: a.gaii,
      entries: await readAgentInternal(a.name, a.gaii),
    })));

    return {
      agents,
      schedules: {
        managed,
        extensions,
        agentInternal: agentInternal.filter(a => a.entries.length > 0),
      },
    };
  }

  // ── GET /v1/schedules — master aggregate ──
  router.get('/v1/schedules', requireAuth(), async (req, res) => {
    try {
      const { schedules } = await aggregateSchedules(ownerGhii(req), req.auth!.owner as string);
      res.json(success(config.nodeId, schedules));
    } catch (err) {
      logger.error('Failed to aggregate schedules', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to load schedules'));
    }
  });

  // ── GET /v1/scheduler/tab — the Scheduler tab mount in ONE call: the schedule aggregate + the owner's
  // agent list (names, for the create-schedule dropdown). Folds GET /v1/schedules + GET /v1/agents,
  // resolving the owner's agents once. The calendar's occurrence projection stays a separate request (it
  // is range-driven — re-fetched as the user navigates day/week/month).
  router.get('/v1/scheduler/tab', requireAuth(), async (req, res) => {
    try {
      const { schedules, agents } = await aggregateSchedules(ownerGhii(req), req.auth!.owner as string);
      res.json(success(config.nodeId, {
        schedules,
        agents: agents.map(a => ({ name: a.name, gaii: a.gaii })),
      }));
    } catch (err) {
      logger.error('Failed to load scheduler tab', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to load scheduler tab'));
    }
  });

  // ── POST /v1/schedules — create (profile-level or agent-targeted) ──
  router.post('/v1/schedules', requireAuth(), async (req, res) => {
    try { await createSchedule(req, res); }
    catch (err) {
      logger.error('Failed to create schedule', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to create schedule'));
    }
  });

  // ── GET /v1/schedules/occurrences — project cron fire-times into a window ──
  // Powers the Profile › Scheduler calendar. Uses croner (the same library the
  // real Scheduler runs on) so projected times match what will actually fire —
  // timezone-accurate, no cron parser duplicated in the browser. Only enabled,
  // cron-bearing jobs the owner can see (managed + owner-installed extension
  // crons) are projected; the '@activate' sentinel has no recurring pattern and
  // is skipped. Must be registered BEFORE '/v1/schedules/:id' (static-before-param).
  router.get('/v1/schedules/occurrences', requireAuth(), async (req, res) => {
    try {
      const owner = ownerGhii(req);
      const ownerName = req.auth!.owner as string;
      const now = new Date();
      const from = parseWhen(req.query.from, now);
      const rawTo = parseWhen(req.query.to, new Date(now.getTime() + 7 * 86400000));
      if (!from || !rawTo || rawTo.getTime() <= from.getTime()) {
        res.status(400).json(error(config.nodeId, 'INVALID_RANGE', 'from/to must be valid timestamps with to > from'));
        return;
      }
      // Clamp the window so a huge range can't force unbounded enumeration
      // (~2 months covers the widest calendar view, the 42-day month grid).
      const MAX_WINDOW_MS = 62 * 86400000;
      const end = new Date(Math.min(rawTo.getTime(), from.getTime() + MAX_WINDOW_MS));

      // Cron-bearing jobs the owner can see: managed (ownerScope) + owner-installed
      // extension crons — mirrors the master GET /v1/schedules aggregation.
      const managed = await storage.listScheduledJobs({ ownerScope: owner });
      const managedIds = new Set(managed.map(j => j.id));
      const jobs: ScheduledJobRecord[] = [...managed];
      const allExtJobs = await storage.listScheduledJobs({ type: 'extension' });
      for (const job of allExtJobs) {
        if (managedIds.has(job.id)) continue;
        if (job.ownerScope === owner) { jobs.push(job); continue; }
        if (!job.extensionName) continue;
        const ext = await storage.getExtension(job.extensionName);
        if (ext?.installedBy === ownerName) jobs.push(job);
      }

      const PER_SCHEDULE = 366; // a year of daily runs; caps sub-daily crons
      const TOTAL_CAP = 2000;
      // Cadence split: a schedule firing at least this often is "continuous
      // background" — we summarize its cadence (in `frequent`) instead of
      // enumerating every fire-time, so per-minute / hourly crons don't flood the
      // calendar grid (nor exhaust TOTAL_CAP and hide the daily+ events beneath).
      const FREQUENT_MIN_PER_DAY = 6; // ≥ ~every 4h → the "Continuously running" strip
      const occurrences: { scheduleId: string; at: string }[] = [];
      // Continuous / high-frequency schedules, summarized rather than enumerated.
      const frequent: { scheduleId: string; cron: string; intervalMinutes: number; approxPerDay: number }[] = [];
      let truncated = false;
      for (const job of jobs) {
        if (job.enabled === false) continue;
        if (!job.cron || job.cron === '@activate') continue;
        let runs: Date[] = [];
        try {
          const opts: { timezone?: string; paused: boolean } = { paused: true };
          if (job.timezone) opts.timezone = job.timezone;
          const c = new Cron(job.cron, opts);
          runs = c.nextRuns(PER_SCHEDULE, from);
          c.stop();
        // eslint-disable-next-line aimeat/no-silent-catch -- cadence classification only: an expression that cannot be enumerated is skipped here and the schedule itself is untouched
        } catch { continue; }
        if (runs.length === 0) continue;

        // Classify cadence from the median gap of the first few fire-times
        // (median is robust to bursty multi-time crons like "0 7,19 * * *").
        let intervalMinutes = Infinity;
        if (runs.length >= 2) {
          const n = Math.min(runs.length, 7);
          const gaps: number[] = [];
          for (let i = 1; i < n; i++) gaps.push((runs[i].getTime() - runs[i - 1].getTime()) / 60000);
          gaps.sort((a, b) => a - b);
          intervalMinutes = gaps[Math.floor(gaps.length / 2)];
        }
        const approxPerDay = intervalMinutes === Infinity ? 0 : Math.round(1440 / intervalMinutes);

        // Continuous / high-frequency → summarize, don't enumerate (never capped:
        // there are only a handful, and the strip must list them all).
        if (approxPerDay >= FREQUENT_MIN_PER_DAY) {
          frequent.push({ scheduleId: job.id, cron: job.cron, intervalMinutes: Math.round(intervalMinutes), approxPerDay });
          continue;
        }

        // Scheduled cadence → enumerate into the visible window (respecting the cap).
        if (occurrences.length >= TOTAL_CAP) { truncated = true; continue; }
        let hitEnd = false;
        for (const r of runs) {
          if (r.getTime() > end.getTime()) { hitEnd = true; break; }
          occurrences.push({ scheduleId: job.id, at: r.toISOString() });
          if (occurrences.length >= TOTAL_CAP) { truncated = true; break; }
        }
        // Enumeration capped before reaching the window end → some runs are hidden.
        if (!hitEnd && runs.length >= PER_SCHEDULE) truncated = true;
      }

      res.json(success(config.nodeId, {
        occurrences,
        frequent,
        from: from.toISOString(),
        to: end.toISOString(),
        truncated,
      }));
    } catch (err) {
      logger.error('Failed to compute schedule occurrences', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to compute occurrences'));
    }
  });

  // ── GET /v1/schedules/:id — detail + recent runs ──
  router.get('/v1/schedules/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const job = await storage.getScheduledJob(id);
    if (!job || job.ownerScope !== ownerGhii(req)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Schedule "${id}" not found`));
      return;
    }
    const runs = await storage.listExecutionLogs({ jobId: id, limit: 20 });
    res.json(success(config.nodeId, { schedule: job, runs }));
  });

  // ── PATCH /v1/schedules/:id — edit ──
  router.patch('/v1/schedules/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const out = await updateScheduleRecord(
      { storage, config, scheduler }, writeCaller(req), id, (req.body ?? {}) as Record<string, unknown>,
    );
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, { schedule: out.schedule }));
  });

  // ── DELETE /v1/schedules/:id — cancel ──
  router.delete('/v1/schedules/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const out = await deleteScheduleRecord({ storage, config, scheduler }, writeCaller(req), id);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, { deleted: id }));
  });

  // ── POST /v1/schedules/:id/trigger — run now ──
  router.post('/v1/schedules/:id/trigger', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const out = await triggerScheduleRecord({ storage, config, scheduler }, writeCaller(req), id);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    // Relay what actually happened so the UI can tell the owner whether a task
    // was created and, if not, why (e.g. a previous run is still active).
    res.json(success(config.nodeId, {
      triggered: true,
      outcome: out.outcome.code,
      ...(out.outcome.taskId ? { task_id: out.outcome.taskId } : {}),
      ...(out.outcome.detail ? { reason: out.outcome.detail } : {}),
      schedule: out.schedule,
    }));
  });

  // ── GET /v1/agents/:name/schedules — per-agent view ──
  router.get('/v1/agents/:name/schedules', requireAuth(), async (req, res) => {
    try {
      const agentName = req.params.name as string;
      const agentGaii = buildGAII(agentName, req.auth!.owner as string, config.nodeId);
      const owner = ownerGhii(req);
      const all = await storage.listScheduledJobs({ ownerScope: owner });
      const managed = all.filter(j => j.agentGaii === agentGaii || j.agentName === agentName);
      const internal = await readAgentInternal(agentName, agentGaii);
      res.json(success(config.nodeId, { managed, agentInternal: internal }));
    } catch (err) {
      logger.error('Failed to list agent schedules', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to load agent schedules'));
    }
  });

  // ── POST /v1/agents/:name/schedules — create targeting this agent ──
  router.post('/v1/agents/:name/schedules', requireAuth(), async (req, res) => {
    try { await createSchedule(req, res, req.params.name as string); }
    catch (err) {
      logger.error('Failed to create agent schedule', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to create agent schedule'));
    }
  });

  return router;
}
