/**
 * @file test/unit/access-guard-visitor.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shared read guard (src/services/access-guard.ts authorizeRead) and the file
 *   reference resolver behind the MCP file read (src/services/file-refs.ts resolveFileRef, which
 *   aimeat_storage_download, task attachments and scheduled runs call) decide the 'members' tier from
 *   the reader identity itself: an identity of another node is a visitor and is admitted only through
 *   a consent, whether or not the caller said it was a visitor. Identities of this node, the owner's
 *   agents and apps included, read 'members' content as before; a public item stays readable to a
 *   visitor.
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22, members-tier-admits-federated-visitor).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, StorageFileRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { authorizeRead } from '../../src/services/access-guard.js';
import { resolveFileRef } from '../../src/services/file-refs.js';
import type { ContentReader } from '../../src/services/classification/reader.js';

const NODE = 'aimeat-guard-visitor-test';
const OWNER = `alice@${NODE}`;
const VISITOR = 'carol@aimeat-other-node';
const MEMBERS_KEY = 'docs/members.txt';
const PUBLIC_KEY = 'docs/public.txt';

let base: Storage;
let storage: Storage;
let config: AimeatConfig;

function file(key: string, visibility: StorageFileRecord['visibility']): StorageFileRecord {
    return { key, ownerGaii: OWNER, visibility, mimeType: 'text/plain', size: 5, data: Buffer.from('hello'), createdAt: new Date().toISOString() } as StorageFileRecord;
}

/** A reader that shows everything: classification is not what this suite is about. */
const reader = { show: async <T>(items: T[]) => items } as unknown as ContentReader;

const membersRead = (accessorGaii: string, extra: { accessorFederated?: boolean } = {}) => authorizeRead(storage, config, {
    ownerGaii: OWNER, accessorGaii, resourceKey: `storage:${MEMBERS_KEY}`, visibility: 'members', action: 'read', noAudit: true, ...extra,
});

beforeAll(() => {
    setThisNodeId(NODE);
    base = new SqliteStorage(':memory:') as unknown as Storage;
    const files = new Map([[MEMBERS_KEY, file(MEMBERS_KEY, 'members')], [PUBLIC_KEY, file(PUBLIC_KEY, 'public')]]);
    // The real store for consents and shares; the two files are served from here.
    storage = Object.assign(Object.create(base) as Storage, {
        getStorageFile: async (owner: string, key: string) => (owner === OWNER ? files.get(key) ?? null : null),
    });
    config = { ...loadConfig().config, nodeId: NODE, consentEnabled: true };
});

afterAll(() => { setThisNodeId(null); });

describe('authorizeRead, the members tier and a visitor from another node', () => {
    it('refuses a visitor named by its home GHII when the caller did not say it was a visitor', async () => {
        const r = await membersRead(VISITOR);
        expect(r.allowed, `a visitor of another node read a members item: ${r.reason}`).toBe(false);
    });

    it('refuses the composed form `${owner}@${nodeId}` of a visitor too', async () => {
        const r = await membersRead(`${VISITOR}@${NODE}`);
        expect(r.allowed, `the composed visitor name read a members item: ${r.reason}`).toBe(false);
    });

    it('admits this node\'s accounts, their agents and their apps, as before', async () => {
        for (const who of ['bob', `bob@${NODE}`, `claude#bob@${NODE}`, `eco:notes#bob@${NODE}`]) {
            const r = await membersRead(who);
            expect(r.allowed, `${who} lost its members read: ${r.reason}`).toBe(true);
            expect(r.reason).toBe('members_data');
        }
    });

    it('still honours the caller\'s explicit visitor word', async () => {
        const r = await membersRead(`bob@${NODE}`, { accessorFederated: true });
        expect(r.allowed).toBe(false);
    });

    it('admits a visitor through a consent its owner gave the visitor by name', async () => {
        const id = `c-${Date.now()}`;
        await base.createConsent({
            id, ownerGaii: OWNER, dataPattern: `storage:${MEMBERS_KEY}`, recipient: VISITOR, purpose: 'unit', scope: 'local',
            expires: null, status: 'active', grantedAt: new Date().toISOString(), revokedAt: null,
        } as never);
        try {
            const r = await membersRead(VISITOR);
            expect(r.allowed, `a consent by name did not admit the visitor: ${r.reason}`).toBe(true);
            expect(r.reason).toBe('consent_granted');
        } finally {
            await base.deleteConsent(id);
        }
    });

    it('keeps a public item readable to a visitor', async () => {
        const r = await authorizeRead(storage, config, {
            ownerGaii: OWNER, accessorGaii: VISITOR, resourceKey: `storage:${PUBLIC_KEY}`, visibility: 'public', action: 'read', noAudit: true,
        });
        expect(r.allowed).toBe(true);
    });
});

describe('resolveFileRef, the read behind aimeat_storage_download', () => {
    const resolve = (gaii: string, ref: string) => resolveFileRef(storage, config, ref, { gaii, sub: gaii, owner: gaii.split('@')[0], reader });

    it('denies a visitor a members file of another owner', async () => {
        const r = await resolve(VISITOR, `${OWNER}/${MEMBERS_KEY}`);
        expect(r.access, `a visitor resolved a members file: ${r.reason}`).toBe('denied');
        expect(r.file).toBeUndefined();
    });

    it('grants a local agent the same members file, and a visitor a public file', async () => {
        expect((await resolve(`claude#bob@${NODE}`, `${OWNER}/${MEMBERS_KEY}`)).access).toBe('granted');
        expect((await resolve(VISITOR, `${OWNER}/${PUBLIC_KEY}`)).access).toBe('granted');
    });
});
