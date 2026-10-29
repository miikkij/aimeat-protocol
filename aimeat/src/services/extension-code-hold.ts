/**
 * @file src/services/extension-code-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension code that a package brings into an account which may not install extension
 *   code waits for an operator's one-press approval.
 *
 *   WHY. With AIMEAT_EXT_INSTALL_ROLE=operator only the operator's account writes extension code, and
 *   every /v1/extensions door asks it. A package install and an instance migration wrote the same code
 *   through the component registrar without asking (secaudit2026oct26, applyInstanceMigration:
 *   extension-component-code-bypasses-install-role). The developer's decision (2026-10-29, round 8c):
 *   the role applies on every path. When a package carries extension code and the installer does not
 *   hold the role, the rest of the package installs and the extension code waits for the operator's
 *   one-press approval; the installer sees it pending. An installer who holds the role sees no change.
 *
 *   HOW. The registrar (component-registrar.ts) stores the extension switched off, with the request id
 *   under the node-owned config key EXTENSION_CODE_HOLD_KEY (a `__` key, which no manifest and no config
 *   write can set), and files the question in the request store under the approval standard
 *   (services/approval-standard.ts): the operators get a notice with Allow and Don't allow, the account
 *   hears that it was asked, and the one who installed hears the answer either way. The activate doors
 *   refuse a held extension to anyone but an operator (codeHoldRefusal). Allow takes the key away and
 *   switches the extension on (publish-requests/apply-extension-code.ts). Don't allow leaves it switched
 *   off; the account may remove it.
 *
 *   WHAT AN APPROVAL CONFIRMS. That extension, installed by that account, at that version and with those
 *   action scripts: code written after the question is not what the operator saw, and the request ends
 *   `outdated`.
 * @structure EXTENSION_CODE_HOLD_KEY · heldCodeRequest · withoutCodeHold · codeHoldRefusal · takeHoldOff ·
 *   requesterFromPrincipal · askOperatorsForExtensionCode
 * @usage
 *   const held = await askOperatorsForExtensionCode({ storage, config }, created, requester, packageName);
 *   const refused = codeHoldRefusal(ext, isOperator); if (refused) return res.status(409)...
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, extensions-08).
 */
import type { ExtensionRecord, Storage } from '../storage/interface.js';
import { fileAsk } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { actionCodeDigest } from './extension-email-policy-ask.js';
import { askerKind } from './approval-standard.js';
import { logger } from '../utils/logger.js';

/** The node-owned config key a held extension carries: the request id, or 'pending' before it is filed. */
export const EXTENSION_CODE_HOLD_KEY = '__awaitingOperator';

/** The request a held extension waits on, 'pending' when none could be filed, or null when it is not held. */
export function heldCodeRequest(config: Record<string, unknown> | undefined): string | null {
    const v = config?.[EXTENSION_CODE_HOLD_KEY];
    return typeof v === 'string' && v ? v : null;
}

/** The config without the hold, for the write that switches the extension on. */
export function withoutCodeHold(config: Record<string, unknown>): Record<string, unknown> {
    if (!(EXTENSION_CODE_HOLD_KEY in config)) return config;
    const out = { ...config };
    delete out[EXTENSION_CODE_HOLD_KEY];
    return out;
}

/** What an activate door answers for a held extension, or null. The operator in person or by agent passes. */
export function codeHoldRefusal(ext: Pick<ExtensionRecord, 'name' | 'config'>, isOperator: boolean):
    { status: 409; code: 'AWAITING_OPERATOR'; message: string; request_id: string | null } | null {
    const request = heldCodeRequest(ext.config);
    if (!request || isOperator) return null;
    const id = request === 'pending' ? null : request;
    return {
        status: 409, code: 'AWAITING_OPERATOR', request_id: id,
        message: `The code of ${ext.name} came with a package, and on this node only the operator's account installs add-on code `
            + '(the setting AIMEAT_EXT_INSTALL_ROLE is "operator"). It stays switched off until an operator allows it'
            + `${id ? ` (request ${id}, readable at GET /v1/publish-requests/${id})` : ''}. You hear the answer in your notifications.`,
    };
}

/**
 * An operator switching a held extension on is the operator's own approval: the hold goes, and the
 * record to activate is answered. A record that is not held is answered as it is. A request still
 * waiting on it ends `outdated` when someone answers it (apply-extension-code.ts).
 */
export async function takeHoldOff(storage: Storage, ext: ExtensionRecord): Promise<ExtensionRecord> {
    if (!heldCodeRequest(ext.config)) return ext;
    const config = withoutCodeHold(ext.config ?? {});
    await storage.updateExtension(ext.name, { config });
    return { ...ext, config };
}

/** The requester as the request store keeps it, from the principal that pressed install. */
export function requesterFromPrincipal(principal: string): PublishRequester {
    return { principal, kind: askerKind(principal), sub: principal };
}

/**
 * Ask the operators to switch on `ext` as it is stored now, and write the request id on the record.
 * Answers the request id, or null with the reason logged when the question could not be filed (the
 * extension then stays switched off with 'pending', and an operator can still switch it on).
 */
export async function askOperatorsForExtensionCode(
    ctx: PublishStoreCtx, ext: ExtensionRecord, requester: PublishRequester, packageName: string,
): Promise<string | null> {
    try {
        const filed = await fileAsk(ctx, ext.installedBy, requester, {
            kind: 'extension-code',
            target: { extension: ext.name, installer: ext.installedBy, version: ext.version, digest: actionCodeDigest(ext.actions) },
            title: `the code of the extension ${ext.name}`,
            name: ext.name,
            change: { field: 'status', from: 'inactive', to: 'active' },
            approval: {
                approver: 'operators',
                asks: `switch on the extension ${ext.name}, which the package ${packageName} brought into the account ${ext.installedBy}`,
                why: 'On this node only the operator\'s account installs add-on code (the setting AIMEAT_EXT_INSTALL_ROLE is "operator"). '
                    + 'The rest of the package is installed; this extension stays switched off until an operator allows its code.',
                change: { link: '/v1/admin?tab=extensions', key: 'approval_change.extensions' },
                i18n: { key: 'approval_extension_code', vars: { extension: ext.name, account: ext.installedBy, package: packageName } },
            },
        });
        if (!filed.ok) {
            logger.warn('extension code hold: the operators were not asked', { extension: ext.name, error: filed.message });
            return null;
        }
        const id = filed.request.id;
        await ctx.storage.updateExtension(ext.name, { config: { ...(ext.config ?? {}), [EXTENSION_CODE_HOLD_KEY]: id } });
        return id;
    } catch (err) {
        logger.warn('extension code hold: the question could not be filed', { extension: ext.name, error: String(err) });
        return null;
    }
}
