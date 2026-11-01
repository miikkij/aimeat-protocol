/**
 * @file src/routes/pub-party-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outside-party step of GET /v1/pub/:gaii/datapkg/... (plan doc-mvwxcas3dom3, D3.2;
 *   lead decision L2): a party reads the files of a data package shared with it (the pointer, a
 *   version's descriptor, a resource CSV) with HTTP Basic or a party token, which DuckDB and pandas send
 *   when they follow the descriptor's relative paths. The share decides through routes/party-read.ts;
 *   the file verdict (services/datapackage/file-read.ts) then reads the party's reader, which opens
 *   the shared package only. The key in the address is not taken here: the CSV address for that is
 *   GET /v1/datapackages/{owner}/{name}/rows/{resource}?format=csv.
 * @structure partyPubReader
 * @usage const p = await partyPubReader(req, res, deps, gaii, key); if (p === null) return;
 * @version-history
 *   v1.1.0 — 2026-11-01 — A resource CSV read through a share a purchase made is metered (`charge`; plan D5.3).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D3.2).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { error } from '../middleware/envelope.js';
import { localAccountOf } from '../utils/gaii.js';
import { partyCredentialOf } from '../services/parties/verify.js';
import type { DatapackageReader } from '../services/datapackage/audience.js';
import { partyReaderFor, type PartyAdmitted } from './party-read.js';

/** `datapkg/{name}/latest.json` or `datapkg/{name}/{hash}/{rest}`, as services/datapackage/file-read.ts reads it. */
const PACKAGE_FILE_RE = /^datapkg\/([a-z0-9][a-z0-9-]{0,62}[a-z0-9])\/(?:latest\.json|([a-f0-9]{64})\/.+)$/;

/**
 * 'none' when the request carries no party credential (the ordinary rules decide); null when a party
 * was refused and the answer is sent; else the party's reader and its served() for the read log.
 */
export async function partyPubReader(
    req: Request, res: Response, deps: { storage: Storage; config: AimeatConfig }, gaii: string, key: string,
): Promise<(PartyAdmitted & { reader: DatapackageReader }) | 'none' | null> {
    if (!partyCredentialOf(req)) return 'none';
    const m = PACKAGE_FILE_RE.exec(key);
    const owner = localAccountOf(gaii.includes('@') ? gaii : `${gaii}@${deps.config.nodeId}`);
    if (!m || !owner) {
        res.status(404).json(error(deps.config.nodeId, 'NOT_FOUND', 'A party reads the files of a data package shared with it, and this is not one.'));
        return null;
    }
    const p = await partyReaderFor(req, res, deps, { owner, name: m[1]!, what: 'file', ...(m[2] ? { version: `sha256:${m[2]}` } : {}) });
    // A resource CSV is a data read, metered for a share a purchase made; the descriptor and the pointer are not (plan D5.3).
    if (p && p !== 'none' && !key.endsWith('.csv')) return { ...p, charge: async () => true };
    return p;
}
