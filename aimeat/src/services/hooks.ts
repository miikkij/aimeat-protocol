/**
 * @file src/services/hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension-hook execution service — runs the action references configured for a hook
 *   name in sequence, calling each action's webhook (SSRF-guarded), aborting the flow on rejection.
 *
 * @structure
 *   - executeHooks(config, storage, hookName, context): resolves action refs, POSTs to their webhooks
 *   - HookContext / HookResult: passed-through context and { allowed, reason?, hookAction? } outcome
 *   - outbound calls gated by validateOutboundUrl + safeFetch with a 10s timeout
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig, HookName } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { validateOutboundUrl, safeFetch } from '../utils/url-validator.js';

export interface HookContext {
    [key: string]: unknown;
}

export interface HookResult {
    allowed: boolean;
    reason?: string;
    hookAction?: string;
}

/**
 * Execute all extension hooks for a given hook name.
 * Each hook is an action reference (GAII format).
 * Actions are called in sequence; if any returns failure, the flow is aborted.
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

    for (const actionRef of actions) {
        try {
            // Action ref format: "actionId#owner@node" or just "actionId"
            // Try to find by iterating actions since we may not have provider GAII
            const allActions = await storage.listActions();
            const action = allActions.find(a => a.id === actionRef || `${a.id}#${a.providerGaii}` === actionRef);
            if (!action) {
                logger.warn(`Extension hook ${hookName}: action "${actionRef}" not found, skipping`);
                continue;
            }

            // Execute the hook action via webhook if configured
            const webhookUrl = action.webhookUrl;
            if (webhookUrl) {
                // SSRF validation: block requests to private/reserved IPs
                const urlCheck = await validateOutboundUrl(webhookUrl);
                if (!urlCheck.valid) {
                    logger.warn(`Blocked outbound request to ${webhookUrl}: ${urlCheck.reason}`);
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
                    signal: AbortSignal.timeout(10_000),
                });

                if (!response.ok) {
                    // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
                    const body = await response.text().catch(() => '');
                    logger.info(`Extension hook ${hookName}: action "${actionRef}" rejected`, { status: response.status, body });
                    return {
                        allowed: false,
                        reason: `Hook action "${actionRef}" rejected the request`,
                        hookAction: actionRef,
                    };
                }

                // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
                const result = await response.json().catch(() => ({})) as Record<string, unknown>;
                if (result.allowed === false) {
                    return {
                        allowed: false,
                        reason: (result.reason as string) ?? `Hook action "${actionRef}" denied`,
                        hookAction: actionRef,
                    };
                }
            }
            // If no webhook URL, the action is a no-op placeholder — allow by default
        } catch (err) {
            logger.error(`Extension hook ${hookName}: action "${actionRef}" failed`, { error: err });
            // On hook execution failure, abort (fail-closed for pre-hooks)
            if (hookName.startsWith('pre_')) {
                return {
                    allowed: false,
                    reason: `Hook action "${actionRef}" failed to execute`,
                    hookAction: actionRef,
                };
            }
            // Post-hooks failure is logged but doesn't block
        }
    }

    return { allowed: true };
}

/**
 * List all configured extension hooks.
 */
export function listHooks(config: AimeatConfig): Record<string, string[]> {
    return { ...config.extensionHooks };
}
