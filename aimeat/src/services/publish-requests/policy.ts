/**
 * @file src/services/publish-requests/policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may decide a publish request, and when a request stops being decidable (plan
 *   doc-mvcn6c7e4e5q, V4.3). Pure: no storage and no clock of its own.
 *
 *   THE RULE IS THE INSTALL REQUEST'S (services/packages/install/package-install-request-policy.ts):
 *   the owner in person decides anything. An agent of the owner may approve only a request it did
 *   not file, and only when it holds publish:public itself: an approver cannot pass on more than it
 *   holds. It may decline anything it did not ask for, because declining makes nothing public. An app
 *   grant, an ecosystem app and a visitor from another node decide nothing.
 *
 *   A REQUEST IS DECIDABLE FOR SEVEN DAYS, AND FAILS CLOSED. An expiry that is missing or cannot be
 *   read counts as passed, so a damaged record can only be declined by time, never approved.
 * @structure PUBLISH_REQUEST_DAYS · PublishDecider · publishDecisionRefusal(decider, request, decision) ·
 *   publishRequestExpired(request, now)
 * @usage
 *   const refusal = publishDecisionRefusal(decider, request, 'approve');
 *   if (refusal) return { ok: false, ...refusal };
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import type { CallerContext } from '../caller-context.js';
import { PUBLISH_PUBLIC_SCOPE } from '../../utils/scope-coverage.js';

/** How long a request waits for a decision. */
export const PUBLISH_REQUEST_DAYS = 7;

/** Who is deciding: what the policy reads of the session's caller object. */
export type PublishDecider = Pick<CallerContext, 'kind' | 'has' | 'principal'> & { auth: { sub: string } };

export type PublishDecisionRefusal = { status: 403; code: 'ACCESS_DENIED' | 'OWN_REQUEST' | 'SCOPE_DENIED'; message: string };

/** Where the owner answers a request, in words an agent can pass on to them. */
export const OWNER_DECIDES_ON_THE_PAGE =
  'The owner can approve it on their Notifications page, or from the notification itself.';

/** Why this decider may not make this decision, or null when it may. */
export function publishDecisionRefusal(
  decider: PublishDecider,
  request: { requested_by: { principal: string; sub: string } },
  decision: 'approve' | 'decline',
): PublishDecisionRefusal | null {
  if (decider.kind === 'owner') return null;
  if (decider.kind !== 'agent') {
    return {
      status: 403, code: 'ACCESS_DENIED',
      message: 'A request to make something public is decided by the account holder or by one of their own agents. An app or a visitor may ask, not answer.',
    };
  }
  const me = [decider.principal, decider.auth.sub];
  if (me.includes(request.requested_by.principal) || me.includes(request.requested_by.sub)) {
    return {
      status: 403, code: 'OWN_REQUEST',
      message: `You asked for this, so you cannot ${decision} it yourself. ${OWNER_DECIDES_ON_THE_PAGE}`,
    };
  }
  if (decision === 'decline') return null;
  if (decider.has(PUBLISH_PUBLIC_SCOPE)) return null;
  return {
    status: 403, code: 'SCOPE_DENIED',
    message: `Approving this makes something public, which takes "${PUBLISH_PUBLIC_SCOPE}", and you do not hold it. An agent cannot pass on more than it holds. ${OWNER_DECIDES_ON_THE_PAGE}`,
  };
}

/** True when the request can no longer be decided. A missing or unreadable expiry counts as passed. */
export function publishRequestExpired(request: { expires_at?: unknown }, now: number): boolean {
  const at = typeof request.expires_at === 'string' ? Date.parse(request.expires_at) : NaN;
  return !(Number.isFinite(at) && now < at);
}
