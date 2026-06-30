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
 *   - POST /v1/secretary/author-now  — fill the active context's workspaces with REAL content at setup
 *     (reuses services/secretary-authoring) + remove any workspace left empty ("empty = useless")
 * @usage app.use(secretaryRouter(config, storage, peers));
 * @version-history
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
import { authorWorkspaceContent, type AuthoringContext } from '../services/secretary-authoring.js';

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

  // ── POST /v1/secretary/author-now ── fill the active context's workspaces with REAL content at SETUP
  //    ("heti kättelyssä"), reusing the tested authoring service (documents first, schema-valid records,
  //    agentic retry on flaky models). NEVER deletes a workspace — additive only. (An earlier version
  //    removed "empty" workspaces after authoring; when the fill produced nothing it nuked ALL the user's
  //    freshly-created workspaces, leaving an organism with zero spaces. Auto-deleting the owner's
  //    workspaces is never acceptable, so authoring only ever ADDS content; empties simply stay.)
  //    Runs as a one-time act-band pass; the persisted band is untouched. Synchronous: the caller waits
  //    (a slow model can take a while), so call it with a long client timeout.
  router.post('/v1/secretary/author-now', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    try {
      const cfgRec = await storage.getMemory(ownerGhii, 'secretary.config');
      const cfg = (cfgRec?.value ?? {}) as { contexts?: AuthoringContext[]; activeContextId?: string };
      const contexts = Array.isArray(cfg.contexts) ? cfg.contexts : [];
      const active = contexts.find((c) => c.id === cfg.activeContextId) || contexts[0];
      if (!active || !active.organismId) {
        res.status(400).json(error(config.nodeId, 'NO_CONTEXT', 'No active Secretary context with an organism to fill.'));
        return;
      }
      const orgId = active.organismId;

      // Open goals for this context steer what gets authored.
      const goalRecs = await storage.listMemory(ownerGhii, { prefix: 'secretary.goal.' }).catch(() => []);
      const openGoals = goalRecs
        .map((r) => (r.value ?? {}) as Record<string, unknown>)
        .filter((g) => g.status === 'open' && (!g.contextId || g.contextId === active.id));

      // Honour the owner's autoRetry/maxRetries (flaky models retry instead of dying).
      const aiPrefs = (await storage.getMemory(ownerGhii, 'openrouter.settings'))?.value as { autoRetry?: boolean; maxRetries?: number } | undefined;
      const maxRetries = aiPrefs?.autoRetry === false ? 0 : (typeof aiPrefs?.maxRetries === 'number' ? aiPrefs.maxRetries : 3);

      const regKey = `organism.${orgId}.meta.workspaces`;
      const regRec = await storage.getMemory(ownerGhii, regKey);
      const wsEntries = ((regRec?.value as { workspaces?: Array<{ id?: string; name?: string }> } | undefined)?.workspaces) ?? [];
      let wsList = wsEntries.filter((w) => w && w.id).map((w) => ({ id: w.id as string, name: w.name || (w.id as string) }));
      // Optional `ws`: fill just ONE workspace, so the setup UI can fill them one at a time and show
      // live per-workspace progress instead of one long opaque call.
      const onlyWs = typeof (req.body as { ws?: unknown })?.ws === 'string' ? (req.body as { ws: string }).ws : null;
      if (onlyWs) wsList = wsList.filter((w) => w.id === onlyWs);

      // Author real content (act → publish), reusing the agentic, doc-first, retrying service. ADDITIVE
      // ONLY — a workspace that the fill couldn't populate stays exactly as it is; nothing is ever deleted.
      const authored = await authorWorkspaceContent(storage, config, ownerGhii, owner, active, wsList, {
        openGoals, band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, maxRetries,
        retryOnEmpty: true, appId: 'setup:author',
      });

      emitChange('organisms');
      logger.info('[secretary] author-now', { owner, authored: authored.summaries.length, workspaces: wsList.length, morsels: authored.morsels });
      res.json(success(config.nodeId, { authored: authored.summaries, workspaces: wsList.length, morsels: authored.morsels }, [
        { description: 'Open the workspaces', method: 'GET', url: `/v1/profile?tab=organisms&org=${orgId}` },
      ]));
    } catch (err) {
      logger.error('[secretary] author-now failed', { owner, error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to author workspace content'));
    }
  });

  return router;
}
