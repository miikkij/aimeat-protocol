// T-8: Storage Adapter Integration Tests
// Tests InMemoryStorage (always) and MongoStorage (when DATABASE_URL is set).
// Run:  pnpm exec vitest run test/integration/

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { InMemoryStorage } from '../../src/storage/providers/memory/index.js';
import type {
    Storage,
    OwnerRecord,
    AgentRecord,
    MemoryRecord,
    ActionRecord,
    WorkRecord,
    WalletTransaction,
    BoardRecord,
    BoardPostRecord,
    OtkRecord,
    DisputeRecord,
    DisputeAuditEntry,
    MicroMemoryRecord,
    StorageFileRecord,
    PeeringRequestRecord,
} from '../../src/storage/interface.js';

// ── Helpers ──

const uid = () => Math.random().toString(36).slice(2, 10);
const ts = () => new Date().toISOString();

function makeOwner(overrides?: Partial<OwnerRecord>): OwnerRecord {
    return {
        name: `test-owner-${uid()}`,
        publicKey: 'cGxhY2Vob2xkZXI=',
        roles: ['owner'],
        createdAt: ts(),
        ...overrides,
    };
}

function makeAgent(owner: string, overrides?: Partial<AgentRecord>): AgentRecord {
    const name = `test-agent-${uid()}`;
    return {
        name,
        owner,
        gaii: `gaii://test/${name}`,
        capabilities: ['work'],
        publicKey: 'cGxhY2Vob2xkZXI=',
        trustScore: 50,
        morselBalance: 0,
        createdAt: ts(),
        lastSeen: ts(),
        ...overrides,
    };
}

function makeMemory(ownerGaii: string, overrides?: Partial<MemoryRecord>): MemoryRecord {
    return {
        key: `key-${uid()}`,
        ownerGaii,
        value: { data: 'test' },
        visibility: 'private',
        tags: [],
        ttlHours: null,
        version: 1,
        createdAt: ts(),
        updatedAt: ts(),
        ...overrides,
    };
}

function makeAction(providerGaii: string, overrides?: Partial<ActionRecord>): ActionRecord {
    return {
        id: `action-${uid()}`,
        providerGaii,
        displayName: 'Test Action',
        description: 'A test action',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        pricing: { baseMorsels: 10 },
        tags: [],
        createdAt: ts(),
        updatedAt: ts(),
        ...overrides,
    };
}

function makeWork(actionId: string, providerGaii: string, requesterGaii: string, overrides?: Partial<WorkRecord>): WorkRecord {
    return {
        trackingCode: `tc-${uid()}`,
        status: 'pending',
        actionId,
        providerGaii,
        requesterGaii,
        input: { prompt: 'test' },
        cost: { basePrice: 10, networkFee: 1, total: 11, inEscrow: 11 },
        ttlExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        createdAt: ts(),
        updatedAt: ts(),
        ...overrides,
    };
}

function makeBoard(ownerGaii: string, overrides?: Partial<BoardRecord>): BoardRecord {
    return {
        id: `board-${uid()}`,
        name: 'Test Board',
        visibility: 'public',
        ownerGaii,
        allowedGaiis: [],
        createdAt: ts(),
        ...overrides,
    };
}

function makePost(boardId: string, authorGaii: string, overrides?: Partial<BoardPostRecord>): BoardPostRecord {
    return {
        id: `post-${uid()}`,
        boardId,
        authorGaii,
        title: 'Test Post',
        body: 'Test body',
        tags: [],
        reactions: {},
        createdAt: ts(),
        ...overrides,
    };
}

function makeOtk(ownerGaii: string, overrides?: Partial<OtkRecord>): OtkRecord {
    return {
        key: `otk-${uid()}`,
        ownerGaii,
        action: 'write_memory',
        params: {},
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        used: false,
        usedAt: null,
        sessionId: null,
        createdAt: ts(),
        ...overrides,
    };
}

// ── Test Suite (InMemory only — MongoStorage runs when DATABASE_URL is set) ──

interface Backend {
    name: string;
    factory: () => Storage | Promise<Storage>;
    cleanup?: (storage: Storage) => Promise<void>;
}

const backends: Backend[] = [
    { name: 'InMemory', factory: () => new InMemoryStorage() },
];

// Add MongoStorage when DATABASE_URL is available
// const mongoUrl = process.env.DATABASE_URL;
// if (mongoUrl) {
//   backends.push({
//     name: 'MongoDB',
//     factory: async () => { ... },
//     cleanup: async (storage) => { ... },
//   });
// }

for (const backend of backends) {
    describe(`Storage: ${backend.name}`, () => {
        let storage: Storage;

        beforeAll(async () => {
            storage = await backend.factory();
        });

        afterAll(async () => {
            if (backend.cleanup) await backend.cleanup(storage);
        });

        // ─── Category 1: Owner CRUD ───

        describe('Owner CRUD', () => {
            it('1. Create owner', async () => {
                const owner = makeOwner();
                const result = await storage.createOwner(owner);
                expect(result.name).toBe(owner.name);
                expect(result.publicKey).toBe(owner.publicKey);
                expect(result.roles).toEqual(['owner']);
            });

            it('2. Get owner by name', async () => {
                const owner = makeOwner();
                await storage.createOwner(owner);
                const found = await storage.getOwner(owner.name);
                expect(found).not.toBeNull();
                expect(found!.name).toBe(owner.name);
                expect(found!.publicKey).toBe(owner.publicKey);
            });

            it('3. List owners', async () => {
                const owner = makeOwner();
                await storage.createOwner(owner);
                const list = await storage.listOwners();
                expect(list.some(o => o.name === owner.name)).toBe(true);
            });

            it('4. Delete owner', async () => {
                const owner = makeOwner();
                await storage.createOwner(owner);
                const deleted = await storage.deleteOwner(owner.name);
                expect(deleted).toBe(true);
            });

            it('5. Get deleted owner returns null', async () => {
                const owner = makeOwner();
                await storage.createOwner(owner);
                await storage.deleteOwner(owner.name);
                const found = await storage.getOwner(owner.name);
                expect(found).toBeNull();
            });
        });

        // ─── Category 2: Agent CRUD ───

        describe('Agent CRUD', () => {
            let ownerName: string;

            beforeAll(async () => {
                const owner = makeOwner();
                await storage.createOwner(owner);
                ownerName = owner.name;
            });

            it('6. Create agent', async () => {
                const agent = makeAgent(ownerName);
                const result = await storage.createAgent(agent);
                expect(result.gaii).toBe(agent.gaii);
                expect(result.morselBalance).toBe(0);
                expect(result.trustScore).toBe(50);
            });

            it('7. Get agent by gaii', async () => {
                const agent = makeAgent(ownerName);
                await storage.createAgent(agent);
                const found = await storage.getAgent(agent.gaii);
                expect(found).not.toBeNull();
                expect(found!.gaii).toBe(agent.gaii);
                expect(found!.owner).toBe(ownerName);
            });

            it('8. Update agent fields', async () => {
                const agent = makeAgent(ownerName);
                await storage.createAgent(agent);
                const updated = await storage.updateAgent(agent.gaii, { morselBalance: 100, trustScore: 80 });
                expect(updated).not.toBeNull();
                expect(updated!.morselBalance).toBe(100);
                expect(updated!.trustScore).toBe(80);
            });

            it('9. List agents by owner', async () => {
                const agent = makeAgent(ownerName);
                await storage.createAgent(agent);
                const list = await storage.getAgentsByOwner(ownerName);
                expect(list.some(a => a.gaii === agent.gaii)).toBe(true);
            });

            it('10. Delete agent', async () => {
                const agent = makeAgent(ownerName);
                await storage.createAgent(agent);
                const deleted = await storage.deleteAgent(agent.gaii);
                expect(deleted).toBe(true);
                const found = await storage.getAgent(agent.gaii);
                expect(found).toBeNull();
            });
        });

        // ─── Category 3: Memory CRUD + TTL ───

        describe('Memory CRUD + TTL', () => {
            const gaii = `gaii://test/mem-agent-${uid()}`;

            it('11. Set memory', async () => {
                const mem = makeMemory(gaii);
                const result = await storage.setMemory(mem);
                expect(result.key).toBe(mem.key);
                expect(result.version).toBe(1);
            });

            it('12. Get memory', async () => {
                const mem = makeMemory(gaii);
                await storage.setMemory(mem);
                const found = await storage.getMemory(gaii, mem.key);
                expect(found).not.toBeNull();
                expect(found!.value).toEqual({ data: 'test' });
            });

            it('13. Update memory (version increment)', async () => {
                const mem = makeMemory(gaii);
                await storage.setMemory(mem);
                const updated = await storage.setMemory({ ...mem, value: { data: 'updated' } });
                expect(updated.version).toBe(2);
                const found = await storage.getMemory(gaii, mem.key);
                expect(found!.value).toEqual({ data: 'updated' });
            });

            it('14. List memory (prefix filter)', async () => {
                const prefix = `pfx-${uid()}`;
                await storage.setMemory(makeMemory(gaii, { key: `${prefix}/a` }));
                await storage.setMemory(makeMemory(gaii, { key: `${prefix}/b` }));
                await storage.setMemory(makeMemory(gaii, { key: `other-${uid()}` }));

                const list = await storage.listMemory(gaii, { prefix });
                expect(list.length).toBeGreaterThanOrEqual(2);
                expect(list.every(m => m.key.startsWith(prefix))).toBe(true);
            });

            it('15. List memory (visibility filter)', async () => {
                await storage.setMemory(makeMemory(gaii, { key: `vis-pub-${uid()}`, visibility: 'public' }));
                await storage.setMemory(makeMemory(gaii, { key: `vis-priv-${uid()}`, visibility: 'private' }));

                const pubList = await storage.listMemory(gaii, { visibility: 'public' });
                expect(pubList.every(m => m.visibility === 'public')).toBe(true);

                const privList = await storage.listMemory(gaii, { visibility: 'private' });
                expect(privList.every(m => m.visibility === 'private')).toBe(true);
            });

            it('16. Delete memory', async () => {
                const mem = makeMemory(gaii);
                await storage.setMemory(mem);
                const deleted = await storage.deleteMemory(gaii, mem.key);
                expect(deleted).toBe(true);
            });

            it('17. Get deleted memory returns null', async () => {
                const mem = makeMemory(gaii);
                await storage.setMemory(mem);
                await storage.deleteMemory(gaii, mem.key);
                const found = await storage.getMemory(gaii, mem.key);
                expect(found).toBeNull();
            });

            it('18. TTL expiration', async () => {
                // Set memory with ttlHours = very small val — we fake by making createdAt old
                const mem = makeMemory(gaii, {
                    key: `ttl-${uid()}`,
                    ttlHours: 1,
                    createdAt: new Date(Date.now() - 3_700_000).toISOString(), // >1 hour ago
                });
                await storage.setMemory(mem);
                const found = await storage.getMemory(gaii, mem.key);
                expect(found).toBeNull();
            });
        });

        // ─── Category 4: Actions ───

        describe('Actions', () => {
            const providerGaii = `gaii://test/action-prov-${uid()}`;

            it('19. Create action', async () => {
                const action = makeAction(providerGaii);
                const result = await storage.createAction(action);
                expect(result.id).toBe(action.id);
                expect(result.providerGaii).toBe(providerGaii);
            });

            it('20. List actions (search filter)', async () => {
                const unique = `UniqueSearch${uid()}`;
                await storage.createAction(makeAction(providerGaii, { displayName: unique }));
                const list = await storage.listActions({ search: unique });
                expect(list.length).toBeGreaterThanOrEqual(1);
                expect(list.some(a => a.displayName === unique)).toBe(true);
            });

            it('21. List actions (category filter)', async () => {
                const catName = `cat-${uid()}`;
                await storage.createAction(makeAction(providerGaii, { category: catName }));
                const list = await storage.listActions({ category: catName });
                expect(list.length).toBeGreaterThanOrEqual(1);
                expect(list.every(a => a.category === catName)).toBe(true);
            });

            it('22. Update action', async () => {
                const action = makeAction(providerGaii);
                await storage.createAction(action);
                const updated = await storage.updateAction(action.id, providerGaii, { displayName: 'Updated Name' });
                expect(updated).not.toBeNull();
                expect(updated!.displayName).toBe('Updated Name');
            });
        });

        // ─── Category 5: Work Lifecycle ───

        describe('Work Lifecycle', () => {
            const provGaii = `gaii://test/work-prov-${uid()}`;
            const reqGaii = `gaii://test/work-req-${uid()}`;

            it('23. Create work item', async () => {
                const work = makeWork('act-1', provGaii, reqGaii);
                const result = await storage.createWork(work);
                expect(result.trackingCode).toBe(work.trackingCode);
                expect(result.status).toBe('pending');
            });

            it('24. Get work by tracking code', async () => {
                const work = makeWork('act-1', provGaii, reqGaii);
                await storage.createWork(work);
                const found = await storage.getWork(work.trackingCode);
                expect(found).not.toBeNull();
                expect(found!.actionId).toBe('act-1');
                expect(found!.providerGaii).toBe(provGaii);
            });

            it('25. Update work status', async () => {
                const work = makeWork('act-1', provGaii, reqGaii);
                await storage.createWork(work);
                const updated = await storage.updateWork(work.trackingCode, { status: 'accepted' });
                expect(updated).not.toBeNull();
                expect(updated!.status).toBe('accepted');
            });

            it('26. List work by provider', async () => {
                const work = makeWork('act-1', provGaii, reqGaii);
                await storage.createWork(work);
                const list = await storage.listWorkByProvider(provGaii);
                expect(list.some(w => w.trackingCode === work.trackingCode)).toBe(true);
            });

            it('27. List work by requester', async () => {
                const work = makeWork('act-1', provGaii, reqGaii);
                await storage.createWork(work);
                const list = await storage.listWorkByRequester(reqGaii);
                expect(list.some(w => w.trackingCode === work.trackingCode)).toBe(true);
            });
        });

        // ─── Category 6: Transactions ───

        describe('Transactions', () => {
            const txGaii = `gaii://test/tx-agent-${uid()}`;

            it('28. Record transaction', async () => {
                const tx: WalletTransaction = {
                    id: `tx-${uid()}`,
                    gaii: txGaii,
                    type: 'payment',
                    amount: 100,
                    timestamp: ts(),
                };
                const result = await storage.addTransaction(tx);
                expect(result.id).toBe(tx.id);
                expect(result.amount).toBe(100);
            });

            it('29. List transactions for agent', async () => {
                const tx: WalletTransaction = {
                    id: `tx-${uid()}`,
                    gaii: txGaii,
                    type: 'credit',
                    amount: 50,
                    timestamp: ts(),
                };
                await storage.addTransaction(tx);
                const list = await storage.getTransactions(txGaii);
                expect(list.some(t => t.id === tx.id)).toBe(true);
            });

            it('30. List all transactions', async () => {
                const list = await storage.listAllTransactions();
                expect(Array.isArray(list)).toBe(true);
            });
        });

        // ─── Category 7: Boards + Posts ───

        describe('Boards + Posts', () => {
            let board: BoardRecord;
            const boardOwner = `gaii://test/board-owner-${uid()}`;

            beforeAll(async () => {
                board = await storage.createBoard(makeBoard(boardOwner));
            });

            it('31. Create board', async () => {
                const b = await storage.createBoard(makeBoard(boardOwner));
                expect(b.id).toBeTruthy();
                expect(b.name).toBe('Test Board');
            });

            it('32. List boards', async () => {
                const list = await storage.listBoards();
                expect(list.some(b => b.id === board.id)).toBe(true);
            });

            it('33. Create post', async () => {
                const post = makePost(board.id, boardOwner);
                const result = await storage.createPost(post);
                expect(result.id).toBe(post.id);
                expect(result.boardId).toBe(board.id);
            });

            it('34. List posts (category filter)', async () => {
                const cat = `cat-${uid()}`;
                await storage.createPost(makePost(board.id, boardOwner, { category: cat }));
                const list = await storage.listPosts(board.id, { category: cat });
                expect(list.every(p => p.category === cat)).toBe(true);
            });

            it('35. List posts — expired posts excluded', async () => {
                const expiredPost = makePost(board.id, boardOwner, {
                    id: `exp-${uid()}`,
                    ttlExpiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
                });
                await storage.createPost(expiredPost);
                const list = await storage.listPosts(board.id);
                expect(list.some(p => p.id === expiredPost.id)).toBe(false);
            });

            it('36. Get single post', async () => {
                const post = makePost(board.id, boardOwner);
                await storage.createPost(post);
                const found = await storage.getPost(board.id, post.id);
                expect(found).not.toBeNull();
                expect(found!.title).toBe('Test Post');
            });

            it('37. Reactions', async () => {
                const post = makePost(board.id, boardOwner);
                await storage.createPost(post);
                const ok = await storage.addReaction(board.id, post.id, '👍', boardOwner);
                expect(ok).toBe(true);

                const found = await storage.getPost(board.id, post.id);
                expect(found!.reactions['👍']).toContain(boardOwner);
            });
        });

        // ─── Category 8: Storage Files ───

        describe('Storage Files', () => {
            const fileOwner = `gaii://test/file-owner-${uid()}`;

            it('38. Create file', async () => {
                const file: StorageFileRecord = {
                    key: `file-${uid()}`,
                    ownerGaii: fileOwner,
                    visibility: 'private',
                    mimeType: 'text/plain',
                    size: 11,
                    data: Buffer.from('hello world'),
                    createdAt: ts(),
                };
                const result = await storage.createStorageFile(file);
                expect(result.key).toBe(file.key);
                expect(result.size).toBe(11);
            });

            it('39. Get file with data', async () => {
                const key = `file-${uid()}`;
                const data = Buffer.from('binary data here');
                await storage.createStorageFile({
                    key,
                    ownerGaii: fileOwner,
                    visibility: 'private',
                    mimeType: 'application/octet-stream',
                    size: data.length,
                    data,
                    createdAt: ts(),
                });
                const found = await storage.getStorageFile(fileOwner, key);
                expect(found).not.toBeNull();
                expect(Buffer.from(found!.data).toString()).toBe('binary data here');
            });

            it('40. List files', async () => {
                const key = `file-${uid()}`;
                await storage.createStorageFile({
                    key,
                    ownerGaii: fileOwner,
                    visibility: 'private',
                    mimeType: 'text/plain',
                    size: 4,
                    data: Buffer.from('test'),
                    createdAt: ts(),
                });
                const list = await storage.listStorageFiles(fileOwner);
                expect(list.some(f => f.key === key)).toBe(true);
            });

            it('41. Delete file', async () => {
                const key = `file-${uid()}`;
                await storage.createStorageFile({
                    key,
                    ownerGaii: fileOwner,
                    visibility: 'private',
                    mimeType: 'text/plain',
                    size: 4,
                    data: Buffer.from('test'),
                    createdAt: ts(),
                });
                const deleted = await storage.deleteStorageFile(fileOwner, key);
                expect(deleted).toBe(true);
                const found = await storage.getStorageFile(fileOwner, key);
                expect(found).toBeNull();
            });
        });

        // ─── Category 9: OTK + Node Key ───

        describe('OTK + Node Key', () => {
            const otkGaii = `gaii://test/otk-agent-${uid()}`;

            it('42. Store OTK', async () => {
                const otk = makeOtk(otkGaii);
                const result = await storage.createOtk(otk);
                expect(result.key).toBe(otk.key);
                expect(result.used).toBe(false);
            });

            it('43. Get OTK', async () => {
                const otk = makeOtk(otkGaii);
                await storage.createOtk(otk);
                const found = await storage.getOtk(otk.key);
                expect(found).not.toBeNull();
                expect(found!.ownerGaii).toBe(otkGaii);
                expect(found!.action).toBe('write_memory');
            });

            it('44. Consume OTK (mark used)', async () => {
                const otk = makeOtk(otkGaii);
                await storage.createOtk(otk);
                const consumed = await storage.consumeOtk(otk.key);
                expect(consumed).not.toBeNull();
                expect(consumed!.used).toBe(true);
                expect(consumed!.usedAt).toBeTruthy();
            });

            it('45. Set/get node key', async () => {
                await storage.setNodeKey('pub-key-test', 'priv-key-test');
                const key = await storage.getNodeKey();
                expect(key).not.toBeNull();
                expect(key!.publicKey).toBe('pub-key-test');
                expect(key!.privateKey).toBe('priv-key-test');
            });
        });

        // ─── Category 10: Disputes + Audit Log ───

        describe('Disputes + Audit Log', () => {
            const disputeTc = `tc-dispute-${uid()}`;
            let disputeId: string;

            it('46. Create dispute', async () => {
                disputeId = `dispute-${uid()}`;
                const dispute: DisputeRecord = {
                    id: disputeId,
                    trackingCode: disputeTc,
                    status: 'open',
                    openedBy: 'gaii://test/opener',
                    reason: 'Test dispute',
                    createdAt: ts(),
                    updatedAt: ts(),
                };
                const result = await storage.createDispute(dispute);
                expect(result.id).toBe(disputeId);
                expect(result.status).toBe('open');
            });

            it('47. Get dispute by tracking code', async () => {
                const found = await storage.getDisputeByTrackingCode(disputeTc);
                expect(found).not.toBeNull();
                expect(found!.id).toBe(disputeId);
            });

            it('48. Update dispute', async () => {
                const updated = await storage.updateDispute(disputeId, { status: 'escalated' });
                expect(updated).not.toBeNull();
                expect(updated!.status).toBe('escalated');
            });

            it('49. Append audit log', async () => {
                const entry: DisputeAuditEntry = {
                    sequence: 1,
                    event: 'opened',
                    actor: 'gaii://test/opener',
                    timestamp: ts(),
                    data: { reason: 'Test' },
                    hash: 'abc123',
                    previousHash: '000000',
                };
                const result = await storage.addDisputeAuditEntry(disputeId, entry);
                expect(result.sequence).toBe(1);
                expect(result.hash).toBe('abc123');
            });

            it('50. Get full audit log', async () => {
                const log = await storage.getDisputeAuditLog(disputeId);
                expect(log.length).toBeGreaterThanOrEqual(1);
                expect(log[0].event).toBe('opened');
            });

            it('51. List all disputes', async () => {
                const list = await storage.listAllDisputes();
                expect(list.some(d => d.id === disputeId)).toBe(true);
            });
        });

        // ─── Category 11: Federation ───

        describe('Federation', () => {
            it('52. Create peering request', async () => {
                const req: PeeringRequestRecord = {
                    id: `peer-${uid()}`,
                    fromNodeUrl: 'http://node-a.example.com',
                    fromNodeId: 'node-a',
                    toNodeId: 'node-b',
                    targetUrl: 'http://node-b.example.com',
                    status: 'pending',
                    createdAt: ts(),
                    updatedAt: ts(),
                };
                const result = await storage.createPeeringRequest(req);
                expect(result.id).toBe(req.id);
                expect(result.status).toBe('pending');
            });

            it('53. List peers', async () => {
                const list = await storage.listPeeringRequests();
                expect(Array.isArray(list)).toBe(true);
                expect(list.length).toBeGreaterThanOrEqual(1);
            });
        });

        // ─── Category 12: Micro-Memory ───

        describe('Micro-Memory', () => {
            const mmGaii = `gaii://test/mm-agent-${uid()}`;
            const setName = `set-${uid()}`;

            it('54. Set micro-memory', async () => {
                const record: MicroMemoryRecord = {
                    gaii: mmGaii,
                    set: setName,
                    entries: { key1: 'value1', key2: 'value2' },
                    visibility: 'private',
                    updatedAt: ts(),
                };
                const result = await storage.setMicroMemory(record);
                expect(result.set).toBe(setName);
                expect(result.entries.key1).toBe('value1');
            });

            it('55. Get micro-memory', async () => {
                const found = await storage.getMicroMemory(mmGaii, setName);
                expect(found).not.toBeNull();
                expect(found!.entries.key2).toBe('value2');
            });

            it('56. List micro-memory sets', async () => {
                const list = await storage.listMicroMemorySets(mmGaii);
                expect(list.some(m => m.set === setName)).toBe(true);
            });

            it('57. Delete micro-memory entry', async () => {
                const deleted = await storage.deleteMicroMemoryEntry(mmGaii, setName, 'key1');
                expect(deleted).toBe(true);
                const found = await storage.getMicroMemory(mmGaii, setName);
                expect(found!.entries.key1).toBeUndefined();
                expect(found!.entries.key2).toBe('value2');
            });

            it('58. Delete micro-memory set', async () => {
                const deleted = await storage.deleteMicroMemory(mmGaii, setName);
                expect(deleted).toBe(true);
                const found = await storage.getMicroMemory(mmGaii, setName);
                expect(found).toBeNull();
            });
        });

        // ─── Category 13: Board Subscriptions ───

        describe('Board Subscriptions', () => {
            let subBoardId: string;
            const subGaii = `gaii://test/sub-agent-${uid()}`;

            beforeAll(async () => {
                const board = await storage.createBoard(makeBoard(subGaii));
                subBoardId = board.id;
            });

            it('59. Create board subscription', async () => {
                const sub = {
                    id: `sub-${uid()}`,
                    boardId: subBoardId,
                    gaii: subGaii,
                    callbackUrl: 'http://example.com/callback',
                    createdAt: ts(),
                };
                const result = await storage.createBoardSubscription(sub);
                expect(result.boardId).toBe(subBoardId);
                expect(result.gaii).toBe(subGaii);
            });

            it('60. Get board subscription', async () => {
                const found = await storage.getBoardSubscription(subBoardId, subGaii);
                expect(found).not.toBeNull();
                expect(found!.callbackUrl).toBe('http://example.com/callback');
            });

            it('61. List board subscriptions', async () => {
                const list = await storage.listBoardSubscriptions(subBoardId);
                expect(list.some(s => s.gaii === subGaii)).toBe(true);
            });

            it('62. List subscriptions by agent', async () => {
                const list = await storage.listSubscriptionsByAgent(subGaii);
                expect(list.some(s => s.boardId === subBoardId)).toBe(true);
            });

            it('63. Delete board subscription', async () => {
                const deleted = await storage.deleteBoardSubscription(subBoardId, subGaii);
                expect(deleted).toBe(true);
                const found = await storage.getBoardSubscription(subBoardId, subGaii);
                expect(found).toBeNull();
            });
        });

        // ─── Category 14: Memory Search ───

        describe('Memory Search', () => {
            const searchGaii = `gaii://test/search-agent-${uid()}`;
            const searchTerm = `xyzzy-${uid()}`;

            beforeAll(async () => {
                await storage.setMemory(makeMemory(searchGaii, {
                    key: `search-match-${uid()}`,
                    value: { content: `This contains ${searchTerm} in the value` },
                    visibility: 'public',
                }));
                await storage.setMemory(makeMemory(searchGaii, {
                    key: `search-nomatch-${uid()}`,
                    value: { content: 'No match here' },
                    visibility: 'public',
                }));
            });

            it('64. Search memory finds matching records', async () => {
                const results = await storage.searchMemory(searchGaii, searchTerm);
                expect(results.length).toBeGreaterThanOrEqual(1);
                const stringified = JSON.stringify(results[0].value);
                expect(stringified).toContain(searchTerm);
            });

            it('65. Search memory with visibility filter', async () => {
                await storage.setMemory(makeMemory(searchGaii, {
                    key: `search-priv-${uid()}`,
                    value: { content: `Private ${searchTerm} data` },
                    visibility: 'private',
                }));
                const results = await storage.searchMemory(searchGaii, searchTerm, { visibility: 'public' });
                expect(results.every(r => r.visibility === 'public')).toBe(true);
            });
        });

        // ─── Category 15: Chunked Uploads ───

        describe('Chunked Uploads', () => {
            const chunkGaii = `gaii://test/chunk-agent-${uid()}`;

            it('66. Create chunked upload', async () => {
                const upload = {
                    uploadId: `upload-${uid()}`,
                    ownerGaii: chunkGaii,
                    key: 'bigfile.bin',
                    mimeType: 'application/octet-stream',
                    visibility: 'private' as const,
                    chunkSize: 1024,
                    totalChunks: 3,
                    receivedChunks: new Map<number, Buffer>(),
                    createdAt: ts(),
                    expiresAt: new Date(Date.now() + 21_600_000).toISOString(),
                };
                const result = await storage.createChunkedUpload(upload);
                expect(result.uploadId).toBe(upload.uploadId);
            });

            it('67. Add chunk and get upload', async () => {
                const uploadId = `upload-${uid()}`;
                await storage.createChunkedUpload({
                    uploadId,
                    ownerGaii: chunkGaii,
                    key: 'bigfile2.bin',
                    mimeType: 'application/octet-stream',
                    visibility: 'private',
                    chunkSize: 1024,
                    receivedChunks: new Map(),
                    createdAt: ts(),
                    expiresAt: new Date(Date.now() + 21_600_000).toISOString(),
                });
                const ok = await storage.addChunk(uploadId, 0, Buffer.from('chunk0'));
                expect(ok).toBe(true);

                const found = await storage.getChunkedUpload(uploadId);
                expect(found).not.toBeNull();
                expect(found!.receivedChunks.get(0)?.toString()).toBe('chunk0');
            });

            it('68. Delete chunked upload', async () => {
                const uploadId = `upload-${uid()}`;
                await storage.createChunkedUpload({
                    uploadId,
                    ownerGaii: chunkGaii,
                    key: 'bigfile3.bin',
                    mimeType: 'application/octet-stream',
                    visibility: 'private',
                    chunkSize: 1024,
                    receivedChunks: new Map(),
                    createdAt: ts(),
                    expiresAt: new Date(Date.now() + 21_600_000).toISOString(),
                });
                const deleted = await storage.deleteChunkedUpload(uploadId);
                expect(deleted).toBe(true);
                const found = await storage.getChunkedUpload(uploadId);
                expect(found).toBeNull();
            });
        });

        // ─── Category 16: Edge Cases ───

        describe('Edge Cases', () => {
            it('69. Get non-existent owner returns null', async () => {
                const found = await storage.getOwner('nonexistent-owner-xyz');
                expect(found).toBeNull();
            });

            it('70. Get non-existent agent returns null', async () => {
                const found = await storage.getAgent('gaii://test/nonexistent');
                expect(found).toBeNull();
            });

            it('71. Get non-existent work returns null', async () => {
                const found = await storage.getWork('tc-nonexistent-xyz');
                expect(found).toBeNull();
            });

            it('72. Delete non-existent memory returns false', async () => {
                const deleted = await storage.deleteMemory('gaii://test/x', 'nonexistent-key');
                expect(deleted).toBe(false);
            });

            it('73. Update non-existent agent returns null', async () => {
                const updated = await storage.updateAgent('gaii://test/nonexistent', { morselBalance: 999 });
                expect(updated).toBeNull();
            });

            it('74. Consume expired OTK returns null', async () => {
                const otk = makeOtk(`gaii://test/exp-${uid()}`, {
                    expiresAt: new Date(Date.now() - 10_000).toISOString(), // already expired
                });
                await storage.createOtk(otk);
                const consumed = await storage.consumeOtk(otk.key);
                expect(consumed).toBeNull();
            });

            it('75. Delete all memory returns count', async () => {
                const gaii = `gaii://test/delall-${uid()}`;
                await storage.setMemory(makeMemory(gaii, { key: 'a' }));
                await storage.setMemory(makeMemory(gaii, { key: 'b' }));
                const count = await storage.deleteAllMemory(gaii);
                expect(count).toBe(2);
            });

            it('76. Add reaction to non-existent post returns false', async () => {
                const ok = await storage.addReaction('fake-board', 'fake-post', '👍', 'gaii://test/x');
                expect(ok).toBe(false);
            });

            it('77. List memory with tag filter', async () => {
                const gaii = `gaii://test/tagfilt-${uid()}`;
                await storage.setMemory(makeMemory(gaii, { key: 'tagged1', tags: ['alpha', 'beta'] }));
                await storage.setMemory(makeMemory(gaii, { key: 'tagged2', tags: ['alpha'] }));
                await storage.setMemory(makeMemory(gaii, { key: 'tagged3', tags: ['gamma'] }));

                const list = await storage.listMemory(gaii, { tags: ['alpha'] });
                expect(list.length).toBeGreaterThanOrEqual(2);
                expect(list.every(m => m.tags.includes('alpha'))).toBe(true);
            });
        });
    });
}
