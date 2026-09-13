/**
 * @file test/unit/undeclared-space-refusal.test.ts
 * @description A workspace record written or published into a space the workspace manifest does not
 *   declare is REFUSED, 422 UNDECLARED_SPACE, before anything is written: no record, no provenance
 *   record, no published copy. Decided by the developer on 2026-09-13. Until then only the MCP
 *   workspace write refused it, and every other door stored the record, answered success with a
 *   warning, and no workspace read ever listed it (a production CRM ran four such spaces for a month).
 *
 *   What this proves, door by door, through the functions the doors call:
 *     - the memory write (POST /v1/memory, aimeat_memory_write, connector and CLI via POST)
 *     - the draft write the MCP tool and the extension sandbox run (writeWorkspaceDraftsOp), with the
 *       SAME code and message as the memory door
 *     - the in-place document edit (appendToDocument)
 *     - publishDraft (single publish, MCP publish, sandbox publish, approved publish gate),
 *       publishDraftsBatch (batch publish, draft-less import, intake) and revertToDraft
 *     - the decision itself: namespace-only matching for keys, the row-space and public wordings,
 *       and which namespaces are not spaces
 *   And what must keep writing: a declared space, the workspace's own meta.* keys, node-owned
 *   skills.* and access.* keys (including names that end like a record role), and the organism root.
 * @usage pnpm exec vitest run test/unit/undeclared-space-refusal.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial: the developer's refusal decision for UNDECLARED_SPACE.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { writeMemoryRecord } from '../../src/services/memory-write.js';
import { workspaceCallerOf, writeWorkspaceDraftsOp } from '../../src/services/workspace-tool-ops.js';
import { appendToDocument, WorkspaceDocError } from '../../src/services/workspace-doc-edit.js';
import { createOrganismHelpers } from '../../src/routes/organisms/shared.js';
import { undeclaredSpaceRefusal, undeclaredSpaceForKey, isPlatformWorkspaceNamespace } from '../../src/services/workspace-write-items.js';

const ORG = '5e1f0c2a-7b3d-4e8f-9a10-2b3c4d5e6f70';
const WS = 'ws-undeclared1';
const WS_NO_MANIFEST = 'ws-nomanifest1';

let storage: Storage;
let config: AimeatConfig;
let NODE = '';
let OWNER = '';
let AGENT = '';

const root = (ws = WS) => `organism.${ORG}.w.${ws}`;

async function put(key: string, owner: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
}

/** Every copy of a key, whoever holds it. */
async function copiesOf(key: string): Promise<MemoryRecord[]> {
    return (await storage.listAllMemory({ prefix: key, limit: 50, archived: 'include' })).items.filter(r => r.key === key);
}

async function provenanceCount(): Promise<number> {
    return (await storage.listAiProvenance({ limit: 1000 })).total;
}

beforeAll(async () => {
    config = { ...loadConfig().config, aiProvenance: true };
    NODE = config.nodeId;
    OWNER = `alice@${NODE}`;
    AGENT = `claude#alice@${NODE}`;
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const now = new Date().toISOString();
    await storage.createGHII({ username: 'alice', nodeId: NODE, ghii: OWNER, displayName: 'Alice', ownerName: 'alice', verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    await storage.createOrganism({
        id: ORG, name: 'CRM', description: '', type: 'project', interests: [],
        creatorGhii: OWNER, createdBy: OWNER, owners: [OWNER], admins: [OWNER], members: [OWNER], agentGaiis: [],
        boardId: 'board-x', joinPolicy: 'invite_only', maxMembers: 100, visibility: 'private',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${ORG}`, createdAt: now, updatedAt: now,
    });
    await storage.createMembership({ id: 'm-1', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: now });
    // The registry names alice as the workspace's creator, which is what lets her own agent write.
    await put(`organism.${ORG}.meta.workspaces`, OWNER, { workspaces: [
        { id: WS, name: 'CRM', createdAt: now, createdBy: 'alice' },
        { id: WS_NO_MANIFEST, name: 'Empty', createdAt: now, createdBy: 'alice' },
    ] });
    await put(`${root()}.meta.manifest`, OWNER, {
        manifestVersion: '1', name: 'CRM', kind: 'project',
        objectTypes: [
            { name: 'contact', namespace: 'crm.contacts', mode: 'records', backing: 'memory' },
            { name: 'notes', namespace: 'crm.notes', mode: 'document', backing: 'memory' },
            { name: 'todo', namespace: 'crm.todo', mode: 'records', backing: 'tasks' },
        ],
    });
});

const agentCaller = () => ({ principal: AGENT, targetGaii: AGENT, scopes: ['memory:write', 'memory:read'], roles: ['agent'] });
const ownerCaller = () => ({ principal: OWNER, targetGaii: OWNER, scopes: [], roles: ['owner'] });

describe('the memory write refuses an undeclared space before writing anything', () => {
    it('an agent writing a draft into a space the manifest does not declare: 422 UNDECLARED_SPACE, no record, no provenance', async () => {
        const key = `${root()}.crm.campaigns.k1.draft`;
        const before = await provenanceCount();
        const out = await writeMemoryRecord({ storage, config }, agentCaller(), { key, value: { id: 'k1', title: 'Spring' }, visibility: 'private', pipeline: 'test' });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(422);
        expect(out.code).toBe('UNDECLARED_SPACE');
        const d = out.details as { namespace?: string; declared_spaces?: Array<{ namespace: string }>; how_to_fix?: string };
        expect(d.namespace).toBe('crm.campaigns');
        expect((d.declared_spaces ?? []).map(s => s.namespace)).toEqual(['crm.contacts', 'crm.notes']);
        expect(String(d.how_to_fix)).toContain('add_object_types');
        expect(out.message).toContain('crm.campaigns');
        expect(out.message).toContain('crm.contacts');
        expect(await copiesOf(key)).toHaveLength(0);
        expect(await provenanceCount()).toBe(before);
    });

    it('a .latest or .version.N written straight through the memory door is refused the same way', async () => {
        for (const suffix of ['latest', 'version.3']) {
            const key = `${root()}.crm.campaigns.k2.${suffix}`;
            const out = await writeMemoryRecord({ storage, config }, ownerCaller(), { key, value: { id: 'k2' }, visibility: 'private', pipeline: 'test' });
            expect(out.ok ? 'written' : out.code).toBe('UNDECLARED_SPACE');
            expect(await copiesOf(key)).toHaveLength(0);
        }
    });

    it('a space declared with a non-memory backing is refused too: its data never lives in workspace records', async () => {
        const key = `${root()}.crm.todo.t1.draft`;
        const out = await writeMemoryRecord({ storage, config }, ownerCaller(), { key, value: { id: 't1' }, visibility: 'private', pipeline: 'test' });
        expect(out.ok ? 'written' : out.code).toBe('UNDECLARED_SPACE');
        expect(await copiesOf(key)).toHaveLength(0);
    });

    it('a workspace with no manifest declares nothing, so a record written into it is refused', async () => {
        const key = `${root(WS_NO_MANIFEST)}.crm.contacts.c1.draft`;
        const out = await writeMemoryRecord({ storage, config }, ownerCaller(), { key, value: { id: 'c1' }, visibility: 'private', pipeline: 'test' });
        expect(out.ok ? 'written' : out.code).toBe('UNDECLARED_SPACE');
        expect(await copiesOf(key)).toHaveLength(0);
    });

    it('an ecosystem app is refused without being shown the manifest it may not be able to read', async () => {
        const out = await writeMemoryRecord({ storage, config },
            { principal: `eco:crm-sync#alice@${NODE}`, targetGaii: `eco:crm-sync#alice@${NODE}`, scopes: ['memory:write'], roles: ['ecosystem'] },
            { key: `${root()}.crm.campaigns.k3.draft`, value: { id: 'k3' }, visibility: 'private', pipeline: 'test' });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('UNDECLARED_SPACE');
        const d = out.details as { declared_spaces?: unknown };
        expect(d.declared_spaces).toBeUndefined();
        expect(out.message).not.toContain('crm.contacts');
    });

    it('positive control: a declared space writes, and carries no UNDECLARED_SPACE warning', async () => {
        const key = `${root()}.crm.contacts.c1.draft`;
        const out = await writeMemoryRecord({ storage, config }, agentCaller(), { key, value: { id: 'c1', name: 'Aino' }, visibility: 'private', pipeline: 'test' });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.warnings.map(w => w.code)).not.toContain('UNDECLARED_SPACE');
        expect(await copiesOf(key)).toHaveLength(1);
    });
});

describe('what is not a space keeps writing', () => {
    // Node-owned keys under the workspace root that no manifest declares. Measured on aimeat.io on
    // 2026-09-13: workspace skills and access requests are the only such keys in live use. Several
    // of these deliberately END like a record role (a skill file named notes.draft, a file under
    // version.3), which is the shape the key parser reads as a workspace record.
    const exempt = () => [
        `${root()}.meta.sections.notes`,
        `${root()}.meta.readme`,
        `${root()}.meta.intake.frm-one`,
        `${root()}.skills.crm-guide.manifest`,
        `${root()}.skills.latest.manifest`,
        `${root()}.skills.crm-guide.versions.1.0.0`,
        `${root()}.skills.crm-guide.files.notes.draft`,
        `${root()}.skills.crm-guide.files.refs.version.3`,
        `${root()}.skills.draft.files.SKILL.latest`,
        `${root()}.access.request.alice`,
        `${root()}.access.request.draft`,
        `organism.${ORG}.crm.campaigns.k1.draft`,
    ];
    it('meta.*, skills.*, access.* and the organism root are never refused', async () => {
        for (const key of exempt()) {
            const out = await writeMemoryRecord({ storage, config }, ownerCaller(), { key, value: { v: 1 }, visibility: 'private', pipeline: 'test' });
            expect(out.ok ? 'written' : `${out.code}: ${out.message}`, key).toBe('written');
            if (out.ok) expect(out.warnings.map(w => w.code), key).not.toContain('UNDECLARED_SPACE');
        }
    });
});

describe('the workspace draft write (MCP tool, extension sandbox) uses the same refusal', () => {
    it('writeWorkspaceDraftsOp answers 422 UNDECLARED_SPACE with the memory door\'s message', async () => {
        const caller = workspaceCallerOf({ principal: OWNER, ownerName: 'alice', roles: ['owner'] }, config);
        const op = await writeWorkspaceDraftsOp({ storage, config }, caller, { organismId: ORG, ws: WS, space: 'crm.campaigns', id: 'k5', value: { id: 'k5' }, pipeline: 'test' });
        expect(op.ok).toBe(false);
        if (op.ok) return;
        expect(op.status).toBe(422);
        expect(op.code).toBe('UNDECLARED_SPACE');
        const mem = await writeMemoryRecord({ storage, config }, ownerCaller(), { key: `${root()}.crm.campaigns.k5.draft`, value: { id: 'k5' }, visibility: 'private', pipeline: 'test' });
        expect(mem.ok).toBe(false);
        if (mem.ok) return;
        expect(op.message).toBe(mem.message);
        expect(await copiesOf(`${root()}.crm.campaigns.k5.draft`)).toHaveLength(0);
    });

    it('a batch names the item it refused and writes none of the batch', async () => {
        const caller = workspaceCallerOf({ principal: OWNER, ownerName: 'alice', roles: ['owner'] }, config);
        const op = await writeWorkspaceDraftsOp({ storage, config }, caller, { organismId: ORG, ws: WS, items: [
            { space: 'contact', id: 'c7', value: { id: 'c7' } },
            { space: 'campaign', id: 'k7', value: { id: 'k7' } },
        ], pipeline: 'test' });
        expect(op.ok ? 'written' : op.code).toBe('UNDECLARED_SPACE');
        if (op.ok) return;
        expect(op.message.startsWith('items[1]: ')).toBe(true);
        expect(await copiesOf(`${root()}.crm.contacts.c7.draft`)).toHaveLength(0);
    });
});

describe('the document edit uses the same refusal', () => {
    it('appendToDocument into an undeclared space throws UNDECLARED_SPACE 422', async () => {
        let caught: unknown;
        try {
            await appendToDocument({ storage, config }, { principal: OWNER, owner: 'alice', roles: ['owner'] },
                { organismId: ORG, wsId: WS, space: 'wiki', id: 'doc-1', markdown: '## Added', pipeline: 'test' });
        } catch (err) { caught = err; }
        expect(caught).toBeInstanceOf(WorkspaceDocError);
        expect((caught as WorkspaceDocError).code).toBe('UNDECLARED_SPACE');
        expect((caught as WorkspaceDocError).statusCode).toBe(422);
    });
});

describe('publishing refuses an undeclared space before it writes a version or moves .latest', () => {
    it('publishDraft of a draft already stored in an undeclared space: refused, draft kept, nothing published', async () => {
        const H = createOrganismHelpers(config, storage);
        const base = `${root()}.crm.campaigns.p1`;
        await put(`${base}.draft`, OWNER, { id: 'p1', title: 'Stored before the ruling' });
        const out = await H.publishDraft(ORG, WS, 'crm.campaigns', 'p1', OWNER, null) as { ok: boolean; code?: string; refusal?: { status: number; code: string } };
        expect(out.ok).toBe(false);
        expect(out.code).toBe('UNDECLARED_SPACE');
        expect(out.refusal?.status).toBe(422);
        expect(await copiesOf(`${base}.draft`)).toHaveLength(1);
        expect(await copiesOf(`${base}.latest`)).toHaveLength(0);
        expect(await copiesOf(`${base}.version.1`)).toHaveLength(0);
    });

    it('publishDraftsBatch (draft-less import) into an undeclared space: refused as a whole, nothing published', async () => {
        const H = createOrganismHelpers(config, storage);
        const out = await H.publishDraftsBatch(ORG, WS, 'crm.campaigns', ['b1', 'b2'], OWNER, undefined, {
            b1: { value: { id: 'b1' } }, b2: { value: { id: 'b2' } },
        }) as { results: unknown[]; refusal?: { status: number; code: string } };
        expect(out.refusal?.code).toBe('UNDECLARED_SPACE');
        expect(out.results).toHaveLength(0);
        expect(await copiesOf(`${root()}.crm.campaigns.b1.latest`)).toHaveLength(0);
    });

    it('revertToDraft writes a draft, so a record published into an undeclared space cannot be reopened there', async () => {
        const H = createOrganismHelpers(config, storage);
        const base = `${root()}.crm.campaigns.r1`;
        await put(`${base}.latest`, OWNER, { id: 'r1' });
        const out = await H.revertToDraft(ORG, WS, 'crm.campaigns', 'r1', OWNER);
        expect(out.ok ? 'reopened' : out.code).toBe('UNDECLARED_SPACE');
        expect(await copiesOf(`${base}.draft`)).toHaveLength(0);
    });

    it('positive control: a declared space still publishes, singly and in a batch', async () => {
        const H = createOrganismHelpers(config, storage);
        await put(`${root()}.crm.contacts.p2.draft`, OWNER, { id: 'p2' });
        const one = await H.publishDraft(ORG, WS, 'crm.contacts', 'p2', OWNER, null);
        expect(one.ok).toBe(true);
        expect(await copiesOf(`${root()}.crm.contacts.p2.latest`)).toHaveLength(1);
        const many = await H.publishDraftsBatch(ORG, WS, 'crm.contacts', ['p3'], OWNER, undefined, { p3: { value: { id: 'p3' } } }) as { results: Array<{ ok: boolean }>; refusal?: unknown };
        expect(many.refusal).toBeUndefined();
        expect(many.results.every(r => r.ok)).toBe(true);
    });
});

describe('the decision itself (undeclaredSpaceRefusal and its key form)', () => {
    const types = [
        { name: 'contact', namespace: 'crm.contacts', mode: 'records', backing: 'memory' },
        { name: 'log', namespace: 'crm.log', mode: 'records', backing: 'rows' },
    ];
    const ctx = { organismId: ORG, ws: WS };

    it('a key matches by namespace only: a namespace equal to a space NAME is not that space', () => {
        // The workspace read lists `crm.contacts.*`; a record at `contact.*` is listed by nothing.
        expect(undeclaredSpaceRefusal('contact', types, ctx)?.code).toBe('UNDECLARED_SPACE');
        expect(undeclaredSpaceRefusal('crm.contacts', types, ctx)).toBeNull();
        // A tool that names a space may use either.
        expect(undeclaredSpaceRefusal('contact', types, { ...ctx, acceptName: true })).toBeNull();
    });

    it('a row space is refused with the way to append rows instead', () => {
        const r = undeclaredSpaceRefusal('crm.log', types, ctx);
        expect(r?.code).toBe('UNDECLARED_SPACE');
        expect(r?.details.backing).toBe('rows');
        expect(r?.message).toContain('aimeat_workspace_rows_append');
    });

    it('the public wording names neither the namespace nor what the workspace declares', () => {
        const r = undeclaredSpaceRefusal('crm.leads', types, { ...ctx, audience: 'public' });
        expect(r?.status).toBe(422);
        expect(r?.message).not.toContain('crm.leads');
        expect(r?.message).not.toContain('crm.contacts');
        expect(r?.details.namespace).toBeUndefined();
    });

    it('the member wording names the namespace, the declared spaces and the route and tool that declare one', () => {
        const r = undeclaredSpaceRefusal('crm.leads', types, ctx);
        expect(r?.message).toContain('"crm.leads"');
        expect(r?.message).toContain('contact (crm.contacts)');
        expect(r?.message).toContain(`PUT /v1/organisms/${ORG}/workspace?ws=${WS}`);
        expect(r?.message).toContain('aimeat_workspace_update');
        expect(r?.details.declared_spaces).toEqual([{ name: 'contact', namespace: 'crm.contacts' }]);
    });

    it('isPlatformWorkspaceNamespace: meta, skills and access and nothing that only starts with the same letters', () => {
        for (const ns of ['meta', 'meta.sections', 'skills', 'skills.crm-guide.files', 'access', 'access.request']) {
            expect(isPlatformWorkspaceNamespace(ns), ns).toBe(true);
        }
        for (const ns of ['metadata', 'skillset', 'accessibility.notes', 'crm.meta', 'crm.skills']) {
            expect(isPlatformWorkspaceNamespace(ns), ns).toBe(false);
        }
    });

    it('undeclaredSpaceForKey: skills and access keys shaped like records are exempt, a record is not', async () => {
        for (const key of [
            `${root()}.skills.crm-guide.files.notes.draft`,
            `${root()}.skills.crm-guide.files.refs.version.3`,
            `${root()}.skills.latest.files.x.latest`,
            `${root()}.access.request.draft`,
        ]) {
            expect(await undeclaredSpaceForKey(storage, key), key).toBeNull();
        }
        expect((await undeclaredSpaceForKey(storage, `${root()}.crm.campaigns.k1.latest`))?.code).toBe('UNDECLARED_SPACE');
        // Not a workspace record at all: no `.w.`, or no record role at the end.
        expect(await undeclaredSpaceForKey(storage, `organism.${ORG}.crm.campaigns.k1.draft`)).toBeNull();
        expect(await undeclaredSpaceForKey(storage, `${root()}.crm.campaigns.rows`)).toBeNull();
    });
});
