import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { workspaceAccessMiddleware } from '../../src/middleware/workspace-access.js';
import type { OrganismRecord, OrganismMembershipRecord, GHIIRecord, OwnerRecord, AgentRecord, ConsentRecord } from '../../src/storage/interface.js';

// ── Config mock ─────────────────────────────────────────────

const config = { nodeId: 'test-node' } as any;

// ── Request / Response helpers ──────────────────────────────

function mockReq(key: string, method: string, auth?: { sub: string; owner: string; roles: string[] }): any {
  return {
    params: { key },
    method,
    auth: auth ?? undefined,
  };
}

function mockReqNoKey(method: string, auth?: { sub: string; owner: string; roles: string[] }): any {
  return {
    params: {},
    method,
    auth: auth ?? undefined,
  };
}

function mockRes(): any {
  const res: any = {};
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: any) => { res._body = body; return res; };
  return res;
}

// ── Factory helpers ─────────────────────────────────────────

function makeOrganism(overrides: Partial<OrganismRecord> = {}): OrganismRecord {
  return {
    id: 'org-1',
    name: 'Test Organism',
    description: 'A test community',
    type: 'community',
    location: { city: 'Helsinki', country: 'FI' },
    interests: ['AI'],
    creatorGhii: 'alice@test-node',
    admins: ['alice@test-node'],
    members: ['alice@test-node'],
    agentGaiis: [],
    boardId: 'board-1',
    joinPolicy: 'open',
    maxMembers: 100,
    visibility: 'public',
    moderationConfig: {
      flagsEnabled: true,
      autoHideThreshold: 5,
      appealsEnabled: false,
    },
    memoryNamespace: 'organism.org-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMembership(overrides: Partial<OrganismMembershipRecord> = {}): OrganismMembershipRecord {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 10)}`,
    organismId: 'org-1',
    ghii: 'alice',
    role: 'member',
    status: 'active',
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGHII(overrides: Partial<GHIIRecord> = {}): GHIIRecord {
  return {
    username: 'alice',
    nodeId: 'test-node',
    ghii: 'alice@test-node',
    displayName: 'Alice',
    ownerName: 'alice',
    verificationLevel: 0,
    totpEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOwner(overrides: Partial<OwnerRecord> = {}): OwnerRecord {
  return {
    name: 'alice',
    publicKey: 'pubkey-alice',
    roles: ['owner'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    name: 'agent1',
    owner: 'alice',
    gaii: 'agent1#alice@test-node',
    capabilities: ['memory'],
    publicKey: 'pubkey-agent1',
    trustScore: 50,
    morselBalance: 100,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ...overrides,
  };
}

function makeConsent(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: `consent-${Math.random().toString(36).slice(2, 10)}`,
    ownerGaii: 'agent1#alice@test-node',
    dataPattern: 'organism.org-1.**',
    recipient: 'organism.org-1',
    purpose: 'workspace',
    scope: 'private',
    expires: null,
    status: 'active',
    grantedAt: new Date().toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('workspaceAccessMiddleware', () => {
  let storage: SqliteStorage;
  let middleware: ReturnType<typeof workspaceAccessMiddleware>;

  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
    middleware = workspaceAccessMiddleware(config, storage);
  });

  // ── Passthrough tests ───────────────────────────────────

  describe('passthrough (non-organism keys)', () => {
    it('calls next() for non-organism keys', async () => {
      const req = mockReq('profile.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    it('calls next() when no key in params', async () => {
      const req = mockReqNoKey('GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    it('calls next() for organism key without trailing segment (no dot after ID)', async () => {
      // "organism.org-1" alone does not match /^organism\.([^.]+)\./ because there is no trailing dot
      const req = mockReq('organism.org-1', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  // ── Auth required ────────────────────────────────────────

  describe('authentication required', () => {
    it('returns 401 when req.auth is missing', async () => {
      const req = mockReq('organism.org-1.shared.data', 'GET');
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(401);
      expect(res._body.error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 401 when req.auth.owner is undefined', async () => {
      const req = mockReq('organism.org-1.shared.data', 'GET');
      req.auth = { sub: 'agent1#alice@test-node', roles: ['owner'] }; // no owner field
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(401);
    });
  });

  // ── Organism not found ──────────────────────────────────

  describe('organism not found', () => {
    it('returns 404 when organism does not exist', async () => {
      const req = mockReq('organism.nonexistent.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(404);
      expect(res._body.error.code).toBe('NOT_FOUND');
      expect(res._body.error.message).toContain('nonexistent');
    });
  });

  // ── Agent access ────────────────────────────────────────

  describe('agent access (organism agent)', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({
        id: 'org-1',
        agentGaiis: ['org-agent#org@test-node'],
      }));
    });

    it('allows agent to read/write shared namespace', async () => {
      const req = mockReq('organism.org-1.shared.notes', 'POST', { sub: 'org-agent#org@test-node', owner: 'org', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    it('allows agent to GET shared namespace', async () => {
      const req = mockReq('organism.org-1.shared.settings', 'GET', { sub: 'org-agent#org@test-node', owner: 'org', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('allows agent to READ meta namespace (GET)', async () => {
      const req = mockReq('organism.org-1.meta.config', 'GET', { sub: 'org-agent#org@test-node', owner: 'org', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('allows agent to READ meta namespace (HEAD)', async () => {
      const req = mockReq('organism.org-1.meta.config', 'HEAD', { sub: 'org-agent#org@test-node', owner: 'org', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('denies agent WRITE to meta namespace (POST)', async () => {
      const req = mockReq('organism.org-1.meta.config', 'POST', { sub: 'org-agent#org@test-node', owner: 'org', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('ACCESS_DENIED');
      expect(res._body.error.message).toContain('Agent not authorized');
    });

    it('denies agent WRITE to meta namespace (PUT)', async () => {
      const req = mockReq('organism.org-1.meta.rules', 'PUT', { sub: 'org-agent#org@test-node', owner: 'org', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
    });

    it('denies agent access to member namespace', async () => {
      const req = mockReq('organism.org-1.member.alice.profile', 'GET', { sub: 'org-agent#org@test-node', owner: 'org', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('ACCESS_DENIED');
    });

    it('denies non-listed agent access', async () => {
      // An agent NOT in organism.agentGaiis falls through to the human path
      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'other-agent#someone@test-node', owner: 'someone', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      // Falls through to GHII lookup, which will fail since "someone" has no GHII
      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
    });
  });

  // ── GHII resolution ─────────────────────────────────────

  describe('GHII resolution', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
    });

    it('returns 403 when user has no GHII record', async () => {
      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('ACCESS_DENIED');
      expect(res._body.error.message).toContain('Not a member');
    });
  });

  // ── Membership checks ──────────────────────────────────

  describe('membership checks', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
    });

    it('returns 403 when user has no membership', async () => {
      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('ACCESS_DENIED');
      expect(res._body.error.message).toContain('Not an active member');
    });

    it('returns 403 when membership status is suspended (not active)', async () => {
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'banned',
      }));

      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.message).toContain('Not an active member');
    });

    it('returns 403 when membership status is pending', async () => {
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'pending',
      }));

      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
    });
  });

  // ── Own member namespace (no consent needed) ────────────

  describe('own member namespace (consent not required)', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));
      // Note: no agents, no consents created — if consent were needed, it would fail
    });

    it('allows write to own member namespace without consent or agents', async () => {
      const req = mockReq('organism.org-1.member.alice.notes', 'POST', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    it('allows read from own member namespace without consent or agents', async () => {
      const req = mockReq('organism.org-1.member.alice.notes', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('allows PUT to own member namespace without consent', async () => {
      const req = mockReq('organism.org-1.member.alice.profile', 'PUT', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('allows DELETE on own member namespace without consent', async () => {
      const req = mockReq('organism.org-1.member.alice.old-data', 'DELETE', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  // ── Consent checks (shared namespace) — AGENT sessions still require consent ──
  // (A human owner-role session is the principal and skips consent; see the block below.)

  describe('shared namespace (agent consent required)', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));
    });

    it('returns 403 CONSENT_REQUIRED when owner has no agents', async () => {
      // No owner or agent records created
      const req = mockReq('organism.org-1.shared.chat', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('CONSENT_REQUIRED');
      expect(res._body.error.message).toContain('Active consent required');
    });

    it('returns 403 CONSENT_REQUIRED when no matching consent exists', async () => {
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      // No consent created

      const req = mockReq('organism.org-1.shared.chat', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('CONSENT_REQUIRED');
      expect(res._body.error.message).toContain('Active consent required');
      expect(res._body.error.message).toContain('organism.org-1.shared.chat');
    });

    it('allows access when matching consent exists (GET)', async () => {
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.shared.chat', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    it('allows access when matching consent exists (POST write)', async () => {
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.shared.notes', 'POST', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('uses any of the owners agents for consent check', async () => {
      await storage.createOwner(makeOwner({ name: 'alice' }));
      // Create two agents, consent only on the second one
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createAgent(makeAgent({ name: 'agent2', owner: 'alice', gaii: 'agent2#alice@test-node' }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent2#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('denies when consent has wrong recipient', async () => {
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-2', // wrong recipient
        status: 'active',
      }));

      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('CONSENT_REQUIRED');
    });

    it('denies when consent has revoked status', async () => {
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'revoked',
      }));

      const req = mockReq('organism.org-1.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
    });
  });

  // ── Consent checks (meta namespace read) — AGENT sessions still require consent ──

  describe('meta namespace read (agent consent required)', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
    });

    it('allows meta namespace read with valid consent', async () => {
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.meta.config', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('denies meta namespace read without consent', async () => {
      const req = mockReq('organism.org-1.meta.config', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['agent'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('CONSENT_REQUIRED');
    });
  });

  // ── Human owner-role sessions are the principal — they SKIP consent ──

  describe('human owner session (skips consent)', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'creator',
        status: 'active',
      }));
      // No agents, no consents — an owner session must NOT need them.
    });

    it('allows shared write with no agent and no consent', async () => {
      const req = mockReq('organism.org-1.shared.notes', 'POST', { sub: 'alice', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect(res._status).toBeUndefined();
    });

    it('allows meta write (creator) with no consent', async () => {
      const req = mockReq('organism.org-1.meta.manifest', 'POST', { sub: 'alice', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('allows meta read with no consent', async () => {
      const req = mockReq('organism.org-1.meta.config', 'GET', { sub: 'alice', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  // ── Meta namespace write (admin/creator only) ───────────

  describe('meta namespace write (role-gated)', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'active',
      }));
    });

    it('allows admin to write meta namespace', async () => {
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'admin',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.meta.rules', 'POST', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('allows creator to write meta namespace', async () => {
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'creator',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.meta.settings', 'PUT', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('denies regular member from writing meta namespace', async () => {
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.meta.rules', 'POST', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('ACCESS_DENIED');
      expect(res._body.error.message).toContain('Admin access required for meta namespace');
    });

    it('denies member from DELETE on meta namespace', async () => {
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.meta.old-entry', 'DELETE', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('ACCESS_DENIED');
    });
  });

  // ── Member namespace cross-member access ────────────────

  describe('member namespace (cross-member access)', () => {
    beforeEach(async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      // Set up alice
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'active',
      }));
    });

    it('denies writing to another members namespace', async () => {
      const req = mockReq('organism.org-1.member.bob.notes', 'POST', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
      expect(res._body.error.code).toBe('ACCESS_DENIED');
      expect(res._body.error.message).toContain("Cannot write to another member's workspace");
    });

    it('denies PUT to another members namespace', async () => {
      const req = mockReq('organism.org-1.member.bob.profile', 'PUT', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
    });

    it('denies DELETE on another members namespace', async () => {
      const req = mockReq('organism.org-1.member.bob.old-data', 'DELETE', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res._status).toBe(403);
    });

    it('allows reading another members namespace (with consent)', async () => {
      const req = mockReq('organism.org-1.member.bob.profile', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      // Read should pass because:
      // 1. Alice is an active member
      // 2. Consent exists for organism.org-1.**
      // 3. GET is a read method so cross-member write check does not apply
      expect(nextCalled).toBe(true);
    });

    it('allows HEAD to another members namespace (with consent)', async () => {
      const req = mockReq('organism.org-1.member.bob.data', 'HEAD', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  // ── Edge cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('handles deeply nested organism keys', async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: 'organism.org-1',
        status: 'active',
      }));

      const req = mockReq('organism.org-1.shared.deep.nested.key.path', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('correctly extracts organism ID from key with special characters', async () => {
      // Organism IDs with hyphens and numbers
      await storage.createOrganism(makeOrganism({ id: 'my-org-123' }));
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'my-org-123',
        ghii: 'alice',
        role: 'member',
        status: 'active',
      }));
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.my-org-123.**',
        recipient: 'organism.my-org-123',
        status: 'active',
      }));

      const req = mockReq('organism.my-org-123.shared.data', 'GET', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('wildcard consent pattern allows access to all sub-namespaces', async () => {
      await storage.createOrganism(makeOrganism({ id: 'org-1' }));
      await storage.createOwner(makeOwner({ name: 'alice' }));
      await storage.createAgent(makeAgent({ name: 'agent1', owner: 'alice', gaii: 'agent1#alice@test-node' }));
      await storage.createGHII(makeGHII({ username: 'alice', ghii: 'alice@test-node', ownerName: 'alice' }));
      await storage.createMembership(makeMembership({
        organismId: 'org-1',
        ghii: 'alice',
        role: 'admin',
        status: 'active',
      }));
      // Consent with wildcard recipient (*)
      await storage.createConsent(makeConsent({
        ownerGaii: 'agent1#alice@test-node',
        dataPattern: 'organism.org-1.**',
        recipient: '*',
        status: 'active',
      }));

      // Should work for meta write since alice is admin
      const req = mockReq('organism.org-1.meta.settings', 'PUT', { sub: 'agent1#alice@test-node', owner: 'alice', roles: ['owner'] });
      const res = mockRes();
      let nextCalled = false;

      await middleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });

    it('response envelope includes correct node ID', async () => {
      // No auth -> 401
      const req = mockReq('organism.org-1.shared.data', 'GET');
      const res = mockRes();

      await middleware(req, res, () => {});

      expect(res._body.node).toBe('test-node');
      expect(res._body.ok).toBe(false);
      expect(res._body.protocol).toBe('aimeat');
    });
  });
});
