/**
 * @file schedules.ts
 * @description Owner-facing REST API for recurring agent/profile schedules. The
 *   server owns the clock (reuses the Scheduler + ScheduledJobRecord); this
 *   router lets the owner (and same-owner agents) create/list/edit/pause/cancel
 *   schedules and trigger them now. Three kinds are supported:
 *     - extension  : run an installed extension action (zero-token)
 *     - ai         : server-side OpenRouter completion over predefined memory keys
 *     - agent_task : materialise a task into an agent's queue on each fire
 *   GET /v1/schedules also aggregates the owner's extension cron jobs and each
 *   agent's self-reported internal scheduler (agents.<name>.scheduler) for the
 *   master Profile › Scheduler view.
 * @structure
 *   - GET    /v1/schedules                  master aggregate (managed + ext + agent-internal)
 *   - POST   /v1/schedules                  create (profile-level or agent-targeted)
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
 *   v1.0.0 — 2026-06-03 — Initial: agent/profile recurring schedules
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord, ScheduleConstraint, AgentTaskScope } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { mergeConstraintDefaults, knownConstraintTypes } from '../services/schedule-constraints.js';
import { logger } from '../utils/logger.js';

type ScheduleKind = 'extension' | 'ai' | 'agent_task';
const VALID_KINDS: ScheduleKind[] = ['extension', 'ai', 'agent_task'];

/** Validate a cron expression (or the @activate sentinel) using croner. */
function isValidCron(cron: string, timezone?: string): boolean {
  if (cron === '@activate') return true;
  try {
    const opts: { timezone?: string; paused?: boolean } = { paused: true };
    if (timezone) opts.timezone = timezone;
    const c = new Cron(cron, opts);
    const ok = !!c.nextRun();
    c.stop();
    return ok;
  } catch {
    return false;
  }
}

/** Normalise a constraints array from the request body (drop unknown types). */
function sanitizeConstraints(raw: unknown): ScheduleConstraint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const known = new Set(knownConstraintTypes());
  const out: ScheduleConstraint[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const type = (c as { type?: string }).type;
    if (!type || !known.has(type)) continue;
    out.push({
      type,
      enabled: (c as { enabled?: boolean }).enabled === true,
      params: ((c as { params?: Record<string, unknown> }).params) ?? {},
      state: (c as { state?: Record<string, unknown> }).state,
    });
  }
  return out.length ? out : undefined;
}

export function schedulesRouter(config: AimeatConfig, storage: Storage, scheduler: Scheduler): Router {
  const router = Router();

  const ownerGhii = (req: Express.Request) => `${req.auth!.owner}@${config.nodeId}`;
  const isOwnerSession = (req: Express.Request) =>
    req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');

  /** Owner manages every schedule it owns; agents only their own (same owner). */
  function canManage(req: Express.Request, job: ScheduledJobRecord): boolean {
    if (job.ownerScope !== ownerGhii(req)) return false;
    if (isOwnerSession(req)) return true;
    // Agent session: only schedules it created.
    return job.createdByAgent === true;
  }

  /** Read an agent's self-reported internal scheduler mirror (display-only). */
  async function readAgentInternal(agentName: string, agentGaii: string): Promise<unknown[]> {
    const rec = await storage.getMemory(agentGaii, `agents.${agentName}.scheduler`);
    const val = rec?.value as { entries?: unknown[] } | undefined;
    return Array.isArray(val?.entries) ? val!.entries! : [];
  }

  /** Build a ScheduledJobRecord from a create body. Returns {record} or {error}. */
  async function buildRecordFromBody(
    req: Request, body: Record<string, unknown>, forcedAgentName?: string,
  ): Promise<{ record?: ScheduledJobRecord; status?: number; code?: string; message?: string }> {
    const owner = ownerGhii(req);
    const kind = body.kind as ScheduleKind;
    if (!VALID_KINDS.includes(kind)) {
      return { status: 400, code: 'INVALID_KIND', message: `kind must be one of: ${VALID_KINDS.join(', ')}` };
    }
    const cron = typeof body.cron === 'string' ? body.cron : '';
    const timezone = typeof body.timezone === 'string' ? body.timezone : undefined;
    if (!cron || !isValidCron(cron, timezone)) {
      return { status: 400, code: 'INVALID_CRON', message: 'cron is missing or invalid' };
    }

    // Target agent = the path param when present, else a body field. Accept
    // agent_name / target_agent / agent as aliases (target_agent mirrors the MCP
    // tool's field) so the same payload works across REST and MCP. The target is
    // resolved under the CALLER'S owner, so any same-owner agent's token can
    // schedule any sibling agent — no token-borrowing needed; createdBy still
    // records the real creator.
    const bodyAgent = ['agent_name', 'target_agent', 'agent'].reduce(
      (acc, k) => acc ?? (typeof body[k] === 'string' ? (body[k] as string) : undefined),
      undefined as string | undefined,
    );
    const agentName = forcedAgentName ?? bodyAgent;
    let agentGaii: string | undefined;
    if (agentName) {
      agentGaii = buildGAII(agentName, req.auth!.owner as string, config.nodeId);
      const agent = await storage.getAgent(agentGaii);
      if (!agent) return { status: 404, code: 'AGENT_NOT_FOUND', message: `Agent "${agentName}" not found` };
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const displayName = (typeof body.display_name === 'string' && body.display_name.trim())
      || (typeof body.title === 'string' ? body.title : '') || `${kind} schedule`;

    const base: ScheduledJobRecord = {
      id,
      name: `schedule:${id}`,
      type: kind,
      cron,
      enabled: body.enabled !== false,
      createdBy: resolveIdentity(req.auth!, config.nodeId),
      createdAt: now,
      updatedAt: now,
      ownerScope: owner,
      agentName,
      agentGaii,
      // True whenever a non-owner (agent) session created it — used by canManage so
      // the creating agent can manage its own schedules. Derived from session type
      // (not a literal 'agent' role, which agent tokens don't always carry).
      createdByAgent: !isOwnerSession(req),
      displayName: displayName.slice(0, 200),
      description: typeof body.description === 'string' ? body.description.slice(0, 2000) : undefined,
      purpose: typeof body.purpose === 'string' ? body.purpose.slice(0, 500) : undefined,
      timezone,
      runCount: 0,
    };

    // Inherit the agent's default budget guards for any guard the body omits.
    const bodyConstraints = sanitizeConstraints(body.constraints);
    const agentDefaults = agentGaii ? (await storage.getAgent(agentGaii))?.scheduleConstraintDefaults : undefined;
    base.constraints = mergeConstraintDefaults(bodyConstraints, agentDefaults);

    if (kind === 'extension') {
      const extensionName = typeof body.extension_name === 'string' ? body.extension_name : '';
      const actionId = typeof body.action_id === 'string' ? body.action_id : '';
      if (!extensionName || !actionId) {
        return { status: 400, code: 'INVALID_EXTENSION_JOB', message: 'extension_name and action_id are required for extension schedules' };
      }
      const ext = await storage.getExtension(extensionName);
      if (!ext) return { status: 404, code: 'EXTENSION_NOT_FOUND', message: `Extension "${extensionName}" not found` };
      base.extensionName = extensionName;
      base.actionId = actionId;
      if (typeof body.instance_id === 'string') base.instanceId = body.instance_id;
      if (body.input && typeof body.input === 'object') base.input = body.input as Record<string, unknown>;
    } else if (kind === 'ai') {
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (!prompt) return { status: 400, code: 'INVALID_AI_JOB', message: 'prompt is required for ai schedules' };
      base.input = {
        inputKeys: Array.isArray(body.input_keys) ? body.input_keys : [],
        inputNamespaces: Array.isArray(body.input_namespaces) ? body.input_namespaces : undefined,
        prompt,
        systemPrompt: typeof body.system_prompt === 'string' ? body.system_prompt : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        outputKey: typeof body.output_key === 'string' ? body.output_key : undefined,
        outputVisibility: typeof body.output_visibility === 'string' ? body.output_visibility : 'private',
      };
    } else if (kind === 'agent_task') {
      if (!agentName || !agentGaii) {
        return { status: 400, code: 'AGENT_REQUIRED', message: 'agent_name is required for agent_task schedules' };
      }
      // Accept either nested task_template.{title,description} or flat
      // task_title / task_description (mirrors the MCP tool's flat fields).
      const tmpl = body.task_template as Record<string, unknown> | undefined;
      const title = (tmpl && typeof tmpl.title === 'string' ? tmpl.title : '')
        || (typeof body.task_title === 'string' ? body.task_title : '');
      if (!title) return { status: 400, code: 'INVALID_TASK_TEMPLATE', message: 'task_template.title (or task_title) is required for agent_task schedules' };
      const v = (tmpl?.verification ?? {}) as { user_expects?: string; technical_checks?: string[] };
      const flatDesc = typeof body.task_description === 'string' ? body.task_description : '';
      base.input = {
        taskTemplate: {
          title,
          description: typeof tmpl?.description === 'string' ? tmpl.description : flatDesc,
          scope: Array.isArray(tmpl?.scope) ? (tmpl!.scope as AgentTaskScope[]) : [],
          rules: Array.isArray(tmpl?.rules) ? tmpl!.rules : [],
          verification: {
            userExpects: typeof v.user_expects === 'string' ? v.user_expects : '',
            technicalChecks: Array.isArray(v.technical_checks) ? v.technical_checks : [],
          },
          resources: tmpl?.resources,
        },
      };
    }

    return { record: base };
  }

  async function createSchedule(req: Request, res: Response, forcedAgentName?: string): Promise<void> {
    const built = await buildRecordFromBody(req, (req.body ?? {}) as Record<string, unknown>, forcedAgentName);
    if (!built.record) {
      res.status(built.status ?? 400).json(error(config.nodeId, built.code ?? 'INVALID_BODY', built.message ?? 'Invalid request'));
      return;
    }
    const created = await storage.createScheduledJob(built.record);
    if (created.enabled) scheduler.addJob(created);
    res.status(201).json(success(config.nodeId, { schedule: created }));
    emitChange('scheduler');
  }

  // ── GET /v1/schedules — master aggregate ──
  router.get('/v1/schedules', requireAuth(), async (req, res) => {
    try {
      const owner = ownerGhii(req);
      const ownerName = req.auth!.owner as string;

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

      res.json(success(config.nodeId, {
        managed,
        extensions,
        agentInternal: agentInternal.filter(a => a.entries.length > 0),
      }));
    } catch (err) {
      logger.error('Failed to aggregate schedules', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to load schedules'));
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
    const job = await storage.getScheduledJob(id);
    if (!job) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Schedule "${id}" not found`)); return; }
    if (!canManage(req, job)) { res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not allowed to edit this schedule')); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Partial<ScheduledJobRecord> = { updatedAt: new Date().toISOString() };
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
    if (typeof body.cron === 'string') {
      const tz = typeof body.timezone === 'string' ? body.timezone : job.timezone;
      if (!isValidCron(body.cron, tz)) { res.status(400).json(error(config.nodeId, 'INVALID_CRON', 'cron is invalid')); return; }
      updates.cron = body.cron;
    }
    if (typeof body.timezone === 'string') updates.timezone = body.timezone;
    if (typeof body.display_name === 'string') updates.displayName = body.display_name.slice(0, 200);
    if (typeof body.description === 'string') updates.description = body.description.slice(0, 2000);
    if (typeof body.purpose === 'string') updates.purpose = body.purpose.slice(0, 500);
    if (body.constraints !== undefined) updates.constraints = sanitizeConstraints(body.constraints);
    if (body.input && typeof body.input === 'object') updates.input = body.input as Record<string, unknown>;

    const updated = await storage.updateScheduledJob(id, updates);
    await scheduler.reschedule(id);
    res.json(success(config.nodeId, { schedule: updated }));
    emitChange('scheduler');
  });

  // ── DELETE /v1/schedules/:id — cancel ──
  router.delete('/v1/schedules/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const job = await storage.getScheduledJob(id);
    if (!job) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Schedule "${id}" not found`)); return; }
    if (!canManage(req, job)) { res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not allowed to delete this schedule')); return; }
    scheduler.removeJob(id);
    await storage.deleteScheduledJob(id);
    res.json(success(config.nodeId, { deleted: id }));
    emitChange('scheduler');
  });

  // ── POST /v1/schedules/:id/trigger — run now ──
  router.post('/v1/schedules/:id/trigger', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const job = await storage.getScheduledJob(id);
    if (!job) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Schedule "${id}" not found`)); return; }
    if (!canManage(req, job)) { res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not allowed to trigger this schedule')); return; }
    try {
      const outcome = await scheduler.triggerNow(id);
      const updated = await storage.getScheduledJob(id);
      // Relay what actually happened so the UI can tell the owner whether a task
      // was created and, if not, why (e.g. a previous run is still active).
      res.json(success(config.nodeId, {
        triggered: true,
        outcome: outcome.code,
        ...(outcome.taskId ? { task_id: outcome.taskId } : {}),
        ...(outcome.detail ? { reason: outcome.detail } : {}),
        schedule: updated,
      }));
      emitChange('scheduler');
    } catch (err) {
      res.status(500).json(error(config.nodeId, 'TRIGGER_FAILED', `Run failed: ${(err as Error).message}`));
    }
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
