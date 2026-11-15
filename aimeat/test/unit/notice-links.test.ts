/**
 * @file test/unit/notice-links.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Five notices that led nowhere now open the thing they are about: a membership notice
 *   without an app opens the Wallet page (it named the Exchange tab, which is gone); a publish request
 *   opens what it would make public; a signing request without a signing app opens the notifications
 *   page and gives a sentence to say to the AI; an internet opening opens the app in the App Catalog;
 *   a timed-out dispute opens its ruling on the admin Work page. Each link is checked against the route
 *   table in public/spa.html, so a moved page fails the test.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notice-links.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-16 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, WorkRecord, AgentRecord } from '../../src/storage/interface.js';
import type { CallerContext } from '../../src/services/caller-context.js';

type Sent = { to: string; type?: string; link?: string; body?: string; i18n?: { key: string; vars: Record<string, unknown> } };
const sent: Sent[] = [];

vi.mock('../../src/services/notify.js', () => ({
  notify: vi.fn(async (_s: unknown, to: string, input: Omit<Sent, 'to'>) => { sent.push({ to, ...input }); return {}; }),
}));
vi.mock('../../src/services/operators.js', () => ({
  listOperatorGhiis: vi.fn(async () => ['op@test-node']),
}));

const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');
const { publishRequestLink } = await import('../../src/services/publish-requests/request-link.js');
const { notifyGrantIssued } = await import('../../src/services/membership-notify.js');
const { tellOwner } = await import('../../src/services/internet-opening/opening-notify.js');
const { createRequest } = await import('../../src/services/docsign/records.js');
const { runDisputeTimeoutJob } = await import('../../src/services/core-jobs.js');

const config = { nodeId: 'test-node', baseUrl: 'http://localhost' } as AimeatConfig;

/** The paths the SPA router serves a view on, read from its route table in spa.html. */
function spaRoutes(): Set<string> {
  const html = readFileSync(fileURLToPath(new URL('../../public/spa.html', import.meta.url)), 'utf8');
  return new Set([...html.matchAll(/'(\/[a-z0-9/-]*)':\s*\(\)\s*=>\s*import\(/g)].map(m => m[1]));
}

/** The link's path is a page the SPA serves. */
function expectPage(link: string | undefined): void {
  expect(link).toBeTruthy();
  expect(spaRoutes().has(new URL(String(link), 'http://x').pathname)).toBe(true);
}

async function seedPerson(storage: Storage, name: string): Promise<void> {
  const now = new Date().toISOString();
  await storage.createGHII({
    username: name, nodeId: 'test-node', ghii: `${name}@test-node`, displayName: name,
    verificationLevel: 1, ownerName: name, totpEnabled: false, createdAt: now, updatedAt: now,
  });
}

beforeEach(() => { sent.length = 0; });

describe('a publish request notice opens what it would make public', () => {
  it('leads by kind, and to the notifications page for a kind without a page', () => {
    expect(publishRequestLink({ kind: 'app', target: { owner: 'alice', filename: 'quiz.html' } })).toBe('/v1/appcat?app=alice%2Fquiz.html');
    expect(publishRequestLink({ kind: 'internet-opening', target: { owner: 'alice', filename: 'quiz.html' } })).toBe('/v1/appcat?app=alice%2Fquiz.html');
    expect(publishRequestLink({ kind: 'organism', target: { organism_id: 'org-1' } })).toBe('/v1/profile?tab=organisms&org=org-1');
    expect(publishRequestLink({ kind: 'workspace-share', target: { organism_id: 'org-1', ws: 'ws-2' } })).toBe('/v1/profile?tab=organisms&org=org-1&ws=ws-2');
    expect(publishRequestLink({ kind: 'package', target: { group_id: 'g-3' } })).toBe('/v1/profile?tab=packages&package=g-3');
    expect(publishRequestLink({ kind: 'skill', target: { owner: 'alice', name: 'notes' } })).toBe('/v1/profile?tab=skills&open=user%3Aalice%2Fnotes');
    expect(publishRequestLink({ kind: 'memory', target: { key: 'notes.trip' } })).toBe('/v1/profile?tab=notifications');
    // A target without the fields its page needs falls back to the notifications page.
    expect(publishRequestLink({ kind: 'app', target: { owner: 'alice' } })).toBe('/v1/profile?tab=notifications');
    for (const link of ['/v1/appcat?app=a%2Fb', '/v1/profile?tab=organisms&org=o']) expectPage(link);
  });
});

describe('a membership notice without an app', () => {
  it('opens the Wallet page', async () => {
    const storage = new SqliteStorage(':memory:');
    await notifyGrantIssued(storage, config, { providerOwner: 'bob', consumerGaii: 'alice@test-node', appId: null, capabilityLabel: 'chat', existing: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0].link).toBe('/v1/profile?tab=wallet');
    expectPage(sent[0].link);
  });
});

describe('an internet opening notice', () => {
  it('opens the app in the App Catalog, and the App Catalog when it names no app', async () => {
    const storage = new SqliteStorage(':memory:');
    await tellOwner({ storage, config } as never, 'alice', 'internet_opening_approved', { app: 'alice/quiz.html', by: 'op', until: '2026-12-01' });
    await tellOwner({ storage, config } as never, 'alice', 'internet_opening_trusted', { by: 'op', reason: 'r' });
    expect(sent.map(s => s.link)).toEqual(['/v1/appcat?app=alice%2Fquiz.html', '/v1/appcat']);
    expectPage(sent[0].link);
  });
});

describe('a signing request without a signing app', () => {
  it('opens the notifications page and gives the sentence to say to the AI', async () => {
    const storage = new SqliteStorage(':memory:');
    await seedPerson(storage, 'alice');
    await seedPerson(storage, 'bob');
    const caller = { principal: 'alice@test-node', ownerGhii: 'alice@test-node', owner: 'alice', kind: 'owner', visitor: false, inPerson: true } as unknown as CallerContext;
    const rec = await createRequest({ storage, config }, caller, {
      title: 'Lease', document: { sha256: 'a'.repeat(64), name: 'lease.pdf', size: 1 }, parties: ['alice@test-node', 'bob@test-node'],
    });
    const toBob = sent.find(s => s.to === 'bob@test-node');
    expect(toBob?.link).toBe('/v1/profile?tab=notifications');
    expect(toBob?.i18n?.key).toBe('docsign_request_ai');
    expect(toBob?.i18n?.vars.id).toBe(rec.id);
    expect(toBob?.body).toContain(`"Show me the signing request ${rec.id}."`);
    expectPage(toBob?.link);
  });
});

describe('a timed-out dispute that waits for a ruling', () => {
  it('opens that dispute on the admin Work page', async () => {
    const storage = new SqliteStorage(':memory:');
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const agent = (gaii: string, name: string): AgentRecord => ({
      name, owner: gaii.split('#')[1].split('@')[0], gaii, capabilities: [], publicKey: 'dGVzdA==',
      trustScore: 50, morselBalance: 0, createdAt: now, lastSeen: now,
    });
    await storage.createAgent(agent('requester#reqowner@test-node', 'requester'));
    await storage.createAgent(agent('provider#provowner@test-node', 'provider'));
    await seedPerson(storage, 'reqowner');
    await seedPerson(storage, 'provowner');
    // The provider holds 3 of the 10 delivery paid, so the timeout cannot take the toll back.
    await storage.creditBalance('provider#provowner@test-node', 3);
    const work: WorkRecord = {
      trackingCode: 'wk-links', status: 'escalated', actionId: 'a',
      providerGaii: 'provider#provowner@test-node', requesterGaii: 'requester#reqowner@test-node', input: {},
      cost: { toll: 10, networkFee: 1, total: 11, inEscrow: 0 }, ttlExpiresAt: old, createdAt: old, updatedAt: old,
    };
    await storage.createWork(work);
    await storage.createDispute({ id: 'd-links', trackingCode: work.trackingCode, status: 'escalated', openedBy: work.requesterGaii, reason: 'r', createdAt: old, updatedAt: old });
    await runDisputeTimeoutJob(config, storage);
    const notice = sent.find(s => s.type === 'dispute_timeout_waiting');
    expect(notice?.to).toBe('op@test-node');
    expect(notice?.link).toBe('/v1/admin?tab=work&dispute=d-links');
    expectPage(notice?.link);
  });
});
