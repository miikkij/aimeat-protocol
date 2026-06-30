/**
 * @file routes/secretary.ts
 * @description Secretary-specific server endpoints that must act AS the secretary agent (which the
 *   owner's browser session can't do directly). Currently: the clarify channel — when a task lacks
 *   facts, the Secretary asks the owner a batch of structured questions (a federated AskUserQuestion)
 *   in the inbox rather than hallucinating, and records a pending "produce" job the autonomous tick
 *   resumes once the owner answers. The questions/answers reuse the DM interactive payload, so the
 *   exact same mechanism serves specialists/agents.
 * @structure secretaryRouter(config, storage, peers) -> Router
 *   - POST /v1/secretary/clarify     — send the questions secretary#owner→owner + store the produce job
 *   - POST /v1/secretary/reset       — wipe the owner's Secretary back to zero (start over)
 *   - POST /v1/secretary/brief       — propose grounded Work Briefs for the active context's gaps (heavy
 *     work is DISPATCHED to a Builder, not authored here); deterministic + idempotent, never touches content
 *   - GET  /v1/secretary/briefs      — list the open Work Briefs (proposed/dispatched) for the brief tray
 * @usage app.use(secretaryRouter(config, storage, peers));
 * @version-history
 *   v0.4.0 — 2026-07-01 — Light-vs-heavy seam: REPLACED author-now (cheap one-shot authoring that
 *     hallucinated) with POST /v1/secretary/brief — the Secretary detects structural gaps and proposes a
 *     grounded Work Brief a Builder executes via the appdev MCP tools, instead of inventing content. Adds
 *     GET /v1/secretary/briefs for the brief tray. See services/secretary-workbrief + secretary-worktier.
 *   v0.3.0 — 2026-06-30 — author-now: fill workspaces with real content at handshake (documents first,
 *     schema-valid records, agentic retry) instead of waiting for a tick, and drop any still-empty
 *     workspace. Pairs with the Secretary setup skipping fake "example-N" placeholder records.
 *   v0.2.0 — 2026-06-28 — Reset channel: POST /v1/secretary/reset wipes the Secretary to a clean state
 *     (brain/directives + all secretary.* memory + optionally the self-organisms & their workspaces +
 *     specialists & their deliverables + the tick schedule). Keeps the OpenRouter key + the agent identity.
 *   v0.1.0 — 2026-06-28 — Clarify channel: ask-don't-hallucinate via inbox questions + a tick-resumed job.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { sendDirectMessage } from '../services/message-send.js';
import { InteractiveQuestionSchema } from '../models/message-schemas.js';
import { secretaryGaii } from '../services/secretary.js';
import { listSpecialists, deleteSpecialistConfig } from '../services/specialist.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { proposeWorkBriefs, updateBriefStatus, BRIEF_KEY_PREFIX, type WorkBrief, type BriefContext } from '../services/secretary-workbrief.js';
import { randomUUID } from 'node:crypto';

const ClarifySchema = z.object({
  contextId: z.string().min(1).max(200),
  contextName: z.string().max(200).optional().default(''),
  action: z.object({ summary: z.string().min(1).max(2000), why: z.string().max(2000).optional().default('') }),
  questions: z.array(InteractiveQuestionSchema).min(1).max(20),
  facts: z.string().max(200000).optional().default(''),
  organismId: z.string().max(200).optional().default(''),
  wsId: z.string().max(200).optional().default(''),
  body: z.string().max(4000).optional().default(''),
});

export function secretaryRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
  const router = Router();

  // ── POST /v1/secretary/clarify ── ask the owner a batch of questions AS the secretary, store the job.
  router.post('/v1/secretary/clarify', requireAuth(), requireRole('owner'), async (req, res) => {
    const parsed = ClarifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid clarify payload'));
      return;
    }
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const secretaryGaii = `secretary#${owner}@${config.nodeId}`;
    const { contextId, contextName, action, questions, facts, organismId, wsId, body } = parsed.data;

    const result = await sendDirectMessage({ config, storage, peers }, {
      senderGhii: secretaryGaii,
      recipientGhii: ownerGhii,
      body: body || `I need a few details before I can do this well: "${action.summary}".`,
      interactive: { role: 'questions', v: 1, questions },
      skipContactGate: true,
    });
    if (!result.ok) {
      res.status(502).json(error(config.nodeId, 'SEND_FAILED', `Could not post the questions (${result.code})`));
      return;
    }

    const messageId = result.message.id;
    const now = new Date().toISOString();
    const key = `secretary.clarify.${messageId}`;
    await storage.setMemory({
      key, ownerGaii: ownerGhii,
      value: { id: messageId, conversationId: result.message.conversationId, questionId: messageId, questions, action, facts, contextId, contextName, organismId, wsId, status: 'asked', createdAt: now },
      visibility: 'private', tags: ['secretary', 'clarify', 'asked'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });

    res.json(success(config.nodeId, { messageId, conversationId: result.message.conversationId, status: 'asked' }, [
      { description: 'Answer in your inbox', method: 'GET', url: '/v1/messages/inbox' },
    ]));
  });

  // ── POST /v1/secretary/reset ── wipe the owner's Secretary back to a clean slate so they can start over.
  // The Secretary develops over time (brain, contexts, routines/triggers/feed, a self-organism with
  // workspaces, specialists). When the early auto-built brain / broken workspaces are just clutter, this
  // tears the whole thing down in one call. Owner-scoped + idempotent. PRESERVED: the OpenRouter key +
  // settings, and the Secretary's agent IDENTITY (the `secretary#owner@node` record is re-used blank, so
  // its GAII and any external references survive — only its brain/directives are cleared). The frontend
  // then lands on the fresh setup screen. `organisms`/`specialists` default true (full reset); set either
  // false to keep that layer.
  const ResetSchema = z.object({
    organisms: z.boolean().optional().default(true),
    specialists: z.boolean().optional().default(true),
  });

  router.post('/v1/secretary/reset', requireAuth(), requireRole('owner'), async (req, res) => {
    const parsed = ResetSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid reset payload'));
      return;
    }
    const opts = parsed.data;
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const removed = { memoryKeys: 0, organisms: [] as string[], specialists: [] as string[], schedules: 0, brain: false };

    try {
      // (1) Collect the Secretary's self-organism ids from the config BEFORE we wipe it.
      const cfgRec = await storage.getMemory(ownerGhii, 'secretary.config');
      const cfg = (cfgRec?.value ?? {}) as { contexts?: Array<{ organismId?: string | null }> };
      const orgIds = Array.from(new Set((cfg.contexts || []).map((c) => c.organismId).filter((x): x is string => !!x)));

      // (2) Specialists: mirror DELETE /v1/specialists/:name (directives + config + agent, which cascade-
      //     deletes the specialist's own memory incl. its deliverables).
      if (opts.specialists) {
        const specs = await listSpecialists(storage, owner).catch(() => []);
        for (const s of specs) {
          await storage.deleteAgentDirectives(s.gaii).catch(() => {});
          await deleteSpecialistConfig(storage, config, owner, s.name).catch(() => {});
          await storage.deleteAgent(s.gaii).catch(() => {});
          removed.specialists.push(s.name);
        }
      }

      // (3) All owner-namespaced Secretary state: config, feed, goals, decisions, triggers, clarify jobs,
      //     "what's next" — everything keyed `secretary.*`.
      const secKeys = await storage.listMemory(ownerGhii, { prefix: 'secretary.' }).catch(() => []);
      for (const m of secKeys) {
        if (await storage.deleteMemory(ownerGhii, m.key).catch(() => false)) removed.memoryKeys++;
      }

      // (4) The Secretary's self-organisms + their workspaces/content. deleteOrganism cascades the
      //     `organism.{id}.*` content (across owners), board, memberships, reputation, schemas. Guarded:
      //     only organisms the owner CREATED (never a shared org the Secretary merely referenced). The
      //     creator field may be stored bare ("alice"), as a GHII ("alice@node"), or even a GAII
      //     ("agent#alice@node"), so compare the OWNER portion, not the raw string.
      const ownerOf = (id: string): string => {
        const s = String(id || '');
        const afterHash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
        return afterHash.includes('@') ? afterHash.slice(0, afterHash.indexOf('@')) : afterHash;
      };
      if (opts.organisms) {
        for (const id of orgIds) {
          const org = await storage.getOrganism(id).catch(() => null);
          if (org && ownerOf(org.creatorGhii) === owner) {
            await storage.deleteOrganism(id).catch(() => {});
            removed.organisms.push(id);
          }
        }
      }

      // (5) The autonomous tick schedule(s). Stop the live cron first, then delete the record.
      const scheduler = getActiveScheduler();
      const jobs = await storage.listScheduledJobs({ type: 'secretary', ownerScope: ownerGhii }).catch(() => []);
      for (const j of jobs) {
        scheduler?.removeJob(j.id);
        if (await storage.deleteScheduledJob(j.id).catch(() => false)) removed.schedules++;
      }

      // (6) Clear the Secretary's brain (agent directives). The agent record itself is kept (re-used blank)
      //     so the SPA still resolves it and the OpenRouter backfill keeps it provisioned.
      const gaii = secretaryGaii(owner, config);
      removed.brain = await storage.deleteAgentDirectives(gaii).catch(() => false);

      emitChange('agents');
      logger.info('[secretary] reset', { owner, removed });
      res.json(success(config.nodeId, { reset: true, removed }, [
        { description: 'Set up the Secretary again', method: 'GET', url: '/v1/secretary' },
      ]));
    } catch (err) {
      logger.error('[secretary] reset failed', { owner, error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to reset the Secretary'));
    }
  });

  // ── POST /v1/secretary/brief ── propose grounded Work Briefs for the active context's workspaces (the
  //    heavy-work path). The cheap Secretary NO LONGER authors content one-shot (it hallucinated and went
  //    "onto the Builders' turf"); instead it detects structural gaps (empty/thin workspaces, stale content,
  //    off-target KPIs) and assembles a brief — Current picture + real Discovery sources + exact schemas +
  //    MCP playbook — that a Builder (a connected big AI via the appdev MCP tools) executes. Deterministic
  //    (no paid AI call), idempotent (deduped against open briefs by gap), additive (never touches content).
  //    Optional `ws` scopes to one workspace. The view then offers "Open in Claude Desktop" / dispatch.
  const BriefSchema = z.object({ ws: z.string().max(200).optional() });
  router.post('/v1/secretary/brief', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const parsed = BriefSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid brief payload'));
      return;
    }
    try {
      const cfgRec = await storage.getMemory(ownerGhii, 'secretary.config');
      const cfg = (cfgRec?.value ?? {}) as { contexts?: BriefContext[]; activeContextId?: string };
      const contexts = Array.isArray(cfg.contexts) ? cfg.contexts : [];
      const active = contexts.find((c) => c.id === cfg.activeContextId) || contexts[0];
      if (!active || !active.organismId) {
        res.status(400).json(error(config.nodeId, 'NO_CONTEXT', 'No active Secretary context with an organism to brief.'));
        return;
      }
      const orgId = active.organismId;

      // Open goals for this context steer the brief's "why".
      const goalRecs = await storage.listMemory(ownerGhii, { prefix: 'secretary.goal.' }).catch(() => []);
      const openGoals = goalRecs
        .map((r) => (r.value ?? {}) as Record<string, unknown>)
        .filter((g) => g.status === 'open' && (!g.contextId || g.contextId === active.id));

      const regKey = `organism.${orgId}.meta.workspaces`;
      const regRec = await storage.getMemory(ownerGhii, regKey);
      const wsEntries = ((regRec?.value as { workspaces?: Array<{ id?: string; name?: string }> } | undefined)?.workspaces) ?? [];
      let wsList = wsEntries.filter((w) => w && w.id).map((w) => ({ id: w.id as string, name: w.name || (w.id as string) }));
      const onlyWs = parsed.data.ws;
      if (onlyWs) wsList = wsList.filter((w) => w.id === onlyWs);

      const { briefs } = await proposeWorkBriefs(storage, config, { ownerGhii, ownerName: owner, active, wsList, openGoals });
      emitChange('agents');
      logger.info('[secretary] brief', { owner, proposed: briefs.length, workspaces: wsList.length });
      res.json(success(config.nodeId, {
        briefs: briefs.map((b) => ({ id: b.id, objective: b.objective, ws: b.ws, wsName: b.wsName, gaps: b.gaps.length, status: b.status })),
        proposed: briefs.length, workspaces: wsList.length,
      }, [{ description: 'Open the Secretary', method: 'GET', url: '/v1/secretary' }]));
    } catch (err) {
      logger.error('[secretary] brief failed', { owner, error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to build work briefs'));
    }
  });

  // ── GET /v1/secretary/briefs ── list the open Work Briefs (proposed/dispatched) for the brief tray, newest
  //    first. Owner-scoped private memory; the full brief markdown + MCP hints are included so the view can
  //    render "Open in Claude Desktop" without a second fetch.
  router.get('/v1/secretary/briefs', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const recs = await storage.listMemory(ownerGhii, { prefix: BRIEF_KEY_PREFIX }).catch(() => []);
    const briefs = recs
      .map((r) => r.value as unknown as WorkBrief)
      .filter((b) => b && (b.status === 'proposed' || b.status === 'dispatched'))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    res.json(success(config.nodeId, { briefs }));
  });

  // ── POST /v1/secretary/brief/:id/dispatch ── queue a Work Brief as a task a connected Builder picks up
  //    and runs via the appdev MCP tools (lane b). The Builder is any of THIS owner's connected agents that
  //    is NOT the Secretary (the watcher) or a node-local specialist. Marks the brief 'dispatched'.
  const DispatchSchema = z.object({ targetAgent: z.string().min(1).max(300) });
  router.post('/v1/secretary/brief/:id/dispatch', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const briefId = req.params.id as string;
    const parsed = DispatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'targetAgent is required')); return; }
    try {
      const rec = await storage.getMemory(ownerGhii, `${BRIEF_KEY_PREFIX}${briefId}`);
      if (!rec) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Work brief not found')); return; }
      const brief = rec.value as unknown as WorkBrief;
      // Resolve + authorize the target Builder: it must be one of THIS owner's agents, and not the Secretary
      // or a node-local specialist (those are not Builders — heavy work goes to a big external AI via MCP).
      const agent = await storage.getAgent(parsed.data.targetAgent);
      if (!agent || agent.owner !== owner) { res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'Unknown Builder for this owner')); return; }
      const tags = agent.tags || [];
      if (tags.includes('system:secretary') || tags.includes('system:specialist')) {
        res.status(400).json(error(config.nodeId, 'INVALID_TARGET', 'Pick a connected Builder (a big AI), not the Secretary or a specialist'));
        return;
      }
      const now = new Date().toISOString();
      const taskId = randomUUID();
      await storage.createAgentTask({
        id: taskId, agentGaii: agent.gaii, ownerGaii: ownerGhii,
        title: String(brief.objective || 'Work brief').slice(0, 200), description: String(brief.brief || '').slice(0, 20000),
        scope: [], rules: [], verification: { userExpects: String(brief.objective || ''), technicalChecks: [] }, todos: [],
        status: 'queued', parentTaskId: `brief:${briefId}`, createdAt: now, updatedAt: now,
      });
      await updateBriefStatus(storage, ownerGhii, briefId, { status: 'dispatched', dispatchedTo: agent.gaii, taskId });
      emitChange('agent-tasks', ownerGhii);
      emitChange('agents');
      logger.info('[secretary] brief dispatched', { owner, briefId, to: agent.gaii, taskId });
      res.json(success(config.nodeId, { dispatched: true, taskId, to: agent.gaii }, [
        { description: 'Track the task', method: 'GET', url: `/v1/agents/${encodeURIComponent(agent.name)}/tasks` },
      ]));
    } catch (err) {
      logger.error('[secretary] brief dispatch failed', { owner, briefId, error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to dispatch the brief'));
    }
  });

  // ── POST /v1/secretary/brief/:id/done ── resolve a Work Brief (the owner handled it, or it's no longer
  //    relevant). Marks it 'done' so it leaves the tray; the tick won't re-propose the same gap.
  router.post('/v1/secretary/brief/:id/done', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const briefId = req.params.id as string;
    const updated = await updateBriefStatus(storage, ownerGhii, briefId, { status: 'done' });
    if (!updated) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Work brief not found')); return; }
    emitChange('agents');
    res.json(success(config.nodeId, { done: true }));
  });

  return router;
}
