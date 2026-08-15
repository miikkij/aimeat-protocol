/**
 * @file src/services/datapackage/odata.ts
 * @description The OData v4 projection of a data package: CSDL metadata from the Table Schema, and
 *   the readable subset of the query language applied to rows. Pure — no HTTP, no storage.
 *
 *   WHY OData AT ALL, when the CSV already sits at a permanent address. Excel, Power BI and Tableau
 *   have a native "OData feed" connector: a person pastes one URL and the workbook REFRESHES ITSELF
 *   afterwards. A CSV link is a download, and a download is a copy that starts going stale the moment
 *   it lands. This is the difference between a dataset somebody uses once and one they keep.
 *
 *   AN UNSUPPORTED QUERY OPTION IS AN ERROR, NEVER AN IGNORED ONE. This is the rule the whole file
 *   is shaped around. If a client sends `$filter=weird(x)` and the server ignores it, the client
 *   receives MORE ROWS THAN IT ASKED FOR and treats them as the answer — a silent wrong result that
 *   looks exactly like a right one. So anything this implementation does not understand answers 501
 *   naming what it does understand. A visibly missing feature is cheap; a filter that quietly did
 *   nothing is a wrong number in somebody's report.
 *
 *   ONE SCHEMA, MANY PROJECTIONS. The Table Schema in the descriptor is the only place columns and
 *   types are declared. The CSDL here, the CSV header, the ODPS product sheet and an agent's view of
 *   the package are all derived from it, so none of them can drift from the data.
 * @structure toCsdl · parseQuery · applyQuery · ODATA_SUPPORTED
 * @usage
 *   const xml = toCsdl(descriptor, 'https://…/v1/odata/alice/pkg');
 *   const q = parseQuery(searchParams, resource.schema);
 *   if (!q.ok) return 501;
 *   const page = applyQuery(rows, q.value);
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, the OData surface).
 */
import type { Descriptor, DescriptorResource, FieldType, TableSchema } from './contract.js';

/** Every system query option this implementation honours. Anything else is refused by name. */
export const ODATA_SUPPORTED = ['$select', '$top', '$skip', '$filter', '$orderby', '$count', '$format'] as const;

/** Frictionless type → EDM primitive. The one mapping; nothing else decides an OData type. */
const EDM: Record<FieldType, string> = {
    string: 'Edm.String',
    integer: 'Edm.Int64',
    number: 'Edm.Double',
    boolean: 'Edm.Boolean',
    date: 'Edm.Date',
    datetime: 'Edm.DateTimeOffset',
    any: 'Edm.String',
};

/** The synthetic key. A CSV row has no identity of its own, and OData requires an entity key — so
 *  one is supplied rather than a natural column being promoted to a role it cannot fill. It is the
 *  row's ordinal WITHIN THIS IMMUTABLE VERSION, which is stable precisely because the version is. */
export const ROW_KEY = 'RowId';

/** XML text, escaped. A field name comes from the producer's data, so it is not trusted markup. */
function xml(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** A CSDL identifier: letters, digits and underscore, not starting with a digit. A column called
 *  `first name` or `2026` is legal in a CSV and illegal here, so it is mapped rather than rejected —
 *  and the mapping is recorded in the descriptor's own field name, which does not change. */
export function edmName(raw: string): string {
    const cleaned = String(raw).replace(/[^A-Za-z0-9_]/g, '_');
    return /^[0-9]/.test(cleaned) ? `_${cleaned}` : (cleaned || '_');
}

/**
 * The CSDL v4 document (`$metadata`) for one package version.
 *
 * `Nullable="true"` on every property except the key, deliberately: a Table Schema's `primaryKey` is
 * the only statement anybody made about required-ness, and claiming a column is non-nullable because
 * it happened to be full in this version would be a promise the next version breaks.
 */
export function toCsdl(descriptor: Descriptor, namespace: string): string {
    // A CSDL namespace is a DOTTED identifier ("AIMEAT.shortages"), so each segment is sanitised and
    // the dots survive. Running edmName over the whole string turned the separator into an
    // underscore, and the EntitySet then named a type in a namespace nobody had declared.
    const ns = String(namespace).split('.').map(edmName).join('.');
    const types = descriptor.resources.map(r => entityType(r, ns)).join('\n');
    const sets = descriptor.resources
        .map(r => `        <EntitySet Name="${xml(edmName(r.name))}" EntityType="${xml(ns)}.${xml(edmName(r.name))}"/>`)
        .join('\n');
    return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="${xml(ns)}" xmlns="http://docs.oasis-open.org/odata/ns/edm">
${types}
      <EntityContainer Name="Container">
${sets}
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`;
}

function entityType(resource: DescriptorResource, _ns: string): string {
    const props = resource.schema.fields
        .map(f => `        <Property Name="${xml(edmName(f.name))}" Type="${EDM[f.type] ?? 'Edm.String'}" Nullable="true"/>`)
        .join('\n');
    return `      <EntityType Name="${xml(edmName(resource.name))}">
        <Key><PropertyRef Name="${ROW_KEY}"/></Key>
        <Property Name="${ROW_KEY}" Type="Edm.Int64" Nullable="false"/>
${props}
      </EntityType>`;
}

// ── The query language, the readable subset of it ────────────────────────────────────────────────

export interface FilterNode {
    field: string;
    op: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'contains' | 'startswith' | 'endswith';
    value: string | number | boolean | null;
}

export interface ParsedQuery {
    select?: string[];
    top?: number;
    skip: number;
    /** ANDed together. `or` is not supported, and saying so is the point — see the file header. */
    filters: FilterNode[];
    orderby: Array<{ field: string; desc: boolean }>;
    count: boolean;
}

export type ParseResult =
    | { ok: true; value: ParsedQuery }
    | { ok: false; code: 'NOT_IMPLEMENTED' | 'BAD_REQUEST'; message: string };

const COMPARISON = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(eq|ne|gt|ge|lt|le)\s+(.+?)\s*$/;
const FUNCTION = /^\s*(contains|startswith|endswith)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(.+?)\s*\)\s*$/;

/** An OData literal: a quoted string (with '' for an embedded quote), a number, true/false, null. */
function literal(raw: string): string | number | boolean | null | undefined {
    const s = raw.trim();
    if (/^'.*'$/s.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    return undefined;   // not a literal this implementation reads
}

/**
 * Read the system query options, refusing everything not understood.
 *
 * The `edmName` mapping runs in both directions here: a client saw `first_name` in the metadata and
 * sends `$filter=first_name eq 'x'`, while the row still holds `first name`. Resolving through the
 * schema means the client only ever has to know the names the metadata gave it.
 */
export function parseQuery(params: URLSearchParams, schema: TableSchema): ParseResult {
    // Every field, addressable by the name the metadata published.
    const byEdm = new Map(schema.fields.map(f => [edmName(f.name), f.name]));
    byEdm.set(ROW_KEY, ROW_KEY);

    for (const key of params.keys()) {
        if (!key.startsWith('$')) continue;   // a custom parameter is the caller's business
        if (!(ODATA_SUPPORTED as readonly string[]).includes(key)) {
            return {
                ok: false, code: 'NOT_IMPLEMENTED',
                message: `${key} is not implemented on this feed. Supported: ${ODATA_SUPPORTED.join(', ')}. `
                    + 'It is refused rather than ignored, because an ignored query option returns more rows '
                    + 'than you asked for and looks like an answer.',
            };
        }
    }

    const out: ParsedQuery = { skip: 0, filters: [], orderby: [], count: false };

    const select = params.get('$select');
    if (select) {
        const names: string[] = [];
        for (const raw of select.split(',').map(s => s.trim()).filter(Boolean)) {
            const real = byEdm.get(raw);
            if (!real) return { ok: false, code: 'BAD_REQUEST', message: `$select names no such property: ${raw}` };
            names.push(real);
        }
        out.select = names;
    }

    for (const [name, target] of [['$top', 'top'], ['$skip', 'skip']] as const) {
        const raw = params.get(name);
        if (raw === null) continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
            return { ok: false, code: 'BAD_REQUEST', message: `${name} must be a non-negative integer, got "${raw}"` };
        }
        if (target === 'top') out.top = n; else out.skip = n;
    }

    const count = params.get('$count');
    if (count !== null) {
        if (count !== 'true' && count !== 'false') {
            return { ok: false, code: 'BAD_REQUEST', message: `$count must be true or false, got "${count}"` };
        }
        out.count = count === 'true';
    }

    const orderby = params.get('$orderby');
    if (orderby) {
        for (const clause of orderby.split(',').map(s => s.trim()).filter(Boolean)) {
            const [field, dir] = clause.split(/\s+/);
            const real = byEdm.get(field);
            if (!real) return { ok: false, code: 'BAD_REQUEST', message: `$orderby names no such property: ${field}` };
            if (dir && dir !== 'asc' && dir !== 'desc') {
                return { ok: false, code: 'BAD_REQUEST', message: `$orderby direction must be asc or desc, got "${dir}"` };
            }
            out.orderby.push({ field: real, desc: dir === 'desc' });
        }
    }

    const filter = params.get('$filter');
    if (filter) {
        // `or` and `not` get their OWN refusal, ahead of everything else, because the split below is
        // on `and`: an `or` left in would be silently torn into two ANDed clauses and match FEWER
        // rows than asked for, with no symptom at all. Tested with string literals blanked first, so
        // `name eq 'or'` is data rather than an operator.
        const bare = filter.replace(/'(?:[^']|'')*'/g, "''");
        if (/\bor\b/i.test(bare) || /\bnot\b/i.test(bare)) {
            return {
                ok: false, code: 'NOT_IMPLEMENTED',
                message: '$filter supports `field op value` clauses joined by `and`, plus contains(), '
                    + 'startswith() and endswith(). `or` and `not` are not implemented. Refused rather '
                    + 'than partly applied: a filter this server half-understood would return the wrong '
                    + 'rows and look like an answer.',
            };
        }
        // Anything else fails per CLAUSE, which is where the message can name the offending text.
        for (const clause of filter.split(/\s+and\s+/i)) {
            const node = parseClause(clause, byEdm);
            if ('message' in node) return { ok: false, code: node.code, message: node.message };
            out.filters.push(node);
        }
    }

    return { ok: true, value: out };
}

function parseClause(
    clause: string, byEdm: Map<string, string>,
): FilterNode | { code: 'NOT_IMPLEMENTED' | 'BAD_REQUEST'; message: string } {
    const fn = FUNCTION.exec(clause);
    if (fn) {
        const real = byEdm.get(fn[2]);
        if (!real) return { code: 'BAD_REQUEST', message: `$filter names no such property: ${fn[2]}` };
        const v = literal(fn[3]);
        if (v === undefined) return { code: 'BAD_REQUEST', message: `$filter value not understood: ${fn[3]}` };
        return { field: real, op: fn[1] as FilterNode['op'], value: v };
    }
    const cmp = COMPARISON.exec(clause);
    if (cmp) {
        const real = byEdm.get(cmp[1]);
        if (!real) return { code: 'BAD_REQUEST', message: `$filter names no such property: ${cmp[1]}` };
        const v = literal(cmp[3]);
        if (v === undefined) return { code: 'BAD_REQUEST', message: `$filter value not understood: ${cmp[3]}` };
        return { field: real, op: cmp[2] as FilterNode['op'], value: v };
    }
    return {
        code: 'NOT_IMPLEMENTED',
        message: `$filter clause not understood: "${clause.trim()}". This feed reads `
            + '`field eq|ne|gt|ge|lt|le value` and contains/startswith/endswith(field, \'value\'), joined by `and`.',
    };
}

/** Comparable form: a date string sorts and compares correctly as a string because it is ISO 8601. */
function cmpValue(a: unknown, b: unknown): number {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matches(row: Record<string, unknown>, f: FilterNode): boolean {
    const v = row[f.field];
    switch (f.op) {
        case 'eq': return cmpValue(v, f.value) === 0;
        case 'ne': return cmpValue(v, f.value) !== 0;
        case 'gt': return cmpValue(v, f.value) > 0;
        case 'ge': return cmpValue(v, f.value) >= 0;
        case 'lt': return cmpValue(v, f.value) < 0;
        case 'le': return cmpValue(v, f.value) <= 0;
        case 'contains': return String(v ?? '').includes(String(f.value));
        case 'startswith': return String(v ?? '').startsWith(String(f.value));
        case 'endswith': return String(v ?? '').endsWith(String(f.value));
    }
}

export interface QueryPage {
    rows: Array<Record<string, unknown>>;
    /** Rows matching the filter, BEFORE $top/$skip — what `$count=true` reports. */
    matched: number;
}

/**
 * Apply the parsed query. `RowId` is assigned before filtering, so a row keeps the same key whatever
 * a client asks for — a key that shifted with the query would make the entity identity meaningless.
 */
export function applyQuery(rows: Array<Record<string, unknown>>, q: ParsedQuery, schema: TableSchema): QueryPage {
    let out: Array<Record<string, unknown>> = rows.map((r, i) => ({ [ROW_KEY]: i, ...r }));
    for (const f of q.filters) out = out.filter(r => matches(r, f));
    const matched = out.length;

    for (const o of [...q.orderby].reverse()) {
        out = [...out].sort((a, b) => (o.desc ? -1 : 1) * cmpValue(a[o.field], b[o.field]));
    }

    out = out.slice(q.skip, q.top === undefined ? undefined : q.skip + q.top);

    if (q.select) {
        const keep = new Set([ROW_KEY, ...q.select]);
        out = out.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
    }
    // Property names go back out as the metadata published them, which is what the client asked with.
    const rename = new Map(schema.fields.map(f => [f.name, edmName(f.name)]));
    return {
        rows: out.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [rename.get(k) ?? k, v]))),
        matched,
    };
}
