/**
 * @file test/unit/app-tool-checkout-binding.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app-tool checkout resolver (commerce/sellable-resolvers.ts) refuses a tool whose
 *   `action_id` names a capability the seller does not own when the session is opened and when it is
 *   completed, so nothing is collected for it. It refused only in fulfil, after the collect, and
 *   relied on the refund (secaudit 2026-10-31 inv-03). Usage kept: a tool bound to the seller's own
 *   capability resolves, and a tool whose capability is missing still opens a session (its refusal
 *   stays in fulfil, as test/e2e-commerce.ts test 24 asserts).
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-tool-checkout-binding.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-03).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { CapabilityRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { appToolSellableResolver } from '../../src/commerce/sellable-resolvers.js';

const NODE = 'unit-node';
const config = { nodeId: NODE, pacingTollDefault: 0, extensionMaxDebitPerCall: 1000 } as unknown as AimeatConfig;

function cap(id: string, ownerGhii: string): CapabilityRecord {
  const now = new Date().toISOString();
  return {
    id, name: id, summary: '', ownerGhii, visibility: 'public', scope: 'local', status: 'active',
    rejectionReason: null, deprecationMessage: null, replacedBy: null,
    source: { type: 'webhook', ref: 'https://example.test/hook', version: '1.0.0' }, authRequired: 'registered', callable: true,
    inputSchema: null, outputSchema: null, exports: null, usage: '', whenToUse: '', whenNotToUse: '',
    examples: [], dependencies: [], schemaHash: 'x', webhookUrl: null, cost: null, trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [], operatorOverride: null,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: [], createdAt: now, updatedAt: now,
  } as CapabilityRecord;
}

describe('app-tool checkout resolve and the capability a manifest binds', () => {
  let storage: SqliteStorage;
  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    await storage.createCapability(cap('cap-sellers', `sally@${NODE}`));
    await storage.createCapability(cap('cap-victims', `victor@${NODE}`));
    const now = new Date().toISOString();
    await storage.setMemory({
      key: 'apps.shop.html.tools', ownerGaii: `sally@${NODE}`, visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      value: { version: 1, tools: [
        { name: 'own', description: 'the seller\'s own capability', action_id: 'cap-sellers', tollMorsels: 2 },
        { name: 'borrowed', description: 'another owner\'s capability', action_id: 'cap-victims', tollMorsels: 2 },
        { name: 'missing', description: 'a capability that does not exist', action_id: 'cap-nowhere', tollMorsels: 2 },
      ] },
    });
  });
  const resolve = (tool: string) => appToolSellableResolver().resolve(storage, config, { kind: 'app-tool', app: 'sally/shop.html', tool }, 'bob');

  it('refuses a tool bound to a capability the seller does not own before a session opens', async () => {
    await expect(resolve('borrowed')).rejects.toMatchObject({ code: 'CAPABILITY_NOT_OWNED_BY_APP', statusCode: 403 });
  });

  it('usage kept: the seller\'s own capability resolves, and a missing one still opens a session', async () => {
    expect(await resolve('own')).toMatchObject({ kind: 'app-tool', sellerOwner: 'sally', tollMorsels: 2 });
    expect(await resolve('missing')).toMatchObject({ kind: 'app-tool', sellerOwner: 'sally', tollMorsels: 2 });
  });
});
