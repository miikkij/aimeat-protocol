/**
 * @file test/unit/datapackage-audience-record.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The audience record of a data package (services/datapackage/audience-record.ts,
 *   secaudit2026oct31w2 round 10, W2-14). The boot step keeps every package that existed at the update
 *   open to exactly the readers it had: a package stored before the pointer carried a visibility, a
 *   members package, an earlier version tagged with its audience and an earlier version written before
 *   the tag, each read by an anonymous caller, another account and the owner, before and after the
 *   step. After the step, a pointer the service did not write opens to its owner only.
 * @usage cd aimeat && pnpm exec vitest run test/unit/datapackage-audience-record.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { openPackage } from '../../src/services/datapackage/store.js';
import { withAudienceTag } from '../../src/services/datapackage/audience.js';
import { recordDatapackageAudiencesOnce, audienceRecordKey } from '../../src/services/datapackage/audience-record.js';
import { isServiceOwnedKey } from '../../src/utils/reserved-keys.js';

const SQLITE_PATH = `./test/.dpaudience-${process.pid}.db`;
const NODE = 'aimeat-dp-audience';
const OWNER = 'dpowner';
const GHII = `${OWNER}@${NODE}`;
const config = { nodeId: NODE, baseUrl: 'http://localhost', classificationMode: 'off' } as unknown as AimeatConfig;
let storage: Storage;

const anonymous = null;
const account = { sub: `bob@${NODE}`, owner: 'bob', roles: ['owner'], scopes: [] };
const ownerInPerson = { sub: GHII, owner: OWNER, roles: ['owner'], scopes: [] };
const H = (c: string) => c.repeat(64);

async function put(key: string, visibility: 'public' | 'members' | 'private', data: unknown, tags: string[] = []): Promise<void> {
    const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
    await storage.createStorageFile({ key, ownerGaii: GHII, visibility, mimeType: 'application/json', size: bytes.length, data: bytes, tags, createdAt: new Date().toISOString() });
}
const descriptor = (name: string, hash: string) => ({
    name, profile: 'tabular-data-package', created: '2026-10-01T00:00:00.000Z', resources: [],
    aimeat: { packageId: `pkg:${OWNER}/${name}`, changes: 'v', producer: { kind: 'manual' }, producedBy: { gaii: GHII, at: '' }, schemaSource: 'declared', contentHash: `sha256:${hash}` },
});
const pointer = (name: string, hash: string, visibility?: string) => ({
    packageId: `pkg:${OWNER}/${name}`, name, contentHash: `sha256:${hash}`, descriptorUrl: '', updatedAt: '2026-10-01T00:00:00.000Z', ...(visibility ? { visibility } : {}),
});

/** Who opens each case: [anonymous, another account, the owner]. */
async function readers(ref: string): Promise<boolean[]> {
    const out: boolean[] = [];
    for (const r of [anonymous, account, ownerInPerson]) out.push(!!(await openPackage({ storage, config }, ref, NODE, r)));
    return out;
}

const CASES = [
    `pkg:${OWNER}/legacy`,                                  // pointer with no visibility: public
    `pkg:${OWNER}/mem`,                                     // a members package
    `pkg:${OWNER}/tagged@sha256:${H('2')}`,                 // an earlier version tagged private under a public pointer
    `pkg:${OWNER}/tagged@sha256:${H('3')}`,                 // an earlier version tagged members
    `pkg:${OWNER}/untagged@sha256:${H('5')}`,               // an earlier version written before the tag, private tier
    `pkg:${OWNER}/untagged@sha256:${H('6')}`,               // ... members tier
    `pkg:${OWNER}/untagged@sha256:${H('7')}`,               // ... public tier
];
let before: boolean[][] = [];

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
    await storage.createOwner({ name: 'bob', displayName: 'bob', publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
    await put('datapkg/legacy/latest.json', 'public', pointer('legacy', H('1')));
    await put(`datapkg/legacy/${H('1')}/datapackage.json`, 'public', descriptor('legacy', H('1')));
    await put('datapkg/mem/latest.json', 'members', pointer('mem', H('a'), 'members'));
    await put(`datapkg/mem/${H('a')}/datapackage.json`, 'members', descriptor('mem', H('a')), withAudienceTag([], 'members'));
    await put('datapkg/tagged/latest.json', 'public', pointer('tagged', H('4'), 'public'));
    await put(`datapkg/tagged/${H('4')}/datapackage.json`, 'public', descriptor('tagged', H('4')), withAudienceTag([], 'public'));
    await put(`datapkg/tagged/${H('2')}/datapackage.json`, 'private', descriptor('tagged', H('2')), withAudienceTag([], 'private'));
    await put(`datapkg/tagged/${H('3')}/datapackage.json`, 'members', descriptor('tagged', H('3')), withAudienceTag([], 'members'));
    await put('datapkg/untagged/latest.json', 'public', pointer('untagged', H('8'), 'public'));
    await put(`datapkg/untagged/${H('8')}/datapackage.json`, 'public', descriptor('untagged', H('8')));
    await put(`datapkg/untagged/${H('5')}/datapackage.json`, 'private', descriptor('untagged', H('5')));
    await put(`datapkg/untagged/${H('6')}/datapackage.json`, 'members', descriptor('untagged', H('6')));
    await put(`datapkg/untagged/${H('7')}/datapackage.json`, 'public', descriptor('untagged', H('7')));
    for (const ref of CASES) before.push(await readers(ref));
}, 60_000);

afterAll(async () => {
    setThisNodeId(null);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) rmSync(p);
    }
});

describe('the audience record of a data package', () => {
    it('is a service-owned key, which no memory route writes', () => {
        expect(isServiceOwnedKey(audienceRecordKey('anything'))).toBe(true);
    });

    it('the readers before the update are the ones the old rule gave', () => {
        expect(before).toEqual([
            [true, true, true],
            [false, true, true],
            [false, false, true],
            [false, true, true],
            [false, false, true],
            [false, true, true],
            [true, true, true],
        ]);
    });

    it('the boot step records every package once, and each keeps exactly its readers', async () => {
        const first = await recordDatapackageAudiencesOnce(storage, config);
        expect(first).toEqual({ ran: true, recorded: 4 });
        expect(await recordDatapackageAudiencesOnce(storage, config)).toEqual({ ran: false });
        const after: boolean[][] = [];
        for (const ref of CASES) after.push(await readers(ref));
        expect(after).toEqual(before);
    });

    it('after the step, a pointer the service did not write opens to its owner only', async () => {
        await put('datapkg/forged/latest.json', 'private', pointer('forged', H('9'), 'public'));
        await put(`datapkg/forged/${H('9')}/datapackage.json`, 'private', descriptor('forged', H('9')), withAudienceTag([], 'public'));
        expect(await readers(`pkg:${OWNER}/forged`)).toEqual([false, false, true]);
    });

    it('after the step, a rewritten pointer or tag does not widen a recorded package', async () => {
        await storage.updateFileTagsByKey(GHII, `datapkg/tagged/${H('2')}/datapackage.json`, withAudienceTag([], 'public'));
        await put('datapkg/mem/latest.json', 'members', pointer('mem', H('a'), 'public'));
        expect(await readers(`pkg:${OWNER}/tagged@sha256:${H('2')}`)).toEqual([false, false, true]);
        expect(await readers(`pkg:${OWNER}/mem`)).toEqual([false, true, true]);
    });
});
