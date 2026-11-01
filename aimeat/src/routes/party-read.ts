/**
 * @file src/routes/party-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outside-party step of a data package read endpoint (plan doc-mvwxcas3dom3, D2.1,
 *   D3.2; lead decision L2): the data package reads, the OData feed and /v1/pub package files call
 *   partyReaderFor() first. It is a helper those routes call, never middleware: a party is read only
 *   where a route asks for it.
 *
 *   It answers one of three things:
 *     'none'   the request carries no party credential; the route goes on with req.auth as before;
 *     null     a party credential was presented and refused, and the answer is already sent: 401 for
 *              a credential that names no live party and key (on the OData feed with
 *              `WWW-Authenticate: Basic realm="aimeat"`, so Excel and Power BI ask for the password),
 *              403 with a code for a party that is stopped or a share that does not admit the read,
 *              429 past the party's rate;
 *     a reader the route passes to the store in place of req.auth, admitted to this package only, and
 *     the version to read (the share's pinned one when the request named none).
 *   A party key of one owner never opens another owner's package: the path's owner must be the
 *   party's owner (403 NOT_SHARED).
 * @structure PartyReadOpts · PartyAdmitted · partyReaderFor
 * @usage const p = await partyReaderFor(req, res, deps, { owner, name, version, what: 'rows' }); if (p === null) return;
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.1, D3.2; lead decision L2).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { error } from '../middleware/envelope.js';
import { partyCredentialOf, verifyParty } from '../services/parties/verify.js';
import { partyReadVerdict } from '../services/parties/read-gate.js';
import { logPartyRead } from '../services/parties/activity.js';
import type { DatapackageReader } from '../services/datapackage/audience.js';

export interface PartyReadOpts {
    /** The owner and the package the path names. */
    owner: string;
    name: string;
    /** The version the request names (sha256:<hex>), if any. */
    version?: string;
    /** What is read, for the read log. */
    what: string;
    /** The OData feed: refusals in the OData error shape, and the Basic challenge on a 401. */
    odata?: boolean;
    /** Take the key in the address (`?key=`): the CSV download only. */
    urlKey?: boolean;
}

export interface PartyAdmitted {
    reader: DatapackageReader;
    version?: string;
    /** Write the served read to the owner's read log. */
    served: (rows?: number) => void;
}

/** Decide the party half of one read. See the file header for the three answers. */
export async function partyReaderFor(
    req: Request, res: Response, deps: { storage: Storage; config: AimeatConfig }, opts: PartyReadOpts,
): Promise<PartyAdmitted | 'none' | null> {
    const cred = partyCredentialOf(req, opts.urlKey ? { urlKeyOwner: opts.owner } : {});
    if (!cred) return 'none';
    const send = (status: number, code: string, message: string, details?: Record<string, unknown>) => {
        if (status === 401 && opts.odata) res.setHeader('WWW-Authenticate', 'Basic realm="aimeat", charset="UTF-8"');
        if (opts.odata) {
            res.status(status).setHeader('Content-Type', 'application/json;odata.metadata=minimal');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.send(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }));
            return;
        }
        res.status(status).json(error(deps.config.nodeId, code, message, undefined, details));
    };
    const verdict = await verifyParty(deps, cred);
    if (!verdict.ok) { send(verdict.status, verdict.code, verdict.message); return null; }
    const ctx = verdict.ctx;
    if (ctx.owner !== opts.owner) {
        logPartyRead(deps.storage, ctx.ownerGhii, {
            at: new Date().toISOString(), share: null, party: ctx.party.name, uid: ctx.party.uid,
            what: `${opts.owner}/${opts.name}/${opts.what}`, verdict: 'refused', code: 'NOT_SHARED',
        });
        send(403, 'NOT_SHARED', 'This data package belongs to another owner, and it was not shared with you.');
        return null;
    }
    const gate = await partyReadVerdict(deps, ctx, { name: opts.name, ...(opts.version ? { version: opts.version } : {}), what: opts.what });
    if (!gate.ok) {
        if (gate.status === 429) res.setHeader('Retry-After', '60');
        send(gate.status, gate.code, gate.message, gate.details);
        return null;
    }
    // A response decided for this caller is never a shared cache's to keep.
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Authorization');
    return { reader: gate.reader, ...(gate.version ? { version: gate.version } : {}), served: gate.served };
}
