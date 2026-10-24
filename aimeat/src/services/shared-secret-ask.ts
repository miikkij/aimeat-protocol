/**
 * @file src/services/shared-secret-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The refused first use of a value from an extension's shared secret map (living-hooks'
 *   `secrets` config: the operator's key for everyone on the node), and the question it puts to the
 *   node's operators.
 *
 *   WHY (secaudit2026oct22; Jouni, 2026-10-24). A shared value with no host is bound to the host of
 *   its first use, and that host then serves every account. Before this, any signed-in account could
 *   name a host on its own living-hooks list, receive the operator's value there, and leave the
 *   operator's real host refused. The first use now binds by itself only toward a host on the
 *   operator's allow_hosts, a host the extension declares, or when the operator makes the call in
 *   person (services/extension-secret-authority.ts decideSharedFirstUse). Every other first use is
 *   refused before anything is sent, and the operators hear about it once per (secret, host).
 *
 *   HOW THE OPERATOR APPROVES. With the control that already exists: the host goes on the extension's
 *   allow_hosts (PATCH /v1/extensions/:name/config, or the MCP tool aimeat_extension_config_set). An
 *   extension that declares no allow_hosts field is approved by declaring the host for the secret in
 *   its manifest (`uses_secrets`). After that the same use goes through for every account.
 *
 *   ONCE PER (SECRET, HOST). The hosts already asked about are kept on one row per secret in the
 *   Secret table, under the extension's own namespace (owner-secrets.ts sharedBindingOwner), which no
 *   account lists or exports. The row holds no value. At most MAX_ASKS hosts are kept per secret, so a
 *   script that tries many hosts cannot fill the operators' bell; past that, a refusal asks nobody.
 * @structure SHARED_SECRET_ASK_TYPE · sharedFirstUseMessage · askOperatorsAboutSharedHost
 * @usage
 *   await askOperatorsAboutSharedHost({ storage, config }, { extName, installer, secret, host, requestedBy, allowHostsField });
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22; Jouni, 2026-10-24).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { SecretApproval } from '../storage/types/secrets.js';
import { notify } from './notify.js';
import { listOperatorGhiis } from './operators.js';
import { sharedBindingOwner } from './owner-secrets.js';
import { logger } from '../utils/logger.js';

export const SHARED_SECRET_ASK_TYPE = 'shared_secret_host_ask';
/** The locale key of the notice for an extension that has no allow_hosts field. */
const SHARED_SECRET_DECLARE_TYPE = 'shared_secret_host_ask_declare';
/** The most hosts kept per shared secret. */
const MAX_ASKS = 20;
/** How many times the write retries when the list changed under it. */
const SWAP_TRIES = 4;
/** The installer of a node-provided extension (BUILTIN_EXTENSION_OWNER). */
const NODE_INSTALLER = 'system';

/** The hostname part of `host[:port]`, which is what allow_hosts matches. */
function hostnameOf(host: string): string {
    return URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname : host;
}

/**
 * What the caller is told. It names the header, the secret and the host, never a value, and says who
 * approves the host and with which control.
 */
export function sharedFirstUseMessage(headerName: string, secretName: string, host: string, extName: string, allowHostsField: boolean): string {
    const how = allowHostsField
        ? `when one of them adds ${hostnameOf(host) || 'the host'} to the allow_hosts of ${extName} (PATCH /v1/extensions/${extName}/config, or the tool aimeat_extension_config_set)`
        : `when the extension declares this host for ${secretName} in its uses_secrets`;
    return `The header "${headerName}" asks for the shared secret ${secretName}, which this node's operator set for every account. `
        + `It has not been used with ${host || 'an address that does not parse'} before, and the node's operator approves a new host for a shared secret. `
        + `Nothing was sent. The operators have been told, and the same call works for every account ${how}.`;
}

/** The hosts already asked about for this secret, created empty on the first ask. */
async function addAsk(storage: Storage, owner: string, row: string, entry: SecretApproval): Promise<boolean> {
    const at = entry.requestedAt;
    await storage.createSecretIfAbsent({
        ownerGaii: owner, name: row, ciphertext: '', setAt: at, updatedAt: at, usedBy: {}, hosts: [], hostBinding: null, approvals: [],
    });
    for (let i = 0; i < SWAP_TRIES; i++) {
        const current = (await storage.getSecret(owner, row))?.approvals ?? [];
        if (current.some(a => a.host === entry.host) || current.length >= MAX_ASKS) return false;
        if (await storage.swapSecretApprovals(owner, row, current, [...current, entry])) return true;
    }
    return false;
}

/**
 * Tell every operator, once per (secret, host), that a first use of the shared secret waits for
 * them. An extension an account installed tells that account too, because its installer manages
 * the extension's config. Never throws: the refusal stands whether or not the notice went out.
 */
export async function askOperatorsAboutSharedHost(
    deps: { storage: Storage; config: AimeatConfig },
    req: { extName: string; installer: string; secret: string; host: string; requestedBy: string; allowHostsField: boolean },
): Promise<void> {
    if (!req.host) return;
    try {
        const owner = sharedBindingOwner(req.extName);
        const entry: SecretApproval = {
            extension: req.extName, installer: req.installer, host: req.host,
            requestedAt: new Date().toISOString(), requestedBy: req.requestedBy,
        };
        if (!(await addAsk(deps.storage, owner, `${req.secret}#asks`, entry))) return;
        const recipients = new Set(await listOperatorGhiis(deps.storage, deps.config));
        if (req.installer && req.installer !== NODE_INSTALLER) {
            recipients.add(req.installer.includes('@') ? req.installer : `${req.installer}@${deps.config.nodeId}`);
        }
        const hostname = hostnameOf(req.host);
        const vars = { requester: req.requestedBy, extension: req.extName, secret: req.secret, host: req.host, hostname };
        const body = req.allowHostsField
            ? `${req.requestedBy} asked ${req.extName} to send the shared secret ${req.secret} to ${req.host}. Nothing was sent. `
                + `To allow this host for every account, add ${hostname} to the allow_hosts of ${req.extName}: `
                + `PATCH /v1/extensions/${req.extName}/config, or the tool aimeat_extension_config_set.`
            : `${req.requestedBy} asked ${req.extName} to send the shared secret ${req.secret} to ${req.host}. Nothing was sent. `
                + `To allow this host for every account, declare it for ${req.secret} in the extension's uses_secrets.`;
        for (const to of recipients) {
            await notify(deps.storage, to, {
                type: SHARED_SECRET_ASK_TYPE,
                title: `${req.requestedBy} asks to use the shared secret ${req.secret} with ${req.host}`,
                body,
                i18n: { key: req.allowHostsField ? SHARED_SECRET_ASK_TYPE : SHARED_SECRET_DECLARE_TYPE, vars },
            });
        }
    } catch (err) {
        logger.warn('shared secret: the operators could not be told; the refusal still stands', {
            extension: req.extName, secret: req.secret, host: req.host, error: String(err),
        });
    }
}
