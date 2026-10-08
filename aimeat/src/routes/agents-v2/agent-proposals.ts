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
 * @structure nextStep() · registerAgentProposalRoutes()
 * @usage registerAgentProposalRoutes(router, config, storage);
 * @version-history
 *   v1.5.0 — 2026-10-08 — With no connector connected, the answer carries `waiting_for_connector`
 *     and says the agent gets its key when the connector connects (services/agent-pending-enrolment.ts).
 *   v1.4.0 — 2026-10-02 — Approval decides the run mode again against the connected connector
 *     (a `resident` proposal on a spawning connector is made as spawn, and the answer carries
 *     `run_mode_corrected`), and adds ai:use when the owner's crews think through the node
 *     (services/agent-proposals.ts proposalRunModeFor, proposalScopesFor).
 *   v1.3.0 — 2026-10-02 — Approval gives the agent the crew runtime's scopes (memory:read,
 *     memory:write) whatever the proposal says, so no proposal makes an agent that cannot start.
 *   v1.2.0 — 2026-10-02 — The proposal answer carries `approval_url` and `already_waiting`, and its
 *     `next_step` names the address (services/agent-proposals.ts proposalNextStep). The MCP tool
 *     already said whether the name was waiting; the REST answer, which the connector and the fleet
 *     daemon relay, did not.
 *   v1.1.0 — 2026-09-08 — Approve CREDENTIALS the agent too, through services/agent-enrolment-offer.
 *     It stopped at the seed and told the owner to start their connector, which mints no enrolment
 *     grant: the agent had no key, no token, never reached `serve.json` and never ran. A connector
 *     that cannot be reached now leaves the agent standing and says so, with the attach route in
 *     the answer, because that state is repairable in one press where a missing definition is not.
 *   v1.0.0 — 2026-09-02 — Initial. Replaces crew-forge as how an agent comes into being.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../../auth/middleware.js';
import { buildGAII } from '../../utils/gaii.js';
import { crewSeedAuthored, type CrewCaller } from '../../services/crew-ops.js';
import { offerEnrolment } from '../../services/agent-enrolment-offer.js';
import { emitChange } from '../../services/event-bus.js';
import { recordAccountEvent } from '../../services/account-events.js';
import {
  proposeAgent, listProposals, readProposal, settleProposal, proposalApprovalUrl, proposalNextStep,
  proposalRunModeFor, proposalScopesFor, type ProposerPrincipal,
} from '../../services/agent-proposals.js';
import { logger } from '../../utils/logger.js';

const VALID_MODES = ['autonomous', 'interactive', 'task-runner', 'coordinator', 'workstation'];
const VALID_RUN_MODES = ['resident', 'spawn'];

/**
 * What is true now and what the person does next, in one sentence, for the four states an approval
 * can land in. Written out rather than assembled from fragments because the wrong half of this
 * sentence is what cost six days: "start your connector and it will come up" was said about an
 * agent that had no credentials, so starting the connector changed nothing.
 *
 * `waiting` is the case with no connector connected at all. Since 2026-10-08 that one IS true to
 * say "it starts when your connector connects": the connect offers the key on its own
 * (services/agent-pending-enrolment.ts). A connector that was reached and did not take the agent
 * is a different case, and it still needs the person.
 */
function nextStep(displayName: string, defined: boolean, attached: boolean, waiting: boolean): string {
  if (attached && defined) return `${displayName} is running: it has its instructions and your connector has taken it on.`;
  if (attached) return `${displayName} exists and your connector has taken it on. It needs a crew definition before it can run.`;
  if (waiting && defined) return `${displayName} exists and has its instructions. It is waiting for your connector: when your connector connects, it gets its key and starts, with nothing for you to press.`;
  if (waiting) return `${displayName} exists and is waiting for your connector, which gives it its key when it connects. It needs a crew definition before it can run.`;
  if (defined) return `${displayName} exists and has its instructions, but your connector did not take it on. Update your connector and press Attach.`;
  return `${displayName} exists. It needs a crew definition, and your connector did not take it on.`;
}

/** The refusals that mean "no connector is connected", which the next connect repairs on its own. */
const NO_CONNECTOR = new Set(['NO_DAEMON', 'DAEMON_NOT_CONNECTED']);

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
    const approvalUrl = proposalApprovalUrl(config.baseUrl);
    res.status(201).json(success(config.nodeId, {
      proposal: out.proposal,
      created: false,
      already_waiting: out.alreadyWaiting ?? false,
      approval_url: approvalUrl,
      // Said plainly, because an agent relaying this to a person should be able to say it as-is.
      next_step: proposalNextStep(out.proposal.display_name, approvalUrl, out.alreadyWaiting ?? false),
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
    // What any crew agent needs to start, whatever the proposer wrote (services/agent-proposals.ts
    // proposalScopesFor: the runtime's words, and ai:use when the owner's crews think through the
    // node). A proposal stored before 2026-10-02 can lack them, and an agent approved with
    // memory:write alone could not read its own definition and never ran. Proposing adds them too,
    // so the owner sees them on the proposal; this is the same list again.
    const scopes = await proposalScopesFor({ config, storage }, owner, proposal.scopes);
    // The run mode the connected connector can run, decided again now: the proposal may be older
    // than the connector, and an approved `resident` agent on a spawning connector sits active and
    // never runs (measured 2026-10-02 on a hosted place).
    const runMode = proposalRunModeFor(owner, proposal.run_mode);
    const runModeCorrected = runMode.corrected ?? proposal.run_mode_corrected ?? null;
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
      defaultScopes: scopes,
      trustScore: 50,
      morselBalance: 0,
      createdAt: now,
      lastSeen: now,
      mode: proposal.mode as never,
      tags: ['agent.proposed'],
      runMode: runMode.run_mode as never,
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

    // ── Credentials, so something actually runs it ──
    //
    // WHY THIS IS HERE AND NOT LEFT TO A RESTART. Until 2026-09-08 this route stopped at the seed
    // and told the owner to start their connector. That sentence was not true: a connector start
    // mints no enrolment grant, so the agent had no key and no token, never appeared in the
    // daemon's `serve.json`, and never reached the spawner's roster. It existed, fully defined, and
    // nothing ever ran it.
    //
    // WHY A FAILURE HERE DOES NOT UNDO THE AGENT, where a failed seed does. The seed is about what
    // the agent IS, and one with nothing to be cannot be fixed afterwards. Credentials are about
    // what is running right now on a machine the owner may simply not have switched on, and that
    // state is repairable in one press: POST /v1/agents/v2/agents/:name/attach. So an unreachable
    // connector leaves the agent standing and says so, rather than throwing away an approval the
    // owner just made.
    const enrolment = await offerEnrolment({ config, storage }, owner, [{
      name: proposal.name,
      gaii,
      displayName: proposal.display_name,
      description: proposal.purpose,
      runMode: runMode.run_mode,
      mode: proposal.mode,
      // From the record we just wrote: the proposal the owner approved, with the runtime's words.
      scopes,
    }]);

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
      enrolled: enrolment.ok,
    });
    res.json(success(config.nodeId, {
      created: true,
      agent: { name: proposal.name, gaii, mode: proposal.mode, run_mode: runMode.run_mode, scopes },
      // The run mode the proposer asked for and this account's connector cannot run, when the
      // agent was made with the one it can; null when what was asked is what was made.
      run_mode_corrected: runModeCorrected,
      seeded: !!proposal.crew_def,
      attached: enrolment.ok,
      // The reason, verbatim, when it is not attached: "unconnected" without a why sends the owner
      // looking at the wrong machine.
      attach_problem: enrolment.ok ? null : { code: enrolment.code, message: enrolment.message },
      // True when no connector was connected: the agent gets its key when one connects.
      waiting_for_connector: !enrolment.ok && NO_CONNECTOR.has(enrolment.code),
      next_step: nextStep(proposal.display_name, !!proposal.crew_def, enrolment.ok,
        !enrolment.ok && NO_CONNECTOR.has(enrolment.code)),
    }, [
      { description: 'See it in your fleet', method: 'GET', url: `/v1/agents?owner=${owner}` },
      ...(enrolment.ok ? [] : [{
        description: 'Attach it once the connector is running',
        method: 'POST',
        url: `/v1/agents/v2/agents/${encodeURIComponent(proposal.name)}/attach`,
      }]),
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
