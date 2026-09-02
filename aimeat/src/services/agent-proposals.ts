/**
 * @file src/services/agent-proposals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent PROPOSES a new agent; the owner approves; the node creates it.
 *
 *   THIS REPLACES crew-forge, and the reasoning is in the tombstone where its template stood
 *   (src/data/basic-agents.ts). In short: creating an agent is two data writes — a record and a
 *   definition at `crews.registry.<agent>` — and the spawner runs whatever the roster says, so it
 *   does not need an agent of its own. Writing a GOOD definition is a reasoning task, and the
 *   strongest model the owner has is the one they are already talking to.
 *
 *   THE SHAPE IS THE ONE `requestBasicAgents` ALREADY HAD, generalised from three fixed agents to
 *   one proposed agent: an agent asks, it lands on the owner's open-items list, and the owner
 *   approves in their own session through an owner-gated route. Nothing here creates anything.
 *   That separation is the point — the moment an account gains a new principal is exactly the
 *   moment the design says a person belongs in.
 *
 *   THE PROPOSAL IS A MEMORY RECORD, not a table. One key per proposal under
 *   `agents.proposals.<id>` in the owner's own namespace, which is where the owner can already
 *   read, list and delete it with tools they have. A new table would need a reason memory could
 *   not cover, and there isn't one: a proposal is a small document with a lifecycle of exactly two
 *   states.
 *
 *   TWO CEILINGS, BOTH ALREADY WRITTEN. A proposer may not ask for a scope it does not itself hold
 *   (`uncoveredScopes`, the same helper the device-auth escalation check uses, so the two cannot
 *   disagree), and no proposal may exceed what this node allows at all. Neither is re-implemented
 *   here.
 * @structure AgentProposal · proposeAgent() · listProposals() · readProposal() · settleProposal()
 * @usage
 *   const out = await proposeAgent({ config, storage }, principal, { name, purpose, scopes });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial, replacing crew-forge as the way an agent comes into being.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CrewDefDoc } from '../data/basic-agents.js';
import { uncoveredScopes } from '../utils/scope-coverage.js';
import { addItem, listItems, closeItem } from './open-items.js';
import { logger } from '../utils/logger.js';

/** Where one proposal lives. The prefix is listable, so the owner's tools can find them all. */
export const PROPOSAL_KEY_PREFIX = 'agents.proposals.';

export type ProposalState = 'proposed' | 'approved' | 'declined';

export interface AgentProposal {
  id: string;
  /** The bare agent name the proposer suggests. The GAII is built at creation, never here. */
  name: string;
  display_name: string;
  /** Why this agent should exist, in the proposer's words. This is what the owner reads. */
  purpose: string;
  scopes: string[];
  mode: string;
  run_mode: string;
  /** What it would BE. Optional: an owner may approve a proposal and seed it later. */
  crew_def: CrewDefDoc | null;
  /** Who asked. A GAII, or the owner's own name when a person drafted it in their session. */
  proposed_by: string;
  proposed_at: string;
  state: ProposalState;
  settled_at: string | null;
  /** The open-items row this proposal put on the owner's list, so settling can close it. */
  item_id: string | null;
}

export interface ProposalContext { config: AimeatConfig; storage: Storage }

type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

const proposalKey = (id: string) => `${PROPOSAL_KEY_PREFIX}${id}`;

/** Only a name a GAII can carry, and one a person can say. Matches the agent-name rule elsewhere. */
const NAME_SHAPE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export interface ProposerPrincipal {
  /** The full identity that is asking: a GAII, or the bare owner name for an owner session. */
  sub: string;
  owner: string;
  roles: string[];
  scopes: string[];
}

/**
 * Put a proposed agent in front of its owner. CREATES NOTHING.
 *
 * `forOwner` is what the caller said the agent is for; it must be the caller's own owner. A
 * proposal for somebody else's account is refused rather than quietly retargeted, which is the
 * same rule the enrolment and basic-agents doors already apply.
 */
export async function proposeAgent(
  ctx: ProposalContext,
  principal: ProposerPrincipal,
  input: {
    name: string; display_name?: string; purpose: string; scopes?: string[];
    mode?: string; run_mode?: string; crew_def?: CrewDefDoc | null; for_owner?: string;
  },
): Promise<{ ok: true; proposal: AgentProposal } | Fail> {
  const { config, storage } = ctx;

  // An app grant is consent to USE this account; an ecosystem app is a different principal class
  // with its own onboarding. Neither has any business adding a principal to somebody's account.
  if (principal.roles.includes('app') || principal.roles.includes('ecosystem')) {
    return fail(403, 'ACCESS_DENIED',
      'This is for the account holder and their own agents. An app cannot propose a new agent on your behalf.');
  }

  const owner = principal.owner;
  if (input.for_owner && input.for_owner !== owner) {
    return fail(403, 'ACCESS_DENIED',
      'You can only propose an agent for your own account.');
  }

  const name = String(input.name ?? '').trim();
  if (!NAME_SHAPE.test(name)) {
    return fail(400, 'INVALID_INPUT',
      'An agent name is 3 to 40 characters, lowercase letters, digits and hyphens, starting with a letter.');
  }
  const purpose = String(input.purpose ?? '').trim();
  if (purpose.length < 10) {
    return fail(400, 'INVALID_INPUT',
      'Say what this agent is for, in a sentence the owner can decide from.');
  }

  const existing = await storage.getAgentsByOwner(owner);
  if (existing.some(a => a.name === name)) {
    return fail(409, 'NAME_TAKEN', `You already have an agent called "${name}".`);
  }

  // IF A DEFINITION IS OFFERED, IT HAS TO BE ABLE TO RUN. The seed door validates nothing — it
  // cannot, which is its whole justification: there is no runtime to ask, and asking the target's
  // own runtime is the circle that ended crew-forge. So an empty or shapeless definition would be
  // written down happily and then refused by the runtime at first start, which is exactly the
  // "an agent with nothing to be" state the seed exists to remove.
  //
  // This is the cheap subset that decides whether a definition can do anything at all, and the
  // same rule check:crew-defs applies to what this repo ships. crewaimeat's validator remains the
  // authority on everything past it; refusing here means the owner is never shown a proposal that
  // could not have worked.
  const def = input.crew_def ?? null;
  if (def) {
    const agents = Array.isArray(def.agents) ? def.agents : [];
    const tasks = Array.isArray(def.tasks) ? def.tasks : [];
    if (agents.length === 0 || tasks.length === 0) {
      return fail(400, 'INVALID_CREW_DEF',
        'The crew definition needs at least one agent and one task, or the agent has nothing to run.');
    }
    if (!tasks.some(t => typeof t?.description === 'string' && t.description.includes('{{ctx.prompt}}'))) {
      return fail(400, 'INVALID_CREW_DEF',
        'At least one task must take {{ctx.prompt}}, or the agent answers the same thing every run.');
    }
    const roles = new Set(agents.map(x => x?.role));
    const orphan = tasks.find(t => !roles.has(t?.agent));
    if (orphan) {
      return fail(400, 'INVALID_CREW_DEF',
        `Task "${orphan.id}" names "${orphan.agent}", which is not one of the definition's agents.`);
    }
  }

  const scopes = Array.isArray(input.scopes) ? input.scopes.filter(s => typeof s === 'string') : [];

  // THE CEILING. An agent may not propose a principal that can do more than the agent proposing
  // it — otherwise a narrow agent becomes a way to mint a wide one, and the owner approving it is
  // reading a name and a purpose, not a scope diff. The same helper and the same rule as the
  // device-auth escalation check. An OWNER session holds no scopes because its session IS the
  // permission, so the ceiling does not apply to it.
  const isOwnerSession = (principal.roles.includes('owner') || principal.roles.includes('operator'))
    && !principal.roles.includes('agent');
  if (!isOwnerSession) {
    const beyond = uncoveredScopes(principal.scopes, scopes);
    if (beyond.length > 0) {
      return fail(403, 'SCOPE_ESCALATION',
        `You cannot propose an agent that would hold more than you do. Beyond yours: ${beyond.join(', ')}.`);
    }
  }

  const now = new Date().toISOString();
  const proposal: AgentProposal = {
    id: randomUUID(),
    name,
    display_name: String(input.display_name ?? '').trim() || name,
    purpose,
    scopes,
    mode: String(input.mode ?? 'task-runner'),
    run_mode: String(input.run_mode ?? 'spawn'),
    crew_def: input.crew_def ?? null,
    proposed_by: principal.sub,
    proposed_at: now,
    state: 'proposed',
    settled_at: null,
    item_id: null,
  };

  const ownerGhii = `${owner}@${config.nodeId}`;
  const item = await addItem(storage, ownerGhii, {
    title: `Approve a new agent: ${proposal.display_name} — ${purpose.slice(0, 100)}`,
    kind: 'decision',
    origin: principal.sub,
    by: principal.sub === owner ? 'person' : 'ai',
  });
  proposal.item_id = item?.id ?? null;

  await storage.setMemory({
    key: proposalKey(proposal.id),
    ownerGaii: ownerGhii,
    value: proposal as unknown as Record<string, unknown>,
    visibility: 'owner',
    tags: ['agent-proposal'],
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  logger.info('Agent proposed', {
    event: 'agent_v2.proposed', owner, name, by: principal.sub, item: proposal.item_id,
  });
  return { ok: true, proposal };
}

/** Every proposal on this account, newest first. */
export async function listProposals(ctx: ProposalContext, owner: string): Promise<AgentProposal[]> {
  const ownerGhii = `${owner}@${ctx.config.nodeId}`;
  const rows = await ctx.storage.listMemory(ownerGhii, { prefix: PROPOSAL_KEY_PREFIX });
  return rows
    .map(r => r.value as unknown as AgentProposal)
    .filter(p => p && typeof p.id === 'string')
    .sort((a, b) => (b.proposed_at ?? '').localeCompare(a.proposed_at ?? ''));
}

export async function readProposal(ctx: ProposalContext, owner: string, id: string): Promise<AgentProposal | null> {
  const ownerGhii = `${owner}@${ctx.config.nodeId}`;
  const row = await ctx.storage.getMemory(ownerGhii, proposalKey(id));
  return row ? (row.value as unknown as AgentProposal) : null;
}

/** Record the owner's decision on the proposal and close the item it put on their list. */
export async function settleProposal(
  ctx: ProposalContext, owner: string, proposal: AgentProposal, state: 'approved' | 'declined',
): Promise<void> {
  const ownerGhii = `${owner}@${ctx.config.nodeId}`;
  const now = new Date().toISOString();
  const row = await ctx.storage.getMemory(ownerGhii, proposalKey(proposal.id));
  const next: AgentProposal = { ...proposal, state, settled_at: now };
  await ctx.storage.setMemory({
    key: proposalKey(proposal.id),
    ownerGaii: ownerGhii,
    value: next as unknown as Record<string, unknown>,
    visibility: 'owner',
    tags: ['agent-proposal'],
    ttlHours: null,
    version: (row?.version ?? 1) + 1,
    createdAt: row?.createdAt ?? now,
    updatedAt: now,
  });
  if (proposal.item_id) {
    // Best effort: the decision is recorded above, and a stale row on a list is a smaller problem
    // than a failed approval.
    try {
      const items = await listItems(ctx.storage, ctx.config, ownerGhii, owner);
      if (items.some(i => i.id === proposal.item_id)) {
        await closeItem(ctx.storage, ownerGhii, proposal.item_id, 'person');
      }
    } catch (err) {
      logger.warn('Agent proposal: could not close the owner list item', {
        owner, proposal: proposal.id, error: String(err),
      });
    }
  }
}
