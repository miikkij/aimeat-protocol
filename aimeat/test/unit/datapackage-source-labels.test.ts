/**
 * @file test/unit/datapackage-source-labels.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The label source a data package version keeps (services/datapackage/source-labels.ts) and
 *   the label trail of an extension run (services/datapackage/label-trail.ts), against
 *   SqliteStorage(':memory:') with classification on for every scope: a version recorded by round 14 (one
 *   target) still reads; a read asks the reader about one item per effective label; above the bound a
 *   version keeps one item per label; with classification off nothing is recorded; a traced reader
 *   records what show() returned and the trail folds to one item per label above its bound.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-source-labels.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { setLabel, memoryTarget, type LabelActor } from '../../src/services/classification/labels.js';
import { serviceRecords } from '../../src/services/service-records.js';
import {
    SOURCE_LABELS_PREFIX, SOURCE_TARGETS_KEPT, versionSourceTargets, recordVersionLabelSource, versionLabelSources,
    hiddenByLabelSources, hiddenBySourceLabel,
} from '../../src/services/datapackage/source-labels.js';
import { COMPACT_AT, makeLabelTrail, tracedReader } from '../../src/services/datapackage/label-trail.js';
import type { ContentLabelTarget } from '../../src/storage/interface.js';
import type { ContentReader } from '../../src/services/classification/reader.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const HASH = 'a'.repeat(64);
const person: LabelActor = { principal: ALICE, ownerGhii: ALICE, ownerName: 'alice', kind: 'human' };
const on = { classificationMode: 'all' as const, nodeId: NODE };
const off = { classificationMode: 'off' as const, nodeId: NODE };
const t = (key: string) => memoryTarget(ALICE, key);

/** A reader that refuses the keys named, and records what it was asked. */
function stubReader(refused: Set<string>, kind: ContentReader['kind'] = 'human') {
    const asked: string[][] = [];
    return {
        asked, kind,
        show: async <T>(items: readonly T[], targetOf: (item: T) => ContentLabelTarget | null) => {
            asked.push(items.map(i => targetOf(i)?.key ?? ''));
            return items.filter(i => !refused.has(targetOf(i)?.key ?? ''));
        },
    };
}

describe('the label source of a data package version', () => {
    let storage: SqliteStorage;
    beforeEach(() => { storage = new SqliteStorage(':memory:'); });
    afterEach(() => { storage.close(); });

    it('reads a version round 14 recorded as one target', async () => {
        await serviceRecords<ContentLabelTarget>(storage, SOURCE_LABELS_PREFIX).put(ALICE, `pkg.${HASH}`, t('notes.a'));
        expect(await versionLabelSources(storage, ALICE, 'pkg', `sha256:${HASH}`)).toEqual([t('notes.a')]);
        const reader = stubReader(new Set(['notes.a']));
        expect(await hiddenBySourceLabel({ storage, config: on }, reader, ALICE, 'pkg', HASH)).toBe(true);
    });

    it('records every distinct item, and a read asks one item per label', async () => {
        await setLabel({ storage, config: on }, person, t('notes.b'), { label: 'luottamuksellinen' });
        const targets = await versionSourceTargets({ storage, config: on }, [t('notes.a'), t('notes.b'), t('notes.c'), t('notes.a')]);
        expect(targets?.map(x => x.key)).toEqual(['notes.a', 'notes.b', 'notes.c']);
        await recordVersionLabelSource(storage, ALICE, 'pkg', HASH, targets);
        const admits = stubReader(new Set());
        expect(await hiddenBySourceLabel({ storage, config: on }, admits, ALICE, 'pkg', HASH)).toBe(false);
        // Two labels (the default and luottamuksellinen): two items asked, in one call.
        expect(admits.asked).toHaveLength(1);
        expect(admits.asked[0]).toHaveLength(2);
        const refusesB = stubReader(new Set(['notes.b']));
        expect(await hiddenBySourceLabel({ storage, config: on }, refusesB, ALICE, 'pkg', HASH)).toBe(true);
        // Clearing removes the record.
        await recordVersionLabelSource(storage, ALICE, 'pkg', HASH, null);
        expect(await versionLabelSources(storage, ALICE, 'pkg', HASH)).toEqual([]);
    });

    it('keeps one item per label above the bound, and nothing with classification off', async () => {
        await setLabel({ storage, config: on }, person, t('notes.secret'), { label: 'luottamuksellinen' });
        const many = Array.from({ length: SOURCE_TARGETS_KEPT + 1 }, (_, i) => t(`notes.n${i}`));
        const kept = await versionSourceTargets({ storage, config: on }, [...many, t('notes.secret')]);
        expect(kept).toHaveLength(2);
        expect(kept?.some(x => x.key === 'notes.secret')).toBe(true);
        expect(await versionSourceTargets({ storage, config: off }, [t('notes.secret')])).toBeNull();
        expect(await hiddenByLabelSources({ storage, config: off }, stubReader(new Set(['notes.secret'])), [t('notes.secret')])).toBe(false);
    });
});

describe('the label trail of an extension run', () => {
    let storage: SqliteStorage;
    beforeEach(() => { storage = new SqliteStorage(':memory:'); });
    afterEach(() => { storage.close(); });

    it('records what a traced show() returned, not what it refused', async () => {
        const trail = makeLabelTrail({ storage, config: on });
        const reader = tracedReader(stubReader(new Set(['notes.hidden'])), trail);
        const shown = await reader.show([t('notes.a'), t('notes.hidden')], x => x);
        expect(shown).toHaveLength(1);
        expect(trail.targets().map(x => x.key)).toEqual(['notes.a']);
        expect(tracedReader(reader)).toBe(reader);
    });

    it('folds to one item per label above its bound, and keeps nothing with classification off', async () => {
        await setLabel({ storage, config: on }, person, t('notes.secret'), { label: 'luottamuksellinen' });
        const trail = makeLabelTrail({ storage, config: on });
        await trail.add([t('notes.secret'), ...Array.from({ length: COMPACT_AT }, (_, i) => t(`notes.n${i}`))]);
        expect(trail.targets()).toHaveLength(2);
        const none = makeLabelTrail({ storage, config: off });
        await none.add([t('notes.secret')]);
        expect(none.targets()).toEqual([]);
    });
});
