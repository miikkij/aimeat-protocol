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
 *   WHOSE CONSENTS. The session's principal holds them: an agent token holds the consents filed under
 *   the agent (decision 2026-10-02 "consent stays per agent"), and the owner in person the account's,
 *   their agents' included (accountHoldsConsent). The resource read the account's for an agent too, so
 *   an agent read the consents its owner gave in person there and got 403 on the route; the developer
 *   chose the route's rule for both on 2026-11-14 (B13b).
 * @structure ConsentRead · consentRecordFor(storage, config, caller, id)
 * @usage const read = await consentRecordFor(storage, config, callerOf(req, config.nodeId, storage), id);
 * @version-history
 *   v1.1.0 — 2026-11-14 — One holder for both surfaces, the session's principal (B13b).
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
 * The consent `id` when `caller` may read it: held by the caller's principal, or read by the operator,
 * whose pass writes the operator trail.
 */
export async function consentRecordFor(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
    caller: Pick<CallerContext, 'principal' | 'auth'>, id: string,
): Promise<ConsentRead> {
    const record = await storage.getConsent(id);
    if (!record) return { status: 'missing' };
    if (accountHoldsConsent(caller.principal, record.ownerGaii)) {
        return { status: 'ok', record };
    }
    const admitted = await operatorOverride(storage, config, caller.auth,
        { ownerOf: record.ownerGaii, area: 'consent', action: 'read', subject: record.id });
    return admitted ? { status: 'ok', record } : { status: 'refused' };
}
