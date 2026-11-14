/**
 * @file src/services/app/tools-manifest-reach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read the tool manifest of an app the operator hid. An app's sellable tool
 *   manifest is the public memory record `apps.<filename>.tools` of its owner. The catalogue leaves an
 *   operator-hidden app's tools out (commerce/app-tool-catalog.ts, secaudit2026oct22) and the WebMCP
 *   listing answers 404 for it, but the record itself still went to anybody on
 *   GET /v1/memory/:gaii/:key, aimeat_memory_read_public, aimeat_app_tools_get and the key list of
 *   GET /v1/memory/discover (structure programme 2026-11, unit 2b, B12; developer approval 2026-11-14).
 *
 *   THE RULE. The manifest of an app the operator hid answers as absent to everyone but the app's own
 *   account (the owner and the owner's agents) and the operator, whose pass writes the operator trail.
 *   Any other record, and the manifest of an app that is not hidden, is decided by its own rules.
 * @structure appOfToolsKey(key) · toolsManifestHiddenFrom(storage, config, ownerGaii, key, reader) ·
 *   withoutHiddenToolManifests(storage, rows, readerOwner)
 * @usage if (await toolsManifestHiddenFrom(storage, config, record.ownerGaii, record.key, { owner, auth })) return notFound();
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, B12).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { operatorOverride, type OperatorAuth } from '../operator-override.js';

/** The app filename a key `apps.<filename>.tools` names, or null for any other key. */
export function appOfToolsKey(key: string): string | null {
    const m = /^apps\.(.+)\.tools$/.exec(key);
    return m ? m[1]! : null;
}

/** Who reads: the account the caller acts in (null for nobody signed in) and the session for the operator's pass. */
export interface ManifestReader { owner: string | null | undefined; auth: OperatorAuth | null | undefined }

/**
 * True when the record `key` of `ownerGaii` is the tool manifest of an app the operator hid and
 * `reader` is neither that app's account nor the operator.
 */
export async function toolsManifestHiddenFrom(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
    ownerGaii: string, key: string, reader: ManifestReader,
): Promise<boolean> {
    const filename = appOfToolsKey(key);
    if (!filename) return false;
    const ownerName = localAccountName(ownerGaii);
    if (!ownerName || reader.owner === ownerName) return false;
    const hidden = await storage.findOperatorHiddenApps([{ ownerName, filename }]);
    if (hidden.length === 0) return false;
    const admitted = !!reader.auth && await operatorOverride(storage, config, reader.auth,
        { ownerOf: ownerGaii, area: 'app', action: 'read', subject: `${filename} tools` });
    return !admitted;
}

/**
 * `rows` without the tool manifests of apps the operator hid, for a key list that names other
 * accounts' records (one read for the whole list). The reader's own account keeps its own.
 */
export async function withoutHiddenToolManifests<T extends { ownerGaii: string; key: string }>(
    storage: Storage, rows: T[], readerOwner: string | null | undefined,
): Promise<T[]> {
    const named = rows
        .map(r => ({ row: r, filename: appOfToolsKey(r.key), ownerName: localAccountName(r.ownerGaii) }))
        .filter(x => x.filename && x.ownerName && x.ownerName !== readerOwner);
    if (named.length === 0) return rows;
    const hidden = new Set((await storage.findOperatorHiddenApps(named.map(x => ({ ownerName: x.ownerName!, filename: x.filename! }))))
        .map(a => `${a.ownerName}\u0000${a.filename}`));
    if (hidden.size === 0) return rows;
    const drop = new Set(named.filter(x => hidden.has(`${x.ownerName}\u0000${x.filename}`)).map(x => x.row));
    return rows.filter(r => !drop.has(r));
}
