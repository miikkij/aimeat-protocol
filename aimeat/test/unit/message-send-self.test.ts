/**
 * @file test/unit/message-send-self.test.ts
 * @description A message whose sender and recipient are the same person, driven against real SQLite.
 *
 *   The route refuses a person writing to themselves, but the node itself does it on purpose: every
 *   system-fault report is operator → operator. sendDirectMessage wrote a sender copy and a recipient
 *   copy under the same (id, owner) key, so the second insert hit the primary key and threw. Every
 *   fault report failed that way, and so did a campaign send to the sender's own address
 *   (POST /v1/outbound/send, 2026-09-15, "duplicate key value violates unique constraint
 *   DirectMessage_pkey").
 * @usage cd aimeat && pnpm exec vitest run test/unit/message-send-self.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { sendDirectMessage } from '../../src/services/message-send.js';

const NODE_ID = 'unit-node';
const OP = `op@${NODE_ID}`;
let storage: Storage;
const config = { nodeId: NODE_ID, baseUrl: 'http://localhost' } as unknown as AimeatConfig;

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  await storage.createOwner({ name: 'op', displayName: 'op', publicKey: 'dGVzdA==', roles: ['owner'], createdAt: now });
});

describe('a message to yourself', () => {
  it('is written once and lands in your own inbox', async () => {
    const result = await sendDirectMessage({ config, storage, peers: new Map() }, {
      senderGhii: OP, recipientGhii: OP, subject: 'Fault: INTERNAL_ERROR on /v1/outbound/send',
      body: 'The node answered INTERNAL_ERROR.', kind: 'system-fault', skipContactGate: true,
    });
    expect(result.ok).toBe(true);

    const inbox = await storage.listInbox(OP);
    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0].subject).toBe('Fault: INTERNAL_ERROR on /v1/outbound/send');
    expect(inbox.messages[0].readAt).toBeFalsy();
  });

  it('does not make you a contact of yourself', async () => {
    await sendDirectMessage({ config, storage, peers: new Map() }, {
      senderGhii: OP, recipientGhii: OP, body: 'note', skipContactGate: true,
    });
    expect(await storage.getContact(OP, OP)).toBeNull();
  });
});
