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
 * @structure
 *   - HOOK_NAMES / hookKind(name)         — the canonical list, and gate vs notify
 *   - executeHooks(config, storage, ...)  — resolve, call in order, record, abort on refusal
 *   - listHooks(config)                   — what is bound to each moment
 *   - HookContext / HookResult            — the context passed through and the outcome
 * @usage
 *   const r = await executeHooks(config, storage, 'pre_owner_registration', { name, display_name });
 *   if (!r.allowed) return refuse(r.reason);
 * @version-history
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
    const byRef = new Map<string, ActionRecord>();
    for (const a of published) {
        // Two accepted spellings, unchanged: the bare id, and the id with its provider's identity.
        byRef.set(a.id, a);
        byRef.set(`${a.id}#${a.providerGaii}`, a);
    }

    for (const actionRef of actions) {
        const started = Date.now();
        const action = byRef.get(actionRef);
        if (!action) {
            logger.warn(`Extension hook ${hookName}: action "${actionRef}" not found, skipping`);
            await record(storage, hookName, actionRef, undefined, 'missing', null, Date.now() - started, true, subject,
                'The bound action is not published on this node');
            continue;
        }

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
                const body = await response.text().catch(() => '');
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
            const result = await response.json().catch(() => ({})) as Record<string, unknown>;
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
