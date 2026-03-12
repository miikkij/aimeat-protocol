/**
 * Safety-net tests for the SQLite storage layer.
 *
 * These tests prove every major storage method works correctly BEFORE
 * we refactor the 4,535-line sqlite/index.ts file. They exercise the
 * Storage interface through SqliteStorage with an in-memory database.
 *
 * Domains covered:
 *   1. Owner CRUD
 *   2. Agent CRUD
 *   3. Memory CRUD
 *   4. Work queue
 *   5. Board + Posts
 *   6. Consent
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type {
  OwnerRecord, AgentRecord, MemoryRecord, WorkRecord,
  BoardRecord, BoardPostRecord, ConsentRecord,
} from '../../src/storage/interface.js';

// ── Helpers ──────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function now(): string {
  return new Date().toISOString();
}

function makeOwner(overrides?: Partial<OwnerRecord>): OwnerRecord {
  const id = uid();
  return {
    name: `owner-${id}`,
    displayName: `Owner ${id}`,
    publicKey: `pk-${id}`,
    roles: ['owner'],
    createdAt: now(),
    ...overrides,
  };
}

function makeAgent(ownerName: string, overrides?: Partial<AgentRecord>): AgentRecord {
  const id = uid();
  return {
    name: `agent-${id}`,
    owner: ownerName,
    gaii: `agent-${id}@test-node`,
    displayName: `Agent ${id}`,
    description: 'A test agent',
    capabilities: ['memory', 'actions'],
    publicKey: `pk-${id}`,
    trustScore: 50,
    morselBalance: 100,
    createdAt: now(),
    lastSeen: now(),
    ...overrides,
  };
}

function makeMemory(ownerGaii: string, overrides?: Partial<MemoryRecord>): MemoryRecord {
  const id = uid();
  return {
    key: `test.${id}`,
    ownerGaii,
    value: { hello: 'world', id },
    visibility: 'private',
    tags: ['test', 'safety-net'],
    ttlHours: null,
    version: 1,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function makeWork(providerGaii: string, requesterGaii: string, overrides?: Partial<WorkRecord>): WorkRecord {
  const id = uid();
  return {
    trackingCode: `wrk-${id}`,
    status: 'pending',
    actionId: `act-${id}`,
    providerGaii,
    requesterGaii,
    input: { prompt: 'test input' },
    cost: { basePrice: 10, networkFee: 1, total: 11, inEscrow: 11 },
    ttlExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function makeBoard(ownerGaii: string, overrides?: Partial<BoardRecord>): BoardRecord {
  const id = uid();
  return {
    id: `board-${id}`,
    name: `Board ${id}`,
    description: 'A test board',
    visibility: 'public',
    ownerGaii,
    allowedGaiis: [],
    createdAt: now(),
    ...overrides,
  };
}

function makePost(boardId: string, authorGaii: string, overrides?: Partial<BoardPostRecord>): BoardPostRecord {
  const id = uid();
  return {
    id: `post-${id}`,
    boardId,
    authorGaii,
    title: `Post ${id}`,
    body: `Body of post ${id}`,
    tags: ['test'],
    reactions: {},
    createdAt: now(),
    ...overrides,
  };
}

function makeConsent(ownerGaii: string, overrides?: Partial<ConsentRecord>): ConsentRecord {
  const id = uid();
  return {
    id: `consent-${id}`,
    ownerGaii,
    dataPattern: 'profile.*',
    recipient: '*',
    purpose: 'discovery',
    scope: 'private',
    expires: null,
    status: 'active',
    grantedAt: now(),
    revokedAt: null,
    ...overrides,
  };
}

// ── Test Suite ───────────────────────────────────────────────────────

let storage: SqliteStorage;

beforeEach(() => {
  // Use :memory: — dirname(':memory:') is '.' which exists already.
  // WAL mode silently falls back to another journal mode for :memory: dbs.
  storage = new SqliteStorage(':memory:');
});

afterEach(() => {
  storage.close();
});

// ═══════════════════════════════════════════════════════════════════
// 1. Owner CRUD
// ═══════════════════════════════════════════════════════════════════

describe('Owner CRUD', () => {
  it('creates and retrieves an owner', async () => {
    const owner = makeOwner();
    const created = await storage.createOwner(owner);
    expect(created.name).toBe(owner.name);

    const fetched = await storage.getOwner(owner.name);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe(owner.name);
    expect(fetched!.publicKey).toBe(owner.publicKey);
    expect(fetched!.roles).toEqual(['owner']);
  });

  it('lists owners', async () => {
    const o1 = makeOwner();
    const o2 = makeOwner();
    await storage.createOwner(o1);
    await storage.createOwner(o2);

    const list = await storage.listOwners();
    const names = list.map(o => o.name);
    expect(names).toContain(o1.name);
    expect(names).toContain(o2.name);
  });

  it('returns null for non-existent owner', async () => {
    const result = await storage.getOwner('no-such-owner');
    expect(result).toBeNull();
  });

  it('rejects duplicate owner names', async () => {
    const owner = makeOwner();
    await storage.createOwner(owner);
    await expect(storage.createOwner(owner)).rejects.toThrow('NAME_TAKEN');
  });

  it('updates an owner', async () => {
    const owner = makeOwner();
    await storage.createOwner(owner);

    const updated = await storage.updateOwner(owner.name, { displayName: 'New Name' });
    expect(updated).not.toBeNull();
    expect(updated!.displayName).toBe('New Name');

    const fetched = await storage.getOwner(owner.name);
    expect(fetched!.displayName).toBe('New Name');
  });

  it('deletes an owner', async () => {
    const owner = makeOwner();
    await storage.createOwner(owner);

    const deleted = await storage.deleteOwner(owner.name);
    expect(deleted).toBe(true);

    const fetched = await storage.getOwner(owner.name);
    expect(fetched).toBeNull();
  });

  it('returns false when deleting non-existent owner', async () => {
    const deleted = await storage.deleteOwner('no-such-owner');
    expect(deleted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Agent CRUD
// ═══════════════════════════════════════════════════════════════════

describe('Agent CRUD', () => {
  let ownerName: string;

  beforeEach(async () => {
    const owner = makeOwner();
    await storage.createOwner(owner);
    ownerName = owner.name;
  });

  it('creates and retrieves an agent', async () => {
    const agent = makeAgent(ownerName);
    const created = await storage.createAgent(agent);
    expect(created.gaii).toBe(agent.gaii);

    const fetched = await storage.getAgent(agent.gaii);
    expect(fetched).not.toBeNull();
    expect(fetched!.gaii).toBe(agent.gaii);
    expect(fetched!.name).toBe(agent.name);
    expect(fetched!.owner).toBe(ownerName);
    expect(fetched!.trustScore).toBe(50);
    expect(fetched!.morselBalance).toBe(100);
    expect(fetched!.capabilities).toEqual(['memory', 'actions']);
  });

  it('returns null for non-existent agent', async () => {
    const result = await storage.getAgent('no-such-gaii@test-node');
    expect(result).toBeNull();
  });

  it('lists agents by owner', async () => {
    const a1 = makeAgent(ownerName);
    const a2 = makeAgent(ownerName);
    await storage.createAgent(a1);
    await storage.createAgent(a2);

    const agents = await storage.getAgentsByOwner(ownerName);
    expect(agents.length).toBe(2);
    const gaiis = agents.map(a => a.gaii);
    expect(gaiis).toContain(a1.gaii);
    expect(gaiis).toContain(a2.gaii);
  });

  it('returns empty array when owner has no agents', async () => {
    const agents = await storage.getAgentsByOwner(ownerName);
    expect(agents).toEqual([]);
  });

  it('updates an agent', async () => {
    const agent = makeAgent(ownerName);
    await storage.createAgent(agent);

    const updated = await storage.updateAgent(agent.gaii, { displayName: 'Updated Agent' });
    expect(updated).not.toBeNull();
    expect(updated!.displayName).toBe('Updated Agent');
  });

  it('deletes an agent', async () => {
    const agent = makeAgent(ownerName);
    await storage.createAgent(agent);

    const deleted = await storage.deleteAgent(agent.gaii);
    expect(deleted).toBe(true);

    const fetched = await storage.getAgent(agent.gaii);
    expect(fetched).toBeNull();
  });

  it('returns false when deleting non-existent agent', async () => {
    const deleted = await storage.deleteAgent('no-such-gaii@test-node');
    expect(deleted).toBe(false);
  });

  it('lists all agents', async () => {
    const a1 = makeAgent(ownerName);
    const a2 = makeAgent(ownerName);
    await storage.createAgent(a1);
    await storage.createAgent(a2);

    const all = await storage.listAgents();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('cascade-deletes agents when owner is deleted', async () => {
    const agent = makeAgent(ownerName);
    await storage.createAgent(agent);

    await storage.deleteOwner(ownerName);

    const fetched = await storage.getAgent(agent.gaii);
    expect(fetched).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Memory CRUD
// ═══════════════════════════════════════════════════════════════════

describe('Memory CRUD', () => {
  const agentGaii = `mem-agent-${uid()}@test-node`;

  it('sets and retrieves a memory entry', async () => {
    const mem = makeMemory(agentGaii);
    await storage.setMemory(mem);

    const fetched = await storage.getMemory(agentGaii, mem.key);
    expect(fetched).not.toBeNull();
    expect(fetched!.key).toBe(mem.key);
    expect(fetched!.value).toEqual(mem.value);
    expect(fetched!.visibility).toBe('private');
    expect(fetched!.tags).toEqual(['test', 'safety-net']);
    expect(fetched!.version).toBe(1);
  });

  it('returns null for non-existent memory', async () => {
    const result = await storage.getMemory(agentGaii, 'no-such-key');
    expect(result).toBeNull();
  });

  it('increments version on update', async () => {
    const mem = makeMemory(agentGaii);
    await storage.setMemory(mem);

    const updated = { ...mem, value: { hello: 'updated' }, updatedAt: now() };
    await storage.setMemory(updated);

    const fetched = await storage.getMemory(agentGaii, mem.key);
    expect(fetched!.version).toBe(2);
    expect(fetched!.value).toEqual({ hello: 'updated' });
  });

  it('lists memory entries for an agent', async () => {
    const m1 = makeMemory(agentGaii, { key: `list.${uid()}` });
    const m2 = makeMemory(agentGaii, { key: `list.${uid()}` });
    await storage.setMemory(m1);
    await storage.setMemory(m2);

    const list = await storage.listMemory(agentGaii);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('lists memory with prefix filter', async () => {
    const prefix = `prefix-${uid()}`;
    const m1 = makeMemory(agentGaii, { key: `${prefix}.one` });
    const m2 = makeMemory(agentGaii, { key: `${prefix}.two` });
    const m3 = makeMemory(agentGaii, { key: `other.${uid()}` });
    await storage.setMemory(m1);
    await storage.setMemory(m2);
    await storage.setMemory(m3);

    const list = await storage.listMemory(agentGaii, { prefix });
    expect(list.length).toBe(2);
    expect(list.every(m => m.key.startsWith(prefix))).toBe(true);
  });

  it('lists memory with tag filter', async () => {
    const tag = `tag-${uid()}`;
    const m1 = makeMemory(agentGaii, { key: `tagged.${uid()}`, tags: [tag, 'extra'] });
    const m2 = makeMemory(agentGaii, { key: `tagged.${uid()}`, tags: ['other'] });
    await storage.setMemory(m1);
    await storage.setMemory(m2);

    const list = await storage.listMemory(agentGaii, { tags: [tag] });
    expect(list.length).toBe(1);
    expect(list[0].key).toBe(m1.key);
  });

  it('searches memory by key', async () => {
    const searchTerm = `findme-${uid()}`;
    const m1 = makeMemory(agentGaii, { key: `search.${searchTerm}`, value: 'irrelevant' });
    const m2 = makeMemory(agentGaii, { key: `search.other-${uid()}`, value: 'irrelevant' });
    await storage.setMemory(m1);
    await storage.setMemory(m2);

    const results = await storage.searchMemory(agentGaii, searchTerm);
    expect(results.length).toBe(1);
    expect(results[0].key).toBe(m1.key);
  });

  it('searches memory by value content', async () => {
    const searchTerm = `needle-${uid()}`;
    const m1 = makeMemory(agentGaii, {
      key: `val-search.${uid()}`,
      value: { data: `contains ${searchTerm} inside` },
    });
    await storage.setMemory(m1);

    const results = await storage.searchMemory(agentGaii, searchTerm);
    expect(results.length).toBe(1);
    expect(results[0].key).toBe(m1.key);
  });

  it('searches memory by tag', async () => {
    const searchTag = `searchtag-${uid()}`;
    const m1 = makeMemory(agentGaii, {
      key: `tag-search.${uid()}`,
      tags: [searchTag],
      value: 'no match here',
    });
    await storage.setMemory(m1);

    const results = await storage.searchMemory(agentGaii, searchTag);
    expect(results.length).toBe(1);
    expect(results[0].key).toBe(m1.key);
  });

  it('deletes a memory entry', async () => {
    const mem = makeMemory(agentGaii);
    await storage.setMemory(mem);

    const deleted = await storage.deleteMemory(agentGaii, mem.key);
    expect(deleted).toBe(true);

    const fetched = await storage.getMemory(agentGaii, mem.key);
    expect(fetched).toBeNull();
  });

  it('returns false when deleting non-existent memory', async () => {
    const deleted = await storage.deleteMemory(agentGaii, 'no-such-key');
    expect(deleted).toBe(false);
  });

  it('deletes all memory for an agent', async () => {
    const gaii = `bulk-del-${uid()}@test-node`;
    await storage.setMemory(makeMemory(gaii, { key: `bulk.${uid()}` }));
    await storage.setMemory(makeMemory(gaii, { key: `bulk.${uid()}` }));
    await storage.setMemory(makeMemory(gaii, { key: `bulk.${uid()}` }));

    const count = await storage.deleteAllMemory(gaii);
    expect(count).toBe(3);

    const list = await storage.listMemory(gaii);
    expect(list.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Work Queue
// ═══════════════════════════════════════════════════════════════════

describe('Work Queue', () => {
  const providerGaii = `provider-${uid()}@test-node`;
  const requesterGaii = `requester-${uid()}@test-node`;

  it('creates and retrieves a work item', async () => {
    const work = makeWork(providerGaii, requesterGaii);
    const created = await storage.createWork(work);
    expect(created.trackingCode).toBe(work.trackingCode);

    const fetched = await storage.getWork(work.trackingCode);
    expect(fetched).not.toBeNull();
    expect(fetched!.trackingCode).toBe(work.trackingCode);
    expect(fetched!.status).toBe('pending');
    expect(fetched!.providerGaii).toBe(providerGaii);
    expect(fetched!.requesterGaii).toBe(requesterGaii);
    expect(fetched!.input).toEqual({ prompt: 'test input' });
    expect(fetched!.cost.total).toBe(11);
  });

  it('returns null for non-existent work', async () => {
    const result = await storage.getWork('no-such-tracking-code');
    expect(result).toBeNull();
  });

  it('updates a work item status', async () => {
    const work = makeWork(providerGaii, requesterGaii);
    await storage.createWork(work);

    const updated = await storage.updateWork(work.trackingCode, {
      status: 'completed',
      output: { result: 'done' },
      updatedAt: now(),
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('completed');
    expect(updated!.output).toEqual({ result: 'done' });
  });

  it('returns null when updating non-existent work', async () => {
    const result = await storage.updateWork('no-such-code', { status: 'completed' });
    expect(result).toBeNull();
  });

  it('lists work by provider', async () => {
    const w1 = makeWork(providerGaii, requesterGaii);
    const w2 = makeWork(providerGaii, requesterGaii);
    await storage.createWork(w1);
    await storage.createWork(w2);

    const list = await storage.listWorkByProvider(providerGaii);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every(w => w.providerGaii === providerGaii)).toBe(true);
  });

  it('lists work by requester', async () => {
    const w1 = makeWork(providerGaii, requesterGaii);
    await storage.createWork(w1);

    const list = await storage.listWorkByRequester(requesterGaii);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every(w => w.requesterGaii === requesterGaii)).toBe(true);
  });

  it('lists all work', async () => {
    const w1 = makeWork(providerGaii, requesterGaii);
    await storage.createWork(w1);

    const all = await storage.listAllWork();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('adds rating to work item', async () => {
    const work = makeWork(providerGaii, requesterGaii);
    await storage.createWork(work);

    const updated = await storage.updateWork(work.trackingCode, {
      rating: { score: 5, comment: 'Great work!' },
      updatedAt: now(),
    });

    expect(updated!.rating).toEqual({ score: 5, comment: 'Great work!' });

    // Re-fetch to verify persistence
    const fetched = await storage.getWork(work.trackingCode);
    expect(fetched!.rating).toEqual({ score: 5, comment: 'Great work!' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Board + Posts
// ═══════════════════════════════════════════════════════════════════

describe('Board + Posts', () => {
  const ownerGaii = `board-owner-${uid()}@test-node`;

  it('creates and retrieves a board', async () => {
    const board = makeBoard(ownerGaii);
    const created = await storage.createBoard(board);
    expect(created.id).toBe(board.id);

    const fetched = await storage.getBoard(board.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(board.id);
    expect(fetched!.name).toBe(board.name);
    expect(fetched!.visibility).toBe('public');
    expect(fetched!.ownerGaii).toBe(ownerGaii);
  });

  it('returns null for non-existent board', async () => {
    const result = await storage.getBoard('no-such-board');
    expect(result).toBeNull();
  });

  it('lists boards', async () => {
    const b1 = makeBoard(ownerGaii);
    const b2 = makeBoard(ownerGaii, { visibility: 'private' });
    await storage.createBoard(b1);
    await storage.createBoard(b2);

    const all = await storage.listBoards();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('lists boards filtered by visibility', async () => {
    const b1 = makeBoard(ownerGaii, { visibility: 'public' });
    const b2 = makeBoard(ownerGaii, { visibility: 'private' });
    await storage.createBoard(b1);
    await storage.createBoard(b2);

    const publicBoards = await storage.listBoards({ visibility: 'public' });
    expect(publicBoards.every(b => b.visibility === 'public')).toBe(true);
  });

  it('deletes a board', async () => {
    const board = makeBoard(ownerGaii);
    await storage.createBoard(board);

    const deleted = await storage.deleteBoard(board.id);
    expect(deleted).toBe(true);

    const fetched = await storage.getBoard(board.id);
    expect(fetched).toBeNull();
  });

  it('creates and retrieves a post', async () => {
    const board = makeBoard(ownerGaii);
    await storage.createBoard(board);

    const post = makePost(board.id, ownerGaii);
    const created = await storage.createPost(post);
    expect(created.id).toBe(post.id);

    const fetched = await storage.getPost(board.id, post.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(post.id);
    expect(fetched!.title).toBe(post.title);
    expect(fetched!.body).toBe(post.body);
    expect(fetched!.authorGaii).toBe(ownerGaii);
  });

  it('lists posts for a board', async () => {
    const board = makeBoard(ownerGaii);
    await storage.createBoard(board);

    const p1 = makePost(board.id, ownerGaii);
    const p2 = makePost(board.id, ownerGaii);
    await storage.createPost(p1);
    await storage.createPost(p2);

    const posts = await storage.listPosts(board.id);
    expect(posts.length).toBe(2);
  });

  it('lists posts with limit', async () => {
    const board = makeBoard(ownerGaii);
    await storage.createBoard(board);

    await storage.createPost(makePost(board.id, ownerGaii));
    await storage.createPost(makePost(board.id, ownerGaii));
    await storage.createPost(makePost(board.id, ownerGaii));

    const posts = await storage.listPosts(board.id, { limit: 2 });
    expect(posts.length).toBe(2);
  });

  it('deletes a post', async () => {
    const board = makeBoard(ownerGaii);
    await storage.createBoard(board);

    const post = makePost(board.id, ownerGaii);
    await storage.createPost(post);

    const deleted = await storage.deletePost(board.id, post.id);
    expect(deleted).toBe(true);

    const fetched = await storage.getPost(board.id, post.id);
    expect(fetched).toBeNull();
  });

  it('adds a reaction to a post', async () => {
    const board = makeBoard(ownerGaii);
    await storage.createBoard(board);

    const post = makePost(board.id, ownerGaii);
    await storage.createPost(post);

    const added = await storage.addReaction(board.id, post.id, '👍', ownerGaii);
    expect(added).toBe(true);

    const fetched = await storage.getPost(board.id, post.id);
    expect(fetched!.reactions['👍']).toContain(ownerGaii);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Consent
// ═══════════════════════════════════════════════════════════════════

describe('Consent', () => {
  const ownerGaii = `consent-owner-${uid()}@test-node`;

  it('creates and retrieves a consent record', async () => {
    const consent = makeConsent(ownerGaii);
    const created = await storage.createConsent(consent);
    expect(created.id).toBe(consent.id);

    const fetched = await storage.getConsent(consent.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(consent.id);
    expect(fetched!.ownerGaii).toBe(ownerGaii);
    expect(fetched!.dataPattern).toBe('profile.*');
    expect(fetched!.recipient).toBe('*');
    expect(fetched!.status).toBe('active');
    expect(fetched!.scope).toBe('private');
  });

  it('returns null for non-existent consent', async () => {
    const result = await storage.getConsent('no-such-consent-id');
    expect(result).toBeNull();
  });

  it('lists consents for an owner', async () => {
    const c1 = makeConsent(ownerGaii);
    const c2 = makeConsent(ownerGaii, { purpose: 'marketplace' });
    await storage.createConsent(c1);
    await storage.createConsent(c2);

    const list = await storage.listConsents(ownerGaii);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('lists consents filtered by status', async () => {
    const active = makeConsent(ownerGaii, { status: 'active' });
    const revoked = makeConsent(ownerGaii, { status: 'revoked', revokedAt: now() });
    await storage.createConsent(active);
    await storage.createConsent(revoked);

    const activeList = await storage.listConsents(ownerGaii, { status: 'active' });
    expect(activeList.every(c => c.status === 'active')).toBe(true);

    const revokedList = await storage.listConsents(ownerGaii, { status: 'revoked' });
    expect(revokedList.every(c => c.status === 'revoked')).toBe(true);
  });

  it('updates a consent record', async () => {
    const consent = makeConsent(ownerGaii);
    await storage.createConsent(consent);

    const revokedAt = now();
    const updated = await storage.updateConsent(consent.id, {
      status: 'revoked',
      revokedAt,
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('revoked');
    expect(updated!.revokedAt).toBe(revokedAt);
  });

  it('deletes a consent record', async () => {
    const consent = makeConsent(ownerGaii);
    await storage.createConsent(consent);

    const deleted = await storage.deleteConsent(consent.id);
    expect(deleted).toBe(true);

    const fetched = await storage.getConsent(consent.id);
    expect(fetched).toBeNull();
  });

  it('finds matching consents for a wildcard recipient', async () => {
    const consent = makeConsent(ownerGaii, {
      dataPattern: 'profile.*',
      recipient: '*',
    });
    await storage.createConsent(consent);

    const matches = await storage.findMatchingConsents(
      ownerGaii,
      'profile.interests',
      `some-agent@test-node`,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some(c => c.id === consent.id)).toBe(true);
  });

  it('finds matching consents for a specific GAII recipient', async () => {
    const accessorGaii = `accessor-${uid()}@test-node`;
    const consent = makeConsent(ownerGaii, {
      dataPattern: 'data.*',
      recipient: accessorGaii,
    });
    await storage.createConsent(consent);

    const matches = await storage.findMatchingConsents(
      ownerGaii,
      'data.metrics',
      accessorGaii,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some(c => c.id === consent.id)).toBe(true);
  });

  it('does not match consents for non-matching data pattern', async () => {
    const consent = makeConsent(ownerGaii, {
      dataPattern: 'profile.*',
      recipient: '*',
    });
    await storage.createConsent(consent);

    const matches = await storage.findMatchingConsents(
      ownerGaii,
      'settings.theme',
      `some-agent@test-node`,
    );
    // The consent for profile.* should NOT match settings.theme
    expect(matches.filter(c => c.id === consent.id).length).toBe(0);
  });

  it('adds and lists consent audit entries', async () => {
    const consent = makeConsent(ownerGaii);
    await storage.createConsent(consent);

    const entry = {
      id: `audit-${uid()}`,
      consentId: consent.id,
      ownerGaii,
      accessorGaii: `accessor-${uid()}@test-node`,
      memoryKey: 'profile.name',
      action: 'read' as const,
      timestamp: now(),
      allowed: true,
    };
    const created = await storage.addConsentAuditEntry(entry);
    expect(created.id).toBe(entry.id);

    const auditLog = await storage.listConsentAudit(ownerGaii);
    expect(auditLog.length).toBeGreaterThanOrEqual(1);
    expect(auditLog.some(e => e.id === entry.id)).toBe(true);
  });

  it('excludes expired consents from findMatchingConsents', async () => {
    const pastDate = new Date(Date.now() - 86400_000).toISOString(); // 1 day ago
    const consent = makeConsent(ownerGaii, {
      dataPattern: 'profile.*',
      recipient: '*',
      expires: pastDate,
    });
    await storage.createConsent(consent);

    const matches = await storage.findMatchingConsents(
      ownerGaii,
      'profile.interests',
      `some-agent@test-node`,
    );
    // Expired consent should not be in the results
    expect(matches.filter(c => c.id === consent.id).length).toBe(0);
  });
});
