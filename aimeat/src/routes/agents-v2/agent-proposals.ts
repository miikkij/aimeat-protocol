/**
 * @file src/routes/agents-v2/agent-proposals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three doors of "an agent proposes a new agent, the owner approves it".
 *
 *   POST   /v1/agents/v2/agent-proposals              any same-owner principal; CREATES NOTHING
 *   GET    /v1/agents/v2/agent-proposals              what is waiting, and what was decided
 *   POST   /v1/agents/v2/agent-proposals/:id/approve  OWNER ONLY; creates and seeds, atomically
 *   POST   /v1/agents/v2/agent-proposals/:id/decline  OWNER ONLY
 *
 *   WHY THE APPROVE DOOR IS OWNER-ONLY AND NOT `requireRole('owner')`. `req.auth!.owner` carries
 *   the human's name on agent JWTs, app grants and PATs alike, so a role check admits everything
 *   acting in this person's name. Adding a principal to an account is a change to the account
 *   itself, so it takes `requireOwnerPrincipal()` — the same gate the basic-agents button uses, for
 *   the same reason.
 *
 *   CREATE AND SEED ARE ONE STEP. An agent that exists with nothing to be is the state the seed
 *   exists to remove: crewaimeat's runtime refuses to start one ("an agent with no definition has
 *   nothing to be"), and `aimeat_crew_publish` cannot fix it afterwards because it asks the target's
 *   runtime to validate and a new agent has none. That circle is what ended crew-forge. So the
 *   definition goes down with the record or neither does, and a failed seed deletes the agent.
 * @structure registerAgentProposalRoutes()
 * @usage registerAgentProposalRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial. Replaces crew-forge as how an agent comes into being.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../../auth/middleware.js';
import { buildGAII } from '../../utils/gaii.js';
import { crewSeedAuthored, type CrewCaller } from '../../services/crew-ops.js';
import { emitChange } from '../../services/event-bus.js';
import { recordAccountEvent } from '../../services/account-events.js';
import {
  proposeAgent, listProposals, readProposal, settleProposal, type ProposerPrincipal,
} from '../../services/agent-proposals.js';
import { logger } from '../../utils/logger.js';

const VALID_MODES = ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'];
const VALID_RUN_MODES = ['resident', 'spawn'];

export function registerAgentProposalRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // ── PROPOSE. Creates nothing; puts it in front of the owner. ────────────────
  // `memory:write` is the gate the sibling ask-route already uses (basic-agents/request), and it
  // is the honest one: a proposal IS a memory write — a record under `agents.proposals.` plus a row
  // on the owner's open-items list. Middleware, not a check inside the handler, because a mutating
  // route behind requireAuth() alone is reachable by any app-grant token whatever single scope its
  // owner approved. The app/ecosystem refusal below is the SECOND condition, not the first.
  router.post('/v1/agents/v2/agent-proposals', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const principal: ProposerPrincipal = {
      sub: req.auth!.sub,
      owner: req.auth!.owner,
      roles: (req.auth!.roles ?? []) as string[],
      scopes: (req.auth!.scopes ?? []) as string[],
    };
    const body = req.body ?? {};

    if (body.mode !== undefined && !VALID_MODES.includes(body.mode)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `mode must be one of: ${VALID_MODES.join(', ')}`));
      return;
    }
    if (body.run_mode !== undefined && !VALID_RUN_MODES.includes(body.run_mode)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `run_mode must be one of: ${VALID_RUN_MODES.join(', ')}`));
      return;
    }

    const out = await proposeAgent({ config, storage }, principal, body);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.status(201).json(success(config.nodeId, {
      proposal: out.proposal,
      created: false,
      // Said plainly, because an agent relaying this to a person should be able to say it as-is.
      next_step: `Nothing has been created. ${out.proposal.display_name} is waiting for you to approve it in your profile under Agents.`,
    }, [
      { description: 'The owner approves it', method: 'POST', url: `/v1/agents/v2/agent-proposals/${out.proposal.id}/approve` },
      { description: 'See it in the profile', method: 'GET', url: '/v1/profile?tab=agents' },
    ]));
    emitChange('open-items');
  });

  // ── LIST ───────────────────────────────────────────────────────────────────
  router.get('/v1/agents/v2/agent-proposals', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const roles = (req.auth!.roles ?? []) as string[];
    if (roles.includes('app') || roles.includes('ecosystem')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is for the account holder and their own agents.'));
      return;
    }
    const proposals = await listProposals({ config, storage }, req.auth!.owner);
    res.json(success(config.nodeId, { proposals, waiting: proposals.filter(p => p.state === 'proposed').length }));
  });

  // ── APPROVE. The owner, in person. Creates AND seeds, or does neither. ─────
  router.post('/v1/agents/v2/agent-proposals/:id/approve', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner;
    const id = req.params.id as string;

    const proposal = await readProposal({ config, storage }, owner, id);
    if (!proposal) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such proposal on this account.'));
      return;
    }
    if (proposal.state !== 'proposed') {
      res.status(409).json(error(config.nodeId, 'ALREADY_SETTLED',
        `This proposal was already ${proposal.state}.`));
      return;
    }

    // Re-checked at approval, not only at proposal: the name may have been taken in between, and
    // the owner is approving a NAME as much as a purpose.
    const existing = await storage.getAgentsByOwner(owner);
    if (existing.some(a => a.name === proposal.name)) {
      res.status(409).json(error(config.nodeId, 'NAME_TAKEN',
        `You already have an agent called "${proposal.name}". Nothing was created.`));
      return;
    }

    const now = new Date().toISOString();
    const gaii = buildGAII(proposal.name, owner, config.nodeId);
    await storage.createAgent({
      name: proposal.name,
      owner,
      gaii,
      displayName: proposal.display_name,
      description: proposal.purpose,
      capabilities: [],
      // No key yet: the agent brings its own at enrolment and it is pinned there, exactly as the
      // basic-agents button leaves it.
      publicKey: '',
      defaultScopes: proposal.scopes,
      trustScore: 50,
      morselBalance: 0,
      createdAt: now,
      lastSeen: now,
      mode: proposal.mode as never,
      tags: ['agent.proposed'],
      runMode: proposal.run_mode as never,
      identityVersion: 2,
      // WHO ASKED, not who approved. `registeredBy` is the creation ledger and the fence the
      // sibling-delete gate reads; the owner approving is recorded as an account event below.
      registeredBy: proposal.proposed_by,
    });

    // ── Something to BE, or nothing at all ──
    if (proposal.crew_def) {
      const seedCaller: CrewCaller = {
        principal: `${owner}@${config.nodeId}`,
        owner,
        scopes: ['memory:write'],
        roles: ['owner'],
        pipeline: 'rest.agent-proposal.seed',
      };
      const record = (await storage.getAgentsByOwner(owner)).find(a => a.name === proposal.name);
      const seeded = record
        ? await crewSeedAuthored({ storage, config }, seedCaller, record, proposal.crew_def as unknown as Record<string, unknown>)
        : { ok: false as const, code: 'RECORD_MISSING', message: 'the agent record could not be read back' };

      if (!seeded.ok && seeded.code !== 'ALREADY_DEFINED') {
        // All or nothing. An agent with no definition cannot start and cannot be given one
        // afterwards, so leaving it behind would recreate the exact state this path removes.
        try {
          await storage.deleteAgent(gaii);
        } catch (err) {
          logger.error('Agent proposal rollback failed; an agent may be left without a definition', {
            event: 'agent_v2.proposal_rollback_failed', owner, name: proposal.name, error: String(err),
          });
        }
        logger.warn('Agent proposal seed failed; nothing was created', {
          event: 'agent_v2.proposal_seed_failed', owner, name: proposal.name, reason: seeded.code,
        });
        res.status(502).json(error(config.nodeId, 'CREW_SEED_FAILED',
          `${proposal.display_name} could not be given anything to run, so it was not made. Nothing changed.`));
        return;
      }
    }

    await settleProposal({ config, storage }, owner, proposal, 'approved');

    void recordAccountEvent(storage, {
      ownerGhii: `${owner}@${config.nodeId}`,
      kind: 'agent_connected',
      actorGaii: proposal.proposed_by,
      subject: gaii,
      link: '/v1/profile?tab=agents',
      data: { name: proposal.name, via: 'proposal' },
    }, config);

    logger.info('Agent proposal approved', {
      event: 'agent_v2.proposal_approved', owner, name: proposal.name, by: proposal.proposed_by,
    });
    res.json(success(config.nodeId, {
      created: true,
      agent: { name: proposal.name, gaii, mode: proposal.mode, run_mode: proposal.run_mode, scopes: proposal.scopes },
      seeded: !!proposal.crew_def,
      next_step: proposal.crew_def
        ? `${proposal.display_name} exists and has its instructions. Start your connector and it will come up.`
        : `${proposal.display_name} exists. It needs a crew definition before it can run.`,
    }, [
      { description: 'See it in your fleet', method: 'GET', url: `/v1/agents?owner=${owner}` },
    ]));
    emitChange('agents');
  });

  // ── DECLINE ────────────────────────────────────────────────────────────────
  router.post('/v1/agents/v2/agent-proposals/:id/decline', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner;
    const proposal = await readProposal({ config, storage }, owner, req.params.id as string);
    if (!proposal) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such proposal on this account.'));
      return;
    }
    if (proposal.state !== 'proposed') {
      res.status(409).json(error(config.nodeId, 'ALREADY_SETTLED', `This proposal was already ${proposal.state}.`));
      return;
    }
    await settleProposal({ config, storage }, owner, proposal, 'declined');
    res.json(success(config.nodeId, { declined: true, created: false }));
    emitChange('open-items');
  });
}
