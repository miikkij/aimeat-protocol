/**
 * @file test/unit/extension-buy-not-yours.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ctx.buy (services/extension-purchase.ts) asks the rule the capability invoke route
 *   asks (capability-invoke.ts, EXTENSION_CAPABILITY_NOT_YOURS): a capability another account
 *   registered never chooses which of the buyer's own extension actions runs. Its ref is resolved in
 *   the seller's namespace, and a ref that lands on the buyer's own extension is refused before
 *   anything is settled (secaudit2026oct26,
 *   extension-purchase:seller-capability-runs-buyer-own-extension).
 *
 *   Usage kept: a seller's capability over the seller's own extension, and over a third account's
 *   extension, goes on to the contract question as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-buy-not-yours.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { CapabilityRecord, ExtensionRecord } from '../../src/storage/interface.js';
import { buyForExtension } from '../../src/services/extension-purchase.js';
import { appToolsKey } from '../../src/models/app-tool-schemas.js';
import { loadConfig } from '../../src/config.js';

const config = loadConfig().config;
const NODE = config.nodeId;

function cap(id: string, owner: string, ref: string): CapabilityRecord {
    const now = new Date().toISOString();
    return {
        id, name: id, summary: '', ownerGhii: `${owner}@${NODE}`, visibility: 'public', scope: 'local', status: 'active',
        rejectionReason: null, deprecationMessage: null, replacedBy: null,
        source: { type: 'extension', ref, version: '1.0.0' }, authRequired: 'registered', callable: true,
        inputSchema: null, outputSchema: null, exports: null, usage: '', whenToUse: '', whenNotToUse: '',
        examples: [], dependencies: [], schemaHash: 'x', webhookUrl: null, cost: null, trustRequired: null,
        trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
        redactedFields: [], operatorOverride: null,
        stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
        tags: [], createdAt: now, updatedAt: now,
    } as CapabilityRecord;
}

function ext(name: string, installedBy: string): ExtensionRecord {
    return {
        name, version: '1.0.0', description: 'buy test', author: 'test', status: 'active', requiredApis: [],
        actions: [{ id: 'act', method: 'POST', path: '/act', inputSchema: {}, outputSchema: {}, scriptContent: 'export default async () => 1;' }],
        config: {}, limits: { memoryMb: 16, timeoutMs: 1000, maxApiCalls: 5 }, federation: { advertise: false, capabilities: [] },
        installedBy, installedAt: new Date().toISOString(),
    } as ExtensionRecord;
}

async function world() {
    const storage = new SqliteStorage(':memory:');
    await storage.createExtension(ext('bobtools', 'bob'));
    await storage.createExtension(ext('sallytools', 'sally'));
    await storage.createExtension(ext('carltools', 'carl'));
    await storage.createCapability(cap('sally-over-bob', 'sally', 'ext:bobtools:act'));
    await storage.createCapability(cap('sally-own', 'sally', 'ext:sallytools:act'));
    await storage.createCapability(cap('sally-over-carl', 'sally', 'ext:carltools:act'));
    await storage.setMemory({
        key: appToolsKey('shop.html'), ownerGaii: `sally@${NODE}`, visibility: 'public', tags: [], ttlHours: null, version: 1,
        value: { tools: [
            { name: 'grab', action_id: 'sally-over-bob', lockedInput: { mode: 'all' } },
            { name: 'own', action_id: 'sally-own' },
            { name: 'third', action_id: 'sally-over-carl' },
        ] },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
    return storage;
}

const buy = (storage: SqliteStorage, tool: string, runSellerAction = vi.fn()) => buyForExtension({
    config, storage: storage as never, extName: 'bobbuyer', extOwner: 'bob',
    appRef: 'sally/shop.html', tool, input: {}, runSellerAction,
});

describe('ctx.buy and a capability over the buyer\'s own extension', () => {
    it('is refused before anything is settled, and nothing runs', async () => {
        const storage = await world();
        const run = vi.fn();
        const out = await buy(storage, 'grab', run);
        expect(out).toMatchObject({ ok: false, code: 'EXTENSION_CAPABILITY_NOT_YOURS' });
        expect(run).not.toHaveBeenCalled();
    });

    it('a capability over the seller\'s own extension, or a third account\'s, goes on to the contract question', async () => {
        const storage = await world();
        for (const tool of ['own', 'third']) {
            const out = await buy(storage, tool);
            expect(out, tool).toMatchObject({ ok: false, code: 'NO_CONTRACT' });
        }
    });
});
