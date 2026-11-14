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
 *
 *   AS THE OWNER. An agent or an ecosystem app holding consent:read-as-owner sees the account's
 *   consents, as the owner in person does: the word is the owner's tick per agent, outside every
 *   wildcard (utils/scope-coverage.ts). consentHolderOf() decides whose consents a caller sees, and
 *   GET /v1/consent, GET /v1/consent/:id, aimeat_consent_list and the consent-record resource all ask
 *   it. aimeat_consent_list listed the account's consents for every agent until 2026-11-14.
 * @structure ConsentRead · consentHolderOf(caller) · listConsentsFor(storage, caller, opts) ·
 *   consentRecordFor(storage, config, caller, id)
 * @usage
 *   const consents = await listConsentsFor(storage, callerOf(req, config.nodeId, storage), { status });
 *   const read = await consentRecordFor(storage, config, callerOf(req, config.nodeId, storage), id);
 * @version-history
 *   v1.2.0 — 2026-11-14 — consentHolderOf and listConsentsFor: an agent holding consent:read-as-owner
 *     sees the account's consents on the list and the read, on REST and MCP alike.
 *   v1.1.0 — 2026-11-14 — One holder for both surfaces, the session's principal (B13b).
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, phase B, B13).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { ConsentRecord } from '../../storage/types/auth.js';
import type { CallerContext } from '../caller-context.js';
import { accountHoldsConsent, listAccountConsents } from '../consent-write.js';
import { operatorOverride } from '../operator-override.js';
import { CONSENT_READ_AS_OWNER_SCOPE } from '../../utils/scope-coverage.js';

export { CONSENT_READ_AS_OWNER_SCOPE };

export type ConsentRead =
    | { status: 'ok'; record: ConsentRecord }
    | { status: 'missing' }
    | { status: 'refused' };

/** The caller facts consentHolderOf reads. */
export type ConsentReader = Pick<CallerContext, 'principal' | 'ownerGhii' | 'kind' | 'has'>;

/**
 * Whose consents this caller sees, as the identity accountHoldsConsent and listAccountConsents take:
 * the owner's account GHII for an agent or an ecosystem app holding consent:read-as-owner, so it sees
 * the account's consents (the owner's own and every agent's); otherwise the session's principal, which
 * for the owner in person is the account and for an agent is the agent itself. An app grant's principal
 * is the owner's, and a visitor from another node names no account here.
 */
export function consentHolderOf(caller: ConsentReader): string {
    const delegated = caller.kind === 'agent' || caller.kind === 'ecosystem';
    return delegated && caller.has(CONSENT_READ_AS_OWNER_SCOPE) ? caller.ownerGhii : caller.principal;
}

/** The consents this caller sees (consentHolderOf), newest first per holder as listAccountConsents gives them. */
export function listConsentsFor(
    storage: Storage, caller: ConsentReader,
    opts: { status?: 'active' | 'revoked' | 'expired'; recipient?: string } = {},
): Promise<ConsentRecord[]> {
    return listAccountConsents(storage, consentHolderOf(caller), opts);
}

/**
 * The consent `id` when `caller` may read it: held by the identity whose consents the caller sees
 * (consentHolderOf), or read by the operator, whose pass writes the operator trail.
 */
export async function consentRecordFor(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
    caller: ConsentReader & Pick<CallerContext, 'auth'>, id: string,
): Promise<ConsentRead> {
    const record = await storage.getConsent(id);
    if (!record) return { status: 'missing' };
    if (accountHoldsConsent(consentHolderOf(caller), record.ownerGaii)) {
        return { status: 'ok', record };
    }
    const admitted = await operatorOverride(storage, config, caller.auth,
        { ownerOf: record.ownerGaii, area: 'consent', action: 'read', subject: record.id });
    return admitted ? { status: 'ok', record } : { status: 'refused' };
}
