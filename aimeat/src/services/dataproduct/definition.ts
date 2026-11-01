/**
 * @file src/services/dataproduct/definition.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data product definition: how to build a data package version from material the
 *   owner already holds. One memory record of the owner per product, key `dataproducts.<name>`, the
 *   name being the package name. This file is the shape and its validation, and nothing else: no
 *   storage, no clock, so a unit test can assert what is accepted and what is refused.
 *
 *   SIX SOURCE KINDS (plan doc-mvwxcas3dom3, D9.1): `records` (a workspace records space), `app` (an
 *   app's data, the rows its data map marks publishable), `memory` (one memory key, `rows_at` into it),
 *   `extension` (an extension action the node runs), `file` (a stored CSV or XLSX) and `datapackage`
 *   (another data package). THREE WAYS TO COMBINE them (D9.9): `tables` (each source its own resource),
 *   `union` (rows appended, the columns must match) and `join` (a left join of the first source with
 *   the others on a key).
 *
 *   THE AUDIENCE DEFAULTS TO PRIVATE. A data package published by hand defaults to public; a product
 *   built from somebody's records, memory and files does not, because the sources it reads are mostly
 *   private and the build refuses an audience wider than its narrowest source anyway.
 * @structure DATAPRODUCT_SPEC · DataProductDefinition · SourceSpec · normaliseDefinition · dataProductKey
 *   · DataProductError · SOURCE_KINDS · COMBINE_MODES · FILTER_OPS · sourceLabel
 * @usage
 *   const out = normaliseDefinition(name, body);
 *   if (!out.ok) return refuse(out.code, out.message);
 * @version-history
 *   v1.1.0 — 2026-11-01 — `retention` { keep, unit }: how many earlier versions a run keeps (the
 *     package's retention policy); sourceLabel, a source in a few words for a list row (WP9a).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9).
 */
import type { FieldType } from '../datapackage/contract.js';
import { validateName } from '../datapackage/contract.js';
import { parseAudience } from '../audience.js';

export const DATAPRODUCT_SPEC = 'aimeat.dataproduct/1' as const;
export const DATAPRODUCT_KEY_PREFIX = 'dataproducts.';
export const SOURCE_KINDS = ['records', 'app', 'memory', 'extension', 'file', 'datapackage'] as const;
export const COMBINE_MODES = ['tables', 'union', 'join'] as const;
export const FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] as const;
const FIELD_TYPES: readonly FieldType[] = ['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'any'];

export type SourceKind = typeof SOURCE_KINDS[number];
export type CombineMode = typeof COMBINE_MODES[number];
export type FilterOp = typeof FILTER_OPS[number];

/** The memory key of one product's definition. */
export const dataProductKey = (name: string): string => `${DATAPRODUCT_KEY_PREFIX}${name}`;

/**
 * Which columns a source hands on, before the product's own column mapping: a list of names to keep,
 * or a map of column name to a dotted path into each row (the workflow datapackage step's `columns`).
 */
export type SourceColumns = string[] | Record<string, string>;

export interface SourceSpec {
    /** A, B, C ...: the name the column mapping, the join key and `tables` resources use. */
    id: string;
    kind: SourceKind;
    /** records: the organism, workspace and records space. */
    organism_id?: string; ws?: string; space?: string;
    /** app: the owner's app (filename, with or without .html) and the key prefix of its data. */
    app?: string; key_prefix?: string;
    /** memory: the key, and the owner when it is another account's record. */
    key?: string; owner?: string;
    /** memory, app, extension: the dotted path to the array of rows inside the value. */
    rows_at?: string;
    /** extension: the owner's extension, its action and the action's input. */
    ext?: string; action?: string; input?: Record<string, unknown>; instance_id?: string;
    /** file: the sheet of an XLSX (its name; the first sheet when absent). */
    sheet?: string;
    /** datapackage: the package (owner defaults to the product's owner) and its resource. */
    name?: string; resource?: string;
    columns?: SourceColumns;
    /** tables: the resource name this source becomes (default: its id in lowercase). */
    resource_name?: string;
}

export interface ColumnMapping {
    /** The source id the column comes from. */
    source: string;
    /** The source column. */
    from: string;
    /** The output column name (default `from`). */
    name?: string;
    type?: FieldType;
    description?: string;
    /** false leaves the column out. A column the data map marks personal is left out unless this is true. */
    include?: boolean;
}

export interface FilterSpec { column: string; op: FilterOp; value: unknown }

export interface CombineSpec {
    mode: CombineMode;
    /** join: `A.kunta` on the left, `B.kunta` (or one per right source) on the right. */
    key?: { left: string; right: string | string[] };
}

export interface LastRun {
    at: string;
    ok: boolean;
    version?: string;
    unchanged?: boolean;
    rows?: number;
    error?: string;
    /** The source the failure came from, when one did. */
    source?: string;
    sources?: Array<{ id: string; rows: number; fetchedAt: string }>;
    publish_request?: unknown;
}

export interface DataProductDefinition {
    spec: typeof DATAPRODUCT_SPEC;
    name: string;
    title?: string;
    description?: string;
    keywords?: string[];
    license?: string;
    sources: SourceSpec[];
    combine: CombineSpec;
    columns?: ColumnMapping[];
    filter?: FilterSpec | null;
    schedule?: { cron: string; timezone?: string } | null;
    /** How many earlier versions a run keeps (the package's retention policy, ../datapackage/retention.ts).
     *  Absent: every version stays. A version a share pins or a contract reads is kept regardless. */
    retention?: { keep: number; unit: 'versions' | 'months' } | null;
    visibility: string;
    /** The owner's confirmation that a public product may carry a column the data map marks personal. */
    confirmPersonalPublic?: boolean;
    /** The principal that defined it. */
    definedBy: string;
    createdAt: string;
    updatedAt: string;
    lastRun?: LastRun;
}

/** A refusal with a stable code, an HTTP status and a sentence that names what to change. */
export class DataProductError extends Error {
    constructor(readonly code: string, message: string, readonly status = 400, readonly source?: string) {
        super(message);
    }
}

type Normalised = { ok: true; definition: Omit<DataProductDefinition, 'definedBy' | 'createdAt' | 'updatedAt' | 'lastRun'> }
    | { ok: false; code: string; message: string };

const SOURCE_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Check and normalise a definition body (REST body or MCP arguments, the same field names). */
export function normaliseDefinition(name: string, raw: Record<string, unknown>): Normalised {
    const bad = (message: string): Normalised => ({ ok: false, code: 'INVALID_INPUT', message });
    const nameError = validateName(name);
    if (nameError) return bad(`The product name becomes the package name: ${nameError}.`);
    const sourcesIn = Array.isArray(raw.sources) ? raw.sources as Array<Record<string, unknown>> : [];
    if (!sourcesIn.length) return bad('sources is required: one or more { id, kind, ... }, kind one of ' + SOURCE_KINDS.join(', ') + '.');
    if (sourcesIn.length > 10) return bad('A product reads at most 10 sources.');
    const sources: SourceSpec[] = [];
    const seen = new Set<string>();
    for (const [i, s] of sourcesIn.entries()) {
        if (!s || typeof s !== 'object') return bad(`sources[${i}] is not an object.`);
        const id = str(s.id) ?? String.fromCharCode(65 + i);
        if (!SOURCE_ID_RE.test(id)) return bad(`sources[${i}].id "${id}" must be a letter followed by letters, digits or _, at most 16 characters (A, B, kunnat).`);
        if (seen.has(id)) return bad(`Two sources have the id "${id}".`);
        seen.add(id);
        const kind = s.kind as SourceKind;
        if (!SOURCE_KINDS.includes(kind)) return bad(`sources[${i}].kind must be one of ${SOURCE_KINDS.join(', ')}.`);
        const need = (fields: string[]): string | null => {
            const missing = fields.filter(f => !str(s[f]));
            return missing.length ? `A ${kind} source needs ${missing.join(' and ')} (source ${id}).` : null;
        };
        const missing = need({ records: ['organism_id', 'ws', 'space'], app: ['app', 'key_prefix'], memory: ['key'],
            extension: ['ext', 'action'], file: ['key'], datapackage: ['name'] }[kind]);
        if (missing) return bad(missing);
        if (s.input !== undefined && (typeof s.input !== 'object' || s.input === null || Array.isArray(s.input))) return bad(`sources[${i}].input must be an object.`);
        if (s.columns !== undefined && !validSourceColumns(s.columns)) return bad(`sources[${i}].columns is a list of column names or a map of column name to a dotted path.`);
        const spec: SourceSpec = { id, kind };
        for (const f of ['organism_id', 'ws', 'space', 'app', 'key_prefix', 'key', 'owner', 'rows_at', 'ext', 'action', 'instance_id', 'sheet', 'name', 'resource', 'resource_name'] as const) {
            const v = str(s[f]);
            if (v !== undefined) (spec as unknown as Record<string, unknown>)[f] = v;
        }
        if (spec.resource_name && !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(spec.resource_name)) return bad(`sources[${i}].resource_name must be lowercase letters, digits and dashes.`);
        if (s.input !== undefined) spec.input = s.input as Record<string, unknown>;
        if (s.columns !== undefined) spec.columns = s.columns as SourceColumns;
        sources.push(spec);
    }

    const combineIn = (raw.combine && typeof raw.combine === 'object' ? raw.combine : {}) as Record<string, unknown>;
    const mode = (combineIn.mode ?? (sources.length > 1 ? undefined : 'tables')) as CombineMode;
    if (!COMBINE_MODES.includes(mode)) return bad(`combine.mode must be one of ${COMBINE_MODES.join(', ')} when there are several sources.`);
    const combine: CombineSpec = { mode };
    if (mode === 'join') {
        const key = combineIn.key as { left?: unknown; right?: unknown } | undefined;
        const left = str(key?.left);
        const right = Array.isArray(key?.right) ? key!.right.map(String) : str(key?.right) ? [str(key?.right)!] : [];
        if (!left || !right.length) return bad('A join needs combine.key { left: "A.column", right: "B.column" }, the right one per right source.');
        for (const ref of [left, ...right]) {
            const [sid, col] = splitRef(ref);
            if (!sid || !col || !seen.has(sid)) return bad(`The join key "${ref}" must be "<source id>.<column>" of a source of this product.`);
        }
        if (splitRef(left)[0] !== sources[0].id) return bad(`The left side of a join is the first source (${sources[0].id}).`);
        if (sources.length < 2) return bad('A join needs two or more sources.');
        combine.key = { left, right: right.length === 1 ? right[0] : right };
    }

    let columns: ColumnMapping[] | undefined;
    if (raw.columns !== undefined) {
        if (!Array.isArray(raw.columns)) return bad('columns is a list of { source, from, name?, type?, description?, include? }.');
        columns = [];
        for (const [i, c] of (raw.columns as Array<Record<string, unknown>>).entries()) {
            const source = str(c?.source); const from = str(c?.from);
            if (!source || !from || !seen.has(source)) return bad(`columns[${i}] needs source (a source id of this product) and from (its column).`);
            if (c.type !== undefined && !FIELD_TYPES.includes(c.type as FieldType)) return bad(`columns[${i}].type must be one of ${FIELD_TYPES.join(', ')}.`);
            const m: ColumnMapping = { source, from };
            if (str(c.name)) m.name = str(c.name);
            if (c.type !== undefined) m.type = c.type as FieldType;
            if (str(c.description)) m.description = str(c.description);
            if (typeof c.include === 'boolean') m.include = c.include;
            columns.push(m);
        }
    }

    let filter: FilterSpec | null | undefined;
    if (raw.filter !== undefined && raw.filter !== null) {
        const f = raw.filter as Record<string, unknown>;
        if (!str(f.column) || !FILTER_OPS.includes(f.op as FilterOp)) return bad(`filter is { column, op, value }, op one of ${FILTER_OPS.join(', ')}.`);
        if (f.op === 'in' && !Array.isArray(f.value)) return bad('filter op "in" takes a list as its value.');
        filter = { column: str(f.column)!, op: f.op as FilterOp, value: f.value };
    } else if (raw.filter === null) filter = null;

    let schedule: DataProductDefinition['schedule'];
    if (raw.schedule !== undefined && raw.schedule !== null) {
        const s = raw.schedule as Record<string, unknown>;
        const cron = typeof raw.schedule === 'string' ? raw.schedule : str(s.cron);
        if (!cron) return bad('schedule is { cron, timezone? }, or null to build on demand only.');
        schedule = { cron, ...(str(s.timezone) ? { timezone: str(s.timezone)! } : {}) };
    } else if (raw.schedule === null) schedule = null;

    let retention: DataProductDefinition['retention'];
    if (raw.retention !== undefined && raw.retention !== null) {
        const r = raw.retention as Record<string, unknown>;
        const keep = Number(r.keep);
        const unit = r.unit ?? 'versions';
        if (!Number.isInteger(keep) || keep < 1 || keep > 1000 || (unit !== 'versions' && unit !== 'months')) {
            return bad('retention is { keep, unit }: keep a whole number from 1 to 1000, unit "versions" (the default) or "months"; null keeps every version.');
        }
        retention = { keep, unit };
    } else if (raw.retention === null) retention = null;

    const visibility = str(raw.visibility) ?? 'private';
    if (!parseAudience(visibility)) return bad('visibility is private (the default), members, organism:<id> or public.');

    const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter((k): k is string => typeof k === 'string' && !!k.trim()).map(k => k.trim()).slice(0, 20) : undefined;
    return {
        ok: true,
        definition: {
            spec: DATAPRODUCT_SPEC, name, sources, combine, visibility,
            ...(str(raw.title) ? { title: str(raw.title) } : {}),
            ...(str(raw.description) ? { description: str(raw.description) } : {}),
            ...(keywords?.length ? { keywords } : {}),
            ...(str(raw.license) ? { license: str(raw.license) } : {}),
            ...(columns ? { columns } : {}),
            ...(filter !== undefined ? { filter } : {}),
            ...(schedule !== undefined ? { schedule } : {}),
            ...(retention !== undefined ? { retention } : {}),
            ...(raw.confirm_personal_public === true || raw.confirmPersonalPublic === true ? { confirmPersonalPublic: true } : {}),
        },
    };
}

function validSourceColumns(v: unknown): boolean {
    if (Array.isArray(v)) return v.every(c => typeof c === 'string' && c.length > 0);
    return !!v && typeof v === 'object' && Object.values(v).every(p => typeof p === 'string' && p.length > 0);
}

/** `A.kunta` → ['A', 'kunta']; the column may itself contain dots. */
export function splitRef(ref: string): [string, string] {
    const dot = ref.indexOf('.');
    return dot > 0 ? [ref.slice(0, dot), ref.slice(dot + 1)] : ['', ref];
}

/**
 * A source in a few words, for a list row: the extension and its action, the app and its prefix, the
 * memory key, the file, the records space, the other package. The words are identifiers, so they are
 * the same in every language.
 */
export function sourceLabel(s: SourceSpec): { label: string } {
    switch (s.kind) {
        case 'extension': return { label: `${s.ext} › ${s.action}` };
        case 'app': return { label: `${s.app} › ${s.key_prefix}` };
        case 'records': return { label: `${s.ws} › ${s.space}` };
        case 'datapackage': return { label: `${s.owner ? `${s.owner}/` : ''}${s.name}${s.resource ? ` › ${s.resource}` : ''}` };
        case 'file': return { label: String(s.key).split('/').pop() || String(s.key) };
        default: return { label: `${s.key}${s.rows_at ? ` › ${s.rows_at}` : ''}` };
    }
}

/** Read a stored record value as a definition, or null when it is not one. */
export function asDefinition(value: unknown): DataProductDefinition | null {
    const v = value as Partial<DataProductDefinition> | null | undefined;
    return v && typeof v === 'object' && v.spec === DATAPRODUCT_SPEC && Array.isArray(v.sources) ? v as DataProductDefinition : null;
}
