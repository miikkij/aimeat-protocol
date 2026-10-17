/**
 * @file src/services/publish-requests/ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ask at a door that can make something public (plan doc-mvcn6c7e4e5q, V4.3), in two
 *   steps and one answer.
 *
 *   publishAskOf() runs before anything is stored and says: go ahead, refuse (nobody here to ask), or
 *   ask the owner. On an ask the door stores the content at the level it had (a new record or file:
 *   private) and then files the request with fileAsk(). The caller gets 202 with
 *   publishRequestedBody(): what waits, until when, and the address the owner approves at. So an
 *   agent never hears only "no": it hears what to tell the person.
 *
 *   Its own file, apart from decide.ts, because the doors import it and decide.ts imports the
 *   appliers, which import the doors' services: one file for both would be an import cycle.
 * @structure PublishAsk · accountGhii · publishAskOf · fileAsk · publishRequestedBody
 * @usage
 *   const ask = publishAskOf(ctx, callerOf(req, config.nodeId, storage), req.auth?.app);
 *   if (ask.kind === 'refused') return res.status(ask.status).json(error(nodeId, ask.code, ask.message));
 *   ... store at the level it had ...
 *   if (ask.kind === 'ask') { const filed = await fileAsk(ctx, caller.owner, ask.requester, draft); ... 202 }
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import { callerPrincipal } from '../../utils/gaii.js';
import type { CallerContext } from '../caller-context.js';
import { publishGateDecision } from '../publish-gate.js';
import {
  filePublishRequest, approveUrl,
  type PublishRequest, type PublishRequestDraft, type PublishRequester, type PublishStoreCtx,
} from './store.js';

export type PublishAsk =
  | { kind: 'allowed' }
  | { kind: 'refused'; status: 403; code: string; message: string }
  | { kind: 'ask'; requester: PublishRequester };

/** The owner's GHII from an account name (a token's `owner`) or a GHII. */
export function accountGhii(owner: string, nodeId: string): string {
  return owner.includes('@') ? owner : `${owner}@${nodeId}`;
}

/**
 * May the caller make it public, and if not, who is asking the owner. Asked before anything is
 * stored. `app` is an app grant's `owner/filename`, which names the app in the request.
 */
export function publishAskOf(ctx: PublishStoreCtx, caller: CallerContext, app?: string): PublishAsk {
  const d = publishGateDecision(ctx.config, caller);
  if (d.allowed) return { kind: 'allowed' };
  if (d.ask === null) return { kind: 'refused', status: d.status, code: d.code, message: d.message };
  // An app is named eco:<app>#<owner>@<node> (callerPrincipal); an agent by its GAII.
  const principal = d.ask === 'app'
    ? callerPrincipal({ ...caller.auth, ...(app ? { app } : {}) }, ctx.config.nodeId)
    : caller.principal;
  return { kind: 'ask', requester: { principal, kind: d.ask, sub: caller.auth.sub } };
}

/** File the request, after the door stored the content at the level it was allowed to set. */
export function fileAsk(
  ctx: PublishStoreCtx, owner: string, requester: PublishRequester, draft: Omit<PublishRequestDraft, 'requested_by'>,
): ReturnType<typeof filePublishRequest> {
  return filePublishRequest(ctx, accountGhii(owner, ctx.config.nodeId), { ...draft, requested_by: requester });
}

/** What a door answers for a filed request, the same on REST and on MCP. */
export function publishRequestedBody(ctx: PublishStoreCtx, filed: { request: PublishRequest; alreadyWaiting: boolean }) {
  const r = filed.request;
  const url = approveUrl(ctx.config.baseUrl);
  return {
    request_id: r.id,
    status: 'awaiting_owner' as const,
    kind: r.kind,
    title: r.title,
    expires_at: r.expires_at,
    already_waiting: filed.alreadyWaiting,
    approve_url: url,
    next_step: 'It is not public yet: making something public to anyone takes your owner\'s approval or the "publish:public" permission. '
      + `It waits for your owner until ${r.expires_at.slice(0, 10)}. Tell them in one sentence what you asked to make public (${r.title}) and give them this address: ${url}. `
      + 'You hear the answer as a message with this request id; aimeat_publish_requests reads it at any time.',
  };
}
