/**
 * @file src/routes/ai-decide-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The doors onto DECISION RULES: the owner's named, reusable definitions for the
 *   decision model (services/decide/rules.ts), an agent's proposals for new ones, and the quality
 *   numbers counted from the decisions the rules made.
 *
 *   NONE OF THESE HANDLERS DOES THE WORK. Each calls services/decide/, which the MCP tools call too.
 *
 *   WHO MAY DO WHAT.
 *     read a rule, list rules   anyone acting in the owner's name with ai:use, and each caller is
 *                               shown only the rules its kind may run (the `use` lock). The owner in
 *                               person sees all of them, with their quality numbers and proposals.
 *     write, delete, try        the owner in person (requireOwnerPrincipal). A rule decides whether an
 *                               agent acts, so an agent that could write one could write its own
 *                               permission. `requireRole('owner')` is not that test.
 *     propose                   the owner's agents and the owner's own chat. It creates nothing.
 *                               An app may not: an app grant is consent to USE the account.
 *     approve, decline          the owner in person.
 *
 *   MOUNTED BEFORE routes/ai-decide.ts, because `/v1/ai/decisions/stats` would otherwise be read as
 *   a decision whose id is "stats".
 * @structure decideRulesRouter(config, storage)
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial: decision rules on the node.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { requireOwnerPrincipal, isOwnerPrincipal } from '../auth/account-security.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { AiCompletionError } from '../services/ai-completion.js';
import { decideForOwner, decisionStats, ruleCallerKind, DecideError } from '../services/decide/service.js';
import {
  listRules, getRule, putRule, deleteRule, rulesRunnableBy, useAllows,
  proposeRule, listRuleProposals, approveRuleProposal, declineRuleProposal,
} from '../services/decide/rules.js';
import { decideOwnerOf, decideCallerOf } from './ai-decide.js';

export function decideRulesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);

  const fail = (res: Response, e: unknown) => {
    if (e instanceof DecideError || e instanceof AiCompletionError) {
      const details = e instanceof DecideError ? e.details : undefined;
      return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, details));
    }
    return res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
  };

  // ── GET /v1/ai/decisions/stats ── the quality numbers, per rule or per principal
  router.get('/v1/ai/decisions/stats', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const q = req.query as Record<string, string | undefined>;
    if (q.group_by !== 'rule' && q.group_by !== 'principal') {
      return res.status(400).json(error(config.nodeId, 'INVALID_QUERY', "group_by is 'rule' or 'principal'."));
    }
    try {
      const groups = await decisionStats(storage, decideOwnerOf(req.auth!, config.nodeId), {
        groupBy: q.group_by, ...(q.rule ? { rule: q.rule } : {}), ...(q.principal ? { principal: q.principal } : {}),
      });
      res.json(success(config.nodeId, { groups }));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decide/rules ── the rules this caller may run
  router.get('/v1/ai/decide/rules', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const gaii = decideOwnerOf(req.auth!, config.nodeId);
    try {
      if (isOwnerPrincipal(req.auth)) {
        const [rules, proposals, groups] = await Promise.all([
          listRules(storage, gaii), listRuleProposals(storage, gaii), decisionStats(storage, gaii, { groupBy: 'rule' }),
        ]);
        const quality = Object.fromEntries(groups.map(({ key, ...g }) => [key, g]));
        return res.json(success(config.nodeId, { rules, proposals, quality }));
      }
      const me = resolveIdentity(req.auth!, config.nodeId);
      const kind = ruleCallerKind(decideCallerOf(req, config.nodeId));
      const [rules, proposals] = await Promise.all([rulesRunnableBy(storage, gaii, kind), listRuleProposals(storage, gaii)]);
      res.json(success(config.nodeId, {
        rules,
        // What this caller itself proposed and the owner has not settled yet.
        proposals: proposals.filter(p => p.proposed_by === me).map(p => ({ proposal_id: p.id, rule_id: p.rule.id, title: p.rule.title, proposed_at: p.proposed_at })),
      }));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decide/rules/:id ──
  router.get('/v1/ai/decide/rules/:id', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const rule = await getRule(storage, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string);
      // A rule this kind of caller may not run reads as absent: it is not theirs to study either.
      if (!rule || !useAllows(rule, ruleCallerKind(decideCallerOf(req, config.nodeId)))) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such decision rule.'));
      }
      res.json(success(config.nodeId, { rule }));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/decide/rules/:id ── create or replace
  router.put('/v1/ai/decide/rules/:id', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const out = await putRule(storage, config, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string, req.body);
      res.status(out.created ? 201 : 200).json(success(config.nodeId, { rule: out.rule }, [
        { description: 'Try it on its sample', method: 'POST', url: `/v1/ai/decide/rules/${out.rule.id}/try` },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── DELETE /v1/ai/decide/rules/:id ── the decisions it made stay on the register
  router.delete('/v1/ai/decide/rules/:id', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const gone = await deleteRule(storage, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string);
      if (!gone) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such decision rule.'));
      res.json(success(config.nodeId, { deleted: true }));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/rules/:id/try ── run the sample (or a state given here). A real, paid call.
  router.post('/v1/ai/decide/rules/:id/try', requireAuth(), requireOwnerPrincipal(), aiRateLimit, async (req: Request, res: Response) => {
    const gaii = decideOwnerOf(req.auth!, config.nodeId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const rule = await getRule(storage, gaii, req.params.id as string);
      if (!rule) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such decision rule.'));
      const state = body.state !== undefined ? body.state : rule.sample;
      if (state === null || state === undefined) {
        return res.status(400).json(error(config.nodeId, 'NO_SAMPLE', 'This rule has no sample. Give it one, or send a state to try.'));
      }
      const r = await decideForOwner(storage, config, decideCallerOf(req, config.nodeId), {
        rule: rule.id, state, subject: `decide.rules.${rule.id}`, trial: true,
      });
      res.json(success(config.nodeId, r));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/rule-proposals ── an agent proposes; nothing is created
  router.post('/v1/ai/decide/rule-proposals', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const roles = req.auth!.roles;
    if (roles.includes('app') || roles.includes('ecosystem')) {
      return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is for the account holder and their own agents. An app cannot propose a decision rule.'));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const out = await proposeRule(storage, config, decideOwnerOf(req.auth!, config.nodeId),
        resolveIdentity(req.auth!, config.nodeId), { rule: body.rule, reason: body.reason });
      res.status(202).json(success(config.nodeId, {
        proposal_id: out.proposal.id,
        rule_id: out.proposal.rule.id,
        already_waiting: out.alreadyWaiting,
        next_step: `Nothing has been created. "${out.proposal.rule.title}" is waiting for the owner to approve it: in their open items, or under Settings, AI, Decision model.`,
      }));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/rule-proposals/:id/approve ── the owner's press creates the rule
  router.post('/v1/ai/decide/rule-proposals/:id/approve', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const rule = await approveRuleProposal(storage, config, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string);
      if (!rule) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such proposal.'));
      res.status(201).json(success(config.nodeId, { rule }));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/rule-proposals/:id/decline ──
  router.post('/v1/ai/decide/rule-proposals/:id/decline', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const ok = await declineRuleProposal(storage, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string);
      if (!ok) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such proposal.'));
      res.json(success(config.nodeId, { declined: true }));
    } catch (e) { fail(res, e); }
  });

  return router;
}
