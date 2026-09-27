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
 *   4. A BARE action id resolved to whichever owner's action the table scan returned last. Two
 *      owners may publish the same id, so a binding the operator made to their own action could call
 *      a squatter's webhook with the moment's context (security audit A8-3). "a bare id two
 *      providers publish" below asserts that nobody is called, that the binding is refused, and
 *      that the page does not show the squatter's host.
 *
 *   5. A binding names an action that is already published, so no later publication decides what
 *      it names. "a binding names an action that is already published" asserts that a reference
 *      nothing publishes is refused before anything is written, with a sentence that says to publish
 *      first; "bindings stored earlier, settled at start" asserts what the node does at start with a
 *      stored bare id: pinned when one provider publishes it, taken off when nobody does, once per
 *      node.
 *
 *   6. When a hook runs, only an id#provider reference names an action. A bare id names none,
 *      whatever is published at that moment: "stays naming nobody when one of the two providers
 *      deletes its action" asserts that nobody is called and a gate refuses, whichever provider is
 *      left, so no later publication or deletion decides what a stored binding names.
 *
 * @version-history
 *   v1.5.0 — 2026-09-26 — A binding stored as `id#<account name>` follows its action to the
 *     account's GHII at start, once per node, and stays as it was when nothing is published there
 *     (secaudit 2026-09: R3 row 5).
 *   v1.4.0 — 2026-09-26 — The executor resolves only id#provider references; a bare id calls nobody
 *     and a gate bound to it refuses, whatever is published. The executor cases bind id#provider,
 *     the form a binding is stored in. The stored bindings are settled once per node (A8-3).
 *   v1.3.0 — 2026-09-26 — A binding names an action that is already published: a reference nothing
 *     publishes is refused, an unreadable actions table refuses a binding, clearing reads nothing,
 *     and the stored bindings are settled at start (A8-3).
 *   v1.2.0 — 2026-09-26 — A bare id one provider publishes is bound with its provider, so another
 *     owner publishing the same id later cannot change what the binding names (A8-3).
 *   v1.1.0 — 2026-09-24 — A bare id two providers publish: never resolved by scan order (A8-3).
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
import { buildHooksOverview, setHookActions, settleStoredHookBindings, moveAccountNameHookBindings } from '../../src/services/hooks-overview.js';
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

/** The reference a binding stores for an action above: its id with its provider. The executor
 *  resolves only this form; a bare id names no action at call time. */
const ref = (id: string, provider = 'bot#alice@node') => `${id}#${provider}`;

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
    await executeHooks(cfg({ pre_owner_registration: [ref('a'), ref('b'), ref('c')] }), storage, 'pre_owner_registration', { name: 'alice' });
    expect(fetched).toHaveLength(3);
    // The hole: this was one full scan of the actions table PER BOUND ACTION, on the critical path
    // of every registration.
    expect(listed).toHaveLength(1);
  });

  it('calls the id with its provider, and a bare id of the one action published under it calls nobody', async () => {
    const { storage } = fakeStorage([action({ id: 'check', providerGaii: 'bot#alice@node' })]);
    const r = await executeHooks(cfg({ post_settlement: ['check', 'check#bot#alice@node'] }), storage, 'post_settlement', {});
    expect(r).toEqual({ allowed: true });
    expect(fetched).toEqual(['https://hooks.example/check']);
    const runs = await readHookRuns(storage);
    // Newest first: the qualified reference answered, the bare id before it named nobody.
    expect(runs.map((x) => [x.actionRef, x.answer])).toEqual([['check#bot#alice@node', 'ok'], ['check', 'missing']]);
    expect(runs[1].reason).toContain('check#bot#alice@node');
  });

  it('a bound action that is not published is recorded as missing and stops nothing', async () => {
    const { storage } = fakeStorage([]);
    const r = await executeHooks(cfg({ pre_owner_registration: [ref('gone')] }), storage, 'pre_owner_registration', { name: 'alice' });
    expect(r.allowed).toBe(true);
    expect(fetched).toHaveLength(0);
    const runs = await readHookRuns(storage);
    expect(runs[0]).toMatchObject({ hook: 'pre_owner_registration', actionRef: ref('gone'), answer: 'missing', allowed: true });
  });

  it('a published action with no address is bound, does nothing, and says so', async () => {
    const { storage } = fakeStorage([action({ webhookUrl: undefined })]);
    const r = await executeHooks(cfg({ pre_board_post: [ref('check')] }), storage, 'pre_board_post', { board_id: 'b1' });
    expect(r.allowed).toBe(true);
    expect(fetched).toHaveLength(0);
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'no_address', allowed: true, actionName: 'Allowlist check' });
  });
});

describe('a bare id two providers publish', () => {
  // The operator's own action and a second owner's action under the SAME id. The table is keyed
  // (provider, id), so both are legal rows, and listActions() returns them in no stated order.
  const operatorsOwn = action({ id: 'gate', providerGaii: 'bot#opr@node', displayName: 'Mine', webhookUrl: 'https://operator-legit.example/gate' });
  const squatter = action({ id: 'gate', providerGaii: 'bot#mallory@node', displayName: 'Squatter', webhookUrl: 'https://attacker.example/steal' });

  /** Enough storage for the binding write as well: the config rows it writes and deletes. */
  function bindingStorage(actions: ActionRecord[]) {
    const { storage } = fakeStorage(actions);
    const written: string[] = [];
    Object.assign(storage, {
      setConfigValue: async (key: string) => { written.push(key); },
      deleteConfigValue: async (key: string) => { written.push(key); },
    });
    return { storage, written };
  }

  it('a gate bound to it calls nobody and refuses, in either scan order', async () => {
    for (const order of [[operatorsOwn, squatter], [squatter, operatorsOwn]]) {
      fetched.length = 0;
      const { storage } = fakeStorage(order);
      const r = await executeHooks(cfg({ pre_owner_registration: ['gate'] }), storage, 'pre_owner_registration', { name: 'eve' });
      expect(fetched).toEqual([]);
      expect(r.allowed).toBe(false);
      const run = (await readHookRuns(storage))[0];
      expect(run).toMatchObject({ actionRef: 'gate', allowed: false });
      expect(run.reason).toContain('gate#bot#mallory@node');
    }
  });

  it('a notify hook bound to it calls nobody and stops nothing', async () => {
    const { storage } = fakeStorage([operatorsOwn, squatter]);
    const r = await executeHooks(cfg({ post_agent_registration: ['gate'] }), storage, 'post_agent_registration', { name: 'bot' });
    expect(r).toEqual({ allowed: true });
    expect(fetched).toEqual([]);
  });

  // The bare binding was stored while two providers published the id. Then one of them deletes its
  // action. Whichever is left, it must not decide what the binding names: a bare id names no action
  // at call time, whatever is published at that moment.
  it('stays naming nobody when one of the two providers deletes its action, whichever is left', async () => {
    for (const left of [operatorsOwn, squatter]) {
      fetched.length = 0;
      const { storage } = fakeStorage([left]);
      const gate = await executeHooks(cfg({ pre_owner_registration: ['gate'] }), storage, 'pre_owner_registration', { name: 'eve' });
      expect(fetched).toEqual([]);
      expect(gate).toMatchObject({ allowed: false, hookAction: 'gate' });
      const run = (await readHookRuns(storage))[0];
      expect(run).toMatchObject({ actionRef: 'gate', answer: 'missing', allowed: false });
      expect(run.reason).toContain(`gate#${left.providerGaii}`);

      const notify = await executeHooks(cfg({ post_agent_registration: ['gate'] }), storage, 'post_agent_registration', { name: 'bot' });
      expect(notify).toEqual({ allowed: true });
      expect(fetched).toEqual([]);

      // The page shows it as it shows an id two providers publish: naming nothing, with the one
      // that is left as the reference to choose.
      const overview = await buildHooksOverview(cfg({ pre_owner_registration: ['gate'] }), storage);
      const bound = overview.hooks.find(h => h.name === 'pre_owner_registration')!.actions[0];
      expect(bound).toMatchObject({ ref: 'gate', published: false, name: null, host: null, ambiguous: [`gate#${left.providerGaii}`] });
    }
  });

  it('stays naming nobody when both delete their actions, and a gate bound to it still refuses', async () => {
    const { storage } = fakeStorage([]);
    const r = await executeHooks(cfg({ pre_owner_registration: ['gate'] }), storage, 'pre_owner_registration', { name: 'eve' });
    expect(r).toMatchObject({ allowed: false, hookAction: 'gate' });
    expect(fetched).toEqual([]);
    const overview = await buildHooksOverview(cfg({ pre_owner_registration: ['gate'] }), storage);
    expect(overview.hooks.find(h => h.name === 'pre_owner_registration')!.actions[0])
      .toMatchObject({ ref: 'gate', published: false, ambiguous: [] });
  });

  it('the id with its provider still names exactly one, whoever else publishes the id', async () => {
    const { storage } = fakeStorage([squatter, operatorsOwn]);
    const r = await executeHooks(cfg({ pre_owner_registration: ['gate#bot#opr@node'] }), storage, 'pre_owner_registration', { name: 'eve' });
    expect(r.allowed).toBe(true);
    expect(fetched).toEqual(['https://operator-legit.example/gate']);
  });

  it('binding it is refused before anything is written, and the answer names both references', async () => {
    const { storage, written } = bindingStorage([operatorsOwn, squatter]);
    const config = cfg();
    const out = await setHookActions(config, storage, 'pre_owner_registration', ['gate']);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_INPUT');
    expect(out.message).toContain('gate#bot#opr@node');
    expect(out.message).toContain('gate#bot#mallory@node');
    expect(config.extensionHooks.pre_owner_registration).toEqual([]);
    expect(written).toEqual([]);
  });

  it('binding the provider-qualified reference is accepted', async () => {
    const { storage, written } = bindingStorage([operatorsOwn, squatter]);
    const config = cfg();
    const out = await setHookActions(config, storage, 'pre_owner_registration', ['gate#bot#opr@node']);
    expect(out).toMatchObject({ ok: true, actions: ['gate#bot#opr@node'], unknown: [] });
    expect(written).toEqual(['hooks.pre_owner_registration']);
  });

  it('a bare id only one provider publishes is bound with its provider, so publishing it later changes nothing', async () => {
    const { storage } = fakeStorage([operatorsOwn]);
    const stored: Record<string, string> = {};
    Object.assign(storage, {
      setConfigValue: async (key: string, value: string) => { stored[key] = value; },
      deleteConfigValue: async (key: string) => { delete stored[key]; },
    });
    const config = cfg();
    const out = await setHookActions(config, storage, 'pre_owner_registration', ['gate']);
    expect(out).toMatchObject({ ok: true, actions: ['gate#bot#opr@node'], unknown: [] });
    expect(config.extensionHooks.pre_owner_registration).toEqual(['gate#bot#opr@node']);
    expect(JSON.parse(stored['hooks.pre_owner_registration'])).toEqual(['gate#bot#opr@node']);

    // A second owner publishes the same id afterwards. The gate still calls the action the operator
    // bound, whichever row the scan returns first, and lets the thing through.
    for (const order of [[operatorsOwn, squatter], [squatter, operatorsOwn]]) {
      fetched.length = 0;
      const { storage: later } = fakeStorage(order);
      const r = await executeHooks(config, later, 'pre_owner_registration', { name: 'eve' });
      expect(fetched).toEqual(['https://operator-legit.example/gate']);
      expect(r.allowed).toBe(true);
    }
  });

  it('the page shows a binding made before the second owner published as naming nothing, never the squatter', async () => {
    const { storage } = fakeStorage([operatorsOwn, squatter]);
    const overview = await buildHooksOverview(cfg({ pre_owner_registration: ['gate'] }), storage);
    const bound = overview.hooks.find(h => h.name === 'pre_owner_registration')!.actions[0];
    expect(bound).toMatchObject({ ref: 'gate', published: false, name: null, host: null });
    expect(bound.ambiguous).toEqual(['gate#bot#opr@node', 'gate#bot#mallory@node']);
  });
});

/**
 * Storage for the binding writes: the config rows as stored, the rows deleted, and an actions table
 * that can be made unreadable.
 */
function configStorage(actions: ActionRecord[], opts: { unreadable?: boolean } = {}) {
  const base = fakeStorage(actions);
  const stored: Record<string, string> = {};
  const deleted: string[] = [];
  Object.assign(base.storage, {
    setConfigValue: async (key: string, value: string) => { stored[key] = value; },
    deleteConfigValue: async (key: string) => { deleted.push(key); delete stored[key]; },
    ...(opts.unreadable ? { listActions: async () => { base.listed.push(Date.now()); throw new Error('database is away'); } } : {}),
  });
  return { ...base, stored, deleted };
}

describe('a binding names an action that is already published', () => {
  const published = action({ id: 'check', providerGaii: 'bot#alice@node' });

  it('an id no provider publishes is refused, says to publish it first, and nothing is written', async () => {
    const { storage, stored, deleted } = configStorage([published]);
    const config = cfg();
    const out = await setHookActions(config, storage, 'pre_owner_registration', ['spam-check']);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('INVALID_INPUT');
    expect(out.message).toContain('"spam-check"');
    expect(out.message).toMatch(/publish it first, then bind it/i);
    expect(out.message).toContain('Nothing was changed');
    expect(config.extensionHooks.pre_owner_registration).toEqual([]);
    expect(stored).toEqual({});
    expect(deleted).toEqual([]);
  });

  it('the id with a provider that does not publish it is refused the same way', async () => {
    const { storage, stored } = configStorage([published]);
    const out = await setHookActions(cfg(), storage, 'post_settlement', ['check#bot#mallory@node']);
    expect(out).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    if (out.ok) return;
    expect(out.message).toContain('"check#bot#mallory@node"');
    expect(stored).toEqual({});
  });

  it('one reference nothing publishes refuses the whole list, and what was bound stays', async () => {
    const { storage, stored } = configStorage([published]);
    const config = cfg({ pre_board_post: ['check#bot#alice@node'] });
    const out = await setHookActions(config, storage, 'pre_board_post', ['check', 'spam-check']);
    expect(out).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(config.extensionHooks.pre_board_post).toEqual(['check#bot#alice@node']);
    expect(stored).toEqual({});
  });

  it('when the actions cannot be read, a binding is refused rather than stored unchecked', async () => {
    const { storage, stored } = configStorage([published], { unreadable: true });
    const config = cfg();
    const out = await setHookActions(config, storage, 'pre_owner_registration', ['check']);
    expect(out).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
    if (out.ok) return;
    expect(out.message).toContain('Nothing was changed');
    expect(config.extensionHooks.pre_owner_registration).toEqual([]);
    expect(stored).toEqual({});
  });

  it('an empty list clears the moment without reading the actions', async () => {
    const { storage, deleted, listed } = configStorage([published], { unreadable: true });
    const config = cfg({ pre_owner_registration: ['check#bot#alice@node'] });
    const out = await setHookActions(config, storage, 'pre_owner_registration', []);
    expect(out).toMatchObject({ ok: true, cleared: true, actions: [] });
    expect(config.extensionHooks.pre_owner_registration).toEqual([]);
    expect(deleted).toEqual(['hooks.pre_owner_registration']);
    expect(listed).toHaveLength(0);
  });
});

describe('bindings stored earlier, settled at start', () => {
  const mine = action({ id: 'mine', providerGaii: 'bot#opr@node', displayName: 'Mine', webhookUrl: 'https://operator.example/mine' });
  const bothOpr = action({ id: 'both', providerGaii: 'bot#opr@node', webhookUrl: 'https://operator.example/both' });
  const bothOther = action({ id: 'both', providerGaii: 'bot#mallory@node', webhookUrl: 'https://attacker.example/both' });
  const laterByOther = action({ id: 'later', providerGaii: 'bot#mallory@node', webhookUrl: 'https://attacker.example/later' });

  it('pins a bare id one provider publishes, takes off one nobody publishes, and keeps the rest', async () => {
    const { storage, stored, deleted } = configStorage([mine, bothOpr, bothOther]);
    const config = cfg({
      pre_owner_registration: ['mine', 'later', 'both', 'gone#bot#opr@node'],
      post_settlement: ['later'],
    });
    const out = await settleStoredHookBindings(config, storage);

    expect(out.ran).toBe(true);
    expect(config.extensionHooks.pre_owner_registration).toEqual(['mine#bot#opr@node', 'both', 'gone#bot#opr@node']);
    expect(JSON.parse(stored['hooks.pre_owner_registration'])).toEqual(['mine#bot#opr@node', 'both', 'gone#bot#opr@node']);
    expect(config.extensionHooks.post_settlement).toEqual([]);
    expect(deleted).toEqual(['hooks.post_settlement']);
    expect(out.pinned).toEqual([{ hook: 'pre_owner_registration', from: 'mine', to: 'mine#bot#opr@node' }]);
    expect(out.removed).toEqual([
      { hook: 'pre_owner_registration', ref: 'later' },
      { hook: 'post_settlement', ref: 'later' },
    ]);
    // The Hooks page says what was taken off, and what to do.
    const runs = await readHookRuns(storage);
    const said = runs.filter((r) => r.actionRef === 'later');
    expect(said).toHaveLength(2);
    expect(said.every((r) => r.answer === 'missing' && /publish the action, then bind it again/i.test(r.reason ?? ''))).toBe(true);

    // Another owner publishes the id that was taken off. Nothing bound to either moment calls it.
    const { storage: afterwards } = fakeStorage([laterByOther, mine, bothOpr, bothOther]);
    await executeHooks(config, afterwards, 'pre_owner_registration', { name: 'eve' });
    expect(await executeHooks(config, afterwards, 'post_settlement', { amount: 1 })).toEqual({ allowed: true });
    expect(fetched).toEqual(['https://operator.example/mine']);
  });

  // Settled once per node. A bare id two providers published at that start stays naming nobody:
  // a later start must not let a deletion decide what it names, by pinning it to the provider that
  // is left or by taking it off.
  it('runs once: a later start leaves an id two providers published naming nobody, whatever was deleted since', async () => {
    const published = [bothOpr, bothOther];
    const { storage, stored, memory } = configStorage(published);
    const config = cfg({ pre_owner_registration: ['both'], post_settlement: ['both'] });
    expect((await settleStoredHookBindings(config, storage)).ran).toBe(true);
    expect(memory.has('migrations.hook-bindings-settled')).toBe(true);
    expect(config.extensionHooks.pre_owner_registration).toEqual(['both']);

    for (const left of [[bothOpr], []]) {
      published.splice(0, published.length, ...left);
      const again = await settleStoredHookBindings(config, storage);
      expect(again).toEqual({ ran: false, pinned: [], removed: [] });
      expect(config.extensionHooks).toMatchObject({ pre_owner_registration: ['both'], post_settlement: ['both'] });
      expect(stored).toEqual({});
      fetched.length = 0;
      expect(await executeHooks(config, storage, 'pre_owner_registration', { name: 'eve' })).toMatchObject({ allowed: false });
      expect(fetched).toEqual([]);
    }
  });

  it('reads nothing and changes nothing when every stored reference names its provider', async () => {
    const { storage, stored, listed, memory } = configStorage([mine]);
    const config = cfg({ pre_board_post: ['mine#bot#opr@node', 'gone#bot#opr@node'] });
    const out = await settleStoredHookBindings(config, storage);
    expect(out).toEqual({ ran: false, pinned: [], removed: [] });
    expect(listed).toHaveLength(0);
    expect(stored).toEqual({});
    expect(memory.size).toBe(0);
    expect(config.extensionHooks.pre_board_post).toEqual(['mine#bot#opr@node', 'gone#bot#opr@node']);
  });

  it('changes nothing and records nothing when the actions cannot be read, so the next start tries again', async () => {
    const { storage, stored, deleted, memory } = configStorage([mine], { unreadable: true });
    const config = cfg({ post_settlement: ['later', 'mine'] });
    const out = await settleStoredHookBindings(config, storage);
    expect(out).toEqual({ ran: false, pinned: [], removed: [] });
    expect(config.extensionHooks.post_settlement).toEqual(['later', 'mine']);
    expect(stored).toEqual({});
    expect(deleted).toEqual([]);
    expect(memory.has('migrations.hook-bindings-settled')).toBe(false);
  });
});

// An action a person published in person was stored under the bare account name, and a binding to it
// as `id#name`. The deploy migration moves such an action to the person's GHII, and the start step
// after it moves the binding with it, once per node.
describe('a binding that names an action by the bare account name, at start', () => {
  const own = action({ id: 'own', providerGaii: 'opr@node', displayName: 'Own', webhookUrl: 'https://operator.example/own' });
  const mine = action({ id: 'mine', providerGaii: 'bot#opr@node', webhookUrl: 'https://operator.example/mine' });
  const RECORD = 'migrations.hook-bindings-full-identity';

  /** The accounts the store holds, by name, with the GHII of each. */
  function withAccounts(storage: Storage, ghiis: Record<string, string>) {
    Object.assign(storage, { getGHIIByOwner: async (name: string) => (ghiis[name] ? { ghii: ghiis[name] } : null) });
  }

  it('moves id#name to the id with the GHII the action is published under, and the executor calls it', async () => {
    const { storage, stored, memory } = configStorage([own, mine]);
    withAccounts(storage, { opr: 'opr@node' });
    const config = cfg({ pre_agent_registration: ['own#opr', 'mine#bot#opr@node'], post_settlement: ['own#opr'] });
    const out = await moveAccountNameHookBindings(config, storage);

    expect(out.ran).toBe(true);
    expect(out.moved).toEqual([
      { hook: 'pre_agent_registration', from: 'own#opr', to: 'own#opr@node' },
      { hook: 'post_settlement', from: 'own#opr', to: 'own#opr@node' },
    ]);
    expect(out.left).toEqual([]);
    expect(config.extensionHooks.pre_agent_registration).toEqual(['own#opr@node', 'mine#bot#opr@node']);
    expect(JSON.parse(stored['hooks.pre_agent_registration'])).toEqual(['own#opr@node', 'mine#bot#opr@node']);
    expect(JSON.parse(stored['hooks.post_settlement'])).toEqual(['own#opr@node']);
    expect(memory.has(RECORD)).toBe(true);

    await executeHooks(config, storage, 'post_settlement', { amount: 1 });
    expect(fetched).toEqual(['https://operator.example/own']);
  });

  it('leaves id#name as it is when nothing is published under that account\'s GHII, or the name has no account', async () => {
    const { storage, stored, memory } = configStorage([mine]);
    withAccounts(storage, { opr: 'opr@node' });
    const config = cfg({ pre_board_post: ['own#opr', 'x#nobody'] });
    const out = await moveAccountNameHookBindings(config, storage);
    expect(out.ran).toBe(true);
    expect(out.moved).toEqual([]);
    expect(out.left).toEqual([{ hook: 'pre_board_post', ref: 'own#opr' }, { hook: 'pre_board_post', ref: 'x#nobody' }]);
    expect(config.extensionHooks.pre_board_post).toEqual(['own#opr', 'x#nobody']);
    expect(stored).toEqual({});
    expect(memory.has(RECORD)).toBe(true);
  });

  it('runs once: a later start changes nothing, whatever is published by then', async () => {
    const published = [mine];
    const { storage, stored } = configStorage(published);
    withAccounts(storage, { opr: 'opr@node' });
    const config = cfg({ pre_board_post: ['own#opr'] });
    expect((await moveAccountNameHookBindings(config, storage)).ran).toBe(true);
    published.push(own);
    expect(await moveAccountNameHookBindings(config, storage)).toEqual({ ran: false, moved: [], left: [] });
    expect(config.extensionHooks.pre_board_post).toEqual(['own#opr']);
    expect(stored).toEqual({});
  });

  it('reads nothing and records nothing when no binding names an account by its bare name', async () => {
    const { storage, stored, listed, memory } = configStorage([own, mine]);
    withAccounts(storage, { opr: 'opr@node' });
    const config = cfg({ pre_board_post: ['mine#bot#opr@node', 'own#opr@node', 'bare'] });
    const out = await moveAccountNameHookBindings(config, storage);
    expect(out).toEqual({ ran: false, moved: [], left: [] });
    expect(listed).toHaveLength(0);
    expect(stored).toEqual({});
    expect(memory.size).toBe(0);
  });

  it('changes nothing and records nothing when the store cannot be read, so the next start tries again', async () => {
    const { storage, stored, memory } = configStorage([own], { unreadable: true });
    withAccounts(storage, { opr: 'opr@node' });
    const config = cfg({ post_settlement: ['own#opr'] });
    const out = await moveAccountNameHookBindings(config, storage);
    expect(out).toEqual({ ran: false, moved: [], left: [] });
    expect(config.extensionHooks.post_settlement).toEqual(['own#opr']);
    expect(stored).toEqual({});
    expect(memory.has(RECORD)).toBe(false);
  });
});

describe('a gate decides, and fails closed', () => {
  it('a 2xx lets the thing through and is recorded', async () => {
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_owner_registration: [ref('check')] }), storage, 'pre_owner_registration', { name: 'alice', display_name: 'Alice' });
    expect(r.allowed).toBe(true);
    const run = (await readHookRuns(storage))[0];
    expect(run).toMatchObject({ answer: 'ok', status: 200, allowed: true, subject: 'name: alice · display_name: Alice' });
    expect(run.ms).toBeGreaterThanOrEqual(0);
  });

  it('{"allowed": false} refuses, with the reason the address gave', async () => {
    answers['https://hooks.example/check'] = { status: 200, ok: true, body: { allowed: false, reason: 'not on the list' } };
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_owner_registration: [ref('check')] }), storage, 'pre_owner_registration', { name: 'mikko' });
    expect(r).toMatchObject({ allowed: false, reason: 'not on the list', hookAction: ref('check') });
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'refused', allowed: false, reason: 'not on the list', subject: 'name: mikko' });
  });

  it('a non-2xx refuses', async () => {
    answers['https://hooks.example/check'] = { status: 403, ok: false, body: { why: 'no' } };
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_agent_registration: [ref('check')] }), storage, 'pre_agent_registration', { name: 'bot' });
    expect(r.allowed).toBe(false);
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'refused', status: 403, allowed: false });
  });

  it('an address that throws refuses, and the rest are not called', async () => {
    answers['https://hooks.example/a'] = { status: 0, ok: false, throws: true };
    const { storage } = fakeStorage([
      action({ id: 'a', webhookUrl: 'https://hooks.example/a' }),
      action({ id: 'b', webhookUrl: 'https://hooks.example/b' }),
    ]);
    const r = await executeHooks(cfg({ pre_work_request: [ref('a'), ref('b')] }), storage, 'pre_work_request', { action_id: 'x' });
    expect(r.allowed).toBe(false);
    expect(fetched).toEqual(['https://hooks.example/a']);
    expect((await readHookRuns(storage))[0]).toMatchObject({ answer: 'no_answer', status: null, allowed: false });
  });

  it('a gate refuses when the address is blocked, rather than letting the thing through', async () => {
    blocked.add('https://hooks.example/check');
    const { storage } = fakeStorage([action()]);
    const r = await executeHooks(cfg({ pre_federation_peer: [ref('check')] }), storage, 'pre_federation_peer', { target_node_id: 'peer' });
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
    expect(await executeHooks(cfg({ pre_owner_registration: [ref('check')] }), broken, 'pre_owner_registration', { name: 'a' }))
      .toMatchObject({ allowed: false });
    expect(await executeHooks(cfg({ post_settlement: [ref('check')] }), broken, 'post_settlement', {}))
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
    const r = await executeHooks(cfg({ post_work_delivery: [ref('a'), ref('b')] }), storage, 'post_work_delivery', { tracking_code: 'wk-1' });
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
      await executeHooks(cfg({ post_settlement: [ref('check')] }), storage, 'post_settlement', { n: i });
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
