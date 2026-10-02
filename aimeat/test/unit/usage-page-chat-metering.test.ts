/**
 * @file test/unit/usage-page-chat-metering.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Usage page says whether the chat is in its figures
 *   (services/usage-page.ts keys.chat.metered_here): not on the shared chat key, yes on the node route.
 *   Hosted places moved off the shared key on 2026-10-02, and the page said "not measured" on every
 *   node with a chat until then.
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { buildUsagePage } from '../../src/services/usage-page.js';

const cfg = (gooseProviderApiKey: string) => ({
  nodeId: 'node-test', gooseBin: '/usr/local/bin/goose', gooseModel: '', gooseProviderApiKey,
  openrouterInstanceKey: 'sk-place', chatFreeAllowanceUsd: 1000,
}) as unknown as AimeatConfig;

describe('the Usage page and the chat', () => {
  it('on the node route the chat is metered here', async () => {
    const page = await buildUsagePage(cfg(''), new SqliteStorage(':memory:') as unknown as Storage);
    expect((page.keys as Record<string, { metered_here: boolean }>).chat.metered_here).toBe(true);
  });

  it('on the shared chat key it is not', async () => {
    const page = await buildUsagePage(cfg('sk-shared'), new SqliteStorage(':memory:') as unknown as Storage);
    expect((page.keys as Record<string, { metered_here: boolean }>).chat.metered_here).toBe(false);
  });
});
