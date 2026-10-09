/**
 * @file test/unit/consul-export.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A push to Consul KV leaves the secret rows out unless the operator asks for them
 *   (services/consul-export.ts). Secrets audit 2026-10-09, node configuration S3: the export wrote
 *   the node's AI keys and the TURN credential to Consul KV in plain text, the only door that did not
 *   ask isSecretField.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { planConsulExport } from '../../src/services/consul-export.js';

const config = {
  ...loadConfig().config,
  openrouterInstanceKey: 'sk-or-consul-canary-0001',
  gooseProviderApiKey: 'sk-ant-consul-canary-0002',
  turnCredential: 'turn-consul-canary-0003',
  welcomeBonus: 123,
  sealedConfigKeys: [],
} as AimeatConfig;

describe('the Consul export', () => {
  it('leaves every secret row out by default, and says how many', () => {
    const plan = planConsulExport(config);
    const written = JSON.stringify(plan.entries);
    for (const canary of ['sk-or-consul-canary-0001', 'sk-ant-consul-canary-0002', 'turn-consul-canary-0003']) {
      expect(written).not.toContain(canary);
    }
    expect(plan.entries.map(e => e.path)).not.toContain('ai.instance_key');
    expect(plan.secretsSkipped).toBeGreaterThanOrEqual(3);
    // An ordinary setting still goes.
    expect(plan.entries).toContainEqual({ path: 'morsel_policy.welcome_bonus', value: '123' });
  });

  it('writes them only when the operator asks', () => {
    const plan = planConsulExport(config, { includeSecrets: true });
    expect(plan.entries).toContainEqual({ path: 'ai.instance_key', value: 'sk-or-consul-canary-0001' });
    expect(plan.secretsSkipped).toBe(0);
  });

  it('leaves a sealed path out either way', () => {
    const sealed = { ...config, sealedConfigKeys: ['morsel_policy.welcome_bonus'] } as AimeatConfig;
    const plan = planConsulExport(sealed, { includeSecrets: true });
    expect(plan.entries.map(e => e.path)).not.toContain('morsel_policy.welcome_bonus');
    expect(plan.sealedSkipped).toBe(1);
  });
});
