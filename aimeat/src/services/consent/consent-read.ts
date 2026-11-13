/**
 * @file src/services/consent/consent-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read one consent record, and the read. GET /v1/consent/:id and the MCP
 *   resource aimeat://consent/{id} each read the record and asked accountHoldsConsent
 *   (services/consent-write.ts). The route then asked operatorOverride, as the operator ruling of
 *   2026-10-05 says every operator check does (services/operator-override.ts); the resource did not,
 *   so the operator's agent holding operator:admin read another owner's consent on REST and was
 *   refused on MCP (structure programme 2026-11, unit 2b, B13).
 *
 *   WHOSE CONSENTS. The two surfaces ask for different holders, and this function keeps that as it
 *   is: the route asks for the session's principal (an agent token holds the consents filed under the
 *   agent, decision 2026-10-02 "consent stays per agent"), the resource for the account (the account's
 *   consents are listed account-wide over MCP by design, mcp/consent.ts). `holder` names which one;
 *   both come from the caller, never from the request. The difference is recorded as an open question
 *   in test/e2e-tool-route-parity.ts (B13b).
 * @structure ConsentRead · consentRecordFor(storage, config, caller, id, holder)
 * @usage const read = await consentRecordFor(storage, config, callerOf(req, config.nodeId, storage), id, 'principal');
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B13).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { ConsentRecord } from '../../storage/types/auth.js';
import type { CallerContext } from '../caller-context.js';
import { accountHoldsConsent } from '../consent-write.js';
import { operatorOverride } from '../operator-override.js';

export type ConsentRead =
    | { status: 'ok'; record: ConsentRecord }
    | { status: 'missing' }
    | { status: 'refused' };

/**
 * The consent `id` when `caller` may read it: held by the caller's principal or account (`holder`),
 * or read by the operator, whose pass writes the operator trail.
 */
export async function consentRecordFor(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
    caller: Pick<CallerContext, 'principal' | 'ownerGhii' | 'auth'>, id: string, holder: 'principal' | 'account',
): Promise<ConsentRead> {
    const record = await storage.getConsent(id);
    if (!record) return { status: 'missing' };
    if (accountHoldsConsent(holder === 'principal' ? caller.principal : caller.ownerGhii, record.ownerGaii)) {
        return { status: 'ok', record };
    }
    const admitted = await operatorOverride(storage, config, caller.auth,
        { ownerOf: record.ownerGaii, area: 'consent', action: 'read', subject: record.id });
    return admitted ? { status: 'ok', record } : { status: 'refused' };
}
