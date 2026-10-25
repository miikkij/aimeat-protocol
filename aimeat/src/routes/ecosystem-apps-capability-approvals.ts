/**
 * @file src/routes/ecosystem-apps-capability-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's answer to another account's capability that asks their outside
 *   (ecosystem) app to run one of its actions (services/eco-capability-approvals.ts). A refused call
 *   names the page /v1/eco-capability-allow?app=&capability= (views/eco-capability-allow.js) and the
 *   bell notice carries Allow; both reach the routes below.
 * @structure registerEcoCapabilityApprovalRoutes(router, config, storage)
 *   - GET    /v1/ecosystem-apps/:app/capability-approval?capability=   — read the question (in person)
 *   - POST   /v1/ecosystem-apps/:app/capability-approvals              — allow it (in person)
 *   - POST   /v1/ecosystem-apps/:app/capability-approvals/decline      — say no (in person)
 *   - DELETE /v1/ecosystem-apps/:app/capability-approvals?capability=  — withdraw (owner)
 * @usage registerEcoCapabilityApprovalRoutes(router, config, storage) from ecosystemAppsRouter().
 * @version-history
 *   2026-10-25 — Allow and Don't allow tell the one whose call asked (secaudit2026oct22, the approval standard).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, capability-invoke.ts ecosystem source, r45).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import {
  readEcoCapabilityApproval, approveEcoCapabilityUse, declineEcoCapabilityUse, withdrawEcoCapabilityApproval,
} from '../services/eco-capability-approvals.js';

export function registerEcoCapabilityApprovalRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const gate = [requireAuth(), requireRole('owner')];

  // Reading the question and answering it are the account holder's in person: the answer decides
  // what another account may have the person's own app do as them, and no agent, app or outside app
  // answers that for them. A narrowing (withdraw) is open to the owner role.
  const inPerson = (req: Request, res: Response): string | null => {
    const caller = callerOf(req, config.nodeId, storage);
    if (!caller.inPerson) {
      res.status(403).json(error(config.nodeId, 'IN_PERSON_ONLY',
        'Only the account holder, signed in, answers what another account may have their outside app do. Open this page while signed in to your own account.'));
      return null;
    }
    return caller.owner;
  };
  const capabilityOf = (src: unknown): string => {
    const v = (src as Record<string, unknown> | undefined)?.capability;
    return typeof v === 'string' ? v : '';
  };
  const missing = (res: Response) => res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
    'Name the capability: { "capability": "<capability id>" }.'));

  router.get('/v1/ecosystem-apps/:app/capability-approval', ...gate, async (req, res) => {
    const owner = inPerson(req, res);
    if (!owner) return;
    const capability = capabilityOf(req.query);
    if (!capability) { missing(res); return; }
    const view = await readEcoCapabilityApproval(storage, config.nodeId, owner, req.params.app as string, capability);
    if (!view) {
      res.status(404).json(error(config.nodeId, 'APPROVAL_NOT_FOUND', 'Nothing about this capability is waiting on this outside app.'));
      return;
    }
    res.json(success(config.nodeId, view));
  });

  router.post('/v1/ecosystem-apps/:app/capability-approvals', ...gate, async (req, res) => {
    const owner = inPerson(req, res);
    if (!owner) return;
    const capability = capabilityOf(req.body);
    if (!capability) { missing(res); return; }
    const caller = callerOf(req, config.nodeId, storage);
    const r = await approveEcoCapabilityUse(storage, config.nodeId, owner, req.params.app as string, capability, caller.principal, config);
    if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
    res.json(success(config.nodeId, { approval: r.approval }));
  });

  router.post('/v1/ecosystem-apps/:app/capability-approvals/decline', ...gate, async (req, res) => {
    const owner = inPerson(req, res);
    if (!owner) return;
    const capability = capabilityOf(req.body);
    if (!capability) { missing(res); return; }
    const declined = await declineEcoCapabilityUse(storage, config.nodeId, owner, req.params.app as string, capability,
      { config, by: callerOf(req, config.nodeId, storage).principal });
    res.json(success(config.nodeId, { declined }));
  });

  router.delete('/v1/ecosystem-apps/:app/capability-approvals', ...gate, async (req, res) => {
    const capability = capabilityOf(req.query);
    if (!capability) { missing(res); return; }
    const owner = callerOf(req, config.nodeId, storage).owner;
    const withdrawn = await withdrawEcoCapabilityApproval(storage, config.nodeId, owner, req.params.app as string, capability);
    if (!withdrawn) {
      res.status(404).json(error(config.nodeId, 'APPROVAL_NOT_FOUND', 'Nothing about this capability is kept on this outside app.'));
      return;
    }
    res.json(success(config.nodeId, { withdrawn: true }));
  });
}
