/**
 * @file src/services/data-intermediation/gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who provides the data intermediation service here, and the one refusal the setting
 *   AIMEAT_DATA_INTERMEDIATION makes (plan doc-mvwxcas3dom3, D7.1, D7.2):
 *     report  nothing is refused;
 *     none    an EXCHANGE offering that delivers data is not listed to everyone: 403
 *             DATA_INTERMEDIATION_NOT_OFFERED. An offering is listed to everyone, so this is every new
 *             data offering; the named share (a party) is the way to give data to one recipient;
 *     node    nothing is refused; the operator is the provider and keeps the notification record;
 *     owners  as none, except for an owner who manages an organism that keeps a notification record
 *             (it declared itself a provider).
 *   A LISTING THAT EXISTS STAYS. The gate runs when a listing is made, never on one already made: the
 *   compliance report lists those as findings, and a person decides (security-fix-keeps-every-use).
 *
 *   THE RUNNING CONFIG. The EXCHANGE projection runs from memory write hooks that carry no config, so
 *   the config object is set here at boot (setIntermediationConfig, from services/core-jobs.ts) and read
 *   live: a change on the Config page writes the same object.
 * @structure setIntermediationConfig · intermediationMode · readIntermediationDocs · nodeNotification ·
 *   providerOrganisms · declaredProviderOf · dataListingRefusal · DATA_INTERMEDIATION_NOT_OFFERED
 * @usage const refused = await dataListingRefusal({ storage, config }, { providerOwner, kind });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D7.1, D7.2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { DataIntermediationMode } from '../../config-data-access.js';
import { listDocs, type ComplianceScope } from '../compliance-docs.js';
import type { IntermediationNotification } from '../compliance-docs-schemas.js';
import { isOrgManager } from '../workspace-access.js';
import { offeringDeliversData } from './contract.js';

export const DATA_INTERMEDIATION_NOT_OFFERED = 'DATA_INTERMEDIATION_NOT_OFFERED';

let running: Pick<AimeatConfig, 'dataIntermediation' | 'nodeId'> | null = null;

/** Hold the running config, so a code path without one reads the setting live. */
export function setIntermediationConfig(config: Pick<AimeatConfig, 'dataIntermediation' | 'nodeId'>): void {
    running = config;
}

/** The mode in force: the given config's, else the running one's, else the code default. */
export function intermediationMode(config?: Pick<AimeatConfig, 'dataIntermediation'> | null): DataIntermediationMode {
    return (config ?? running)?.dataIntermediation ?? 'report';
}

/** Every stored intermediation document, with its scope. */
export async function readIntermediationDocs(storage: Storage, nodeId: string): Promise<Array<{ scope: ComplianceScope; items: IntermediationNotification[] }>> {
    return (await listDocs(storage, nodeId, 'intermediation')).map(d => ({
        scope: d.scope,
        items: d.doc.items.filter((i): i is IntermediationNotification => i.type === 'notification'),
    }));
}

/** The node's notification record, or null. */
export function nodeNotification(docs: Awaited<ReturnType<typeof readIntermediationDocs>>): IntermediationNotification | null {
    return docs.find(d => d.scope.kind === 'node')?.items[0] ?? null;
}

/** The organisms that keep a notification record, with the record. */
export function providerOrganisms(docs: Awaited<ReturnType<typeof readIntermediationDocs>>): Map<string, IntermediationNotification> {
    const out = new Map<string, IntermediationNotification>();
    for (const d of docs) if (d.scope.kind === 'organism' && d.items[0]) out.set(d.scope.organismId, d.items[0]);
    return out;
}

/** The organism through which `ownerName` declared itself a provider (it manages it), or null. */
export async function declaredProviderOf(storage: Storage, nodeId: string, ownerName: string): Promise<string | null> {
    for (const organismId of providerOrganisms(await readIntermediationDocs(storage, nodeId)).keys()) {
        if (await isOrgManager(storage, organismId, ownerName)) return organismId;
    }
    return null;
}

/**
 * The refusal for listing an offering to everyone under the node's setting, or null. Asked before the
 * listing is written, on the REST listing and on the EXCHANGE projection.
 */
export async function dataListingRefusal(
    deps: { storage: Storage; config?: Pick<AimeatConfig, 'dataIntermediation' | 'nodeId'> | null },
    offering: { providerOwner: string; kind?: string; deliversData?: boolean | null },
): Promise<{ status: 403; code: typeof DATA_INTERMEDIATION_NOT_OFFERED; message: string } | null> {
    const mode = intermediationMode(deps.config);
    if (mode === 'report' || mode === 'node' || !offeringDeliversData(offering)) return null;
    const nodeId = (deps.config ?? running)?.nodeId ?? '';
    if (mode === 'owners' && await declaredProviderOf(deps.storage, nodeId, offering.providerOwner)) return null;
    return {
        status: 403, code: DATA_INTERMEDIATION_NOT_OFFERED,
        message: mode === 'owners'
            ? 'On this server only an owner who declared itself a data intermediation provider may list an offering that delivers data to everyone. '
                + 'Record the notification on an organism you manage (compliance document "intermediation"), or share the data with named outside parties instead (aimeat_party and a named share). Listings made before stay.'
            : 'This server does not run a data intermediation service, so an offering that delivers data is not listed to everyone. '
                + 'Share the data with named outside parties instead (aimeat_party and a named share), or ask the operator. Listings made before stay.',
    };
}
