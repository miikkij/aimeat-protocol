/**
 * @file src/services/work-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may request work from whom. One rule for every code path that creates work: the
 *   work queue (createWorkItem in routes/work.ts, which every work endpoint and MCP tool calls) and
 *   EXCHANGE agent work (POST /v1/exchange/work in routes/exchange-agent-work.ts, and the
 *   aimeat_exchange_work MCP tool in mcp/exchange-run.ts). Each caller names both parties by their
 *   full identities before it asks.
 * @structure WorkPartiesRefusal · refuseWorkBetween(requester, provider)
 * @usage
 *   const refused = refuseWorkBetween(requesterGaii, providerGaii);
 *   if (refused) return res.status(400).json(error(config.nodeId, refused.code, refused.message));
 * @version-history
 *   v1.0.0 — 2026-09-26 — Who may request work from whom, in one place for the work queue and EXCHANGE
 *     agent work (secaudit 2026-09, R4 5).
 */
import { ownerGhiiOf } from '../utils/gaii.js';

/** Why work between two parties is refused, with the error code every work endpoint returns. */
export interface WorkPartiesRefusal {
  code: 'SELF_WORK' | 'SAME_OWNER_WORK';
  message: string;
}

/**
 * Why work between this requester and this provider may not be created, or null when it may.
 *
 * No work between a principal and itself, and none between two principals of one owner: a person and
 * their own agent, either way round, or two agents of one person. Work is paid for and rated, and
 * both would let one person pay and rate themselves. A person is a provider too (routes/actions.ts
 * publishes their action under their GHII), and on EXCHANGE the provider is the agent that does the
 * work. ownerGhiiOf maps a GHII, a GAII and a GEAI to the owner's GHII with the node, so an account
 * of the same name on another node is another owner.
 */
export function refuseWorkBetween(requester: string, provider: string): WorkPartiesRefusal | null {
  if (requester === provider) {
    return { code: 'SELF_WORK', message: 'Cannot create work request to yourself' };
  }
  if (ownerGhiiOf(requester) === ownerGhiiOf(provider)) {
    return {
      code: 'SAME_OWNER_WORK',
      message: 'Cannot create a work request when the requester and the provider belong to the same owner',
    };
  }
  return null;
}
