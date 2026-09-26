/**
 * @file src/services/package-install-request-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The install request as a record: where it lives, how it is filed in front of the owner,
 *   and how it is settled and told to the one who asked.
 *
 *   ONE RECORD PER REQUEST, `packages.install-requests.<id>`, in the owner's namespace under a
 *   reserved prefix (utils/reserved-keys.ts), which is where agent proposals already live and for the
 *   same reason: the decision door reads the package, the version, the options and the requester out
 *   of the record and installs them as the owner, so no app and no delegated agent may write one. No
 *   new table.
 *
 *   FILED = ONE RECORD, ONE OPEN ITEM, ONE NOTIFICATION. The notification carries Approve and Decline
 *   as `api` actions on the decision door, which the bell and the Notifications page run with the
 *   owner's own session. A second ask for the same thing by the same principal returns the standing
 *   request instead of a second line on the owner's list.
 *
 *   HOW IT GOES STALE. A request is decidable for seven days (package-install-request-policy.ts), and
 *   an expired one is settled as `expired` by the next filing, the next decision or the next read of
 *   it. The record itself lives thirty days from its creation (the memory TTL), so the one who asked
 *   can still read the outcome for a while and then it is gone. At most twenty wait at once.
 *
 *   SETTLED = STATE, ITEM CLOSED, REQUESTER TOLD. An agent that asked gets a turn on the Agent v2
 *   road (a tunnel frame or a push target, and stored for a later read), with the request id as its
 *   context. An app that asked reads the outcome from the record. When one of the owner's agents
 *   decided rather than the owner, the owner is told too: a person must see when their AI acted for
 *   them.
 * @structure INSTALL_REQUEST_PREFIX · PackageInstallRequest · inRequestQueue · packageDigest ·
 *   readInstallRequest · listInstallRequests · effectiveState · summarizeRequest · requesterName ·
 *   fileInstallRequest · settleInstallRequest · InstallRequestFail
 * @usage
 *   const filed = await fileInstallRequest({ storage, config }, ownerGhii, draft);
 *   await settleInstallRequest({ storage, config }, ownerGhii, request, 'declined', { by: decider });
 * @version-history
 *   v1.0.1 — 2026-09-26 — The key builder is installRequestKey: check:trusted-keys resolves a builder by
 *     its name across the tree, and read `requestKey` as app-members.ts's `appmemreq.` builder.
 *   v1.0.0 — 2026-09-25 — Initial: package installs by agents become requests.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord } from '../storage/interface.js';
import type { MigrationRequest } from './package-migrate.js';
import { addItem, closeItem, getItem } from './open-items.js';
import { notify } from './notify.js';
import { sendAgentV2Message } from './agent-v2-messaging.js';
import { emitChange } from './event-bus.js';
import { stableStringify } from '../utils/stable-json.js';
import { serialByKey } from '../utils/serial-by-key.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { INSTALL_REQUEST_DAYS, requestExpired } from './package-install-request-policy.js';

/** Where one request lives. The prefix is listable, so the owner's list finds them all. */
export const INSTALL_REQUEST_PREFIX = 'packages.install-requests.';
const SPEC = 'aimeat.package-install-request/v1';
/** The record outlives the decision so the one who asked can read the outcome, then goes. */
const RECORD_HOURS = 30 * 24;
/** Requests waiting at once per owner, so a looping agent cannot fill the owner's list. */
const MAX_WAITING = 20;
/** A migration request carries its merged content; beyond this the owner applies it themselves. */
const MAX_OPTIONS_BYTES = 512 * 1024;
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type InstallRequestAct = 'install' | 'update' | 'migrate';
export type InstallRequestState = 'awaiting_owner' | 'approved' | 'declined' | 'expired' | 'outdated';

/** Who asked, in full: the principal, what kind it is, and the token's own subject. */
export interface InstallRequester {
    /** An agent's GAII, or `eco:<app>#<owner>@<node>` for an app grant: who asked. */
    principal: string;
    kind: 'agent' | 'app';
    /** The token's subject, recorded as the actor of the install: the GAII, or the owner's GHII for an app grant. */
    sub: string;
    /** `owner/filename` of an app grant. */
    app?: string;
    /** The app grant's id. */
    grant?: string;
    /** The MCP client the session came through, when it came through one. */
    client?: string;
}

export interface PackageInstallRequest {
    spec: typeof SPEC;
    id: string;
    act: InstallRequestAct;
    /** The package version this request is for, as it stood when it was asked. */
    package: { group_id: string; name: string; version: string; record_id: string; digest: string };
    /** The installed copy an update or a migration moves, as it stood when it was asked. */
    instance: { id: string; version: string; record_id: string; content_digest: string | null } | null;
    options: { label?: string; actions?: MigrationRequest[] };
    /** The components that write into the owner's memory: what the owner is asked about. */
    memory_parts: string[];
    requested_by: InstallRequester;
    /** The words the requester lacked. */
    missing: string[];
    state: InstallRequestState;
    created_at: string;
    expires_at: string;
    decided_at: string | null;
    decided_by: string | null;
    outcome: { instance_id?: string; version?: string; reason?: string } | null;
    /** The open item this request put on the owner's list, so settling can close it. */
    item_id: string | null;
    /** Same act, same asker, same target, same options: the second ask is the first one. */
    fingerprint: string;
}

export type InstallRequestFail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): InstallRequestFail => ({ ok: false, status, code, message });

export interface RequestStoreCtx { storage: Storage; config: AimeatConfig }

// A name of its own: check:trusted-keys resolves a key builder by its name across the tree, and
// `requestKey` is already app-members.ts's, which builds a different prefix.
const installRequestKey = (id: string): string => `${INSTALL_REQUEST_PREFIX}${id}`;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/**
 * One filing or decision at a time per owner, in this process. Two taps on the same request (the
 * bell and a chat agent a moment apart) would otherwise both read `awaiting_owner` and both install;
 * the second one now reads what the first one wrote. Nothing inside the queue files a request, so it
 * cannot wait on itself.
 */
export function inRequestQueue<T>(ownerGhii: string, work: () => Promise<T>): Promise<T> {
    return serialByKey(`package-install-requests ${ownerGhii}`, work);
}

/** What a package version is, in one hash: every component's id, type and content. */
export function packageDigest(pkg: Pick<PackageRecord, 'components'>): string {
    return sha256(stableStringify(pkg.components.map(c => ({ id: c.id, type: c.type, content: sha256(c.content ?? '') }))));
}

function asRequest(value: unknown): PackageInstallRequest | null {
    const v = value as PackageInstallRequest | undefined;
    return v && v.spec === SPEC && typeof v.id === 'string' && v.package && v.requested_by ? v : null;
}

export async function readInstallRequest(storage: Storage, ownerGhii: string, id: string): Promise<PackageInstallRequest | null> {
    if (!ID_SHAPE.test(id)) return null;
    return asRequest((await storage.getMemory(ownerGhii, installRequestKey(id)))?.value);
}

/** Every request on this account, newest first. */
export async function listInstallRequests(storage: Storage, ownerGhii: string): Promise<PackageInstallRequest[]> {
    const rows = await storage.listMemory(ownerGhii, { prefix: INSTALL_REQUEST_PREFIX });
    return rows.map(r => asRequest(r.value)).filter((r): r is PackageInstallRequest => !!r)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The state a reader should be told: a waiting request past its expiry is expired, written or not. */
export function effectiveState(request: PackageInstallRequest, now = Date.now()): InstallRequestState {
    return request.state === 'awaiting_owner' && requestExpired(request, now) ? 'expired' : request.state;
}

/** The request as a door answers it: no merged content, the state as it is now. */
export function summarizeRequest(request: PackageInstallRequest, now = Date.now()) {
    return {
        id: request.id,
        act: request.act,
        state: effectiveState(request, now),
        package: { group_id: request.package.group_id, name: request.package.name, version: request.package.version },
        instance_id: request.instance?.id ?? null,
        label: request.options.label ?? null,
        actions: request.options.actions?.map(a => ({ componentId: a.componentId, action: a.action, has_content: typeof a.content === 'string' })) ?? null,
        memory_parts: request.memory_parts,
        requested_by: {
            principal: request.requested_by.principal, kind: request.requested_by.kind,
            ...(request.requested_by.app ? { app: request.requested_by.app } : {}),
        },
        missing: request.missing,
        created_at: request.created_at,
        expires_at: request.expires_at,
        decided_at: request.decided_at,
        decided_by: request.decided_by,
        outcome: request.outcome,
    };
}

async function putRequest(storage: Storage, ownerGhii: string, request: PackageInstallRequest): Promise<void> {
    const row = await storage.getMemory(ownerGhii, installRequestKey(request.id));
    const now = new Date().toISOString();
    await storage.setMemory({
        key: installRequestKey(request.id),
        ownerGaii: ownerGhii,
        value: request as unknown as Record<string, unknown>,
        visibility: 'private',
        tags: ['package-install-request'],
        // Counted from creation, so a settled request is readable for a while and then gone.
        ttlHours: RECORD_HOURS,
        version: (row?.version ?? 0) + 1,
        createdAt: row?.createdAt ?? request.created_at ?? now,
        updatedAt: now,
    });
}

/** The name a person reads for who asked: the agent's name, or the app's file. */
export function requesterName(r: InstallRequester): string {
    if (r.kind === 'app' && r.app) return r.app.split('/').pop() ?? r.app;
    const hash = r.principal.indexOf('#');
    return hash > 0 ? r.principal.slice(0, hash).replace(/^eco:/, '') : r.principal;
}

const verb = (act: InstallRequestAct): string => (act === 'install' ? 'install' : 'update');

/** What the one who asked is told, in words an agent can pass on. */
function outcomeSentence(request: PackageInstallRequest, state: InstallRequestState, by: string | null): string {
    const what = `your request to ${verb(request.act)} ${request.package.name} (${request.package.version})`;
    switch (state) {
        case 'approved': {
            const who = by && by.includes('#') ? `${by.split('#')[0]} approved ${what} in the owner's name` : `The owner approved ${what}`;
            const where = request.outcome?.instance_id ? ` Installed copy: ${request.outcome.instance_id}.` : '';
            return `${who}, and it is done.${where}`;
        }
        case 'declined':
            return `${what.charAt(0).toUpperCase()}${what.slice(1)} was declined. Nothing was installed or changed.`;
        case 'expired':
            return `${what.charAt(0).toUpperCase()}${what.slice(1)} expired before anyone decided it. Nothing was installed or changed. Ask again if it is still needed.`;
        case 'outdated':
            return `${what.charAt(0).toUpperCase()}${what.slice(1)} can no longer be carried out as asked: ${request.outcome?.reason ?? 'something it depended on changed'}. Nothing was installed or changed. Ask again.`;
        default:
            return `${what.charAt(0).toUpperCase()}${what.slice(1)} is waiting for the owner.`;
    }
}

/** The draft a door hands over: everything but the bookkeeping. */
export type InstallRequestDraft = Pick<PackageInstallRequest,
    'act' | 'package' | 'instance' | 'options' | 'memory_parts' | 'requested_by' | 'missing'>;

/**
 * Put a request in front of the owner. CREATES NOTHING of the package. Returns the standing request
 * when the same principal already asked for the same thing and it is still waiting.
 */
export async function fileInstallRequest(
    ctx: RequestStoreCtx, ownerGhii: string, draft: InstallRequestDraft,
): Promise<{ ok: true; request: PackageInstallRequest; alreadyWaiting: boolean } | InstallRequestFail> {
    const { storage } = ctx;
    const fingerprint = sha256(stableStringify({
        act: draft.act, by: draft.requested_by.principal, package: draft.package, instance: draft.instance, options: draft.options,
    }));
    if (Buffer.byteLength(stableStringify(draft.options), 'utf8') > MAX_OPTIONS_BYTES) {
        return fail(413, 'REQUEST_TOO_LARGE',
            'This migration carries more content than a request can hold for the owner. The owner can apply it themselves on the Packages page.');
    }

    // In the owner's queue, so the count and the duplicate check see each other and a decision.
    return inRequestQueue(ownerGhii, async () => {
        const now = Date.now();
        const all = await listInstallRequests(storage, ownerGhii);
        // Expired requests leave the owner's list here, before anything new joins it.
        for (const old of all.filter(r => r.state === 'awaiting_owner' && requestExpired(r, now))) {
            await settleInstallRequest(ctx, ownerGhii, old, 'expired', { by: null });
        }
        const waiting = all.filter(r => r.state === 'awaiting_owner' && !requestExpired(r, now));
        const same = waiting.find(r => r.fingerprint === fingerprint);
        if (same) return { ok: true as const, request: same, alreadyWaiting: true };
        if (waiting.length >= MAX_WAITING) {
            return fail(409, 'TOO_MANY_REQUESTS',
                `${MAX_WAITING} install requests already wait for the owner. They need to decide some before another one is filed.`);
        }

        const createdAt = new Date(now).toISOString();
        const request: PackageInstallRequest = {
            spec: SPEC, id: randomUUID(), ...draft,
            state: 'awaiting_owner',
            created_at: createdAt,
            expires_at: new Date(now + INSTALL_REQUEST_DAYS * 86_400_000).toISOString(),
            decided_at: null, decided_by: null, outcome: null, item_id: null,
            fingerprint,
        };
        const who = requesterName(draft.requested_by);
        const item = await addItem(storage, ownerGhii, {
            title: `${who} asks to ${verb(draft.act)} ${draft.package.name}, which writes entries into your memory`.slice(0, 200),
            kind: 'decision',
            origin: draft.requested_by.principal,
            object: { type: 'package-install-request', id: request.id },
            by: 'ai',
        });
        request.item_id = item?.id ?? null;
        await putRequest(storage, ownerGhii, request);

        // The owner's one tap. `api` actions run with the clicker's session, and the door re-checks
        // everything, so a stale tap answers 409 or 410 rather than acting.
        const door = `/v1/package-install-requests/${request.id}/decision`;
        const i18nKey = draft.act === 'install' ? 'package_install_request' : 'package_update_request';
        // The English here is the fallback and what a push carries; the page says it from the i18n key.
        await notify(storage, ownerGhii, {
            type: 'package_install_request',
            title: `${who} asks to ${verb(draft.act)} the package ${draft.package.name}`,
            body: draft.act === 'install'
                ? `The package writes entries into your memory, and ${who} may not do that on its own. If you approve, it is installed as yours.`
                : `The new version writes entries into your memory, and ${who} may not do that on its own. If you approve, your copy is updated.`,
            link: '/v1/profile#packages',
            i18n: { key: i18nKey, vars: { who, name: draft.package.name } },
            actions: [
                { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint: door, body: { decision: 'approve' }, style: 'primary' },
                { id: 'decline', label: 'Decline', kind: 'api', method: 'POST', endpoint: door, body: { decision: 'decline' }, style: 'default', confirm: true },
            ],
        });
        emitChange('open-items', ownerGhii);
        emitChange('notifications', ownerGhii);
        logger.info('Package install request filed', {
            event: 'packages.install_request_filed', owner: ownerGhii, id: request.id, act: draft.act,
            package: draft.package.group_id, by: draft.requested_by.principal, item: request.item_id,
        });
        return { ok: true as const, request, alreadyWaiting: false };
    });
}

/**
 * Record how a request ended, close the item it put on the owner's list, and tell the one who asked.
 * `by` is who decided: the owner's GHII, an agent's GAII, or null when time decided.
 */
export async function settleInstallRequest(
    ctx: RequestStoreCtx, ownerGhii: string, request: PackageInstallRequest, state: Exclude<InstallRequestState, 'awaiting_owner'>,
    how: { by: string | null; outcome?: PackageInstallRequest['outcome'] },
): Promise<PackageInstallRequest> {
    const { storage } = ctx;
    const settled: PackageInstallRequest = {
        ...request, state,
        decided_at: new Date().toISOString(),
        decided_by: how.by,
        outcome: how.outcome ?? request.outcome,
    };
    await putRequest(storage, ownerGhii, settled);

    if (request.item_id) {
        // Best effort: the decision is recorded above, and a stale row on a list is a smaller problem
        // than a failed decision.
        try {
            if (await getItem(storage, ownerGhii, request.item_id)) {
                await closeItem(storage, ownerGhii, request.item_id, how.by && how.by.includes('#') ? 'ai' : 'person');
            }
        } catch (err) {
            logger.warn('Package install request: could not close the owner list item', { owner: ownerGhii, id: request.id, error: String(err) });
        }
    }

    // Tell the one who asked. An agent gets a turn it can read back by the request's id; an app reads
    // the record, which already says it.
    if (request.requested_by.kind === 'agent') {
        try {
            await sendAgentV2Message(storage, {
                owner: localAccountName(ownerGhii),
                from: how.by ?? ownerGhii,
                to: request.requested_by.principal,
                role: 'agent',
                contextId: request.id,
                parts: [
                    { kind: 'text', text: outcomeSentence(settled, state, how.by) },
                    { kind: 'data', data: { request_id: request.id, act: request.act, state, group_id: request.package.group_id, version: request.package.version, ...(settled.outcome ?? {}) } },
                ],
                metadata: { kind: 'package-install-request' },
            });
        } catch (err) {
            logger.warn('Package install request: the requester could not be told; the record says it', { owner: ownerGhii, id: request.id, error: String(err) });
        }
    }

    // One of the owner's agents decided in their name: the owner hears about it.
    if (how.by && how.by.includes('#') && (state === 'approved' || state === 'declined')) {
        const agentName = how.by.split('#')[0];
        const asker = requesterName(request.requested_by);
        await notify(storage, ownerGhii, {
            type: 'package_install_request_decided',
            title: `${agentName} ${state === 'approved' ? 'approved' : 'declined'} the request about the package ${request.package.name}`,
            body: state === 'approved'
                ? `${asker} asked for it, and ${agentName} approved it in your name.`
                : `${asker} asked for it. Nothing was installed or changed.`,
            link: '/v1/profile#packages',
            i18n: {
                key: state === 'approved' ? 'package_request_approved_by_agent' : 'package_request_declined_by_agent',
                vars: { by: agentName, who: asker, name: request.package.name },
            },
        });
        emitChange('notifications', ownerGhii);
    }

    emitChange('open-items', ownerGhii);
    emitChange('packages', ownerGhii);
    logger.info('Package install request settled', {
        event: 'packages.install_request_settled', owner: ownerGhii, id: request.id, state, by: how.by,
    });
    return settled;
}
