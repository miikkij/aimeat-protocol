/**
 * @file organism-lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism lifecycle WRITES (create, update, join, leave) as one implementation
 *   for every surface. Until the August 2026 MCP audit these existed twice: once in
 *   src/routes/organisms/crud.ts (POST /v1/organisms, PUT /v1/organisms/:id, POST /:id/join,
 *   POST /:id/leave) and once in src/mcp/organisms.ts (aimeat_organism_create / _update / _join /
 *   _leave), each assembling its own record and calling storage directly.
 *
 *   What the second copy cost, measured on the code that was deleted: an organism created over MCP
 *   wrote no structure snapshot and never reached the public landing feed; a join request made over
 *   MCP notified nobody, so it sat in a list until an admin happened to look; neither MCP write
 *   emitted `organisms` on the change bus, so open SPA tabs kept showing the old roster; and the two
 *   copies stamped the discussion board with different owners. Four side effects, one capability,
 *   and every one of them was invisible from the surface that had them.
 *
 *   The split: this file owns validation, the record shape, id and timestamp generation and the side
 *   effects. Each surface keeps its own gate (who may call) and its own rendering: HTTP renders the
 *   envelope, MCP renders text. A refusal is therefore RETURNED here, never written to a response.
 * @structure
 *   - OrganismRefusal + refuse() — the returned refusal both surfaces render themselves
 *   - createOrganismRecord() — board + organism + creator membership, feed and timeline side effects
 *   - updateOrganismRecord() — validated field updates + the README memory key
 *   - joinOrganism() — direct join or join request, with the approver notifications
 *   - leaveOrganism() — membership removal + roster/admin sync
 * @usage
 *   const r = await createOrganismRecord({ storage, config }, ownerName, { name, visibility });
 *   if (!r.ok) { res.status(r.status).json(error(config.nodeId, r.code, r.message)); return; }
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial: extracted from routes/organisms/crud.ts + mcp/organisms.ts
 *     (August 2026 MCP audit step 8). Collapses four differences between the copies: the board owner
 *     (now always the creator's GHII), the join-request notifications and the change-bus emits (were
 *     REST-only), the timeline + public-feed side effects of create (were REST-only), and update's
 *     enum handling (REST stored anything, MCP dropped invalid values silently; both now refuse).
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord, JoinRequestRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { notify } from './notify.js';
import { recordPublicActivity } from './public-activity.js';
import { recordAccountEvent } from './account-events.js';
import { updateOrganismStructure } from './structure-snapshot.js';
import { getOrganismReadme, setOrganismReadme } from './organism-readme.js';
import { MEMBER_VISIBILITY_VALUES } from './organism-privacy.js';
import { logger } from '../utils/logger.js';
import { isOrganismOwner } from './organism-ownership.js';

export interface OrganismDeps {
  storage: Storage;
  config: AimeatConfig;
}

/** A refusal the caller renders in its own shape: HTTP maps status + code, MCP prints the message. */
export interface OrganismRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

function refuse(status: number, code: string, message: string): OrganismRefusal {
  return { ok: false, status, code, message };
}

const ORGANISM_TYPES: OrganismRecord['type'][] = ['community', 'team', 'club', 'cooperative', 'project'];
const JOIN_POLICIES: OrganismRecord['joinPolicy'][] = ['open', 'approval_required', 'invite_only'];
const VISIBILITIES: OrganismRecord['visibility'][] = ['public', 'listed', 'private'];

/** Accept a known enum value, fall back to the default for anything else (creation is tolerant: both
 *  copies defaulted rather than refused, and a tool that fails on a typo is worse than one that
 *  creates a community). Update is strict; see updateOrganismRecord. */
function pickEnum<T extends string>(allowed: T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export interface CreateOrganismInput {
  name?: unknown;
  description?: unknown;
  type?: unknown;
  location?: unknown;
  interests?: unknown;
  joinPolicy?: unknown;
  maxMembers?: unknown;
  visibility?: unknown;
  memberVisibility?: unknown;
}

/**
 * Create an organism: its discussion board, the record itself and the creator's membership row.
 * `creatorOwner` is the BARE owner name. Membership rows, members[], admins[] and creatorGhii are
 * all keyed that way, and comparing a full GHII against them finds nothing.
 */
export async function createOrganismRecord(
  deps: OrganismDeps,
  creatorOwner: string,
  input: CreateOrganismInput,
): Promise<OrganismRefusal | { ok: true; organism: OrganismRecord }> {
  const { storage, config } = deps;

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 2) return refuse(400, 'INVALID_INPUT', 'Name is required (min 2 characters)');

  const description = typeof input.description === 'string' ? input.description : '';
  const type = pickEnum(ORGANISM_TYPES, input.type, 'community');
  const joinPolicy = pickEnum(JOIN_POLICIES, input.joinPolicy, 'open');
  const visibility = pickEnum(VISIBILITIES, input.visibility, 'public');
  // Roster privacy tier; unset = 'authenticated' (see services/organism-privacy.ts).
  const memberVisibility = MEMBER_VISIBILITY_VALUES.includes(input.memberVisibility as OrganismRecord['memberVisibility'] & string)
    ? (input.memberVisibility as OrganismRecord['memberVisibility'])
    : undefined;
  const maxMembers = Number(input.maxMembers) > 0 ? Number(input.maxMembers) : 500;

  const id = uuidv4();
  const now = new Date().toISOString();
  const boardId = `org-${id}`;

  // The board belongs to the organism's CREATOR, not to whichever principal made the call.
  // routes/boards.ts compares board.ownerGaii by equality for update and delete, so a board stamped
  // with an agent GAII locks the human creator out of the board of their own organism.
  await storage.createBoard({
    id: boardId,
    name: `${name} — Discussion`,
    description: `Discussion board for ${name}`,
    visibility: visibility === 'public' ? 'public' : 'shared',
    ownerGaii: `${creatorOwner}@${config.nodeId}`,
    allowedGaiis: [],
    createdAt: now,
  });

  const organism = await storage.createOrganism({
    id,
    name,
    description,
    type,
    location: (input.location && typeof input.location === 'object' ? input.location : {}) as OrganismRecord['location'],
    interests: Array.isArray(input.interests) ? (input.interests as string[]) : [],
    // creatorGhii is the deprecated mirror of owners[0]; createdBy is the fact that never moves.
    creatorGhii: creatorOwner,
    createdBy: creatorOwner,
    owners: [creatorOwner],
    admins: [creatorOwner],
    members: [creatorOwner],
    agentGaiis: [],
    boardId,
    joinPolicy,
    maxMembers,
    visibility,
    memberVisibility,
    moderationConfig: {
      flagsEnabled: true,
      autoHideThreshold: 3,
      appealsEnabled: true,
    },
    memoryNamespace: `organism.${id}`,
    createdAt: now,
    updatedAt: now,
  });

  await storage.createMembership({
    id: uuidv4(),
    organismId: id,
    ghii: creatorOwner,
    role: 'creator',
    status: 'active',
    joinedAt: now,
  });

  emitChange('organisms');
  // Timeline and landing feed are best-effort: the organism exists either way, and neither is worth
  // failing the call for. Both used to hang off the REST route alone.
  void updateOrganismStructure(storage, config, id, { event: 'organism created', actor: creatorOwner })
    .catch(err => { logger.warn('createOrganismRecord: timeline is best-effort', { error: String(err) }); });
  // Only public organisms are discoverable, so only they announce.
  if (visibility === 'public') {
    void recordPublicActivity(storage, config, {
      category: 'organisms',
      actor: creatorOwner,
      summary: `Organism "${name}" created`,
      detail: description,
      link: `/v1/organisms/${id}`,
    }).catch(err => { logger.warn('createOrganismRecord: feed is best-effort', { error: String(err) }); });
  }

  return { ok: true, organism };
}

export interface UpdateOrganismInput {
  name?: unknown;
  description?: unknown;
  type?: unknown;
  location?: unknown;
  interests?: unknown;
  joinPolicy?: unknown;
  maxMembers?: unknown;
  visibility?: unknown;
  memberVisibility?: unknown;
  readme?: unknown;
}

/**
 * Apply an update to an existing organism, plus the free-form README (a markdown body stored as the
 * creator-owned memory key `organism.{id}.meta.readme`, not a record column).
 *
 * Update is STRICT where create is tolerant: a create with a mistyped visibility still produces a
 * usable organism, but an update that silently ignores the field leaves the caller believing a
 * change happened. Anything present and unrecognised is refused.
 */
export async function updateOrganismRecord(
  deps: OrganismDeps,
  organism: OrganismRecord,
  input: UpdateOrganismInput,
): Promise<OrganismRefusal | { ok: true; organism: OrganismRecord; readme: string; readmeSet: boolean }> {
  const { storage, config } = deps;
  const updates: Partial<OrganismRecord> = { updatedAt: new Date().toISOString() };

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2) {
      return refuse(400, 'INVALID_INPUT', 'Name must be a string of at least 2 characters');
    }
    updates.name = input.name.trim();
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') return refuse(400, 'INVALID_INPUT', 'description must be a string');
    updates.description = input.description;
  }
  if (input.type !== undefined) {
    if (!ORGANISM_TYPES.includes(input.type as OrganismRecord['type'])) {
      return refuse(400, 'INVALID_INPUT', `type must be one of: ${ORGANISM_TYPES.join(', ')}`);
    }
    updates.type = input.type as OrganismRecord['type'];
  }
  if (input.location !== undefined) {
    if (typeof input.location !== 'object' || input.location === null || Array.isArray(input.location)) {
      return refuse(400, 'INVALID_INPUT', 'location must be an object');
    }
    updates.location = input.location as OrganismRecord['location'];
  }
  if (input.interests !== undefined) {
    if (!Array.isArray(input.interests) || input.interests.some(i => typeof i !== 'string')) {
      return refuse(400, 'INVALID_INPUT', 'interests must be an array of strings');
    }
    updates.interests = input.interests as string[];
  }
  if (input.joinPolicy !== undefined) {
    if (!JOIN_POLICIES.includes(input.joinPolicy as OrganismRecord['joinPolicy'])) {
      return refuse(400, 'INVALID_INPUT', `join_policy must be one of: ${JOIN_POLICIES.join(', ')}`);
    }
    updates.joinPolicy = input.joinPolicy as OrganismRecord['joinPolicy'];
  }
  if (input.visibility !== undefined) {
    if (!VISIBILITIES.includes(input.visibility as OrganismRecord['visibility'])) {
      return refuse(400, 'INVALID_INPUT', `visibility must be one of: ${VISIBILITIES.join(', ')}`);
    }
    updates.visibility = input.visibility as OrganismRecord['visibility'];
  }
  if (input.memberVisibility !== undefined) {
    if (!MEMBER_VISIBILITY_VALUES.includes(input.memberVisibility as OrganismRecord['memberVisibility'] & string)) {
      return refuse(400, 'INVALID_INPUT', `member_visibility must be one of: ${MEMBER_VISIBILITY_VALUES.join(', ')}`);
    }
    updates.memberVisibility = input.memberVisibility as OrganismRecord['memberVisibility'];
  }
  if (input.maxMembers !== undefined) {
    const n = Number(input.maxMembers);
    if (!Number.isFinite(n) || n < 1) return refuse(400, 'INVALID_INPUT', 'max_members must be a positive number');
    updates.maxMembers = Math.floor(n);
  }
  if (input.readme !== undefined && typeof input.readme !== 'string') {
    return refuse(400, 'INVALID_INPUT', 'readme must be a string');
  }

  // The README stays owned by the organism's creator so it does not fork into a second copy under
  // whichever admin edited it last.
  const readmeSet = typeof input.readme === 'string';
  if (readmeSet) await setOrganismReadme(storage, config, organism.id, input.readme as string, organism.creatorGhii);

  const updated = await storage.updateOrganism(organism.id, updates);
  const readme = await getOrganismReadme(storage, organism.id);
  emitChange('organisms');
  return { ok: true, organism: updated ?? { ...organism, ...updates }, readme, readmeSet };
}

export type JoinOrganismResult =
  | { ok: true; outcome: 'joined'; membership: OrganismMembershipRecord }
  | { ok: true; outcome: 'pending'; joinRequest: JoinRequestRecord };

/**
 * Join an organism, or ask to. An `open` organism activates the membership immediately; an
 * `approval_required` one records a join request and tells the creator plus every admin, with the
 * approve/reject actions on the notification itself; an `invite_only` one refuses.
 *
 * `joinerOwner` is the bare owner name (the key membership rows use).
 */
export async function joinOrganism(
  deps: OrganismDeps,
  organism: OrganismRecord,
  joinerOwner: string,
  message?: unknown,
): Promise<OrganismRefusal | JoinOrganismResult> {
  const { storage, config } = deps;
  const id = organism.id;

  const existing = await storage.getMembership(id, joinerOwner);
  if (existing && existing.status === 'banned') {
    return refuse(403, 'BANNED', 'You have been blocked from this organism');
  }
  if (existing && existing.status === 'active') {
    return refuse(409, 'ALREADY_MEMBER', 'You are already a member');
  }
  if (existing && existing.status === 'pending') {
    return refuse(409, 'ALREADY_PENDING', 'You already have a pending join request');
  }
  if (existing && existing.status === 'invited') {
    return refuse(409, 'ALREADY_INVITED', 'You have a pending invitation — accept it instead of requesting to join');
  }

  const members = await storage.listMembers(id, { status: 'active' });
  if (members.length >= organism.maxMembers) {
    return refuse(409, 'CAPACITY_FULL', 'Organism has reached maximum members');
  }

  const now = new Date().toISOString();

  if (organism.joinPolicy === 'open') {
    const membership = await storage.createMembership({
      id: uuidv4(),
      organismId: id,
      ghii: joinerOwner,
      role: 'member',
      status: 'active',
      joinedAt: now,
    });
    await storage.updateOrganism(id, {
      members: [...organism.members, joinerOwner],
      updatedAt: now,
    });
    emitChange('organisms');
    // Two feeds, because two people had something happen. The joiner joined; the creator gained a
    // member, which is news on THEIR account and would otherwise reach them only if they went and
    // looked at the roster.
    void recordAccountEvent(storage, {
      ownerGhii: joinerOwner, kind: 'organism_joined', actorGaii: joinerOwner,
      subject: id, link: `/v1/organism/${encodeURIComponent(id)}`,
      data: { name: organism.name || id },
    }, config);
    if (organism.createdBy && organism.createdBy !== joinerOwner) {
      void recordAccountEvent(storage, {
        ownerGhii: organism.createdBy, kind: 'organism_member_joined', actorGaii: joinerOwner,
        subject: id, link: `/v1/organism/${encodeURIComponent(id)}`,
        data: { name: organism.name || id, who: joinerOwner.split('@')[0] },
      }, config);
    }
    return { ok: true, outcome: 'joined', membership };
  }

  if (organism.joinPolicy === 'approval_required') {
    const joinRequest = await storage.createJoinRequest({
      id: uuidv4(),
      organismId: id,
      ghii: joinerOwner,
      message: typeof message === 'string' && message ? message : undefined,
      status: 'pending',
      createdAt: now,
    });

    // Tell the creator + admins, or the request waits until someone opens the list. admins includes
    // the creator, so dedupe.
    const approvers = [...new Set([organism.creatorGhii, ...organism.admins])];
    const reviewEndpoint = `/v1/organisms/${id}/join-requests/${joinRequest.id}/review`;
    for (const approver of approvers) {
      await notify(storage, `${approver}@${config.nodeId}`, {
        type: 'organism_join_request',
        title: `${joinerOwner} requested to join "${organism.name}"`,
        body: typeof message === 'string' ? message : '',
        link: '/v1/profile#organisms',
        // Approve/Reject post the review endpoint as the admin. Once one admin decides, the others'
        // clicks return 409 ALREADY_REVIEWED — the bell surfaces that and refreshes.
        actions: [
          { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint: reviewEndpoint, body: { decision: 'approved' }, style: 'primary' },
          { id: 'reject', label: 'Reject', kind: 'api', method: 'POST', endpoint: reviewEndpoint, body: { decision: 'rejected' }, style: 'danger', confirm: true },
        ],
      });
    }
    emitChange('notifications');
    emitChange('organisms');
    return { ok: true, outcome: 'pending', joinRequest };
  }

  return refuse(403, 'INVITE_ONLY', 'This organism requires an invitation to join');
}

/**
 * Leave an organism: delete the membership row and drop the leaver from members[] (and admins[] when
 * they held it). The creator cannot leave: they delete the organism instead, so an organism is never
 * left without someone who can manage it.
 */
export async function leaveOrganism(
  deps: OrganismDeps,
  organism: OrganismRecord,
  leaverOwner: string,
): Promise<OrganismRefusal | { ok: true }> {
  const { storage, config } = deps;
  const id = organism.id;

  if (isOrganismOwner(organism, leaverOwner)) {
    return refuse(400, 'CREATOR_CANNOT_LEAVE', 'Creator cannot leave. Delete the organism instead.');
  }

  const membership = await storage.getMembership(id, leaverOwner);
  if (!membership || membership.status !== 'active') {
    return refuse(404, 'NOT_MEMBER', 'You are not a member');
  }

  await storage.deleteMembership(membership.id);

  const updates: Partial<OrganismRecord> = {
    members: organism.members.filter(m => m !== leaverOwner),
    updatedAt: new Date().toISOString(),
  };
  if (organism.admins.includes(leaverOwner)) {
    updates.admins = organism.admins.filter(a => a !== leaverOwner);
  }
  await storage.updateOrganism(id, updates);
  emitChange('organisms');
  // The leaver's own record only. Someone leaving is not something the organism's creator needs
  // interrupting for, and a feed that reports every departure on somebody else's account turns
  // into a roster diff nobody asked for.
  void recordAccountEvent(storage, {
    ownerGhii: leaverOwner, kind: 'organism_left', actorGaii: leaverOwner,
    subject: id, data: { name: organism.name || id },
  }, config);
  return { ok: true };
}
