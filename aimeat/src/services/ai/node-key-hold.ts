/**
 * @file src/services/ai/node-key-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one call on the node's shared AI key may cost, decided before it runs.
 *
 *   The node's key (AIMEAT_OPENROUTER_INSTANCE_KEY) pays for people who have no key of their own, up
 *   to each person's allowance (services/ai-allowance.ts). The allowance was a yes or no on whether any
 *   of it was left, and the cost was debited after the provider answered, while the caller named the
 *   model and the answer's length. So an account with a few cents left could start many calls side by
 *   side to an expensive model with a long answer, and the node's key paid all of them
 *   (secaudit2026oct22, node-key-allowance-precheck-unbounded-call-cost). Now:
 *   - the answer's length on the node's key is at most ai.node_key_max_output_tokens (default 32000;
 *     0 is no limit): a call that names none or more gets that many, and its answer says when it was
 *     cut short (`truncated`, finish reason `length`);
 *   - the planner prices the call from the prompt's size and that length with the model catalogue,
 *     and a call that costs more than what is left for this account (less what its calls in flight
 *     hold) is treated as a spent allowance: a text call that named no model gets the free model, any
 *     other is refused with the price, what is left, and the ways forward;
 *   - while the call runs, its estimate is held against the account (and in 'limits' mode against the
 *     node's daily limit too), so calls side by side cannot together pass what is left; the hold ends
 *     when the call is settled or fails.
 *   Calls on a person's or an agent's own key are not touched by any of this.
 *
 *   PER PROCESS, like every limiter here: a node runs one process.
 * @structure nodeKeyOutputCap · nodeKeyRoomUsd · tooCostlyMessage · holdNodeKeyCandidates
 * @usage
 *   const held = holdNodeKeyCandidates(gaii, plan.candidates);
 *   try { ... runRoute({ candidates: held.candidates, ... }) ... settle ... } finally { held.release(); }
 * @version-history
 *   v1.0.1 -- 2026-10-27 -- A text model the catalogue does not price is held too (route-plan.ts; secaudit2026oct26).
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, node-key-allowance-precheck-unbounded-call-cost).
 */
import type { AimeatConfig } from '../../config.js';
import { AiCompletionError } from './errors.js';

/** What may still be spent on the node's key, as nodeKeyStanding answered it at plan time. */
export interface NodeKeyRoom {
  headroomUsd?: number;
  nodeHeadroomUsd?: number;
}

/** What a node-key candidate carries from the planner to the call. */
export interface NodeKeyHold {
  /** The call's price by the catalogue, at most. A text model it does not price: the settlement's
   *  fallback rates, at most what was left (route-plan.ts). */
  estimateUsd: number;
  /** The answer's length the call is sent with, when the node's limit applies. */
  maxTokens?: number;
  /** What was left at plan time. */
  room: NodeKeyRoom;
}

/** The answer's length on the node's key: the caller's, at most the operator's limit; the limit when the caller named none. */
export function nodeKeyOutputCap(config: Pick<AimeatConfig, 'aiNodeKeyMaxOutputTokens'>, maxTokens?: number): number | undefined {
  const cap = config.aiNodeKeyMaxOutputTokens;
  if (!(Number.isInteger(cap) && cap > 0)) return maxTokens;
  return typeof maxTokens === 'number' && maxTokens > 0 ? Math.min(maxTokens, cap) : cap;
}

const heldByAccount = new Map<string, number>();
let heldOnNode = 0;

/** What may still be spent for this account now: what was left, less what its calls in flight hold. */
export function nodeKeyRoomUsd(gaii: string, room: NodeKeyRoom): number {
  const mine = (room.headroomUsd ?? 0) - (heldByAccount.get(gaii) ?? 0);
  return room.nodeHeadroomUsd === undefined ? mine : Math.min(mine, room.nodeHeadroomUsd - heldOnNode);
}

/** The refusal when a call would cost more than is left. */
export function tooCostlyMessage(estimateUsd: number, roomUsd: number): string {
  return `This call could cost up to about $${estimateUsd.toFixed(4)} on this node's shared AI key, and $${Math.max(0, roomUsd).toFixed(4)} is left for you `
    + 'now, counting your calls still running. Ask for a shorter answer (max_tokens), choose a cheaper model, or set your own key in your AI settings.';
}

/** Take the hold for one call, or null when it no longer fits (calls that started since the plan took the room). */
function take(gaii: string, hold: NodeKeyHold): (() => void) | null {
  const usd = hold.estimateUsd;
  if (!(usd > 0)) return () => {};
  if (usd > nodeKeyRoomUsd(gaii, hold.room)) return null;
  const onNode = hold.room.nodeHeadroomUsd !== undefined;
  heldByAccount.set(gaii, (heldByAccount.get(gaii) ?? 0) + usd);
  if (onNode) heldOnNode += usd;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (heldByAccount.get(gaii) ?? 0) - usd;
    if (left > 1e-12) heldByAccount.set(gaii, left); else heldByAccount.delete(gaii);
    if (onNode) heldOnNode = Math.max(0, heldOnNode - usd);
  };
}

/**
 * Hold the estimate of every node-key candidate before the route runs. A candidate whose hold no
 * longer fits is left out; when that leaves none, the call is refused with the price. The release
 * ends every hold; call it once the call is settled or failed.
 */
export function holdNodeKeyCandidates<C extends { nodeKey?: NodeKeyHold }>(gaii: string, candidates: C[]): { candidates: C[]; release: () => void } {
  const releases: Array<() => void> = [];
  const kept: C[] = [];
  let refused: NodeKeyHold | null = null;
  for (const c of candidates) {
    if (!c.nodeKey) { kept.push(c); continue; }
    const release = take(gaii, c.nodeKey);
    if (release) { releases.push(release); kept.push(c); } else refused ??= c.nodeKey;
  }
  const release = () => { for (const r of releases) r(); };
  if (kept.length === 0 && refused) {
    throw new AiCompletionError('QUOTA_EXHAUSTED', 402, tooCostlyMessage(refused.estimateUsd, nodeKeyRoomUsd(gaii, refused.room)));
  }
  return { candidates: kept, release };
}
