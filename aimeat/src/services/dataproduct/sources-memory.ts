/**
 * @file src/services/dataproduct/sources-memory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data product sources that read memory: a workspace records space, an app's data and
 *   one memory key (plan doc-mvwxcas3dom3, D9.1). Each reads through the check its direct read uses, as
 *   the caller, so a product reaches nothing its definer could not read.
 *
 *   records    The workspace read aimeat_workspace_read runs (services/workspace-tool-ops.ts
 *              readWorkspaceOp): membership, the organism's agent rule and the classification reader.
 *              Each PUBLISHED record of the space is a row; a draft is not data yet. The space's locked
 *              JSON Schema gives the column types. The product's audience is at most the organism, and
 *              private when the workspace admits only some members and the caller does not decide who
 *              reads it (recordsAudienceCap).
 *   app        The owner's own app: the records under `key_prefix` that a row of the app's data map
 *              marks `publishable: true`. A row without that mark is not offered, and a row that marks
 *              its data personal makes every column of it personal.
 *   memory     One key and the array at `rows_at`, as the workflow datapackage step reads it. The
 *              owner's own records through the owner-scope view (an agent reads a private record of its
 *              owner only with memory:read-as-owner); another account's record through authorizeRead,
 *              the guard GET /v1/pub uses.
 * @structure recordsAudienceCap · readRecordsSource · readAppSource · readMemorySource · familyMatches · descriptionsOfJson
 * @usage const src = await readMemorySource(call);
 * @version-history
 *   v1.4.0 — 2026-11-08 — A memory source and an app source name the label address of every record they
 *     copied, as a records source does (secaudit2026nov08b round 15,
 *     dataproduct/sources-io:derived-product-drops-upstream-version-label-source).
 *   v1.3.0 — 2026-11-08 — A records source names the label address of every record it copied
 *     (labelSources), so the version keeps the strictest of their labels and a reader the label keeps
 *     out reads no row of it (secaudit2026nov08 round 14,
 *     dataproduct/sources-memory:records-source-drops-source-record-labels).
 *   v1.2.0 — 2026-11-02 — A records source's audience is the organism only when the caller decides the
 *     workspace's readers or the workspace admits every member; private otherwise (secaudit2026nov02d
 *     round 13, dataproduct:records-source:audience-capped-at-organism-not-workspace).
 *   v1.1.0 — 2026-11-01 — A records space's locked schema describes its columns (descriptionsOfJson; WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9.1).
 */
import type { MemoryRecord, ContentLabelTarget } from '../../storage/interface.js';
import type { FieldType } from '../datapackage/contract.js';
import { readWorkspaceOp } from '../workspace-tool-ops.js';
import { workspaceCallerOf, type WorkspaceOpsCaller } from '../workspace-ops-caller.js';
import { readWorkspaceMetaRecord } from '../workspace-meta.js';
import { isSameOwner } from '../../utils/gaii.js';
import { readerFor } from '../classification/reader.js';
import { memoryTarget } from '../classification/labels.js';
import { listOwnerScopeMemory, getOwnerScopeMemory } from '../owner-memory.js';
import { ownerScopeView, readsAsOwner, READ_AS_OWNER_SCOPE } from '../owner-scope-read.js';
import { authorizeRead } from '../access-guard.js';
import { appDataMapKey, DATA_MAP_SPEC, type DataMap, type DataMapRow } from '../data-map/data-map-types.js';
import { atPath } from '../workflow/engine-step-rows.js';
import {
    type ResolvedSource, type SourceCall, sourceError, needWord, shapeRows, tableOf, audienceOfStored, narrowest,
} from './source-common.js';

const now = () => new Date().toISOString();

/** A JSON Schema property's type as a Table Schema field type. */
export function fieldTypeOfJson(p: unknown): FieldType | undefined {
    const prop = (p ?? {}) as { type?: unknown; format?: unknown };
    const t = Array.isArray(prop.type) ? prop.type.find(x => x !== 'null') : prop.type;
    if (t === 'integer') return 'integer';
    if (t === 'number') return 'number';
    if (t === 'boolean') return 'boolean';
    if (t === 'string') return prop.format === 'date' ? 'date' : prop.format === 'date-time' ? 'datetime' : 'string';
    if (t === 'array' || t === 'object') return 'string';
    return undefined;
}

/** What a JSON Schema's properties say each column is: `description`, else `title`, one line each. */
export function descriptionsOfJson(properties: Record<string, unknown> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, p] of Object.entries(properties ?? {})) {
        const prop = (p ?? {}) as { description?: unknown; title?: unknown };
        const words = typeof prop.description === 'string' && prop.description.trim() ? prop.description
            : typeof prop.title === 'string' && prop.title.trim() ? prop.title : '';
        if (words) out[name] = words.replace(/\s+/g, ' ').trim().slice(0, 500);
    }
    return out;
}

/**
 * The widest audience a product built from workspace `ws` of `organismId` may have, for this caller.
 * The organism, when the caller decides who reads the workspace (an organism creator or admin, or the
 * workspace's creator and that person's agents) or when the workspace admits every member of the
 * organism (its manifest is organism, members or public). Private otherwise: a viewer or contributor
 * of a restricted workspace builds a product its readers alone may read.
 */
async function recordsAudienceCap(call: SourceCall, wsCaller: WorkspaceOpsCaller, organismId: string, ws: string): Promise<string> {
    const { storage, config } = call.deps;
    const organism = `organism:${organismId}`;
    const membership = await storage.getMembership(organismId, wsCaller.ownerName);
    if (membership?.status === 'active' && (membership.role === 'creator' || membership.role === 'admin')) return organism;
    const manRec = await readWorkspaceMetaRecord(storage, organismId, ws, 'meta.manifest', config.nodeId);
    if (!manRec) return 'private';
    if (manRec.ownerGaii === wsCaller.ownerGhii || isSameOwner(manRec.ownerGaii, wsCaller.ownerGhii)) return organism;
    const v = manRec.visibility as string | undefined;
    return v === 'public' || v === 'members' || v === organism ? organism : 'private';
}

/** A workspace records space: each published record is a row. */
export async function readRecordsSource(call: SourceCall): Promise<ResolvedSource> {
    const { deps, caller, spec } = call;
    needWord(call, 'organism:read');
    const wsCaller = workspaceCallerOf({ principal: caller.principal, ownerName: caller.owner, roles: [...caller.roles], scopes: caller.scopes }, deps.config);
    const organismId = spec.organism_id!; const ws = spec.ws!;
    const index = await readWorkspaceOp(deps, wsCaller, { organismId, ws, reader: readerFor(deps, caller.auth) });
    if (!index.ok) throw sourceError(spec, index.code, index.message, index.status);
    const data = index.data as {
        manifest?: { objectTypes?: Array<{ name: string; namespace?: string; mode?: string; kind?: string; backing?: string }> };
        index?: Record<string, Array<{ id: string; published: boolean }>>; schemas?: Record<string, Record<string, unknown>>;
    };
    const ot = (data.manifest?.objectTypes ?? []).find(o => o.name === spec.space || o.namespace === spec.space);
    if (!ot) throw sourceError(spec, 'NOT_FOUND', `the workspace has no space "${spec.space}".`, 404);
    if (ot.mode === 'document' || (!ot.mode && ot.kind === 'document')) throw sourceError(spec, 'INVALID_INPUT', `"${spec.space}" is a document space; a records source reads a records space.`);
    if (ot.backing === 'rows') throw sourceError(spec, 'INVALID_INPUT', `"${spec.space}" keeps its rows in the workspace row store, which a records source does not read; publish those rows with a memory or an extension source instead.`);
    const ids = (data.index?.[ot.name] ?? []).filter(e => e.published).map(e => e.id).sort();
    const rows: Array<Record<string, unknown>> = [];
    // Each copied record's label address: the version keeps the strictest of their labels.
    const labelSources: ContentLabelTarget[] = [];
    for (let i = 0; i < ids.length; i += 200) {
        const got = await readWorkspaceOp(deps, wsCaller, { organismId, ws, ids: ids.slice(i, i + 200), space: ot.name, reader: readerFor(deps, caller.auth) });
        if (!got.ok) throw sourceError(spec, got.code, got.message, got.status);
        for (const item of ((got.data as { items?: Array<{ id: string; value: unknown }> }).items ?? [])) {
            rows.push(item.value && typeof item.value === 'object' ? { id: item.id, ...(item.value as Record<string, unknown>) } : { id: item.id, value: item.value });
            labelSources.push(memoryTarget(caller.ownerGhii, `organism.${organismId}.w.${ws}.${ot.namespace ?? ''}.${item.id}`));
        }
    }
    // The lock on the space: `<namespace>` or `<namespace>.*`, whichever the workspace wrote.
    const ns = ot.namespace ?? '';
    const schema = Object.entries(data.schemas ?? {}).find(([k]) => k === ns || k.startsWith(`${ns}.`))?.[1] as { properties?: Record<string, unknown> } | undefined;
    const types: Record<string, FieldType | undefined> = {};
    const order: string[] = [];
    for (const [name, p] of Object.entries(schema?.properties ?? {})) { types[name] = fieldTypeOfJson(p); order.push(name); }
    const table = tableOf(spec.id, shapeRows(rows, spec.columns), types, new Set(), spec.columns ? [] : order);
    return {
        ...table, descriptions: descriptionsOfJson(schema?.properties), audience: await recordsAudienceCap(call, wsCaller, organismId, ws), fetchedAt: now(), labelSources,
        provenance: { kind: 'records', address: `organism:${organismId}/${ws}/${ot.name}`, title: `${ot.name} records` },
    };
}

/**
 * Does a key belong to a data map family? `news.<date>.*`, `items.{id}`, `crm.*` and a plain prefix
 * (`items` covers `items` and `items.x`) are the forms a map writes.
 */
export function familyMatches(what: string, key: string): boolean {
    const family = (what ?? '').trim().split(/\s+/)[0] ?? '';
    if (!family) return false;
    if (!/[*<{]/.test(family)) return key === family || key.startsWith(`${family}.`);
    const re = family.split(/(\*+|<[^>]*>|\{[^}]*\})/).map(part => {
        if (/^\*+$/.test(part)) return '.*';
        if (/^<[^>]*>$|^\{[^}]*\}$/.test(part)) return '[^.]+';
        return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return new RegExp(`^${re}(\\..*)?$`).test(key);
}

/** The records a same-owner caller may read, refused by name when one is hidden from it. */
function visibleOrRefuse(call: SourceCall, records: MemoryRecord[]): MemoryRecord[] {
    const all = call.caller.inPerson || readsAsOwner(call.caller);
    const shown = ownerScopeView(records, call.caller.principal, all);
    if (shown.length < records.length) {
        const hidden = records.find(r => !shown.includes(r))!;
        throw sourceError(call.spec, 'SCOPE_DENIED', `"${hidden.key}" is a record the owner or another of their agents keeps ${hidden.visibility}. `
            + `Reading it needs the "${READ_AS_OWNER_SCOPE}" permission, which the owner grants per agent.`, 403);
    }
    return shown;
}

/** Rows out of one record value: the array at rows_at, an array value, or the value as one row. */
function rowsOfValue(call: SourceCall, rec: MemoryRecord): unknown[] {
    const { spec } = call;
    if (spec.rows_at) {
        const found = atPath(rec.value, spec.rows_at);
        if (!Array.isArray(found)) throw sourceError(spec, 'NOT_ROWS', `"${rec.key}" has no array at "${spec.rows_at}". A producer usually answers with an envelope, so name the path to the table inside it.`);
        return found;
    }
    return Array.isArray(rec.value) ? rec.value : [rec.value];
}

/** The classification check an export makes: content whose label may not leave stays, and the build stops. */
async function mayLeave(call: SourceCall, records: MemoryRecord[], exporting: boolean): Promise<void> {
    if (!exporting || !records.length) return;
    const { left } = await readerFor(call.deps, call.caller.auth).leave(records, r => memoryTarget(r.ownerGaii, r.key), { kind: 'export', organismId: null });
    if (left.length) throw sourceError(call.spec, 'CLASSIFIED', `"${left[0]!.item.key}" is ${left[0]!.reason}, so it is not published.`, 403);
}

/** An app's data, limited to the families its data map marks publishable. */
export async function readAppSource(call: SourceCall, exporting: boolean): Promise<ResolvedSource> {
    const { deps, caller, spec } = call;
    needWord(call, 'memory:read');
    const [appOwner, file] = spec.app!.includes('/') ? spec.app!.split('/', 2) : [caller.owner, spec.app!];
    if (appOwner !== caller.owner) throw sourceError(spec, 'FORBIDDEN', 'an app source reads one of your own apps.', 403);
    const appId = file!.replace(/\.html$/i, '');
    const mapRec = await deps.storage.getMemory(caller.ownerGhii, appDataMapKey(appId));
    const map = mapRec?.value as DataMap | undefined;
    if (!map || map.spec !== DATA_MAP_SPEC || !Array.isArray(map.held)) {
        throw sourceError(spec, 'NO_DATA_MAP', `the app "${appId}" has no data map, so nothing of it is marked publishable. Mark the families it may publish with "publishable": true (aimeat_datamap_set).`, 404);
    }
    const publishable = map.held.filter((r: DataMapRow) => r.publishable === true);
    if (!publishable.length) {
        throw sourceError(spec, 'NOT_PUBLISHABLE', `no row of the data map of "${appId}" is marked "publishable": true. A row without the mark is not offered as material.`);
    }
    const listed = await listOwnerScopeMemory(deps.storage, deps.config.nodeId, caller.owner, { prefix: spec.key_prefix });
    const records = listed.filter(r => r.key.startsWith(spec.key_prefix!) && publishable.some(p => familyMatches(p.what, r.key)))
        .sort((a, b) => a.key.localeCompare(b.key));
    if (!records.length) {
        throw sourceError(spec, 'NOT_PUBLISHABLE', `nothing under "${spec.key_prefix}" is in a family the data map marks publishable. Those families: ${publishable.map(p => p.what).join(', ')}.`);
    }
    // The classification reader: a record this caller may not see answers as an absent one.
    const shown = await readerFor(deps, caller.auth).show(visibleOrRefuse(call, records), r => memoryTarget(r.ownerGaii, r.key));
    if (!shown.length) throw sourceError(spec, 'NOT_FOUND', `nothing under "${spec.key_prefix}" is there for you to read.`, 404);
    await mayLeave(call, shown, exporting);
    const personalFamily = publishable.some(p => (p.personalData === 'yes' || (Array.isArray(p.domains) && p.domains.length > 0))
        && shown.some(r => familyMatches(p.what, r.key)));
    const rows = shapeRows(shown.flatMap(r => rowsOfValue(call, r)), spec.columns);
    const table = tableOf(spec.id, rows);
    return {
        ...table, personal: personalFamily ? new Set(table.columns) : new Set(),
        audience: narrowest(shown.map(r => audienceOfStored(r.visibility))), fetchedAt: now(),
        labelSources: shown.map(r => memoryTarget(r.ownerGaii, r.key)),
        provenance: { kind: 'app', address: `${caller.owner}/${appId}:${spec.key_prefix}` },
    };
}

/** One memory key, the array at rows_at. */
export async function readMemorySource(call: SourceCall, exporting: boolean): Promise<ResolvedSource> {
    const { deps, caller, spec } = call;
    needWord(call, 'memory:read');
    const key = spec.key!;
    let rec: MemoryRecord | null;
    const foreign = spec.owner && spec.owner !== caller.owner && spec.owner !== caller.ownerGhii;
    if (foreign) {
        const ownerGaii = spec.owner!.includes('@') ? spec.owner! : `${spec.owner}@${deps.config.nodeId}`;
        rec = await deps.storage.getMemory(ownerGaii, key);
        const decision = rec ? await authorizeRead(deps.storage, deps.config, {
            ownerGaii, accessorGaii: caller.principal, resourceKey: key, visibility: rec.visibility,
            ...(rec.groupId ? { groupId: rec.groupId } : {}), ...(rec.workspaceRef ? { workspaceRef: rec.workspaceRef } : {}),
            accessorSub: caller.auth.sub, accessorOwner: caller.owner, action: 'read',
        }) : { allowed: false };
        // A record another account keeps from this caller answers as one that is not there would not:
        // the refusal says it may not be read, whether or not it exists.
        if (!rec || !decision.allowed) throw sourceError(spec, 'FORBIDDEN', `you may not read "${key}" of ${spec.owner}.`, 403);
    } else {
        rec = await getOwnerScopeMemory(deps.storage, deps.config.nodeId, caller.owner, key);
        if (!rec) throw sourceError(spec, 'NOT_FOUND', `there is no value at "${key}".`, 404);
        visibleOrRefuse(call, [rec]);
    }
    const [shown] = await readerFor(deps, caller.auth).show([rec], r => memoryTarget(r.ownerGaii, r.key));
    if (!shown) throw sourceError(spec, 'NOT_FOUND', `there is no value at "${key}".`, 404);
    await mayLeave(call, [rec], exporting);
    const table = tableOf(spec.id, shapeRows(rowsOfValue(call, rec), spec.columns));
    return {
        // The record's label travels with the copy, as a records source's do.
        ...table, audience: audienceOfStored(rec.visibility), fetchedAt: now(), labelSources: [memoryTarget(rec.ownerGaii, rec.key)],
        provenance: { kind: 'memory', address: `${rec.ownerGaii}:${key}${spec.rows_at ? `#${spec.rows_at}` : ''}` },
    };
}
