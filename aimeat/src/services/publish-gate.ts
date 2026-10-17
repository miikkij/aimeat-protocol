/**
 * @file src/services/publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may make something public without the owner answering a request first (plan
 *   doc-mvcn6c7e4e5q, V4.2). One decision, asked by every place that can make content public: a
 *   memory record, a stored file, a workspace share open to the link, an app anyone may open, an
 *   organism, a board, a skill, a package, a knowledge package, a data package, a portfolio.
 *
 *   THE RULE (Jouni, 2026-10-17): "ihminen voi komentaa agenttia tekemään niin ja silloin agentti
 *   toteuttaa sen, eli agentin on pystyttävä tekemään se jos sille on annettu oikeus toimia niin."
 *   The owner in person may always. An agent may when it holds publish:public, which the owner ticks
 *   on its own and no wildcard carries. An app grant or an ecosystem app may when it holds the same
 *   word, or when the node's gate does not cover apps. Everyone else's attempt becomes a request the
 *   owner approves (services/publish-requests/), never a plain refusal: the agent hands the owner an
 *   address and the owner decides.
 *
 *   THE NODE DECIDES WHETHER TO ASK AT ALL. config.publishGate: 'off' (the code default, so a
 *   running node with community apps that write public entries does not change under them),
 *   'agents', or 'agents-and-apps'. Decision 11.2: aimeat.io changes only after the exposure report.
 *
 *   A VISITOR FROM ANOTHER NODE, and the anonymous identity, make nothing public here and file no
 *   request: there is no owner on this node to ask.
 *
 *   The kind of caller is read from its caller object (services/caller-context.ts), never from a
 *   role list here.
 * @structure publishGateDecision(config, caller) · PublishGateCaller · PublishGateDecision ·
 *   isRaiseToPublic(from, to)
 * @usage
 *   const gate = publishGateDecision(config, callerOf(req, config.nodeId, storage));
 *   if (!gate.allowed) { ...store it at the level it had, file a request (publish-requests/ask.ts) ... }
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.2).
 */
import type { PublishGate } from '../config-visibility.js';
import type { CallerContext } from './caller-context.js';
import { PUBLISH_PUBLIC_SCOPE } from '../utils/scope-coverage.js';

/** What the decision reads of a caller. */
export type PublishGateCaller = Pick<CallerContext, 'kind' | 'has' | 'principal'>;

export type PublishGateDecision =
  | { allowed: true }
  /** Ask the owner: the caller is one of their agents or apps without the word. */
  | { allowed: false; ask: 'agent' | 'app' }
  /** Nobody here to ask: a visitor from another node or the anonymous identity. */
  | { allowed: false; ask: null; status: 403; code: 'PUBLISH_NOT_ALLOWED'; message: string };

const NOBODY_TO_ASK = {
  allowed: false as const, ask: null, status: 403 as const, code: 'PUBLISH_NOT_ALLOWED' as const,
  message: 'Making something public here is for the account holder, or for their agents and apps with their permission. Nothing was made public.',
};

/**
 * May this caller make something public on its own? `config.publishGate` absent counts as 'off'.
 * Only a change TO public is asked about; keeping something public that already is, or making it
 * less open, needs nothing (isRaiseToPublic).
 */
export function publishGateDecision(config: { publishGate?: PublishGate }, caller: PublishGateCaller): PublishGateDecision {
  const gate = config.publishGate ?? 'off';
  if (gate === 'off') return { allowed: true };
  if (caller.principal.includes('#anonymous@')) return NOBODY_TO_ASK;
  switch (caller.kind) {
    case 'owner': return { allowed: true };
    case 'visitor':
    case 'anonymous': return NOBODY_TO_ASK;
    case 'app':
    case 'ecosystem':
      return gate !== 'agents-and-apps' || caller.has(PUBLISH_PUBLIC_SCOPE) ? { allowed: true } : { allowed: false, ask: 'app' };
    case 'agent':
      return caller.has(PUBLISH_PUBLIC_SCOPE) ? { allowed: true } : { allowed: false, ask: 'agent' };
    default: return { allowed: true };
  }
}

/** True when a change takes content to anyone from something narrower (or from nothing, on a create). */
export function isRaiseToPublic(from: unknown, to: unknown, publicValue: unknown = 'public'): boolean {
  return to === publicValue && from !== publicValue;
}
