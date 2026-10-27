/**
 * @file test/unit/desktop-local-ai-egress.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The desktop node opened to the local network (AIMEAT_BIND_HOST=0.0.0.0) runs with the
 *   public profile, where loopback egress is off and an account's provider cannot be on the node's
 *   machine. The desktop then writes the AI server the person chose on this computer as a provider of
 *   the node itself (AIMEAT_AI_PROVIDERS) with its one exact address (AIMEAT_AI_PROVIDER_EGRESS),
 *   as aimeat-desktop/src-tauri/src/local_ai.rs does. This checks the node half with two real
 *   servers on loopback: the chosen one still answers the node's AI fetch, another loopback port is
 *   still refused (secaudit2026oct26, local-profile-from-default-baseurl-on-network-reachable-listener).
 * @usage cd aimeat && pnpm exec vitest run test/unit/desktop-local-ai-egress.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadConfig } from '../../src/config.js';
import { nodeAiProviders, providerTarget } from '../../src/services/ai/providers.js';
import { aiFetch } from '../../src/services/ai/fetch.js';

const VARS = ['AIMEAT_BASE_URL', 'AIMEAT_SECURITY_PROFILE', 'AIMEAT_NODE_TYPE', 'AIMEAT_ALLOW_PRIVATE_EGRESS',
  'AIMEAT_BIND_HOST', 'AIMEAT_AI_PROVIDERS', 'AIMEAT_AI_PROVIDER_EGRESS'] as const;
const saved: Record<string, string | undefined> = {};

function server(body: string): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
const portOf = (s: Server) => (s.address() as AddressInfo).port;

let chosen: Server;
let other: Server;

beforeAll(async () => {
  for (const k of VARS) saved[k] = process.env[k];
  chosen = await server('{"data":[{"id":"qwen3-8b"}]}');
  other = await server('{"secret":"another service on this computer"}');
});
afterAll(() => {
  chosen.close(); other.close();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

/** The node's config as the desktop's .env sets it in local-network mode with a local AI server. */
function lanNode(baseUrl: string, origin: string) {
  for (const k of VARS) delete process.env[k];
  process.env.AIMEAT_BIND_HOST = '0.0.0.0';
  process.env.AIMEAT_AI_PROVIDERS = JSON.stringify([{
    id: 'desktop-local-ai', title: 'AI on this computer', type: 'local', baseUrl,
    auth: { type: 'none' }, capabilities: { text: { enabled: true, pool: true, model: 'qwen3-8b' } },
  }]);
  process.env.AIMEAT_AI_PROVIDER_EGRESS = origin;
  return loadConfig({ configPath: 'test/.no-such-config-file.ini' }).config;
}

describe('the desktop node on the local network and the AI server on this computer', () => {
  it('runs with the public profile and loopback egress off', () => {
    const config = lanNode(`http://localhost:${portOf(chosen)}/v1`, `http://localhost:${portOf(chosen)}`);
    expect(config.securityProfile).toBe('public');
    expect(process.env.AIMEAT_ALLOW_PRIVATE_EGRESS).toBe('false');
  });

  it('the chosen AI server still answers the node\'s AI fetch', async () => {
    const origin = `http://localhost:${portOf(chosen)}`;
    const config = lanNode(`${origin}/v1`, origin);
    const provider = nodeAiProviders(config).find(p => p.id === 'desktop-local-ai');
    expect(provider).toBeDefined();
    const target = providerTarget(provider!, config, undefined);
    expect(target.allowOrigins).toEqual([origin]);
    const res = await aiFetch({ allowOrigins: target.allowOrigins })(`${target.baseUrl}/models`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: 'qwen3-8b' }] });
  });

  it('another loopback port is still refused, by name and by address', async () => {
    const origin = `http://localhost:${portOf(chosen)}`;
    const config = lanNode(`${origin}/v1`, origin);
    const provider = nodeAiProviders(config).find(p => p.id === 'desktop-local-ai')!;
    const fetchFn = aiFetch({ allowOrigins: providerTarget(provider, config, undefined).allowOrigins });
    await expect(fetchFn(`http://localhost:${portOf(other)}/`)).rejects.toThrow();
    await expect(fetchFn(`http://127.0.0.1:${portOf(other)}/`)).rejects.toThrow();
    // Without the list there is no reach at all: the chosen server too is refused to a plain fetch.
    await expect(aiFetch({})(`http://localhost:${portOf(chosen)}/v1/models`)).rejects.toThrow();
  });
});
