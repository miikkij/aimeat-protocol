/**
 * @file test/unit/classification-node-level.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who acts at the node level of classification: the node policy, the node audit log and
 *   the node exceptions list. The PRINCIPAL is asked, not the account behind it (security DNA
 *   invariant 11): the operator in person passes, an operator's agent, app or ecosystem app passes
 *   only with "operator:admin", and "Full access" does not include it. Until 2026-09-30 the check
 *   asked whether the account was an operator, so any credential of the operator read every owner's
 *   audit keys and exception reasons and could rewrite the node policy (TARGET-082 second review,
 *   finding S1).
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-node-level.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { readAuditLog, reviewPolicy, writePolicy } from '../../src/services/classification/policy-admin.js';
import { readExceptions } from '../../src/services/classification/exception-admin.js';
import { ClassificationError, type LabelActor } from '../../src/services/classification/labels.js';

const N = 'test-node';
const OP = `op@${N}`;
const config = { classificationMode: 'all' as const, nodeId: N };

const inPerson: LabelActor = { principal: OP, ownerGhii: OP, ownerName: 'op', kind: 'human', roles: ['owner', 'operator'], scopes: [] };
const agent = (scopes: string[]): LabelActor => ({ principal: `claude#${OP}`, ownerGhii: OP, ownerName: 'op', kind: 'ai', roles: ['agent'], scopes });
const app = (scopes: string[]): LabelActor => ({ principal: OP, ownerGhii: OP, ownerName: 'op', kind: 'human', roles: ['app'], scopes, app: 'op/tool.html' });
const eco = (scopes: string[]): LabelActor => ({ principal: `eco:watch#${OP}`, ownerGhii: OP, ownerName: 'op', kind: 'ai', roles: ['ecosystem'], scopes });

async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'OK'; } catch (e) { return e instanceof ClassificationError ? e.code : String(e); }
}

/** Every label hidden from AI: a tightening, which an AI's change applies at once. */
const hideAll = () => {
  const p = defaultPolicy();
  return { ...p, labels: p.labels.map(l => ({ ...l, aiVisibility: 'hidden' as const })) };
};
/** Every label allowed for AI: a loosening. */
const allowAll = () => {
  const p = defaultPolicy();
  return { ...p, labels: p.labels.map(l => ({ ...l, aiVisibility: 'allowed' as const })) };
};

describe('the node level asks the principal, not the account', () => {
  let storage: SqliteStorage;
  let deps: { storage: SqliteStorage; config: typeof config };

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    const stamp = new Date().toISOString();
    await storage.createOwner({ name: 'op', displayName: 'op', publicKey: 'pk', roles: ['owner', 'operator'], createdAt: stamp });
    await storage.createOwner({ name: 'alice', displayName: 'alice', publicKey: 'pk', roles: ['owner'], createdAt: stamp });
    deps = { storage, config };
  });
  afterEach(() => storage.close?.());

  it('the operator in person reads the node log and the exceptions, and sets the node policy', async () => {
    expect(await code(readAuditLog(deps, inPerson, 'node', null))).toBe('OK');
    expect(await code(readExceptions(deps, inPerson, 'node', null))).toBe('OK');
    expect(await code(writePolicy(deps, inPerson, 'node', null, hideAll()))).toBe('OK');
  });

  for (const [who, make] of [['an agent', agent], ['an app', app], ['an ecosystem app', eco]] as const) {
    it(`${who} of the operator without "operator:admin" reads no node log and no node exceptions`, async () => {
      expect(await code(readAuditLog(deps, make(['*']), 'node', null))).toBe('OPERATOR_REQUIRED');
      expect(await code(readExceptions(deps, make(['*']), 'node', null))).toBe('OPERATOR_REQUIRED');
    });

    it(`${who} of the operator without "operator:admin" neither tightens nor loosens the node policy`, async () => {
      expect(await code(writePolicy(deps, make(['*']), 'node', null, hideAll()))).toBe('OPERATOR_REQUIRED');
      expect(await code(writePolicy(deps, make(['*']), 'node', null, allowAll()))).toBe('OPERATOR_REQUIRED');
    });
  }

  it('an app of the operator without "operator:admin" accepts no waiting node proposal', async () => {
    const proposed = await writePolicy(deps, agent(['operator:admin']), 'node', null, allowAll());
    expect(proposed.pending).toBe('PERSON_APPROVES');
    expect(await code(reviewPolicy(deps, app(['*']), 'node', null, 'accept'))).toBe('OPERATOR_REQUIRED');
  });

  it('an agent of the operator WITH "operator:admin" reads the node log', async () => {
    expect(await code(readAuditLog(deps, agent(['operator:admin']), 'node', null))).toBe('OK');
  });

  it('another owner in person is no operator', async () => {
    const alice: LabelActor = { principal: `alice@${N}`, ownerGhii: `alice@${N}`, ownerName: 'alice', kind: 'human', roles: ['owner'], scopes: [] };
    expect(await code(readAuditLog(deps, alice, 'node', null))).toBe('OPERATOR_REQUIRED');
  });
});
