/**
 * @file test/unit/app-tools-key.test.ts
 * @description An app's tool manifest lives under the app's filename (services/app-tools-key.ts):
 *   the rule, and the once-per-node carry-over of manifests written under another name, against a
 *   real SQLite store. The shapes are the two found on aimeat.io on 2026-09-27: kkk wrote
 *   `apps.ai-slop-detector.tools` for the app `ai-slop-detector.html`, and happydude500001 wrote
 *   `apps.company-brief.tools` with no app of that name at all.
 * @usage pnpm test -- app-tools-key
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (wish-tools-for-sale-published-over-mcp-do-not-show-in-the-app-cat).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import {
    canonicalAppToolsId, canonicalAppToolsKey, migrateAppToolsKeysOnce, APP_TOOLS_KEY_MIGRATION_KEY,
} from '../../src/services/app-tools-key.js';
import { putOffering, type Offering } from '../../src/services/exchange-market.js';

const NODE = 'node-test';
const stores: SqliteStorage[] = [];
function store(): Storage { const s = new SqliteStorage(':memory:'); stores.push(s); return s as unknown as Storage; }
afterEach(async () => { for (const s of stores.splice(0)) s.close(); });

async function owner(s: Storage, name: string): Promise<string> {
    await s.createOwner({ name, displayName: name, publicKey: 'x', roles: ['owner'], createdAt: new Date().toISOString() });
    return `${name}@${NODE}`;
}

async function app(s: Storage, ownerName: string, filename: string): Promise<void> {
    await s.createApp({
        ownerGaii: `${ownerName}@${NODE}`, ownerName, filename, versionNumber: 1,
        manifest: { name: filename, description: 'fixture', version: '1', category: 'tool', tags: [], authorDisplay: ownerName, usesCortex: [] },
        mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: new Date().toISOString(),
    });
}

async function manifest(s: Storage, ownerGhii: string, appId: string, tool = 'audit'): Promise<void> {
    const now = new Date().toISOString();
    await s.setMemory({
        key: `apps.${appId}.tools`, ownerGaii: ownerGhii, value: { version: 1, tools: [{ name: tool, price: { morsels: 20 } }] },
        visibility: 'public', tags: ['commerce', 'app-tools'], ttlHours: null, version: 3, createdAt: now, updatedAt: now,
    } as MemoryRecord);
}

describe('which key an app tool manifest belongs under', () => {
    it('takes the app filename when the id leaves the extension off', async () => {
        const s = store();
        const kkk = await owner(s, 'kkk');
        await app(s, 'kkk', 'ai-slop-detector.html');
        expect(await canonicalAppToolsId(s, kkk, 'ai-slop-detector')).toBe('ai-slop-detector.html');
        expect(await canonicalAppToolsKey(s, kkk, 'apps.ai-slop-detector.tools')).toBe('apps.ai-slop-detector.html.tools');
    });

    it('keeps an id that is already a filename, one that names no app, and a key that is not a manifest', async () => {
        const s = store();
        const h = await owner(s, 'happy');
        await app(s, 'happy', 'nuotta.html');
        await app(s, 'happy', 'kiosk');
        expect(await canonicalAppToolsId(s, h, 'nuotta.html')).toBe('nuotta.html');
        expect(await canonicalAppToolsId(s, h, 'kiosk')).toBe('kiosk');
        expect(await canonicalAppToolsId(s, h, 'company-brief')).toBe('company-brief');
        expect(await canonicalAppToolsKey(s, h, 'apps.nuotta.settings')).toBe('apps.nuotta.settings');
    });

    it('never moves a key in an agent namespace or in another owner\'s', async () => {
        const s = store();
        await owner(s, 'kkk');
        const other = await owner(s, 'other');
        await app(s, 'kkk', 'ai-slop-detector.html');
        expect(await canonicalAppToolsId(s, `bot#kkk@${NODE}`, 'ai-slop-detector')).toBe('ai-slop-detector');
        expect(await canonicalAppToolsId(s, other, 'ai-slop-detector')).toBe('ai-slop-detector');
    });
});

describe('carrying the manifests written before the rule over, once per node', () => {
    it('moves a manifest to its app filename with its value, visibility, tags and version, and runs once', async () => {
        const s = store();
        const kkk = await owner(s, 'kkk');
        await app(s, 'kkk', 'ai-slop-detector.html');
        await manifest(s, kkk, 'ai-slop-detector');

        const r = await migrateAppToolsKeysOnce(s, { nodeId: NODE });
        expect(r).toMatchObject({ ran: true, moved: ['kkk: ai-slop-detector -> ai-slop-detector.html'], left: [] });
        expect(await s.getMemory(kkk, 'apps.ai-slop-detector.tools')).toBeNull();
        const moved = await s.getMemory(kkk, 'apps.ai-slop-detector.html.tools');
        expect(moved).toMatchObject({ visibility: 'public', tags: ['commerce', 'app-tools'], version: 3 });
        expect((moved!.value as { tools: Array<{ name: string }> }).tools[0]!.name).toBe('audit');
        expect(await s.getMemory(`system@${NODE}`, APP_TOOLS_KEY_MIGRATION_KEY)).not.toBeNull();

        // A second boot reads the record and does nothing, even with a new stray manifest present.
        await manifest(s, kkk, 'ai-slop-detector');
        expect(await migrateAppToolsKeysOnce(s, { nodeId: NODE })).toEqual({ ran: false, moved: [], left: [] });
        expect(await s.getMemory(kkk, 'apps.ai-slop-detector.tools')).not.toBeNull();
    });

    it('leaves a manifest with no app, one whose filename key is taken, and one with a live listing', async () => {
        const s = store();
        const h = await owner(s, 'happy');
        await app(s, 'happy', 'nuotta.html');
        await app(s, 'happy', 'lattice.html');
        await manifest(s, h, 'company-brief');
        await manifest(s, h, 'nuotta', 'old');
        await manifest(s, h, 'nuotta.html', 'current');
        await manifest(s, h, 'lattice');
        await putOffering(s, {
            offeringId: 'off-1', providerGhii: h, providerOwner: 'happy', kind: 'app-tool',
            ext: 'apptool:happy/lattice', action: 'audit', state: 'listed', auto: true,
            surface: { kind: 'app-tool', ownerName: 'happy', appId: 'lattice', tool: 'audit', ifaceVersion: 1 },
            title: 't', description: 'd', unit: 'morsels', basePrice: 20, currency: null, plans: [], tags: [],
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        } as unknown as Offering);

        const r = await migrateAppToolsKeysOnce(s, { nodeId: NODE });
        expect(r.moved).toEqual([]);
        expect(r.left.sort()).toEqual([
            'happy: lattice -> lattice.html (it has a live EXCHANGE listing)',
            'happy: nuotta -> nuotta.html (the filename key already holds a manifest)',
        ]);
        for (const id of ['company-brief', 'nuotta', 'nuotta.html', 'lattice']) {
            expect(await s.getMemory(h, `apps.${id}.tools`)).not.toBeNull();
        }
        const kept = await s.getMemory(h, 'apps.nuotta.html.tools');
        expect((kept!.value as { tools: Array<{ name: string }> }).tools[0]!.name).toBe('current');
    });
});
