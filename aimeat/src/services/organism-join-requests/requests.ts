/**
 * @file src/services/organism-join-requests/requests.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The join request of an organism: filing one, deciding one, and the access request,
 *   which is a join request asked from the refusal page of an app or a page opened to the organism's
 *   members. One implementation for the REST routes and the MCP tools.
 *
 *   TWO WAYS IN, ONE RECORD. A join request is filed either by the organism's own id
 *   (services/organism-lifecycle.ts joinOrganism, when `joinPolicy` is approval_required) or as an
 *   access request (requestAccess): a person an app or page refused asks from the refusal page, the
 *   node reads the organism from the app's or page's own `access` setting, and the requester is never
 *   told which organism it is. An access request carries `via`, the app or page it was asked from;
 *   the approver reads it, and the answer to the requester names it instead of the organism.
 *
 *   THE ORGANISM'S SWITCH. `accessRequests` ('on' unless set 'off') decides whether an access request
 *   can be filed. It is separate from `joinPolicy`: an invite_only organism takes access requests
 *   while the switch is on, because its owners still decide each one.
 *
 *   RULES BOTH WAYS SHARE (fileJoinRequest): one open request per person and organism; a person whose
 *   request was declined asks again after JOIN_REQUEST_RETRY_DAYS; the owners and admins are told,
 *   with Approve and Reject on the notice, and every such notice is marked answered when one of them
 *   decides (services/notification-answers.ts).
 *
 *   A request also ends when the person becomes a member another way (a direct add, an accepted
 *   invitation): closeJoinRequestsOnMembership marks it approved, so it leaves the waiting list.
 * @structure JOIN_REQUEST_RETRY_DAYS · accessRequestsOf · membershipRefusal · mayReviewJoinRequests ·
 *   fileJoinRequest · reviewJoinRequest · closeJoinRequestsOnMembership · openJoinRequests ·
 *   readJoinRequests · decideJoinRequest · requestAccess · accessRequestState · viaOpenPath
 *   (the targets an access request names are found in ./access-targets.ts)
 * @usage
 *   const r = await requestAccess({ storage, config }, req.auth, { access, ownerName, via }, message);
 *   const d = await reviewJoinRequest({ storage, config }, organism, requestId, 'approved', { owner, principal });
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial. The approval branch of joinOrganism and the review route's body
 *     move here; new: the access request, the organism's switch, one open request per person, the
 *     wait after a declined request, and answered notices.
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type {
  Storage, OrganismRecord, OrganismMembershipRecord, JoinRequestRecord, JoinRequestVia,
} from '../../storage/interface.js';
import { emitChange } from '../event-bus.js';
import { notify } from '../notify.js';
import { answerNotifications } from '../notification-answers.js';
import { organismOwners, isOrganismOwner } from '../organism-ownership.js';
import { isNodeAccount, type AudienceAuth } from '../audience.js';
import { mayOpenPage, pageAccessLevel } from '../page-access.js';
import { isSameAccount } from '../../utils/same-account.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

/** How long a person whose request was declined waits before the same organism takes another. */
export const JOIN_REQUEST_RETRY_DAYS = 30;
/** The longest message a request carries. */
export const JOIN_REQUEST_MESSAGE_MAX = 1000;

export const ACCESS_REQUESTS_VALUES = ['on', 'off'] as const;
export type AccessRequests = (typeof ACCESS_REQUESTS_VALUES)[number];

/** The organism's switch as it is in force: 'on' unless it was set 'off'. */
export function accessRequestsOf(organism: Pick<OrganismRecord, 'accessRequests'> | null | undefined): AccessRequests {
  return organism?.accessRequests === 'off' ? 'off' : 'on';
}

export interface JoinRequestDeps {
  storage: Storage;
  config: AimeatConfig;
}

/** A refusal the caller renders in its own shape: HTTP maps status and code, MCP prints code and message. */
export interface JoinRequestRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** Present on ASKED_RECENTLY: the first moment the organism takes a new request from this person. */
  askAgainAt?: string;
}

function refuse(status: number, code: string, message: string, askAgainAt?: string): JoinRequestRefusal {
  return { ok: false, status, code, message, ...(askAgainAt ? { askAgainAt } : {}) };
}

/** The identity a notification is stored under, from the account name a membership row keys. */
function accountGhii(account: string, nodeId: string): string {
  return account.includes('@') ? account : `${account}@${nodeId}`;
}

/** The question a join request's notices ask, so one decision closes every approver's notice. */
function noticeRef(requestId: string): string {
  return `join-request:${requestId}`;
}

/** The SPA page that opens what an access request was asked from (public/views/app-open.js). */
export function viaOpenPath(via: JoinRequestVia): string {
  const param = via.kind === 'app' ? 'app' : via.kind;
  return `/v1/app-open?${param}=${encodeURIComponent(via.ref)}`;
}

/**
 * Why this person cannot become a member right now, or null: blocked, already a member, already
 * invited, or the organism is full. Asked before a join and before a request is filed.
 */
export async function membershipRefusal(
  storage: Storage, organism: OrganismRecord, joinerOwner: string,
): Promise<JoinRequestRefusal | null> {
  const existing = await storage.getMembership(organism.id, joinerOwner);
  if (existing?.status === 'banned') return refuse(403, 'BANNED', 'You have been blocked from this organism');
  if (existing?.status === 'active') return refuse(409, 'ALREADY_MEMBER', 'You are already a member');
  if (existing?.status === 'pending') return refuse(409, 'ALREADY_PENDING', 'You already have a pending join request');
  if (existing?.status === 'invited') {
    return refuse(409, 'ALREADY_INVITED', 'You have a pending invitation — accept it instead of requesting to join');
  }
  const members = await storage.listMembers(organism.id, { status: 'active' });
  if (members.length >= organism.maxMembers) return refuse(409, 'CAPACITY_FULL', 'Organism has reached maximum members');
  return null;
}

/** The owners and admins of the organism: who is told of a request and who may decide it. */
function approversOf(organism: OrganismRecord): string[] {
  return [...new Set([...organismOwners(organism), ...(organism.admins ?? [])])];
}

/** May this account (the bare owner name a membership row keys) decide the organism's join requests? */
export function mayReviewJoinRequests(organism: OrganismRecord, ownerName: string): boolean {
  return isOrganismOwner(organism, ownerName) || (organism.admins ?? []).includes(ownerName);
}

/** The newest of one person's requests in an organism with the given status, by the time it was decided or made. */
function newest(requests: JoinRequestRecord[], status: JoinRequestRecord['status']): JoinRequestRecord | null {
  const at = (r: JoinRequestRecord) => r.reviewedAt ?? r.createdAt;
  return requests.filter(r => r.status === status).sort((a, b) => at(b).localeCompare(at(a)))[0] ?? null;
}

/** When a declined request stops holding back a new one. */
function askAgainAtOf(declined: JoinRequestRecord): string {
  const from = new Date(declined.reviewedAt ?? declined.createdAt).getTime();
  return new Date(from + JOIN_REQUEST_RETRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** One person's requests in one organism: the open one, and the declined one that still holds back a new one. */
async function standingOf(
  storage: Storage, organismId: string, requester: string, now: number,
): Promise<{ pending: JoinRequestRecord | null; declined: JoinRequestRecord | null; askAgainAt: string | null }> {
  const mine = (await storage.listJoinRequests(organismId)).filter(r => r.ghii === requester);
  const pending = newest(mine, 'pending');
  const lastDeclined = newest(mine, 'rejected');
  // An approval after the decline (the person was a member and left) ends the wait.
  const lastApproved = newest(mine, 'approved');
  const declinedStands = !!lastDeclined && (!lastApproved
    || (lastDeclined.reviewedAt ?? lastDeclined.createdAt) > (lastApproved.reviewedAt ?? lastApproved.createdAt));
  const askAgainAt = lastDeclined && declinedStands ? askAgainAtOf(lastDeclined) : null;
  const waits = !!askAgainAt && new Date(askAgainAt).getTime() > now;
  return { pending, declined: waits ? lastDeclined : null, askAgainAt: waits ? askAgainAt : null };
}

export interface FileJoinRequestInput {
  message?: unknown;
  /** Set on an access request: the app or page it was asked from. */
  via?: JoinRequestVia;
}

/**
 * File a join request and tell the organism's owners and admins, with Approve and Reject on the
 * notice. Refuses a second open request and a request inside the wait after a declined one. The
 * caller has asked membershipRefusal first.
 */
export async function fileJoinRequest(
  deps: JoinRequestDeps, organism: OrganismRecord, requester: string, input: FileJoinRequestInput = {},
): Promise<JoinRequestRefusal | { ok: true; joinRequest: JoinRequestRecord }> {
  const { storage, config } = deps;
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length > JOIN_REQUEST_MESSAGE_MAX) {
    return refuse(400, 'INVALID_INPUT', `message is at most ${JOIN_REQUEST_MESSAGE_MAX} characters`);
  }
  const standing = await standingOf(storage, organism.id, requester, Date.now());
  if (standing.pending) return refuse(409, 'ALREADY_PENDING', 'You already have a pending join request');
  if (standing.askAgainAt) {
    return refuse(409, 'ASKED_RECENTLY',
      `Your last request was declined. You can ask again after ${standing.askAgainAt.slice(0, 10)}.`, standing.askAgainAt);
  }

  const joinRequest = await storage.createJoinRequest({
    id: uuidv4(),
    organismId: organism.id,
    ghii: requester,
    message: message || undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...(input.via ? { via: input.via } : {}),
  });

  // Tell the owners and admins, or the request waits until someone opens the list. Approve and Reject
  // call the review route as the approver; the first decision marks every approver's notice answered.
  const who = localAccountName(requester);
  const reviewEndpoint = `/v1/organisms/${organism.id}/join-requests/${joinRequest.id}/review`;
  const via = input.via;
  for (const approver of approversOf(organism)) {
    await notify(storage, accountGhii(approver, config.nodeId), {
      type: via ? 'organism_access_request' : 'organism_join_request',
      title: via
        ? `${who} asks for access to "${via.label}"`
        : `${requester} requested to join "${organism.name}"`,
      body: via
        ? `Approving adds ${who} to "${organism.name}" as a member.${message ? ` Their message: ${message}` : ''}`
        : message,
      link: '/v1/profile#organisms',
      ref: noticeRef(joinRequest.id),
      ...(via ? {
        i18n: {
          key: message ? 'access_request_message' : 'access_request',
          vars: { who, label: via.label, organism: organism.name, message },
        },
      } : {}),
      actions: [
        { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint: reviewEndpoint, body: { decision: 'approved' }, style: 'primary' },
        { id: 'reject', label: 'Reject', kind: 'api', method: 'POST', endpoint: reviewEndpoint, body: { decision: 'rejected' }, style: 'danger', confirm: true },
      ],
    });
  }
  emitChange('notifications');
  emitChange('organisms');
  return { ok: true, joinRequest };
}

/** Mark every approver's notice of this request answered, so none offers its buttons again. */
async function closeNotices(
  deps: JoinRequestDeps, organism: OrganismRecord, request: JoinRequestRecord,
  outcome: 'allowed' | 'declined' | 'answered', by: string, at: string,
): Promise<void> {
  for (const approver of approversOf(organism)) {
    await answerNotifications(deps.storage, accountGhii(approver, deps.config.nodeId), { ref: noticeRef(request.id) }, { outcome, by, at });
  }
}

export interface JoinRequestReviewer {
  /** The bare owner name a membership row keys (req.auth.owner). */
  owner: string;
  /** The principal that decided: a GHII, or the GAII of the owner's agent. */
  principal: string;
}

/**
 * Approve or reject one join request. Approving makes the person an active member; a person who
 * became a member in the meantime (a direct add, an accepted invitation) is approved without a
 * second membership. The requester is told, and every approver's notice is marked answered.
 */
export async function reviewJoinRequest(
  deps: JoinRequestDeps, organism: OrganismRecord, requestId: string, decision: unknown, reviewer: JoinRequestReviewer,
): Promise<JoinRequestRefusal | { ok: true; decision: 'approved' | 'rejected'; request: JoinRequestRecord }> {
  const { storage, config } = deps;
  if (decision !== 'approved' && decision !== 'rejected') {
    return refuse(400, 'INVALID_INPUT', 'Decision must be "approved" or "rejected"');
  }
  if (!mayReviewJoinRequests(organism, reviewer.owner)) {
    return refuse(403, 'ACCESS_DENIED', 'Only admins can review join requests');
  }
  const request = await storage.getJoinRequest(requestId);
  if (!request || request.organismId !== organism.id) return refuse(404, 'NOT_FOUND', 'Join request not found');
  if (request.status !== 'pending') return refuse(409, 'ALREADY_REVIEWED', 'This request has already been reviewed');

  const existing: OrganismMembershipRecord | null = await storage.getMembership(organism.id, request.ghii);
  if (decision === 'approved' && existing?.status === 'banned') {
    return refuse(409, 'BANNED', 'This person is blocked from the organism. Lift the block first, then approve.');
  }
  if (decision === 'approved' && existing?.status !== 'active') {
    const members = await storage.listMembers(organism.id, { status: 'active' });
    if (members.length >= organism.maxMembers) return refuse(409, 'CAPACITY_FULL', 'Organism has reached maximum members');
  }

  const now = new Date().toISOString();
  // One decision, three rows: the request's verdict, the membership it creates and the organism's
  // member list. A failure between them left a request marked approved with no membership, or a
  // membership the organism did not list.
  await storage.transaction(async () => {
    await storage.updateJoinRequest(requestId, { status: decision, reviewedBy: reviewer.owner, reviewedAt: now });
    if (decision !== 'approved' || existing?.status === 'active') return;
    if (existing) {
      // An invitation was waiting: the approval activates that row; a second one would be a duplicate.
      await storage.updateMembership(existing.id, { status: 'active', joinedAt: now, invitedWorkspaces: [] });
    } else {
      await storage.createMembership({
        id: uuidv4(), organismId: organism.id, ghii: request.ghii, role: 'member', status: 'active', joinedAt: now,
      });
    }
    if (!organism.members.includes(request.ghii)) {
      await storage.updateOrganism(organism.id, { members: [...organism.members, request.ghii], updatedAt: now });
    }
  });

  // Tell the requester. An access request names what was asked for, never the organism on a decline:
  // the requester was not told which organism it is, and a declined person is still outside it.
  const via = request.via;
  const approved = decision === 'approved';
  const askAgain = askAgainAtOf({ ...request, reviewedAt: now }).slice(0, 10);
  await notify(storage, accountGhii(request.ghii, config.nodeId), via ? {
    type: approved ? 'organism_access_approved' : 'organism_access_declined',
    title: approved ? `You can now open "${via.label}"` : `Your request for access to "${via.label}" was declined`,
    body: approved ? '' : `You can ask again after ${askAgain}.`,
    link: approved ? viaOpenPath(via) : '',
    i18n: { key: approved ? 'access_request_approved' : 'access_request_declined', vars: { label: via.label, date: askAgain } },
  } : {
    type: approved ? 'organism_join_approved' : 'organism_join_rejected',
    title: approved ? `You were approved to join "${organism.name}"` : `Your request to join "${organism.name}" was declined`,
    link: '/v1/profile#organisms',
  });
  await closeNotices(deps, organism, request, approved ? 'allowed' : 'declined', reviewer.principal, now);
  emitChange('notifications');
  emitChange('organisms');
  return { ok: true, decision, request: { ...request, status: decision, reviewedBy: reviewer.owner, reviewedAt: now } };
}

/**
 * The person became an active member another way (a direct add, an accepted invitation): their open
 * join requests are marked approved by whoever made them a member, and the approvers' notices are
 * marked answered. Never throws into the caller: the membership stands whatever happens here.
 */
export async function closeJoinRequestsOnMembership(
  deps: JoinRequestDeps, organism: OrganismRecord, member: string, by: { owner: string; principal: string },
): Promise<number> {
  try {
    const open = (await deps.storage.listJoinRequests(organism.id, { status: 'pending' })).filter(r => r.ghii === member);
    const now = new Date().toISOString();
    for (const request of open) {
      await deps.storage.updateJoinRequest(request.id, { status: 'approved', reviewedBy: by.owner, reviewedAt: now });
      await closeNotices(deps, organism, request, 'answered', by.principal, now);
    }
    if (open.length) emitChange('organisms');
    return open.length;
  } catch (err) {
    logger.warn('join requests: an open request of a new member could not be closed; it is closed when the list is next read', {
      organism: organism.id, member, error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * The organism's open join requests, for the approvers' list. A request whose person is an active
 * member by now (added by a route that did not close it: an e-mail invitation, a workspace grant,
 * single sign-on) is marked approved here and left out, so the list never offers a decision that
 * has already been made.
 */
export async function openJoinRequests(deps: JoinRequestDeps, organism: OrganismRecord): Promise<JoinRequestRecord[]> {
  const pending = await deps.storage.listJoinRequests(organism.id, { status: 'pending' });
  const members = new Set(organism.members ?? []);
  const settled = [...new Set(pending.filter(r => members.has(r.ghii)).map(r => r.ghii))];
  for (const member of settled) {
    await closeJoinRequestsOnMembership(deps, organism, member, { owner: member, principal: accountGhii(member, deps.config.nodeId) });
  }
  return pending.filter(r => !members.has(r.ghii));
}

/**
 * The join requests of one organism, for one of its owners or admins: the open ones unless `status`
 * names another. GET /v1/organisms/:id/join-requests and aimeat_organism_join_requests.
 */
export async function readJoinRequests(
  deps: JoinRequestDeps, organismId: string, ownerName: string, status?: unknown,
): Promise<JoinRequestRefusal | { ok: true; requests: JoinRequestRecord[] }> {
  const organism = await deps.storage.getOrganism(organismId);
  if (!organism) return refuse(404, 'NOT_FOUND', 'Organism not found');
  if (!mayReviewJoinRequests(organism, ownerName)) return refuse(403, 'ACCESS_DENIED', 'Only admins can view join requests');
  const wanted = typeof status === 'string' && status ? status : 'pending';
  const requests = wanted === 'pending'
    ? await openJoinRequests(deps, organism)
    : await deps.storage.listJoinRequests(organismId, { status: wanted });
  return { ok: true, requests };
}

/**
 * Decide one join request of the organism with this id (reviewJoinRequest, after finding the
 * organism). POST /v1/organisms/:id/join-requests/:requestId/review and
 * aimeat_organism_join_request_review.
 */
export async function decideJoinRequest(
  deps: JoinRequestDeps, organismId: string, requestId: string, decision: unknown, reviewer: JoinRequestReviewer,
): Promise<JoinRequestRefusal | { ok: true; decision: 'approved' | 'rejected'; request: JoinRequestRecord }> {
  const organism = await deps.storage.getOrganism(organismId);
  if (!organism) return refuse(404, 'NOT_FOUND', 'Organism not found');
  return reviewJoinRequest(deps, organism, requestId, decision, reviewer);
}

/** What access is asked to: an app, a welcome page or a company front page, as its route found it. */
export interface AccessRequestTarget {
  /** The target's stored `access` value. */
  access: unknown;
  /** The bare account name of the target's owner, who never needs to ask. */
  ownerName: string;
  /** What the approver reads and the answer to the requester names. */
  via: JoinRequestVia;
}

/** The refusal for anything that takes no access request, in words that name no organism. */
const NOT_REQUESTABLE = 'Access cannot be asked for here. Ask the owner directly.';

/** The organism the target is opened to, or null when its own `access` setting names none. */
function organismOfAccess(access: unknown): string | null {
  const level = pageAccessLevel(access);
  return level.level === 'organism' && level.organism_id ? level.organism_id : null;
}

/** True when the target already opens for the caller: its owner, or an account its `access` admits. */
async function alreadyOpens(deps: JoinRequestDeps, auth: AudienceAuth, target: AccessRequestTarget): Promise<boolean> {
  return isSameAccount(auth.owner, target.ownerName) || mayOpenPage(deps.storage, deps.config, target.access, auth);
}

/**
 * File an access request: a join request of the organism an app or page is opened to, asked from its
 * refusal. The requester is told nothing about the organism; every refusal here is written without
 * its name. `joinPolicy` is not read: the owners and admins decide each request.
 *
 * `auth` is the caller's (req.auth, or an MCP session's): only an account of this node can become a
 * member, so a visitor from another node and the anonymous identity are refused.
 */
export async function requestAccess(
  deps: JoinRequestDeps, auth: AudienceAuth | null | undefined, target: AccessRequestTarget, message?: unknown,
): Promise<JoinRequestRefusal | { ok: true; joinRequest: JoinRequestRecord }> {
  if (!isNodeAccount(auth)) return refuse(403, 'ACCESS_DENIED', 'Only an account of this node can ask for access.');
  if (await alreadyOpens(deps, auth!, target)) return refuse(409, 'ALREADY_OPEN', 'This already opens for you.');
  const organismId = organismOfAccess(target.access);
  const organism = organismId ? await deps.storage.getOrganism(organismId) : null;
  if (!organism || organism.archived) return refuse(409, 'NOT_REQUESTABLE', NOT_REQUESTABLE);
  if (accessRequestsOf(organism) === 'off') return refuse(403, 'REQUESTS_OFF', NOT_REQUESTABLE);
  const requester = auth!.owner as string;
  const refused = await membershipRefusal(deps.storage, organism, requester);
  if (refused) {
    if (refused.code === 'BANNED') return refuse(403, 'BANNED', 'You have been blocked here, so access cannot be asked for.');
    if (refused.code === 'ALREADY_INVITED') return refuse(409, 'ALREADY_INVITED', 'You have an invitation waiting. Accept it in your notifications, and this opens.');
    if (refused.code === 'CAPACITY_FULL') return refuse(409, 'CAPACITY_FULL', 'No more people can be added here right now. Ask the owner directly.');
    // ALREADY_MEMBER with a refused open: the person is in, and their agent is one the organism does not admit.
    if (refused.code === 'ALREADY_MEMBER') return refuse(409, 'ALREADY_MEMBER', 'You already have access yourself. This agent is not one that is let in here.');
    return refused;
  }
  const filed = await fileJoinRequest(deps, organism, requester, { message, via: target.via });
  if (!filed.ok && filed.code === 'ALREADY_PENDING') {
    return refuse(409, 'ALREADY_PENDING', 'You have already asked. The request waits for a decision.');
  }
  return filed;
}

export interface AccessRequestState {
  /** Can a request be filed right now. */
  requestable: boolean;
  /**
   * open: it already opens for the caller; none: nothing asked; pending: waits for a decision;
   * declined: declined, and the wait still runs; invited: an invitation waits in the notifications.
   */
  state: 'open' | 'none' | 'pending' | 'declined' | 'invited';
  asked_at: string | null;
  ask_again_at: string | null;
  /** How many days a declined person waits (JOIN_REQUEST_RETRY_DAYS). */
  retry_days: number;
}

/** What the refusal page shows this person: whether to offer the request, and what they already asked. */
export async function accessRequestState(
  deps: JoinRequestDeps, auth: AudienceAuth | null | undefined, target: AccessRequestTarget,
): Promise<AccessRequestState> {
  const none: AccessRequestState = { requestable: false, state: 'none', asked_at: null, ask_again_at: null, retry_days: JOIN_REQUEST_RETRY_DAYS };
  if (!isNodeAccount(auth)) return none;
  if (await alreadyOpens(deps, auth!, target)) return { ...none, state: 'open' };
  const organismId = organismOfAccess(target.access);
  const organism = organismId ? await deps.storage.getOrganism(organismId) : null;
  if (!organism || organism.archived || accessRequestsOf(organism) === 'off') return none;
  const requester = auth!.owner as string;
  const refused = await membershipRefusal(deps.storage, organism, requester);
  if (refused) return refused.code === 'ALREADY_INVITED' ? { ...none, state: 'invited' } : none;
  const standing = await standingOf(deps.storage, organism.id, requester, Date.now());
  if (standing.pending) return { ...none, state: 'pending', asked_at: standing.pending.createdAt };
  if (standing.declined) return { ...none, state: 'declined', asked_at: standing.declined.createdAt, ask_again_at: standing.askAgainAt };
  return { ...none, requestable: true };
}
