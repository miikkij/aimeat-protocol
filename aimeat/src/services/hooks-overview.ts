/**
 * @file hooks-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Hooks page in one read, and the two writes behind it.
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
 *   - HOOK_GUARDS — which part of the node each moment belongs to
 * @usage
 *   const overview = await buildHooksOverview(config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import type { AimeatConfig, HookName } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { HOOK_NAMES, hookKind, HOOK_TIMEOUT_MS, type HookKind } from './hooks.js';
import { readHookRuns, HOOK_RUNS_KEPT, type HookRun } from './hook-log.js';
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

  const byRef = new Map<string, { id: string; displayName: string; webhookUrl?: string }>();
  for (const a of published) {
    byRef.set(a.id, a);
    byRef.set(`${a.id}#${a.providerGaii}`, a);
  }
  const newestFor = new Map<string, HookRun>();
  for (const run of runs) {
    if (!newestFor.has(run.hook)) newestFor.set(run.hook, run);
  }

  const hooks: HookRow[] = HOOK_NAMES.map((name) => {
    const kind = hookKind(name);
    const refs = config.extensionHooks[name] ?? [];
    const actions: BoundAction[] = refs.map((ref) => {
      const found = byRef.get(ref);
      return {
        ref,
        name: found?.displayName ?? null,
        published: !!found,
        has_address: !!found?.webhookUrl,
        host: hostOf(found?.webhookUrl),
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
  | { ok: false; code: 'INVALID_INPUT'; message: string };

/**
 * Bind a list of actions to one moment, or clear it with an empty list. THE one implementation:
 * PUT and DELETE on /v1/admin/hooks and the aimeat_admin_hook_set tool all land here.
 *
 * An action that is not published here is accepted and NAMED back, rather than refused: binding
 * before publishing is a legitimate order of work, and a silent acceptance is how a binding that
 * calls nothing ends up looking exactly like one that works.
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
  const list = (actions as string[]).map((a) => a.trim());

  config.extensionHooks[name] = list;
  if (list.length === 0) {
    await storage.deleteConfigValue(`hooks.${name}`);
  } else {
    await storage.setConfigValue(`hooks.${name}`, JSON.stringify(list));
  }

  // The binding is already written; whether the references match anything published is the extra
  // courtesy below it. An unreadable actions table means we cannot say, so nothing is named as
  // unknown rather than everything being named wrongly.
  const published = await storage.listActions().catch((err: unknown) => {
    logger.warn('hooks-overview: the actions could not be read after a binding, so it is not checked', { error: String(err) });
    return [];
  });
  const known = new Set<string>();
  for (const a of published) { known.add(a.id); known.add(`${a.id}#${a.providerGaii}`); }
  const unknown = list.filter((ref) => !known.has(ref));

  const kind = hookKind(name);
  const note = list.length === 0
    ? 'Nothing is bound to this moment any more. It no longer calls out.'
    : kind === 'gate'
      ? `Bound. This moment now waits for ${list.length === 1 ? 'this address' : 'these addresses'} before it lets anything through, and refuses when one does not answer within ${HOOK_TIMEOUT_MS / 1000} seconds.`
      : 'Bound. This moment is told after the fact; whatever the address answers, nothing is stopped.';

  return { ok: true, hook: name, actions: list, cleared: list.length === 0, unknown, note };
}
