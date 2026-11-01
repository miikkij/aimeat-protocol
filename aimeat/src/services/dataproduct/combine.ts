/**
 * @file src/services/dataproduct/combine.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of a data product build: the rows every source produced, through the
 *   column mapping, the combine mode and the filter, to the resources a data package version holds,
 *   with the transformations a reader of the package sees (plan doc-mvwxcas3dom3, D9.9). No storage,
 *   no clock: the same sources always give the same resources, which is what lets the content hash
 *   answer "unchanged" for a build of the same rows.
 *
 *   THE COMBINE MODES.
 *     tables  each source becomes its own resource (one source: the resource `rows`).
 *     union   the rows are appended into one resource; after the mapping every source must have the
 *             same columns, or the build is refused with UNION_COLUMNS_MISMATCH naming the difference.
 *     join    a left join of the first source with each of the others on the key: every left row is
 *             kept, a left row with no match gets nulls in the right columns, and a right key that
 *             matches several rows is refused with JOIN_DUPLICATE_KEY rather than multiplying rows.
 *
 *   A PERSONAL COLUMN is left out unless the mapping names it with `include: true`. The build reads
 *   `personalIncluded` to refuse a public audience (./build.ts); what was left out is recorded in the
 *   transformations, so the package says a column was dropped and why.
 * @structure SourceTable · CombinedResource · Combined · combineSources · applyFilter · coerceTo · flatRow
 * @usage const combined = combineSources(definition, tables);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D9.9).
 */
import type { FieldType, SchemaField, TableSchema } from '../datapackage/contract.js';
import { RESOURCE_NAME_RE } from '../datapackage/contract.js';
import { inferSchema } from '../datapackage/table.js';
import { DataProductError, splitRef, type DataProductDefinition, type FilterSpec, type SourceSpec } from './definition.js';

type Row = Record<string, unknown>;

/** What one source produced: its rows (flat), its columns in order, the types it knows, and which are personal. */
export interface SourceTable {
    id: string;
    rows: Row[];
    columns: string[];
    types: Record<string, FieldType | undefined>;
    personal: ReadonlySet<string>;
}

export interface CombinedResource {
    name: string;
    rows: Row[];
    /** Declared when a source or the mapping typed at least one column; otherwise inferred at publish. */
    schema: TableSchema | 'infer';
}

export interface Combined {
    resources: CombinedResource[];
    transformations: Array<{ by: string; what: string }>;
    /** `B.email`: personal columns the mapping included. A public audience is refused while there is one. */
    personalIncluded: string[];
}

interface OutColumn { from: string; name: string; type?: FieldType; description?: string }

const BY = 'dataproduct';

/** A row with every value a scalar: an array becomes one `;`-joined cell, an object its JSON. */
export function flatRow(row: Row): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(row ?? {})) {
        if (Array.isArray(v)) out[k] = v.map(x => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(';');
        else if (v !== null && typeof v === 'object' && !(v instanceof Date)) out[k] = JSON.stringify(v);
        else out[k] = v === undefined ? null : v;
    }
    return out;
}

/** A value in the form its declared type takes: a numeric string becomes a number, and so on. */
export function coerceTo(value: unknown, type: FieldType | undefined): unknown {
    if (value === undefined || value === null || value === '') return null;
    if (!type || type === 'any') return value;
    if (type === 'integer' || type === 'number') {
        if (typeof value === 'number') return value;
        const n = typeof value === 'string' && value.trim() !== '' ? Number(value.trim().replace(',', '.')) : NaN;
        return Number.isFinite(n) && (type === 'number' || Number.isInteger(n)) ? n : value;
    }
    if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        if (/^(true|yes|1)$/i.test(String(value))) return true;
        if (/^(false|no|0)$/i.test(String(value))) return false;
        return value;
    }
    if (value instanceof Date) return type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
    if (type === 'string' && typeof value !== 'string') return typeof value === 'object' ? JSON.stringify(value) : String(value);
    return value;
}

/** The output columns of one source, after the mapping and the personal rule. */
function outColumnsOf(def: DataProductDefinition, t: SourceTable, transformations: Combined['transformations'], personalIncluded: string[]): OutColumn[] {
    const mapped = (def.columns ?? []).filter(c => c.source === t.id);
    const cols: OutColumn[] = [];
    if (mapped.length) {
        for (const m of mapped) {
            if (!t.columns.includes(m.from)) {
                throw new DataProductError('UNKNOWN_COLUMN', `Source ${t.id} has no column "${m.from}". Its columns: ${t.columns.join(', ') || '(none)'}.`, 400, t.id);
            }
            const personal = t.personal.has(m.from);
            if (m.include === false) continue;
            if (personal && m.include !== true) {
                transformations.push({ by: BY, what: `left out ${t.id}.${m.from}, which the data map marks personal` });
                continue;
            }
            if (personal) personalIncluded.push(`${t.id}.${m.from}`);
            const name = m.name ?? m.from;
            if (name !== m.from) transformations.push({ by: BY, what: `renamed ${t.id}.${m.from} to ${name}` });
            cols.push({ from: m.from, name, type: m.type ?? t.types[m.from], ...(m.description ? { description: m.description } : {}) });
        }
        return cols;
    }
    for (const c of t.columns) {
        if (t.personal.has(c)) {
            transformations.push({ by: BY, what: `left out ${t.id}.${c}, which the data map marks personal` });
            continue;
        }
        cols.push({ from: c, name: c, type: t.types[c] });
    }
    return cols;
}

function project(rows: Row[], cols: OutColumn[]): Row[] {
    return rows.map(r => Object.fromEntries(cols.map(c => [c.name, coerceTo(r[c.from], c.type)])));
}

/** The resource name a source becomes in `tables` mode. */
function resourceNameOf(s: SourceSpec | undefined, id: string, count: number): string {
    if (s?.resource_name) return s.resource_name;
    if (count === 1) return 'rows';
    const lower = id.toLowerCase().replace(/_/g, '-');
    return RESOURCE_NAME_RE.test(lower) ? lower : `source-${lower}`;
}

/** The Table Schema of output columns: declared when at least one column is typed. */
function schemaOf(cols: OutColumn[], rows: Row[]): TableSchema | 'infer' {
    if (!cols.some(c => c.type)) {
        // Nothing typed: keep the mapping's descriptions on an inferred schema.
        if (!cols.some(c => c.description)) return 'infer';
    }
    const inferred = new Map(inferSchema(rows).fields.map(f => [f.name, f]));
    const fields: SchemaField[] = cols.map(c => ({
        name: c.name,
        type: c.type ?? inferred.get(c.name)?.type ?? 'string',
        ...(c.description ? { description: c.description } : {}),
    }));
    return { fields };
}

/** Coerce the rows of a resource to the types of its declared schema, so a "12" from a CSV is 12. */
function coerceRows(rows: Row[], schema: TableSchema | 'infer'): Row[] {
    if (schema === 'infer') return rows;
    return rows.map(r => Object.fromEntries(schema.fields.map(f => [f.name, coerceTo(r[f.name], f.type)])));
}

const keyOf = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v).trim());

/** Combine the sources as the definition says. Throws DataProductError on a refusal. */
export function combineSources(def: DataProductDefinition, tables: SourceTable[]): Combined {
    const transformations: Combined['transformations'] = [];
    const personalIncluded: string[] = [];
    const specOf = new Map(def.sources.map(s => [s.id, s]));
    const outs = tables.map(t => ({ t, cols: outColumnsOf(def, t, transformations, personalIncluded) }));
    for (const o of outs) {
        if (!o.cols.length) {
            throw new DataProductError('NO_COLUMNS', o.t.personal.size
                ? `Source ${o.t.id} hands on no columns: the data map marks ${[...o.t.personal].join(', ')} personal, and a personal column is left out unless \`columns\` names it with include: true.`
                : `Source ${o.t.id} hands on no columns after the mapping.`, 400, o.t.id);
        }
    }
    let resources: Array<{ name: string; rows: Row[]; cols: OutColumn[] }>;

    if (def.combine.mode === 'tables') {
        resources = outs.map(o => ({ name: resourceNameOf(specOf.get(o.t.id), o.t.id, outs.length), rows: project(o.t.rows, o.cols), cols: o.cols }));
        const names = new Set<string>();
        for (const r of resources) {
            if (names.has(r.name)) throw new DataProductError('INVALID_INPUT', `Two sources would become the resource "${r.name}". Give one a resource_name.`);
            names.add(r.name);
        }
    } else if (def.combine.mode === 'union') {
        const first = outs[0];
        const want = first.cols.map(c => c.name);
        for (const o of outs.slice(1)) {
            const have = o.cols.map(c => c.name);
            const missing = want.filter(n => !have.includes(n));
            const extra = have.filter(n => !want.includes(n));
            if (missing.length || extra.length) {
                throw new DataProductError('UNION_COLUMNS_MISMATCH',
                    `A union needs the same columns from every source after the mapping. Source ${o.t.id} `
                    + `${missing.length ? `lacks ${missing.join(', ')}` : ''}${missing.length && extra.length ? ' and ' : ''}${extra.length ? `has ${extra.join(', ')} besides` : ''}`
                    + ` compared with source ${first.t.id}. Rename or leave out columns in \`columns\`.`, 400, o.t.id);
            }
        }
        const cols = first.cols.map(c => ({ ...c, type: c.type ?? outs.map(o => o.cols.find(x => x.name === c.name)?.type).find(Boolean) }));
        const rows = outs.flatMap(o => project(o.t.rows, o.cols).map(r => Object.fromEntries(want.map(n => [n, r[n]]))));
        resources = [{ name: specOf.get(first.t.id)?.resource_name ?? 'rows', rows, cols }];
        transformations.push({ by: BY, what: `union of ${outs.map(o => o.t.id).join(', ')}` });
    } else {
        resources = [join(def, outs, transformations)];
    }

    if (def.filter) {
        const f = def.filter;
        const hit = resources.filter(r => r.cols.some(c => c.name === f.column));
        if (!hit.length) throw new DataProductError('UNKNOWN_COLUMN', `The filter names "${f.column}", which no resource has after the mapping.`);
        for (const r of hit) r.rows = r.rows.filter(row => applyFilter(row[f.column], f));
        transformations.push({ by: BY, what: `kept the rows where ${f.column} ${f.op} ${JSON.stringify(f.value)}` });
    }

    return {
        resources: resources.map(r => {
            const schema = schemaOf(r.cols, r.rows);
            return { name: r.name, rows: coerceRows(r.rows, schema), schema };
        }),
        transformations,
        personalIncluded,
    };
}

/** The left join of the first source with the others, on the key. */
function join(def: DataProductDefinition, outs: Array<{ t: SourceTable; cols: OutColumn[] }>, transformations: Combined['transformations']) {
    const key = def.combine.key!;
    const [, leftCol] = splitRef(key.left);
    const rights = Array.isArray(key.right) ? key.right : [key.right];
    const left = outs[0];
    if (!left.t.columns.includes(leftCol)) throw new DataProductError('UNKNOWN_COLUMN', `Source ${left.t.id} has no join column "${leftCol}".`, 400, left.t.id);
    const cols: OutColumn[] = [...left.cols];
    let rows: Row[] = left.t.rows.map(raw => ({ __key: keyOf(raw[leftCol]), ...project([raw], left.cols)[0] }));
    for (const o of outs.slice(1)) {
        const ref = rights.find(r => splitRef(r)[0] === o.t.id);
        if (!ref) throw new DataProductError('INVALID_INPUT', `The join key names no column of source ${o.t.id}: add "${o.t.id}.<column>" to combine.key.right.`, 400, o.t.id);
        const rightCol = splitRef(ref)[1];
        if (!o.t.columns.includes(rightCol)) throw new DataProductError('UNKNOWN_COLUMN', `Source ${o.t.id} has no join column "${rightCol}".`, 400, o.t.id);
        // The right side's columns, the join column itself left out when it carries the left one's name.
        const taken = new Set(cols.map(c => c.name));
        const rightCols = o.cols
            .filter(c => !(c.from === rightCol && taken.has(c.name)))
            .map(c => (taken.has(c.name) ? { ...c, name: `${c.name}_${o.t.id.toLowerCase()}` } : c));
        const index = new Map<string, Row>();
        for (const raw of o.t.rows) {
            const k = keyOf(raw[rightCol]);
            if (k === null) continue;
            if (index.has(k)) {
                throw new DataProductError('JOIN_DUPLICATE_KEY',
                    `Source ${o.t.id} has more than one row with ${rightCol} = "${k}", so the join would multiply rows. `
                    + 'Make the right key unique (filter or aggregate that source first), or combine with union or tables.', 400, o.t.id);
            }
            index.set(k, project([raw], rightCols)[0]);
        }
        const empty = Object.fromEntries(rightCols.map(c => [c.name, null]));
        rows = rows.map(r => ({ ...r, ...(r.__key !== null && index.has(r.__key as string) ? index.get(r.__key as string) : empty) }));
        cols.push(...rightCols);
        transformations.push({ by: BY, what: `left join of ${left.t.id} with ${o.t.id} on ${key.left} = ${ref}` });
        for (const c of rightCols) if (c.name !== c.from && !(def.columns ?? []).some(m => m.source === o.t.id && m.from === c.from && m.name === c.name)) {
            transformations.push({ by: BY, what: `renamed ${o.t.id}.${c.from} to ${c.name}` });
        }
    }
    return { name: def.sources[0].resource_name ?? 'rows', rows: rows.map(({ __key, ...rest }) => { void __key; return rest; }), cols };
}

/** Does one cell pass the filter? Numbers compare as numbers, everything else as text. */
export function applyFilter(cell: unknown, f: FilterSpec): boolean {
    const asNum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    const cmp = (target: unknown): number => {
        const a = asNum(cell); const b = asNum(target);
        if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
        return String(cell ?? '').localeCompare(String(target ?? ''));
    };
    switch (f.op) {
        case 'eq': return cell !== null && cell !== undefined && cmp(f.value) === 0;
        case 'ne': return cell === null || cell === undefined || cmp(f.value) !== 0;
        case 'gt': return cell !== null && cell !== undefined && cmp(f.value) > 0;
        case 'gte': return cell !== null && cell !== undefined && cmp(f.value) >= 0;
        case 'lt': return cell !== null && cell !== undefined && cmp(f.value) < 0;
        case 'lte': return cell !== null && cell !== undefined && cmp(f.value) <= 0;
        case 'contains': return String(cell ?? '').toLowerCase().includes(String(f.value ?? '').toLowerCase());
        case 'in': return Array.isArray(f.value) && f.value.some(v => cell !== null && cell !== undefined && cmp(v) === 0);
    }
}
