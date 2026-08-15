/**
 * @file src/services/datapackage/table.ts
 * @description The tabular half of the contract, and all of it pure: infer a Table Schema from rows,
 *   validate rows against one, and turn rows into canonical CSV and back.
 *
 *   INFERENCE IS A PROPOSAL, NOT A DECISION. `inferSchema` reads the values and says what it thinks
 *   they are; the descriptor records `schemaSource: 'inferred'` so a consumer can see that nobody
 *   confirmed it. The alternative — infer silently — produces packages where every column is a
 *   string, and then an agent reading the Table Schema learns nothing it could not have guessed.
 *
 *   THE QUALITY GATE IS ROW AND COLUMN ACCURATE. "This package is invalid" sends a publisher looking
 *   through a file; "row 412, column `dispensed_at`, expected date, got `n/a`" sends them to the
 *   line. That difference is the whole value of validating at all, so `validate` returns coordinates
 *   and never a boolean.
 *
 *   CANONICAL CSV, because the bytes are hashed and the hash is the version. Two runs producing the
 *   same table must produce the same bytes: UTF-8 with no BOM, LF line endings, a header row, comma
 *   delimiter, RFC 4180 quoting applied only where it is needed, an empty field for null/undefined,
 *   integers and numbers without locale separators, booleans as `true`/`false`, dates as ISO 8601.
 *   Field ORDER follows the schema, not the first row's key order, so an object whose keys arrived
 *   in a different order cannot change the file.
 * @structure inferSchema · validateRows · toCsv · fromCsv · ValidationIssue
 * @usage
 *   const schema = inferSchema(rows);
 *   const issues = validateRows(rows, schema);
 *   const bytes = toCsv(rows, schema);
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, A4/B1).
 */
import type { FieldType, SchemaField, TableSchema } from './contract.js';

/** One thing wrong, at the coordinate where it is wrong. */
export interface ValidationIssue {
    resource: string;
    /** 1-based, counting the header as row 0 — so it matches what a spreadsheet shows. */
    row: number;
    field: string;
    code: 'type' | 'required' | 'unknown-field' | 'missing-field' | 'duplicate-key';
    message: string;
    /** What was actually there, trimmed for a message. */
    got?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * A STRING of digits with a leading zero is an identifier, not a number.
 *
 * This one is measured rather than reasoned about. The slice-1 acceptance run published a Nordic
 * article number `'001000'`, inference called the column `integer`, and pandas read the published
 * CSV back as `1000` — the leading zeros gone and the key no longer joining to anything. DuckDB kept
 * it as VARCHAR from the same bytes, so the two readers disagreed about the primary key of the table.
 *
 * Every identifier that looks like a number has this shape: a Nordic article number, a Finnish
 * postal code, a business ID, a phone number, a bank account. `0` itself is a number; `007` is a
 * name. Only a STRING is judged — a producer that hands over the JS number 1000 means one thousand.
 */
function isPaddedIdentifier(value: unknown): boolean {
    return typeof value === 'string' && /^0\d/.test(value.trim());
}

/** Does one value fit one declared type? `null`/`undefined`/'' are absent, not wrong — `primaryKey`
 *  is what makes a field required, so an optional gap must not be reported as a type error. */
function fits(value: unknown, type: FieldType): boolean {
    if (value === null || value === undefined || value === '') return true;
    switch (type) {
        case 'any': return true;
        case 'string': return typeof value !== 'object';
        case 'boolean':
            return typeof value === 'boolean' || (typeof value === 'string' && /^(true|false)$/i.test(value));
        case 'integer':
            if (typeof value === 'number') return Number.isInteger(value);
            if (isPaddedIdentifier(value)) return false;
            return typeof value === 'string' && /^-?\d+$/.test(value.trim());
        case 'number':
            if (typeof value === 'number') return Number.isFinite(value);
            if (isPaddedIdentifier(value)) return false;
            return typeof value === 'string' && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value.trim());
        case 'date':
            return value instanceof Date || (typeof value === 'string' && ISO_DATE.test(value.trim()));
        case 'datetime':
            return value instanceof Date || (typeof value === 'string' && ISO_DATETIME.test(value.trim()));
    }
}

/** The narrowest type that fits every value seen. Order matters: integer before number before date
 *  before datetime before string, so a column of whole numbers is not called `number` and a column
 *  of ISO dates is not called `string`. */
const NARROWING: FieldType[] = ['boolean', 'integer', 'number', 'date', 'datetime', 'string'];

/**
 * Propose a Table Schema from rows.
 *
 * Field ORDER is first-seen across the rows, not sorted: a producer laid the columns out in an order
 * that means something, and re-alphabetising them makes the CSV unfamiliar for no gain. A field that
 * was present but never had a value gets type `string` and says so in its description — the honest
 * answer is "nothing to go on", and it is the one case a publisher genuinely has to look at.
 */
export function inferSchema(rows: Array<Record<string, unknown>>): TableSchema {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        for (const k of Object.keys(row ?? {})) {
            if (!seen.has(k)) { seen.add(k); order.push(k); }
        }
    }
    const fields: SchemaField[] = order.map(name => {
        let anyValue = false;
        let type: FieldType = 'boolean';
        for (const row of rows) {
            const v = row?.[name];
            if (v === null || v === undefined || v === '') continue;
            anyValue = true;
            // Widen until it fits: the first type in NARROWING that accepts this value AND is no
            // narrower than what we already need.
            const from = NARROWING.indexOf(type);
            let next = from;
            while (next < NARROWING.length - 1 && !fits(v, NARROWING[next])) next++;
            if (next > from) type = NARROWING[next];
        }
        if (!anyValue) {
            return { name, type: 'string', description: 'No value in any row — the type is a placeholder, not an observation.' };
        }
        return { name, type };
    });
    return { fields };
}

/**
 * Check rows against a schema and return every coordinate that is wrong. Never throws and never
 * stops at the first problem: a publisher fixing one column wants the whole list, not one round trip
 * per cell. Capped so a wholly-wrong table cannot produce a million-entry response.
 */
export function validateRows(
    resource: string, rows: Array<Record<string, unknown>>, schema: TableSchema, cap = 200,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const declared = new Map(schema.fields.map(f => [f.name, f]));
    const required = new Set(schema.primaryKey ?? []);
    const seenKeys = new Set<string>();
    const push = (i: ValidationIssue): void => { if (issues.length < cap) issues.push(i); };

    for (let r = 0; r < rows.length; r++) {
        const row = rows[r] ?? {};
        const rowNo = r + 1;
        for (const key of Object.keys(row)) {
            if (!declared.has(key)) {
                push({ resource, row: rowNo, field: key, code: 'unknown-field',
                    message: `the schema declares no field "${key}"` });
            }
        }
        for (const f of schema.fields) {
            const v = row[f.name];
            const absent = v === null || v === undefined || v === '';
            if (absent) {
                if (required.has(f.name)) {
                    push({ resource, row: rowNo, field: f.name, code: 'required',
                        message: `"${f.name}" is part of the primary key and cannot be empty` });
                }
                continue;
            }
            if (!fits(v, f.type)) {
                push({ resource, row: rowNo, field: f.name, code: 'type', got: preview(v),
                    message: `expected ${f.type}, got ${preview(v)}` });
            }
        }
        if (required.size > 0) {
            const composite = [...required].map(k => String(row[k] ?? '')).join(' ');
            if (seenKeys.has(composite)) {
                push({ resource, row: rowNo, field: [...required].join('+'), code: 'duplicate-key',
                    message: `another row already has this primary key` });
            }
            seenKeys.add(composite);
        }
    }
    return issues;
}

function preview(v: unknown): string {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.length > 40 ? `"${s.slice(0, 40)}…"` : `"${s}"`;
}

/** One cell, in the canonical text form its declared type gets. */
function cell(value: unknown, type: FieldType): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/** RFC 4180: quote only when the field contains a delimiter, a quote or a line break. Quoting more
 *  than that would still parse, but it would change the bytes and therefore the version hash. */
function quote(s: string): string {
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Canonical CSV for one resource. Column order and count come from the SCHEMA — a row carrying an
 * extra key contributes nothing and a row missing one contributes an empty field, so a ragged input
 * still produces a rectangular file. Validation is what reports the raggedness; this function's job
 * is to be deterministic.
 */
export function toCsv(rows: Array<Record<string, unknown>>, schema: TableSchema): Buffer {
    const out: string[] = [schema.fields.map(f => quote(f.name)).join(',')];
    for (const row of rows) {
        out.push(schema.fields.map(f => quote(cell(row?.[f.name], f.type))).join(','));
    }
    // Trailing newline: a POSIX text file ends with one, and its presence must not depend on
    // whether the last row happened to be empty.
    return Buffer.from(out.join('\n') + '\n', 'utf8');
}

/** Drop a leading byte-order mark. `toCsv` never writes one, but a CSV that arrived from a
 *  spreadsheet often carries it, and a BOM left in place becomes part of the first column's NAME —
 *  so the schema's `date` field silently stops matching the header. Written as a code point rather
 *  than the character itself: a raw BOM in source is invisible and the linter refuses it. */
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

/** Parse canonical CSV back into rows, typed by the schema. The inverse of toCsv for every table
 *  toCsv produced; a foreign CSV with different quoting still parses, it just may not round-trip. */
export function fromCsv(data: Buffer, schema: TableSchema): Array<Record<string, unknown>> {
    const text = stripBom(data.toString('utf8'));
    const records = splitCsv(text);
    if (records.length === 0) return [];
    const header = records[0];
    const byName = new Map(schema.fields.map(f => [f.name, f]));
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 1; i < records.length; i++) {
        const rec = records[i];
        if (rec.length === 1 && rec[0] === '') continue;   // trailing newline
        const row: Record<string, unknown> = {};
        for (let c = 0; c < header.length; c++) {
            const name = header[c];
            const raw = rec[c] ?? '';
            const f = byName.get(name);
            row[name] = raw === '' ? null : coerce(raw, f?.type ?? 'string');
        }
        rows.push(row);
    }
    return rows;
}

function coerce(raw: string, type: FieldType): unknown {
    switch (type) {
        case 'integer': { const n = Number(raw); return Number.isInteger(n) ? n : raw; }
        case 'number': { const n = Number(raw); return Number.isFinite(n) ? n : raw; }
        case 'boolean': return /^true$/i.test(raw) ? true : (/^false$/i.test(raw) ? false : raw);
        default: return raw;
    }
}

/** A character-by-character split that honours RFC 4180 quoting, including embedded newlines. */
function splitCsv(text: string): string[][] {
    const records: string[][] = [];
    let field = '';
    let record: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
            continue;
        }
        if (ch === '"') { inQuotes = true; continue; }
        if (ch === ',') { record.push(field); field = ''; continue; }
        if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            record.push(field); field = '';
            records.push(record); record = [];
            continue;
        }
        field += ch;
    }
    if (field !== '' || record.length > 0) { record.push(field); records.push(record); }
    return records;
}
