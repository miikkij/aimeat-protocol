/**
 * @file src/routes/kyc/routes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Customer due diligence (EU AMLR 2024/1624) over REST: an obliged organism's customer
 *   cards, its suspicions and their goAML drafts, its KYC settings; a person's own verification history
 *   and the organisms they gave it to; the customer's identify link; and the operator's counts.
 *
 *   Every door calls the services in services/kyc/, which decide who may do what (access.ts); the MCP
 *   tools (mcp/kyc.ts) call the same functions. Each writing door checks its body with a bounded schema
 *   first (bodies.ts). The operator's view counts and never names: no customer, no suspicion, no
 *   organism's cards (the operator is not the firm).
 * @structure kycRouter(config, storage)
 * @version-history
 *   v1.1.0 — 2026-11-19 — Moved to routes/kyc/; every writing door validates its body (bodies.ts), the
 *     person's own and the link doors ask the compliance words, the operator's doors ask requireOperator.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOperator, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { validateBody } from '../../models/schemas.js';
import { COMPLIANCE_READ_SCOPE, COMPLIANCE_WRITE_SCOPE } from '../../utils/scope-coverage.js';
import { KycError } from '../../services/kyc/access.js';
import {
  approveCustomer, customerAsOf, decideHit, endCustomer, extendHold, listCustomers, openCustomer, readCustomer,
  readSettingsFor, recordIdentity, reviewCustomer, screenCustomer, updateCustomer, updateSettings,
} from '../../services/kyc/cards.js';
import {
  assistNarrative, closeSuspicion, listSuspicions, markSuspicion, readSuspicion, submitSuspicion, updateSuspicion,
} from '../../services/kyc/reports.js';
import { acceptLink, createLink, describeLink } from '../../services/kyc/identify.js';
import { kycMine, kycOperatorView, kycOrganismsOf, kycRefreshLists } from '../../services/kyc/overview.js';
import {
  CloseBody, CustomerBody, EmptyBody, EndBody, HitBody, HoldBody, IdentityBody, MarkBody, NoteBody, SettingsBody, SubmitBody, SuspicionDraftBody,
} from './bodies.js';

export function kycRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const caller = (req: Request) => callerOf(req, config.nodeId, storage);
  const p = (req: Request, name: string): string => String(req.params[name] ?? '');
  const body = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {});
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  /** Run a service call and answer its result, or its refusal as the envelope. */
  const answer = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(success(config.nodeId, await fn(req)));
    } catch (err) {
      if (!(err instanceof KycError)) throw err;
      res.status(err.status).json(error(config.nodeId, err.code, err.message, err.status));
    }
  };
  const R = [requireAuth(), requireScope(COMPLIANCE_READ_SCOPE)];
  const W = [requireAuth(), requireScope(COMPLIANCE_WRITE_SCOPE)];
  const OP = [requireAuth(), requireOperator(storage)];

  // ── The person's own: verification history, disclosures, and the organisms they do KYC in ──
  router.get('/v1/kyc/me', ...R, answer(req => kycMine(deps, caller(req))));
  router.get('/v1/kyc/organisms', ...R, answer(req => kycOrganismsOf(deps, caller(req))));

  // ── The identify link (the customer, signed in, in person) ──
  router.get('/v1/kyc/links/:token', ...R, answer(req => describeLink(deps, caller(req), p(req, 'token'))));
  router.post('/v1/kyc/links/:token', ...W, validateBody(EmptyBody, config.nodeId), answer(req => acceptLink(deps, caller(req), p(req, 'token'))));

  // ── The operator's counts (no names) ──
  router.get('/v1/admin/kyc', ...OP, answer(req => kycOperatorView(deps, caller(req))));
  router.post('/v1/admin/kyc/lists/refresh', ...OP, validateBody(EmptyBody, config.nodeId), answer(req => kycRefreshLists(deps, caller(req))));

  // ── Settings ──
  router.get('/v1/kyc/:org/settings', ...R, answer(req => readSettingsFor(deps, caller(req), p(req, 'org'))));
  router.put('/v1/kyc/:org/settings', ...W, validateBody(SettingsBody, config.nodeId), answer(req => updateSettings(deps, caller(req), p(req, 'org'), body(req))));

  // ── Customer cards ──
  router.get('/v1/kyc/:org/customers', ...R, answer(req => listCustomers(deps, caller(req), p(req, 'org'), {
    due: req.query.due === 'true' || req.query.due === '1', status: str(req.query.status) || undefined,
  })));
  router.post('/v1/kyc/:org/customers', ...W, validateBody(CustomerBody, config.nodeId), answer(req => openCustomer(deps, caller(req), p(req, 'org'), body(req))));
  router.get('/v1/kyc/:org/customers/:id', ...R, answer(req => {
    const asOf = str(req.query.as_of);
    return asOf ? customerAsOf(deps, caller(req), p(req, 'org'), p(req, 'id'), asOf) : readCustomer(deps, caller(req), p(req, 'org'), p(req, 'id'));
  }));
  router.patch('/v1/kyc/:org/customers/:id', ...W, validateBody(CustomerBody, config.nodeId), answer(req => {
    const { note, ...fields } = body(req);
    return updateCustomer(deps, caller(req), p(req, 'org'), p(req, 'id'), fields, str(note) || undefined);
  }));
  router.post('/v1/kyc/:org/customers/:id/identity', ...W, validateBody(IdentityBody, config.nodeId), answer(req => {
    const { note, ...identity } = body(req);
    return recordIdentity(deps, caller(req), p(req, 'org'), p(req, 'id'), identity, str(note) || undefined);
  }));
  router.post('/v1/kyc/:org/customers/:id/screen', ...W, validateBody(EmptyBody, config.nodeId), answer(req => screenCustomer(deps, caller(req), p(req, 'org'), p(req, 'id'))));
  router.post('/v1/kyc/:org/customers/:id/hits', ...W, validateBody(HitBody, config.nodeId), answer(req => {
    const b = body(req);
    const verdict = b.verdict === 'confirmed' ? 'confirmed' : 'false-positive';
    return decideHit(deps, caller(req), p(req, 'org'), p(req, 'id'), { source: str(b.source), id: str(b.hit_id), subject: str(b.subject) || 'customer' }, verdict, str(b.note));
  }));
  router.post('/v1/kyc/:org/customers/:id/approve', ...W, validateBody(NoteBody, config.nodeId), answer(req => approveCustomer(deps, caller(req), p(req, 'org'), p(req, 'id'), str(body(req).note))));
  router.post('/v1/kyc/:org/customers/:id/review', ...W, validateBody(NoteBody, config.nodeId), answer(req => reviewCustomer(deps, caller(req), p(req, 'org'), p(req, 'id'), str(body(req).note))));
  router.post('/v1/kyc/:org/customers/:id/end', ...W, validateBody(EndBody, config.nodeId), answer(req => endCustomer(deps, caller(req), p(req, 'org'), p(req, 'id'), str(body(req).note) || undefined, str(body(req).ended_at) || undefined)));
  router.post('/v1/kyc/:org/customers/:id/hold', ...W, validateBody(HoldBody, config.nodeId), answer(req => extendHold(deps, caller(req), p(req, 'org'), p(req, 'id'), str(body(req).until), str(body(req).basis))));
  router.post('/v1/kyc/:org/customers/:id/link', ...W, validateBody(EmptyBody, config.nodeId), answer(req => createLink(deps, caller(req), p(req, 'org'), p(req, 'id'))));

  // ── Suspicions and the goAML draft (officers in person; marking is open to the staff and their agents) ──
  router.post('/v1/kyc/:org/suspicions', ...W, validateBody(MarkBody, config.nodeId), answer(req => markSuspicion(deps, caller(req), p(req, 'org'), {
    customerId: str(body(req).customer_id) || undefined, observation: str(body(req).observation),
  })));
  router.get('/v1/kyc/:org/suspicions', ...R, answer(req => listSuspicions(deps, caller(req), p(req, 'org'))));
  router.get('/v1/kyc/:org/suspicions/:id', ...R, answer(req => readSuspicion(deps, caller(req), p(req, 'org'), p(req, 'id'))));
  router.patch('/v1/kyc/:org/suspicions/:id', ...W, validateBody(SuspicionDraftBody, config.nodeId), answer(req => updateSuspicion(deps, caller(req), p(req, 'org'), p(req, 'id'), body(req))));
  router.post('/v1/kyc/:org/suspicions/:id/submit', ...W, validateBody(SubmitBody, config.nodeId), answer(req => submitSuspicion(deps, caller(req), p(req, 'org'), p(req, 'id'), {
    goamlRef: str(body(req).goaml_ref), submittedAt: str(body(req).submitted_at) || undefined, decision: str(body(req).decision) || undefined,
  })));
  router.post('/v1/kyc/:org/suspicions/:id/close', ...W, validateBody(CloseBody, config.nodeId), answer(req => closeSuspicion(deps, caller(req), p(req, 'org'), p(req, 'id'), str(body(req).decision))));
  router.post('/v1/kyc/:org/suspicions/:id/assist', ...W, validateBody(EmptyBody, config.nodeId), answer(req => assistNarrative(deps, caller(req), p(req, 'org'), p(req, 'id'))));

  return router;
}
