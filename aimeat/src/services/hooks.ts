/**
 * @file src/services/hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The eleven moments in this node's life where it stops and calls an address somebody
 *   named, and what it does with the answer.
 *
 *   FOUR OF THEM DECIDE. A hook whose name starts with `pre_` runs BEFORE the thing happens and its
 *   answer settles it: a registration, a work request, a board post or a new federation peer can be
 *   refused outright. The other seven are told once the thing has happened and cannot stop
 *   anything. That difference is the whole of this file's risk, and it is why `hookKind` exists:
 *   every surface that shows a hook to a person has to say which of the two it is.
 *
 *   A GATE IS FAIL-CLOSED, DELIBERATELY. An address that times out or errors REFUSES the thing. The
 *   alternative would be a gate that stops working the moment somebody unplugs it, which is not a
 *   gate. The cost is real and the operator has to be able to see it: one unreachable address
 *   stops every registration on the node, which is why every call is recorded (hook-log.ts) and why
 *   the Hooks page opens on whichever gate is failing.
 *
 *   WHAT IS BOUND is an action reference: a published action (POST /v1/actions) carrying a
 *   `webhookUrl`. The actions are resolved ONCE per hook execution rather than once per bound
 *   action: the old shape called storage.listActions() inside the loop, so three bound actions were
 *   three full scans of the actions table on the critical path of every registration.
 *
 *   A REFERENCE NAMES ONE ACTION OR NONE. The table is keyed (provider, id), so two owners can
 *   publish the same id. `id#provider` always names exactly one, and it is the form a binding is
 *   stored in. A bare id (a reference without `#`) is resolved in two places only, both of them a
 *   choice the operator makes or has made: when a binding is written (setHookActions) and when the
 *   stored bindings are settled at start (settleStoredHookBindings), and there only while exactly one
 *   provider publishes it. WHEN A HOOK RUNS, A BARE ID NAMES NO ACTION, whatever is published at that
 *   moment: resolveHookRef() says so for the executor and the page alike, nobody is called, and a gate
 *   bound to one refuses, as it refuses when it cannot tell what it is bound to. So no later
 *   publication or deletion decides what a stored binding names (security audit A8-3).
 *
 * @structure
 *   - HOOK_NAMES / hookKind(name)         — the canonical list, and gate vs notify
 *   - qualifiedRef(action) / isBareRef()  — the stored form of a reference, and the bare one
 *   - indexActionRefs(published)          — what each reference names, and the ambiguous bare ids
 *   - resolveHookRef(ref, index)          — what a stored reference names when a hook runs
 *   - executeHooks(config, storage, ...)  — resolve, call in order, record, abort on refusal
 *   - listHooks(config)                   — what is bound to each moment
 *   - HookContext / HookResult            — the context passed through and the outcome
 * @usage
 *   const r = await executeHooks(config, storage, 'pre_owner_registration', { name, display_name });
 *   if (!r.allowed) return refuse(r.reason);
 * @version-history
 *   v1.3.1 — 2026-10-05 — A hook action's answer is read under a ceiling (secaudit 2026-10, C6).
 *   v1.3.0 — 2026-09-26 — SECURITY (audit A8-3): resolveHookRef(). When a hook runs, only an id#provider
 *     reference names an action. A bare id names none, whatever is published at that moment: the
 *     executor calls nobody and a gate refuses, and the page shows it with the id#provider of each
 *     provider publishing the id now. indexActionRefs() also answers publishersOf for that list.
 *   v1.2.0 — 2026-09-24 — SECURITY (audit A8-3): indexActionRefs(). A bare id resolved to whichever
 *     owner's action listActions() returned last, so a second owner publishing the same id could
 *     receive the moment's context. Now a bare id two providers publish names nothing: the executor
 *     calls neither and a gate refuses, the binding write refuses it, and the page shows neither.
 *   v1.1.0 — 2026-09-12 — HOOK_NAMES and hookKind (the list lived in three places); the actions are
 *     resolved once per execution rather than once per bound action; every call is recorded through
 *     hook-log.ts, including the ones that used to vanish into the server log.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig, HookName } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ActionRecord } from '../storage/types/commerce.js';
import { logger } from '../utils/logger.js';
import { validateOutboundUrl, safeFetch } from '../utils/url-validator.js';
import { readJson, readText } from '../utils/read-capped.js';

/** A hook action answers allowed or not, with a reason: a small body, read under a ceiling so the
 *  action does not decide how much memory a request takes (secaudit 2026-10, C6). */
const HOOK_ANSWER_MAX_BYTES = 256 * 1024;
import { recordHookRun, type HookAnswer } from './hook-log.js';

/**
 * Every moment, in the order a person meets them. THE canonical list: config.ts seeds the same
 * eleven keys and the admin route used to carry a third copy, which is one list too many to keep
 * in step by hand.
 */
export const HOOK_NAMES: HookName[] = [
  'pre_owner_registration', 'post_owner_registration',
  'pre_agent_registration', 'post_agent_registration',
  'owner_recovery', 'agent_rekey',
  'pre_work_request', 'post_work_delivery', 'post_settlement',
  'pre_board_post', 'pre_federation_peer',
];

/** A gate decides whether the thing happens; a notify hook is told once it has. */
export type HookKind = 'gate' | 'notify';

export function hookKind(hookName: string): HookKind {
  return hookName.startsWith('pre_') ? 'gate' : 'notify';
}

/** How long one address gets to answer before the call is given up on. */
export const HOOK_TIMEOUT_MS = 10_000;

export interface HookContext {
    [key: string]: unknown;
}

export interface HookResult {
    allowed: boolean;
    reason?: string;
    hookAction?: string;
}

/** The form a binding stores a reference in: the action's id with its provider. It names one action. */
export function qualifiedRef(a: Pick<ActionRecord, 'id' | 'providerGaii'>): string {
    return `${a.id}#${a.providerGaii}`;
}

/**
 * A bare id: a reference without its provider. An id published through POST /v1/actions has no `#`
 * in it, and a qualified reference always has one. The load at start checks only that a stored list
 * is an array, so an entry is not assumed to be a string.
 */
export function isBareRef(ref: unknown): ref is string {
    return typeof ref === 'string' && !ref.includes('#');
}

/** What the references a binding may hold name among the published actions. */
export interface ActionRefIndex<T> {
    /** Every reference that names exactly one action: each `id#provider`, and each bare id only
     *  one provider publishes. The bare ones are for the moment a binding is written or settled;
     *  when a hook runs, resolveHookRef() reads only the `id#provider` ones. */
    byRef: Map<string, T>;
    /** Each bare id two or more providers publish, with the `id#provider` reference of each. */
    ambiguous: Map<string, string[]>;
    /** Each published id, with the `id#provider` reference of every provider that publishes it. */
    publishersOf: Map<string, string[]>;
}

/**
 * Index the published actions by the two spellings a binding may use, without ever letting scan
 * order choose between owners.
 *
 * `listActions()` has no ORDER BY and the table is keyed (provider, id), so filling one map with
 * both spellings made a bare id mean whichever row came last: a second owner publishing the operator's
 * id took the binding over (security audit A8-3). A bare id is kept only when exactly one provider
 * publishes it; otherwise it goes into `ambiguous` with every provider-qualified reference, which is
 * what the refusal names back so the operator can pick one.
 */
export function indexActionRefs<T extends Pick<ActionRecord, 'id' | 'providerGaii'>>(
    published: readonly T[],
): ActionRefIndex<T> {
    const byRef = new Map<string, T>();
    const byId = new Map<string, T[]>();
    for (const a of published) {
        byRef.set(qualifiedRef(a), a);
        byId.set(a.id, [...(byId.get(a.id) ?? []), a]);
    }
    const ambiguous = new Map<string, string[]>();
    const publishersOf = new Map<string, string[]>();
    for (const [id, holders] of byId) {
        publishersOf.set(id, holders.map(qualifiedRef));
        if (holders.length === 1) {
            if (!byRef.has(id)) byRef.set(id, holders[0]);
        } else {
            ambiguous.set(id, holders.map(qualifiedRef));
        }
    }
    return { byRef, ambiguous, publishersOf };
}

/** What a stored reference names when a hook runs. */
export type ResolvedHookRef<T> =
    /** The `id#provider` of a published action: the one action it names. */
    | { kind: 'action'; action: T }
    /** A bare id. It names no action, whatever is published at this moment. `claimants` is the
     *  `id#provider` of each provider that publishes the id now, possibly none: what to bind instead. */
    | { kind: 'bare'; claimants: string[] }
    /** An `id#provider` nothing publishes now, such as an action deleted since it was bound. */
    | { kind: 'missing' };

/**
 * What a stored reference names when a hook runs, for the executor and the page alike. Only the
 * exact `id#provider` of a published action resolves. A bare id resolves to nothing here, even when
 * one provider publishes it: whoever publishes or deletes that id later must not decide what a
 * stored binding names. A bare id is resolved only when a binding is written or settled.
 */
export function resolveHookRef<T extends Pick<ActionRecord, 'id' | 'providerGaii'>>(
    ref: unknown,
    index: ActionRefIndex<T>,
): ResolvedHookRef<T> {
    if (typeof ref !== 'string') return { kind: 'missing' };
    const found = index.byRef.get(ref);
    if (found && ref === qualifiedRef(found)) return { kind: 'action', action: found };
    if (isBareRef(ref)) return { kind: 'bare', claimants: index.publishersOf.get(ref) ?? [] };
    return { kind: 'missing' };
}

/**
 * Execute every action bound to one moment, in the order the operator listed them.
 *
 * A gate stops at the first refusal: the actions after it are not called, because the thing is
 * already not happening. A notify hook calls all of them whatever each one answers.
 */
export async function executeHooks(
    config: AimeatConfig,
    storage: Storage,
    hookName: HookName,
    context: HookContext,
): Promise<HookResult> {
    const actions = config.extensionHooks[hookName];
    if (!actions || actions.length === 0) {
        return { allowed: true };
    }

    const kind = hookKind(hookName);
    const subject = subjectOf(context);

    // ONCE, not once per bound action. This runs on the critical path of every registration, work
    // request and board post; the old shape scanned the whole actions table for each bound action.
    let published: ActionRecord[];
    try {
        published = await storage.listActions();
    } catch (err) {
        logger.error(`Extension hook ${hookName}: the actions could not be read`, { error: err });
        // A gate that cannot read what it is supposed to call has not been satisfied. Same rule as
        // an address that will not answer: fail closed, and say so in the log the operator reads.
        if (kind === 'gate') {
            await record(storage, hookName, actions[0] ?? '', undefined, 'no_answer', null, 0, false, subject,
                'The actions could not be read');
            return { allowed: false, reason: 'Hook actions could not be read', hookAction: actions[0] };
        }
        return { allowed: true };
    }
    // Only the id with its provider's identity names an action here; a bare id names none, whatever
    // is published at this moment (resolveHookRef).
    const index = indexActionRefs(published);

    for (const actionRef of actions) {
        const started = Date.now();
        const bound = resolveHookRef(actionRef, index);
        if (bound.kind === 'bare') {
            // Calling whichever provider publishes the id now would let a publication or a deletion
            // decide where this moment's context goes, so nobody is called. A gate that cannot tell
            // what it is bound to has not been satisfied, the same rule as an address that will not
            // answer: it refuses.
            const claimants = bound.claimants;
            logger.warn(`Extension hook ${hookName}: "${actionRef}" is a bare id, which names no one action, calling none`);
            await record(storage, hookName, actionRef, undefined, 'missing', null, Date.now() - started, kind !== 'gate', subject,
                'A bare id names no one action when a hook runs. '
                + (claimants.length > 0 ? `Published under this id now: ${claimants.join(', ')}. ` : 'Nothing is published under this id now. ')
                + 'Bind the one you mean as id#provider.');
            if (kind === 'gate') {
                return {
                    allowed: false,
                    reason: `Hook action "${actionRef}" does not name one published action`,
                    hookAction: actionRef,
                };
            }
            continue;
        }
        if (bound.kind === 'missing') {
            logger.warn(`Extension hook ${hookName}: action "${actionRef}" not found, skipping`);
            await record(storage, hookName, actionRef, undefined, 'missing', null, Date.now() - started, true, subject,
                'The bound action is not published on this node');
            continue;
        }
        const action = bound.action;

        const webhookUrl = action.webhookUrl;
        if (!webhookUrl) {
            // Bound, and does nothing. Recorded rather than passed over in silence: on the page this
            // is the row that reads "no address, does nothing", which is the only way an operator
            // learns that a binding they made is decorative.
            await record(storage, hookName, actionRef, action.displayName, 'no_address', null, Date.now() - started, true, subject);
            continue;
        }

        try {
            // SSRF validation: block requests to private/reserved IPs.
            const urlCheck = await validateOutboundUrl(webhookUrl);
            if (!urlCheck.valid) {
                logger.warn(`Blocked outbound request to ${webhookUrl}: ${urlCheck.reason}`);
                await record(storage, hookName, actionRef, action.displayName, 'no_answer', null, Date.now() - started,
                    kind !== 'gate', subject, `The address was refused: ${urlCheck.reason}`);
                // A gate whose address this node refuses to call has not answered, and a gate that
                // has not answered refuses. Before this the call was skipped and the thing went
                // through, which is the one shape a gate must never have.
                if (kind === 'gate') {
                    return {
                        allowed: false,
                        reason: `Hook action "${actionRef}" could not be called`,
                        hookAction: actionRef,
                    };
                }
                continue;
            }

            const response = await safeFetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hook: hookName,
                    action_ref: actionRef,
                    context,
                    node_id: config.nodeId,
                    timestamp: new Date().toISOString(),
                }),
                signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
            });

            if (!response.ok) {
                // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
                const body = await readText(response, HOOK_ANSWER_MAX_BYTES).catch(() => '');
                logger.info(`Extension hook ${hookName}: action "${actionRef}" rejected`, { status: response.status, body });
                await record(storage, hookName, actionRef, action.displayName, 'refused', response.status,
                    Date.now() - started, kind !== 'gate', subject, body.slice(0, 200) || undefined);
                if (kind === 'gate') {
                    return {
                        allowed: false,
                        reason: `Hook action "${actionRef}" rejected the request`,
                        hookAction: actionRef,
                    };
                }
                continue;
            }

            // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
            const result = await readJson(response, HOOK_ANSWER_MAX_BYTES).catch(() => ({})) as Record<string, unknown>;
            if (result.allowed === false) {
                const reason = (result.reason as string) ?? `Hook action "${actionRef}" denied`;
                await record(storage, hookName, actionRef, action.displayName, 'refused', response.status,
                    Date.now() - started, kind !== 'gate', subject, reason);
                if (kind === 'gate') {
                    return { allowed: false, reason, hookAction: actionRef };
                }
                continue;
            }

            await record(storage, hookName, actionRef, action.displayName, 'ok', response.status,
                Date.now() - started, true, subject);
        } catch (err) {
            logger.error(`Extension hook ${hookName}: action "${actionRef}" failed`, { error: err });
            await record(storage, hookName, actionRef, action.displayName, 'no_answer', null, Date.now() - started,
                kind !== 'gate', subject, (err as Error).message?.slice(0, 200));
            // Fail-closed for a gate, and only for a gate. A notify hook's failure is recorded and
            // the thing that already happened stays happened.
            if (kind === 'gate') {
                return {
                    allowed: false,
                    reason: `Hook action "${actionRef}" failed to execute`,
                    hookAction: actionRef,
                };
            }
        }
    }

    return { allowed: true };
}

/** One row in the log, never allowed to break the call it describes. */
async function record(
    storage: Storage,
    hook: string,
    actionRef: string,
    actionName: string | undefined,
    answer: HookAnswer,
    status: number | null,
    ms: number,
    allowed: boolean,
    subject: string | undefined,
    reason?: string,
): Promise<void> {
    await recordHookRun(storage, {
        at: new Date().toISOString(),
        hook, actionRef,
        ...(actionName ? { actionName } : {}),
        answer, status, ms, allowed,
        ...(subject ? { subject } : {}),
        ...(reason ? { reason } : {}),
    });
}

/**
 * What the thing WAS, in a few words, so a refusal in the log names who was turned away.
 *
 * The first two scalars of the hook's own context, truncated. Generic on purpose: every hook passes
 * a different shape, and a per-hook formatter is eleven things to keep in step with eleven call
 * sites. Nothing here is secret — a hook context carries names and identities, which is what the
 * webhook is being sent anyway.
 */
export function subjectOf(context: HookContext): string | undefined {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(context)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'object') continue;
        parts.push(`${key}: ${String(value).slice(0, 60)}`);
        if (parts.length === 2) break;
    }
    return parts.length ? parts.join(' · ').slice(0, 120) : undefined;
}

/**
 * List all configured extension hooks.
 */
export function listHooks(config: AimeatConfig): Record<string, string[]> {
    return { ...config.extensionHooks };
}
