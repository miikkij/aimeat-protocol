/**
 * @file test/unit/security-profile-bind-host.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address the node listens on (AIMEAT_BIND_HOST) and the security profile
 *   (secaudit2026oct26, local-profile-from-default-baseurl-on-network-reachable-listener). A node set
 *   to listen beyond this computer does not take the local profile by default, because the local
 *   profile lets the node's own fetches reach this computer's loopback services. A node with no bind
 *   address keeps the profile its base URL gives it, so no existing install changes; an explicit
 *   AIMEAT_SECURITY_PROFILE still wins.
 * @usage cd aimeat && pnpm exec vitest run test/unit/security-profile-bind-host.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { defaultSecurityProfile, listensBeyondLoopback } from '../../src/config-private-host.js';
import { loadConfig } from '../../src/config.js';

const VARS = ['AIMEAT_BASE_URL', 'AIMEAT_SECURITY_PROFILE', 'AIMEAT_NODE_TYPE', 'AIMEAT_ALLOW_PRIVATE_EGRESS', 'AIMEAT_BIND_HOST'] as const;
type Vars = Partial<Record<typeof VARS[number], string>>;

function load(vars: Vars) {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) { const v = vars[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try {
    const config = loadConfig({ configPath: 'test/.no-such-config-file.ini' }).config;
    return { config, egress: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

describe('which bind addresses reach beyond this computer', () => {
  it.each(['0.0.0.0', '::', '[::]', '192.168.1.20', 'my-host.lan'])('%s does', (h) => {
    expect(listensBeyondLoopback(h)).toBe(true);
  });
  it.each(['', '  ', '127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]'])('"%s" does not', (h) => {
    expect(listensBeyondLoopback(h)).toBe(false);
  });
});

describe('the default profile with a bind address', () => {
  it('a localhost node set to listen on every network is not local, and its loopback egress is off', () => {
    const { config, egress } = load({ AIMEAT_BIND_HOST: '0.0.0.0' });
    expect(config.bindHost).toBe('0.0.0.0');
    expect(config.securityProfile).toBe('public');
    expect(config.allowPrivateEgress).toBe(false);
    expect(egress).toBe('false');
  });

  it('a personal node set to listen on every network is not local either', () => {
    expect(defaultSecurityProfile('http://localhost:41050', 'personal', '0.0.0.0')).toBe('public');
  });

  it('a node bound to 127.0.0.1 keeps the local profile and reaches a model server on this computer', () => {
    const { config, egress } = load({ AIMEAT_BIND_HOST: '127.0.0.1' });
    expect(config.bindHost).toBe('127.0.0.1');
    expect(config.securityProfile).toBe('local');
    expect(egress).toBe('true');
  });

  it('a node with no bind address keeps the profile its base URL gives it (every existing install)', () => {
    expect(load({}).config.securityProfile).toBe('local');
    expect(load({}).config.bindHost).toBe('');
    expect(load({ AIMEAT_BASE_URL: 'https://node.example.org' }).config.securityProfile).toBe('public');
    expect(load({ AIMEAT_BASE_URL: 'http://192.168.1.20:40050' }).config.securityProfile).toBe('local');
  });

  it('an explicit profile still wins, and so does an explicit egress setting', () => {
    expect(load({ AIMEAT_BIND_HOST: '0.0.0.0', AIMEAT_SECURITY_PROFILE: 'local' }).config.securityProfile).toBe('local');
    expect(load({ AIMEAT_BIND_HOST: '0.0.0.0', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true' }).config.allowPrivateEgress).toBe(true);
  });
});
