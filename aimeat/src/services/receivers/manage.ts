/**
 * @file src/services/receivers/manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Managing receivers: the one implementation REST (routes/receivers.ts), the node MCP,
 *   the connector MCP and the CLI dispatch all reach, so the permission words, the node setting and
 *   the target checks are decided in one place.
 *
 *   WHO MAY DO WHAT.
 *     - read the owner's receivers and their deliveries: the owner, or a principal holding
 *       receivers:read;
 *     - PROPOSE one: the same, receivers:read. A proposal holds no key and writes nothing; the owner
 *       approves it in person, and only then is a key made, shown to the owner once (ruled 2026-11-07);
 *     - create, change, pause, resume, rotate, delete: the owner, or a principal holding
 *       receivers:manage, which is outside every wildcard. A key made by such a principal is answered
 *       to it once, because its task is often to put the key into the program's secret store;
 *     - stop and start any receiver, and decide one waiting for the operator: the operator.
 *   A session from another node is refused everything here.
 *
 *   THE NODE SETTING receivers.mode (./policy.ts): off (nothing is made, every receiver answers 503),
 *   operator (a new receiver waits for an operator), self (the owner's word is enough).
 *
 *   THE TARGET is checked when the receiver is made: a key or prefix the owner may write and that is
 *   not one the server itself trusts or keeps, or a row space of a workspace the owner belongs to. It
 *   is checked again on every write by the write path itself (./receive.ts).
 * @structure ReceiverDeps · listForCaller · getForCaller · deliveriesForCaller · createOrPropose ·
 *   decideProposal · updateSettings · setPaused · rotateKey · removeReceiver · operatorList ·
 *   operatorSetStopped · operatorDecide · mintReceiverKey · receiversUsingCsm
 * @usage const out = await createOrPropose(deps, caller, body, { propose: false });
 * @version-history
 *   v1.2.0 — 2026-11-08 — Making, approving and rotating record who was answered the key
 *     (ReceiverRecord.keyAnsweredTo; secaudit2026nov08b round 15, rotated-key-holder-not-surfaced).
 *   v1.1.0 — 2026-11-08 — The operator's start returns a receiver to the state its stop replaced, so the
 *     owner's pause stays (secaudit2026nov08 round 14, start-drops-owner-pause).
 *   2026-11-08 — receiversUsingCsm names each receiver's account, so a CSM delete is blocked only by
 *     the registering account's own receivers (ruling 2 of 2026-11-08; secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { UNCHANGED } from '../record-cas.js';
import { emitChange } from '../event-bus.js';
import { appMayWriteKey, isServerWrittenKey } from '../../utils/reserved-keys.js';
import { localAccountName } from '../../utils/gaii.js';
import { isSecretRecordKey } from '../secret-records.js';
import { newPartyKey, hashPartyKey } from '../parties/keys.js';
import { getCsmCompiled, csmMayRead, type CsmUse } from '../csm-service.js';
import {
    RECEIVERS_READ_SCOPE, RECEIVERS_MANAGE_SCOPE, RECEIVER_KEY_PREFIX, RECEIVER_MAXIMA, RECEIVER_DEFAULTS,
    normalizeReceiverInput, receiverView, effectiveState, validateReceiverName,
    type ReceiverRecord, type ReceiverSchema, type ReceiverVerb, RECEIVER_VERBS,
} from './contract.js';
import {
    ReceiverError, listReceivers, getReceiver, createReceiverRecord, updateReceiver, deleteReceiverRecord, listAllReceivers,
} from './store.js';
import { flushReceiverLogs, flushAllReceiverLogs, readReceiverLog, deleteReceiverLog, type ReceiverLog } from './deliveries.js';
import { receiversModeOf } from './policy.js';

export interface ReceiverDeps { storage: Storage; config: AimeatConfig }

function baseUrlOf(config: AimeatConfig): string {
    return config.baseUrl ?? '';
}

function refuseVisitor(caller: CallerContext): void {
    if (caller.visitor) throw new ReceiverError(403, 'FORBIDDEN', 'A session from another node manages no receivers here.');
}

function needRead(caller: CallerContext): void {
    refuseVisitor(caller);
    if (!caller.has(RECEIVERS_READ_SCOPE) && !caller.has(RECEIVERS_MANAGE_SCOPE)) {
        throw new ReceiverError(403, 'SCOPE_DENIED', `Reading receivers needs the "${RECEIVERS_READ_SCOPE}" permission, which the owner gives on the agent's page.`);
    }
}

function needManage(caller: CallerContext, action: string): void {
    refuseVisitor(caller);
    if (!caller.has(RECEIVERS_MANAGE_SCOPE)) {
        throw new ReceiverError(403, 'SCOPE_DENIED', `${action} needs the "${RECEIVERS_MANAGE_SCOPE}" permission, which only the owner gives, on the agent's page. Without it, propose the receiver and the owner approves it.`);
    }
}

/** The summary of the log a list row shows. */
function logSummary(log: ReceiverLog) {
    const today = new Date().toISOString().slice(0, 10);
    const d = log.days.find(x => x.date === today);
    return {
        lastDeliveryAt: log.lastDeliveryAt, lastRefusalAt: log.lastRefusalAt, failedAttempts: log.failedAttempts,
        today: d?.delivered ?? 0, refusedToday: d?.refused ?? 0,
    };
}

function view(deps: ReceiverDeps, ownerName: string, r: ReceiverRecord, log?: ReceiverLog) {
    return receiverView(r, ownerName, deps.config.nodeId, baseUrlOf(deps.config), log ? logSummary(log) : null);
}

/** Every receiver of the caller's account. */
export async function listForCaller(deps: ReceiverDeps, caller: CallerContext) {
    needRead(caller);
    await flushReceiverLogs(caller.ownerGhii);
    const list = await listReceivers(deps.storage, caller.ownerGhii);
    const out = [];
    for (const r of list) out.push(view(deps, caller.owner, r, await readReceiverLog(deps.storage, caller.ownerGhii, r.name)));
    return { receivers: out, mode: receiversModeOf(deps.config), total: out.length };
}

async function mustGet(deps: ReceiverDeps, ownerGhii: string, name: string): Promise<ReceiverRecord> {
    const r = await getReceiver(deps.storage, ownerGhii, name);
    if (!r) throw new ReceiverError(404, 'NOT_FOUND', `You have no receiver called "${name}".`);
    return r;
}

/** One receiver of the caller's account, with its newest deliveries. */
export async function getForCaller(deps: ReceiverDeps, caller: CallerContext, name: string) {
    needRead(caller);
    const r = await mustGet(deps, caller.ownerGhii, name);
    await flushReceiverLogs(caller.ownerGhii);
    const log = await readReceiverLog(deps.storage, caller.ownerGhii, name);
    return { receiver: view(deps, caller.owner, r, log), recent: log.entries.slice(-20).reverse() };
}

/** The deliveries of one receiver, newest first. */
export async function deliveriesForCaller(deps: ReceiverDeps, caller: CallerContext, name: string, opts: { onlyRefused?: boolean } = {}) {
    needRead(caller);
    await mustGet(deps, caller.ownerGhii, name);
    await flushReceiverLogs(caller.ownerGhii);
    const log = await readReceiverLog(deps.storage, caller.ownerGhii, name);
    const entries = [...log.entries].reverse().filter(e => !opts.onlyRefused || e.status >= 400);
    return { deliveries: entries, total: entries.length, failed_attempts: log.failedAttempts, days: log.days };
}

/** A new key: `aimeat_rcv_` and 32 random bytes. The key leaves the node once. */
export function mintReceiverKey(): { key: string; hash: string; id: string } {
    const { key } = newPartyKey();
    const full = `${RECEIVER_KEY_PREFIX}${key}`;
    return { key: full, hash: hashPartyKey(full), id: `rk_${randomUUID().replace(/-/g, '').slice(0, 12)}` };
}

/**
 * The target must be a place the owner may write and that no service of the node keeps or trusts.
 * The write path checks the same again on every write; this answers the owner before a key exists.
 */
async function checkTarget(deps: ReceiverDeps, caller: CallerContext, target: ReceiverRecord['target']): Promise<void> {
    if (target.kind === 'key' || target.kind === 'prefix') {
        const probe = target.kind === 'key' ? target.key : `${target.prefix}.x`;
        const refused = isServerWrittenKey(probe) || isSecretRecordKey(probe)
            || !appMayWriteKey(['app'], probe, true, false)
            || (target.kind === 'prefix' && (isServerWrittenKey(target.prefix) || !appMayWriteKey(['app'], target.prefix, true, false)));
        if (refused) {
            throw new ReceiverError(422, 'RESERVED_TARGET', `"${target.kind === 'key' ? target.key : target.prefix}" is a place the server itself keeps or trusts (settings, keys, the public profile). A receiver writes your own data only: choose another key.`);
        }
        return;
    }
    const membership = await deps.storage.getMembership(target.organismId, caller.owner);
    if (!membership) {
        throw new ReceiverError(403, 'NOT_A_MEMBER', 'You are not a member of that organism, so a receiver of yours cannot write into its workspace.');
    }
}

/** The CSM a receiver checks messages against, compiled now and kept as a copy. */
async function resolveSchema(deps: ReceiverDeps, caller: CallerContext, csm: string | null, version?: number): Promise<ReceiverSchema | null> {
    if (!csm) return null;
    // The owner must be able to read the CSM, as on GET /v1/csm/{name}: a private shape of another
    // account answers as missing.
    const record = await deps.storage.getCsm(csm);
    const compiled = record && await csmMayRead(deps.storage, record, caller)
        ? await getCsmCompiled(deps.storage, csm, version) : null;
    if (!compiled) {
        throw new ReceiverError(404, 'CSM_NOT_FOUND', `No CSM called "${csm}"${version ? ` at version ${version}` : ''} that you can read. Make one with aimeat_csm (from_sample builds it from an example message), or leave csm out to take any JSON.`);
    }
    return { csm: compiled.name, version: compiled.version, hash: compiled.hash, jsonSchema: compiled.jsonSchema };
}

function sayCreated(r: ReceiverRecord, address: string, keyShown: boolean): string {
    const where = r.target.kind === 'key' ? `the key ${r.target.key}`
        : r.target.kind === 'prefix' ? `keys under ${r.target.prefix}. (at most ${r.target.maxKeys})`
            : `the row space ${r.target.space}`;
    const shape = r.schema ? ` Every message is checked against ${r.schema.csm} before it is stored.` : ' It takes any JSON; a CSM shape is recommended.';
    const state = r.state === 'awaiting_operator' ? ' It starts working when the operator of this node approves it.' : '';
    const key = keyShown ? ' The key is shown only now: put it straight into the program\'s secret store.' : '';
    return `The program writes to ${address}, into ${where}.${shape}${state}${key}`;
}

/**
 * Make a receiver, or propose one. `propose` stores it without a key, waiting for the owner; without
 * `propose` the caller must be the owner or hold receivers:manage, and the answer carries the key once.
 */
export async function createOrPropose(
    deps: ReceiverDeps, caller: CallerContext, body: Record<string, unknown>, opts: { propose: boolean },
): Promise<{ receiver: Record<string, unknown>; key?: string; say: string; approve_url?: string }> {
    if (opts.propose) needRead(caller); else needManage(caller, 'Making a receiver');
    const mode = receiversModeOf(deps.config);
    if (mode === 'off') throw new ReceiverError(403, 'RECEIVERS_OFF', 'The operator of this node has switched receivers off.');
    const input = normalizeReceiverInput(body);
    if (typeof input === 'string') throw new ReceiverError(400, 'INVALID_INPUT', input);
    await checkTarget(deps, caller, input.target);
    const schema = await resolveSchema(deps, caller, input.csm, input.csmVersion);
    const now = new Date();
    const record: ReceiverRecord = {
        uid: `rcv_${randomUUID().replace(/-/g, '')}`,
        name: input.name,
        displayName: input.displayName ?? input.name,
        ...(input.description ? { description: input.description } : {}),
        target: input.target, schema, verbs: input.verbs, limits: input.limits, visibility: input.visibility,
        state: opts.propose ? 'proposed' : mode === 'operator' ? 'awaiting_operator' : 'active',
        keyHash: null, keyId: null, previousKey: null,
        createdAt: now.toISOString(), createdBy: caller.principal,
        approvedAt: opts.propose ? null : now.toISOString(),
        expiresAt: new Date(now.getTime() + input.expiresDays * 86_400_000).toISOString(),
    };
    let key: string | undefined;
    if (!opts.propose) {
        const k = mintReceiverKey();
        record.keyHash = k.hash; record.keyId = k.id; key = k.key;
        record.keyAnsweredTo = caller.principal;
    }
    await createReceiverRecord(deps.storage, caller.ownerGhii, record);
    emitChange('receivers', caller.ownerGhii);
    const v = view(deps, caller.owner, record);
    if (opts.propose) {
        const approveUrl = `${baseUrlOf(deps.config)}/v1/profile?tab=receivers&approve=${encodeURIComponent(record.name)}`;
        return {
            receiver: v, approve_url: approveUrl,
            say: `I proposed a receiver called ${record.displayName}. Approve it here: ${approveUrl}. Nothing is written and no key exists until you approve it, and the key is then shown to you, not to me.`,
        };
    }
    return { receiver: v, key, say: sayCreated(record, v.address as string, true) };
}

/**
 * The owner's decision on a proposal, in person only: an agent cannot approve what an agent proposed.
 * Approving makes the key and answers it once; refusing deletes the proposal.
 */
export async function decideProposal(deps: ReceiverDeps, caller: CallerContext, name: string, decision: 'approve' | 'refuse') {
    refuseVisitor(caller);
    if (!caller.inPerson) throw new ReceiverError(403, 'OWNER_ONLY', 'Only the owner, signed in, approves a receiver someone proposed.');
    const cur = await mustGet(deps, caller.ownerGhii, name);
    if (cur.state !== 'proposed') throw new ReceiverError(409, 'NOT_PROPOSED', `"${name}" is not waiting for a decision.`);
    if (decision === 'refuse') {
        await deleteReceiverRecord(deps.storage, caller.ownerGhii, name);
        emitChange('receivers', caller.ownerGhii);
        return { refused: true, say: `The proposed receiver ${cur.displayName} was removed. Nothing was written.` };
    }
    const mode = receiversModeOf(deps.config);
    if (mode === 'off') throw new ReceiverError(403, 'RECEIVERS_OFF', 'The operator of this node has switched receivers off.');
    const k = mintReceiverKey();
    const now = new Date().toISOString();
    const out = await updateReceiver(deps.storage, caller.ownerGhii, name, r => (r.state !== 'proposed' ? UNCHANGED : {
        ...r, state: mode === 'operator' ? 'awaiting_operator' : 'active', keyHash: k.hash, keyId: k.id, approvedAt: now,
        keyAnsweredTo: caller.principal,
    }));
    if (out.keyHash !== k.hash) throw new ReceiverError(409, 'NOT_PROPOSED', `"${name}" was decided meanwhile.`);
    emitChange('receivers', caller.ownerGhii);
    const v = view(deps, caller.owner, out);
    return { receiver: v, key: k.key, say: sayCreated(out, v.address as string, true) };
}

/** Change the limits, verbs, end date, names, visibility or the CSM version of one receiver. Target and CSM stay. */
export async function updateSettings(deps: ReceiverDeps, caller: CallerContext, name: string, patch: Record<string, unknown>) {
    needManage(caller, 'Changing a receiver');
    if (patch.target !== undefined || patch.csm !== undefined || patch.name !== undefined) {
        throw new ReceiverError(400, 'INVALID_INPUT', 'A receiver keeps its name, target and CSM. Make a new receiver for another place or another shape; csm_version moves it to a newer version of the same CSM.');
    }
    const cur = await mustGet(deps, caller.ownerGhii, name);
    // The same checks as at creation, read off a body made of the current record and the patch.
    const merged = normalizeReceiverInput({
        name: cur.name,
        target: cur.target.kind === 'key' ? { key: cur.target.key }
            : cur.target.kind === 'prefix' ? { prefix: cur.target.prefix, max_keys: (patch.target_max_keys ?? cur.target.maxKeys) }
                : { organism_id: cur.target.organismId, ws: cur.target.ws, space: cur.target.space },
        verbs: patch.verbs ?? cur.verbs,
        limits: { ...{ per_minute: cur.limits.perMinute, per_day: cur.limits.perDay, max_bytes: cur.limits.maxBytes }, ...(patch.limits as object ?? {}) },
        visibility: patch.visibility ?? cur.visibility,
        display_name: patch.display_name ?? cur.displayName,
        description: patch.description ?? cur.description,
        expires_days: patch.expires_days ?? 1,
    });
    if (typeof merged === 'string') throw new ReceiverError(400, 'INVALID_INPUT', merged);
    let schema = cur.schema;
    if (patch.csm_version !== undefined) {
        if (!cur.schema) throw new ReceiverError(400, 'INVALID_INPUT', 'This receiver has no CSM to move to another version.');
        schema = await resolveSchema(deps, caller, cur.schema.csm, Number(patch.csm_version));
    }
    const out = await updateReceiver(deps.storage, caller.ownerGhii, name, r => ({
        ...r, displayName: merged.displayName ?? r.displayName,
        ...(merged.description !== undefined ? { description: merged.description } : {}),
        target: merged.target, verbs: merged.verbs, limits: merged.limits, visibility: merged.visibility, schema,
        ...(patch.expires_days !== undefined ? { expiresAt: new Date(Date.now() + merged.expiresDays * 86_400_000).toISOString() } : {}),
    }));
    emitChange('receivers', caller.ownerGhii);
    return { receiver: view(deps, caller.owner, out) };
}

/** The owner pauses or resumes a receiver. A receiver the operator stopped stays stopped. */
export async function setPaused(deps: ReceiverDeps, caller: CallerContext, name: string, paused: boolean) {
    needManage(caller, paused ? 'Pausing a receiver' : 'Resuming a receiver');
    const out = await updateReceiver(deps.storage, caller.ownerGhii, name, r => {
        if (r.state === 'stopped') throw new ReceiverError(403, 'STOPPED_BY_OPERATOR', `The operator stopped "${name}"${r.stopReason ? `: ${r.stopReason}` : ''}. Only the operator starts it again.`);
        if (r.state === 'proposed' || r.state === 'awaiting_operator') throw new ReceiverError(409, 'NOT_ACTIVE', `"${name}" is not working yet.`);
        if (paused && r.state === 'paused') return UNCHANGED;
        if (!paused && r.state === 'active') return UNCHANGED;
        return { ...r, state: paused ? 'paused' : 'active', pausedAt: paused ? new Date().toISOString() : null };
    });
    emitChange('receivers', caller.ownerGhii);
    return { receiver: view(deps, caller.owner, out) };
}

/** A new key, answered once. The old one keeps working for `overlap_minutes` (0 ends it now). */
export async function rotateKey(deps: ReceiverDeps, caller: CallerContext, name: string, overlapMinutes?: unknown) {
    needManage(caller, 'Changing a receiver\'s key');
    const overlap = overlapMinutes === undefined || overlapMinutes === null ? RECEIVER_DEFAULTS.rotateOverlapMinutes : Number(overlapMinutes);
    if (!Number.isInteger(overlap) || overlap < 0 || overlap > RECEIVER_MAXIMA.rotateOverlapMinutes) {
        throw new ReceiverError(400, 'INVALID_INPUT', `overlap_minutes is a whole number from 0 to ${RECEIVER_MAXIMA.rotateOverlapMinutes}.`);
    }
    const k = mintReceiverKey();
    const now = Date.now();
    const out = await updateReceiver(deps.storage, caller.ownerGhii, name, r => {
        if (!r.keyHash) throw new ReceiverError(409, 'NOT_ACTIVE', `"${name}" has no key yet: it waits for a decision.`);
        // Who is answered the new key is recorded, so removing that agent or app names this receiver
        // as well as removing its maker does (./makers.ts; secaudit2026nov08b round 15).
        return {
            ...r, keyHash: k.hash, keyId: k.id, keyRotatedAt: new Date(now).toISOString(), keyAnsweredTo: caller.principal,
            previousKey: overlap > 0 && r.keyId
                ? { hash: r.keyHash, id: r.keyId, until: new Date(now + overlap * 60_000).toISOString(), answeredTo: r.keyAnsweredTo ?? null }
                : null,
        };
    });
    emitChange('receivers', caller.ownerGhii);
    return {
        receiver: view(deps, caller.owner, out), key: k.key,
        say: overlap > 0
            ? `The new key is shown only now. The old key keeps working for ${overlap} minutes, so the program can be updated without a gap.`
            : 'The new key is shown only now. The old key stopped working at once.',
    };
}

/** Delete a receiver. Its key stops at once; what it wrote stays the owner's. */
export async function removeReceiver(deps: ReceiverDeps, caller: CallerContext, name: string) {
    needManage(caller, 'Deleting a receiver');
    const nameErr = validateReceiverName(name);
    if (nameErr) throw new ReceiverError(400, 'INVALID_INPUT', nameErr);
    if (!(await deleteReceiverRecord(deps.storage, caller.ownerGhii, name))) {
        throw new ReceiverError(404, 'NOT_FOUND', `You have no receiver called "${name}".`);
    }
    await deleteReceiverLog(deps.storage, caller.ownerGhii, name);
    emitChange('receivers', caller.ownerGhii);
    return { deleted: true, say: 'The receiver is gone and its key no longer works. What it wrote stays in your data.' };
}

async function needOperator(caller: CallerContext): Promise<void> {
    if (!(await caller.operator('operator:admin'))) {
        throw new ReceiverError(403, 'OPERATOR_ONLY', 'Only the operator of this node sees and stops every receiver.');
    }
}

/** Every receiver on the node, the counts and the setting, for the operator. No key hash, no content. */
export async function operatorList(deps: ReceiverDeps, caller: CallerContext, opts: { owner?: string; state?: string } = {}) {
    await needOperator(caller);
    await flushAllReceiverLogs();
    const all = await listAllReceivers(deps.storage);
    const rows: Array<Record<string, unknown> & { owner: string }> = [];
    let writesToday = 0; let refusedToday = 0; let wrongKeys = 0;
    for (const { ownerGhii, receiver } of all) {
        const owner = localAccountName(ownerGhii);
        if (opts.owner && opts.owner !== owner) continue;
        const state = effectiveState(receiver);
        if (opts.state && opts.state !== state) continue;
        const log = await readReceiverLog(deps.storage, ownerGhii, receiver.name);
        const s = logSummary(log);
        writesToday += s.today; refusedToday += s.refusedToday; wrongKeys += s.failedAttempts;
        rows.push({ owner, ...view(deps, owner, receiver, log) });
    }
    const owners = new Set(rows.map(r => r.owner)).size;
    return {
        mode: receiversModeOf(deps.config),
        counts: {
            receivers: rows.length, owners,
            active: rows.filter(r => r.state === 'active').length,
            waiting: rows.filter(r => r.state === 'awaiting_operator').length,
            writes_today: writesToday, refused_today: refusedToday, wrong_keys: wrongKeys,
        },
        receivers: rows,
    };
}

/**
 * The operator stops or starts any receiver. A stop needs a reason, which the owner reads. The stop
 * keeps the state it replaced (stoppedFrom) and the start returns to it, so a receiver the owner paused
 * stays paused, and one waiting for the operator waits again. A receiver stopped before stoppedFrom
 * existed starts as before: active when it has a key.
 */
export async function operatorSetStopped(deps: ReceiverDeps, caller: CallerContext, owner: string, name: string, stopped: boolean, reason?: string) {
    await needOperator(caller);
    if (stopped && (typeof reason !== 'string' || reason.trim().length < 3)) {
        throw new ReceiverError(400, 'INVALID_INPUT', 'Say why, in a few words: the owner reads it.');
    }
    const ownerGhii = `${owner}@${deps.config.nodeId}`;
    const out = await updateReceiver(deps.storage, ownerGhii, name, r => {
        if (stopped) {
            // A second stop keeps the state the first one replaced.
            const from = r.state === 'stopped' ? (r.stoppedFrom ?? null) : r.state;
            return { ...r, state: 'stopped', stoppedAt: new Date().toISOString(), stopReason: reason!.trim().slice(0, 500), stoppedFrom: from };
        }
        if (r.state !== 'stopped') return UNCHANGED;
        const back = r.stoppedFrom && r.stoppedFrom !== 'stopped' && (r.keyHash || r.stoppedFrom === 'proposed')
            ? r.stoppedFrom : r.keyHash ? 'active' : 'proposed';
        return { ...r, state: back, stoppedAt: null, stopReason: null, stoppedFrom: null };
    });
    emitChange('receivers', ownerGhii);
    return { receiver: { owner, ...view(deps, owner, out) } };
}

/** The operator's decision on a receiver waiting for one (receivers.mode = operator). */
export async function operatorDecide(deps: ReceiverDeps, caller: CallerContext, owner: string, name: string, decision: 'approve' | 'refuse', reason?: string) {
    await needOperator(caller);
    const ownerGhii = `${owner}@${deps.config.nodeId}`;
    const out = await updateReceiver(deps.storage, ownerGhii, name, r => {
        if (r.state !== 'awaiting_operator') throw new ReceiverError(409, 'NOT_WAITING', `"${name}" is not waiting for the operator.`);
        const d = { decision, at: new Date().toISOString(), by: caller.principal, ...(reason ? { reason: reason.slice(0, 500) } : {}) };
        return decision === 'approve'
            ? { ...r, state: 'active', operatorDecision: d }
            : { ...r, state: 'stopped', stoppedAt: d.at, stopReason: reason?.slice(0, 500) ?? 'The operator did not approve this receiver.', operatorDecision: d, stoppedFrom: 'awaiting_operator' };
    });
    emitChange('receivers', ownerGhii);
    return { receiver: { owner, ...view(deps, owner, out) } };
}

/**
 * The receivers that check messages against a CSM, as "receiver owner/name" with the owning account.
 * The CSM delete refuses while the registering account has any; another account's receiver keeps its
 * own copy of the schema and its owner is told instead (csm-service.ts deleteCsmAs, ruling 2 of 2026-11-08).
 */
export async function receiversUsingCsm(storage: Storage, csmName: string): Promise<CsmUse[]> {
    const all = await listAllReceivers(storage);
    return all.filter(x => x.receiver.schema?.csm === csmName)
        .map(x => ({
            label: `receiver ${localAccountName(x.ownerGhii)}/${x.receiver.name}`,
            account: localAccountName(x.ownerGhii),
            name: x.receiver.name,
            link: '/v1/profile?tab=receivers',
        }));
}

/** The verbs a receiver takes, for a reader that names them. */
export const RECEIVER_VERB_LIST: readonly ReceiverVerb[] = RECEIVER_VERBS;
