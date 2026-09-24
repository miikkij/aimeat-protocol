/**
 * @file test/unit/notification-actions.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A notification's buttons are the node's own. The owner's browser runs an `api` button
 *   with the owner's own session (the bell, the Notifications page, a push click), so two things are
 *   held here: where a button may point (services/notify.ts isSafeNotifActionEndpoint, the one rule),
 *   and who may write a notification record at all (utils/reserved-keys.ts: only the node, through
 *   notify()). The HTTP doors, the serving route and the node's own buttons are asserted end to end in
 *   test/e2e-notifications.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notification-actions.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { notify, isSafeNotifActionEndpoint, type NotifAction } from '../../src/services/notify.js';
import { writeMemoryRecord } from '../../src/services/memory-write.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';

let storage: Storage;
let config: AimeatConfig;
let NODE = '';
let OWNER = '';
let AGENT = '';

beforeAll(async () => {
  config = loadConfig().config;
  NODE = config.nodeId;
  OWNER = `alice@${NODE}`;
  AGENT = `claude#alice@${NODE}`;
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

/** A button that sends the owner's session to another site. */
const STEAL: NotifAction = { id: 'steal', label: 'Open', kind: 'api', method: 'POST', endpoint: 'https://evil.example/steal' };
/** A button of the node's own kind: a door of this node's API. */
const APPROVE: NotifAction = {
  id: 'approve', label: 'Approve', kind: 'api', method: 'POST',
  endpoint: '/v1/organisms/org-1/join-requests/jr-1/review', body: { decision: 'approved' },
};
const VIEW: NotifAction = { id: 'view', label: 'View', kind: 'navigate', link: '/v1/profile#organisms' };

describe('where a notification button may point', () => {
  it('a door of this node\'s own API is kept', () => {
    for (const path of [
      '/v1/organisms/org-1/join-requests/jr-1/review',
      '/v1/organisms/org-1/invitations/accept',
      '/v1/organisms/org-1/workspace-access/decision',
      '/v1/apps/alice/notes.html/members/requests/bob',
    ]) {
      expect(isSafeNotifActionEndpoint(path), path).toBe(true);
    }
  });

  it('an address off this node, or off its API, is refused', () => {
    for (const path of [
      'https://evil.example/steal', '//evil.example/steal', '/\\evil.example/steal', '/\t/evil.example',
      // A path of this node that is not its API: a page, the root, another version.
      '/evil', '/', '/v1', '/v2/organisms', '/spa.html#access',
      // Under /v1/ as typed, and somewhere else once a browser resolves the dot segments.
      '/v1/../evil', '/v1/%2e%2e/evil', '/v1/x/../../evil',
      '/v1/' + 'a'.repeat(500), '', 42, null, undefined,
    ]) {
      expect(isSafeNotifActionEndpoint(path), JSON.stringify(path)).toBe(false);
    }
  });
});

describe('notify() stores only the buttons the node would serve', () => {
  it('drops a button that points off the node\'s API and keeps the others', async () => {
    const r = await notify(storage, OWNER, { type: 'test_actions', title: 'Three buttons', actions: [STEAL, APPROVE, VIEW] });
    expect(r.stored).toBe(true);
    const rows = await storage.listMemory(OWNER, { prefix: 'notif.' });
    const row = rows.find(x => (x.value as { type?: string }).type === 'test_actions');
    expect(row, 'the notification was stored').toBeTruthy();
    const ids = ((row!.value as { actions: NotifAction[] }).actions).map(a => a.id);
    expect(ids).toEqual(['approve', 'view']);
  });
});

describe('a notification record is written only by the node', () => {
  const record = () => ({
    id: 'planted', type: 'custom', title: 'Your session expired', body: '', link: '', read: false,
    createdAt: new Date().toISOString(), actions: [STEAL],
  });

  it('the memory writer every door shares refuses it to the owner', async () => {
    const out = await writeMemoryRecord({ storage, config },
      { principal: OWNER, targetGaii: OWNER, scopes: [], roles: ['owner'] },
      { key: `notif.${new Date().toISOString()}.owner`, value: record(), visibility: 'private', pipeline: 'test' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(403);
    expect(out.code).toBe('RESERVED_KEY');
    expect(out.message).toContain('POST /v1/notifications');
  });

  it('and to an agent, in the owner\'s namespace and in its own', async () => {
    for (const target of [OWNER, AGENT]) {
      const out = await writeMemoryRecord({ storage, config },
        { principal: target, targetGaii: target, scopes: ['memory:write', 'memory:write-as-owner', 'memory:write-reserved'], roles: ['agent'] },
        { key: `notif.${new Date().toISOString()}.agent`, value: record(), visibility: 'private', pipeline: 'test' });
      expect(out.ok, target).toBe(false);
      if (!out.ok) expect(out.code, target).toBe('RESERVED_KEY');
    }
  });

  it('an extension\'s ctx.memory.set refuses it too', async () => {
    const ctx = buildExtensionCtx({
      config, storage: storage as never, extMemoryOwner: 'ext:probe',
      caller: { gaii: OWNER, owner: 'alice', roles: ['owner'] } as never, extConfig: {}, logPrefix: 'test',
    });
    await expect(ctx.memory.set(`notif.${new Date().toISOString()}.ext`, record())).rejects.toThrow(/RESERVED_KEY/);
  });

  it('nothing any of them tried was stored', async () => {
    for (const owner of [OWNER, AGENT, 'ext:probe']) {
      const rows = await storage.listMemory(owner, { prefix: 'notif.' });
      expect(rows.filter(r => (r.value as { id?: string }).id === 'planted'), owner).toEqual([]);
    }
  });
});
