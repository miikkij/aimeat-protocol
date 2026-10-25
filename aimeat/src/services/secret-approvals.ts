/**
 * @file src/services/secret-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allows, with one press, a first use of a vault secret the node refused, and
 *   the answer is kept on the secret: { extension, installer, host, approvedAt }.
 *
 *   WHEN A FIRST USE IS REFUSED. A secret with no host is bound by its first use, and the node refuses
 *   that use through an extension another account installed, to a host the extension did not declare
 *   for that secret, or by code a principal without secrets:manage wrote, unless the owner is signed in
 *   making the call (services/extension-secret-authority.ts). Each refusal files a request here: one
 *   per (extension, installer, host) while it waits, a bell notice with an Allow button the first time,
 *   and the address of the allow page (views/secret-allow.js) in the refusal itself, so the AI that
 *   met it can hand it to the person. Reused from the permission-ask pattern
 *   (services/permission-ask.ts and permission-ask-notice.ts): one question, one press.
 *
 *   WHAT AN APPROVAL DOES. That extension, installed by that account, may send this secret to that
 *   host from then on, whatever the secret's own address says. The secret's other uses are untouched,
 *   and nothing is bound. A reinstall by another account is a new question, because the installer is
 *   part of the key. Only the owner signed in in person approves (the route asks isOwnerInPerson).
 *   The owner withdraws an approval on the Access page; storing the value again empties the list.
 *
 *   THE LIST IS SHORT AND IS WRITTEN BY COMPARE-AND-SWAP (storage.swapSecretApprovals): at most
 *   MAX_PENDING requests wait at once, the oldest dropped first, so a script that tries a hundred
 *   hosts cannot fill the owner's secret with questions.
 * @structure secretAllowUrl · findApproval · requestSecretApproval · readApprovalRequest ·
 *   approveSecretUse · declineSecretUse · withdrawSecretApproval
 * @usage
 *   const url = await requestSecretApproval({ storage, config }, { ownerGhii, secret, extension, installer, host, why, requestedBy });
 * @version-history
 *   v1.3.0 — 2026-10-25 — Allow and Don't allow tell the one whose call asked (approval-standard.ts
 *     tellAsker): an agent on its inbox, anyone else in the bell (secaudit2026oct22, the approval standard).
 *   v1.2.0 — 2026-10-22 — The bell notice carries Don't allow beside Allow (the developer: a question
 *     with only Allow cannot be answered no).
 *   v1.1.0 — 2026-10-21 — An Allow pressed on a notice whose question no longer waits (the secret was
 *     removed or stored again) answers APPROVAL_NOT_FOUND in plain words and allows nothing.
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, v58 and v59 follow-up).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { SecretApproval, SecretRecord } from '../storage/types/secrets.js';
import { notify, type NotifyInput } from './notify.js';
import { emitChange } from './event-bus.js';
import { declaredHostsFor, declaresHost, usesSecretsOf } from './extension-secret-uses.js';
import { listOwnerSecrets, purposeText, type SecretSummary } from './owner-secrets.js';
import { tellAsker } from './approval-standard.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** The most requests one secret holds waiting at once. */
const MAX_PENDING = 10;
/** How many times a write retries when the list changed under it. */
const SWAP_TRIES = 4;
export const SECRET_USE_ASK_TYPE = 'secret_use_ask';

/** Who asked: the extension, the account that installed it, and the host. */
export interface ApprovalKey { extension: string; installer: string; host: string }

const sameKey = (a: ApprovalKey, b: ApprovalKey) => a.extension === b.extension && a.installer === b.installer && a.host === b.host;
const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

/** The page where the owner answers. The page reads the facts from the node, never from this address. */
export function secretAllowUrl(baseUrl: string, secret: string, extension: string, host: string): string {
    const q = new URLSearchParams({ secret, extension, host });
    return `${trimBase(baseUrl)}/v1/secret-allow?${q.toString()}`;
}

/** The approved entry for this key, or null. A waiting request is not an approval. */
export function findApproval(record: Pick<SecretRecord, 'approvals'>, key: ApprovalKey): SecretApproval | null {
    return (record.approvals ?? []).find(a => !!a.approvedAt && sameKey(a, key)) ?? null;
}

/** Apply `change` to the list with compare-and-swap. Answers the new list, or null when the secret is gone. */
async function updateApprovals(
    storage: Storage, ownerGhii: string, secret: string,
    change: (list: SecretApproval[]) => SecretApproval[] | null,
): Promise<{ list: SecretApproval[]; changed: boolean } | null> {
    for (let i = 0; i < SWAP_TRIES; i++) {
        const record = await storage.getSecret(ownerGhii, secret);
        if (!record) return null;
        const current = record.approvals ?? [];
        const next = change(current);
        if (!next) return { list: current, changed: false };
        if (await storage.swapSecretApprovals(ownerGhii, secret, current, next)) return { list: next, changed: true };
    }
    throw new Error('secret approvals: the list kept changing; try again');
}

/** The bell notice: the question in plain words, the page, and Allow on the notice itself. */
function askNotice(baseUrl: string, secret: string, key: ApprovalKey, why: string | undefined): NotifyInput {
    const url = secretAllowUrl(baseUrl, secret, key.extension, key.host);
    const purpose = why ? `, to ${purposeText(why)}` : '';
    return {
        type: SECRET_USE_ASK_TYPE,
        title: `Extension ${key.extension} asks to use your secret ${secret}`,
        body: `${key.extension}, installed by ${key.installer}, needs your secret ${secret} for ${key.host}${purpose}. `
            + 'Your secret has not gone to this address before, so you are asked first, and nothing was sent. Open this to see why, or answer here.',
        link: url.slice(url.indexOf('/v1/')),
        i18n: { key: SECRET_USE_ASK_TYPE, vars: { extension: key.extension, installer: key.installer, secret, host: key.host, why: why ?? '' } },
        // Both answers on the notice, as on the page: a question with only Allow cannot be answered no.
        actions: [{
            id: 'deny', label: 'Don\'t allow', kind: 'api', method: 'POST',
            endpoint: `/v1/secrets/${encodeURIComponent(secret)}/approvals/decline`,
            body: { extension: key.extension, host: key.host }, style: 'default',
            i18n: { key: `${SECRET_USE_ASK_TYPE}.deny` },
        }, {
            id: 'allow', label: 'Allow', kind: 'api', method: 'POST',
            endpoint: `/v1/secrets/${encodeURIComponent(secret)}/approvals`,
            body: { extension: key.extension, host: key.host }, style: 'primary',
            i18n: { key: `${SECRET_USE_ASK_TYPE}.allow` },
        }],
    };
}

/**
 * File the owner's question for a refused first use, tell the owner the first time, and answer the
 * address of the page where they allow it. Never throws: the refusal stands whether or not the
 * request could be filed, and the address is still the right one to hand out.
 */
export async function requestSecretApproval(
    deps: { storage: Storage; config: AimeatConfig },
    req: { ownerGhii: string; secret: string; key: ApprovalKey; why?: string; requestedBy: string },
): Promise<string> {
    const url = secretAllowUrl(deps.config.baseUrl, req.secret, req.key.extension, req.key.host);
    try {
        const out = await updateApprovals(deps.storage, req.ownerGhii, req.secret, (list) => {
            if (list.some(a => sameKey(a, req.key))) return null;   // already asked, or already allowed
            const entry: SecretApproval = {
                ...req.key, ...(req.why ? { why: req.why } : {}),
                requestedAt: new Date().toISOString(), requestedBy: req.requestedBy,
            };
            const pending = list.filter(a => !a.approvedAt);
            const drop = pending.length >= MAX_PENDING ? pending[0] : null;
            return [...list.filter(a => a !== drop), entry];
        });
        if (out?.changed) {
            await notify(deps.storage, req.ownerGhii, askNotice(deps.config.baseUrl, req.secret, req.key, req.why));
            emitChange('secrets', req.ownerGhii);
        }
    } catch (err) {
        logger.warn('secret approvals: the request could not be filed; the refusal still stands', {
            owner: req.ownerGhii, secret: req.secret, extension: req.key.extension, error: String(err),
        });
    }
    return url;
}

/** What the allow page shows, read from the node: the request, and whether it is already answered. */
export interface ApprovalView {
    secret: string;
    extension: string;
    installer: string;
    host: string;
    why: string | null;
    requested_at: string;
    requested_by: string;
    approved_at: string | null;
    /** The account that installs the extension now. Differs from `installer` when it was reinstalled. */
    installer_now: string | null;
    /** The hosts the extension declares for this secret now (`uses_secrets` and `network:` hosts). */
    declared_hosts: string[];
    /** Whether one of them covers `host` (hostname match unless a port is declared). */
    host_declared: boolean;
}

/** The request for (extension, host) on this secret, with what the extension says now; null when none. */
export async function readApprovalRequest(
    storage: Storage, ownerGhii: string, secret: string, extension: string, host: string,
): Promise<ApprovalView | null> {
    const record = await storage.getSecret(ownerGhii, secret);
    const entry = (record?.approvals ?? []).filter(a => a.extension === extension && a.host === host).pop();
    if (!entry) return null;
    const ext = await storage.getExtension(extension);
    return {
        secret, extension, installer: entry.installer, host, why: entry.why ?? null,
        requested_at: entry.requestedAt, requested_by: entry.requestedBy, approved_at: entry.approvedAt ?? null,
        installer_now: ext?.installedBy ?? null,
        declared_hosts: declaredHostsFor(ext?.config, secret),
        host_declared: declaresHost(ext?.config, secret, host),
    };
}

/** A secret's summary with the extensions that name it without having used it yet. */
export type SecretWithUses = SecretSummary & { declaredBy: string[] };

/**
 * The vault's list with `declaredBy` beside `usedBy`: the account's own extensions whose
 * `uses_secrets` names the secret, and the extensions whose call asked the owner about it. So the
 * Access page can say which extension names a secret before its first use (2026-10-21).
 */
export async function listOwnerSecretsWithUses(storage: Storage, ownerGhii: string): Promise<SecretWithUses[]> {
    const secrets = await listOwnerSecrets(storage, ownerGhii);
    if (!secrets.length) return [];
    const account = localAccountName(ownerGhii);
    const own = (await storage.listExtensions({ lean: true })).filter(e => e.installedBy === account);
    return secrets.map((s) => {
        const named = new Set<string>();
        for (const e of own) if (usesSecretsOf(e.config).some(u => u.name === s.name)) named.add(e.name);
        for (const a of s.approvals) named.add(a.extension);
        return { ...s, declaredBy: [...named].filter(n => !s.usedBy.includes(n)).sort() };
    });
}

export type ApprovalAnswer =
    | { ok: true; approval: SecretApproval }
    | { ok: false; status: number; code: string; message: string };

/**
 * The owner allows a waiting request. It must exist, and the extension must still be installed by the
 * account that asked: a reinstall by someone else is a different question, and the old page must not
 * answer it.
 */
/** Tell the one whose call asked how the owner answered (services/approval-standard.ts). */
async function tellSecretAsker(
    config: AimeatConfig | undefined, storage: Storage, ownerGhii: string, secret: string,
    entry: SecretApproval | null, outcome: 'allowed' | 'declined', decidedBy: string,
): Promise<void> {
    if (!config || !entry?.requestedBy) return;
    const what = `${entry.extension} sends ${secret} to ${entry.host}`;
    await tellAsker({ storage, config }, {
        accountGhii: ownerGhii, asker: entry.requestedBy, outcome, what, decidedBy,
        contextId: `secret-approval:${secret}:${entry.extension}:${entry.host}`,
        sentence: outcome === 'allowed'
            ? `The owner allowed ${entry.extension} to send their secret ${secret} to ${entry.host}. Call it again; it goes through now.`
            : `The owner did not allow ${entry.extension} to send their secret ${secret} to ${entry.host}. Nothing was sent. A later call asks the owner again.`,
        data: { secret, extension: entry.extension, host: entry.host },
        messageKind: 'secret-approval',
        link: '/v1/profile?tab=access',
    });
}

export async function approveSecretUse(
    storage: Storage, ownerGhii: string, secret: string, extension: string, host: string, approvedBy: string,
    /** With the node's config, the one whose call asked is told (services/approval-standard.ts). */
    config?: AimeatConfig,
): Promise<ApprovalAnswer> {
    const ext = await storage.getExtension(extension);
    let approved: SecretApproval | null = null;
    const out = await updateApprovals(storage, ownerGhii, secret, (list) => {
        const i = list.findIndex(a => a.extension === extension && a.host === host && a.installer === ext?.installedBy);
        if (i < 0) return null;
        if (list[i].approvedAt) { approved = list[i]; return null; }
        approved = { ...list[i], approvedAt: new Date().toISOString(), approvedBy };
        return list.map((a, j) => (j === i ? approved! : a));
    });
    // A notice in the bell can outlive its question: the secret was removed or stored again (which
    // empties its questions), or the question was answered. Then nothing is allowed, and the person
    // is told so in plain words.
    const gone = `This question is no longer waiting, so nothing was allowed. The secret ${secret} was removed or stored `
        + `again, the question was already answered, or ${extension} now belongs to another account. If the extension `
        + 'still needs the secret, its next call asks you again.';
    if (!out) return { ok: false, status: 404, code: 'APPROVAL_NOT_FOUND', message: gone };
    if (!approved) return { ok: false, status: 404, code: 'APPROVAL_NOT_FOUND', message: gone };
    if (out.changed) {
        emitChange('secrets', ownerGhii);
        await tellSecretAsker(config, storage, ownerGhii, secret, approved, 'allowed', approvedBy);
    }
    return { ok: true, approval: approved };
}

/** The owner says no to a waiting request: it is removed, the one who asked is told, and the next refused call asks again. */
export async function declineSecretUse(
    storage: Storage, ownerGhii: string, secret: string, extension: string, host: string,
    /** With the node's config and who pressed, the one whose call asked is told. */
    tell?: { config: AimeatConfig; by: string },
): Promise<boolean> {
    let dropped: SecretApproval | null = null;
    const out = await updateApprovals(storage, ownerGhii, secret, (list) => {
        dropped = list.find(a => a.extension === extension && a.host === host && !a.approvedAt) ?? null;
        const next = list.filter(a => !(a.extension === extension && a.host === host && !a.approvedAt));
        return next.length === list.length ? null : next;
    });
    if (out?.changed) {
        emitChange('secrets', ownerGhii);
        await tellSecretAsker(tell?.config, storage, ownerGhii, secret, dropped, 'declined', tell?.by ?? ownerGhii);
    }
    return !!out?.changed;
}

/** Withdraw an approval (or drop a waiting request) for this extension, installer and host. */
export async function withdrawSecretApproval(storage: Storage, ownerGhii: string, secret: string, key: ApprovalKey): Promise<boolean> {
    const out = await updateApprovals(storage, ownerGhii, secret, (list) => {
        const next = list.filter(a => !sameKey(a, key));
        return next.length === list.length ? null : next;
    });
    if (out?.changed) emitChange('secrets', ownerGhii);
    return !!out?.changed;
}
