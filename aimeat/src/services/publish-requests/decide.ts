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
 *   v1.2.0 — 2026-10-21 — Approving a request also applies its waiting parts (parts.ts), each checked
 *     as its own request; declining it declines them (store.ts). A part decided on its own decides only
 *     itself, and a request without parts is unchanged (the developer's one-press decision).
 *   v1.1.0 — 2026-10-18 — An approval is held to the label's audience cap again before the applier
 *     runs; a refused one is settled outdated and answered 409 LABEL_CAPS_AUDIENCE (cap-recheck.ts;
 *     plan doc-mvdipuyqraas, L3.3).
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
import { requestCapRefusal } from './cap-recheck.js';

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
      // A declined parent declines its waiting parts too (store.ts settlePublishRequest).
      const settled = await settlePublishRequest(ctx, ownerGhii, request, 'declined', { by });
      return { ok: true as const, decision, request: summarizePublishRequest(settled) };
    }
    const kind = decider.caller.kind === 'agent' ? 'ai' as const : 'human' as const;
    const out = await approveOne(ctx, ownerGhii, request, by, kind);
    if (!out.ok) return out;
    // One press decides the parts too (parts.ts): each waiting part is checked and applied as its own
    // request, so a part whose content changed is settled outdated without undoing the parent.
    for (const id of request.parts ?? []) {
      const part = await readPublishRequest(ctx.storage, ownerGhii, id);
      if (!part || part.state !== 'awaiting_owner' || part.part_of !== request.id) continue;
      await approveOne(ctx, ownerGhii, part, by, kind, true);
    }
    return { ok: true as const, decision, request: summarizePublishRequest(out.settled) };
  });
}

/**
 * Apply one approved request: the label's audience cap again, then the applier of its kind. A refusal
 * settles it outdated and answers why; `withParent` marks a part decided by its parent's press.
 */
async function approveOne(
  ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest, by: string, kind: 'ai' | 'human', withParent = false,
): Promise<{ ok: true; settled: PublishRequest } | PublishRequestFail> {
  // The label's audience cap is asked again before anything is applied (plan doc-mvdipuyqraas,
  // L3.3): a request never carries content past it, whoever approves.
  const capped = await requestCapRefusal(ctx, ownerGhii, request, { principal: by, kind });
  if (capped) {
    await settlePublishRequest(ctx, ownerGhii, request, 'outdated', { by, withParent, outcome: { reason: capped.message } });
    return fail(409, 'LABEL_CAPS_AUDIENCE', `${capped.message} The request is closed; nothing was made public.`);
  }
  const applier = PUBLISH_APPLIERS[request.kind];
  const applied = applier
    ? await applier(ctx, ownerGhii, request)
    : { ok: false as const, reason: 'this kind of content cannot be made public through a request on this node' };
  if (!applied.ok) {
    await settlePublishRequest(ctx, ownerGhii, request, 'outdated', { by, withParent, outcome: { reason: applied.reason } });
    return fail(409, 'OUTDATED', `This can no longer be made public as asked: ${applied.reason}. Nothing was made public. ${requesterName(request.requested_by)} can ask again.`);
  }
  const settled = await settlePublishRequest(ctx, ownerGhii, request, 'approved', { by, withParent, outcome: applied.url ? { url: applied.url } : null });
  return { ok: true, settled };
}
