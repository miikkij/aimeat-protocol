/**
 * @file src/services/datapackage/source-labels.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data package version built from classified content keeps the labels of what it was
 *   built from (secaudit2026nov08 round 14,
 *   dataproduct/sources-memory:records-source-drops-source-record-labels; secaudit2026nov08b round 15).
 *
 *   WHY. A data product over a workspace records space reads the records as its maker and writes their
 *   rows into the maker's own package files. A record another member wrote, labelled for fewer readers
 *   than the organism (a list of people or roles, hidden from AI, ranked above an agent's clearance),
 *   was then readable through the package by every reader of the package, because a reader's access
 *   to the rows was decided on the package file, which carries no label of its sources. The
 *   classification design says a copy of labelled content keeps the label's reader rules
 *   (classification/label-rows.ts: "publishing never makes an unlabelled copy").
 *
 *   HOW. At the build, the label address of every item the rows were copied from (in the scopes where
 *   classification is on) is the version's label source, recorded in the maker's service namespace
 *   under `datapkg-labels.<name>.<hash>` (services/service-records.ts), which no memory route writes.
 *   Every read of the version's rows (store.ts loadResourceRows) and of its files through GET /v1/pub
 *   asks the classification reader about those items as well as the file: a reader that one of their
 *   labels keeps out reads no row, a reader every label admits reads as before. The labels are read
 *   live, so a label set or raised later on any of the items reaches the package at once. With
 *   classification off, or a product with no labelled source, nothing is recorded and nothing changes.
 *
 *   ONE ITEM PER LABEL IS ASKED. The audience, the AI rule and the clearance a label sets are the same
 *   for every item that carries it, so a read groups the recorded items by their effective label (read
 *   live, in the policy of each item's scope) and asks the reader about one item of each label: the
 *   audit log gets one row per label, not one per record. An AI or anonymous reader passes a label
 *   hidden from AI only through a person's exception on one item, so for such a label every item is
 *   asked. A version copied from more than SOURCE_TARGETS_KEPT items records one item per label instead,
 *   so the record stays bounded; for those versions a label set later on an item not recorded does
 *   not reach the version (the next build records it).
 *
 *   WHY NOT ONE ITEM BY RANK (round 14 kept the highest-ranked item only). Rank does not order a
 *   label's audience or its AI rule (classification/levels.ts weakerFields compares them apart), so a
 *   lower-ranked label with a narrower audience was dropped, and a label set after the build on any
 *   item but the picked one never reached the version (secaudit2026nov08b round 15,
 *   datapackage/source-labels:single-rank-picked-source-stands-for-all-labels).
 * @structure SOURCE_LABELS_PREFIX · SOURCE_TARGETS_KEPT · versionSourceTargets · onePerLabel · recordVersionLabelSource ·
 *   versionLabelSources · packageCopyTargets · fileCopyTargets · hiddenByLabelSources · hiddenBySourceLabel ·
 *   packageVersionOfFile · packageFileHiddenBySourceLabel · storedFileShownTo · storedFilesShownTo
 * @usage
 *   const targets = await versionSourceTargets(deps, sources.flatMap(s => s.labelSources ?? []));
 *   if (await hiddenBySourceLabel(deps, reader, ownerGhii, name, hash)) return null;
 *   const file = meta ? await storedFileShownTo({ storage, config }, reader, gaii, key, meta) : undefined;
 * @version-history
 *   v2.3.0 — 2026-11-13 — storedFilesShownTo: the same ask for a list of stored files (structure
 *     programme 2026-11, unit 7).
 *   v2.2.0 — 2026-11-08 — storedFileShownTo: the file's own label and the version's labels in one ask, for
 *     the reads of a stored file other than GET /v1/pub; packageFileHiddenBySourceLabel asks nothing for a
 *     file in an agent's or an app's namespace, whose service namespace does not exist (secaudit2026nov08b
 *     round 15b).
 *   v2.1.0 — 2026-11-08 — packageCopyTargets and fileCopyTargets: what a copy of a package version or
 *     of a stored file carries, for a derived product (secaudit2026nov08b round 15).
 *   v2.0.0 — 2026-11-08 — Every copied item is the label source, not the highest-ranked one; the read
 *     asks one item per effective label; a recorded single target still reads (secaudit2026nov08b round 15).
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { serviceRecords } from '../service-records.js';
import { activePolicies, type ContentReader } from '../classification/reader.js';
import { effectiveLabels } from '../classification/effective.js';
import { labelById, type ClassificationLabel } from '../classification/defaults.js';
import { fileTarget, targetId } from '../classification/labels.js';
import { bare, resourceKey } from './contract.js';
import { isValidGHII } from '../../utils/gaii.js';

/** The service-owned prefix, in the package owner's service namespace. */
export const SOURCE_LABELS_PREFIX = 'datapkg-labels.';

/** Above this many copied items a version records one item per label (see the file header). */
export const SOURCE_TARGETS_KEPT = 2000;

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> };

/** The stored value: `{ targets }`. A single target is a version recorded by round 14. */
interface StoredSources { targets: ContentLabelTarget[] }

const isTarget = (v: unknown): v is ContentLabelTarget => {
    const t = v as Partial<ContentLabelTarget> | null;
    return !!t && typeof t === 'object' && typeof t.kind === 'string' && typeof t.scope === 'string' && typeof t.key === 'string';
};
const parseStored = (v: unknown): StoredSources | null => {
    if (isTarget(v)) return { targets: [{ kind: v.kind, scope: v.scope, key: v.key }] };
    const list = (v as { targets?: unknown } | null)?.targets;
    return Array.isArray(list) ? { targets: list.filter(isTarget) } : null;
};
const records = (storage: Storage) => serviceRecords<StoredSources>(storage, SOURCE_LABELS_PREFIX, { parse: parseStored });
const recordKey = (name: string, contentHash: string) => `${name}.${bare(contentHash)}`;
const plain = (t: ContentLabelTarget): ContentLabelTarget => ({ kind: t.kind, scope: t.scope, key: t.key });

/** The items grouped by effective label, per scope where classification is on. */
async function labelGroups(deps: Deps, targets: readonly ContentLabelTarget[]): Promise<Array<{ label: ClassificationLabel | null; items: ContentLabelTarget[] }>> {
    const policies = await activePolicies(deps, targets.map(t => t.scope));
    const groups = new Map<string, { label: ClassificationLabel | null; items: ContentLabelTarget[] }>();
    for (const [scope, policy] of policies) {
        const list = targets.filter(t => t.scope === scope);
        const eff = await effectiveLabels(deps.storage, policy, list);
        for (const t of list) {
            const id = eff.get(targetId(t))?.label ?? policy.defaultLabel;
            const g = `${scope}\u0000${id}`;
            const cur = groups.get(g) ?? { label: labelById(policy, id) ?? labelById(policy, policy.defaultLabel) ?? null, items: [] };
            cur.items.push(t);
            groups.set(g, cur);
        }
    }
    return [...groups.values()];
}

/**
 * The items a version records as its label source: every distinct one, among the scopes where
 * classification is on, or one per effective label above SOURCE_TARGETS_KEPT. Null when classification
 * is off for every scope the items lie in.
 */
export async function versionSourceTargets(deps: Deps, targets: readonly ContentLabelTarget[]): Promise<ContentLabelTarget[] | null> {
    if (deps.config.classificationMode === 'off' || !targets.length) return null;
    const distinct = new Map<string, ContentLabelTarget>();
    for (const t of targets) if (isTarget(t)) distinct.set(targetId(t), plain(t));
    const policies = await activePolicies(deps, [...distinct.values()].map(t => t.scope));
    const kept = [...distinct.values()].filter(t => policies.has(t.scope));
    if (!kept.length) return null;
    if (kept.length <= SOURCE_TARGETS_KEPT) return kept;
    return onePerLabel(deps, kept);
}

/** One item of each effective label among the targets, in the scopes where classification is on. */
export async function onePerLabel(deps: Deps, targets: readonly ContentLabelTarget[]): Promise<ContentLabelTarget[]> {
    return (await labelGroups(deps, targets)).map(g => g.items[0]!);
}

/** Record (or, with null or none, clear) the label source of one version of `name`. Written before the version is readable. */
export async function recordVersionLabelSource(
    storage: Storage, ownerGhii: string, name: string, contentHash: string, targets: readonly ContentLabelTarget[] | null,
): Promise<void> {
    const r = records(storage);
    if (targets?.length) { await r.put(ownerGhii, recordKey(name, contentHash), { targets: targets.map(plain) }); return; }
    await r.delete(ownerGhii, recordKey(name, contentHash));
}

/** The label source of one version: the items it was copied from, none when it was built from no labelled source. */
export async function versionLabelSources(storage: Storage, ownerGhii: string, name: string, contentHash: string): Promise<ContentLabelTarget[]> {
    return (await records(storage).get(ownerGhii, recordKey(name, contentHash)))?.targets ?? [];
}

/**
 * What a copy of one resource of a package version carries: the version's own label source and the
 * label of the resource file itself, so a product or an extension that reads the rows and publishes
 * them again keeps the readers of both (secaudit2026nov08b round 15,
 * dataproduct/sources-io:derived-product-drops-upstream-version-label-source).
 */
export async function packageCopyTargets(
    storage: Storage, ownerGhii: string, name: string, contentHash: string, resource: string,
): Promise<ContentLabelTarget[]> {
    const key = resourceKey(name, contentHash, resource);
    const meta = await storage.getStorageFileMeta(ownerGhii, key);
    return [...(await versionLabelSources(storage, ownerGhii, name, contentHash)), fileTarget(ownerGhii, key, meta?.workspaceRef)];
}

/** What a copy of one stored file carries: its own label, and a package version's label source when it is a package file. */
export async function fileCopyTargets(storage: Storage, ownerGaii: string, key: string, workspaceRef?: string | null): Promise<ContentLabelTarget[]> {
    const v = packageVersionOfFile(key);
    return [fileTarget(ownerGaii, key, workspaceRef), ...(v ? await versionLabelSources(storage, ownerGaii, v.name, v.hash) : [])];
}

/** True when one of the items' labels keeps this reader out. One item per label is asked (file header). */
export async function hiddenByLabelSources(
    deps: Deps, reader: Pick<ContentReader, 'show' | 'kind'>, targets: readonly ContentLabelTarget[],
): Promise<boolean> {
    if (!targets.length || deps.config.classificationMode === 'off') return false;
    const groups = await labelGroups(deps, targets);
    const firsts = groups.map(g => g.items[0]!);
    if (firsts.length && (await reader.show(firsts, t => t)).length < firsts.length) return true;
    // An exception a person made for one item does not open the other items of a label hidden from AI.
    if (reader.kind !== 'ai' && reader.kind !== 'anonymous') return false;
    const rest = groups.filter(g => g.label?.aiVisibility === 'hidden').flatMap(g => g.items.slice(1));
    return rest.length > 0 && (await reader.show(rest, t => t)).length < rest.length;
}

/** True when the version's label source keeps this reader out (and with it every row of the version). */
export async function hiddenBySourceLabel(
    deps: Deps, reader: Pick<ContentReader, 'show' | 'kind'>, ownerGhii: string, name: string, contentHash: string,
): Promise<boolean> {
    return hiddenByLabelSources(deps, reader, await versionLabelSources(deps.storage, ownerGhii, name, contentHash));
}

/** `datapkg/{name}/{hash}/{rest}`: the package and version a stored file belongs to, else null. */
const VERSION_FILE_RE = /^datapkg\/([a-z0-9][a-z0-9-]{0,62}[a-z0-9])\/([a-f0-9]{64})\/.+$/;

/** The package name and version hash of a stored package file, else null. */
export function packageVersionOfFile(key: string): { name: string; hash: string } | null {
    const m = VERSION_FILE_RE.exec(key);
    return m ? { name: m[1]!, hash: m[2]! } : null;
}

/**
 * True when `key` is a file of a package version whose label source keeps this reader out (GET /v1/pub).
 * A package belongs to an account identity, whose service namespace holds its label source; a file of
 * that shape in an agent's or an app's namespace is no package file and asks nothing.
 */
export async function packageFileHiddenBySourceLabel(
    deps: Deps, reader: Pick<ContentReader, 'show' | 'kind'>, ownerGhii: string, key: string,
): Promise<boolean> {
    const v = packageVersionOfFile(key);
    return v && isValidGHII(ownerGhii) ? hiddenBySourceLabel(deps, reader, ownerGhii, v.name, v.hash) : false;
}

/**
 * The stored file as this reader may see it, else undefined: the file's own label and, for a file of a
 * package version, the labels the version keeps, the two GET /v1/pub asks. A read that hands a stored
 * file's content to a caller asks here, so a reader GET /v1/pub answers 404 gets the file nowhere else
 * (secaudit2026nov08b round 15b).
 */
export async function storedFileShownTo<F extends { workspaceRef?: string | null }>(
    deps: Deps, reader: Pick<ContentReader, 'show' | 'kind'>, ownerGaii: string, key: string, file: F,
): Promise<F | undefined> {
    const [shown] = await reader.show([file], () => fileTarget(ownerGaii, key, file.workspaceRef));
    if (!shown || deps.config.classificationMode === 'off') return shown;
    return await packageFileHiddenBySourceLabel(deps, reader, ownerGaii, key) ? undefined : shown;
}

/**
 * The stored files of a list this reader may see, in their order: the ask storedFileShownTo makes for
 * one file, made for a list, so a file the read answers as absent is not named by a list either.
 * GET /v1/memory/files and the MCP storage resource list ask here; until 2026-11-13 the route listed
 * an agent the files its own download refused (structure programme 2026-11, unit 7).
 */
export async function storedFilesShownTo<F extends { key: string; ownerGaii: string; workspaceRef?: string | null }>(
    deps: Deps, reader: Pick<ContentReader, 'show' | 'kind'>, files: F[],
): Promise<F[]> {
    const shown = await reader.show(files, f => fileTarget(f.ownerGaii, f.key, f.workspaceRef));
    if (deps.config.classificationMode === 'off') return shown;
    const hidden = await Promise.all(shown.map(f => packageFileHiddenBySourceLabel(deps, reader, f.ownerGaii, f.key)));
    return shown.filter((_, i) => !hidden[i]);
}
