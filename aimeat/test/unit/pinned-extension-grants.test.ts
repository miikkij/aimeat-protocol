/**
 * @file test/unit/pinned-extension-grants.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A pinned extension call (`name@version`) runs the kept snapshot's code. Two things that
 *   belong to code travel with it (secaudit2026oct26):
 *     - the operator's emailPolicy 'unrestricted' grant was given to the live code: a pin to kept
 *       code with other action scripts runs without it, under the normal recipient rules, while a
 *       bare call and a pin to the same code keep it
 *       (extension-email-policy:pinned-version-runs-under-live-grant,
 *       component-versions:resolveExtensionForCall-pairs-kept-code-with-live-code-bound-grants);
 *     - the code writer (installedByPrincipal) of the kept version is the one the pinned run names;
 *       a snapshot kept before the writer was recorded keeps the live record's writer, as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/pinned-extension-grants.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import { resolveExtensionForCall, snapshotExtensionVersion } from '../../src/services/component-versions.js';

const SQLITE_PATH = `./test/.pinned-grants-${process.pid}.db`;
let storage: Storage;

beforeAll(async () => { storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }); }, 60_000);
afterAll(async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const s of ['', '-wal', '-shm']) if (existsSync(SQLITE_PATH + s)) { try { rmSync(SQLITE_PATH + s); } catch { /* scratch file */ } }
});

const NODE = 'node-1';
function rec(name: string, version: string, script: string, writer: string | undefined, config: Record<string, unknown> = {}): ExtensionRecord {
    const now = new Date().toISOString();
    return {
        name, version, description: 'pin test', author: 'test', status: 'active', requiredApis: [],
        actions: [{ id: 'send', method: 'POST', path: '/send', inputSchema: {}, outputSchema: {}, scriptContent: script }],
        config, limits: { memoryMb: 16, timeoutMs: 1000, maxApiCalls: 5 }, federation: { advertise: false, capabilities: [] },
        installedBy: 'olli', installedAt: now, ...(writer ? { installedByPrincipal: writer } : {}),
    } as ExtensionRecord;
}

describe('a pinned call takes the code-bound parts from the kept version', () => {
    it('kept code with other scripts runs without the email grant and under its own writer; the live code keeps both', async () => {
        const name = `mailer${Date.now().toString(36)}`;
        const v1 = rec(name, '1.0.0', 'export default async (ctx, i) => ctx.email(i.to, "s", "b");', `helper#olli@${NODE}`);
        await snapshotExtensionVersion(storage, v1, v1.installedByPrincipal!);
        const live = rec(name, '1.0.1', 'export default async (ctx) => ctx.email("fixed@example.test", "s", "b");', `olli@${NODE}`, { emailPolicy: 'unrestricted', greeting: 'hi' });
        await storage.createExtension(live);
        await snapshotExtensionVersion(storage, live, live.installedByPrincipal!);

        const pinnedOld = await resolveExtensionForCall(storage, `${name}@1.0.0`);
        expect(pinnedOld.ok).toBe(true);
        if (pinnedOld.ok) {
            expect(pinnedOld.ext.config.emailPolicy).toBeUndefined();
            expect(pinnedOld.ext.config.greeting).toBe('hi');
            expect(pinnedOld.ext.installedByPrincipal).toBe(`helper#olli@${NODE}`);
        }

        const bare = await resolveExtensionForCall(storage, name);
        const pinnedLive = await resolveExtensionForCall(storage, `${name}@1.0.1`);
        for (const r of [bare, pinnedLive]) {
            expect(r.ok).toBe(true);
            if (r.ok) {
                expect(r.ext.config.emailPolicy).toBe('unrestricted');
                expect(r.ext.installedByPrincipal).toBe(`olli@${NODE}`);
            }
        }
    });

    it('a snapshot kept before the writer was recorded keeps the live writer, and the same code keeps the grant', async () => {
        const name = `legacy${Date.now().toString(36)}`;
        const script = 'export default async () => 1;';
        // A snapshot written by the earlier code had no writer field.
        await storage.saveComponentVersion({
            kind: 'extension', name, version: '1.0.0',
            snapshot: { version: '1.0.0', description: 'pin test', author: 'test', requiredApis: [], actions: rec(name, '1.0.0', script, undefined).actions, limits: { memoryMb: 16, timeoutMs: 1000, maxApiCalls: 5 }, federation: { advertise: false, capabilities: [] }, instances: null, config: {} },
            bytes: 0, createdAt: new Date().toISOString(), createdBy: 'olli',
        });
        await storage.createExtension(rec(name, '1.0.1', script, `olli@${NODE}`, { emailPolicy: 'unrestricted' }));
        const r = await resolveExtensionForCall(storage, `${name}@1.0.0`);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.ext.installedByPrincipal).toBe(`olli@${NODE}`);
            expect(r.ext.config.emailPolicy).toBe('unrestricted');
        }
    });
});
