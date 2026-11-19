/**
 * @file src/services/hook-when-missing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a blocking hook does when the action bound to it is missing, and who hears of it.
 *
 *   WHY IT EXISTS. A blocking hook (a `pre_` moment) whose bound action is no longer published, or
 *   is published without an address, calls nobody and lets the event through (services/hooks.ts,
 *   pinned by test/unit/hooks.test.ts). That stays the default: a node whose registration or
 *   peering stopped because somebody unpublished an action would be worse off than one whose check
 *   stood down. Two things were missing around it, and this file is both:
 *   - THE OPERATORS ARE TOLD. The first time a blocking hook finds its action missing on a given day,
 *     every operator gets one notification for that hook and that action. Once per binding per day,
 *     not once per event: a busy registration moment would otherwise fill the bell.
 *   - A SETTING PER HOOK: let through (`pass`, the default) or refuse (`refuse`). Stored beside the
 *     binding as the config value `hooks.<name>.when_missing`, set through PUT /v1/admin/hooks/:hookName
 *     (`when_missing`), the aimeat_admin_hook_set tool and the Hooks page.
 *
 *   A notify hook (`post_` and the others) is told after the fact and stops nothing, so the setting
 *   does not apply to it and is refused for it.
 * @structure
 *   - HOOK_WHEN_MISSING_VALUES · hookWhenMissingKey(name) · whenMissingOf(config, name)
 *   - applyStoredWhenMissing(config, key, raw) — one stored row into the running config (start, reload)
 *   - setHookWhenMissing(config, storage, hookName, value) — the one write, for REST, MCP and the page
 *   - tellOperatorsActionMissing(config, storage, hook, ref, mode) — at most once per binding per day
 * @usage
 *   if (whenMissingOf(config, hookName) === 'refuse') return refuse();
 *   void tellOperatorsActionMissing(config, storage, hookName, ref, 'pass');
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 2.4).
 */
import type { AimeatConfig, HookName, HookWhenMissing } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { notify } from './notify.js';
import { listOperatorGhiis } from './operators.js';

export const HOOK_WHEN_MISSING_VALUES: readonly HookWhenMissing[] = ['pass', 'refuse'];

/** The config value beside the binding `hooks.<name>`. */
export const hookWhenMissingKey = (name: string): string => `hooks.${name}.when_missing`;

const KEY_RE = /^hooks\.([a-z_]+)\.when_missing$/;

/** The hook's setting, `pass` when none was made. */
export function whenMissingOf(config: AimeatConfig, name: HookName): HookWhenMissing {
  return config.extensionHookWhenMissing?.[name] === 'refuse' ? 'refuse' : 'pass';
}

const isGate = (name: string) => name.startsWith('pre_');

/**
 * One stored row into the running config, at start (server-bootstrap/config-init.ts) and when the
 * stored config is read again (services/config/reload.ts). Answers false for a row that is not one.
 */
export function applyStoredWhenMissing(config: AimeatConfig, key: string, raw: string): boolean {
  const m = KEY_RE.exec(key);
  if (!m || !(m[1]! in config.extensionHooks) || !isGate(m[1]!)) return false;
  const value = raw.replace(/^"|"$/g, '');
  if (!HOOK_WHEN_MISSING_VALUES.includes(value as HookWhenMissing)) return false;
  config.extensionHookWhenMissing = { ...config.extensionHookWhenMissing, [m[1] as HookName]: value as HookWhenMissing };
  return true;
}

export type SetWhenMissingOutcome =
  | { ok: true; hook: HookName; when_missing: HookWhenMissing; note: string }
  | { ok: false; code: 'INVALID_INPUT'; message: string };

/** Check a value before anything is written; null when it can be set. */
export function whenMissingRefusal(config: AimeatConfig, hookName: string, value: unknown): string | null {
  if (!(hookName in config.extensionHooks)) return `Unknown hook "${hookName}".`;
  if (!isGate(hookName)) {
    return `"${hookName}" is told after the fact and stops nothing, so it has no setting for a missing action. Only a hook whose name starts with pre_ has one.`;
  }
  if (!HOOK_WHEN_MISSING_VALUES.includes(value as HookWhenMissing)) {
    return 'when_missing must be "pass" (let the event through, the default) or "refuse" (refuse the event).';
  }
  return null;
}

/** Set what one blocking hook does when its action is missing. */
export async function setHookWhenMissing(
  config: AimeatConfig, storage: Storage, hookName: string, value: unknown,
): Promise<SetWhenMissingOutcome> {
  const refusal = whenMissingRefusal(config, hookName, value);
  if (refusal) return { ok: false, code: 'INVALID_INPUT', message: `${refusal} Nothing was changed.` };
  const name = hookName as HookName;
  const mode = value as HookWhenMissing;
  // Written as a row in both cases: the reload on another process applies a changed row and ignores a
  // removed one (services/config/reload.ts), so a removal would not reach it.
  await storage.setConfigValue(hookWhenMissingKey(name), mode);
  config.extensionHookWhenMissing = { ...config.extensionHookWhenMissing, [name]: mode };
  return {
    ok: true, hook: name, when_missing: mode,
    note: mode === 'refuse'
      ? 'When the action bound to this hook is missing, the hook refuses the event. The operators are told once a day.'
      : 'When the action bound to this hook is missing, the hook lets the event through. The operators are told once a day.',
  };
}

/** Under system@<node>: the day each (hook, action) pair was last told about, so it is told once a day. */
export const MISSING_NOTICES_KEY = 'hooks.missing-action-notices';

type NoticeDays = Record<string, string>;
const parseDays = (v: unknown): NoticeDays => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as NoticeDays) } : {});

/**
 * Tell every operator that a blocking hook found its action missing, at most once per hook and action
 * per day. Best-effort: never throws, because the event the hook guards must not wait on the bell.
 */
export async function tellOperatorsActionMissing(
  config: AimeatConfig, storage: Storage, hook: HookName, ref: string, mode: HookWhenMissing,
): Promise<boolean> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const pair = `${hook}|${ref}`;
    let first = false;
    await updateRecord<NoticeDays>(storage, `system@${config.nodeId}`, MISSING_NOTICES_KEY, parseDays, (cur) => {
      if (cur[pair] === today) return UNCHANGED;
      first = true;
      // Only today's pairs are kept: a day later each one may be told again.
      const next: NoticeDays = {};
      for (const [k, d] of Object.entries(cur)) if (d === today) next[k] = d;
      next[pair] = today;
      return next;
    }, { tag: 'hooks' });
    if (!first) return false;
    const type = mode === 'refuse' ? 'hook_action_missing_refuse' : 'hook_action_missing_pass';
    const title = `The blocking hook ${hook} has no action to call`;
    const body = mode === 'refuse'
      ? `${hook} is bound to ${ref}, which is not published on this node or has no address. The hook refuses every event it checks until you publish the action again, bind another one or clear the hook.`
      : `${hook} is bound to ${ref}, which is not published on this node or has no address. The hook lets every event through until you publish the action again, bind another one or clear the hook. You can set the hook to refuse instead.`;
    const operators = await listOperatorGhiis(storage, config);
    await Promise.all(operators.map(ghii => notify(storage, ghii, {
      type, title, body, link: '/v1/admin?tab=hooks', i18n: { key: type, vars: { hook, ref } },
    })));
    return true;
  } catch (err) {
    logger.warn('hooks: the operators were not told that a blocking hook has no action', { hook, ref, error: String(err) });
    return false;
  }
}
