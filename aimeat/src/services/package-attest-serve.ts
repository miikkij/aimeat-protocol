/**
 * @file services/package-attest-serve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one place this node signs a package it serves.
 *
 *   WHY IT IS NOT IN package-attestation.ts. That file is the format and the arithmetic, and both
 *   directions use it: a node signing what it serves, and a node checking what it fetched. This one
 *   reaches for the node's private key and therefore only ever runs on the serving side. Keeping the
 *   key access in a file the verifying path never imports is the boundary worth having.
 *
 *   A NODE WITHOUT A KEY SERVES AN UNSIGNED PACKAGE. That is the only case a package leaves here
 *   without a statement, and it is a fresh node before its key exists. The federation road refuses an
 *   unsigned package on the other side, which is the correct outcome: nothing here can vouch for it.
 * @structure attestationFor(storage, config, pkg)
 * @usage
 *   import { attestationFor } from './package-attest-serve.js';
 *   const zip = await buildZip(pkg, await attestationFor(storage, config, pkg));
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord } from '../storage/interface.js';
import { buildDescriptor, signAttestation, type AttestationDoc } from './package-attestation.js';
import { logger } from '../utils/logger.js';

/** This node's signed statement about one package version, or undefined when it has no key. */
export async function attestationFor(
    storage: Storage, config: AimeatConfig, pkg: PackageRecord,
): Promise<AttestationDoc | undefined> {
    const nodeKey = await storage.getNodeKey();
    if (!nodeKey?.privateKey) {
        logger.warn('package-attest: this node has no key, so the package is served unsigned', { package: pkg.packageGroupId });
        return undefined;
    }

    // A NODE SIGNS AS ITSELF, ALWAYS, including when it is re-serving something it pulled. Naming
    // the original node in a statement signed with THIS node's key would produce a signature the
    // puller refuses — it checks the claimed source against whose key it is verifying against, which
    // is exactly the check that stops one node speaking for another. Where a re-served package
    // originally came from travels as provenance on `upstream`, not inside somebody else's claim.
    //
    // The published instant, though, is the ORIGINAL one when there is one: it is what the
    // not-newer gate compares, and resetting it on every relay would make a re-export look newer
    // than the version it was copied from.
    const descriptor = buildDescriptor(
        pkg,
        { nodeId: config.nodeId, baseUrl: config.baseUrl },
        pkg.upstream?.publishedAt,
    );
    return signAttestation(nodeKey.privateKey, descriptor);
}
