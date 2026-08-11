/**
 * @file test/unit/storage-file-write.test.ts
 * @description The one write behind POST /v1/storage and aimeat_storage_upload. What is pinned here
 *   is what the two copies disagreed about before they became one: the account-wide quota and the
 *   overage charge that follows it (present on the HTTP door, absent on the tool, so the same upload
 *   was billed through one and free through the other), the anonymous key fence, and the presigned
 *   token meta, which used to drop `group_id` and land a group file bound to no group.
 * @structure Two describes: writeStorageFile() and mintStorageUploadUrl().
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-file-write.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, with services/storage-file-write.ts (August 2026 audit step 8).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';

vi.mock('../../src/services/push.js', () => ({}));

/** The mint needs signing keys it cannot have in a unit test, so the token itself is stubbed and the
 *  meta builder stays real: the meta is the thing under test. */
const generateUploadToken = vi.fn(async () => 'u_stub-handle');
vi.mock('../../src/services/upload-token.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/upload-token.js')>();
    return { ...actual, generateUploadToken };
});

const { writeStorageFile, mintStorageUploadUrl } = await import('../../src/services/storage-file-write.js');

const OWNER = 'bot#alice@test-node';
const ANON = 'shared#anonymous@test-node';

const config = {
    nodeId: 'test-node',
    baseUrl: 'https://node.example',
    storageMaxFileSizeMb: 10,
    storageQuotaMb: 1,
    storageOverageMorselsPerGbMonth: 100,
} as unknown as AimeatConfig;

const createStorageFile = vi.fn(async (f: StorageFileRecord) => f);
const listStorageFiles = vi.fn(async () => [] as StorageFileRecord[]);
const getGHIIByOwner = vi.fn(async () => ({ morselBalance: 0 }));
const debitBalance = vi.fn(async () => undefined);
const addTransaction = vi.fn(async () => undefined);

const storage = {
    createStorageFile, listStorageFiles, getGHIIByOwner, debitBalance, addTransaction,
} as unknown as Storage;

const deps = { storage, config };
const bytes = (n: number) => Buffer.alloc(n, 1);
/** The record the write actually stored. */
const stored = () => createStorageFile.mock.calls[0][0];

beforeEach(() => {
    createStorageFile.mockClear();
    listStorageFiles.mockClear();
    listStorageFiles.mockResolvedValue([]);
    getGHIIByOwner.mockClear();
    getGHIIByOwner.mockResolvedValue({ morselBalance: 0 });
    debitBalance.mockClear();
    addTransaction.mockClear();
    generateUploadToken.mockClear();
});

describe('writeStorageFile', () => {
    it('stores the file and reports no overage inside the quota', async () => {
        const out = await writeStorageFile(deps, OWNER, { key: 'notes/a.txt', data: bytes(64), mimeType: 'text/plain' });
        expect(out.ok).toBe(true);
        expect(stored().key).toBe('notes/a.txt');
        expect(stored().ownerGaii).toBe(OWNER);
        expect(stored().visibility).toBe('private');
        expect(out.ok && out.overageMorsels).toBe(0);
    });

    it('fences an anonymous principal out of every key but anonymous/', async () => {
        const out = await writeStorageFile(deps, ANON, { key: 'notes/a.txt', data: bytes(8) });
        expect(out).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' });
        expect(createStorageFile).not.toHaveBeenCalled();
    });

    it('lets an anonymous principal write inside its own namespace', async () => {
        const out = await writeStorageFile(deps, ANON, { key: 'anonymous/a.txt', data: bytes(8) });
        expect(out.ok).toBe(true);
    });

    it('refuses a file over the per-file ceiling, and says the presigned door is the answer', async () => {
        const out = await writeStorageFile(deps, OWNER, { key: 'big.bin', data: bytes(11 * 1024 * 1024) });
        expect(out).toMatchObject({ ok: false, status: 413, code: 'QUOTA_EXCEEDED', limit: 'per_file' });
        expect(createStorageFile).not.toHaveBeenCalled();
    });

    it('refuses when the ACCOUNT quota is passed and the balance cannot cover the overage', async () => {
        const out = await writeStorageFile(deps, OWNER, { key: 'big.bin', data: bytes(2 * 1024 * 1024) });
        expect(out).toMatchObject({ ok: false, status: 413, code: 'QUOTA_EXCEEDED', limit: 'account' });
        expect(createStorageFile).not.toHaveBeenCalled();
    });

    it('charges the overage when the balance covers it, the step the tool door skipped entirely', async () => {
        getGHIIByOwner.mockResolvedValue({ morselBalance: 500 });
        const out = await writeStorageFile(deps, OWNER, { key: 'big.bin', data: bytes(2 * 1024 * 1024) });
        expect(out.ok).toBe(true);
        expect(out.ok && out.overageMorsels).toBe(100);
        expect(debitBalance).toHaveBeenCalledWith(OWNER, 100);
        expect(addTransaction).toHaveBeenCalledWith(expect.objectContaining({ type: 'storage_overage', amount: -100 }));
    });

    it('refuses a workspace-visible file that names no workspace', async () => {
        const out = await writeStorageFile(deps, OWNER, { key: 'a.png', data: bytes(8), visibility: 'workspace' });
        expect(out).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
        expect(createStorageFile).not.toHaveBeenCalled();
    });

    it('keeps groupId and workspaceRef on the visibility that uses them', async () => {
        await writeStorageFile(deps, OWNER, { key: 'a.png', data: bytes(8), visibility: 'private', groupId: 'grp-1', workspaceRef: 'org-1/ws-1' });
        expect(stored().groupId).toBeUndefined();
        expect(stored().workspaceRef).toBeUndefined();

        createStorageFile.mockClear();
        await writeStorageFile(deps, OWNER, { key: 'b.png', data: bytes(8), visibility: 'group', groupId: 'grp-1' });
        expect(stored().groupId).toBe('grp-1');
    });

    it('refuses an empty key rather than storing a file nobody can address', async () => {
        const out = await writeStorageFile(deps, OWNER, { key: '', data: bytes(8) });
        expect(out).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
    });
});

describe('mintStorageUploadUrl', () => {
    /** The meta the token was signed with. */
    const meta = () => (generateUploadToken.mock.calls[0][0] as unknown as { meta: Record<string, unknown> }).meta;

    it('carries group_id and workspace_refs into the signed token', async () => {
        const out = await mintStorageUploadUrl(deps, OWNER, {
            key: 'a.png', mimeType: 'image/png', visibility: 'group',
            groupId: 'grp-1', workspaceRef: 'org-1/ws-1',
        });
        expect(out.ok).toBe(true);
        expect(meta()).toMatchObject({
            key: 'a.png', mime_type: 'image/png', visibility: 'group',
            group_id: 'grp-1', workspace_refs: 'org-1/ws-1',
        });
        expect(out.ok && out.uploadUrl).toBe('https://node.example/v1/upload/u_stub-handle');
    });

    it('advertises the operator ceiling, not a constant', async () => {
        const out = await mintStorageUploadUrl(deps, OWNER, { key: 'a.png' });
        expect(out.ok && out.maxBytes).toBe(10 * 1024 * 1024);
    });

    it('runs the same key fence as the inline write, so the URL is not a way around it', async () => {
        const out = await mintStorageUploadUrl(deps, ANON, { key: 'elsewhere/a.png' });
        expect(out).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' });
        expect(generateUploadToken).not.toHaveBeenCalled();
    });

    it('refuses an empty key', async () => {
        const out = await mintStorageUploadUrl(deps, OWNER, { key: '' });
        expect(out).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
    });
});
