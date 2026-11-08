/**
 * @file src/services/datapackage/source-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data package version built from classified content carries the strictest label of
 *   what it was built from (secaudit2026nov08 round 14,
 *   dataproduct/sources-memory:records-source-drops-source-record-labels).
 *
 *   WHY. A data product over a workspace records space reads the records as its maker and writes their
 *   rows into the maker's own package files. A record another member wrote, labelled for fewer readers
 *   than the organism (a list of people or roles, hidden from AI, ranked above an agent's clearance),
 *   was then readable through the package by every reader of the package, because a reader's access
 *   to the rows was decided on the package file, which carries no label of its sources. The
 *   classification design says a copy of labelled content keeps the label's reader rules
 *   (classification/label-rows.ts: "publishing never makes an unlabelled copy").
 *
 *   HOW. At the build, the source item with the highest-ranked effective label (in the policy of its
 *   own scope, where classification is on) is the version's label source, recorded in the maker's
 *   service namespace under `datapkg-labels.<name>.<hash>` (services/service-records.ts), which no
 *   memory route writes. Every read of the version's rows (store.ts loadResourceRows) and of its files
 *   through GET /v1/pub asks the classification reader about that item as well as the file: a reader
 *   its label keeps out reads no row, a reader it admits reads as before. The label is read live, so a
 *   raise of the source's label reaches the package at once. With classification off, or a product
 *   with no labelled source, nothing is recorded and nothing changes.
 * @structure SOURCE_LABELS_PREFIX · strictestSourceTarget · recordVersionLabelSource ·
 *   versionLabelSource · hiddenBySourceLabel · packageFileHiddenBySourceLabel
 * @usage
 *   const target = await strictestSourceTarget(deps, sources.flatMap(s => s.labelSources ?? []));
 *   if (await hiddenBySourceLabel(deps, reader, ownerGhii, name, hash)) return null;
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { serviceRecords } from '../service-records.js';
import { classificationActiveFor, policyFor } from '../classification/policy.js';
import { effectiveLabels } from '../classification/effective.js';
import { labelById } from '../classification/defaults.js';
import { targetId } from '../classification/labels.js';
import type { ContentReader } from '../classification/reader.js';
import { bare } from './contract.js';

/** The service-owned prefix, in the package owner's service namespace. */
export const SOURCE_LABELS_PREFIX = 'datapkg-labels.';

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> };

const isTarget = (v: unknown): v is ContentLabelTarget => {
    const t = v as Partial<ContentLabelTarget> | null;
    return !!t && typeof t === 'object' && typeof t.kind === 'string' && typeof t.scope === 'string' && typeof t.key === 'string';
};
const records = (storage: Storage) => serviceRecords<ContentLabelTarget>(storage, SOURCE_LABELS_PREFIX, { parse: v => (isTarget(v) ? v : null) });
const recordKey = (name: string, contentHash: string) => `${name}.${bare(contentHash)}`;

/**
 * The source item whose effective label ranks highest, among the scopes where classification is on.
 * Null when classification is off for every scope the items lie in.
 */
export async function strictestSourceTarget(deps: Deps, targets: readonly ContentLabelTarget[]): Promise<ContentLabelTarget | null> {
    if (deps.config.classificationMode === 'off' || !targets.length) return null;
    const byScope = new Map<string, ContentLabelTarget[]>();
    for (const t of targets) byScope.set(t.scope, [...(byScope.get(t.scope) ?? []), t]);
    let best: { t: ContentLabelTarget; rank: number } | null = null;
    for (const [scope, list] of byScope) {
        if (!(await classificationActiveFor(deps.storage, deps.config, scope))) continue;
        const policy = await policyFor(deps.storage, deps.config, scope);
        const eff = await effectiveLabels(deps.storage, policy, list);
        for (const t of list) {
            const rank = labelById(policy, eff.get(targetId(t))?.label ?? policy.defaultLabel)?.rank ?? -1;
            if (!best || rank > best.rank) best = { t, rank };
        }
    }
    return best ? { kind: best.t.kind, scope: best.t.scope, key: best.t.key } : null;
}

/** Record (or, with null, clear) the label source of one version of `name`. Written before the version is readable. */
export async function recordVersionLabelSource(
    storage: Storage, ownerGhii: string, name: string, contentHash: string, target: ContentLabelTarget | null,
): Promise<void> {
    const r = records(storage);
    if (target) { await r.put(ownerGhii, recordKey(name, contentHash), target); return; }
    await r.delete(ownerGhii, recordKey(name, contentHash));
}

/** The label source of one version, or null when it was built from no labelled source. */
export async function versionLabelSource(storage: Storage, ownerGhii: string, name: string, contentHash: string): Promise<ContentLabelTarget | null> {
    return records(storage).get(ownerGhii, recordKey(name, contentHash));
}

/** True when the version's label source keeps this reader out (and with it every row of the version). */
export async function hiddenBySourceLabel(
    storage: Storage, reader: Pick<ContentReader, 'show'>, ownerGhii: string, name: string, contentHash: string,
): Promise<boolean> {
    const target = await versionLabelSource(storage, ownerGhii, name, contentHash);
    if (!target) return false;
    return (await reader.show([target], t => t)).length === 0;
}

/** `datapkg/{name}/{hash}/{rest}`: the package and version a stored file belongs to, else null. */
const VERSION_FILE_RE = /^datapkg\/([a-z0-9][a-z0-9-]{0,62}[a-z0-9])\/([a-f0-9]{64})\/.+$/;

/** True when `key` is a file of a package version whose label source keeps this reader out (GET /v1/pub). */
export async function packageFileHiddenBySourceLabel(
    storage: Storage, reader: Pick<ContentReader, 'show'>, ownerGhii: string, key: string,
): Promise<boolean> {
    const m = VERSION_FILE_RE.exec(key);
    return m ? hiddenBySourceLabel(storage, reader, ownerGhii, m[1]!, m[2]!) : false;
}
