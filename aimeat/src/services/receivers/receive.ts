/**
 * @file src/services/receivers/receive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a program's call to a receiver does, after acceptCredential('receiver') has
 *   matched its key (./verify.ts). The route (routes/receive.ts) hands the request here and answers
 *   what comes back; nothing here reads Express.
 *
 *   REFUSE BEFORE YOU WRITE, in this order: the verb the owner allowed, the media type, the size, the
 *   minute and day limits, the address naming the receiver's own target and nothing else, the CSM
 *   shape the receiver was made with, and only then the write. A dry run stops after the shape.
 *
 *   ONE WRITE PATH. A memory record is written with writeMemoryRecord (services/memory-write.ts) under
 *   the owner's identity with the receiver as the principal, so the archive guard, the value and key
 *   ceilings, the byte quota, the schema lock on the key, the organism and visibility rules, the
 *   provenance record (level `machine`, services/ai/provenance.ts) and every event a write sets off
 *   happen exactly as for any other writer. A record is removed with deleteMemoryRecord
 *   (services/memory-bin.ts), so it goes to the bin for the grace period. A row goes through
 *   appendRows, readRows and deleteRow (services/workspace-rows/row-service.ts), whose gate admits a
 *   receiver as its owner's membership and never more, and whose space schema binds it as every writer.
 *
 *   IDEMPOTENCY. A retried call writes the same thing again, never a second thing: a memory write
 *   replaces the record with the same value, and for a row the Idempotency-Key header names the row
 *   (its id is derived from the key), so a retry replaces that row instead of appending another.
 * @structure ReceiveRequest · ReceiveAnswer · receive · describeReceiver · mergePatch
 * @usage const out = await receive(fanout, ctx, { method, sub, body, contentType, bytes, idempotencyKey, ifMatch, dryRun });
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import { createHash } from 'node:crypto';
import type { MemoryWriteFanout } from '../memory-write-types.js';
import { writeMemoryRecord } from '../memory-write.js';
import { deleteMemoryRecord } from '../memory-bin.js';
import { validateValueAgainstSchema } from '../schema-validator.js';
import { appendRows, readRows, deleteRow, WorkspaceRowError, type RowCaller } from '../workspace-rows/row-service.js';
import { readerForCaller } from '../classification/reader.js';
import { RECEIVER_SUB_RE, verbOfMethod, receiverAddress, type ReceiverVerb } from './contract.js';
import { ReceiverError } from './store.js';
import { logDelivery, takeMinuteSlot, takeDaySlot } from './deliveries.js';
import type { ReceiverContext } from './verify.js';

export interface ReceiveRequest {
    method: string;
    /** The address's third segment: a key's last part for a prefix target, a row id for a row space, or `_self`. */
    sub: string | null;
    body: unknown;
    contentType: string;
    /** The body's size in bytes as it arrived. */
    bytes: number;
    idempotencyKey: string | null;
    /** A version from If-Match, for PUT and PATCH on a memory record. */
    ifMatch: number | null;
    dryRun: boolean;
}

export interface ReceiveAnswer { status: number; data: Record<string, unknown> }

/** RFC 7396 JSON Merge Patch: objects merge, null removes, anything else replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const out: Record<string, unknown> = target && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        if (v === null) delete out[k]; else out[k] = mergePatch(out[k], v);
    }
    return out;
}

/** What a program or an AI reads first: what this receiver takes. */
export function describeReceiver(ctx: ReceiverContext, baseUrl: string): Record<string, unknown> {
    const r = ctx.receiver;
    const t = r.target;
    return {
        receiver: `${ctx.owner}/${ctx.name}`,
        address: receiverAddress(baseUrl, ctx.owner, ctx.name),
        target: t.kind === 'key' ? { kind: 'key', key: t.key, address: 'POST to the address itself' }
            : t.kind === 'prefix' ? { kind: 'prefix', prefix: t.prefix, max_keys: t.maxKeys, address: 'POST to <address>/<last part>; the key is <prefix>.<last part>' }
                : { kind: 'space', space: t.space, address: 'POST one row or { "rows": [...] } to the address' },
        verbs: r.verbs,
        limits: { per_minute: r.limits.perMinute, per_day: r.limits.perDay, max_bytes: r.limits.maxBytes },
        schema: r.schema ? { csm: r.schema.csm, version: r.schema.version, json_schema: r.schema.jsonSchema } : null,
        expires_at: r.expiresAt,
        idempotency: 'Send Idempotency-Key on a retry: a row then replaces itself instead of being added twice.',
    };
}

function schemaRefusal(violations: Array<{ path: string; message: string; schema_rule?: string }> | undefined, errors: string[] | undefined, csm: string, index?: number): ReceiverError {
    const fields = (violations ?? []).map(v => ({ path: v.path || '/', rule: v.schema_rule ?? 'schema', message: v.message }));
    const where = index === undefined ? '' : ` in row ${index}`;
    // The code the records path and the row spaces answer a schema refusal with, so one kind of refusal
    // has one code whichever writer meets it.
    return new ReceiverError(422, 'SCHEMA_VALIDATION_FAILED',
        `The message does not match ${csm}${where}: ${fields.length ? fields.map(f => `${f.path} ${f.message}`).join('; ') : (errors ?? []).join('; ')}. Nothing was written.`,
        { fields, ...(index !== undefined ? { row: index } : {}) });
}

function checkShape(ctx: ReceiverContext, value: unknown, index?: number): void {
    const s = ctx.receiver.schema;
    if (!s) return;
    const v = validateValueAgainstSchema(value, s.jsonSchema);
    if (!v.ok) throw schemaRefusal(v.violations, v.errors, `${s.csm} v${s.version}`, index);
}

/** A row id from an Idempotency-Key: the same key always names the same row. */
function rowIdOf(idempotencyKey: string): string {
    return `idem-${createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 32)}`;
}

function rowCallerOf(ctx: ReceiverContext): RowCaller {
    return { principal: ctx.principal, identity: ctx.principal, owner: ctx.owner, roles: ['receiver'], scopes: [], receiver: true };
}

function rowError(err: unknown): never {
    if (err instanceof WorkspaceRowError) throw new ReceiverError(err.statusCode, err.code, err.message);
    throw err;
}

/** Carry out one call. Every outcome, served or refused, is logged for the owner (without the body). */
export async function receive(deps: MemoryWriteFanout, ctx: ReceiverContext, rq: ReceiveRequest): Promise<ReceiveAnswer> {
    const verb = verbOfMethod(rq.method);
    const at = new Date().toISOString();
    try {
        const out = await run(deps, ctx, rq, verb);
        if (rq.sub !== '_self') {
            logDelivery(deps.storage, ctx.ownerGhii, ctx.name, {
                at, verb: verb ?? rq.method, status: out.status, bytes: rq.bytes,
                ...(typeof out.data.key === 'string' ? { key: out.data.key } : {}),
                ...(Array.isArray(out.data.row_ids) ? { rowIds: (out.data.row_ids as string[]).slice(0, 20) } : {}),
                ...(rq.dryRun ? { dryRun: true } : {}),
            });
        }
        return out;
    } catch (err) {
        if (err instanceof ReceiverError) {
            logDelivery(deps.storage, ctx.ownerGhii, ctx.name, { at, verb: verb ?? rq.method, status: err.status, code: err.code, reason: err.message, bytes: rq.bytes, ...(rq.dryRun ? { dryRun: true } : {}) });
        }
        throw err;
    }
}

async function run(deps: MemoryWriteFanout, ctx: ReceiverContext, rq: ReceiveRequest, verb: ReceiverVerb | null): Promise<ReceiveAnswer> {
    const r = ctx.receiver;
    if (rq.sub === '_self') {
        if (verb !== 'read') throw new ReceiverError(405, 'METHOD_NOT_ALLOWED', 'The _self address answers GET only.');
        return { status: 200, data: describeReceiver(ctx, deps.config.baseUrl ?? '') };
    }
    if (!verb) throw new ReceiverError(405, 'METHOD_NOT_ALLOWED', 'A receiver takes POST, PUT, PATCH, GET and DELETE.');
    if (!r.verbs.includes(verb)) {
        throw new ReceiverError(403, 'VERB_NOT_ALLOWED', `The owner has not let this receiver ${verb === 'merge' ? 'merge fields (PATCH)' : verb === 'read' ? 'read back (GET)' : verb === 'delete' ? 'delete (DELETE)' : verb}. Nothing was done.`);
    }
    const sends = verb === 'write' || verb === 'merge';
    if (sends && !/^application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(rq.contentType)) {
        throw new ReceiverError(415, 'UNSUPPORTED_MEDIA_TYPE', 'A receiver takes JSON: send Content-Type: application/json.');
    }
    if (sends && rq.bytes > r.limits.maxBytes) {
        throw new ReceiverError(413, 'TOO_LARGE', `The message is ${rq.bytes} bytes and this receiver takes at most ${r.limits.maxBytes}. Nothing was written.`);
    }
    if (!takeMinuteSlot(r.uid, r.limits.perMinute)) {
        throw new ReceiverError(429, 'RATE_LIMITED', `This receiver takes at most ${r.limits.perMinute} calls a minute. Try again in a minute.`, { retryAfter: 60 });
    }
    if (!rq.dryRun && sends && !takeDaySlot(r.uid, r.limits.perDay)) {
        throw new ReceiverError(429, 'DAILY_LIMIT', `This receiver takes at most ${r.limits.perDay} messages a day (UTC). Try again tomorrow, or ask the owner for a higher limit.`, { retryAfter: 3600 });
    }
    if (r.target.kind === 'space') return runSpace(deps, ctx, rq, verb);
    return runMemory(deps, ctx, rq, verb);
}

/** The memory key this call names, or the refusal. A prefix target lists its keys on a bare GET. */
function memoryKeyOf(ctx: ReceiverContext, rq: ReceiveRequest, verb: ReceiverVerb): string | null {
    const t = ctx.receiver.target;
    if (t.kind === 'key') {
        if (rq.sub) throw new ReceiverError(404, 'NOT_FOUND', 'This receiver writes one key: its address takes no last part.');
        return t.key;
    }
    if (t.kind !== 'prefix') return null;
    if (!rq.sub) {
        if (verb === 'read') return null;
        throw new ReceiverError(400, 'SUB_REQUIRED', `This receiver writes keys under ${t.prefix}.: add the last part to the address, such as /olohuone.`);
    }
    if (!RECEIVER_SUB_RE.test(rq.sub)) {
        throw new ReceiverError(400, 'INVALID_SUB', 'The last part of the address is lowercase letters, digits, dashes and underscores, starting with a letter or a digit, at most 64 characters.');
    }
    return `${t.prefix}.${rq.sub}`;
}

async function runMemory(deps: MemoryWriteFanout, ctx: ReceiverContext, rq: ReceiveRequest, verb: ReceiverVerb): Promise<ReceiveAnswer> {
    const r = ctx.receiver;
    const key = memoryKeyOf(ctx, rq, verb);
    const { storage } = deps;

    if (verb === 'read') {
        if (key === null) {
            const t = r.target as { prefix: string };
            const rows = await storage.listMemory(ctx.ownerGhii, { prefix: `${t.prefix}.` });
            return { status: 200, data: { prefix: t.prefix, keys: rows.map(x => ({ key: x.key, version: x.version, updated_at: x.updatedAt })) } };
        }
        const rec = await storage.getMemory(ctx.ownerGhii, key);
        if (!rec) throw new ReceiverError(404, 'NOT_FOUND', `Nothing is stored at ${key} yet.`);
        return { status: 200, data: { key, value: rec.value, version: rec.version, updated_at: rec.updatedAt } };
    }

    if (verb === 'delete') {
        if (rq.dryRun) return { status: 200, data: { dry_run: true, would_delete: key } };
        // The record lands under the owner's identity, so it is removed there. The receiver may reach
        // only its own key, decided above, and the removal goes to the bin like the owner's own.
        const out = await deleteMemoryRecord({ storage, config: deps.config }, {
            caller: ctx.ownerGhii, ownerName: ctx.owner, key: key!, roles: ['owner'], scopes: [],
        });
        if (!out.ok) throw new ReceiverError(out.status ?? 404, out.code, out.message);
        return { status: 200, data: { key, deleted: true, restorable_until: out.restorableUntil } };
    }

    // write or merge
    const current = await storage.getMemory(ctx.ownerGhii, key!);
    if (r.target.kind === 'prefix' && !current) {
        const existing = await storage.listMemory(ctx.ownerGhii, { prefix: `${r.target.prefix}.` });
        if (existing.length >= r.target.maxKeys) {
            throw new ReceiverError(409, 'PREFIX_FULL', `${r.target.prefix}. already holds ${existing.length} keys, the most this receiver may make. Write to an existing one, or ask the owner to raise the limit. Nothing was written.`);
        }
    }
    if (rq.ifMatch !== null && (!current || current.version !== rq.ifMatch)) {
        throw new ReceiverError(409, 'VERSION_CONFLICT', `${key} is at version ${current?.version ?? 0}, not ${rq.ifMatch}. Read it again and resend. Nothing was written.`);
    }
    const value = verb === 'merge' ? mergePatch(current?.value ?? {}, rq.body) : rq.body;
    checkShape(ctx, value);
    if (rq.dryRun) return { status: 200, data: { dry_run: true, key, would_write: value } };

    const out = await writeMemoryRecord(deps, {
        principal: ctx.principal, targetGaii: ctx.ownerGhii, scopes: ['memory:write'], roles: ['receiver'],
    }, {
        key: key!, value, visibility: r.visibility, tags: ['receiver'],
        // PATCH and If-Match write on the version read, so a change made in between is never lost.
        ...(current && (verb === 'merge' || rq.ifMatch !== null) ? { expectedVersion: current.version } : {}),
        pipeline: `receiver:${ctx.owner}/${ctx.name}`, ownerScoped: true,
    });
    if (!out.ok) throw new ReceiverError(out.status, out.code, out.message);
    return { status: current ? 200 : 201, data: { key, version: out.record.version, receiver: `${ctx.owner}/${ctx.name}` } };
}

async function runSpace(deps: MemoryWriteFanout, ctx: ReceiverContext, rq: ReceiveRequest, verb: ReceiverVerb): Promise<ReceiveAnswer> {
    const t = ctx.receiver.target as { organismId: string; ws: string; space: string };
    const rowDeps = { storage: deps.storage, config: deps.config };
    const caller = rowCallerOf(ctx);
    try {
        // A program reading back what it wrote is not a person: the classification check reads it as
        // the node reads an extension's caller, which is the strictest non-anonymous reader.
        const reader = readerForCaller(rowDeps, { gaii: ctx.principal, owner: ctx.owner, roles: ['receiver'], scopes: [] });
        if (verb === 'read') {
            const res = await readRows(rowDeps, caller, { organismId: t.organismId, wsId: t.ws, space: t.space, reader, limit: 200, order: 'desc' });
            const own = res.rows.filter(row => (row as { createdBy?: string }).createdBy === ctx.principal);
            const one = rq.sub ? own.filter(row => (row as { rowId?: string }).rowId === rq.sub) : own;
            if (rq.sub && !one.length) throw new ReceiverError(404, 'NOT_FOUND', 'This receiver wrote no row with that id.');
            return { status: 200, data: { space: t.space, rows: one } };
        }
        if (verb === 'delete') {
            if (!rq.sub) throw new ReceiverError(400, 'SUB_REQUIRED', 'Name the row to delete: <address>/<row id>.');
            const res = await readRows(rowDeps, caller, { organismId: t.organismId, wsId: t.ws, space: t.space, reader, limit: 200, order: 'desc' });
            const mine = res.rows.some(row => (row as { rowId?: string; createdBy?: string }).rowId === rq.sub && (row as { createdBy?: string }).createdBy === ctx.principal);
            if (!mine) throw new ReceiverError(404, 'NOT_FOUND', 'This receiver wrote no row with that id.');
            if (rq.dryRun) return { status: 200, data: { dry_run: true, would_delete: rq.sub } };
            await deleteRow(rowDeps, caller, t.organismId, t.ws, t.space, rq.sub);
            return { status: 200, data: { row_id: rq.sub, deleted: true } };
        }
        if (verb === 'merge') throw new ReceiverError(405, 'METHOD_NOT_ALLOWED', 'A row is written whole: use POST or PUT.');

        const body = rq.body as Record<string, unknown> | null;
        const many = !!body && typeof body === 'object' && !Array.isArray(body) && Array.isArray((body as { rows?: unknown }).rows);
        const rows = many
            ? ((body as { rows: Array<Record<string, unknown>> }).rows).map(x => ({ rowId: x.row_id ?? x.rowId, occurredAt: x.occurred_at ?? x.occurredAt, body: x.body }))
            : [{ rowId: rq.sub ?? (rq.idempotencyKey ? rowIdOf(rq.idempotencyKey) : undefined), occurredAt: undefined, body: rq.body }];
        if (!rows.length || rows.length > 500) throw new ReceiverError(400, 'INVALID_INPUT', 'Send one row, or { "rows": [...] } with 1 to 500 rows.');
        rows.forEach((row, i) => checkShape(ctx, row.body, many ? i : undefined));
        if (rq.dryRun) return { status: 200, data: { dry_run: true, rows: rows.length } };
        const out = await appendRows(rowDeps, caller, { organismId: t.organismId, wsId: t.ws, space: t.space, rows });
        return { status: 201, data: { space: t.space, written: out.written, row_ids: out.rowIds, receiver: `${ctx.owner}/${ctx.name}` } };
    } catch (err) {
        if (err instanceof ReceiverError) throw err;
        return rowError(err);
    }
}
