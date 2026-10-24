/**
 * @file src/services/extension-secret-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two questions ctx.fetch asks before it fills `{{secret:NAME}}` from an owner's
 *   vault: WHOSE vault this call may read, and WHO decides the first host of a vault secret that has
 *   none. Both answers come from the extension record and the caller the node built, never from
 *   anything the script or the request says.
 *
 *   WHOSE VAULT (secaudit 2026-10, v58, as Jouni amended it on 2026-10-21). The caller's own vault,
 *   for ANY extension the caller runs. A shared extension, installed by A and run by B, serves B
 *   with B's own key: that is the bring-your-own-key service model, and the user owns the secret in
 *   their own vault. The extension's own `secrets` config is never the answer for a multi-user
 *   service, because it would make A hold everyone's keys.
 *
 *   WHERE IT MAY GO. The v58 leak was that A's script chose WHERE B's secret went, and the node
 *   bound B's unbound secret to A's server. So:
 *     - a secret with a bound host goes through any extension the caller runs, to that host only
 *       (owner-secrets.ts refuses every other host with SECRET_HOST), and nothing is asked;
 *     - a secret with NO host is never bound by a call through an extension another account
 *       installed, whoever the caller is: the address was chosen by someone else's code. The
 *       refusal names the extension, its installer and the host, and tells the owner to set the
 *       secret's address on the Access page if they want to allow it;
 *     - through the caller's own account's extension, ruling 6 below decides.
 *
 *   living-hooks counts as the caller's own for the first use: a person's living document calls it.
 *   A host on the operator's node-wide allowlist binds by itself; a host only on the person's own
 *   list asks once, because an app granted memory:write can change that list. It is designated by
 *   name AND by the installer `system`, which no account can register
 *   (utils/gaii.ts RESERVED_NAMES) and which only the builtin seeder writes
 *   (services/builtin-extension-seeder.ts), so an owner who installs an extension under the same
 *   name on a node without the builtin does not inherit it. vocab-finto, the other builtin, names no
 *   secret and is not designated.
 *
 *   WHO DECIDES THE FIRST HOST (ruling 6, 2026-10-20; secaudit 2026-10, v59). A vault secret stored
 *   without a host is bound to the host of its first use. Only a principal that may create the
 *   secret may make that first use: the owner in person, or a principal holding `secrets:manage`.
 *   In an attended call that principal is the caller. In an unattended run (a workflow step, an AI
 *   job's on_done, an AI provider run, an app's format-md) nobody is present and the caller is the
 *   owner's GHII with the role `operator`, so the deciding principal is whoever wrote the
 *   extension's code (`installedByPrincipal`): the agent that wrote the script chose the address.
 * @structure
 *   - NODE_WIDE_VAULT_EXTENSIONS — the designated node-provided extensions
 *   - vaultOwnerForCall() — whose vault a call reads: the caller's owner
 *   - decideFirstUse() — may this call choose a first host: refused for another account's
 *     extension, ruling 6 for the caller's own
 *   - decideSharedFirstUse() — may this call choose the first host of a shared-map value
 * @usage
 *   const vaultOwner = vaultOwnerForCall(deps.caller);
 *   resolveSecretForHeaders({ ..., ownerGhii: vaultOwner, firstUse: () => decideFirstUse({ ... }) });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, v58 and v59).
 *   v1.0.1 — 2026-10-20 — A record that names no code writer (written before 2026-10-20) counts as
 *     the account holder's in an unattended run, as unattended file reads do; it was refused. An
 *     unattended run is named by its code path (ExtensionCtxDeps.unattended), not by role strings.
 *   v1.1.0 — 2026-10-21 — v58 amended by Jouni: the caller's vault serves every extension the caller
 *     runs (bring your own key), a bound secret goes only to its bound host, and a secret with no
 *     host is never bound through an extension another account installed (decideFirstUse answers
 *     `foreign`). vaultOwnerForCall no longer returns null.
 *   v1.2.0 — 2026-10-21 — A first use to a host the extension declares for that secret in
 *     `uses_secrets`, by code a trusted principal wrote, binds whoever calls: the owner's apps, chat
 *     connector and schedules work again (services/extension-secret-uses.ts). Every refusal is
 *     answered on the allow page (services/secret-approvals.ts).
 *   v1.3.0 — 2026-10-21 — living-hooks as the node ships it: the caller's own allowlist and the
 *     operator's node-wide one are its declared hosts for every secret, so a first use to an
 *     allowlisted host binds whoever calls.
 *   v1.4.0 — 2026-10-21 — The manifest's `network:` hosts count as declared for every secret, and a
 *     declared host without a port covers every port of that host (extension-secret-uses.ts).
 *   v1.5.0 — 2026-10-21 — Jouni's decisions: an own-account extension whose code existed before this
 *     update keeps the pre-audit first use (extension-first-use-keep.ts); through living-hooks only
 *     the operator's list binds by itself, a host only on the caller's own list asks once (the read
 *     of living-hooks.settings is gone).
 *   v1.6.0 — 2026-10-24 — decideSharedFirstUse: the first host of a value from the extension's
 *     shared secret map is chosen only through the operator's allow_hosts, the extension's declared
 *     hosts, or the operator in person; any other first use is refused, and secretRefusalText asks
 *     the operators once per secret and host (secaudit2026oct22; Jouni, 2026-10-24).
 *   v1.6.1 — 2026-10-24 — Rule (c) of decideSharedFirstUse covers every principal of an operator
 *     account (its agents and unattended runs included), not only the operator in person; a visitor
 *     and an anonymous principal stay refused (secaudit2026oct22; Jouni, 2026-10-24).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ExtensionCtx } from './extension-ctx-contract.js';
import type { FirstUseDecision, ForeignExtension, SecretResolutionRefusal } from './owner-secrets.js';
import { secretForeignExtensionMessage, secretFirstUseMessage, secretHostMessage, secretUnknownMessage } from './owner-secrets.js';
import { requestSecretApproval } from './secret-approvals.js';
import { isGEAI, isOwnerInPerson, localAccountOf, ownerGhiiOf } from '../utils/gaii.js';
import { scopeIsCovered, SECRETS_MANAGE_SCOPE } from '../utils/scope-coverage.js';
import { saverAuthority } from './workflow/trigger-authority.js';
import { declaredUse, declaresHost } from './extension-secret-uses.js';
import { keepsPreAuditFirstUse } from './extension-first-use-keep.js';
import { askOperatorsAboutSharedHost, sharedFirstUseMessage } from './shared-secret-ask.js';
import { isOperatorAccount } from '../utils/operator-account.js';

/** The installer a node-provided extension is recorded under (BUILTIN_EXTENSION_OWNER). */
const NODE_INSTALLER = 'system';

/**
 * The node-provided extensions that read the CALLER's vault whoever calls. Each one is here because
 * serving every owner with their own credential is its job; an entry needs that reason in review.
 */
export const NODE_WIDE_VAULT_EXTENSIONS: ReadonlySet<string> = new Set(['living-hooks']);

/** An account name or a GHII, as a GHII on this node. */
function asGhii(config: AimeatConfig, account: string): string {
    return account.includes('@') ? account : `${account}@${config.nodeId}`;
}

/**
 * Whose vault this call reads: the account behind the caller, whichever of its principals called,
 * for every extension. Where the secret may then go is the host check's and decideFirstUse's.
 */
export function vaultOwnerForCall(caller: Pick<ExtensionCtx['caller'], 'gaii'>): string {
    return ownerGhiiOf(caller.gaii);
}

/**
 * The extension's installer when it is NOT the caller's own account (nor a designated node-provided
 * one), else null. A code path that does not name the extension record counts as another
 * account's, because it cannot say who installed the code that chose the address.
 */
function foreignExtension(
    config: AimeatConfig,
    vaultOwnerGhii: string,
    extension: ExtensionCtx['extension'] | undefined,
): ForeignExtension | null {
    if (!extension) return { extension: 'unknown', installer: 'an unknown account' };
    if (asGhii(config, extension.owner) === vaultOwnerGhii) return null;
    if (isNodeWideVaultExtension(extension)) return null;
    return { extension: extension.name, installer: extension.owner };
}

/** A designated node-provided extension: by name AND installed by `system`. */
function isNodeWideVaultExtension(extension: NonNullable<ExtensionCtx['extension']>): boolean {
    return extension.owner === NODE_INSTALLER && NODE_WIDE_VAULT_EXTENSIONS.has(extension.name);
}

/** An `allow_hosts` value as living-hooks reads it: a list, or a comma-separated string. */
const hostEntries = (raw: unknown): unknown[] => (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : []);

/**
 * Is this call's host on living-hooks' node-wide allowlist, the operator's (the extension's
 * `allow_hosts` config)? The operator vetted those hosts and a first use to one worked before the
 * audit, so it binds by itself. The caller's OWN list (`living-hooks.settings` in their memory) does
 * not count here: an app granted memory:write can change it, so a host only on it asks the owner once
 * per secret and host (decision (b), 2026-10-21). The same match as the gate
 * (data/builtin-extensions/living-hooks-lib.ts livingHostAllowed): an exact hostname, or a leading
 * dot for that host and everything under it; the port is not part of the match.
 */
function onOperatorAllowlist(extConfig: Record<string, unknown> | undefined, host: string): boolean {
    const hostname = URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname.toLowerCase() : '';
    if (!hostname) return false;
    return hostEntries(extConfig?.allow_hosts).some((e) => {
        const entry = typeof e === 'string' ? e.trim().toLowerCase() : '';
        if (entry.startsWith('.')) return entry.length > 1 && (hostname === entry.slice(1) || hostname.endsWith(entry));
        return !!entry && hostname === entry;
    });
}

/**
 * The words ctx.fetch throws for a refused resolution. A refused FIRST USE files the owner's question
 * (services/secret-approvals.ts) and names the address where the owner allows it with one press, so
 * the AI that met the refusal can hand that address on, and the owner also hears it in the bell.
 */
export async function secretRefusalText(
    deps: {
        storage: Storage; config: AimeatConfig; caller: Pick<ExtensionCtx['caller'], 'gaii'>;
        extension?: ExtensionCtx['extension']; extConfig: Record<string, unknown> | undefined;
        vaultOwnerGhii: string; extName: string;
    },
    refusal: SecretResolutionRefusal,
): Promise<string> {
    if (refusal.reason === 'unknown') return `SECRET_UNKNOWN: ${secretUnknownMessage(refusal.headerName, refusal.secretName)}`;
    if (!refusal.firstUse) {
        return `SECRET_HOST: ${secretHostMessage(refusal.headerName, refusal.secretName, refusal.boundTo, refusal.host)}`;
    }
    if (refusal.firstUse.shared) {
        // The operator's shared value: the operators approve the host, never the caller's own vault page.
        const allowHostsField = !!deps.extConfig && Object.hasOwn(deps.extConfig, 'allow_hosts');
        const extName = deps.extension?.name ?? deps.extName;
        await askOperatorsAboutSharedHost({ storage: deps.storage, config: deps.config }, {
            extName, installer: deps.extension?.owner ?? '', secret: refusal.secretName, host: refusal.host,
            requestedBy: deps.caller.gaii, allowHostsField,
        });
        return `SECRET_HOST: ${sharedFirstUseMessage(refusal.headerName, refusal.secretName, refusal.host, extName, allowHostsField)}`;
    }
    const why = declaredUse(deps.extConfig, refusal.secretName)?.why;
    const installer = deps.extension?.owner ?? refusal.firstUse.foreign?.installer ?? 'an unknown account';
    // Only a host that parses can be allowed: an approval names a real host.
    const url = refusal.host ? await requestSecretApproval({ storage: deps.storage, config: deps.config }, {
        ownerGhii: deps.vaultOwnerGhii, secret: refusal.secretName,
        key: { extension: deps.extension?.name ?? deps.extName, installer, host: refusal.host },
        ...(why ? { why } : {}), requestedBy: deps.caller.gaii,
    }) : undefined;
    if (refusal.firstUse.foreign) {
        return `SECRET_HOST: ${secretForeignExtensionMessage(refusal.secretName, refusal.host, refusal.firstUse.foreign, why, url)}`;
    }
    return `SECRET_HOST: ${secretFirstUseMessage(refusal.headerName, refusal.secretName, refusal.host, refusal.firstUse.by, url)}`;
}

/**
 * Whether the principal that wrote the extension's code may choose where the owner's secret goes:
 * the account holder (in person, or through an app grant, whose principal is the account's GHII), an
 * agent or ecosystem app that holds secrets:manage now, or a record written before 2026-10-20 that
 * names no writer. Read from the record, as an unattended run's own fence reads it.
 */
async function codeWriter(
    storage: Storage, config: AimeatConfig, extension: ExtensionCtx['extension'] | undefined, vaultOwnerGhii: string,
): Promise<{ trusted: boolean; by: string }> {
    const record = extension ? await storage.getExtension(extension.name) : null;
    const writer = (record?.installedByPrincipal ?? '').trim();
    // A record written before 2026-10-20 names no writer. It counts as the account holder's, the
    // same default unattendedExtensionReader (services/extension-system-run.ts) applies to file
    // reads (ruling 1, 2026-10-20), so an extension that works today keeps working. Every install
    // and redeploy path stamps the writer now, so the rule below holds for all new code.
    if (!writer) return { trusted: true, by: vaultOwnerGhii };
    if (!writer.includes('#')) {
        // The account holder wrote it in person (a bare name), or an app grant did (its GHII; the
        // residual services/extension-system-run.ts names). Either way the account itself.
        const ghii = asGhii(config, writer);
        return { trusted: ghii === vaultOwnerGhii, by: ghii };
    }
    if (ownerGhiiOf(writer) !== vaultOwnerGhii) return { trusted: false, by: writer };
    // The agent's or ecosystem app's scopes as they stand now: the owner may have narrowed or
    // removed it since it wrote the code.
    const now = await saverAuthority(storage, { kind: isGEAI(writer) ? 'ecosystem' : 'agent', id: writer });
    return { trusted: !now.gone && scopeIsCovered(now.scopes, SECRETS_MANAGE_SCOPE), by: writer };
}

/**
 * May this call choose `host` as the first host of `secretName` in `vaultOwnerGhii`'s vault? Asked
 * only when such a secret is about to be bound, so an ordinary call costs no read. In order:
 *   1. another account's extension: never (v58);
 *   2. the extension declares `host` for this secret (its `uses_secrets` entry, or its manifest's
 *      `network:` hosts) and its code writer is trusted: yes, whoever calls, so the owner's apps,
 *      chat connector and schedules keep working;
 *   3. ruling 6: the owner in person, a caller holding secrets:manage, or in an unattended run a
 *      trusted code writer.
 * Every refusal is answered with one press on the allow page (services/secret-approvals.ts).
 */
export async function decideFirstUse(deps: {
    storage: Storage;
    config: AimeatConfig;
    caller: Pick<ExtensionCtx['caller'], 'gaii' | 'roles' | 'scopes'>;
    extension: ExtensionCtx['extension'] | undefined;
    vaultOwnerGhii: string;
    /** Set by the unattended run's code path (ExtensionCtxDeps.unattended), never read from roles. */
    unattended: boolean;
    secretName: string;
    host: string;
    /** The extension's config, which carries its `uses_secrets` declaration. */
    extConfig: Record<string, unknown> | undefined;
}): Promise<FirstUseDecision> {
    const { storage, config, caller, extension, vaultOwnerGhii } = deps;
    // Another account's code chose this address: never a first use, whoever the caller is, the owner
    // in person included (secaudit 2026-10, v58). The owner allows it with one press or by setting the host.
    const foreign = foreignExtension(config, vaultOwnerGhii, extension);
    if (foreign) return { allowed: false, by: foreign.installer, foreign };
    // living-hooks as the node ships it: a host on the operator's node-wide allowlist binds whoever
    // calls, as before the audit. A host only on the caller's own list falls through to ruling 6, so
    // the owner in person binds and anyone else is asked once per secret and host (decision (b)).
    if (extension && isNodeWideVaultExtension(extension) && onOperatorAllowlist(deps.extConfig, deps.host)) {
        return { allowed: true, by: caller.gaii };
    }
    // Code that existed before this update (marked once at the update, cleared by every later code
    // write) keeps the pre-audit first use: it binds to the host its script names, whoever calls and
    // whoever wrote it. Only the caller's OWN account's extensions reach this line; another account's
    // was refused above (services/extension-first-use-keep.ts; Jouni, 2026-10-21).
    if (keepsPreAuditFirstUse(deps.extConfig)) return { allowed: true, by: caller.gaii };
    // Declared: the extension says publicly that it sends this secret to this host, in `uses_secrets`
    // or in its `network:` hosts, matched by hostname unless a port is declared. A trusted code writer
    // made that declaration, so the first use binds whoever calls (2026-10-21).
    if (declaresHost(deps.extConfig, deps.secretName, deps.host)) {
        const writer = await codeWriter(storage, config, extension, vaultOwnerGhii);
        if (writer.trusted) return { allowed: true, by: deps.unattended ? writer.by : caller.gaii };
    }
    const roles = caller.roles ?? [];
    // The owner in person, in their own vault. The GHII test keeps an app grant out: it resolves to
    // the owner's GHII too, but isOwnerInPerson refuses its 'app' role.
    if (isOwnerInPerson({ roles }) && !caller.gaii.includes('#') && ownerGhiiOf(caller.gaii) === vaultOwnerGhii) {
        return { allowed: true, by: caller.gaii };
    }
    if (scopeIsCovered(caller.scopes ?? [], SECRETS_MANAGE_SCOPE)) return { allowed: true, by: caller.gaii };
    if (!deps.unattended) return { allowed: false, by: caller.gaii };
    // Unattended: the code writer decides.
    const writer = await codeWriter(storage, config, extension, vaultOwnerGhii);
    return { allowed: writer.trusted, by: writer.by };
}

/**
 * May this call choose `host` as the first host of a value from the extension's SHARED secret map
 * (living-hooks' `secrets` config), which then serves every account? Asked only when such a value
 * has no host yet (secaudit2026oct22; Jouni, 2026-10-24). In order:
 *   a. the host is on the extension's `allow_hosts`, the operator's list (for an extension an
 *      account installed, that account sets both the map and the list);
 *   b. the extension declares the host for this secret (`uses_secrets`, or its `network:` hosts);
 *   c. for an extension an account installed, the call is that account's (it set the map); for a
 *      node-provided extension, the call is an operator account's, by any of its principals.
 * Anyone else is refused, nothing is sent or bound, and the operators are asked once
 * (services/shared-secret-ask.ts).
 */
export async function decideSharedFirstUse(deps: {
    storage: Storage;
    config: AimeatConfig;
    caller: Pick<ExtensionCtx['caller'], 'gaii' | 'roles' | 'anonymous'>;
    extension: ExtensionCtx['extension'] | undefined;
    unattended: boolean;
    secretName: string;
    host: string;
    extConfig: Record<string, unknown> | undefined;
}): Promise<FirstUseDecision> {
    const { storage, config, caller, extension } = deps;
    if (onOperatorAllowlist(deps.extConfig, deps.host)) return { allowed: true, by: caller.gaii };
    if (declaresHost(deps.extConfig, deps.secretName, deps.host)) return { allowed: true, by: caller.gaii };
    const account = ownerGhiiOf(caller.gaii);
    // An extension an account installed: its shared map is that account's own, set by that account,
    // so a call of that account's (its AI provider runs and schedules included) chooses as before.
    if (extension && extension.owner !== NODE_INSTALLER && asGhii(config, extension.owner) === account) {
        return { allowed: true, by: caller.gaii };
    }
    // The node's own map: any principal acting in an OPERATOR's own account (the operator's session,
    // their agents, ecosystem apps and app grants, their unattended runs), because each acts in the
    // operator's name on permissions the operator granted (Jouni, 2026-10-24). The account is read
    // from the stored record, never from the role list: an unattended run carries the role
    // `operator` whoever owns it. A visitor is refused: its principal names its home node, so it is
    // not an account of this node. An anonymous principal is refused.
    if (caller.anonymous) return { allowed: false, by: caller.gaii };
    const name = localAccountOf(account);
    if (!name || name === 'anonymous' || account !== `${name}@${config.nodeId}`) return { allowed: false, by: caller.gaii };
    const record = await storage.getOwner(name);
    return { allowed: isOperatorAccount(record), by: caller.gaii };
}
