/**
 * @file src/services/datapackage/file-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who reads one stored file of a data package through GET /v1/pub, decided by the
 *   package's audience (./audience.ts), the decision every other read path of a package asks.
 *
 *   WHY /v1/pub ASKS THE PACKAGE. The files of a package are stored at the storage tier nearest to its
 *   audience ('public', 'members', or 'private' for an organism or private package, since a file has no
 *   organism tier; ./audience.ts fileVisibilityOf). A tier rule can therefore not open an organism
 *   package's files to the organism's members: /v1/pub answered them 403 CONSENT_DENIED, so a
 *   Frictionless client following the descriptor's own addresses could read nothing, while GET
 *   /v1/datapackages admitted the same member. /v1/pub now asks this function for a file under
 *   `datapkg/` before its tier rule.
 *
 *   ONLY THE PACKAGE'S OWN FILES. The answer is 'open' or 'closed' for the pointer (`latest.json`), a
 *   version's descriptor and the CSV of a resource that descriptor names; anything else under
 *   `datapkg/` (a key the owner uploaded by hand, a file with no pointer or no descriptor beside it) is
 *   'not-package' and keeps the ordinary file rules, so the package's audience opens nothing it did
 *   not publish. A 'closed' file also keeps the ordinary rules, so a consent grant that admitted it
 *   before still does. A withdrawn package's file is 'withdrawn' for a reader the audience admits, and
 *   /v1/pub answers it 410 (./withdraw.ts).
 * @structure PackageFileVerdict · packageFileVerdict
 * @usage
 *   const verdict = await packageFileVerdict(storage, gaii, key, req.auth);
 *   if (verdict.kind === 'open' && file.visibility !== 'public') { ...serve... }
 * @version-history
 *   v1.1.0 — 2026-11-01 — 'withdrawn': a withdrawn package's own file (plan doc-mvwxcas3dom3, D0.3).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D0.4).
 */
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { descriptorKey, latestKey, resourceKey, type Descriptor, type LatestPointer } from './contract.js';
import { datapackageReadable, versionOpenTo, type DatapackageReader } from './audience.js';
import { withdrawalOf } from './withdraw.js';

/** What a /v1/pub read of a key under `datapkg/` is, for one reader. */
export type PackageFileVerdict =
    | { kind: 'not-package' }
    | { kind: 'open' }
    | { kind: 'closed' }
    | { kind: 'withdrawn'; withdrawnAt: string };

/** `datapkg/{name}/latest.json` or `datapkg/{name}/{hash}/{rest}`. */
const PACKAGE_FILE_RE = /^datapkg\/([a-z0-9][a-z0-9-]{0,62}[a-z0-9])\/(?:latest\.json|([a-f0-9]{64})\/(.+))$/;

function parseJson<T>(data: Buffer, what: string): T | null {
    try {
        return JSON.parse(data.toString('utf8')) as T;
    } catch (err) {
        // An unreadable pointer or descriptor makes no package of the key; the ordinary rules decide.
        logger.warn('datapackage: a stored file is not readable JSON', { what, error: String(err) });
        return null;
    }
}

/**
 * May `reader` read the stored file `key` of `ownerGhii` as part of a data package? 'not-package' when
 * the key is no file the package published; otherwise the package's audience and, for a version's
 * file, that version's own audience decide (datapackageReadable, versionOpenTo).
 */
export async function packageFileVerdict(
    storage: Storage, ownerGhii: string, key: string, reader: DatapackageReader | null | undefined,
): Promise<PackageFileVerdict> {
    const m = PACKAGE_FILE_RE.exec(key);
    if (!m) return { kind: 'not-package' };
    const [, name, hash, rest] = m;
    const pointerFile = await storage.getStorageFile(ownerGhii, latestKey(name));
    const pointer = pointerFile ? parseJson<LatestPointer>(pointerFile.data, latestKey(name)) : null;
    if (!pointer) return { kind: 'not-package' };

    let versionFile: { visibility?: string; tags?: readonly string[] } | null = null;
    if (hash) {
        const dFile = await storage.getStorageFile(ownerGhii, descriptorKey(name, hash));
        const descriptor = dFile ? parseJson<Descriptor>(dFile.data, descriptorKey(name, hash)) : null;
        if (!dFile || !descriptor) return { kind: 'not-package' };
        const ownFile = rest === 'datapackage.json'
            || (descriptor.resources ?? []).some(r => resourceKey(name, hash, r.name) === key);
        if (!ownFile) return { kind: 'not-package' };
        versionFile = dFile;
    }

    if (!(await datapackageReadable(storage, ownerGhii, pointer.visibility, reader))) return { kind: 'closed' };
    // A withdrawn package's files are served to nobody (./withdraw.ts); a reader the audience admits
    // learns it was withdrawn, anyone else gets the ordinary refusal.
    const withdrawn = withdrawalOf(pointer);
    if (withdrawn) return { kind: 'withdrawn', withdrawnAt: withdrawn.withdrawnAt };
    if (hash && versionFile && !(await versionOpenTo(storage, ownerGhii, reader, pointer, hash, versionFile))) return { kind: 'closed' };
    return { kind: 'open' };
}
