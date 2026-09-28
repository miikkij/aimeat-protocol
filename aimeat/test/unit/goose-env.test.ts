/**
 * @file goose-env.test.ts
 * @description Unit tests for the chat agent child's environment (src/services/goose-env.ts): the
 *   node's secrets stay out, what a process needs to run stays in, and the host's passthrough list
 *   and the node's own provider settings arrive.
 *
 *   The node route (System 2 plan, V5): without the shared key, a person's child points goose's
 *   OpenAI provider at this node's /v1/llm with that person's token, and carries no other provider
 *   key and no setting that could send a model call elsewhere.
 * @usage cd aimeat && pnpm vitest run test/unit/goose-env.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-28 — System 2 plan, V5: the node route and the shared key.
 *   v1.0.0 — 2026-09-16 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { gooseChildEnv, chatUsesSharedKey, NODE_CHOOSES_MODEL } from '../../src/services/goose-env.js';

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
  baseUrl: 'https://node.example.test',
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

describe('gooseChildEnv on the shared key', () => {
  it('is the shared key whenever the key is set, and a person\'s token changes nothing', () => {
    expect(chatUsesSharedKey(cfg())).toBe(true);
    const shared = gooseChildEnv(cfg(), parent, { token: 'tok-alice' });
    expect(shared).toEqual(gooseChildEnv(cfg(), parent));
    expect(shared.OPENROUTER_API_KEY).toBe('sk-chat');
    expect(JSON.stringify(shared)).not.toContain('tok-alice');
    expect(shared.OPENAI_API_KEY).toBeUndefined();
    expect(shared.OPENAI_HOST).toBeUndefined();
  });
});

describe('gooseChildEnv on the node route', () => {
  const route = (over: Partial<Parameters<typeof gooseChildEnv>[0]> = {}, env: NodeJS.ProcessEnv = parent) =>
    gooseChildEnv(cfg({ gooseProviderApiKey: '', ...over }), env, { token: 'tok-alice' });

  it('is the default: no shared key', () => {
    expect(chatUsesSharedKey(cfg({ gooseProviderApiKey: '' }))).toBe(false);
  });

  it('points goose\'s OpenAI provider at this node\'s /v1/llm with the person\'s own token', () => {
    const env = route();
    expect(env.GOOSE_PROVIDER).toBe('openai');
    expect(env.OPENAI_HOST).toBe('https://node.example.test');
    expect(env.OPENAI_BASE_PATH).toBe('v1/llm/chat/completions');
    expect(env.OPENAI_API_KEY).toBe('tok-alice');
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    // Nothing else changed: what a process needs to run and goose's own path root still arrive.
    expect(env.GOOSE_PATH_ROOT).toBe('/var/lib/aimeat/goose');
    expect(env.Path).toBe(parent.Path);
  });

  it('lets the node choose the model unless the operator named one', () => {
    expect(route({ gooseModel: '' }).GOOSE_MODEL).toBe(NODE_CHOOSES_MODEL);
    expect(route({ gooseModel: 'some/model' }).GOOSE_MODEL).toBe('some/model');
    // The operator's provider is for the shared key only: on this route it would take the calls away.
    expect(route({ gooseProvider: 'anthropic' }).GOOSE_PROVIDER).toBe('openai');
  });

  it('keeps a path the node is served under in the base path, not the host', () => {
    const env = route({ baseUrl: 'https://example.test/aimeat/' });
    expect(env.OPENAI_HOST).toBe('https://example.test');
    expect(env.OPENAI_BASE_PATH).toBe('aimeat/v1/llm/chat/completions');
    expect(route({ baseUrl: 'http://127.0.0.1:40050' }).OPENAI_HOST).toBe('http://127.0.0.1:40050');
  });

  it('removes every inherited setting that could send a model call somewhere else', () => {
    const host: NodeJS.ProcessEnv = {
      ...parent,
      GOOSE_PROVIDER: 'anthropic', GOOSE_MODEL: 'claude-x', GOOSE_PLANNER_PROVIDER: 'anthropic',
      GOOSE_PLANNER_MODEL: 'claude-y', GOOSE_SUBAGENT_PROVIDER: 'openrouter', goose_lead_model: 'z',
      OPENAI_BASE_URL: 'https://elsewhere.test/v1', OpenAI_Host: 'https://elsewhere.test',
      OPENROUTER_API_KEY: 'sk-host-openrouter',
    };
    const env = route({ gooseEnvPassthrough: ['OPENAI_BASE_URL', 'OpenAI_Host', 'OPENROUTER_API_KEY'] }, host);
    for (const name of ['GOOSE_PLANNER_PROVIDER', 'GOOSE_PLANNER_MODEL', 'GOOSE_SUBAGENT_PROVIDER', 'goose_lead_model',
      'OPENAI_BASE_URL', 'OpenAI_Host', 'OPENROUTER_API_KEY']) {
      expect(env[name], name).toBeUndefined();
    }
    expect(env.GOOSE_PROVIDER).toBe('openai');
    expect(env.OPENAI_HOST).toBe('https://node.example.test');
    expect(JSON.stringify(env)).not.toContain('elsewhere.test');
    expect(JSON.stringify(env)).not.toContain('sk-host-openrouter');
  });

  it('still keeps every node secret out', () => {
    const env = route();
    expect(Object.keys(env).some(k => k.startsWith('AIMEAT_'))).toBe(false);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('sk-chat');
  });
});
