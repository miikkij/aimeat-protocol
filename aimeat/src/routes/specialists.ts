/**
 * @file specialists.ts
 * @description REST routes for SPECIALIST agents (Secretary P5 / S-A) — a reusable agent type alongside
 *   the personal + company Secretaries. A specialist is provisioned server-side (no device-auth dance,
 *   like the Secretary) with its own brain (agent directives), its own operating-model policy (same
 *   bands/cost-guard taxonomy as the Secretary), and its own scope profile. All routes are owner-gated.
 *   Brain edits also work through the existing PUT /v1/agents/:name/directives (a specialist is an
 *   agent); this router owns creation, listing, policy, and removal.
 * @structure
 *   - POST   /v1/specialists            — provision a specialist (+ optional brain + policy)
 *   - GET    /v1/specialists            — list the owner's specialists
 *   - GET    /v1/specialists/:name      — one specialist (brain + policy)
 *   - PUT    /v1/specialists/:name/policy — update the operating-model policy
 *   - DELETE /v1/specialists/:name      — remove the specialist (agent + directives + config)
 * @usage app.use(specialistsRouter(config, storage)) in routes-loader.ts
 * @version-history
 *   v1.1.0 — 2026-06-25 — Scope-consent at provisioning: POST accepts `approved_scopes` (owner consent to a
 *     role's requested EXTRAS) and grants baseline ∪ approved (filtered ⊆ the role's requestable extras,
 *     never wider — mirrors app grants); rejects any approved scope outside the requested set with a 400;
 *     the response always carries `requestable_extras` (scope + plain-language description) so the UI can
 *     present a consent checklist. Default (no approval) provisions conservatively.
 *   v1.0.0 — 2026-06-24 — Initial: specialist agent type (Secretary P5 S-A)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, DirectiveRule } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { logger } from '../utils/logger.js';
import { SPECIALIST_ROLES, requestedExtras, describeScopes } from '../mcp/catalog/scopes.js';
import {
  SPECIALIST_ROLE_TAG, specialistGaii, validateSpecialistName, getSpecialist, listSpecialists,
  ensureSpecialist, specialistRole, readSpecialistPolicy, writeSpecialistPolicy, deleteSpecialistConfig,
} from '../services/specialist.js';

/** Normalize a brain rules array from the request into stored DirectiveRule[]. */
function normalizeRules(raw: unknown): DirectiveRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r, idx) => {
      const o = (r && typeof r === 'object') ? r as Record<string, unknown> : {};
      const description = typeof o.description === 'string' ? o.description : '';
      if (!description.trim()) return null;
      return { id: typeof o.id === 'string' && o.id ? o.id : `rule-${idx + 1}`, description };
    })
    .filter((r): r is DirectiveRule => r !== null);
}

export function specialistsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── POST /v1/specialists — provision a specialist ──
  router.post('/v1/specialists', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    try {
      const owner = req.auth!.owner as string;
      const body = (req.body ?? {}) as {
        name?: string; role?: string; display_name?: string; displayName?: string; description?: string;
        brain?: { purpose?: string; rules?: unknown };
        policy?: unknown;
        approved_scopes?: unknown; approvedScopes?: unknown;
      };

      const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
      const nameError = validateSpecialistName(name);
      if (nameError) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
      }
      if (body.role !== undefined && !(SPECIALIST_ROLES as readonly string[]).includes(body.role)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `role must be one of: ${SPECIALIST_ROLES.join(', ')}`));
      }

      // The EXTRAS this role may request beyond the conservative baseline (consent vocabulary).
      const extras = requestedExtras(body.role);

      // Owner-approved extras (consent). Validate every approved scope is a string within the role's
      // requested set — reject anything outside with a 400 (never grant more than was requested). When
      // omitted entirely, the specialist provisions conservatively (no extras) and we surface what could
      // be requested so the UI can present a consent checklist.
      const rawApproved = body.approved_scopes ?? body.approvedScopes;
      let approvedScopes: string[] | undefined;
      if (rawApproved !== undefined) {
        if (!Array.isArray(rawApproved) || !rawApproved.every(s => typeof s === 'string')) {
          return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'approved_scopes must be an array of strings'));
        }
        const outside = (rawApproved as string[]).filter(s => !extras.includes(s));
        if (outside.length) {
          return res.status(400).json(error(config.nodeId, 'INVALID_SCOPE',
            `Not requestable for role "${body.role ?? 'specialist'}": ${outside.join(', ')}`));
        }
        approvedScopes = rawApproved as string[];
      }

      // Collision guard: a NON-specialist agent already at this GAII must not be overwritten.
      const gaii = specialistGaii(name, owner, config);
      const existing = await storage.getAgent(gaii);
      if (existing && !(existing.tags ?? []).includes(SPECIALIST_ROLE_TAG)) {
        return res.status(409).json(error(config.nodeId, 'NAME_TAKEN',
          `An agent named "${name}" already exists and is not a specialist`));
      }

      const { record, created, role } = await ensureSpecialist(storage, config, owner, {
        name,
        role: body.role,
        displayName: body.displayName ?? body.display_name,
        description: body.description,
        approvedScopes,
      });

      // Optional brain (purpose + rules) → the agent's own directives layer.
      let brain: { purpose: string; rules: DirectiveRule[] } | null = null;
      if (body.brain && typeof body.brain === 'object') {
        const purpose = typeof body.brain.purpose === 'string' ? body.brain.purpose : '';
        const rules = normalizeRules(body.brain.rules);
        const dir = await storage.upsertAgentDirectives({
          agentGaii: gaii, purpose, rules, memoryAreas: [], resources: [], updatedAt: new Date().toISOString(),
        });
        brain = { purpose: dir.purpose, rules: dir.rules };
        emitChange('agent-directives', gaii);
      }

      // Always seed/normalize the operating-model policy (default if none supplied).
      const policy = await writeSpecialistPolicy(storage, config, owner, name, body.policy, role);

      res.status(created ? 201 : 200).json(success(config.nodeId, {
        specialist: {
          name: record.name,
          gaii: record.gaii,
          role,
          display_name: record.displayName,
          description: record.description,
          scopes: record.defaultScopes ?? [],
          tags: record.tags ?? [],
          brain,
          policy,
          created,
          // The extras this role can run with ONLY on the owner's explicit consent (each with a plain-
          // language description). Empty for a role with no requested extras → the UI shows no consent step.
          requestable_extras: describeScopes(extras),
        },
      }, [
        { description: 'Edit the specialist brain', method: 'PUT', url: `/v1/agents/${name}/directives` },
        { description: 'Update the operating-model policy', method: 'PUT', url: `/v1/specialists/${name}/policy` },
      ]));
      emitChange('agents', gaii);
    } catch (err) {
      logger.error('Failed to create specialist', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to create specialist'));
    }
  });

  // ── GET /v1/specialists — list the owner's specialists ──
  router.get('/v1/specialists', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    try {
      const owner = req.auth!.owner as string;
      const specialists = await listSpecialists(storage, owner);
      const out = await Promise.all(specialists.map(async a => ({
        name: a.name,
        gaii: a.gaii,
        role: specialistRole(a),
        display_name: a.displayName,
        description: a.description,
        scopes: a.defaultScopes ?? [],
        tags: a.tags ?? [],
        policy: await readSpecialistPolicy(storage, config, owner, a.name),
      })));
      res.json(success(config.nodeId, { specialists: out, total: out.length }, [
        { description: 'Create a specialist', method: 'POST', url: '/v1/specialists' },
      ]));
    } catch (err) {
      logger.error('Failed to list specialists', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list specialists'));
    }
  });

  // ── GET /v1/specialists/:name — one specialist (brain + policy) ──
  router.get('/v1/specialists/:name', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    try {
      const owner = req.auth!.owner as string;
      const name = req.params.name as string;
      const agent = await getSpecialist(storage, config, owner, name);
      if (!agent) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Specialist "${name}" not found`));
      }
      const directives = await storage.getAgentDirectives(agent.gaii);
      const policy = await readSpecialistPolicy(storage, config, owner, name);
      res.json(success(config.nodeId, {
        specialist: {
          name: agent.name,
          gaii: agent.gaii,
          role: specialistRole(agent),
          display_name: agent.displayName,
          description: agent.description,
          scopes: agent.defaultScopes ?? [],
          tags: agent.tags ?? [],
          brain: { purpose: directives?.purpose ?? '', rules: directives?.rules ?? [] },
          policy,
        },
      }));
    } catch (err) {
      logger.error('Failed to get specialist', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get specialist'));
    }
  });

  // ── PUT /v1/specialists/:name/policy — update operating-model policy ──
  router.put('/v1/specialists/:name/policy', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    try {
      const owner = req.auth!.owner as string;
      const name = req.params.name as string;
      const agent = await getSpecialist(storage, config, owner, name);
      if (!agent) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Specialist "${name}" not found`));
      }
      const policy = await writeSpecialistPolicy(storage, config, owner, name, req.body, specialistRole(agent));
      emitChange('agents', agent.gaii);
      res.json(success(config.nodeId, { policy }));
    } catch (err) {
      logger.error('Failed to update specialist policy', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update specialist policy'));
    }
  });

  // ── DELETE /v1/specialists/:name — remove a specialist ──
  router.delete('/v1/specialists/:name', requireAuth(), requireRole('owner'), async (req: Request, res: Response) => {
    try {
      const owner = req.auth!.owner as string;
      const name = req.params.name as string;
      const agent = await getSpecialist(storage, config, owner, name);
      if (!agent) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Specialist "${name}" not found`));
      }
      await storage.deleteAgentDirectives(agent.gaii).catch(() => {});
      await deleteSpecialistConfig(storage, config, owner, name);
      await storage.deleteAgent(agent.gaii);
      emitChange('agents', agent.gaii);
      res.json(success(config.nodeId, { deleted: name }, [
        { description: 'List specialists', method: 'GET', url: '/v1/specialists' },
      ]));
    } catch (err) {
      logger.error('Failed to delete specialist', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to delete specialist'));
    }
  });

  return router;
}
