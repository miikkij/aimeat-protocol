/**
 * @file src/routes/package-reader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reads a data package, for the package reads (routes/datapackages.ts) and the OData
 *   feed (routes/odata.ts): ONE decision with three admission paths, asked in this order.
 *     1. An outside party with a credential (routes/party-read.ts): its named share admits it.
 *     1b. A visitor from another AIMEAT node (a federated session): a named share to exactly their home
 *        GHII admits them (services/parties/visitor-read.ts). A visitor with no share reads only what
 *        a visitor may read anyway; anything else is 403 NOT_SHARED, the same for a package that does
 *        not exist, so the answer tells nothing about which packages exist.
 *     2. An account with an EXCHANGE contract on the package (services/datapackage/contract-read.ts),
 *        when the package's audience does not already admit it: the contract admits it to the versions
 *        of the interface it pins (plan doc-mvwxcas3dom3, D5.3).
 *     3. Everyone else: req.auth on the package's audience, as before.
 *   A reader of path 1 or 2 carries `charge()`, which the route calls for a DATA read (an OData entity
 *   set, a row window, a CSV) after the rows were read and before they are sent, so a failed or refused
 *   read is never charged. Path 3 charges nothing.
 * @structure PackageReadOpts · PackageReader · packageReaderFor
 * @usage const who = await packageReaderFor(req, res, deps, { owner, name, what }); if (!who) return;
 * @version-history
 *   v1.1.1 — 2026-11-01 — Path 1b decides a visitor's read on trustedAudienceOf, not the pointer's
 *     visibility (check:datapackage-pointer-reads).
 *   v1.1.0 — 2026-11-01 — Path 1b: a visitor from another AIMEAT node reads by a named share to their
 *     home account (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D5.3).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { DatapackageReader } from '../services/datapackage/audience.js';
import { contractReaderFor, meterPackageRead } from '../services/datapackage/contract-read.js';
import { resolveIdentity, isForeignPrincipal } from '../utils/gaii.js';
import { visitorReadVerdict } from '../services/parties/visitor-read.js';
import { readPointer } from '../services/datapackage/version-audience.js';
import { datapackageReadable } from '../services/datapackage/audience.js';
import { trustedAudienceOf } from '../services/datapackage/audience-record.js';
import { partyReaderFor, renderMeteredRead, sendReadRefusal, type PartyReadOpts } from './party-read.js';

export type PackageReadOpts = PartyReadOpts;

export interface PackageReader {
    reader: DatapackageReader | undefined;
    /** The reference to open: `pkg:owner/name[@version]`, the share's or the contract's version when the request named none. */
    ref: string;
    /** Admitted by a share or a contract: a package it cannot open is missing, not forbidden. */
    admitted: boolean;
    /** Admitted by an outside party's share. */
    party: boolean;
    served: (rows?: number) => void;
    /** Meter one data read before it is sent. False: refused, and the answer is sent. */
    charge: () => Promise<boolean>;
}

const refOf = (owner: string, name: string, version?: string): string => `pkg:${owner}/${name}${version ? `@${version}` : ''}`;

/** Decide who reads. Null when a refusal was sent. */
export async function packageReaderFor(
    req: Request, res: Response, deps: { storage: Storage; config: AimeatConfig }, opts: PackageReadOpts,
): Promise<PackageReader | null> {
    const p = await partyReaderFor(req, res, deps, opts);
    if (p === null) return null;
    if (p !== 'none') return { reader: p.reader, ref: refOf(opts.owner, opts.name, p.version), admitted: true, party: true, served: p.served, charge: p.charge };

    const auth = req.auth;
    // 1b. A visitor from another AIMEAT node: a named share to their home account admits them; without
    //     one they read only what a visitor may read anyway (a public package), and anything else is the
    //     same refusal whether or not the package exists.
    if (auth && isForeignPrincipal(auth)) {
        const visitor = resolveIdentity(auth, deps.config.nodeId);
        const ownerGhii = opts.owner.includes('@') ? opts.owner : `${opts.owner}@${deps.config.nodeId}`;
        const v = await visitorReadVerdict(deps, visitor, ownerGhii, { name: opts.name, ...(opts.version ? { version: opts.version } : {}), what: opts.what });
        if (v !== 'none') {
            if (!v.ok) { sendReadRefusal(res, deps.config.nodeId, opts.odata, v.status, v.code, v.message, v.details); return null; }
            res.setHeader('Cache-Control', 'private, no-store');
            res.vary('Authorization');
            return { reader: v.reader, ref: refOf(opts.owner, opts.name, v.version), admitted: true, party: true, served: v.served, charge: async () => true };
        }
        // The audience is the service's record (trustedAudienceOf), never the pointer file an app can rewrite.
        const trusted = await trustedAudienceOf(deps.storage, deps.config.nodeId, ownerGhii, opts.name, await readPointer(deps, ownerGhii, opts.name));
        if (!(await datapackageReadable(deps.storage, ownerGhii, trusted.visibility, auth as DatapackageReader, opts.name))) {
            sendReadRefusal(res, deps.config.nodeId, opts.odata, 403, 'NOT_SHARED', 'The owner has not shared this data package with you.');
            return null;
        }
    }
    const c = await contractReaderFor(deps, auth, { owner: opts.owner, name: opts.name, ...(opts.version ? { version: opts.version } : {}) });
    if (c && !c.ok) { sendReadRefusal(res, deps.config.nodeId, opts.odata, c.status, c.code, c.message); return null; }
    if (c && c.ok && auth) {
        // A response decided for this caller is never a shared cache's to keep.
        res.setHeader('Cache-Control', 'private, no-store');
        res.vary('Authorization');
        const caller = resolveIdentity(auth, deps.config.nodeId);
        const session = { roles: [...auth.roles], scopes: [...(auth.scopes ?? [])], appGrantId: auth.app_grant ?? null };
        return {
            reader: c.reader, ref: refOf(opts.owner, opts.name, c.version), admitted: true, party: false, served: () => {},
            charge: async () => renderMeteredRead(res, deps.config, opts.odata,
                await meterPackageRead(deps, { caller, owner: opts.owner, name: opts.name, session }), `pkg:${opts.owner}/${opts.name}`),
        };
    }
    return { reader: auth as DatapackageReader | undefined, ref: refOf(opts.owner, opts.name, opts.version), admitted: false, party: false, served: () => {}, charge: async () => true };
}
