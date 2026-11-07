/**
 * @file test/unit/appdev-microservices.test.ts
 * @description Which Microservices Central aimeat_appdev_overview names (services/appdev/microservices.ts):
 *   the person's own record wins over the operator's AIMEAT_MSC_CENTRAL_URL, a record the caller's
 *   classification reader hides is not read, an address carrying a user name or a password is never
 *   named, and the criteria carry this node's extension limits. The owner-scope reads over REST and
 *   MCP are in test/e2e-appdev-overview.ts.
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { ContentReader } from '../../src/services/classification/reader.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { centralUrl, microservicesFor, MICROSERVICES_RECORD_KEY } from '../../src/services/appdev/microservices.js';

const NODE = 'test-node';
const ALICE = `alice@${NODE}`;
const view = { principal: ALICE, readsAll: true };
const configWith = (url: string) => ({ nodeId: NODE, microservicesCentralUrl: url, extensionTimeoutMs: 5000, extensionMaxMemoryMb: 64 }) as unknown as AimeatConfig;
const readerShowing = (all: boolean) => ({ show: async <T>(records: readonly T[]) => (all ? [...records] : []) }) as unknown as ContentReader;
const seeing = readerShowing(true);

async function storageWith(value: unknown): Promise<SqliteStorage> {
    const storage = new SqliteStorage(':memory:');
    if (value !== undefined) {
        const now = new Date().toISOString();
        await storage.setMemory({ key: MICROSERVICES_RECORD_KEY, ownerGaii: ALICE, visibility: 'owner', tags: [], ttlHours: null, value, version: 1, createdAt: now, updatedAt: now } as never);
    }
    return storage;
}

describe('the Central aimeat_appdev_overview names', () => {
    it('is the operator\'s when the person names none, and none when neither does', async () => {
        const none = await microservicesFor(await storageWith(undefined), configWith(''), ALICE, view, seeing);
        expect(none.central).toBeNull();
        const node = await microservicesFor(await storageWith(undefined), configWith('https://msc.node.test/'), ALICE, view, seeing);
        expect(node.central).toEqual({ url: 'https://msc.node.test', from: 'node', mcp: 'https://msc.node.test/mcp' });
    });

    it('is the person\'s own when they named one, over the operator\'s', async () => {
        const out = await microservicesFor(await storageWith({ url: 'https://msc.own.test', project: 'alice' }), configWith('https://msc.node.test'), ALICE, view, seeing);
        expect(out.central).toEqual({ url: 'https://msc.own.test', from: 'owner', project: 'alice', mcp: 'https://msc.own.test/mcp' });
    });

    it('leaves out a record the caller\'s classification reader hides', async () => {
        const out = await microservicesFor(await storageWith({ url: 'https://msc.own.test' }), configWith('https://msc.node.test'), ALICE, view, readerShowing(false));
        expect(out.central).toEqual({ url: 'https://msc.node.test', from: 'node', mcp: 'https://msc.node.test/mcp' });
        expect(out.record_problem).toBeUndefined();
    });

    it('is never an address with a user name or a password in it, nor anything but http or https', async () => {
        for (const bad of ['https://user:pw@msc.test', 'https://user@msc.test', 'javascript:alert(1)', 'ftp://msc.test', 'not a url', '']) {
            expect(centralUrl(bad)).toBeNull();
        }
        const out = await microservicesFor(await storageWith({ url: 'https://user:pw@msc.own.test' }), configWith('https://msc.node.test'), ALICE, view, seeing);
        expect(out.central).toEqual({ url: 'https://msc.node.test', from: 'node', mcp: 'https://msc.node.test/mcp' });
        expect(String(out.record_problem)).toMatch(/no usable url/);
        expect(JSON.stringify(out)).not.toContain('pw@');
    });

    it('states this node\'s extension limits in its criteria', async () => {
        const out = await microservicesFor(await storageWith(undefined), configWith(''), ALICE, view, seeing);
        expect((out.suggest_when as string[])[0]).toContain('5 s of CPU, 64 MB');
    });
});
