/**
 * @file e2e-attachment-sweep.ts
 * @description In-process test for the direct-message attachment retry/expiry sweep (DECISION #10):
 *   a held (reference) attachment is duplicated when bytes become available, and is marked `expired`
 *   once it is older than the retry TTL. Boots a node to obtain a real Storage, crafts inbound
 *   message rows directly, and calls sweepReferenceAttachments().
 * @usage cd aimeat && pnpm exec tsx test/e2e-attachment-sweep.ts
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial: retry-on-available + TTL-expiry coverage for the attachment sweep.
 */
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { sweepReferenceAttachments } from '../src/services/attachment-duplication.js';
import type { DirectMessageRecord } from '../src/storage/interface.js';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

process.env.AIMEAT_PORT = '40282';
process.env.AIMEAT_NODE_ID = 'aimeat-local-001-dev';
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
process.env.AIMEAT_STORAGE = 'memory';
process.env.AIMEAT_ADMIN_PASSWORD = 'x';

const { config } = loadConfig({});
config.nodeId = 'aimeat-local-001-dev';
config.storageProvider = 'memory';
config.messageRetryTtlHours = 168;   // 7 days

const { storage } = await createServer(config);
await storage.ready;

const NODE = config.nodeId;
const recipient = `rcpt@${NODE}`;
const sender = `sndr@${NODE}`;
const ctx = { config, storage, peers: new Map() };

function inbound(id: string, createdAt: string, att: any): DirectMessageRecord {
  return {
    id, ownerGhii: recipient, conversationId: `conv-${id}`, senderGhii: sender, recipientGhii: recipient,
    body: 'see attachment', attachments: [att], status: 'delivered', direction: 'inbound',
    origin: 'local', originNodeId: NODE, createdAt, deliveredAt: createdAt,
  };
}

console.log('\n=== AIMEAT Attachment Sweep E2E ===\n');

await test('1. Held attachment with available bytes is duplicated on sweep', async () => {
  // Sender's original file exists locally → the recipient can duplicate it.
  await storage.createStorageFile({
    key: 'att-ok', ownerGaii: sender, visibility: 'private',
    mimeType: 'image/png', size: 5, data: Buffer.from('hello'), tags: [], createdAt: new Date().toISOString(),
  });
  const id = 'msg-ok';
  await storage.createDirectMessage(inbound(id, new Date().toISOString(), {
    id: 'a1', inline: false, storageKey: 'att-ok', ownerGhii: sender, originNodeId: NODE,
    mode: 'reference', mime: 'image/png', size: 5, kind: 'image',
  }));

  await sweepReferenceAttachments(ctx);

  const m = await storage.getDirectMessage(id, recipient);
  const a = m?.attachments?.[0];
  assert(a?.mode === 'duplicate', `expected duplicate, got ${a?.mode}`);
  assert(typeof a?.localKey === 'string', 'localKey set after duplication');
  const f = await storage.getStorageFile(recipient, a!.localKey!);
  assert(!!f && f.size === 5, 'duplicated file exists in recipient storage');
});

await test('2. Held attachment older than the TTL is expired (not retried forever)', async () => {
  const old = new Date(Date.now() - 8 * 24 * 3600_000).toISOString();   // 8 days > 7-day TTL
  const id = 'msg-old';
  await storage.createDirectMessage(inbound(id, old, {
    id: 'a1', inline: false, storageKey: 'missing-key', ownerGhii: sender, originNodeId: NODE,
    mode: 'reference', mime: 'image/png', size: 5, kind: 'image',
  }));

  await sweepReferenceAttachments(ctx);

  const m = await storage.getDirectMessage(id, recipient);
  const a = m?.attachments?.[0];
  assert(a?.expired === true, `expected expired, got ${JSON.stringify(a)}`);
  assert(a?.mode === 'reference', 'expired attachment stays reference (no localKey)');
});

await test('3. Expired attachment is not retried again', async () => {
  const m0 = await storage.getDirectMessage('msg-old', recipient);
  // Even if bytes become available, an already-expired attachment is terminal.
  await storage.createStorageFile({
    key: 'missing-key', ownerGaii: sender, visibility: 'private',
    mimeType: 'image/png', size: 5, data: Buffer.from('late!'), tags: [], createdAt: new Date().toISOString(),
  });
  await sweepReferenceAttachments(ctx);
  const m = await storage.getDirectMessage('msg-old', recipient);
  assert(m?.attachments?.[0]?.mode === 'reference' && m?.attachments?.[0]?.expired === true,
    'expired attachment remains expired/reference');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
process.exit(0);
