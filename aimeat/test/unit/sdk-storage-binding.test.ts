/**
 * @file sdk-storage-binding.test.ts
 * @description AIMEAT.storage.upload() and uploadChunked() send the workspace or group a file is
 *   shared with. They sent only key, data, type and visibility, so a 'workspace' file was refused for
 *   naming no workspace and a 'group' file was stored bound to nobody; LÄHETIN 4.8.0 posted to
 *   /v1/storage itself to get round it (aimeat-apps wish
 *   wish-aimeat-storage-upload-stores-a-file-for-a-workspace, 2026-09-29).
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const calls: { path: string; body: any }[] = [];

beforeEach(() => {
    calls.length = 0;
    const session = {
        ghii: 'alice@n', owner: 'alice', jwt: 'tok',
        fetch: async (path: string, opts?: { body?: string }) => {
            calls.push({ path, body: opts?.body ? JSON.parse(opts.body) : null });
            return { ok: true, data: { upload_id: 'u1', key: 'k' } };
        },
    };
    const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '' });
    (globalThis as any).document = (globalThis as any).document ?? {
        documentElement: el(), head: el(), body: el(),
        getElementById: () => null, querySelector: () => null, createElement: el,
        addEventListener() {}, dispatchEvent() {},
    };
    (globalThis as any).location = (globalThis as any).location ?? {
        origin: 'https://app.test', href: 'https://app.test/', protocol: 'https:', hostname: 'app.test', search: '', hash: '',
    };
    (globalThis as any).window = (globalThis as any).window ?? { addEventListener() {}, dispatchEvent() {}, location: (globalThis as any).location };
    (globalThis as any).window.AIMEAT = { ...((globalThis as any).window.AIMEAT ?? {}), auth: { getSession: () => session } };
    // The chunk PUTs go straight to the node.
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });
});

async function lib() {
    await import('../../src/static/sdk-libs/storage/index.js');
    return (globalThis as any).window.AIMEAT.storage;
}

describe('AIMEAT.storage sends the workspace or group a file is shared with', () => {
    it('upload() sends workspace_ref for a workspace file', async () => {
        const storage = await lib();
        await storage.upload('eA==', { key: 'team.txt', visibility: 'workspace', workspace_ref: 'org1/ws1' });
        const post = calls.find(c => c.path === '/v1/storage');
        expect(post?.body).toMatchObject({ key: 'team.txt', visibility: 'workspace', workspace_ref: 'org1/ws1' });
    });

    it('upload() sends workspaceRefs as workspace_refs, and group_id for a group file', async () => {
        const storage = await lib();
        await storage.upload('eA==', { key: 'a.txt', visibility: 'workspace', workspaceRefs: ['org1/ws1', 'org1/ws2'] });
        await storage.upload('eA==', { key: 'b.txt', visibility: 'group', groupId: 'g1' });
        const [a, b] = calls.filter(c => c.path === '/v1/storage');
        expect(a.body.workspace_refs).toEqual(['org1/ws1', 'org1/ws2']);
        expect(b.body.group_id).toBe('g1');
    });

    it('uploadChunked() sends the binding with the init call', async () => {
        const storage = await lib();
        const file = new Blob(['hello']);
        await storage.uploadChunked(file, { key: 'big.bin', visibility: 'workspace', workspace_ref: 'org1/ws1' });
        const init = calls.find(c => c.path === '/v1/storage/upload/init');
        expect(init?.body).toMatchObject({ key: 'big.bin', visibility: 'workspace', workspace_ref: 'org1/ws1' });
    });

    it('a private upload sends no binding at all', async () => {
        const storage = await lib();
        await storage.upload('eA==', { key: 'mine.txt' });
        const post = calls.find(c => c.path === '/v1/storage');
        expect(post?.body.visibility).toBe('private');
        expect('workspace_ref' in post!.body || 'group_id' in post!.body || 'workspace_refs' in post!.body).toBe(false);
    });
});
