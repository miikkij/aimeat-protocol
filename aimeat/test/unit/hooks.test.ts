/**
 * @file hooks.test.ts
 * @description The eleven moments: which of them decide, what a gate does when the address will not
 *   answer, and the record every call leaves behind.
 *
 *   THREE HOLES THIS FILE IS THE MEMORY OF.
 *
 *   1. The actions were resolved INSIDE the loop. `storage.listActions()` ran once per bound action,
 *      on the critical path of every registration, work request and board post. "resolves the
 *      published actions once" fails on that code.
 *
 *   2. A gate whose address this node refuses to call LET THE THING THROUGH. When
 *      validateOutboundUrl blocked the URL the loop did `continue`, so a gate bound to a private
 *      address allowed every registration while looking like it was guarding them. That is the one
 *      shape a gate must never have, and "a gate refuses when the address is blocked" asserts it.
 *
 *   3. Nothing was recorded anywhere a person could read. Every assertion here about `runs` is new
 *      behaviour: a refusal that leaves no trace is indistinguishable from nobody having tried.
 *
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** What each address does when called, keyed by URL. */
let answers: Record<string, { status: number; ok: boolean; body?: unknown; throws?: boolean }> = {};
/** Which URLs this node refuses to call at all (the SSRF guard's answer). */
let blocked = new Set<string>();
const fetched: string[] = [];

vi.mock('../../src/utils/url-validator.js', () => ({
  validateOutboundUrl: vi.fn(async (url: string) =>
    blocked.has(url) ? { valid: false, reason: 'private address' } : { valid: true }),
  safeFetch: vi.fn(async (url: string) => {
    fetched.push(url);
    const a = answers[url] ?? { status: 200, ok: true };
    if (a.throws) throw new Error('connect ECONNREFUSED');
    return {
      ok: a.ok, status: a.status,
      json: async () => a.body ?? {},
      text: async () => JSON.stringify(a.body ?? {}),
    } as unknown as Response;
  }),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { executeHooks, listHooks, hookKind, HOOK_NAMES, subjectOf } from '../../src/services/hooks.js';
import { readHookRuns, HOOK_RUNS_KEPT } from '../../src/services/hook-log.js';
import type { AimeatConfig, HookName } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { ActionRecord } from '../../src/storage/types/commerce.js';

const action = (over: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'check', providerGaii: 'bot#alice@node', displayName: 'Allowlist check',
  description: '', inputSchema: {}, outputSchema: {}, pricing: { baseMorsels: 0 }, tags: [],
  webhookUrl: 'https://hooks.example/check',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
} as ActionRecord);

const cfg = (hooks: Partial<Record<HookName, string[]>> = {}): AimeatConfig => ({
  nodeId: 'aimeat-local-001-dev',
  extensionHooks: Object.fromEntries(HOOK_NAMES.map((n) => [n, hooks[n] ?? []])),
} as AimeatConfig);

/** Enough of storage for these functions: the actions list and the one memory record. */
function fakeStorage(actions: ActionRecord[] = []) {
  const memory = new Map<string, { value: unknown }>();
  const listed: number[] = [];
  const storage = {
    listActions: async () => { listed.push(Date.now()); return actions; },
    getMemory: async (_o: string, key: string) => memory.get(key) ?? null,
    setMemory: async (rec: { key: string; value: unknown }) => { memory.set(rec.key, { value: rec.value }); },
  } as unknown as Storage;
  return { storage, listed, memory };
}

beforeEach(() => {
  answers = {};
  blocked = new Set();
  fetched.length = 0;
});

describe('the eleven moments, and which of them decide', () => {
  it('HOOK_NAMES is the whole list and every name has a kind', () => {
    expect(HOOK_NAMES).toHaveLength(11);
    expect(HOOK_NAMES.filter((n) => hookKind(n) === 'gate')).toEqual([
      'pre_owner_registration', 'pre_agent_registration', 'pre_work_request',
      'pre_board_post', 'pre_federation_peer',
    ]);
    // Five names start with pre_, and all five decide. The other six are told afterwards.
    expect(HOOK_NAMES.filter((n) => hookKind(n) === 'notify')).toHaveLength(6);
  });

  it('nothing bound is allowed without a call', async () => {
    const { storage, listed } = fakeStorage([action()]);
    expect(await executeHooks(cfg(), storage, 'pre_owner_registration', { name: 'alice' })).toEqual({ allowed: true });
    expect(fetched).toHaveLength(0);
    expect(listed).toHaveLength(0);
  });

  it('listHooks reports what is bound to each moment', () => {
    const config = cfg({ post_settlement: ['check'] });
    expect(listHooks(config).post_settlement).toEqual(['check']);
    expect(listHooks(config).pre_board_post).toEqual([]);
  });
});

describe('resolving the actions', () => {
  it('resolves the published actions ONCE however many are bound', async () => {
    const actions = [action({ id: 'a' }), action({ id: 'b' }), action({ id: 'c' })];
    const { storage, listed } = fakeStorage(actions);
    await executeHooks(cfg({ pre_owner_registration: ['a', 'b', 'c'] }), storage, 'pre_owner_registration', { name: 'alice' });
    expect(fetched).toHaveLength(3);
    // The hole: this was one full scan of the actions table PER BOUND ACTION, on the critical path
    // of every registration.
    expect(listed).toHaveLength(1);
  });

  it('accepts both spellings of a reference: the bare id and the id with its provider', async () => {
    const { storage } = fakeStorage([action({ id: 'check', providerGaii: 'bot#alice@node' })]);
    await executeHooks(cfg({ post_settlement: ['check', 'check#bot#alice@node'] }), storage, 'post_settlement', {});
    expect(fetched).toHaveLength(2);
  });

  it('a bound action that is not published is recorded as missing and stops nothing', async () => {
    const { storage } = fakeStorage([]);
    const r = await executeHooks(cfg({ pre_owner_registration: ['gone'] }), storage, 'pre_owner_registration', { name: 'alice' });
    expect(r.allowed).toBe(true);
    expect(fetched).toHaveLength(0);
    const runs = await readHookRuns(storage);
    expect(runs[0]).toMatchObject({ hook: 'pre_owner_registration', actionRef: 'gone', answer: 'missing', allowed: true });
  });

  it('a published action with no address is bound, does nothing, and says so', async () => {
    const { storage } = fakeStorage([action({ webhookUrl: undefined })]);
    const r = await executeHooks(cfg({ pre_board_post: ['check'] }), storage, 'pre_board_post', { board_id: 'b1' });
    expect(r.allowed).toBe(true);
    expect(fetched).toHaveLength(0);
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'no_address', allowed: true, actionName: 'Allowlist check' });
  });
});

describe('a gate decides, and fails closed', () => {
  it('a 2xx lets the thing through and is recorded', async () => {
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_owner_registration: ['check'] }), storage, 'pre_owner_registration', { name: 'alice', display_name: 'Alice' });
    expect(r.allowed).toBe(true);
    const run = (await readHookRuns(storage))[0];
    expect(run).toMatchObject({ answer: 'ok', status: 200, allowed: true, subject: 'name: alice · display_name: Alice' });
    expect(run.ms).toBeGreaterThanOrEqual(0);
  });

  it('{"allowed": false} refuses, with the reason the address gave', async () => {
    answers['https://hooks.example/check'] = { status: 200, ok: true, body: { allowed: false, reason: 'not on the list' } };
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_owner_registration: ['check'] }), storage, 'pre_owner_registration', { name: 'mikko' });
    expect(r).toMatchObject({ allowed: false, reason: 'not on the list', hookAction: 'check' });
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'refused', allowed: false, reason: 'not on the list', subject: 'name: mikko' });
  });

  it('a non-2xx refuses', async () => {
    answers['https://hooks.example/check'] = { status: 403, ok: false, body: { why: 'no' } };
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_agent_registration: ['check'] }), storage, 'pre_agent_registration', { name: 'bot' });
    expect(r.allowed).toBe(false);
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'refused', status: 403, allowed: false });
  });

  it('an address that throws refuses, and the rest are not called', async () => {
    answers['https://hooks.example/a'] = { status: 0, ok: false, throws: true };
    const { storage } = fakeStorage([
      action({ id: 'a', webhookUrl: 'https://hooks.example/a' }),
      action({ id: 'b', webhookUrl: 'https://hooks.example/b' }),
    ]);
    const r = await executeHooks(cfg({ pre_work_request: ['a', 'b'] }), storage, 'pre_work_request', { action_id: 'x' });
    expect(r.allowed).toBe(false);
    expect(fetched).toEqual(['https://hooks.example/a']);
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'no_answer', status: null, allowed: false });
  });

  it('a gate refuses when the address is blocked, rather than letting the thing through', async () => {
    blocked.add('https://hooks.example/check');
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_federation_peer: ['check'] }), storage, 'pre_federation_peer', { target_node_id: 'peer' });
    // The hole: this used to `continue`, so a gate bound to an address the node refuses to call
    // allowed everything while looking like it was guarding it.
    expect(r.allowed).toBe(false);
    expect(fetched).toHaveLength(0);
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'no_answer', allowed: false });
  });

  it('the actions being unreadable refuses a gate and allows a notify hook', async () => {
    const broken = {
      listActions: async () => { throw new Error('database is away'); },
      getMemory: async () => null,
      setMemory: async () => undefined,
    } as unknown as Storage;
    expect(await executeHooks(cfg({ pre_owner_registration: ['check'] }), broken, 'pre_owner_registration', { name: 'a' }))
      .toMatchObject({ allowed: false });
    expect(await executeHooks(cfg({ post_settlement: ['check'] }), broken, 'post_settlement', {}))
      .toEqual({ allowed: true });
  });
});

describe('a notify hook is told, and stops nothing', () => {
  it('a refusal on a post_ hook changes nothing and every action is still called', async () => {
    answers['https://hooks.example/a'] = { status: 500, ok: false };
    answers['https://hooks.example/b'] = { status: 200, ok: true };
    const { storage } = fakeStorage([
      action({ id: 'a', webhookUrl: 'https://hooks.example/a' }),
      action({ id: 'b', webhookUrl: 'https://hooks.example/b' }),
    ]);
    const r = await executeHooks(cfg({ post_work_delivery: ['a', 'b'] }), storage, 'post_work_delivery', { tracking_code: 'wk-1' });
    expect(r).toEqual({ allowed: true });
    expect(fetched).toEqual(['https://hooks.example/a', 'https://hooks.example/b']);
    const runs = await readHookRuns(storage);
    // Newest first: b succeeded, a was refused and recorded as such while allowing the flow.
    expect(runs.map((x) => x.answer)).toEqual(['ok', 'refused']);
    expect(runs.every((x) => x.allowed)).toBe(true);
  });
});

describe('the record', () => {
  it('keeps the newest runs and no more', async () => {
    const { storage } = fakeStorage([action()]);
    for (let i = 0; i < HOOK_RUNS_KEPT + 3; i++) {
      await executeHooks(cfg({ post_settlement: ['check'] }), storage, 'post_settlement', { n: i });
    }
    const runs = await readHookRuns(storage);
    expect(runs).toHaveLength(HOOK_RUNS_KEPT);
    expect(runs[0].subject).toBe(`n: ${HOOK_RUNS_KEPT + 2}`);
  });

  it('a record that is not the shape we write reads as no runs', async () => {
    const { storage, memory } = fakeStorage();
    memory.set('site/hook-runs', { value: '{not json' });
    expect(await readHookRuns(storage)).toEqual([]);
    memory.set('site/hook-runs', { value: { runs: 'nope' } });
    expect(await readHookRuns(storage)).toEqual([]);
  });

  it('subjectOf names the thing in a few words and leaves objects out', () => {
    expect(subjectOf({ name: 'alice', display_name: 'Alice', roles: ['owner'] })).toBe('name: alice · display_name: Alice');
    expect(subjectOf({ nested: { a: 1 }, id: 'x' })).toBe('id: x');
    expect(subjectOf({})).toBeUndefined();
    expect(subjectOf({ long: 'x'.repeat(200) })!.length).toBeLessThanOrEqual(120);
  });
});
