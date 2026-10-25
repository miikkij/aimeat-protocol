/**
 * @file src/services/extension-config-set.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Change config values of an installed extension in place: no new version, no new
 *   code, the extension's memory and status untouched. One implementation for
 *   PATCH /v1/extensions/:name/config and the MCP tool aimeat_extension_config_set.
 *
 *   WHY. A package's config is answered at install, and until 2026-10-09 the only way to change one
 *   value afterwards was to install the extension again. A host field (manifest `network.host_fields`)
 *   made that a real need: the customer's Wazuh indexer moves, and the owner must point the installed
 *   SOC at the new address without a new build (wish-a-package-s-extension-hosts-settable-per-install-
 *   the-soc-s-w). The new value joins the fetch allowlist from the next run on, because
 *   capabilitiesOfRecord() reads the stored config on every invocation.
 *
 *   WHAT IS REFUSED, before anything is written: a field the manifest does not declare, a key the node
 *   owns (`__…`), a value that is not a string, number or boolean (so a ciphertext cannot be submitted
 *   as a secret), and a host field value that is not one host. A secret is encrypted as at install;
 *   without a node key it is refused.
 * @structure ConfigSetOutcome · declaredConfigFields(ext) · setExtensionConfig(deps, ext, values)
 * @usage
 *   const out = await setExtensionConfig({ storage, config }, ext, { WAZUH_HOST: 'wazuh.example.com' });
 *   if (!out.ok) return refuse(out.status, out.code, out.message);
 * @version-history
 *   2026-10-25 — emailPolicy 'unrestricted' from a caller that is not an operator caller is asked of
 *     the operators (services/extension-email-policy-ask.ts) instead of 403 OPERATOR_REQUIRED; the
 *     rest of the change is written, and a narrowing is set at once (secaudit2026oct22, the developer's
 *     ruling of 2026-10-25 on leads 294 and 354).
 *   2026-10-25 — A host field value set by a caller that may not choose a secret's host (not the
 *     account holder in person, no secrets:manage) is marked unvetted (secaudit2026oct22).
 *   2026-10-25 — A node-owned key (emailPolicy) is set only by an operator caller; others get 403
 *     OPERATOR_REQUIRED, nothing written (secaudit2026oct22).
 *   v1.0.1 — 2026-10-09 — Secrets are encrypted bound to the extension's name (SecretBinding).
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { getExtSecretKeys, prepareSecretConfigForWrite } from './extension-secrets.js';
import { getEncryptionKey } from './encryption.js';
import { hostFieldsOf, parseHostFieldValue, unvettedHostFields, HOST_FIELDS_UNVETTED_KEY } from './extension-network-hosts.js';
import { emitChange } from './event-bus.js';
import { NODE_OWNED_CONFIG_KEYS } from './extension-manifest.js';
import {
    askOperatorsForEmailPolicy, grantsUnrestrictedEmail, EMAIL_POLICY_KEY, UNRESTRICTED_EMAIL, type EmailPolicyAsk,
} from './extension-email-policy-ask.js';
import type { PublishRequester } from './publish-requests/store.js';
import { isOwnerInPerson } from '../utils/gaii.js';
import { scopeIsCovered, SECRETS_MANAGE_SCOPE } from '../utils/scope-coverage.js';

export type ConfigSetOutcome =
    | {
        ok: true; record: ExtensionRecord; changed: string[];
        /** The emailPolicy grant asked of the operators, pending (services/extension-email-policy-ask.ts). */
        approval_request?: Extract<EmailPolicyAsk, { approval_request: unknown }>['approval_request'];
        warnings?: Extract<EmailPolicyAsk, { warnings: unknown }>['warnings'];
    }
    | { ok: false; status: number; code: string; message: string };

/** Config keys the node keeps beside the declared fields; never a caller's to set. */
const RESERVED_KEY = /^__|^\$/;

const refuse = (status: number, code: string, message: string): ConfigSetOutcome => ({ ok: false, status, code, message });

/** The fields an installed extension's manifest declares: its stored config keys and its secret fields. */
export function declaredConfigFields(ext: Pick<ExtensionRecord, 'config'>): string[] {
    const plain = Object.keys(ext.config ?? {}).filter(k => !RESERVED_KEY.test(k));
    return [...new Set([...plain, ...getExtSecretKeys(ext)])].sort();
}

/** Who is writing, as the route decided it. */
export interface ConfigSetter {
    /** isOperatorCaller(): the operator in person, or the operator's agent holding operator:admin. */
    isOperator: boolean;
    /**
     * May this caller choose where the owner's secrets go: the account holder in person, or a
     * principal holding secrets:manage (mayChooseSecretHost). A host field value set by anyone else
     * is marked unvetted: ctx.fetch reaches it, and it does not count as a host the code writer
     * declared for a secret's first use (secaudit2026oct22). Absent reads as false.
     */
    mayChooseSecretHosts?: boolean;
    /**
     * Who asks, when this caller's change waits for the operators: an emailPolicy grant from a
     * caller that is not an operator caller (services/extension-email-policy-ask.ts). Absent: such a
     * change is left out and named in a warning, never written.
     */
    asker?: PublishRequester;
}

/** The principal that may choose a vault secret's host, as decideFirstUse's ruling 6 reads it. */
export function mayChooseSecretHost(caller: { roles?: string[]; scopes?: string[]; principal: string }): boolean {
    if (isOwnerInPerson({ roles: caller.roles ?? [] }) && !caller.principal.includes('#')) return true;
    return scopeIsCovered(caller.scopes ?? [], SECRETS_MANAGE_SCOPE);
}

/**
 * Write `values` over the extension's stored config. The caller has already decided that the
 * principal may manage this extension (routes/extensions/permissions.ts).
 */
export async function setExtensionConfig(
    deps: { storage: Storage; config: AimeatConfig },
    ext: ExtensionRecord,
    values: unknown,
    /** Defaults to a caller that is not an operator, so a caller that forgets gets the safe answer. */
    who: ConfigSetter = { isOperator: false },
): Promise<ConfigSetOutcome> {
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0) {
        return refuse(400, 'INVALID_INPUT', 'config must be a non-empty object of field: value, e.g. { "WAZUH_HOST": "wazuh.example.com" }.');
    }
    const given = { ...(values as Record<string, unknown>) };
    // emailPolicy 'unrestricted' is the operator's grant. Managing the extension is not enough: an
    // agent of the operator's account holding ext:write passes that check without operator:admin
    // (secaudit2026oct22). Such a caller ASKS: the grant waits for an operator's answer and nothing
    // about the policy changes meanwhile (services/extension-email-policy-ask.ts; Jouni, 2026-10-25).
    // Any other value narrows and is set at once; the grant already held asks nothing.
    let asksGrant = false;
    if (!who.isOperator && given[EMAIL_POLICY_KEY] === UNRESTRICTED_EMAIL) {
        asksGrant = !grantsUnrestrictedEmail(ext.config);
        delete given[EMAIL_POLICY_KEY];
    }
    if (Object.keys(given).length === 0) {
        if (!asksGrant) return { ok: true, record: ext, changed: [] };
        return { ok: true, record: ext, changed: [], ...await askGrant(deps, ext, who) };
    }
    // The node-owned keys count as declared, so the operator sets the grant on any extension.
    const declared = [...new Set([...declaredConfigFields(ext), ...NODE_OWNED_CONFIG_KEYS])];
    const unknown = Object.keys(given).filter(k => RESERVED_KEY.test(k) || !declared.includes(k));
    if (unknown.length) {
        return refuse(400, 'INVALID_INPUT', `${ext.name} does not declare ${unknown.join(', ')}. `
            + (declared.length ? `Its config fields: ${declared.join(', ')}.` : 'It declares no config.'));
    }

    const hostFields = new Set(hostFieldsOf(ext.config).map(f => f.field));
    const next: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const [field, value] of Object.entries(given)) {
        if (hostFields.has(field)) {
            const parsed = parseHostFieldValue(value);
            if (parsed.ok) next[field] = parsed.value;
            else problems.push(`${field} is a host field: ${parsed.message}`);
            continue;
        }
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            problems.push(`${field} must be a string, a number or a boolean`);
            continue;
        }
        next[field] = value;
    }
    if (problems.length) return refuse(400, 'INVALID_INPUT', `${problems.join('. ')}. Nothing was changed.`);

    // Who set each host field's value now decides whether it counts as declared for a first use.
    const unvetted = new Set(unvettedHostFields(ext.config));
    for (const field of Object.keys(next).filter(f => hostFields.has(f))) {
        if (who.mayChooseSecretHosts || next[field] === '') unvetted.delete(field);
        else unvetted.add(field);
    }
    const merged: Record<string, unknown> = { ...(ext.config ?? {}), ...next };
    if (unvetted.size) merged[HOST_FIELDS_UNVETTED_KEY] = [...unvetted].sort();
    else delete merged[HOST_FIELDS_UNVETTED_KEY];

    const prepared = prepareSecretConfigForWrite(merged, ext.config, getEncryptionKey(deps.config), { extension: ext.name });
    if (prepared === null) {
        return refuse(503, 'ENCRYPTION_NOT_CONFIGURED', 'This node has no encryption key, so a secret field cannot be stored. The operator sets AIMEAT_ENCRYPTION_KEY.');
    }
    const updated = await deps.storage.updateExtension(ext.name, { config: prepared });
    if (!updated) {
        return refuse(500, 'WRITE_NOT_APPLIED', `The config of "${ext.name}" was NOT changed: the storage write did not apply.`);
    }
    emitChange('extensions');
    return { ok: true, record: updated, changed: Object.keys(next).sort(), ...(asksGrant ? await askGrant(deps, updated, who) : {}) };
}

/** File the operators' question about the grant, or say why none was filed. */
async function askGrant(deps: { storage: Storage; config: AimeatConfig }, ext: ExtensionRecord, who: ConfigSetter): Promise<EmailPolicyAsk> {
    if (!who.asker) {
        return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: `${EMAIL_POLICY_KEY} was not changed: an operator of this node sets it.` }] };
    }
    return askOperatorsForEmailPolicy(deps, ext, who.asker, 'asked');
}
