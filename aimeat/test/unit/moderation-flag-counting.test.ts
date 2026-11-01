/**
 * @file test/unit/moderation-flag-counting.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two rules of services/moderation-flags.ts that decide what a flag changes for
 *   readers (secaudit2026oct31w2 round 10, W2-8 and W2-9):
 *     - activeReporterCount: one reporting account is one vote, whatever principals of it flagged
 *       (the owner session's bare name, its agents, its ecosystem apps); a visitor from another node
 *       is another account; dismissed and actioned flags are not active.
 *     - withoutFlagHiddenMemory: a record stays while its flags are unreviewed and under the
 *       threshold, goes on an actioned flag or on the threshold (the organism's for an organism
 *       record), and comes back when the flag is dismissed. A record with no flags is not looked up.
 *   The E2E side (discovery, the librarian, the board listing) is test/e2e-flag-counting.ts; the
 *   organism threshold is here because an E2E node would need five accounts in one organism.
 * @usage cd aimeat && pnpm exec vitest run test/unit/moderation-flag-counting.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { activeReporterCount, reporterAccount, withoutFlagHiddenMemory } from '../../src/services/moderation-flags.js';
import type { Storage, FlagRecord } from '../../src/storage/interface.js';

const NODE = 'aimeat-unit-001-flagcount';
const flag = (flaggedBy: string, status: FlagRecord['status'] = 'active'): FlagRecord =>
    ({ id: `f-${Math.random()}`, targetType: 'memory', targetId: 'x', flaggedBy, reason: 'spam', status, createdAt: '' } as FlagRecord);

describe('activeReporterCount', () => {
    it('counts a person, their agents and their ecosystem app as one account', () => {
        const flags = [flag('carol'), flag(`a1#carol@${NODE}`), flag(`a2#carol@${NODE}`), flag(`eco:drum#carol@${NODE}`), flag(`carol@${NODE}`)];
        expect(activeReporterCount(flags, NODE)).toBe(1);
        expect(reporterAccount('carol', NODE)).toBe(`carol@${NODE}`);
    });
    it('counts different accounts, and a visitor from another node, apart', () => {
        const flags = [flag('carol'), flag(`a1#dave@${NODE}`), flag('carol@elsewhere-node')];
        expect(activeReporterCount(flags, NODE)).toBe(3);
    });
    it('leaves out dismissed and actioned flags', () => {
        expect(activeReporterCount([flag('carol', 'dismissed'), flag('dave', 'actioned'), flag('erin')], NODE)).toBe(1);
    });
});

function stubStorage(flagsByTarget: Record<string, FlagRecord[]>, organismThreshold?: number): { storage: Storage; lookups: string[] } {
    const lookups: string[] = [];
    const storage = {
        getFlagsByTarget: async (_t: string, id: string) => { lookups.push(id); return flagsByTarget[id] ?? []; },
        getOrganism: async (id: string) => organismThreshold === undefined ? null
            : { id, moderationConfig: { flagsEnabled: true, autoHideThreshold: organismThreshold, appealsEnabled: false } },
    } as unknown as Storage;
    return { storage, lookups };
}

describe('withoutFlagHiddenMemory', () => {
    const config = { nodeId: NODE, autoHideThreshold: 5 };
    const rec = (key: string, flagCount: number) => ({ ownerGaii: `alice@${NODE}`, key, flagCount });

    it('keeps a record with one unreviewed flag, and does not look up a record with none', async () => {
        const one = rec('notes.a', 1);
        const clean = rec('notes.b', 0);
        const { storage, lookups } = stubStorage({ [`alice@${NODE}::notes.a`]: [flag('bob')] });
        expect(await withoutFlagHiddenMemory({ storage, config }, [one, clean])).toEqual([one, clean]);
        expect(lookups).toEqual([`alice@${NODE}::notes.a`]);
    });
    it('hides a record whose flag a reviewer actioned, and keeps it once the flag is dismissed', async () => {
        const r = rec('notes.a', 1);
        const actioned = stubStorage({ [`alice@${NODE}::notes.a`]: [flag('bob', 'actioned')] });
        expect(await withoutFlagHiddenMemory({ storage: actioned.storage, config }, [r])).toEqual([]);
        const dismissed = stubStorage({ [`alice@${NODE}::notes.a`]: [flag('bob', 'dismissed')] });
        expect(await withoutFlagHiddenMemory({ storage: dismissed.storage, config }, [r])).toEqual([r]);
    });
    it('hides on the node threshold counted per account, not per flag', async () => {
        const r = rec('notes.a', 5);
        const onePerson = stubStorage({ [`alice@${NODE}::notes.a`]: ['bob', `a1#bob@${NODE}`, `a2#bob@${NODE}`, `a3#bob@${NODE}`, `a4#bob@${NODE}`].map(p => flag(p)) });
        expect(await withoutFlagHiddenMemory({ storage: onePerson.storage, config }, [r])).toEqual([r]);
        const fivePeople = stubStorage({ [`alice@${NODE}::notes.a`]: ['bob', 'carol', 'dave', 'erin', 'frank'].map(p => flag(p)) });
        expect(await withoutFlagHiddenMemory({ storage: fivePeople.storage, config }, [r])).toEqual([]);
    });
    it('hides an organism record on the organism\'s own threshold', async () => {
        const r = rec('organism.org1.w.ws1.doc.x', 2);
        const two = stubStorage({ [`alice@${NODE}::organism.org1.w.ws1.doc.x`]: [flag('bob'), flag('carol')] }, 2);
        expect(await withoutFlagHiddenMemory({ storage: two.storage, config }, [r])).toEqual([]);
        const higher = stubStorage({ [`alice@${NODE}::organism.org1.w.ws1.doc.x`]: [flag('bob'), flag('carol')] }, 3);
        expect(await withoutFlagHiddenMemory({ storage: higher.storage, config }, [r])).toEqual([r]);
    });
});
