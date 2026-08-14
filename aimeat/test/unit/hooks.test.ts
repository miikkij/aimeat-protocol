import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { executeHooks } from '../../src/services/hooks.js';
import { fireHook } from '../../src/utils/fire-hook.js';
import type { AimeatConfig, ExtensionHooks } from '../../src/config.js';
import type { ActionRecord } from '../../src/storage/interface.js';

// Partial mock: stub validateOutboundUrl to skip real DNS lookups, but keep the
// real safeFetch (hooks.ts sends webhooks through it) so the global-fetch spy fires.
vi.mock('../../src/utils/url-validator.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/url-validator.js')>()),
  validateOutboundUrl: vi.fn().mockResolvedValue({ valid: true }),
}));

const now = new Date().toISOString();

/** Build a minimal AimeatConfig with the given extension hooks. */
function makeConfig(hooks: Partial<ExtensionHooks> = {}): AimeatConfig {
  const emptyHooks: ExtensionHooks = {
    pre_owner_registration: [],
    post_owner_registration: [],
    pre_agent_registration: [],
    post_agent_registration: [],
    owner_recovery: [],
    agent_rekey: [],
    pre_work_request: [],
    post_work_delivery: [],
    post_settlement: [],
    pre_board_post: [],
    pre_federation_peer: [],
  };
  return {
    nodeId: 'test-node-001',
    extensionHooks: { ...emptyHooks, ...hooks },
  } as unknown as AimeatConfig;
}

/** Build a minimal ActionRecord for testing. */
function makeAction(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: 'test-action',
    providerGaii: 'agent1#owner1@test-node',
    displayName: 'Test Action',
    description: 'A test hook action',
    category: 'hook',
    inputSchema: {},
    outputSchema: {},
    pricing: { baseMorsels: 0 },
    tags: [],
    webhookUrl: 'https://example.com/hook',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Hook execution (executeHooks)', () => {
  let storage: SqliteStorage;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Hook dispatch ──────────────────────────────────────────

  it('fires hook for a registered event', async () => {
    const action = makeAction({ id: 'hook-action-1' });
    await storage.createAction(action);

    const config = makeConfig({
      pre_owner_registration: ['hook-action-1'],
    });

    const result = await executeHooks(config, storage, 'pre_owner_registration', { owner: 'alice' });

    expect(result.allowed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('does not fire for an unregistered event', async () => {
    const action = makeAction({ id: 'hook-action-1' });
    await storage.createAction(action);

    // Register hook only for pre_owner_registration, but fire pre_agent_registration
    const config = makeConfig({
      pre_owner_registration: ['hook-action-1'],
    });

    const result = await executeHooks(config, storage, 'pre_agent_registration', { agent: 'bob' });

    expect(result.allowed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fires multiple hooks for same event', async () => {
    const action1 = makeAction({ id: 'hook-A', webhookUrl: 'https://example.com/hook-a' });
    const action2 = makeAction({ id: 'hook-B', webhookUrl: 'https://example.com/hook-b' });
    await storage.createAction(action1);
    await storage.createAction(action2);

    const config = makeConfig({
      pre_board_post: ['hook-A', 'hook-B'],
    });

    const result = await executeHooks(config, storage, 'pre_board_post', { board: 'general' });

    expect(result.allowed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const urls = fetchSpy.mock.calls.map(call => call[0]);
    expect(urls).toContain('https://example.com/hook-a');
    expect(urls).toContain('https://example.com/hook-b');
  });

  it('passes correct payload in webhook body', async () => {
    const action = makeAction({ id: 'payload-hook' });
    await storage.createAction(action);

    const config = makeConfig({
      post_owner_registration: ['payload-hook'],
    });

    const context = { owner: 'alice', email: 'alice@example.com' };
    await executeHooks(config, storage, 'post_owner_registration', context);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.hook).toBe('post_owner_registration');
    expect(body.action_ref).toBe('payload-hook');
    expect(body.context).toEqual(context);
    expect(body.node_id).toBe('test-node-001');
    expect(body.timestamp).toBeDefined();
  });

  it('returns allowed:true when no hooks are configured', async () => {
    const config = makeConfig(); // all hooks empty
    const result = await executeHooks(config, storage, 'pre_owner_registration', {});

    expect(result.allowed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips action that is not found in storage', async () => {
    // Register a hook ref that does not exist as an action
    const config = makeConfig({
      post_work_delivery: ['nonexistent-action'],
    });

    const result = await executeHooks(config, storage, 'post_work_delivery', {});

    expect(result.allowed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows action with no webhookUrl (no-op placeholder)', async () => {
    const action = makeAction({ id: 'noop-action', webhookUrl: undefined });
    await storage.createAction(action);

    const config = makeConfig({
      pre_board_post: ['noop-action'],
    });

    const result = await executeHooks(config, storage, 'pre_board_post', {});

    expect(result.allowed).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Response handling ──────────────────────────────────────

  it('returns allowed:false when webhook responds with non-ok status', async () => {
    const action = makeAction({ id: 'reject-action' });
    await storage.createAction(action);

    fetchSpy.mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );

    const config = makeConfig({
      pre_owner_registration: ['reject-action'],
    });

    const result = await executeHooks(config, storage, 'pre_owner_registration', {});

    expect(result.allowed).toBe(false);
    expect(result.hookAction).toBe('reject-action');
  });

  it('returns allowed:false when webhook returns {allowed: false}', async () => {
    const action = makeAction({ id: 'deny-action' });
    await storage.createAction(action);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ allowed: false, reason: 'Policy violation' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const config = makeConfig({
      pre_agent_registration: ['deny-action'],
    });

    const result = await executeHooks(config, storage, 'pre_agent_registration', {});

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Policy violation');
    expect(result.hookAction).toBe('deny-action');
  });

  // ── Error handling ─────────────────────────────────────────

  it('pre-hook failure returns allowed:false (fail-closed)', async () => {
    const action = makeAction({ id: 'crashing-action' });
    await storage.createAction(action);

    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const config = makeConfig({
      pre_owner_registration: ['crashing-action'],
    });

    const result = await executeHooks(config, storage, 'pre_owner_registration', {});

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('failed to execute');
    expect(result.hookAction).toBe('crashing-action');
  });

  it('post-hook failure is logged but does not block', async () => {
    const action = makeAction({ id: 'failing-post-hook' });
    await storage.createAction(action);

    fetchSpy.mockRejectedValueOnce(new Error('Timeout'));

    const config = makeConfig({
      post_owner_registration: ['failing-post-hook'],
    });

    const result = await executeHooks(config, storage, 'post_owner_registration', {});

    // post-hooks failure is logged but allowed
    expect(result.allowed).toBe(true);
  });
});

describe('fireHook wrapper', () => {
  let storage: SqliteStorage;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storage = new SqliteStorage(':memory:');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('does not throw even if executeHooks rejects', async () => {
    const action = makeAction({ id: 'boom-action' });
    await storage.createAction(action);

    fetchSpy.mockRejectedValue(new Error('Kaboom'));

    const config = makeConfig({
      pre_owner_registration: ['boom-action'],
    });

    // fireHook is fire-and-forget — it should never throw
    expect(() => {
      fireHook(config, storage, 'pre_owner_registration', { test: true });
    }).not.toThrow();

    // Wait for the internal promise to settle
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it('fires the hook asynchronously', async () => {
    const action = makeAction({ id: 'async-action' });
    await storage.createAction(action);

    const config = makeConfig({
      post_settlement: ['async-action'],
    });

    fireHook(config, storage, 'post_settlement', { amount: 100 });

    // Fetch hasn't been called yet synchronously (it's async)
    // Wait for it to resolve
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
