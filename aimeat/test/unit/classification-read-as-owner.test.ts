/**
 * @file test/unit/classification-read-as-owner.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description memory:read-as-owner on classification (secaudit 2026-10, v76 and v77). An agent of
 *   the owner that does not hold the word is refused the owner's and its siblings' private records by
 *   GET /v1/memory?owner_scope=true; the scan, the explorer, the owner-level audit log and exceptions
 *   list, and the single-key label read must not tell it about those records either. Each refusal is
 *   paired with the uses that keep working: the owner in person, an app grant and an agent holding
 *   the word see everything, and the agent without it keeps its own records and the owner's records
 *   of visibility owner.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-read-as-owner.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v76 and v77).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// No model runs here: a classifier call fails as a missing provider does, and only the rules label.
vi.mock('../../src/services/decide/service.js', () => ({ decideForOwner: () => Promise.reject(new Error('no AI provider in this test')) }));
vi.mock('../../src/services/ai/completion.js', () => ({ completeForOwner: () => Promise.reject(new Error('no AI provider in this test')) }));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AgentRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { labelActorOf, memoryTarget, readContentLabel, setLabel, targetOf, type LabelActor } from '../../src/services/classification/labels.js';
import { scanContent } from '../../src/services/classification/scan.js';
import { explorerQueryOf, listLabels } from '../../src/services/classification/explorer.js';
import { readAuditLog } from '../../src/services/classification/policy-admin.js';
import { makeException, readExceptions } from '../../src/services/classification/exception-admin.js';
import { readQueue } from '../../src/services/classification/classifier.js';
import { READ_AS_OWNER_NOTE } from '../../src/services/owner-scope-read.js';
import { labelActorReadsAll } from '../../src/services/classification/owner-scope-labels.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const AGENT = `claude#${ALICE}`;
const SIB = `sib#${ALICE}`;
const stamp = '2026-10-22T10:00:00.000Z';

const alice = labelActorOf({ sub: 'alice', owner: 'alice', roles: ['owner'] }, N);
const plain = labelActorOf({ sub: AGENT, owner: 'alice', roles: ['agent'], scopes: ['memory:read', 'memory:write'] }, N);
const word = labelActorOf({ sub: AGENT, owner: 'alice', roles: ['agent'], scopes: ['memory:read', 'memory:write', 'memory:read-as-owner'] }, N);
const app = labelActorOf({ sub: 'alice', owner: 'alice', roles: ['app'], app: 'alice/labels.html', scopes: ['memory:read', 'memory:write'] }, N);
const pat = labelActorOf({ sub: 'alice', owner: 'alice', roles: ['owner'], scopes: ['memory:read'], via: 'pat' } as never, N);

/** The owner's private record, a sibling's private record, an owner-visible record, the agent's own. */
const K = { secret: 'p.secret', sib: 'p.sib', shared: 'p.shared', mine: 'p.mine', none: 'p.none' };

describe('memory:read-as-owner on classification metadata', () => {
  let storage: SqliteStorage;
  const config: AimeatConfig = { ...loadConfig().config, nodeId: N, classificationMode: 'all', consentEnabled: true };
  const deps = () => ({ storage, config });
  const put = (ownerGaii: string, key: string, value: string, visibility: 'private' | 'owner') => storage.setMemory({
    key, ownerGaii, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
  } as never);

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: stamp });
    for (const gaii of [AGENT, SIB]) {
      await storage.createAgent({ name: gaii.split('#')[0]!, owner: 'alice', gaii, capabilities: [], publicKey: 'k', trustScore: 0, morselBalance: 0, createdAt: stamp, lastSeen: stamp } as AgentRecord);
    }
    await put(ALICE, K.secret, 'password: hunter22xyz', 'private');
    await put(SIB, K.sib, 'password: siblingsecret99', 'private');
    await put(ALICE, K.shared, 'password: sharedpass77', 'owner');
    await put(AGENT, K.mine, 'password: minepass55', 'private');
  });
  afterEach(() => storage.close());

  it('reads everything for the owner in person, an owner-level access token, an app grant and the word; not for a plain agent', () => {
    expect([alice, pat, app, word].map(labelActorReadsAll)).toEqual([true, true, true, true]);
    expect(labelActorReadsAll(plain)).toBe(false);
    const eco: LabelActor = { principal: `eco:drum#${ALICE}`, ownerGhii: ALICE, ownerName: 'alice', kind: 'ai', roles: ['ecosystem'], scopes: ['memory:read'] };
    expect(labelActorReadsAll(eco)).toBe(false);
  });

  describe('the scan (v76)', () => {
    it('answers private records of the owner and a sibling as missing, writes no label on them, and names the permission', async () => {
      const out = await scanContent(deps(), plain, { keys: [K.secret, K.sib, K.none] });
      expect(out.classified).toEqual([]);
      expect([...out.missing].sort()).toEqual([K.none, K.secret, K.sib].sort());
      expect(out.note).toBe(READ_AS_OWNER_NOTE);
      expect(await storage.getContentLabel({ kind: 'memory', scope: ALICE, key: K.secret })).toBeFalsy();
      expect(await storage.getContentLabel({ kind: 'memory', scope: SIB, key: K.sib })).toBeFalsy();
    });

    it('leaves hidden keys out of a prefix scan, with the note', async () => {
      const out = await scanContent(deps(), plain, { prefix: 'p.' });
      expect([...out.queued].sort()).toEqual([K.mine, K.shared].sort());
      expect(out.note).toBe(READ_AS_OWNER_NOTE);
    });

    it('queues a hidden named key past the first three under the agent itself, never the owner record', async () => {
      const out = await scanContent(deps(), plain, { keys: [K.mine, K.shared, K.none, K.secret] });
      expect(out.queued).toEqual([K.secret]);
      const queue = await readQueue(storage, N);
      expect(queue.some(i => i.scope === ALICE && i.key === K.secret)).toBe(false);
      expect(queue.some(i => i.scope === AGENT && i.key === K.secret)).toBe(true);
    });

    it('still judges the agent\'s own record and an owner record of visibility owner', async () => {
      const out = await scanContent(deps(), plain, { keys: [K.mine, K.shared] });
      expect(out.classified.map(c => c.key)).toEqual([K.mine, K.shared]);
      expect(out.missing).toEqual([]);
      expect(out.note).toBeUndefined();
    });

    it('still judges and queues everything for the owner, an app grant and an agent with the word', async () => {
      for (const who of [alice, app, word]) {
        const named = await scanContent(deps(), who, { keys: [K.secret, K.sib] });
        expect(named.classified.map(c => c.key)).toEqual([K.secret, K.sib]);
        expect(named.note).toBeUndefined();
        const prefix = await scanContent(deps(), who, { prefix: 'p.' });
        expect([...prefix.queued].sort()).toEqual([K.mine, K.secret, K.shared, K.sib].sort());
        expect(prefix.note).toBeUndefined();
      }
    });
  });

  describe('the explorer, the audit log, the exceptions and the label read (v77)', () => {
    beforeEach(async () => {
      // The owner labels each record in person; on her own she lowers with a written reason.
      await setLabel(deps(), alice, memoryTarget(ALICE, K.secret), { label: 'luottamuksellinen' });
      await setLabel(deps(), alice, memoryTarget(ALICE, K.secret), { label: 'sisainen', justification: 'contract with ACME ended' });
      await setLabel(deps(), alice, memoryTarget(SIB, K.sib), { label: 'erittain-luottamuksellinen' });
      await setLabel(deps(), alice, memoryTarget(ALICE, K.shared), { label: 'luottamuksellinen' });
      await setLabel(deps(), alice, memoryTarget(AGENT, K.mine), { label: 'luottamuksellinen' });
      await makeException(deps(), alice, { key: K.secret, action: 'leave', reason: 'to the accountant' });
      await makeException(deps(), alice, { key: K.shared, action: 'leave', reason: 'to the board' });
    });

    const explorerKeys = async (who: LabelActor) => {
      const page = await listLabels(deps(), who, explorerQueryOf({ limit: 200 }));
      return { keys: page.items.map(i => i.key).sort(), note: page.note, text: JSON.stringify(page) };
    };

    it('the explorer leaves out private records of the owner and a sibling, and names the permission', async () => {
      const out = await explorerKeys(plain);
      expect(out.keys).toEqual([K.mine, K.shared].sort());
      expect(out.note).toBe(READ_AS_OWNER_NOTE);
      expect(out.text).not.toContain('ACME');
    });

    it('the owner-level audit log and exceptions list leave them out, with the note', async () => {
      const audit = await readAuditLog(deps(), plain, 'owner', null);
      const keys = new Set(audit.rows.map(r => r.key));
      expect(keys.has(K.secret) || keys.has(K.sib)).toBe(false);
      expect(keys.has(K.shared) && keys.has(K.mine)).toBe(true);
      expect(audit.note).toBe(READ_AS_OWNER_NOTE);
      const ex = await readExceptions(deps(), plain, 'owner', null);
      expect(ex.exceptions.map(e => e.target?.key)).toEqual([K.shared]);
      expect(ex.note).toBe(READ_AS_OWNER_NOTE);
    });

    it('the label read answers the owner\'s private record exactly as an absent one, with the note', async () => {
      const hidden = await readContentLabel(deps(), plain, targetOf(plain, { key: K.secret }));
      const absent = await readContentLabel(deps(), plain, targetOf(plain, { key: K.none }));
      const shape = (v: typeof hidden) => ({ label: v.label, source: v.source, locked: v.locked, suggestion: v.suggestion, history: v.history, effective: v.effective, note: v.note });
      expect(shape(hidden)).toEqual(shape(absent));
      expect(hidden.note).toBe(READ_AS_OWNER_NOTE);
      expect(JSON.stringify(hidden)).not.toContain('ACME');
      const shared = await readContentLabel(deps(), plain, targetOf(plain, { key: K.shared }));
      expect(shared).toMatchObject({ label: 'luottamuksellinen', source: 'human' });
      expect(shared.note).toBeUndefined();
      const own = await readContentLabel(deps(), plain, targetOf(plain, { key: K.mine, owner: AGENT }));
      expect(own).toMatchObject({ label: 'luottamuksellinen', source: 'human' });
    });

    it('the owner, an app grant and an agent with the word still see every row and the reasons', async () => {
      for (const who of [alice, app, word]) {
        const out = await explorerKeys(who);
        expect(out.keys).toEqual([K.mine, K.secret, K.shared, K.sib].sort());
        expect(out.note).toBeUndefined();
        expect(out.text).toContain('ACME');
        const audit = await readAuditLog(deps(), who, 'owner', null);
        expect(audit.rows.some(r => r.key === K.secret) && audit.rows.some(r => r.key === K.sib)).toBe(true);
        expect(audit.note).toBeUndefined();
        const ex = await readExceptions(deps(), who, 'owner', null);
        expect(ex.exceptions.map(e => e.target?.key).sort()).toEqual([K.secret, K.shared].sort());
        const read = await readContentLabel(deps(), who, targetOf(who, { key: K.secret }));
        expect(read.label).toBe('sisainen');
        expect(JSON.stringify(read.history)).toContain('ACME');
        expect(read.note).toBeUndefined();
      }
    });

    it('keeps a label whose record no longer exists, as before (an exception on a key never written)', async () => {
      const e = await makeException(deps(), alice, { key: 'p.never', action: 'leave', reason: 'planned' });
      expect((await readExceptions(deps(), plain, 'owner', null)).exceptions.map(x => x.id)).toContain(e.id);
    });
  });
});
