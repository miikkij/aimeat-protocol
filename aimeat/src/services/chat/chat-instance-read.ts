/**
 * @file src/services/chat/chat-instance-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read one chat instance, and the read. GET /v1/chat-instances/:id, the MCP tool
 *   aimeat_instance_status and the MCP resource aimeat://instances/{id} each read the record and
 *   compared its owner with the caller's account. The route then asked operatorOverride, as the
 *   operator ruling of 2026-10-05 says every operator check does (services/operator-override.ts); the
 *   tool and the resource did not, so the operator's agent holding operator:admin read another
 *   owner's instance on REST and was refused on MCP (structure programme 2026-11, unit 2b, B11).
 *
 *   THE RULE. The instance's own account reads it; so does the operator, through operatorOverride,
 *   which writes the operator trail. The answer keeps "missing" and "refused" apart, because the tool
 *   names them differently; the route answers 404 for both, so existence is not confirmed.
 * @structure ChatInstanceRead · chatInstanceFor(storage, config, caller, id, action?)
 * @usage
 *   const read = await chatInstanceFor(storage, config, callerOf(req, config.nodeId, storage), id);
 *   if (read.status !== 'ok') return notFound();
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B11).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { ChatInstanceRecord } from '../../storage/types/identity.js';
import type { CallerContext } from '../caller-context.js';
import { localAccountName } from '../../utils/gaii.js';
import { operatorOverride } from '../operator-override.js';

export type ChatInstanceRead =
    | { status: 'ok'; record: ChatInstanceRecord }
    | { status: 'missing' }
    | { status: 'refused' };

/**
 * The chat instance `id` when `caller` may read it: the instance's own account, or the operator (the
 * pass writes the operator trail with `action`).
 */
export async function chatInstanceFor(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
    caller: Pick<CallerContext, 'owner' | 'auth'>, id: string, action = 'read',
): Promise<ChatInstanceRead> {
    const record = await storage.getChatInstance(id);
    if (!record) return { status: 'missing' };
    // registerChatInstance (services/chat-instance-write.ts) builds `ghii` from `ownerName`, so the two
    // name one account; the route compared the first, the tool and the resource the second.
    const account = record.ownerName || localAccountName(record.ghii);
    if (account === caller.owner) return { status: 'ok', record };
    const admitted = await operatorOverride(storage, config, caller.auth,
        { ownerOf: record.ghii, area: 'chat-instance', action, subject: id });
    return admitted ? { status: 'ok', record } : { status: 'refused' };
}
