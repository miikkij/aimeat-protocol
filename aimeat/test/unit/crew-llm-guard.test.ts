/**
 * @file test/unit/crew-llm-guard.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an owner's model choice for a crew may name (services/crew-llm-guard.ts): a
 *   provider key variable only (an allow-list), and a public https address only. Literal addresses,
 *   so no test depends on a name lookup.
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { keyEnvProblem, crewAddressProblem, crewChoiceProblem } from '../../src/services/crew-llm-guard.js';
import { validChoice } from '../../src/services/crew-menu.js';

describe('keyEnvProblem: an allow-list of provider key variables', () => {
  it.each(['OPENROUTER_API_KEY', 'XAI_API_KEY', 'MY_VENDOR_API_KEY', 'NVIDIA_KEY'])('allows %s', (name) => {
    expect(keyEnvProblem(name)).toBeNull();
  });

  it.each(['AIMEAT_ENCRYPTION_KEY', 'AIMEAT_OPENROUTER_API_KEY', 'DATABASE_URL', 'AIMEAT_ADMIN_PASSWORD', 'SMTP_PASS', 'openrouter_api_key', 'API_KEY', ''])(
    'refuses %s and names what is allowed', (name) => {
      const problem = keyEnvProblem(name);
      expect(problem).toMatch(/_API_KEY/);
      if (name) expect(problem).toContain(name);
    },
  );
});

describe('crewAddressProblem: public https only', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = { a: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS, d: process.env.AIMEAT_DEV_MODE };
    delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
    delete process.env.AIMEAT_DEV_MODE;
  });
  afterEach(() => {
    if (saved.a === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS; else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = saved.a;
    if (saved.d === undefined) delete process.env.AIMEAT_DEV_MODE; else process.env.AIMEAT_DEV_MODE = saved.d;
  });

  it('allows a public https address', async () => {
    expect(await crewAddressProblem('https://8.8.8.8/v1')).toBeNull();
  });

  it.each([
    ['http://8.8.8.8/v1', /https/],
    ['https://127.0.0.1/v1', /Loopback|Localhost/i],
    ['https://localhost/v1', /Localhost/i],
    ['https://10.0.0.5/v1', /Private/],
    ['https://192.168.1.10/v1', /Private/],
    ['https://169.254.169.254/latest', /Link-local/i],
    ['https://[::1]/v1', /loopback/i],
    ['https://[fe80::1]/v1', /link-local/i],
    ['https://100.64.0.1/v1', /Carrier-grade/],
    ['not a url', /not an address/],
  ])('refuses %s', async (url, why) => {
    expect(await crewAddressProblem(url)).toMatch(why);
  });
});

describe('crewChoiceProblem: the whole provider block', () => {
  it('checks the key variable and every address, one level down too', async () => {
    expect(await crewChoiceProblem({ type: 'openai', api_key_env: 'OPENROUTER_API_KEY', base_url: 'https://8.8.8.8/v1', models: [{ id: 'm' }] })).toBeNull();
    expect(await crewChoiceProblem({ type: 'openai', api_key_env: 'AIMEAT_ENCRYPTION_KEY' })).toMatch(/AIMEAT_ENCRYPTION_KEY/);
    expect(await crewChoiceProblem({ type: 'openai', api_key_env: 'OPENROUTER_API_KEY', models: [{ id: 'm', api_base: 'http://8.8.8.8' }] })).toMatch(/https/);
  });

  it('a provider with no key variable and no address is a keyless local model and passes', async () => {
    expect(await crewChoiceProblem({ type: 'ollama', models: [{ id: 'llama3' }] })).toBeNull();
  });
});

describe('validChoice: the node shape', () => {
  it('accepts {kind:"node"} with or without a role, and keeps only its own fields', () => {
    expect(validChoice({ kind: 'node' })).toEqual({ kind: 'node' });
    expect(validChoice({ kind: 'node', role: ' reasoning ', extra: 'x' })).toEqual({ kind: 'node', role: 'reasoning' });
  });

  it('refuses an empty or over-long role', () => {
    expect(validChoice({ kind: 'node', role: '' })).toBeNull();
    expect(validChoice({ kind: 'node', role: 'x'.repeat(301) })).toBeNull();
    expect(validChoice({ kind: 'node', role: 7 })).toBeNull();
  });
});
