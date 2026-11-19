/**
 * @file test/unit/kyc-store-identify.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Customer due diligence parts an E2E run cannot reach: two versions written at once both
 *   land (none over the other), the version in force at a time, and the identify link given by a
 *   customer with a strong verification (FTN), which needs a bank the test node does not have.
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { OrganismMembershipRecord, OrganismRecord } from '../../src/storage/types/organisms-federation.js';
import type { AimeatConfig } from '../../src/config.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import { writeDoc } from '../../src/services/compliance/docs.js';
import { appendVersion, readVersions, versionAsOf, writeSettings } from '../../src/services/kyc/store.js';
import { openCustomer, readCustomer } from '../../src/services/kyc/cards.js';
import { acceptLink, createLink, describeLink } from '../../src/services/kyc/identify.js';
import { readDisclosures, recordVerification } from '../../src/services/account/verification-history.js';
import { recordVerifiedName } from '../../src/services/verified-name.js';
import type { CustomerVersion } from '../../src/services/kyc/contract.js';

const NODE = 'node-kyc';
const ORG = 'org-kyc';
const config = { nodeId: NODE, amlMode: 'owners', kycAi: 'local', kycSanctionsSources: 'none' } as unknown as AimeatConfig;
let storage: Storage;
const stamp = new Date().toISOString();
const person = (name: string) => callerFromAuth({ sub: name, owner: name, roles: ['owner'], scopes: [] }, NODE, storage);

function version(id: string, n: number, at: string, pep: CustomerVersion['pep'] = 'no'): CustomerVersion {
  return {
    id, organism: ORG, n, at, by: `alice@${NODE}`, change: n === 1 ? 'opened' : 'updated', kind: 'person', name: 'Bob', aliases: [],
    identity: null, beneficialOwners: [], pep, screening: { status: 'not-screened', lists: {}, hits: [] }, risk: null, status: 'open',
  };
}

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await storage.createOrganism({
    id: ORG, name: 'Kyc Office', description: 'x', type: 'project', interests: [], creatorGhii: 'alice', createdBy: 'alice', owners: [`alice@${NODE}`],
    admins: ['alice'], members: ['alice'], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
    moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false }, memoryNamespace: `organism.${ORG}`, createdAt: stamp, updatedAt: stamp,
  } as unknown as OrganismRecord);
  await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: stamp } as OrganismMembershipRecord);
  await writeDoc(storage, NODE, 'aml', { kind: 'organism', organismId: ORG }, { items: [{ id: 'decl', type: 'declaration', legalName: 'Kyc Oy', businessId: '1-1', sector: 'accounting', complianceOfficer: 'alice', scope: 'x', answerSources: [], stamp: { at: stamp, by: 'alice' } }] } as never);
  await writeSettings(storage, NODE, ORG, (c) => ({ ...c, officers: [`alice@${NODE}`] }));
});

describe('versions', () => {
  it('keeps both of two versions written at once, numbered one after the other', async () => {
    await appendVersion(storage, NODE, ORG, 'c-0001', (_p, n) => version('c-0001', n, '2026-01-01T10:00:00.000Z'));
    await Promise.all([
      appendVersion(storage, NODE, ORG, 'c-0001', (_p, n) => version('c-0001', n, '2026-02-01T10:00:00.000Z', 'yes')),
      appendVersion(storage, NODE, ORG, 'c-0001', (_p, n) => version('c-0001', n, '2026-02-01T10:00:00.001Z', 'family')),
    ]);
    const all = await readVersions(storage, NODE, ORG, 'c-0001');
    expect(all.map(v => v.n)).toEqual([1, 2, 3]);
    expect(new Set(all.slice(1).map(v => v.pep))).toEqual(new Set(['yes', 'family']));
  });

  it('answers the version in force at a time, and null before the first', () => {
    const vs = [version('c', 1, '2026-01-01T00:00:00.000Z'), version('c', 2, '2026-03-01T00:00:00.000Z', 'yes'), version('c', 3, '2026-05-01T00:00:00.000Z', 'no')];
    expect(versionAsOf(vs, '2026-04-03T12:00:00.000Z')?.n).toBe(2);
    expect(versionAsOf(vs, '2026-03-01T00:00:00.000Z')?.n).toBe(2);
    expect(versionAsOf(vs, '2025-12-31T23:59:59.000Z')).toBeNull();
    expect(versionAsOf(vs, 'not a date')).toBeNull();
  });
});

describe('the identify link', () => {
  it('gives a customer\'s FTN verification to the card once, and records the disclosure on the customer\'s side', async () => {
    const alice = person('alice');
    const card = await openCustomer({ storage, config }, alice, ORG, { kind: 'person', name: 'Dave Customer', country: 'FI' });
    const link = await createLink({ storage, config }, alice, ORG, card.id);
    const token = link.token;
    const dave = person('dave');
    const before = await describeLink({ storage, config }, dave, token);
    expect(before.verification).toBeNull();
    expect(before.verifyPath).toBe(`/v1/ghii/verify/ftn/authorize?return_to=${encodeURIComponent(`/v1/profile?tab=identify&token=${token}`)}`);
    await expect(acceptLink({ storage, config }, dave, token)).rejects.toMatchObject({ code: 'NOT_VERIFIED' });

    await recordVerification(storage, `dave@${NODE}`, { level: 3, method: 'ftn', issuer: 'https://bank.example', by: `dave@${NODE}` });
    await recordVerifiedName(storage, `dave@${NODE}`, 'Dave Customer', 'ftn');
    const given = await acceptLink({ storage, config }, dave, token);
    expect(given.organism).toBe('Kyc Office');
    const read = await readCustomer({ storage, config }, alice, ORG, card.id);
    expect(read.card.change).toBe('identified');
    expect(read.card.identity).toMatchObject({ level: 'substantial', method: 'ftn', issuer: 'https://bank.example', ghii: `dave@${NODE}`, faceToFace: false });
    expect(read.card.by).toBe(`dave@${NODE}`);
    const disclosures = await readDisclosures(storage, `dave@${NODE}`);
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]).toMatchObject({ organism: ORG, card: card.id });
    await expect(acceptLink({ storage, config }, dave, token)).rejects.toMatchObject({ code: 'LINK_USED' });
  });

  it('is refused to an agent and to a session from another node', async () => {
    const alice = person('alice');
    const card = await openCustomer({ storage, config }, alice, ORG, { kind: 'person', name: 'Erin', country: 'FI' });
    const { token } = await createLink({ storage, config }, alice, ORG, card.id);
    const agent = callerFromAuth({ sub: `bot#dave@${NODE}`, owner: 'dave', roles: ['agent'], scopes: ['compliance:read'] }, NODE, storage);
    await expect(describeLink({ storage, config }, agent, token)).rejects.toMatchObject({ code: 'IN_PERSON_ONLY' });
    const visitor = callerFromAuth({ sub: 'dave@other-node', owner: 'dave@other-node', roles: ['federated'], scopes: [], federated: true }, NODE, storage);
    await expect(describeLink({ storage, config }, visitor, token)).rejects.toMatchObject({ code: 'IN_PERSON_ONLY' });
  });
});
