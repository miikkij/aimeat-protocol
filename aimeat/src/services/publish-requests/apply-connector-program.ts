/**
 * @file src/services/publish-requests/apply-connector-program.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner answered the question about a program a computer holds for an agent
 *   (services/connector-programs.ts filed it). Allow records the programs under the request's hash as
 *   allowed on that computer; Don't allow records them as declined. Either way the computer is told
 *   over its tunnel and acts on the hash it holds itself (services/connector-program-decision.ts).
 *   A computer that no longer reports that hash ends the request `outdated`.
 * @structure applyConnectorProgram · declineConnectorProgram
 * @usage registered in appliers.ts under the kind 'connector-program'
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 */
import { localAccountName } from '../../utils/gaii.js';
import { recordProgramDecision } from '../connector-program-decision.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

function targetOf(ownerGhii: string, request: PublishRequest): { owner: string; connector: string; hash: string } | null {
  const owner = localAccountName(ownerGhii);
  if (String(request.target.owner ?? '') !== owner) return null;
  return { owner, connector: String(request.target.connector ?? ''), hash: String(request.target.hash ?? '') };
}

export async function applyConnectorProgram(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const t = targetOf(ownerGhii, request);
  if (!t) return { ok: false, reason: 'the computer is not on this account' };
  return await recordProgramDecision(ctx, t.owner, t.connector, t.hash, 'allowed')
    ? { ok: true }
    : { ok: false, reason: 'the computer no longer reports this program' };
}

export async function declineConnectorProgram(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<void> {
  const t = targetOf(ownerGhii, request);
  if (t) await recordProgramDecision(ctx, t.owner, t.connector, t.hash, 'declined');
}
