/**
 * @file test/unit/component-release-paths.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The removal paths beside the two uninstall functions write the released-name row too
 *   (secaudit2026oct26, component-address.ts:releaseBareName:erasure-and-package-uninstall-skip-release):
 *   a package component's extension removed through deleteComponent keeps its bare name for its
 *   holder, and another account's install of the name goes to `<installer>/<name>`. Run against every
 *   provider the environment names, as component-address.test.ts is.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 *   v1.0.1 — 2026-10-27 — Refuses a missing DATABASE_URL when the run asks for PostgreSQL, like every two-provider unit file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import { installNameFor } from '../../src/services/component-address.js';
import { deleteComponent } from '../../src/services/component-registrar.js';
import { requirePostgresWhenAsked } from './postgres-arm.js';

requirePostgresWhenAsked('component-release-paths');

const SQLITE_PATH = `./test/.component-release-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
    }
});

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

function extRecord(name: string, installedBy: string): ExtensionRecord {
    const now = new Date().toISOString();
    return {
        name, version: '1.0.0', description: 'release test', author: 'test', status: 'active',
        requiredApis: [], actions: [{ id: 'run', method: 'POST', path: '/run', inputSchema: {}, outputSchema: {}, scriptContent: 'export default async () => 1;' }],
        config: {}, limits: { memoryMb: 16, timeoutMs: 1000, maxApiCalls: 1 }, federation: { advertise: false, capabilities: [] },
        installedBy, installedAt: now,
    } as ExtensionRecord;
}

describe('a package component\'s extension removed through deleteComponent', () => {
    it('writes the released name for its holder, so another account\'s install is namespaced and the holder\'s is not', async () => {
        for (const { name, storage } of provs) {
            const s = stamp();
            const holder = `pkgown${s}`, other = `pkgoth${s}`, ext = `pkgext${s}`;
            await storage.createExtension(extRecord(ext, holder));
            expect(await deleteComponent(storage, 'extension', ext, `${holder}@node`), `${name}: deleted`).toBe(true);
            expect((await storage.getReleasedComponentName?.('extension', ext))?.holder, `${name}: the released row`).toBe(holder);
            expect((await installNameFor(storage, 'extension', other, ext)).name, `${name}: another account`).toBe(`${other}/${ext}`);
            expect((await installNameFor(storage, 'extension', holder, ext)).name, `${name}: the holder reinstalls`).toBe(ext);
        }
    });
});
