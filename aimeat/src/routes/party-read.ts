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
 *   v1.1.0 — 2026-11-01 — An admitted party carries `charge()`: a share an EXCHANGE purchase made meters
 *     each data read against the purchase (402 PREPAID_ENDED when it is used up). sendReadRefusal and
 *     renderMeteredRead are shared with routes/package-reader.ts (plan doc-mvwxcas3dom3, D5.3, D5.4).
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
import { meterPackageRead } from '../services/datapackage/contract-read.js';
import type { MeteredOutcome } from '../services/metered-access.js';
import { meteredRefusalText } from './extensions/metered-response.js';
import { logger } from '../utils/logger.js';

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
    /**
     * Meter one DATA read before it is sent (plan D5.3): a share a purchase made charges its prepaid
     * contract, any other share charges nothing. False when the read was refused and the answer is sent.
     */
    charge: () => Promise<boolean>;
}

/** Send a read refusal: the OData error shape on the feed (with the Basic challenge on a 401), else the envelope. */
export function sendReadRefusal(
    res: Response, nodeId: string, odata: boolean | undefined, status: number, code: string, message: string, details?: Record<string, unknown>,
): void {
    if (status === 401 && odata) res.setHeader('WWW-Authenticate', 'Basic realm="aimeat", charset="UTF-8"');
    if (odata) {
        res.status(status).setHeader('Content-Type', 'application/json;odata.metadata=minimal');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }));
        return;
    }
    res.status(status).json(error(nodeId, code, message, undefined, details));
}

/**
 * Render a metered data read's outcome: true when the read goes on (settled, or the provider's own),
 * else the refusal is sent (402 for a spent budget, an inactive contract or a used-up purchase).
 */
export function renderMeteredRead(
    res: Response, config: AimeatConfig, odata: boolean | undefined, outcome: MeteredOutcome, label: string,
): boolean {
    if (outcome.kind === 'settled') {
        // The beneficiary book (services/metered-settlement.ts) never throws; a failure here is logged and the read goes on.
        void outcome.accrue().catch(err => logger.warn('party-read: the beneficiary accrual of a metered read failed', { label, error: String(err) }));
        return true;
    }
    if (outcome.kind === 'free_owner') return true;
    if (outcome.kind === 'no_right') {
        sendReadRefusal(res, config.nodeId, odata, 402, 'CONTRACT_REQUIRED', `Reading ${label} needs an EXCHANGE contract. Accept its offering first.`);
        return false;
    }
    const r = meteredRefusalText(outcome, label, config);
    sendReadRefusal(res, config.nodeId, odata, r.status, r.code, r.message);
    return false;
}

/** Decide the party half of one read. See the file header for the three answers. */
export async function partyReaderFor(
    req: Request, res: Response, deps: { storage: Storage; config: AimeatConfig }, opts: PartyReadOpts,
): Promise<PartyAdmitted | 'none' | null> {
    const cred = partyCredentialOf(req, opts.urlKey ? { urlKeyOwner: opts.owner } : {});
    if (!cred) return 'none';
    const send = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
        sendReadRefusal(res, deps.config.nodeId, opts.odata, status, code, message, details);
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
    const charge = async (): Promise<boolean> => {
        if (!gate.contract) return true;
        const outcome = await meterPackageRead(deps, { caller: ctx.partyRef, owner: opts.owner, name: opts.name });
        return renderMeteredRead(res, deps.config, opts.odata, outcome, `pkg:${opts.owner}/${opts.name}`);
    };
    return { reader: gate.reader, ...(gate.version ? { version: gate.version } : {}), served: gate.served, charge };
}
