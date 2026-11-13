/**
 * @file src/services/connect-tunnel-dm-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a `dm.inbound` delivery over the connector tunnel carries, given the permissions
 *   the receiving identity holds now.
 *
 *   WHY. Every read of a direct message addressed to an agent asks `messages:read`: GET
 *   /v1/messages/agent-inbox and /agent-thread, the MCP tools aimeat_dm_inbox and aimeat_dm_thread,
 *   and the SSE stream's `messages` domain. The tunnel push carried the subject, the sender and a
 *   preview of the body to the same identity without asking anything (secaudit2026oct31w2,
 *   connect-tunnel/delivery-push-ignores-identity-scopes).
 *
 *   WHAT IT DOES (the developer's ruling 2 of 2026-10-31). An identity whose current permissions
 *   cover `messages:read` gets the payload unchanged. Any other identity gets an arrival notice: the
 *   delivery id, the time, and a sentence saying the message waits until the person allows reading.
 *   The refusal is noted for an agent (services/agent/refusals.ts), which asks the owner once with
 *   Allow and Don't allow (services/permission-ask-notice.ts withheldDmNotice). After Allow the next
 *   delivery is whole.
 *
 *   CURRENT PERMISSIONS. The tunnel keeps the token it verified at upgrade or attach, so the check
 *   narrows it to the agent's record the way every REST request does (auth/effective-scopes.ts).
 * @structure DM_READ_SCOPE · WITHHELD_DM_CALL · WITHHELD_DM_NOTE · withheldDmPayload(payload) ·
 *   dmPayloadForReach(storage, identity, payload)
 * @usage
 *   if (evt.kind === 'dm.inbound') void dmPayloadForReach(storage, conn.identity, evt.payload).then(push);
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10, W2-13).
 */
import type { Storage } from '../storage/interface.js';
import type { VerifiedToken } from '../auth/jwt.js';
import { withCurrentScopes } from '../auth/effective-scopes.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { noteAgentRefusal } from './agent/refusals.js';
import { logger } from '../utils/logger.js';

/** The permission every read of a direct message addressed to the caller asks. */
export const DM_READ_SCOPE = 'messages:read';

/**
 * The `call` a withheld delivery is noted under on the agent's refusals. The agent's card shows it,
 * and services/permission-ask-notice.ts reads it to ask the owner in words about a message.
 */
export const WITHHELD_DM_CALL = 'connector delivery of a direct message';

/** What the receiving AI reads on an arrival notice. English, because a model reads it. */
export const WITHHELD_DM_NOTE = 'A direct message arrived for you, but you may not read messages yet. '
  + 'Your person has been asked whether to allow it. When they allow it, messages reach you whole, '
  + 'and this one waits in your inbox.';

/** The arrival notice: the delivery id and time, nothing of the message itself. */
export function withheldDmPayload(payload: unknown): Record<string, unknown> {
  const p = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  return {
    id: typeof p.id === 'string' ? p.id : null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : null,
    readable: false,
    needs: [DM_READ_SCOPE],
    note: WITHHELD_DM_NOTE,
  };
}

/**
 * The payload `identity` may receive for one `dm.inbound` delivery: unchanged when its current
 * permissions cover `messages:read`, else the arrival notice, with the refusal noted so the owner is
 * asked. Never throws: a failed read of the agent record falls back to the token's own permissions,
 * as the REST check does.
 */
export async function dmPayloadForReach(storage: Storage, identity: VerifiedToken, payload: unknown): Promise<unknown> {
  let scopes: readonly string[] = identity.scopes ?? [];
  try {
    scopes = (await withCurrentScopes(storage, identity)).scopes ?? [];
  } catch (err) {
    logger.warn('connect tunnel: current permissions not read; the token\'s own permissions decide', { principal: identity.sub, error: String(err) });
  }
  if (scopeIsCovered(scopes, DM_READ_SCOPE)) return payload;
  noteAgentRefusal(identity, [DM_READ_SCOPE], false, WITHHELD_DM_CALL);
  return withheldDmPayload(payload);
}
