/**
 * @file src/services/datapackage/contract-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The EXCHANGE contract as an admission path of a data package read (plan doc-mvwxcas3dom3,
 *   D5.3): the paid feed that routes/odata.ts said would be built. One decision for the package reads,
 *   the OData feed and the CSV address, asked after the outside-party step (routes/party-read.ts) found
 *   no party credential:
 *
 *     1. The package's owner, and a reader the package's audience already admits, read as before and
 *        are never charged: a contract buys access the reader does not have, not a second bill for
 *        access it has. So a sold package is one whose audience is narrower than its buyers.
 *     2. Otherwise an account (the buyer, or the buyer's agent or app) holding a live entitlement on the
 *        package's coordinate (services/exchange-datapackage.ts) is admitted by it: the reader names the
 *        package and the versions of the interface the contract pins, a read without a version reads the
 *        newest of them, and another version is refused (403 VERSION_NOT_IN_CONTRACT).
 *     3. A data read admitted so (an OData entity set, a row window, a CSV) is metered and charged through
 *        the chokepoint every metered call shares (services/metered-access.ts), after the rows were read
 *        and before they are sent: a read that fails or is refused is not charged, and a budget cap or
 *        an inactive contract answers 402 as the extension paywall does.
 *   A paused or revoked contract admits nothing; an exhausted one still opens the descriptor, so its
 *   holder learns the budget is spent from the 402 of the data read.
 * @structure ContractReadAnswer · contractReaderFor · meterPackageRead
 * @usage
 *   const c = await contractReaderFor(deps, req.auth, { owner, name, version });
 *   const outcome = await meterPackageRead(deps, { caller, owner, name, session });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.3).
 */
import type { StoreDeps } from './store.js';
import type { DatapackageReader } from './audience.js';
import { datapackageReadable } from './audience.js';
import { readPointer, readTrustedVisibility } from './version-audience.js';
import { bare } from './contract.js';
import { readEntitlementForCall, type MeteredEntitlement } from '../metered-entitlements.js';
import { authoriseMeteredCall, type MeteredOutcome } from '../metered-access.js';
import { contractVersionHashes, datapackageCoordinate } from '../exchange-datapackage.js';
import { resolveIdentity, isForeignPrincipal } from '../../utils/gaii.js';

/** The facts of a verified token this decision reads. */
export interface ContractReadAuth {
    sub: string; owner: string; roles: string[]; scopes?: string[]; anonymous?: boolean; federated?: boolean;
}

export type ContractReadAnswer =
    | null
    | { ok: true; reader: DatapackageReader; version: string; entitlement: MeteredEntitlement }
    | { ok: false; status: 403 | 409; code: string; message: string };

/** Decide the contract half of one read. Null: no contract applies, the ordinary rules decide. */
export async function contractReaderFor(
    deps: StoreDeps, auth: ContractReadAuth | undefined | null, target: { owner: string; name: string; version?: string },
): Promise<ContractReadAnswer> {
    if (!auth?.sub || auth.anonymous || isForeignPrincipal(auth)) return null;
    if (auth.owner === target.owner) return null;
    const { storage, config } = deps;
    const ownerGhii = `${target.owner}@${config.nodeId}`;
    const pointer = await readPointer(deps, ownerGhii, target.name);
    if (!pointer?.contentHash || pointer.status === 'withdrawn') return null;
    // A reader the audience admits reads as before, uncharged.
    const visibility = await readTrustedVisibility(deps, ownerGhii, target.name);
    if (await datapackageReadable(storage, ownerGhii, visibility, auth, target.name)) return null;
    const coord = datapackageCoordinate(target.owner, target.name);
    const principal = resolveIdentity(auth, config.nodeId);
    const ent = await readEntitlementForCall(storage, principal, coord.ext, coord.action);
    if (!ent || ent.state === 'revoked' || ent.state === 'paused' || ent.surface?.kind !== 'datapackage') return null;
    const versions = await contractVersionHashes(storage, ownerGhii, target.name, ent.surface.ifaceVersion);
    if (!versions.length) {
        return { ok: false, status: 409, code: 'NO_VERSION_IN_CONTRACT', message: `No stored version of this package has the schemas of interface v${ent.surface.ifaceVersion}, which your contract covers. Ask the provider, or accept the current listing.` };
    }
    let version = versions[0]!;
    if (target.version) {
        const asked = versions.find(v => bare(v) === bare(target.version!));
        if (!asked) return { ok: false, status: 403, code: 'VERSION_NOT_IN_CONTRACT', message: `Your contract covers the versions with the schemas of interface v${ent.surface.ifaceVersion}; ${target.version} is not one of them.` };
        version = asked;
    }
    return {
        ok: true, version, entitlement: ent,
        reader: {
            sub: auth.sub, owner: auth.owner, roles: [...auth.roles], scopes: [...(auth.scopes ?? [])],
            contract: { ownerGhii, packageName: target.name, entitlementId: ent.entitlementId, versions },
        },
    };
}

/**
 * Meter and charge one data read of a sold package for `caller`: an account's principal, or an outside
 * party's identity (a purchase's prepaid contract). The chokepoint's outcome, which the route renders.
 */
export async function meterPackageRead(
    deps: StoreDeps, args: { caller: string; owner: string; name: string; session?: { roles: string[]; scopes: string[]; appGrantId?: string | null } | null },
): Promise<MeteredOutcome> {
    const coord = datapackageCoordinate(args.owner, args.name);
    return authoriseMeteredCall({
        config: deps.config, storage: deps.storage, caller: args.caller, session: args.session ?? null,
        product: { ext: coord.ext, action: coord.action, label: `pkg:${args.owner}/${args.name}`, providerOwner: args.owner },
    });
}
