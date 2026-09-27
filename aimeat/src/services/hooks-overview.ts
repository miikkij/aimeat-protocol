/**
 * @file hooks-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Hooks page in one read, the two writes behind it, and the settling of the stored
 *   bindings at start.
 *
 *   The question an operator has is "does anything here call out to my own code, and is any of it
 *   broken". Answering it needs four things at once: the eleven moments and which of them decide
 *   rather than merely notify, what is bound to each and whether that thing still exists and still
 *   carries an address, which actions are available to bind at all, and what the bound ones have
 *   been answering. Reading them one at a time is how the page stayed a list of eleven rows saying
 *   "none".
 *
 *   The read reports what is TRUE rather than what is configured, wherever they can differ: a bound
 *   action that was deleted reads as missing, and one published without a `webhookUrl` reads as
 *   doing nothing, because both look identical to a working binding from inside the config.
 *
 *   ONE implementation, called by GET /v1/admin/hooks and by the aimeat_admin_hooks tool, so the
 *   page and an agent cannot drift on what "bound" means.
 *
 * @structure
 *   - buildHooksOverview(config, storage) — the page's one read
 *   - setHookActions(config, storage, hookName, actions) — bind, or clear with []
 *   - settleStoredHookBindings(config, storage) — at start, once per node, every stored reference to
 *     the form a binding is stored in now
 *   - moveAccountNameHookBindings(config, storage) — at start, once per node, each `id#name` to the
 *     `id#<GHII>` its action is published under after the deploy migration
 *   - followActionsToFullIdentity(config, storage, ghiiOf, byRef) — the move of those bindings, for
 *     the start and for the operator's decision on a held name
 *   - accountNameRef(ref) — the id and the account of a reference `id#name`
 *   - HOOK_GUARDS — which part of the node each moment belongs to
 * @usage
 *   const overview = await buildHooksOverview(config, storage);
 * @version-history
 *   v1.6.0 — 2026-09-26 — followActionsToFullIdentity(): the move of `id#name` bindings, out of
 *     moveAccountNameHookBindings, so the operator's decision that a held name is its holder's moves
 *     them the same way. A binding left at start is logged as staying, since the move to the full
 *     identity (0086) may have left its action under the bare name for the operator.
 *   v1.5.0 — 2026-09-26 — moveAccountNameHookBindings(): at start, after the deploy migration has
 *     moved a person's actions to their GHII, a binding stored as `id#<account name>` is stored as
 *     `id#<GHII>` when the action is published there, once per node under its own record
 *     (HOOK_BINDINGS_FULL_IDENTITY_KEY; secaudit 2026-09: R3 row 5).
 *   v1.4.0 — 2026-09-26 — SECURITY (audit A8-3): the page reads a stored reference through resolveHookRef()
 *     in hooks.ts, as the executor does, so a bare id reads as naming nothing, with `ambiguous`
 *     listing the id#provider of each provider that publishes it now. settleStoredHookBindings()
 *     runs once per node and records that it ran (HOOK_BINDINGS_SETTLED_KEY), so a later start does
 *     not resolve a bare id that was left naming nothing.
 *   v1.3.0 — 2026-09-26 — SECURITY (audit A8-3): a hook binds only an action that is already
 *     published. setHookActions refuses a reference that no published action answers to, with a
 *     sentence that says to publish the action first, and refuses a binding when the actions cannot
 *     be read; an empty list clears without reading them. settleStoredHookBindings() runs at start:
 *     a stored bare id that one provider publishes is stored as its id#provider, and one that no
 *     provider publishes is taken off its moment, with a line on the Hooks page that says so.
 *   v1.2.0 — 2026-09-26 — SECURITY (audit A8-3): a bare id one provider publishes is stored as its
 *     id#provider when it is bound. Left bare, another owner publishing the same id later made the
 *     binding name nothing, and a gate bound to it refused everything it guards.
 *   v1.1.0 — 2026-09-24 — SECURITY (audit A8-3): references resolve through indexActionRefs() in
 *     hooks.ts, the one the executor uses. A bare id two providers publish is refused at binding,
 *     named back with both provider-qualified references, before anything is written; a binding made
 *     before the second owner published reads as naming nothing, with `ambiguous`, never as the
 *     squatter's action and host.
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import type { AimeatConfig, HookName } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ActionRecord } from '../storage/types/commerce.js';
import { HOOK_NAMES, hookKind, HOOK_TIMEOUT_MS, indexActionRefs, resolveHookRef, qualifiedRef, isBareRef, type HookKind } from './hooks.js';
import { readHookRuns, recordHookRun, HOOK_RUNS_KEPT, type HookRun } from './hook-log.js';
import { logger } from '../utils/logger.js';

/** Which part of the node a moment belongs to. The page groups its rows by this. */
export const HOOK_GUARDS: Record<HookName, 'accounts' | 'work' | 'social'> = {
  pre_owner_registration: 'accounts',
  post_owner_registration: 'accounts',
  pre_agent_registration: 'accounts',
  post_agent_registration: 'accounts',
  owner_recovery: 'accounts',
  agent_rekey: 'accounts',
  pre_work_request: 'work',
  post_work_delivery: 'work',
  post_settlement: 'work',
  pre_board_post: 'social',
  pre_federation_peer: 'social',
};

/** One thing bound to a moment, and whether it can actually do anything. */
export interface BoundAction {
  /** The reference as the operator wrote it. */
  ref: string;
  /** The action's display name, when it is still published here. */
  name: string | null;
  /** Whether an action with this reference is published on this node. */
  published: boolean;
  /** Whether it carries an address to call. A published action without one is bound and does nothing. */
  has_address: boolean;
  /** The address's host, never the whole address: enough to recognise it, nothing to copy out of a screen. */
  host: string | null;
  /** When the reference is a bare id: the `id#provider` of each provider that publishes the id now,
   *  possibly none. A bare id names no action when a hook runs, so the executor calls none of them
   *  and a gate bound to it refuses; bind the one meant as `id#provider`. */
  ambiguous?: string[];
}

export interface HookRow {
  name: HookName;
  kind: HookKind;
  guards: 'accounts' | 'work' | 'social';
  actions: BoundAction[];
  /** The newest recorded call for this moment, or null. */
  last: HookRun | null;
  /**
   * True when this is a gate, something is bound to it, and the newest call did not get through.
   * The page opens on this: a gate in this state is refusing everything it guards.
   */
  failing: boolean;
}

/** An action that could be bound, as the picker shows it. */
export interface BindableAction {
  id: string;
  /** The reference to write into a binding: the id with its provider, which is unambiguous. */
  ref: string;
  name: string;
  provider: string;
  has_address: boolean;
  host: string | null;
}

/** The host of an address, or null when it is not one this node would call. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch (err) {
    logger.warn('hooks-overview: a bound action carries something that is not an address', { error: String(err) });
    return null;
  }
}

export async function buildHooksOverview(config: AimeatConfig, storage: Storage) {
  const [published, runs] = await Promise.all([
    storage.listActions().catch((err: unknown) => {
      // The page is still worth showing without the picker's list: what is bound, and what ran.
      logger.warn('hooks-overview: the actions could not be read', { error: String(err) });
      return [];
    }),
    readHookRuns(storage),
  ]);

  // The executor's own reading of a stored reference (resolveHookRef), so the page cannot show a binding
  // as naming something the executor would not call.
  const index = indexActionRefs(published);
  const newestFor = new Map<string, HookRun>();
  for (const run of runs) {
    if (!newestFor.has(run.hook)) newestFor.set(run.hook, run);
  }

  const hooks: HookRow[] = HOOK_NAMES.map((name) => {
    const kind = hookKind(name);
    const refs = config.extensionHooks[name] ?? [];
    const actions: BoundAction[] = refs.map((ref) => {
      const bound = resolveHookRef(ref, index);
      const found = bound.kind === 'action' ? bound.action : undefined;
      return {
        ref,
        name: found?.displayName ?? null,
        published: !!found,
        has_address: !!found?.webhookUrl,
        host: hostOf(found?.webhookUrl),
        ...(bound.kind === 'bare' ? { ambiguous: bound.claimants } : {}),
      };
    });
    const last = newestFor.get(name) ?? null;
    return {
      name, kind, guards: HOOK_GUARDS[name], actions, last,
      failing: kind === 'gate' && refs.length > 0 && !!last && !last.allowed,
    };
  });

  const bindable: BindableAction[] = published.map((a) => ({
    id: a.id,
    ref: `${a.id}#${a.providerGaii}`,
    name: a.displayName,
    provider: a.providerGaii,
    has_address: !!a.webhookUrl,
    host: hostOf(a.webhookUrl),
  }));

  const dayAgo = Date.now() - 24 * 60 * 60_000;
  const recent = runs.filter((r) => Date.parse(r.at) >= dayAgo);
  const refused = recent.filter((r) => !r.allowed);
  const times = recent.map((r) => r.ms).sort((a, b) => a - b);

  return {
    hooks,
    /** The one thing the page leads on: the gate that is refusing everything it guards, if any. */
    failing: hooks.filter((h) => h.failing).map((h) => h.name),
    bindable_actions: bindable,
    runs,
    summary: {
      total: HOOK_NAMES.length,
      gates: HOOK_NAMES.filter((n) => hookKind(n) === 'gate').length,
      bound: hooks.filter((h) => h.actions.length > 0).length,
      bound_gates: hooks.filter((h) => h.kind === 'gate' && h.actions.length > 0).length,
      actions_available: bindable.length,
      actions_with_address: bindable.filter((a) => a.has_address).length,
      calls_24h: recent.length,
      refused_24h: refused.length,
      median_ms: times.length ? times[Math.floor(times.length / 2)] : null,
      slowest_ms: times.length ? times[times.length - 1] : null,
      runs_kept: HOOK_RUNS_KEPT,
      timeout_ms: HOOK_TIMEOUT_MS,
    },
  };
}

export type SetHookOutcome =
  | { ok: true; hook: HookName; actions: string[]; cleared: boolean; unknown: string[]; note: string }
  | { ok: false; code: 'INVALID_INPUT' | 'INTERNAL_ERROR'; message: string };

/**
 * Bind a list of actions to one moment, or clear it with an empty list. THE one implementation:
 * PUT and DELETE on /v1/admin/hooks and the aimeat_admin_hook_set tool all land here.
 *
 * A HOOK BINDS ONLY AN ACTION THAT IS ALREADY PUBLISHED: publish it, then bind it. Every reference
 * must name one action published here at the moment of binding, and each is stored as that action's
 * `id#provider`, so the binding keeps naming the action the operator chose whoever publishes the
 * same id afterwards (security audit A8-3). Everything below is checked before anything is written:
 *   - A reference no published action answers to is REFUSED, with a sentence that says to publish
 *     the action first. This covers a stored reference whose action was deleted since, when the list
 *     is sent again: take it off the list, or publish it again.
 *   - A bare id that two or more providers publish is REFUSED, and the answer names the
 *     `id#provider` of each: it names no one action.
 *   - An actions table that cannot be read REFUSES the binding, because nothing above can be
 *     checked without it.
 * An empty list clears the moment and reads nothing, so a moment can be cleared whatever state the
 * actions table is in.
 *
 * `unknown` stays in the answer for the clients that read it. It is always empty, because a
 * reference that names no published action is refused.
 */
export async function setHookActions(
  config: AimeatConfig,
  storage: Storage,
  hookName: string,
  actions: unknown,
): Promise<SetHookOutcome> {
  if (!HOOK_NAMES.includes(hookName as HookName)) {
    return { ok: false, code: 'INVALID_INPUT', message: `Unknown hook "${hookName}". The eleven are: ${HOOK_NAMES.join(', ')}` };
  }
  if (!Array.isArray(actions) || !actions.every((a: unknown) => typeof a === 'string' && a.trim())) {
    return { ok: false, code: 'INVALID_INPUT', message: 'actions must be an array of action reference strings' };
  }
  const name = hookName as HookName;
  const typed = (actions as string[]).map((a) => a.trim());

  if (typed.length === 0) {
    config.extensionHooks[name] = [];
    await storage.deleteConfigValue(`hooks.${name}`);
    return {
      ok: true, hook: name, actions: [], cleared: true, unknown: [],
      note: 'Nothing is bound to this moment any more. It no longer calls out.',
    };
  }

  // Read what is published BEFORE writing, so a reference that names no one action is refused
  // rather than stored.
  let published: ActionRecord[];
  try {
    published = await storage.listActions();
  } catch (err) {
    logger.error('hooks-overview: the actions could not be read, so a binding was refused', { error: String(err) });
    return {
      ok: false, code: 'INTERNAL_ERROR',
      message: 'The actions published on this node could not be read, so the binding could not be checked. Nothing was changed. Try again in a moment.',
    };
  }
  const { byRef, ambiguous } = indexActionRefs(published);
  const clashes = typed.filter((ref) => ambiguous.has(ref));
  const unpublished = typed.filter((ref) => !ambiguous.has(ref) && !byRef.has(ref));
  if (clashes.length > 0 || unpublished.length > 0) {
    const parts: string[] = [];
    if (clashes.length > 0) {
      const named = clashes.map((ref) => `"${ref}" is published by ${ambiguous.get(ref)!.length} providers (${ambiguous.get(ref)!.join(', ')})`);
      parts.push(`${named.join('; ')}. Bind the one you mean with its provider, as id#provider.`);
    }
    if (unpublished.length > 0) {
      parts.push(`No action published on this node answers to ${unpublished.map((ref) => `"${ref}"`).join(', ')}. `
        + 'A hook binds only an action that is already published: publish it first, then bind it, or take it off the list.');
    }
    return { ok: false, code: 'INVALID_INPUT', message: `${parts.join(' ')} Nothing was changed.` };
  }

  // Every reference names one published action now, and is stored as that action's id#provider.
  const list = typed.map((ref) => qualifiedRef(byRef.get(ref)!));

  config.extensionHooks[name] = list;
  await storage.setConfigValue(`hooks.${name}`, JSON.stringify(list));

  const note = hookKind(name) === 'gate'
    ? `Bound. This moment now waits for ${list.length === 1 ? 'this address' : 'these addresses'} before it lets anything through, and refuses when one does not answer within ${HOOK_TIMEOUT_MS / 1000} seconds.`
    : 'Bound. This moment is told after the fact; whatever the address answers, nothing is stopped.';

  return { ok: true, hook: name, actions: list, cleared: false, unknown: [], note };
}

/** What settling the stored bindings changed at start. */
export interface SettledHookBindings {
  /** False when there was nothing to settle, or this node has settled its bindings before. */
  ran: boolean;
  /** Each bare id one provider publishes, stored now as that action's id#provider. */
  pinned: Array<{ hook: HookName; from: string; to: string }>;
  /** Each bare id no provider publishes, taken off its moment. */
  removed: Array<{ hook: HookName; ref: string }>;
}

/** The record that says this node has settled its stored bindings, under `system@<nodeId>`. */
export const HOOK_BINDINGS_SETTLED_KEY = 'migrations.hook-bindings-settled';

/** Said on the Hooks page, in section 04, for each reference taken off at start. */
const REMOVED_AT_START = 'No action published on this node answered to this reference when the node started, so it was '
  + 'taken off this moment: a hook binds only an action that is already published. Publish the action, then bind it again.';

/**
 * Bring the stored bindings to the form setHookActions stores: every reference names the one
 * published action it was bound to. Called at start, after the stored bindings are loaded
 * (server-bootstrap/config-init.ts). The executor resolves only id#provider references (resolveHookRef in
 * hooks.ts), so this and a new binding are the only places a bare id is resolved.
 *   - A bare id that one provider publishes is stored as that action's id#provider, and from then on
 *     the executor calls that action.
 *   - A bare id that no provider publishes is taken off its moment, and section 04 of the Hooks
 *     page says so with what to do: publish the action, then bind it again. It names no action.
 *   - A bare id that two or more providers publish stays. It names none of them, the executor calls
 *     none, a gate bound to it refuses, and the page names each `id#provider` to choose from.
 *   - A reference with its provider stays, published or not. Only that provider publishes under it.
 *
 * ONCE PER NODE, AND THE RECORD THAT SAYS SO. When the settling is done and saved, the node writes
 * HOOK_BINDINGS_SETTLED_KEY under its own system identity, never to expire, and every later start
 * reads it and changes nothing. A bare id left after that is one two or more providers published,
 * and it stays naming nothing whatever they publish or delete later, until the operator binds it
 * again: settling it again at a later start would let a deletion decide what it names. A start with
 * no bare id reads nothing and writes nothing.
 *
 * Never in the way of a start: when the record or the actions cannot be read, or a change cannot be
 * saved, no record is written, and the next start settles again. A change applies to the running
 * node even when it cannot be saved.
 */
export async function settleStoredHookBindings(config: AimeatConfig, storage: Storage): Promise<SettledHookBindings> {
  const settled: SettledHookBindings = { ran: false, pinned: [], removed: [] };
  if (!HOOK_NAMES.some((name) => (config.extensionHooks[name] ?? []).some(isBareRef))) return settled;

  const system = `system@${config.nodeId}`;
  let published: ActionRecord[];
  try {
    if (await storage.getMemory(system, HOOK_BINDINGS_SETTLED_KEY)) return settled;
    published = await storage.listActions();
  } catch (err) {
    logger.error('hooks-overview: the stored hook bindings were not checked at start, because the store could not be read. The next start tries again.', { error: String(err) });
    return settled;
  }
  settled.ran = true;
  const { byRef, ambiguous } = indexActionRefs(published);

  let saved = true;
  for (const name of HOOK_NAMES) {
    const refs = config.extensionHooks[name] ?? [];
    if (!refs.some(isBareRef)) continue;
    const next: string[] = [];
    for (const ref of refs) {
      if (!isBareRef(ref) || ambiguous.has(ref)) { next.push(ref); continue; }
      const found = byRef.get(ref);
      if (found) {
        next.push(qualifiedRef(found));
        settled.pinned.push({ hook: name, from: ref, to: qualifiedRef(found) });
      } else {
        settled.removed.push({ hook: name, ref });
      }
    }
    if (next.length === refs.length && next.every((ref, i) => ref === refs[i])) continue;
    config.extensionHooks[name] = next;
    try {
      if (next.length === 0) await storage.deleteConfigValue(`hooks.${name}`);
      else await storage.setConfigValue(`hooks.${name}`, JSON.stringify(next));
    } catch (err) {
      saved = false;
      logger.error(`hooks-overview: the settled binding of ${name} could not be saved. It applies until the node stops, and the next start settles it again.`, { error: String(err) });
    }
  }

  for (const { hook, from, to } of settled.pinned) {
    logger.info(`hooks-overview: "${from}" on ${hook} is stored as ${to}, the one action it names`);
  }
  for (const { hook, ref } of settled.removed) {
    logger.warn(`hooks-overview: "${ref}" on ${hook} names no published action, so it was taken off. Publish the action, then bind it again.`);
    await recordHookRun(storage, {
      at: new Date().toISOString(), hook, actionRef: ref, answer: 'missing', status: null, ms: 0, allowed: true,
      reason: REMOVED_AT_START,
    });
  }

  if (saved) {
    const now = new Date().toISOString();
    try {
      await storage.setMemory({
        key: HOOK_BINDINGS_SETTLED_KEY,
        ownerGaii: system,
        value: { at: now, pinned: settled.pinned.length, removed: settled.removed.length },
        visibility: 'private',
        tags: ['migration'],
        // Never swept: a record that expired would settle the bindings again at the next start.
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      logger.error('hooks-overview: the record that the hook bindings are settled could not be saved. The next start settles them again.', { error: String(err) });
    }
  }
  return settled;
}

/** What moving the bindings that name an account by its bare name changed at start. */
export interface MovedHookBindings {
  /** False when no binding names an account by its bare name, or this node has moved them before. */
  ran: boolean;
  /** Each `id#name` whose action is published under that account's GHII, stored now as `id#<GHII>`. */
  moved: Array<{ hook: HookName; from: string; to: string }>;
  /** Each `id#name` whose action is not published under that account's GHII: left as it was. */
  left: Array<{ hook: HookName; ref: string }>;
}

/** The record that says this node has moved those bindings, under `system@<nodeId>`. */
export const HOOK_BINDINGS_FULL_IDENTITY_KEY = 'migrations.hook-bindings-full-identity';

/** The id and the account of a reference `id#name` whose provider is a bare account name; else null. */
export function accountNameRef(ref: unknown): { id: string; name: string } | null {
  if (typeof ref !== 'string') return null;
  const cut = ref.indexOf('#');
  if (cut <= 0) return null;
  const name = ref.slice(cut + 1);
  return name && !name.includes('@') && !name.includes('#') ? { id: ref.slice(0, cut), name } : null;
}

/**
 * Store each binding `id#name` of an account in `ghiiOf` as `id#<GHII>` when the action `id` is
 * published under that GHII, on the running node and in the store. A binding of another account, and
 * one whose action is not published under the GHII, stays as it is and is listed in `left`.
 *
 * ONE implementation for the two times this happens: at start, after the move to the full identity
 * (moveAccountNameHookBindings below), and when the operator decides that a name the move left is its
 * holder's (services/held-account-names.ts). `saved` is false when a moment could not be stored; the
 * change applies to the running node until it stops.
 */
export async function followActionsToFullIdentity(
  config: AimeatConfig,
  storage: Storage,
  ghiiOf: ReadonlyMap<string, string | null>,
  byRef: ReadonlyMap<string, ActionRecord>,
): Promise<{ moved: MovedHookBindings['moved']; left: MovedHookBindings['left']; saved: boolean }> {
  const moved: MovedHookBindings['moved'] = [];
  const left: MovedHookBindings['left'] = [];
  let saved = true;
  for (const hook of HOOK_NAMES) {
    const refs = config.extensionHooks[hook] ?? [];
    let changed = false;
    const next = refs.map((ref) => {
      const parsed = accountNameRef(ref);
      if (!parsed || !ghiiOf.has(parsed.name)) return ref;
      const ghii = ghiiOf.get(parsed.name);
      const to = ghii ? `${parsed.id}#${ghii}` : null;
      const found = to ? byRef.get(to) : undefined;
      if (to && found && qualifiedRef(found) === to) {
        moved.push({ hook, from: ref, to });
        changed = true;
        return to;
      }
      left.push({ hook, ref });
      return ref;
    });
    if (!changed) continue;
    config.extensionHooks[hook] = next;
    try {
      await storage.setConfigValue(`hooks.${hook}`, JSON.stringify(next));
    } catch (err) {
      saved = false;
      logger.error(`hooks-overview: the moved binding of ${hook} could not be saved. It applies until the node stops.`, { error: String(err) });
    }
  }
  for (const { hook, from, to } of moved) {
    logger.info(`hooks-overview: "${from}" on ${hook} is stored as ${to}, where its action is published now`);
  }
  return { moved, left, saved };
}

/**
 * Move each stored binding that names an action by the bare account name of the person who published
 * it (`id#name`) to the form that action is stored in now, `id#<GHII>`.
 *
 * WHY. An action a person published in person was stored under their bare account name, so a binding
 * to it was stored as `id#name`: setHookActions and the settle above both store the action's own
 * `id#provider`. The move to the full identity (Postgres 0086, and sqlite/schema-identity-backfill.ts)
 * moves those actions to the person's GHII when the store opens, before this. So at start:
 *   - `id#name` becomes `id#<GHII of that account>` when the action `id` is published under that
 *     GHII. That is the action the binding was made for: the move put it there because that account
 *     held the name when the action was written.
 *   - Any other `id#name` stays as it was. Its action was a deleted account's and is gone, or the move
 *     left it under the bare name for the operator to decide. The incident the node opens for what the
 *     move left lists every such binding (services/held-account-names.ts).
 *
 * ONCE PER NODE, under its own record (HOOK_BINDINGS_FULL_IDENTITY_KEY), for the reason the settle
 * above gives: a later start must not let what is published by then decide what a binding names. The
 * settle's record cannot serve, because a node that ran the settle has it already. A start with no
 * such binding reads nothing and writes nothing. When the store cannot be read, or a change cannot be
 * saved, no record is written and the next start tries again; a change applies to the running node
 * even when it cannot be saved.
 */
export async function moveAccountNameHookBindings(config: AimeatConfig, storage: Storage): Promise<MovedHookBindings> {
  const out: MovedHookBindings = { ran: false, moved: [], left: [] };
  const names = new Set<string>();
  for (const hook of HOOK_NAMES) {
    for (const ref of config.extensionHooks[hook] ?? []) {
      const parsed = accountNameRef(ref);
      if (parsed) names.add(parsed.name);
    }
  }
  if (names.size === 0) return out;

  const system = `system@${config.nodeId}`;
  let byRef: Map<string, ActionRecord>;
  const ghiiOf = new Map<string, string | null>();
  try {
    if (await storage.getMemory(system, HOOK_BINDINGS_FULL_IDENTITY_KEY)) return out;
    byRef = indexActionRefs(await storage.listActions()).byRef;
    for (const name of names) ghiiOf.set(name, (await storage.getGHIIByOwner(name))?.ghii ?? null);
  } catch (err) {
    logger.error('hooks-overview: the hook bindings that name an account by its bare name were not checked at start, because the store could not be read. The next start tries again.', { error: String(err) });
    return out;
  }
  out.ran = true;

  const { moved, left, saved } = await followActionsToFullIdentity(config, storage, ghiiOf, byRef);
  out.moved = moved;
  out.left = left;
  for (const { hook, ref } of out.left) {
    logger.warn(`hooks-overview: "${ref}" on ${hook} stays as it is: no action is published under that account's full identity with this id. The Security page lists it with what the move to the full identity left.`);
  }
  if (!saved) {
    logger.warn('hooks-overview: a moved binding was not saved, so the record is not written and the next start moves it again.');
  }

  if (saved) {
    const now = new Date().toISOString();
    try {
      await storage.setMemory({
        key: HOOK_BINDINGS_FULL_IDENTITY_KEY,
        ownerGaii: system,
        value: { at: now, moved: out.moved.length, left: out.left.length },
        visibility: 'private',
        tags: ['migration'],
        // Never swept: a record that expired would move the bindings again at the next start.
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      logger.error('hooks-overview: the record that the account-name hook bindings are moved could not be saved. The next start moves them again.', { error: String(err) });
    }
  }
  return out;
}
