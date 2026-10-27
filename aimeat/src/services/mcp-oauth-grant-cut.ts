/**
 * @file src/services/mcp-oauth-grant-cut.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether an MCP OAuth grant artefact (an authorization code, a refresh token row) still
 *   stands after the agent's credential cut: a key rotation (routes/agents/rekey.ts), a device
 *   takeover with end_other_sessions, an agent delete, an account deactivation (secaudit2026oct26).
 *
 *   The cut stamps agent.credentialsValidAfter (or removes the agent, or sets the owner's disabledAt)
 *   and deletes the refresh rows present at that moment. It reached neither the authorization codes,
 *   which live in a per-process map with no issue time, nor a refresh that read the agent before the
 *   stamp and wrote its rotated row after the delete: that row looked newer than the stamp and kept
 *   minting. Here a code carries its issue time and is compared with the cut at the exchange, and a
 *   rotated refresh row is checked again after it is written, so a cut that ran in between removes it.
 * @structure grantCutRefusal · agentCutMark · cutHappenedSince
 * @usage
 *   const cut = await grantCutRefusal(storage, gaii, recordIssuedAt(iso));
 *   if (!cut.ok) return invalid_grant(cut.refusal);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26: authorization-code-outlives-agent-credential-cut,
 *     refresh-rotation-loses-grant-lineage).
 */
import type { Storage, AgentRecord } from '../storage/interface.js';
import { madeAfter, ownerRefuses, type IssuedAt } from '../auth/credential-age.js';
import { localAccountName } from '../utils/gaii.js';

const GONE = 'The agent this connection was approved for no longer exists. Connect again and approve the connection once more.';
const ROTATED = 'The agent\'s key was rotated. Connect again and approve the connection once more.';
const ACCOUNT = 'The account this agent acts for has been deactivated.';

/**
 * Why a grant artefact issued at `issued` for `gaii` no longer redeems, or null with the agent it
 * stands for: the agent is gone, was made after it (a new agent under a released name), its
 * credentials were cut after it, or its account is gone or deactivated.
 */
export async function grantCutRefusal(
  storage: Pick<Storage, 'getAgent' | 'getOwner'>, gaii: string, issued: IssuedAt | null,
): Promise<{ ok: false; refusal: string } | { ok: true; agent: AgentRecord }> {
  const agent = await storage.getAgent(gaii);
  if (!agent || madeAfter(agent.createdAt, issued)) return { ok: false, refusal: GONE };
  if (madeAfter(agent.credentialsValidAfter, issued)) return { ok: false, refusal: ROTATED };
  const owner = await storage.getOwner(localAccountName(gaii) || agent.owner);
  if (ownerRefuses(owner, null)) return { ok: false, refusal: ACCOUNT };
  return { ok: true, agent };
}

/** What a cut changes on the agent record, to compare before and after a write. */
export function agentCutMark(agent: Pick<AgentRecord, 'createdAt' | 'credentialsValidAfter'> | null): string {
  return agent ? `${agent.createdAt}|${agent.credentialsValidAfter ?? ''}` : '';
}

/**
 * Did a cut run since the agent was read as `mark`? Read again after a rotated refresh row is written:
 * a cut that ran before the write deleted the rows present then, not this one.
 */
export async function cutHappenedSince(storage: Pick<Storage, 'getAgent' | 'getOwner'>, gaii: string, mark: string): Promise<boolean> {
  const now = await grantCutRefusal(storage, gaii, null);
  return !now.ok || agentCutMark(now.agent) !== mark;
}
