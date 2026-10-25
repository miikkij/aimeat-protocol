/**
 * @file cortex-upsert-claim-first.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The create branch of upsertCortex (PUT /v1/cortex/:name, aimeat_cortex_install with
 *   update:true, the presigned cortex ZIP) claims the name before it writes a lib byte, as
 *   installCortex does. The lib table is keyed on (name, file) with no owner, so a lib written before
 *   the insert replaced the bytes of whoever won the name between the read and the insert (the boot
 *   seeder or another owner's install), and the node then served the loser's JavaScript under the
 *   winner's record (secaudit2026oct22). The race is modelled with a storage double whose read says
 *   the name is free while the insert finds it taken.
 * @structure the race: 409 CONFLICT, the winner's bytes kept · a free name: created, record then libs
 * @usage pnpm exec vitest run test/unit/cortex-upsert-claim-first.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { upsertCortex } from '../../src/routes/cortex/upsert.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, CortexExtensionRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'test-node', cortexMaxLibSizeKb: 512, cortexMaxInstalled: 50 } as unknown as AimeatConfig;
const bob = { ownerName: 'bob', gaii: 'bob', isOperator: false };

const MANIFEST = [
    'apiVersion: cortex.aimeat.org/v1',
    'kind: Extension',
    'metadata:',
    '  name: demo-race',
    '  namespace: bob',
    'spec:',
    '  version: 1.0.0',
    '  components:',
    '    - type: lib',
    '      name: demo',
    '      filename: demo.js',
    '      exports: [demo]',
].join('\n');

/**
 * A storage double. `takenBy` set: the read answers "free" (the window), the insert finds the name
 * held by that owner, whose bytes are already stored. Every write is recorded in order.
 */
function raceStorage(takenBy: string | null) {
    const libs = new Map<string, string>(takenBy ? [['demo-race/demo.js', 'A']] : []);
    const writes: string[] = [];
    const storage = {
        listCortexExtensions: async () => [],
        getCortexExtension: async () => null,
        createCortexExtension: async (r: CortexExtensionRecord) => {
            if (takenBy) throw new Error(`Cortex extension "${r.name}" already exists`);
            writes.push(`record:${r.name}`);
            return { ...r, installedBy: 'bob' };
        },
        setCortexLibFile: async (name: string, file: string, content: string) => {
            writes.push(`lib:${name}/${file}`);
            libs.set(`${name}/${file}`, content);
        },
        saveComponentVersion: async () => {},
        replaceDependencyEdges: async () => {},
    } as unknown as Storage;
    return { storage, libs, writes };
}

describe('upsertCortex create branch: the name is claimed before the bytes', () => {
    it('answers 409 CONFLICT when another writer took the name after the read, and leaves its bytes as they were', async () => {
        const { storage, libs } = raceStorage('alice');
        const out = await upsertCortex({ storage, config }, bob, { name: 'demo-race', manifest: MANIFEST, libs: { 'demo.js': 'B' } });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.refusal.status).toBe(409);
        expect(out.refusal.code).toBe('CONFLICT');
        expect(libs.get('demo-race/demo.js')).toBe('A');
    });

    it('creates a cortex under a free name: the record first, then its libs', async () => {
        const { storage, libs, writes } = raceStorage(null);
        const out = await upsertCortex({ storage, config }, bob, { name: 'demo-race', manifest: MANIFEST, libs: { 'demo.js': 'B' } });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.value.action).toBe('created');
        expect(writes).toEqual(['record:demo-race', 'lib:demo-race/demo.js']);
        expect(libs.get('demo-race/demo.js')).toBe('B');
    });
});
