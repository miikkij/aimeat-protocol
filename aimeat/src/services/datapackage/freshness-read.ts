/**
 * @file src/services/datapackage/freshness-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The inputs of freshnessOf() (./freshness.ts) for one stored package, read once: the
 *   pointer's last successful run and recorded failure, the data product definition's schedule and
 *   last run when a product builds the package, the producer's schedule on the descriptor otherwise,
 *   and the freshness of each source package of a product (plan doc-mvwxcas3dom3, D6.1, D9.9).
 *
 *   A SOURCE IS READ ONLY WHEN ITS STATE TELLS NOTHING NEW. A source package of the same owner, or a
 *   public one, is read; a non-public package of another account is left out, because its freshness is
 *   that account's to show. Sources are read two levels deep, each package once.
 * @structure packageFreshness · PackageFreshnessOpts · FreshnessDeps
 * @usage const f = await packageFreshness({ storage, config }, ownerGhii, name, { pointer });
 * @version-history
 *   v1.2.0 — 2026-11-01 — Takes the storage and the node id only (FreshnessDeps), so the EXCHANGE
 *     projection, which runs without the node config, reads freshness the same way (plan D6).
 *   v1.1.0 — 2026-11-01 — A product that runs when its source changes is read with `onChange` (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D6.1, D9.9).
 */
import type { StoreDeps } from './store.js';
import { descriptorKey, type Descriptor, type LatestPointer } from './contract.js';
import { readPointer } from './version-audience.js';
import { trustedAudienceOf } from './audience-record.js';
import { freshnessOf, type Freshness, type FreshnessPromise } from './freshness.js';
import { asDefinition, dataProductKey, runsOnChange } from '../dataproduct/definition.js';
import { logger } from '../../utils/logger.js';

export interface PackageFreshnessOpts {
    /** The pointer, when the caller read it already. */
    pointer?: LatestPointer | null;
    /** The producer's schedule and kind, when the caller knows them (a catalogue manifest states both). */
    schedule?: string;
    producerKind?: string;
    now?: Date;
    /** Internal: how deep the source recursion is, and the packages already read. */
    depth?: number;
    seen?: Set<string>;
}

const MAX_DEPTH = 2;

/** What the read needs: the storage, and the node a source owner without one belongs to. */
export type FreshnessDeps = Pick<StoreDeps, 'storage'> & { config: Pick<StoreDeps['config'], 'nodeId'> };

/** The freshness of `name` of `ownerGhii`, or null when the package has no published version. */
export async function packageFreshness(
    deps: FreshnessDeps, ownerGhii: string, name: string, opts: PackageFreshnessOpts = {},
): Promise<Freshness | null> {
    const pointer = opts.pointer !== undefined ? opts.pointer : await readPointer(deps, ownerGhii, name);
    if (!pointer?.contentHash) return null;
    const now = opts.now ?? new Date();
    const seen = opts.seen ?? new Set<string>();
    seen.add(`${ownerGhii}/${name}`);

    const def = asDefinition((await deps.storage.getMemory(ownerGhii, dataProductKey(name)))?.value);
    let promise: FreshnessPromise | null = null;
    let producerKind = opts.producerKind;
    const onChange = !!def && runsOnChange(def);
    if (def) {
        producerKind = 'dataproduct';
        if (def.schedule?.cron) promise = { cron: def.schedule.cron, ...(def.schedule.timezone ? { timezone: def.schedule.timezone } : {}), source: 'dataproduct' };
    } else {
        let schedule = opts.schedule;
        if (schedule === undefined || producerKind === undefined) {
            const d = await descriptorOf(deps, ownerGhii, name, pointer.contentHash);
            schedule = schedule ?? d?.aimeat.producer?.schedule;
            producerKind = producerKind ?? d?.aimeat.producer?.kind;
        }
        if (schedule) promise = { cron: schedule, source: 'producer' };
    }

    // The newest success is the pointer's: every successful run writes it, a new version or the same
    // bytes again (./store.ts, ./version-audience.ts setVersionAudience), whoever produced it.
    const lastSuccessAt: string | null = pointer.updatedAt ?? null;
    const lastError = pointer.lastError ?? (def?.lastRun && !def.lastRun.ok && def.lastRun.error ? { at: def.lastRun.at, message: def.lastRun.error } : null);

    const sources: Array<{ package: string; freshness: Freshness }> = [];
    if (def && (opts.depth ?? 0) < MAX_DEPTH) {
        for (const s of def.sources) {
            if (s.kind !== 'datapackage' || !s.name) continue;
            const srcOwner = s.owner ? (s.owner.includes('@') ? s.owner : `${s.owner}@${deps.config.nodeId}`) : ownerGhii;
            if (seen.has(`${srcOwner}/${s.name}`)) continue;
            const srcPointer = await readPointer(deps, srcOwner, s.name);
            if (!srcPointer?.contentHash || srcPointer.status === 'withdrawn') continue;
            if (srcOwner !== ownerGhii) {
                const audience = (await trustedAudienceOf(deps.storage, deps.config.nodeId, srcOwner, s.name, srcPointer)).visibility ?? 'public';
                if (audience !== 'public') continue;
            }
            const f = await packageFreshness(deps, srcOwner, s.name, { pointer: srcPointer, now, depth: (opts.depth ?? 0) + 1, seen });
            if (f) sources.push({ package: srcPointer.packageId || `pkg:${srcOwner}/${s.name}`, freshness: f });
        }
    }
    return freshnessOf({ promise, lastSuccessAt, ...(producerKind ? { producerKind } : {}), lastError, ...(sources.length ? { sources } : {}), ...(onChange ? { onChange } : {}), now });
}

async function descriptorOf(deps: FreshnessDeps,ownerGhii: string, name: string, hash: string): Promise<Descriptor | null> {
    const file = await deps.storage.getStorageFile(ownerGhii, descriptorKey(name, hash));
    if (!file) return null;
    try {
        return JSON.parse(file.data.toString('utf8')) as Descriptor;
    } catch (err) {
        logger.warn('datapackage freshness: a descriptor is not readable JSON', { owner: ownerGhii, package: name, error: String(err) });
        return null;
    }
}
