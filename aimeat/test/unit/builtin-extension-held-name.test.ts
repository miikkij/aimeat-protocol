/**
 * @file test/unit/builtin-extension-held-name.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The built-in extension seeder (services/builtin-extension-seeder.ts) does not adopt a
 *   record another account holds under a name the node ships. Such a record (an account installed
 *   under a name a later release ships) is left as it is, the shipped code is not written into it,
 *   and the operator is told with one security incident, as the bundled cortex seeder does
 *   (secaudit2026oct26, routes/extensions/crud.ts:install-accepts-builtin-extension-name).
 *
 *   Usage kept: a missing built-in is installed and switched on; one the node holds at an older
 *   version is updated as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/builtin-extension-held-name.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');
const { seedBuiltinExtensions } = await import('../../src/services/builtin-extension-seeder.js');
const { BUILTIN_EXTENSIONS } = await import('../../src/data/builtin-extensions/index.js');
const { SECURITY_INCIDENT_PREFIX } = await import('../../src/services/security-incident.js');
const { loadConfig } = await import('../../src/config.js');

const config = loadConfig().config;
const CLAIMED = 'export default async function(){ return { mine: true }; }';

function claimed(name: string, version: string) {
    return {
        name, version, description: 'claimed early', author: 'mallory', status: 'active', requiredApis: [],
        actions: [{ id: 'run', method: 'POST', path: '/run', inputSchema: {}, outputSchema: {}, scriptContent: CLAIMED }],
        config: {}, limits: { memoryMb: 16, timeoutMs: 1000, maxApiCalls: 5 }, federation: { advertise: false, capabilities: [] },
        installedBy: 'mallory', installedAt: new Date().toISOString(),
    };
}

const incidents = async (storage: InstanceType<typeof SqliteStorage>) =>
    (await storage.listAllMemory({ prefix: SECURITY_INCIDENT_PREFIX, limit: 100 })).items
        .filter(r => (r.value as { code?: string }).code === 'BUILTIN_EXTENSION_NAME_HELD');

describe('a built-in extension name another account holds', () => {
    for (const version of ['0.0.1', '99.0.0']) {
        it(`at version ${version} is left as it is, gets no shipped code, and the operator is told once`, async () => {
            const storage = new SqliteStorage(':memory:');
            const name = BUILTIN_EXTENSIONS[0]!.name;
            await storage.createExtension(claimed(name, version) as never);
            const out = await seedBuiltinExtensions(storage as never, config);
            const after = await storage.getExtension(name);
            expect(after?.installedBy).toBe('mallory');
            expect(after?.version).toBe(version);
            expect(after?.actions.map(a => a.scriptContent)).toEqual([CLAIMED]);
            expect(out.updated).not.toContain(name);
            expect((await incidents(storage)).length).toBe(1);
            await seedBuiltinExtensions(storage as never, config);
            expect((await incidents(storage)).length, 'a later start opens none').toBe(1);
        });
    }

    it('designed use: a missing built-in is installed, and one the node holds at an older version is updated', async () => {
        const storage = new SqliteStorage(':memory:');
        const first = await seedBuiltinExtensions(storage as never, config);
        for (const b of BUILTIN_EXTENSIONS) expect(first.installed).toContain(b.name);
        const name = BUILTIN_EXTENSIONS[0]!.name;
        await storage.updateExtension(name, { version: '0.0.1' });
        const second = await seedBuiltinExtensions(storage as never, config);
        expect(second.updated).toContain(name);
        expect((await storage.getExtension(name))?.installedBy).toBe('system');
        expect((await incidents(storage)).length).toBe(0);
    });
});
