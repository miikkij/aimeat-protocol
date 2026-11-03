/**
 * @file test/unit/audit-flush-soon.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The consent audit and the classification audit write a recorded row within about a
 *   second, without waiting for the 60 s interval or a shutdown, so a process that ends without
 *   stopping loses at most that second (codebase analysis 2026-11-03, HA stage 1 item 1.6). The
 *   record itself stays in memory and never awaits storage, and rows recorded together are written
 *   in one storage call.
 * @usage cd aimeat && pnpm exec vitest run test/unit/audit-flush-soon.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, HA stage 1 item 1.6).
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { Storage, ConsentAuditEntry, ClassificationAuditRow } from '../../src/storage/interface.js';
import { initConsentAuditBuffer, bufferConsentAudit, shutdownConsentAuditBuffer } from '../../src/services/consent-audit-buffer.js';
import {
    initClassificationAudit, recordClassificationAudit, shutdownClassificationAudit, resetClassificationAudit,
} from '../../src/services/classification/audit.js';

const until = async (cond: () => boolean, ms: number) => {
    const began = Date.now();
    while (!cond() && Date.now() - began < ms) await new Promise(r => setTimeout(r, 20));
    return cond();
};

afterEach(async () => {
    await shutdownConsentAuditBuffer();
    await shutdownClassificationAudit();
    resetClassificationAudit();
});

describe('the consent audit', () => {
    it('writes a refused read within about a second, in one call for a burst', async () => {
        const written: ConsentAuditEntry[] = [];
        let calls = 0;
        initConsentAuditBuffer({ addConsentAuditEntry: async (e: ConsentAuditEntry) => { calls++; written.push(e); return e; } } as unknown as Storage);
        const owner = `o#x@n-${Date.now()}`;
        for (let i = 0; i < 3; i++) {
            bufferConsentAudit({ id: `c${i}`, consentId: 'none', ownerGaii: owner, accessorGaii: 'b#o@n', memoryKey: 'k', action: 'read', timestamp: new Date().toISOString(), allowed: false });
        }
        expect(written).toHaveLength(0);   // nothing on the request path
        expect(await until(() => written.filter(e => e.ownerGaii === owner).length === 3, 2500)).toBe(true);
        expect(calls).toBe(3);   // one flush: the storage method takes one entry at a time
    });
});

describe('the classification audit', () => {
    it('writes a refusal within about a second, merged rows in one storage call', async () => {
        const batches: ClassificationAuditRow[][] = [];
        initClassificationAudit({ addClassificationAudit: async (rows: ClassificationAuditRow[]) => { batches.push(rows); } } as unknown as Storage);
        const ev = { scope: 'alice@n', ownerGaii: 'alice@n', kind: 'memory' as const, key: 'notes.a', label: 'x', reader: 'claude#alice@n', readerKind: 'ai' as const };
        recordClassificationAudit({ ...ev, action: 'refused' });
        recordClassificationAudit({ ...ev, action: 'shown' });
        recordClassificationAudit({ ...ev, action: 'shown' });
        expect(batches).toHaveLength(0);
        expect(await until(() => batches.length === 1, 2500)).toBe(true);
        expect(batches[0].map(r => [r.action, r.count])).toEqual([['refused', 1], ['shown', 2]]);
    });
});
