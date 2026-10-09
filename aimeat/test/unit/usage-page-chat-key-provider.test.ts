/**
 * @file test/unit/usage-page-chat-key-provider.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Usage page asks OpenRouter what the shared chat key has spent only
 *   when that key is an OpenRouter key (services/usage-page.ts). Secrets audit 2026-10-09, finding
 *   1.6: the key was sent as a bearer to openrouter.ai whatever AIMEAT_GOOSE_PROVIDER said, so an
 *   Anthropic key went to OpenRouter.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const asked: Array<{ key: string | undefined; which: string }> = [];
vi.mock('../../src/services/openrouter-key.js', () => ({
  readKeySpend: async (_config: unknown, key: string | undefined, which: string) => {
    asked.push({ key, which });
    return { ok: true, which, usage_usd: 1 };
  },
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { buildUsagePage } from '../../src/services/usage-page.js';

const cfg = (gooseProvider: string, gooseProviderApiKey: string) => ({
  nodeId: 'node-test', gooseBin: '/usr/local/bin/goose', gooseModel: '', gooseProvider, gooseProviderApiKey,
  openrouterInstanceKey: 'sk-or-house', chatFreeAllowanceUsd: 1000,
}) as unknown as AimeatConfig;

const chatSpend = async (config: AimeatConfig) => {
  const page = await buildUsagePage(config, new SqliteStorage(':memory:') as unknown as Storage, { includeKeySpend: true });
  return (page.keys as Record<string, { spend: { ok: boolean; reason?: string } | null }>).chat.spend;
};

describe('the shared chat key and OpenRouter', () => {
  beforeEach(() => { asked.length = 0; });

  it('an Anthropic chat key is never sent to OpenRouter, and the page says why there is no figure', async () => {
    const spend = await chatSpend(cfg('anthropic', 'sk-ant-canary-0001'));
    expect(asked.map(a => a.key)).not.toContain('sk-ant-canary-0001');
    expect(asked.map(a => a.which)).toEqual(['house']);
    expect(spend?.ok).toBe(false);
    expect(spend?.reason).toMatch(/anthropic/);
  });

  it('with no provider named, a key that is not an OpenRouter key is not sent either', async () => {
    await chatSpend(cfg('', 'sk-proj-canary-0002'));
    expect(asked.map(a => a.key)).not.toContain('sk-proj-canary-0002');
  });

  it('an OpenRouter chat key is asked about, as before', async () => {
    await chatSpend(cfg('openrouter', 'sk-or-chat'));
    expect(asked).toContainEqual({ key: 'sk-or-chat', which: 'chat' });
    asked.length = 0;
    await chatSpend(cfg('', 'sk-or-v1-chat'));
    expect(asked).toContainEqual({ key: 'sk-or-v1-chat', which: 'chat' });
  });
});
