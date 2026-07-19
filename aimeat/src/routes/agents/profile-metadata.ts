/**
 * @file src/routes/agents/profile-metadata.ts
 * @description Agent read + owner-managed metadata routes (public profile, list, tags, engagements, mode, concurrency, schedule constraints, heartbeat). Extracted from agents.ts to satisfy max-file-lines.
 * @version-history
 *   2026-07-19 — model/modelDetectedBy: indicative primary-LLM attribution on agents (AppDev KB Phase 3)
 *   v1.1.0 — 2026-07-16 — Engagements enrichment reads all orgs' workspace registries in ONE cross-owner
 *     key-IN query (getMemoryByKeysAnyOwner) instead of a listAllMemory scan per engagement org (Phase 3).
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { buildGAII } from '../../utils/gaii.js';
import { calculateTrustScore } from '../../services/trust.js';
import { emitChange } from '../../services/event-bus.js';
import { createDefaultSteps } from '../../models/agent-onboarding-schemas.js';
import { markAgentSeen } from '../../services/telemetry-buffer.js';
import { listByAgent as listEngagementsByAgent } from '../../services/workspace-engagements.js';
import { VALID_MODES } from './constants.js';

export function registerProfileMetadataRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // GET /v1/agents/:gaii — public agent profile (no auth)
  router.get('/v1/agents/:gaii', async (req, res) => {
    // GAII contains # and @ which need URL encoding
    const gaii = decodeURIComponent(req.params.gaii as string);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      // Check for redirect pointer (ported agent)
      const redirect = await storage.getMemory(gaii, '__redirect__');
      if (redirect && typeof redirect.value === 'object' && redirect.value !== null && 'target_node_url' in (redirect.value as Record<string, unknown>)) {
        const val = redirect.value as { target_node_url: string; target_node_id?: string; ported_at?: string };
        const location = `${val.target_node_url}/v1/agents/${encodeURIComponent(gaii)}`;
        res.setHeader('Location', location);
        res.status(301).json(success(config.nodeId, {
          ported: true,
          target_node_url: val.target_node_url,
          target_node_id: val.target_node_id,
          ported_at: val.ported_at,
          message: 'Agent has been ported. Follow the Location header.',
        }));
        return;
      }
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }

    const trust = await calculateTrustScore(gaii, storage);
    const actions = await storage.listActions();
    const actionsPublished = actions.filter(a => a.providerGaii === gaii).length;

    // Update cached trust score
    await storage.updateAgent(gaii, { trustScore: trust.score });

    res.json(success(config.nodeId, {
      gaii: agent.gaii,
      display_name: agent.displayName,
      description: agent.description,
      capabilities: agent.capabilities,
      trust: {
        '@type': 'schema:Rating',
        'schema:ratingValue': trust.score,
        'schema:bestRating': 100,
        'schema:worstRating': 0,
        score: trust.score,
        total_deliveries: trust.totalDeliveries,
        successful_deliveries: trust.successfulDeliveries,
        success_rate: trust.successRate,
        avg_delivery_time_seconds: trust.avgDeliveryTimeSeconds,
        positive_ratings: trust.positiveRatings,
        negative_ratings: trust.negativeRatings,
        age_days: trust.ageDays,
      },
      actions_published: actionsPublished,
      tags: agent.tags ?? [],
      semantic: agent.semantic,
      federate: agent.federate ?? false,
      home_node: config.nodeId,
      created_at: agent.createdAt,
      last_seen: agent.lastSeen,
    }, [
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
      { description: 'View node discovery info', method: 'GET', url: '/.well-known/aimeat' },
    ]));
  });

  // GET /v1/agents — list agents (auth required, returns own agents).
  // ?include=stats attaches a per-agent `stats` projection (task/message counts + latest
  // timestamps + active-task list + onboarding) computed in a few grouped queries, so a
  // fleet dashboard gets everything in ONE request instead of N+1 per-agent round trips.
  router.get('/v1/agents', requireAuth(), async (req, res) => {
    const agents = await storage.getAgentsByOwner(req.auth!.owner);

    const include = String(req.query.include ?? '').split(',').map(s => s.trim());
    const wantStats = include.includes('stats');

    let taskCounts: Record<string, { queued: number; active: number; done: number; failed: number; doneToday: number; lastTaskUpdateAt: string | null; lastFailedAt: string | null }> = {};
    let msgCounts: Record<string, { total: number; lastMessageAt: string | null }> = {};
    const onboardingByGaii: Record<string, unknown> = {};
    const activeByGaii: Record<string, Array<{ id: string; title: string; status: string; updatedAt: string; createdAt: string; agentGaii: string }>> = {};
    if (wantStats && agents.length > 0) {
      const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
      const gaiis = agents.map(a => a.gaii);
      const [tc, mc, active, obs] = await Promise.all([
        storage.countTasksByOwner(ownerGhii),
        storage.countMessagesByAgents(gaiis),
        storage.listAgentTasksByOwner(ownerGhii, { status: 'active', perPage: 200 }),
        Promise.all(agents.map(a => storage.getOnboarding(a.gaii).catch(() => null))),
      ]);
      taskCounts = tc;
      msgCounts = mc;
      agents.forEach((a, i) => { onboardingByGaii[a.gaii] = obs[i]; });
      for (const tsk of active.tasks) {
        (activeByGaii[tsk.agentGaii] ??= []).push({ id: tsk.id, title: tsk.title, status: tsk.status, updatedAt: tsk.updatedAt, createdAt: tsk.createdAt, agentGaii: tsk.agentGaii });
      }
    }

    res.json(success(config.nodeId, {
      agents: agents.map(a => ({
        gaii: a.gaii,
        name: a.name,
        owner: a.owner,
        display_name: a.displayName,
        description: a.description,
        capabilities: a.capabilities,
        technical_capabilities: a.technicalCapabilities,
        domain_capabilities: a.domainCapabilities,
        languages: a.languages ?? [],
        default_scopes: a.defaultScopes ?? ['*'],
        trust_score: a.trustScore,
        morsel_balance: a.morselBalance,
        created_at: a.createdAt,
        last_seen: a.lastSeen,
        public_key: a.publicKey,
        federate: a.federate ?? false,
        tags: a.tags ?? [],
        mode: a.mode ?? 'interactive',
        platform: a.platform ?? null,
        platform_version: a.platformVersion ?? null,
        // Indicative only — self-reported primary model (subagent delegation may differ).
        model: a.model ?? null,
        model_detected_by: a.modelDetectedBy ?? null,
        max_concurrent_tasks: a.maxConcurrentTasks ?? 1,
        daily_spend_limit: a.dailySpendLimit ?? null,
        schedule_constraint_defaults: a.scheduleConstraintDefaults ?? [],
        ...(wantStats ? {
          stats: {
            tasks: taskCounts[a.gaii] ?? { queued: 0, active: 0, done: 0, failed: 0, doneToday: 0, lastTaskUpdateAt: null, lastFailedAt: null },
            messages: msgCounts[a.gaii] ?? { total: 0, lastMessageAt: null },
            onboarding: onboardingByGaii[a.gaii] ?? null,
            active_tasks: activeByGaii[a.gaii] ?? [],
          },
        } : {}),
      })),
    }, [
      { description: 'Register a new agent', method: 'POST', url: '/v1/agents' },
    ]));
  });

  // PATCH /v1/agents/:name/tags — set sharing/classification tags.
  // Same-owner gated (not owner-role): the owner may tag any of their agents, and
  // an agent may set tags on itself or a same-owner sibling (mirrors how agents
  // self-report capabilities, and matches the server-MCP aimeat_agent_tags_set
  // handler). Cross-owner is rejected by the ownership check below.
  router.patch('/v1/agents/:name/tags', requireAuth(), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only update tags for agents owned by the same owner'));
      return;
    }

    const rawTags = req.body?.tags;
    if (!Array.isArray(rawTags)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
      return;
    }

    const tags: string[] = [];
    for (const value of rawTags) {
      if (typeof value !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'tags must be an array of strings'));
        return;
      }
      const tag = value.trim().toLowerCase();
      if (!tag) continue;
      if (!/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(tag)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Invalid tag: ${value}`));
        return;
      }
      if (!tags.includes(tag)) tags.push(tag);
    }

    if (tags.length > 20) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'An agent can have at most 20 tags'));
      return;
    }

    const updated = await storage.updateAgent(gaii, { tags });
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      name: updated.name,
      tags: updated.tags ?? [],
    }));
    emitChange('agents');
  });

  // GET /v1/agents/:name/engagements — the agent's contract engagements across every organism/workspace
  // (active + retired), for the agent-detail Contracts tab. Same-owner gated (only the owner sees where
  // their agent works). Enriched with organism + workspace display names.
  router.get('/v1/agents/:name/engagements', requireAuth(), requireRole('owner'), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) { res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`)); return; }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only view engagements for agents you own')); return;
    }
    const engagements = await listEngagementsByAgent(storage, agent.owner, agent.name);
    // Enrich with organism + workspace names.
    const orgIds = [...new Set(engagements.map(e => e.organism_id))];
    const orgNames = new Map<string, string>();
    const wsNames = new Map<string, string>();               // key: `${orgId}::${wsId}`
    // Workspace names: ALL orgs' registries in ONE cross-owner key-IN read (was a listAllMemory scan per org).
    const regByKey = new Map(orgIds.map(id => [`organism.${id}.meta.workspaces`, id]));
    const regRecs = orgIds.length
      ? (storage.getMemoryByKeysAnyOwner
          ? await storage.getMemoryByKeysAnyOwner([...regByKey.keys()])
          : (await Promise.all(orgIds.map(id => storage.listAllMemory({ prefix: `organism.${id}.meta.workspaces`, limit: 1000 }).then(r => r.items)))).flat())
      : [];
    for (const rec of regRecs) {
      const orgId = regByKey.get(rec.key);   // exact-key match
      if (!orgId) continue;
      for (const w of ((rec.value as { workspaces?: Array<{ id?: string; name?: string }> } | null)?.workspaces ?? [])) {
        if (w.id) wsNames.set(`${orgId}::${w.id}`, w.name ?? w.id);
      }
    }
    // Organism display names: a point read per distinct org (small N, keyed table).
    for (const orgId of orgIds) {
      const org = await storage.getOrganism(orgId);
      if (org) orgNames.set(orgId, org.name ?? orgId);
    }
    const enriched = engagements.map(e => ({
      ...e,
      organismName: orgNames.get(e.organism_id) ?? e.organism_id,
      wsName: wsNames.get(`${e.organism_id}::${e.ws}`) ?? e.ws,
    }));
    res.json(success(config.nodeId, { agent: agent.name, engagements: enriched }));
  });

  // PATCH /v1/agents/:name/mode — set agent operational mode
  // (autonomous | interactive | task-runner | coordinator | workstation). Same-owner gated
  // (not owner-role since v1.3.0, mirrors /tags): the owner may set any of their agents' mode,
  // and an agent may set its own / a same-owner sibling's — so a device-authed crew (the new
  // connector drops `connect add --mode`) self-sets task-runner at startup via aimeat_agent_mode_set.
  // Cross-owner is rejected by the ownership check below. Affects Hello Integration step set:
  // task-runner gets a reduced 7-step flow, workstation the narrowest 4-step flow.
  router.patch('/v1/agents/:name/mode', requireAuth(), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only update the mode of your own agents'));
      return;
    }

    const newMode = req.body?.mode;
    if (!VALID_MODES.includes(newMode)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `mode must be one of: ${VALID_MODES.join(', ')}`));
      return;
    }

    const updated = await storage.updateAgent(gaii, { mode: newMode });
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }

    // Ensure the Hello Integration step list matches the (possibly new) mode's flow — e.g. a
    // task-runner's reduced 7-step set. This self-heals the case where an agent registered as
    // 'interactive' (the device-auth default; the connector dropped `--mode`) later self-sets
    // 'task-runner' at startup and would otherwise keep showing the full flow (7/16 instead of 7/7).
    // Progress on steps that carry over (same id) is preserved. It fires whenever the stored step SET
    // differs from the mode's flow — so it also repairs agents ALREADY in the target mode with a stale
    // set — and is a no-op otherwise. Best-effort: a sync failure must never fail the mode change.
    try {
      const onboarding = await storage.getOnboarding(gaii);
      if (onboarding) {
        const target = createDefaultSteps(newMode);
        const currentIds = new Set(onboarding.steps.map(s => s.id));
        const flowChanged = target.length !== onboarding.steps.length || target.some(s => !currentIds.has(s.id));
        if (flowChanged) {
          const prevById = new Map(onboarding.steps.map(s => [s.id, s] as const));
          const steps = target.map(fresh => {
            const prev = prevById.get(fresh.id);
            return prev
              ? { ...fresh, status: prev.status, validatedAt: prev.validatedAt, details: prev.details, failureReason: prev.failureReason }
              : fresh;
          });
          const allRequiredPassed = steps.filter(s => s.required).every(s => s.status === 'passed');
          await storage.updateOnboarding(gaii, {
            steps,
            status: allRequiredPassed ? 'completed' : 'in_progress',
            ...(allRequiredPassed && !onboarding.completedAt ? { completedAt: new Date().toISOString() } : {}),
          });
        }
      }
    } catch (err) {
      console.error(`[agents] mode change: could not re-derive onboarding steps for ${gaii}:`, err);
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      name: updated.name,
      mode: updated.mode ?? 'interactive',
    }));
    emitChange('agents');
  });

  // PATCH /v1/agents/:name/max-concurrent-tasks — owner sets how many tasks the
  // agent's runner may process concurrently. Default 1 = serial. AIMEAT only
  // stores/exposes the number (read from the integration kit's watchdog_spec);
  // the runner enforces it. >1 needs a concurrency-capable engine.
  router.patch('/v1/agents/:name/max-concurrent-tasks', requireAuth(), requireRole('owner'), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only update your own agents'));
      return;
    }

    const raw = req.body?.max_concurrent_tasks;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'max_concurrent_tasks must be an integer between 1 and 20'));
      return;
    }

    const updated = await storage.updateAgent(gaii, { maxConcurrentTasks: value });
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      name: updated.name,
      max_concurrent_tasks: updated.maxConcurrentTasks ?? 1,
    }));
    emitChange('agents');
  });

  // PATCH /v1/agents/:name/schedule-constraints — owner sets this agent's default
  // budget guards (applied to schedules created for it). Opt-in; off by default.
  // Body: { daily_spend_limit?: number|null, constraints?: ScheduleConstraint[] }
  router.patch('/v1/agents/:name/schedule-constraints', requireAuth(), requireRole('owner'), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, req.auth!.owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }
    if (agent.owner !== req.auth!.owner) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only update your own agents'));
      return;
    }

    const body = req.body as { daily_spend_limit?: number | null; constraints?: unknown };
    const updates: Record<string, unknown> = {};
    if ('daily_spend_limit' in body) {
      const v = body.daily_spend_limit;
      if (v === null) updates.dailySpendLimit = null;
      else if (typeof v === 'number' && v >= 0) updates.dailySpendLimit = v;
      else { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'daily_spend_limit must be a non-negative number or null')); return; }
    }
    if (Array.isArray(body.constraints)) {
      updates.scheduleConstraintDefaults = body.constraints.filter(
        (c): c is { type: string; enabled: boolean; params: Record<string, unknown> } =>
          !!c && typeof c === 'object' && typeof (c as { type?: unknown }).type === 'string',
      );
    }

    const updated = await storage.updateAgent(gaii, updates);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`));
      return;
    }
    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      name: updated.name,
      daily_spend_limit: updated.dailySpendLimit ?? null,
      schedule_constraint_defaults: updated.scheduleConstraintDefaults ?? [],
    }));
    emitChange('agents');
  });

  // POST /v1/checkin — agent heartbeat (agent auth)
  // lastSeen is buffered in-memory and flushed once per interval (telemetry-buffer.ts)
  // rather than written on every heartbeat — it is a pure "last active" display value
  // (10-min online window) with no correctness dependency, so a sub-minute lag is fine.
  router.post('/v1/checkin', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const now = new Date().toISOString();
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
      return;
    }
    markAgentSeen(gaii, now);

    res.json(success(config.nodeId, {
      gaii,
      checked_in: now,
      trust_score: agent.trustScore,
      morsel_balance: agent.morselBalance,
    }));
  });
}
