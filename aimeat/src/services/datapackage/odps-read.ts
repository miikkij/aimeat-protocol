/**
 * @file src/services/datapackage/odps-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ODPS product sheet of one data package version, projected when it is read.
 *
 *   The sheet used to be written once, at publish, as `odps.yaml` beside the descriptor, and it said
 *   `visibility: public` and "No authentication" for every package, a members, organism or private one
 *   included. An audience also changes after the write (an approved publish request, a re-publish of
 *   the same bytes under another audience), and a stored sheet cannot follow it. So the sheet is now
 *   projected from the descriptor and the version's audience on every read, the way
 *   services/exchange-odps.ts projects an offering's sheet, and nothing is stored for a new version.
 *
 *   The reader is admitted by openPackage (./store.ts), the same audience decision every other read
 *   path asks, so a reader who may not open the package gets null. A withdrawn package answers null too.
 *
 *   The address a version published before 2026-11-01 stored its sheet at
 *   (`/v1/pub/{owner}/datapkg/{name}/{hash}/odps.yaml`) redirects here (odpsRedirectFor), so that
 *   address answers the projection and not the stored text.
 * @structure versionAudienceOf · odpsSheetFor · odpsAddress · odpsRedirectFor
 * @usage
 *   const sheet = await odpsSheetFor({ storage, config }, 'pkg:alice/shortages', nodeId, req.auth);
 *   if (sheet) res.type('text/yaml').send(sheet.yaml);
 * @version-history
 *   v1.2.0 — 2026-11-01 — The sheet carries the package's freshness (./freshness-read.ts; plan D6.1).
 *   v1.1.0 — 2026-11-01 — The sheet names the owner's stated company as `dataHolder` (./data-holder.ts;
 *     plan doc-mvwxcas3dom3, D1.2).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D0.1).
 */
import type { StoreDeps } from './store.js';
import { openPackage, parseRef } from './store.js';
import { readPointer } from './version-audience.js';
import { recordedAudienceOf, type DatapackageReader } from './audience.js';
import { bare, descriptorKey, publicUrl, resourceKey, type LatestPointer } from './contract.js';
import { descriptorToOdps, odpsToYamlDocument } from './odps.js';
import { localAccountName } from '../../utils/gaii.js';
import { dataHolderFor } from './data-holder.js';
import { packageFreshness } from './freshness-read.js';

/**
 * The audience of one stored version: the pointer's when the pointer names it, else the audience
 * recorded on its descriptor file (./audience.ts withAudienceTag), else the tier its descriptor file
 * was stored at, for a version written before the audience was recorded.
 */
export async function versionAudienceOf(
    deps: StoreDeps, ownerGhii: string, name: string, contentHash: string, pointer: LatestPointer | null,
): Promise<string> {
    if (pointer?.contentHash && bare(pointer.contentHash) === bare(contentHash)) return pointer.visibility ?? 'public';
    const file = await deps.storage.getStorageFileMeta(ownerGhii, descriptorKey(name, contentHash));
    const recorded = recordedAudienceOf(file?.tags);
    if (recorded) return recorded;
    return file?.visibility === 'public' || file?.visibility === 'members' ? file.visibility : 'private';
}

/** The sheet of the version `ref` names, for a reader the package's audience admits; null otherwise. */
export async function odpsSheetFor(
    deps: StoreDeps, ref: string, nodeId: string, reader: DatapackageReader | null | undefined,
): Promise<{ doc: Record<string, unknown>; yaml: string; contentHash: string } | null> {
    const parsed = parseRef(ref, nodeId);
    const opened = parsed ? await openPackage(deps, ref, nodeId, reader) : null;
    if (!parsed || !opened) return null;
    const d = opened.descriptor;
    const ownerGhii = parsed.ownerGhii;
    const contentHash = d.aimeat.contentHash;
    const audience = await versionAudienceOf(deps, ownerGhii, d.name, contentHash, opened.latest ?? await readPointer(deps, ownerGhii, d.name));
    const doc = descriptorToOdps({
        descriptor: d, ownerGhii, baseUrl: deps.config.baseUrl, descriptorUrl: opened.descriptorUrl, audience,
        // The legal entity behind it, when the owner stated a company it can be said to be held by.
        dataHolder: await dataHolderFor(deps, ownerGhii, audience),
        // The package's freshness against its producer's promise (./freshness.ts, D6.1).
        freshness: await packageFreshness(deps, ownerGhii, d.name, opened.latest ? { pointer: opened.latest } : {}),
        resourceUrls: Object.fromEntries(d.resources.map(r => [r.name, publicUrl(deps.config.baseUrl, ownerGhii, resourceKey(d.name, contentHash, r.name))])),
    });
    return { doc, yaml: odpsToYamlDocument(doc), contentHash };
}

/** Where one version's sheet is read: GET /v1/datapackages/{owner}/{name}/odps, pinned to the version. */
export function odpsAddress(baseUrl: string, ownerName: string, name: string, contentHash: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/v1/datapackages/${encodeURIComponent(ownerName)}/${encodeURIComponent(name)}/odps`
        + `?version=sha256:${bare(contentHash)}`;
}

const STORED_SHEET_RE = /^datapkg\/([a-z0-9][a-z0-9-]{0,62}[a-z0-9])\/([a-f0-9]{64})\/odps\.yaml$/;

/**
 * The projection's address for a stored sheet's key under /v1/pub, or null when the key is not a
 * sheet of a package of this node. Answered before the file is looked up, because a version published
 * since 2026-11-01 has no stored sheet.
 */
export function odpsRedirectFor(nodeId: string, ownerGhii: string, key: string): string | null {
    const m = STORED_SHEET_RE.exec(key);
    if (!m || !ownerGhii.endsWith(`@${nodeId}`)) return null;
    return `/v1/datapackages/${encodeURIComponent(localAccountName(ownerGhii))}/${m[1]}/odps?version=sha256:${m[2]}`;
}
