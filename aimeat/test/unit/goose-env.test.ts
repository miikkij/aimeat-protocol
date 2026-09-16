/**
 * @file goose-env.test.ts
 * @description Unit tests for the chat agent child's environment (src/services/goose-env.ts): the
 *   node's secrets stay out, what a process needs to run stays in, and the host's passthrough list
 *   and the node's own provider settings arrive.
 * @usage cd aimeat && pnpm vitest run test/unit/goose-env.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-16 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { gooseChildEnv } from '../../src/services/goose-env.js';

const parent: NodeJS.ProcessEnv = {
  Path: 'C:\\Windows;C:\\bin', SystemRoot: 'C:\\Windows', HOME: '/home/node', LANG: 'en_US.UTF-8',
  LC_ALL: 'C.UTF-8', HTTPS_PROXY: 'http://proxy:3128', NODE_OPTIONS: '--import tsx',
  GOOSE_DISABLE_KEYRING: '1',
  DATABASE_URL: 'postgresql://u:p@db/aimeat', AIMEAT_PRIVATE_KEY: 'node-private-key',
  AIMEAT_ENCRYPTION_KEY: 'encryption-key', AIMEAT_SMTP_PASS: 'smtp-pass',
  AIMEAT_OPENROUTER_INSTANCE_KEY: 'sk-node-instance', AIMEAT_GOOSE_PROVIDER_API_KEY: 'sk-chat',
  ANTHROPIC_API_KEY: 'sk-ant', STRIPE_SECRET_KEY: 'sk_live_x',
};

const cfg = (over: Partial<Parameters<typeof gooseChildEnv>[0]> = {}) => ({
  goosePathRoot: '/var/lib/aimeat/goose', gooseProviderApiKey: 'sk-chat', gooseProvider: 'openrouter',
  gooseModel: 'some/model', gooseEnvPassthrough: [] as string[], ...over,
});

describe('gooseChildEnv', () => {
  it('keeps every node secret out of the child', () => {
    const env = gooseChildEnv(cfg(), parent);
    for (const name of ['DATABASE_URL', 'AIMEAT_PRIVATE_KEY', 'AIMEAT_ENCRYPTION_KEY', 'AIMEAT_SMTP_PASS',
      'AIMEAT_OPENROUTER_INSTANCE_KEY', 'AIMEAT_GOOSE_PROVIDER_API_KEY', 'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY']) {
      expect(env[name], name).toBeUndefined();
    }
    const values = JSON.stringify(env);
    expect(values).not.toContain('node-private-key');
    expect(values).not.toContain('sk-node-instance');
    expect(Object.keys(env).some(k => k.startsWith('AIMEAT_'))).toBe(false);
  });

  it('keeps what a process needs to run, whatever the case of the name', () => {
    const env = gooseChildEnv(cfg(), parent);
    expect(env.Path).toBe(parent.Path);
    expect(env.SystemRoot).toBe(parent.SystemRoot);
    expect(env.HOME).toBe('/home/node');
    expect(env.LC_ALL).toBe('C.UTF-8');
    expect(env.HTTPS_PROXY).toBe('http://proxy:3128');
    expect(env.GOOSE_DISABLE_KEYRING).toBe('1');
  });

  it('sets the provider settings the node owns, and only the key the chat spends', () => {
    const env = gooseChildEnv(cfg(), parent);
    expect(env.OPENROUTER_API_KEY).toBe('sk-chat');
    expect(env.GOOSE_PROVIDER).toBe('openrouter');
    expect(env.GOOSE_MODEL).toBe('some/model');
    expect(env.GOOSE_PATH_ROOT).toBe('/var/lib/aimeat/goose');
    const bare = gooseChildEnv(cfg({ gooseProviderApiKey: '', gooseProvider: '', gooseModel: '', goosePathRoot: '' }), {});
    expect(bare).toEqual({});
  });

  it('passes a name the host listed, and nothing it did not', () => {
    const env = gooseChildEnv(cfg({ gooseEnvPassthrough: ['ANTHROPIC_API_KEY'] }), parent);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant');
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });
});
