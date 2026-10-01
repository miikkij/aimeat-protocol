/**
 * @file test/unit/app-member-round2.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app member roster, round 2, below HTTP:
 *   - the pure rules (services/app-member-rules.ts): the 7-day wait after a decline, who manages,
 *     the one-click role that never names a managing role, search and paging, the audit rows;
 *   - the notices (services/app-member-notices.ts) in en, fi and es, and the invitation email
 *     escaping what the inviter typed;
 *   - on SQLite in memory: an invitation becomes a membership when its address is verified, an
 *     expired one and one naming the app's owner are dropped, the roster view searches by display
 *     name and pages with totals, and account erasure takes the invitations the account sent, the
 *     ones of its apps and the ones addressed to it, and leaves the rest.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-member-round2.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import {
  reaskRetryAt, REASK_WAIT_MS, canManageRoster, isManagerRole, suggestRole, parseRosterPaging,
  matchesQuery, pageRows, memberAuditRows, roleShapeError,
} from '../../src/services/app-member-rules.js';
import { memberNoticeText, memberActionLabel, noticeLang, appMemberInviteEmail } from '../../src/services/app-member-notices.js';
import { putInvite, listInvites, applyAppInvitesForVerifiedEmail, NS_INVITE, inviteKey } from '../../src/services/app-member-invites.js';
import { inviteEmailHash } from '../../src/services/invitations.js';
import { getMemberRow, putMember, putRequest, noteVisit, writePrivateRecord } from '../../src/services/app-members.js';
import { rosterView } from '../../src/services/app-member-roster.js';
import { eraseAppMembership } from '../../src/services/app-member-erasure.js';
import type { AppAuditEntry } from '../../src/services/app-audit.js';

describe('app-member-rules', () => {
  it('a declined person waits 7 days, counted from the decline', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const declined = { state: 'declined', at: '2026-09-01T00:00:00Z', decidedAt: '2026-10-08T00:00:00Z' };
    expect(reaskRetryAt(declined, now)).toBe(new Date(Date.parse(declined.decidedAt) + REASK_WAIT_MS).toISOString());
    expect(reaskRetryAt({ ...declined, decidedAt: '2026-10-01T00:00:00Z' }, now)).toBeNull();
    expect(reaskRetryAt({ state: 'pending', at: '2026-10-09T00:00:00Z' }, now)).toBeNull();
    expect(reaskRetryAt(null, now)).toBeNull();
    // A declined ask stored before decidedAt existed counts from when it was made.
    expect(reaskRetryAt({ state: 'declined', at: '2026-10-09T00:00:00Z' }, now)).not.toBeNull();
  });

  it('the owner and a member holding a managing role manage; nobody else does', () => {
    const plan = { manageRoles: ['admin'] };
    expect(canManageRoster(plan, true, null)).toBe(true);
    expect(canManageRoster(plan, false, { role: 'admin' })).toBe(true);
    expect(canManageRoster(plan, false, { role: 'member' })).toBe(false);
    expect(canManageRoster(plan, false, null)).toBe(false);
    expect(canManageRoster(null, false, { role: 'admin' })).toBe(false);
    expect(isManagerRole(plan, 'admin')).toBe(true);
    expect(isManagerRole(plan, '')).toBe(false);
  });

  it('the one-click role is the commonest role that is not a managing role, else member', () => {
    const rows = [{ role: 'admin' }, { role: 'admin' }, { role: 'admin' }, { role: 'reader' }, { role: 'writer' }, { role: 'writer' }];
    expect(suggestRole(rows, [])).toBe('admin');
    expect(suggestRole(rows, ['admin'])).toBe('writer');
    expect(suggestRole([{ role: 'admin' }], ['admin'])).toBe('member');
    expect(suggestRole([], [])).toBe('member');
  });

  it('paging clamps the limit and never fails on a bad value', () => {
    expect(parseRosterPaging({})).toEqual({ q: '', limit: 100, offset: 0 });
    expect(parseRosterPaging({ q: '  Ann ', limit: '9999', offset: '20' })).toEqual({ q: 'ann', limit: 500, offset: 20 });
    expect(parseRosterPaging({ limit: 'x', offset: '-3' })).toEqual({ q: '', limit: 100, offset: 0 });
    expect(matchesQuery('ann', 'bob', 'Anna Smith')).toBe(true);
    expect(matchesQuery('ann', 'bob', null)).toBe(false);
    expect(matchesQuery('', 'bob')).toBe(true);
    expect(pageRows([1, 2, 3, 4, 5], { limit: 2, offset: 2 })).toEqual({ items: [3, 4], total: 5 });
  });

  it('role names: shape checked, owner refused', () => {
    expect(roleShapeError('member')).toBeNull();
    expect(roleShapeError('owner')).not.toBeNull();
    expect(roleShapeError('*')).not.toBeNull();
    expect(roleShapeError('1abc')).not.toBeNull();
  });

  it('the audit rows are the roster actions only, newest first, paged by before', () => {
    const e = (at: string, action: string, detail?: AppAuditEntry['detail']): AppAuditEntry =>
      ({ at, by: 'alice@n', action: action as AppAuditEntry['action'], ...(detail ? { detail } : {}) });
    const log = [
      e('2026-10-01T00:00:01Z', 'member.approved', { account: 'bob', from: null, to: 'member' }),
      e('2026-10-01T00:00:02Z', 'legal.set', { kind: 'terms' }),
      e('2026-10-01T00:00:03Z', 'member.role_changed', { account: 'bob', from: 'member', to: 'admin' }),
      e('2026-10-01T00:00:04Z', 'invite.sent', { account: null, to: 'member', invite: 'inv_1' }),
    ];
    const first = memberAuditRows(log, { limit: 2 });
    expect(first.total).toBe(3);
    expect(first.entries.map(r => r.action)).toEqual(['invite.sent', 'member.role_changed']);
    expect(first.entries[1]).toMatchObject({ account: 'bob', from: 'member', to: 'admin' });
    expect(first.entries[0]).toMatchObject({ account: null, to: 'member', detail: { invite: 'inv_1' } });
    expect(first.nextBefore).toBe('2026-10-01T00:00:03Z');
    const second = memberAuditRows(log, { limit: 2, before: first.nextBefore });
    expect(second.entries.map(r => r.action)).toEqual(['member.approved']);
    expect(second.nextBefore).toBeNull();
  });
});

describe('app-member-notices', () => {
  it('says each notice in the recipient language', () => {
    const vars = { app: 'club', by: 'alice', role: 'admin', from: 'member', who: 'bob', note: '', date: '8.10.2026' };
    expect(memberNoticeText('approved', 'en', vars).title).toBe('You were approved for club');
    expect(memberNoticeText('role_changed', 'fi', vars)).toEqual({
      title: 'Roolisi sovelluksessa club on nyt admin', body: 'alice vaihtoi roolisi. Aiempi rooli oli member.',
    });
    expect(memberNoticeText('declined', 'es', vars).body).toBe('Puedes volver a pedirlo a partir del 8.10.2026.');
    expect(memberNoticeText('request', 'fi', vars).body).toBe('Viestiä ei jätetty.');
    expect(memberNoticeText('request', 'en', { ...vars, note: 'let me {in}' }).body).toBe('let me {in}');
    expect(memberActionLabel('approveAs', 'es', { role: 'member' })).toBe('Aprobar como member');
    expect(noticeLang('fi-FI')).toBe('fi');
    expect(noticeLang('sv')).toBe('en');
    expect(noticeLang(null)).toBe('en');
    // Finnish says "sovellus", never the node.
    for (const kind of ['approved', 'revoked', 'request', 'role_changed', 'declined'] as const) {
      const t = memberNoticeText(kind, 'fi', vars);
      expect(`${t.title} ${t.body}`).not.toMatch(/solmu|node/i);
    }
  });

  it('the invitation email escapes what the inviter typed and links to the app', () => {
    const mail = appMemberInviteEmail('fi', {
      inviter: '<b>Eve</b>', app: 'club', role: 'member', appUrl: 'https://club.apps.example/', date: '2026-10-31',
    });
    expect(mail.subject).toBe('<b>Eve</b> kutsuu sinut sovellukseen club');
    expect(mail.html).not.toContain('<b>Eve</b>');
    expect(mail.html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
    expect(mail.html).toContain('https://club.apps.example/');
    expect(mail.text).toContain('Kutsu on voimassa 2026-10-31 asti.');
  });
});

type TestStorage = Storage & { close(): void | Promise<void> };
let s: TestStorage;
const NODE = 'round2-test';
const now = new Date().toISOString();
beforeAll(async () => {
  s = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as TestStorage;
  for (const name of ['alice', 'bob', 'carol', 'dave']) {
    await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
    await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name,
      displayName: name === 'carol' ? 'Carol Anderson' : name, verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
  }
  for (const [owner, filename] of [['alice', 'club.html'], ['dave', 'shop.html']]) {
    await s.createApp({
      ownerGaii: `${owner}@${NODE}`, ownerName: owner, filename, versionNumber: 1,
      manifest: { name: filename, description: 'fixture', version: '1', category: 'tool', tags: [], authorDisplay: owner, usesCortex: [] },
      mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: now,
    });
  }
}, 60_000);
afterAll(async () => { await s.close(); });

describe('app member invitations and the roster view, on SQLite', () => {
  it('an invitation becomes a membership when its address is verified; expired and self invitations are dropped', async () => {
    const club = 'alice/club.html';
    const hash = inviteEmailHash('Bob@Example.com');
    await putInvite(s, { appId: club, emailHash: hash, emailShown: 'Bob@Example.com', role: 'writer', invitedBy: `alice@${NODE}` });
    expect((await listInvites(s, club)).map(i => i.emailShown)).toEqual(['Bob@Example.com']);

    // An expired invitation of another address, and one that names the app's own owner.
    const old = inviteEmailHash('old@example.com');
    await writePrivateRecord(s, NS_INVITE, inviteKey(club, old), {
      id: 'inv_old', appId: club, emailHash: old, emailShown: 'old@example.com', role: 'member', note: '',
      invitedBy: `alice@${NODE}`, at: '2026-01-01T00:00:00Z', expiresAt: '2026-01-31T00:00:00Z',
    });
    const self = inviteEmailHash('alice@example.com');
    await putInvite(s, { appId: club, emailHash: self, emailShown: 'alice@example.com', role: 'member', invitedBy: `alice@${NODE}` });

    expect(await applyAppInvitesForVerifiedEmail(s, NODE, hash, `bob@${NODE}`)).toBe(1);
    expect((await getMemberRow(s, club, 'bob'))?.role).toBe('writer');
    expect((await listInvites(s, club)).some(i => i.emailHash === hash)).toBe(false);
    // The member was told, as on an approval.
    const bell = (await s.listMemory(`bob@${NODE}`, { prefix: 'notif.' })).map(r => (r.value as { type: string }).type);
    expect(bell).toContain('app_member_approved');

    expect(await applyAppInvitesForVerifiedEmail(s, NODE, old, `carol@${NODE}`)).toBe(0);
    expect(await s.getMemory(NS_INVITE, inviteKey(club, old))).toBeNull();
    expect(await applyAppInvitesForVerifiedEmail(s, NODE, self, `alice@${NODE}`)).toBe(0);
    expect(await getMemberRow(s, club, 'alice')).toBeNull();
  });

  it('the roster view searches by display name and pages with totals', async () => {
    const shop = 'dave/shop.html';
    for (const a of ['alice', 'bob', 'carol']) await putMember(s, { appId: shop, account: a, role: 'member', approvedBy: 'dave' });
    const page = await rosterView(s, shop, { q: '', limit: 2, offset: 0 });
    expect(page.members.map(m => m.owner)).toEqual(['alice', 'bob']);
    expect(page.total.members).toBe(3);
    expect(page.members[0].displayName).toBe('alice');
    const found = await rosterView(s, shop, { q: 'anderson', limit: 100, offset: 0 });
    expect(found.members.map(m => m.owner)).toEqual(['carol']);
    expect(found.members[0].displayName).toBe('Carol Anderson');
    expect(found.total).toEqual({ members: 1, requests: 0, seen: 0, invites: 0 });
  });

  it('erasure takes the invitations the account sent, of its apps and to its address, and leaves the rest', async () => {
    const club = 'alice/club.html', shop = 'dave/shop.html';
    const carolHash = inviteEmailHash('carol@example.com');
    await s.updateGHII(`carol@${NODE}`, { emailHash: carolHash, emailVerifiedAt: now });
    await putInvite(s, { appId: club, emailHash: inviteEmailHash('x@example.com'), emailShown: 'x@example.com', role: 'member', invitedBy: `bob@${NODE}` });
    await putInvite(s, { appId: shop, emailHash: inviteEmailHash('y@example.com'), emailShown: 'y@example.com', role: 'member', invitedBy: `dave@${NODE}` });
    await putInvite(s, { appId: club, emailHash: carolHash, emailShown: 'carol@example.com', role: 'member', invitedBy: `alice@${NODE}` });
    await putInvite(s, { appId: club, emailHash: inviteEmailHash('keep@example.com'), emailShown: 'keep@example.com', role: 'member', invitedBy: `alice@${NODE}` });
    await putRequest(s, { appId: club, account: 'dave', note: 'hi' });
    await noteVisit(s, club, 'dave');

    expect((await eraseAppMembership(s, 'bob')).invites).toBe(1);
    expect((await eraseAppMembership(s, 'dave')).invites).toBe(1);
    expect((await eraseAppMembership(s, 'carol')).invites).toBe(1);
    // The invitation naming alice herself was dropped by the first case; only keep@ stays.
    expect((await listInvites(s, club)).map(i => i.emailShown)).toEqual(['keep@example.com']);
    expect(await listInvites(s, shop)).toEqual([]);
  });
});
