/**
 * @file src/services/dataproduct/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data product capability, once, for every surface: define, get, list, delete,
 *   preview and run (plan doc-mvwxcas3dom3, D9). The REST routes in routes/dataproducts.ts and the MCP
 *   tool aimeat_dataproduct both call these functions and only render the answer.
 *
 *   WHO. The owner in person, or a principal of the owner (agent, app grant, ecosystem app) holding the
 *   words: storage:read to read a definition and to preview, storage:write and memory:write to define,
 *   run or delete one (the words a publish asks). Every source asks its own word as well, the one its
 *   direct read asks (./source-common.ts needWord). A visitor from another node and the shared
 *   anonymous principal are refused. A definition is read from the caller's own account only, so one
 *   account never reads, runs or deletes another's: such a name answers NOT_FOUND.
 *
 *   A DEFINITION IS CHECKED WHEN IT IS DEFINED. `define` reads every source as the caller before it
 *   stores anything, so a source the caller may not read, a mapping that names a missing column and an
 *   audience wider than a source are refused at once, not at the first scheduled run.
 *
 *   THE SCHEDULE BELONGS TO THE DEFINITION. `schedule: { cron }` makes one schedule of kind
 *   `dataproduct` (services/schedule-write.ts createScheduleRecord, as the caller, so it fires as its
 *   maker); a changed schedule replaces it, `schedule: null` removes it, and deleting the definition
 *   removes every `dataproduct` schedule naming it, whoever made it. A schedule that outlived what it
 *   acts for is the defect of the open incident "Deleting an agent leaves its schedule enabled".
 *
 *   EVERY RUN IS RECORDED on the definition as `lastRun`: when, whether it published, the version, the
 *   row counts, and for a failure the error and the source it came from. A failed run also goes on the
 *   package's pointer when the package exists (services/datapackage/store.ts recordFailure), so a
 *   consumer following the newest version sees that the newest attempt failed.
 * @structure DataProductCtx · DataProductAnswer · defineProduct · getProduct · listProducts · deleteProduct
 *   · previewProductAnswer · runStored
 * @usage
 *   const out = await defineProduct(ctx, name, body);
 *   if (!out.ok) return render(out.status, out.code, out.message);
 * @version-history
 *   v1.1.0 — 2026-11-01 — The list carries each product's package, freshness, live shares, reads in the
 *     last seven days, next run and a short label of each source (./list-facts.ts; WP9a, the Offers page),
 *     and the node's data intermediation mode, which a sale on EXCHANGE is subject to (plan D7.1).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import type { ScheduledJobRecord } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { emitChange } from '../event-bus.js';
import { createScheduleRecord, type ScheduleWriteCaller } from '../schedule-write.js';
import { getActiveScheduler } from '../scheduler.js';
import { recordFailure } from '../datapackage/store.js';
import { readPointer } from '../datapackage/version-audience.js';
import { logger } from '../../utils/logger.js';
import {
    DataProductError, normaliseDefinition, dataProductKey, asDefinition, sourceLabel, DATAPRODUCT_KEY_PREFIX,
    type DataProductDefinition, type LastRun,
} from './definition.js';
import { productListFacts } from './list-facts.js';
import { intermediationMode } from '../data-intermediation/gate.js';
import { prepareBuild, previewProduct, runProduct, type BuildContext, type RunOutcome } from './build.js';
import { DATAPRODUCT_SCHEDULE_KIND } from './schedule-input.js';
import type { SourceDeps } from './source-common.js';

export interface DataProductCtx {
    deps: SourceDeps;
    caller: CallerContext;
    /** `req.auth.app` of an app grant, for the publish gate. */
    app?: string;
    /** `req.auth.app_grant`, so an app's schedule fires as that app. */
    appGrant?: string;
    /** The schedule that fired a run. */
    schedule?: string;
}

export type DataProductAnswer<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; source?: string };

const READ_WORDS = ['storage:read'] as const;
const WRITE_WORDS = ['storage:write', 'memory:write'] as const;

function refusal(e: unknown): { ok: false; status: number; code: string; message: string; source?: string } {
    if (e instanceof DataProductError) return { ok: false, status: e.status, code: e.code, message: e.message, ...(e.source ? { source: e.source } : {}) };
    throw e;
}

/** Who may do this: a node account of its own, holding the words. */
function callerRefusal(caller: CallerContext, words: readonly string[]): { ok: false; status: number; code: string; message: string } | null {
    if (caller.kind === 'anonymous') return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: 'A data product belongs to an account: sign in.' };
    if (caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'A session from another node does not define or run data products here.' };
    const missing = words.filter(w => !caller.has(w));
    if (missing.length) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED', message: `This needs the ${missing.map(w => `"${w}"`).join(' and ')} permission${missing.length > 1 ? 's' : ''}. Ask the owner to grant ${missing.length > 1 ? 'them' : 'it'}.` };
    }
    return null;
}

async function readDefinition(ctx: DataProductCtx, name: string): Promise<DataProductDefinition | null> {
    const rec = await ctx.deps.storage.getMemory(ctx.caller.ownerGhii, dataProductKey(name));
    return asDefinition(rec?.value);
}

const notFound = (name: string) => ({ ok: false as const, status: 404, code: 'NOT_FOUND', message: `You have no data product "${name}". aimeat_dataproduct action "list" lists yours.` });

/** The schedules of kind dataproduct that build this product. */
async function schedulesOf(ctx: DataProductCtx, name: string): Promise<ScheduledJobRecord[]> {
    const jobs = await ctx.deps.storage.listScheduledJobs({ ownerScope: ctx.caller.ownerGhii, type: DATAPRODUCT_SCHEDULE_KIND });
    return jobs.filter(j => (j.input as { name?: unknown } | undefined)?.name === name);
}

/**
 * Remove a schedule that builds this product, whoever made it. Not deleteScheduleRecord: that asks
 * whether the caller may manage the schedule, and an agent may not manage one its owner made, which
 * would leave the owner's schedule firing at a product that no longer exists.
 */
async function removeSchedule(ctx: DataProductCtx, job: ScheduledJobRecord): Promise<void> {
    getActiveScheduler()?.removeJob(job.id);
    await ctx.deps.storage.deleteScheduledJob(job.id);
    emitChange('scheduler');
}

function scheduleCallerOf(ctx: DataProductCtx): ScheduleWriteCaller {
    const c = ctx.caller;
    return {
        owner: c.owner, identity: c.principal, isOwnerSession: c.inPerson, scopes: [...c.scopes], roles: [...c.roles],
        ...(ctx.appGrant ? { appGrant: ctx.appGrant } : {}), isApp: c.kind === 'app', isEcosystem: c.kind === 'ecosystem',
    };
}

/** Make the stored schedules match the definition: keep a matching one of this maker, replace the rest. */
async function syncSchedule(ctx: DataProductCtx, def: DataProductDefinition): Promise<{ schedule: ScheduledJobRecord | null } | { ok: false; status: number; code: string; message: string }> {
    const existing = await schedulesOf(ctx, def.name);
    const want = def.schedule ?? null;
    const keep = want ? existing.find(j => j.cron === want.cron && (j.timezone ?? undefined) === want.timezone && j.createdBy === ctx.caller.principal) : undefined;
    for (const j of existing) if (j !== keep) await removeSchedule(ctx, j);
    if (!want || keep) return { schedule: keep ?? null };
    const made = await createScheduleRecord({ storage: ctx.deps.storage, config: ctx.deps.config }, scheduleCallerOf(ctx), {
        kind: DATAPRODUCT_SCHEDULE_KIND, cron: want.cron, ...(want.timezone ? { timezone: want.timezone } : {}),
        input: { name: def.name }, display_name: `Data product ${def.title ?? def.name}`,
        purpose: `Builds a new version of the data package ${def.name} from its sources.`,
    });
    if (!made.ok) return { ok: false, status: made.status, code: made.code, message: `The definition is stored, and its schedule was not made: ${made.message}` };
    return { schedule: made.schedule };
}

const scheduleView = (j: ScheduledJobRecord | null) => (j ? { id: j.id, cron: j.cron, ...(j.timezone ? { timezone: j.timezone } : {}), enabled: j.enabled, next_run_at: j.nextRunAt ?? null } : null);

/** Store a definition, after reading every source as the caller. */
export async function defineProduct(ctx: DataProductCtx, name: string, body: Record<string, unknown>): Promise<DataProductAnswer<Record<string, unknown>>> {
    const who = callerRefusal(ctx.caller, WRITE_WORDS);
    if (who) return who;
    const norm = normaliseDefinition(name, body);
    if (!norm.ok) return { ok: false, status: 400, code: norm.code, message: norm.message };
    const now = new Date().toISOString();
    const previous = await readDefinition(ctx, name);
    const draft: DataProductDefinition = {
        ...norm.definition, definedBy: ctx.caller.principal, createdAt: previous?.createdAt ?? now, updatedAt: now,
        ...(previous?.lastRun ? { lastRun: previous.lastRun } : {}),
    };
    // Every source read as the caller, before anything is stored. A refusal of the audience or of a
    // personal column is the definition's own error, so it is refused here too.
    try {
        const prepared = await prepareBuild(buildCtx(ctx), draft);
        if (prepared.refusal) throw prepared.refusal;
    } catch (e) { return refusal(e); }
    const stored = await updateRecord<DataProductDefinition>(ctx.deps.storage, ctx.caller.ownerGhii, dataProductKey(name),
        v => asDefinition(v) as DataProductDefinition, () => draft, { tag: 'dataproduct' });
    emitChange('memory', ctx.caller.ownerGhii);
    const synced = await syncSchedule(ctx, stored);
    if ('ok' in synced) return synced;
    return { ok: true, data: { definition: stored, created: !previous, schedule: scheduleView(synced.schedule) } };
}

function buildCtx(ctx: DataProductCtx): BuildContext {
    return { deps: ctx.deps, caller: ctx.caller, ...(ctx.app ? { app: ctx.app } : {}), ...(ctx.schedule ? { schedule: ctx.schedule } : {}) };
}

/** One definition, with its schedule and the package it builds. */
export async function getProduct(ctx: DataProductCtx, name: string): Promise<DataProductAnswer<Record<string, unknown>>> {
    const who = callerRefusal(ctx.caller, READ_WORDS);
    if (who) return who;
    const def = await readDefinition(ctx, name);
    if (!def) return notFound(name);
    const [job] = await schedulesOf(ctx, name);
    const pointer = await readPointer(ctx.deps, ctx.caller.ownerGhii, name);
    return { ok: true, data: { definition: def, schedule: scheduleView(job ?? null), package: pointer ? { package_id: pointer.packageId, content_hash: pointer.contentHash || null, updated_at: pointer.updatedAt, visibility: pointer.visibility ?? 'public', ...(pointer.lastError ? { last_error: pointer.lastError } : {}) } : null } };
}

/** The caller's own definitions, newest first. */
export async function listProducts(ctx: DataProductCtx): Promise<DataProductAnswer<Record<string, unknown>>> {
    const who = callerRefusal(ctx.caller, READ_WORDS);
    if (who) return who;
    const items = await ctx.deps.storage.listMemory(ctx.caller.ownerGhii, { prefix: DATAPRODUCT_KEY_PREFIX });
    const defs = items.map(r => asDefinition(r.value)).filter((d): d is DataProductDefinition => !!d)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Each row's package, freshness, live shares and reads, so the list answers "what do I offer,
    // is any of it stale, who reads it" without a second call per product.
    const facts = await productListFacts(ctx.deps, ctx.caller.ownerGhii, defs.map(d => d.name));
    const jobs = await ctx.deps.storage.listScheduledJobs({ ownerScope: ctx.caller.ownerGhii, type: DATAPRODUCT_SCHEDULE_KIND });
    const nextRunOf = (name: string) => jobs.find(j => (j.input as { name?: unknown } | undefined)?.name === name)?.nextRunAt ?? null;
    return { ok: true, data: { products: defs.map(d => ({
        name: d.name, title: d.title ?? null, visibility: d.visibility, sources: d.sources.map(s => ({ id: s.id, kind: s.kind, ...sourceLabel(s) })),
        combine: d.combine.mode, schedule: d.schedule ?? null, next_run_at: nextRunOf(d.name), last_run: d.lastRun ?? null, updated_at: d.updatedAt,
        ...(facts.get(d.name) ?? { package: null, freshness: null, shares: 0, reads_7d: 0 }),
    })), total: defs.length, data_intermediation: intermediationMode(ctx.deps.config) } };
}

/** Delete a definition and every schedule that builds it. The package and its versions stay. */
export async function deleteProduct(ctx: DataProductCtx, name: string): Promise<DataProductAnswer<Record<string, unknown>>> {
    const who = callerRefusal(ctx.caller, WRITE_WORDS);
    if (who) return who;
    const def = await readDefinition(ctx, name);
    if (!def) return notFound(name);
    const jobs = await schedulesOf(ctx, name);
    for (const j of jobs) await removeSchedule(ctx, j);
    await ctx.deps.storage.deleteMemory(ctx.caller.ownerGhii, dataProductKey(name), ctx.caller.principal);
    emitChange('memory', ctx.caller.ownerGhii);
    return { ok: true, data: { name, deleted: true, schedules_removed: jobs.map(j => j.id), package_kept: !!(await readPointer(ctx.deps, ctx.caller.ownerGhii, name)) } };
}

/** Preview a stored definition, or a draft body that is not stored yet. Publishes nothing. */
export async function previewProductAnswer(ctx: DataProductCtx, name: string, draftBody?: Record<string, unknown>): Promise<DataProductAnswer<Record<string, unknown>>> {
    const who = callerRefusal(ctx.caller, READ_WORDS);
    if (who) return who;
    let def: DataProductDefinition | null;
    if (draftBody && Array.isArray(draftBody.sources)) {
        const norm = normaliseDefinition(name, draftBody);
        if (!norm.ok) return { ok: false, status: 400, code: norm.code, message: norm.message };
        const now = new Date().toISOString();
        def = { ...norm.definition, definedBy: ctx.caller.principal, createdAt: now, updatedAt: now };
    } else {
        def = await readDefinition(ctx, name);
        if (!def) return notFound(name);
    }
    try {
        return { ok: true, data: await previewProduct(buildCtx(ctx), def) };
    } catch (e) { return refusal(e); }
}

/** Record a run on the definition, on its version, so a concurrent define is not lost. */
async function recordRun(ctx: DataProductCtx, name: string, run: LastRun): Promise<void> {
    await updateRecord(ctx.deps.storage, ctx.caller.ownerGhii, dataProductKey(name), v => asDefinition(v),
        cur => (cur ? { ...cur, lastRun: run } : UNCHANGED), { tag: 'dataproduct' });
}

/** Build and publish one version of a stored definition. */
export async function runStored(ctx: DataProductCtx, name: string): Promise<DataProductAnswer<RunOutcome & { last_run: LastRun }>> {
    const who = callerRefusal(ctx.caller, WRITE_WORDS);
    if (who) return who;
    const def = await readDefinition(ctx, name);
    if (!def) return notFound(name);
    const at = new Date().toISOString();
    try {
        const out = await runProduct(buildCtx(ctx), def);
        const run: LastRun = { at, ok: true, version: out.content_hash, unchanged: out.unchanged, rows: out.rows, sources: out.sources,
            ...(out.publish_request ? { publish_request: out.publish_request } : {}) };
        await recordRun(ctx, name, run);
        return { ok: true, data: { ...out, last_run: run } };
    } catch (e) {
        if (!(e instanceof DataProductError)) throw e;
        const run: LastRun = { at, ok: false, error: e.message, ...(e.source ? { source: e.source } : {}) };
        await recordRun(ctx, name, run);
        // The package's own pointer says the newest attempt failed, when the package exists already.
        if (await readPointer(ctx.deps, ctx.caller.ownerGhii, name)) {
            await recordFailure(ctx.deps, ctx.caller.ownerGhii, name, e.message)
                .catch(err => logger.warn('dataproduct: the failure could not be recorded on the package pointer', { name, error: String(err) }));
        }
        return refusal(e);
    }
}
