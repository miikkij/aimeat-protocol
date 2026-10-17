/**
 * @file src/services/publish-requests/decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading and deciding publish requests (plan doc-mvcn6c7e4e5q, V4.3). The ask at a door
 *   is ask.ts.
 *
 *   THE DECISION. decidePublishRequest(): who may decide is policy.ts. The request is re-validated
 *   (still waiting, not expired) and the applier of its kind (appliers.ts) makes the target public as
 *   the owner. An applier that finds the target changed since the request (deleted, edited, its
 *   level changed) answers why, and the request is settled `outdated`: the owner approved what they
 *   saw, never something else.
 *
 *   WHO SEES WHICH. The owner and the owner's agents see every request of the account, because an
 *   agent may decide one. An app grant sees the requests it filed.
 *
 *   ONE IMPLEMENTATION, EVERY DOOR. The REST routes (routes/publish-requests.ts) and the MCP tool
 *   aimeat_publish_requests call these functions.
 * @structure PublishViewer · listPublishRequestsFor · readPublishRequestFor · decidePublishRequest
 * @usage const out = await decidePublishRequest({ storage, config }, viewer, id, 'approve');
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import { callerPrincipal } from '../../utils/gaii.js';
import type { CallerContext } from '../caller-context.js';
import {
  settlePublishRequest, readPublishRequest, listPublishRequests, summarizePublishRequest,
  effectiveState, inPublishQueue, requesterName,
  type PublishRequest, type PublishRequestFail, type PublishStoreCtx,
} from './store.js';
import { publishDecisionRefusal, publishRequestExpired } from './policy.js';
import { PUBLISH_APPLIERS } from './appliers.js';
import { accountGhii } from './ask.js';

const fail = (status: number, code: string, message: string): PublishRequestFail => ({ ok: false, status, code, message });

/** Who is reading or deciding: the session's caller object, and an app grant's `owner/filename`. */
export interface PublishViewer {
  caller: CallerContext;
  app?: string;
}

const NO_REQUESTS_HERE = 'A session from another node, or one signed in as nobody, has no requests here.';
const outside = (v: PublishViewer) => v.caller.kind === 'visitor' || v.caller.kind === 'anonymous';

/** An app sees the requests it filed; the owner and the owner's agents see all of the account's. */
function visibleTo(ctx: PublishStoreCtx, v: PublishViewer, r: PublishRequest): boolean {
  if (v.caller.kind !== 'app' && v.caller.kind !== 'ecosystem') return true;
  const me = callerPrincipal({ ...v.caller.auth, ...(v.app ? { app: v.app } : {}) }, ctx.config.nodeId);
  return r.requested_by.principal === me;
}

export async function listPublishRequestsFor(ctx: PublishStoreCtx, viewer: PublishViewer) {
  if (outside(viewer)) return fail(403, 'ACCESS_DENIED', NO_REQUESTS_HERE);
  const all = await listPublishRequests(ctx.storage, accountGhii(viewer.caller.owner, ctx.config.nodeId));
  const mine = all.filter(r => visibleTo(ctx, viewer, r));
  const now = Date.now();
  return {
    ok: true as const,
    requests: mine.map(r => summarizePublishRequest(r, now)),
    waiting: mine.filter(r => effectiveState(r, now) === 'awaiting_owner').length,
  };
}

export async function readPublishRequestFor(ctx: PublishStoreCtx, viewer: PublishViewer, id: string) {
  if (outside(viewer)) return fail(403, 'ACCESS_DENIED', NO_REQUESTS_HERE);
  const r = await readPublishRequest(ctx.storage, accountGhii(viewer.caller.owner, ctx.config.nodeId), id);
  if (!r || !visibleTo(ctx, viewer, r)) return fail(404, 'NOT_FOUND', 'No such request on this account.');
  return { ok: true as const, request: summarizePublishRequest(r) };
}

/**
 * Approve or decline one request. An approval makes the target public as the owner, through the
 * applier of its kind; a target that changed since the request settles it `outdated` instead.
 */
export async function decidePublishRequest(ctx: PublishStoreCtx, decider: PublishViewer, id: string, decision: unknown) {
  if (decision !== 'approve' && decision !== 'decline') return fail(400, 'INVALID_INPUT', 'decision is "approve" or "decline".');
  if (outside(decider)) return fail(403, 'ACCESS_DENIED', NO_REQUESTS_HERE);
  const ownerGhii = accountGhii(decider.caller.owner, ctx.config.nodeId);
  return inPublishQueue(ownerGhii, async () => {
    const request = await readPublishRequest(ctx.storage, ownerGhii, id);
    if (!request || !visibleTo(ctx, decider, request)) return fail(404, 'NOT_FOUND', 'No such request on this account.');
    const refusal = publishDecisionRefusal(decider.caller, request, decision);
    if (refusal) return { ok: false as const, ...refusal };
    if (request.state !== 'awaiting_owner') {
      return fail(409, 'ALREADY_DECIDED', `This request is already ${request.state}. Nothing changed.`);
    }
    if (publishRequestExpired(request, Date.now())) {
      await settlePublishRequest(ctx, ownerGhii, request, 'expired', { by: null });
      return fail(410, 'EXPIRED', 'This request expired before anyone decided it. Nothing was made public. The one who asked can ask again.');
    }
    const by = decider.caller.inPerson ? ownerGhii : decider.caller.principal;
    if (decision === 'decline') {
      const settled = await settlePublishRequest(ctx, ownerGhii, request, 'declined', { by });
      return { ok: true as const, decision, request: summarizePublishRequest(settled) };
    }
    const applier = PUBLISH_APPLIERS[request.kind];
    const applied = applier
      ? await applier(ctx, ownerGhii, request)
      : { ok: false as const, reason: 'this kind of content cannot be made public through a request on this node' };
    if (!applied.ok) {
      await settlePublishRequest(ctx, ownerGhii, request, 'outdated', { by, outcome: { reason: applied.reason } });
      return fail(409, 'OUTDATED', `This can no longer be made public as asked: ${applied.reason}. Nothing was made public. ${requesterName(request.requested_by)} can ask again.`);
    }
    const settled = await settlePublishRequest(ctx, ownerGhii, request, 'approved', { by, outcome: applied.url ? { url: applied.url } : null });
    return { ok: true as const, decision, request: summarizePublishRequest(settled) };
  });
}
