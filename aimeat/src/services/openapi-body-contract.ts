/**
 * @file src/services/openapi-body-contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The request-body half of openapi.yaml as something a request can be checked against:
 *   every operation that declares an `application/json` request body, found by method and path, with
 *   an ajv validator for its schema. Read by middleware/openapi-body-guard.ts.
 *
 *   WHY. 612 writing routes read their body without a schema (security/write-validation-baseline.json),
 *   and the contract that describes most of those bodies was used for documentation and generated
 *   types only (codebase analysis 2026-11-03, security-architecture finding 6). This module makes
 *   the contract usable at run time, so a route can be checked against what openapi.yaml already
 *   says about it.
 *
 *   HOW. openapi.yaml is read once. Every operation with a JSON body schema is placed in a path trie
 *   keyed by its template (`/v1/memory/{key}`); a request path is matched literal segment first,
 *   then a segment with a parameter inside it, then a whole-segment parameter, so `/v1/apps/mine`
 *   finds the literal route before `/v1/apps/{owner}`. The schema of an operation is compiled the
 *   first time a request reaches it (compiling all of them at boot costs seconds of start time for
 *   routes most nodes never see), and a schema ajv cannot compile is remembered as not checkable.
 *
 *   The validators never change the body: no defaults, no type coercion, no removal of unknown
 *   fields. allErrors stays off, as in routes/knowledge/manifest-validator.ts: a caller-sized body
 *   is not walked to the end to collect every problem, the first one is enough to report.
 * @structure buildBodyContract(doc) · loadBodyContract(file?) · sharedBodyContract() ·
 *   BodyContract.match(method, path) · firstIssue(errors) · routeKey(method, template) ·
 *   normalisePathTemplate(path)
 * @usage
 *   const contract = loadBodyContract();
 *   const op = contract?.match('POST', '/v1/memory/notes');
 *   const check = op?.validator();  // null when the schema could not be compiled
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B5).
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import ajv2020Pkg from 'ajv/dist/2020.js';
import formatsPkg from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { findOpenApiFile } from './openapi-file.js';
import { logger } from '../utils/logger.js';

// The CommonJS default export, read the way routes/knowledge/manifest-validator.ts reads ajv's.
const Ajv2020 = ajv2020Pkg.default ?? ajv2020Pkg;
const addFormats = formatsPkg.default ?? formatsPkg;

/** The `$id` under which the contract's components are known to ajv. */
const CONTRACT_ID = 'aimeat:openapi';
const METHODS = ['post', 'put', 'patch', 'delete'] as const;

export interface BodyOperation {
    /** `POST /v1/memory/{key}`: the method and the contract's own path template. */
    readonly route: string;
    /** routeKey() of the route: the key the mode table and the check use. */
    readonly key: string;
    /** The contract says a body must be sent. */
    readonly bodyRequired: boolean;
    /** The compiled validator, or null when ajv could not compile the schema. */
    validator(): ValidateFunction | null;
}

export interface BodyContract {
    /** The operation that declares a JSON body for this request, or undefined. */
    match(method: string, path: string): BodyOperation | undefined;
    /** Every operation with a JSON body schema, by route key. */
    readonly operations: ReadonlyMap<string, BodyOperation>;
}

/** `/v1/agents/{name}/scopes` and `/v1/agents/:agentName/scopes` both become `/v1/agents/{}/scopes`. */
export function normalisePathTemplate(path: string): string {
    return path.replace(/\{[^}/]*\}/g, '{}').replace(/:[A-Za-z_][\w]*/g, '{}');
}

/** The key a route is known by in the mode table and the check: `POST /v1/memory/{}`. */
export function routeKey(method: string, template: string): string {
    return `${method.toUpperCase()} ${normalisePathTemplate(template)}`;
}

interface TrieNode {
    literal: Map<string, TrieNode>;
    /** Segments with a parameter inside literal text, such as `{name}.json`. */
    mixed: Array<{ re: RegExp; node: TrieNode }>;
    param: TrieNode | null;
    ops: Map<string, BodyOperation>;
}

const newNode = (): TrieNode => ({ literal: new Map(), mixed: [], param: null, ops: new Map() });

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insert(root: TrieNode, template: string, method: string, op: BodyOperation): void {
    let node = root;
    for (const seg of template.split('/').filter(Boolean)) {
        if (/^\{[^}]*\}$/.test(seg)) {
            node.param ??= newNode();
            node = node.param;
        } else if (seg.includes('{')) {
            const re = new RegExp('^' + seg.split(/\{[^}]*\}/).map(escapeRegExp).join('[^/]+') + '$');
            let entry = node.mixed.find(m => m.re.source === re.source);
            if (!entry) { entry = { re, node: newNode() }; node.mixed.push(entry); }
            node = entry.node;
        } else {
            let next = node.literal.get(seg);
            if (!next) { next = newNode(); node.literal.set(seg, next); }
            node = next;
        }
    }
    node.ops.set(method, op);
}

function find(node: TrieNode, segs: readonly string[], i: number, method: string): BodyOperation | undefined {
    if (i === segs.length) return node.ops.get(method);
    const seg = segs[i];
    const lit = node.literal.get(seg);
    if (lit) { const hit = find(lit, segs, i + 1, method); if (hit) return hit; }
    for (const m of node.mixed) {
        if (m.re.test(seg)) { const hit = find(m.node, segs, i + 1, method); if (hit) return hit; }
    }
    return node.param ? find(node.param, segs, i + 1, method) : undefined;
}

/** Keywords that describe a schema and validate nothing; most of the contract's size is in them. */
const PROSE = new Set(['description', 'example', 'examples', 'externalDocs', 'summary']);
/** Keywords whose value maps names to schemas: its keys are field names, never keywords. */
const NAMED_SCHEMAS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
/** Keywords whose value is data: copied as they are. */
const DATA = new Set(['enum', 'const', 'default']);

/**
 * A copy of `schema` without its prose. With `anchor`, its local `$ref`s point into the contract
 * document ajv holds, which an operation's schema needs and the document itself does not.
 */
function slim(schema: unknown, anchor: boolean): unknown {
    if (Array.isArray(schema)) return schema.map(s => slim(s, anchor));
    if (schema === null || typeof schema !== 'object') return schema;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
        if (PROSE.has(k)) continue;
        if (DATA.has(k)) out[k] = v;
        else if (NAMED_SCHEMAS.has(k) && v !== null && typeof v === 'object' && !Array.isArray(v)) out[k] = slimNamed(v as Record<string, unknown>, anchor);
        else out[k] = anchor && k === '$ref' && typeof v === 'string' && v.startsWith('#/') ? `${CONTRACT_ID}${v}` : slim(v, anchor);
    }
    return out;
}

function slimNamed(map: Record<string, unknown>, anchor: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, s] of Object.entries(map)) out[name] = slim(s, anchor);
    return out;
}

interface RawOperation {
    requestBody?: { $ref?: string; required?: boolean; content?: Record<string, { schema?: unknown }> };
}

interface RawDoc {
    paths?: Record<string, Record<string, RawOperation | undefined>>;
    components?: Record<string, unknown> & { requestBodies?: Record<string, RawOperation['requestBody']> };
}

/** Build the contract from a parsed openapi document. Exported for the unit tests. */
export function buildBodyContract(doc: RawDoc): BodyContract {
    const ajv = new Ajv2020({
        allErrors: false,
        strict: false,
        validateFormats: true,
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
        // The contract is ours, but a bad pattern in it must not stop the node: compile errors are caught
        // per operation below, and these keep the rest of the document out of the way.
        validateSchema: false,
        logger: false,
    });
    addFormats(ajv);
    // Only the schemas: a body schema refers to nothing else, and the responses, parameters and
    // examples are most of the components' size.
    const schemas = doc.components?.schemas;
    ajv.addSchema({ $id: CONTRACT_ID, components: { schemas: schemas && typeof schemas === 'object' ? slimNamed(schemas as Record<string, unknown>, false) : {} } });

    const root = newNode();
    const operations = new Map<string, BodyOperation>();
    for (const [template, item] of Object.entries(doc.paths ?? {})) {
        for (const method of METHODS) {
            let body = item?.[method]?.requestBody;
            const ref = body?.$ref;
            if (ref?.startsWith('#/components/requestBodies/')) body = doc.components?.requestBodies?.[ref.slice('#/components/requestBodies/'.length)];
            const schema = body?.content?.['application/json']?.schema;
            if (!schema || typeof schema !== 'object') continue;
            const route = `${method.toUpperCase()} ${template}`;
            const own = slim(schema, true) as object;
            let compiled: ValidateFunction | null | undefined;
            const key = routeKey(method, template);
            const op: BodyOperation = {
                route,
                key,
                bodyRequired: body?.required === true,
                validator(): ValidateFunction | null {
                    if (compiled === undefined) {
                        try { compiled = ajv.compile(own); }
                        catch (err) {
                            compiled = null;
                            logger.warn('openapi body contract: a body schema does not compile; bodies of this route are not checked', { route, error: String(err) });
                        }
                    }
                    return compiled ?? null;
                },
            };
            insert(root, template, method.toUpperCase(), op);
            operations.set(key, op);
        }
    }
    return {
        operations,
        match(method, path) {
            const segs = path.split('/').filter(Boolean);
            return find(root, segs, 0, method.toUpperCase());
        },
    };
}

/** Read openapi.yaml (found as GET /v1/spec finds it) and build the contract; null when there is none. */
export function loadBodyContract(file: string | null = findOpenApiFile()): BodyContract | null {
    if (!file) return null;
    return buildBodyContract(parse(readFileSync(file, 'utf-8')) as RawDoc);
}

// process-local: openapi.yaml read once per process; every process reads the same file.
let shared: BodyContract | null | undefined;

/**
 * The contract of the code that is running, read once per process: the file does not change while
 * the process runs, and a process that builds more than one server (the multi-node tests) reads it
 * once. Null when the install has no openapi.yaml or it cannot be read; the error is thrown once, to
 * the first caller, and later callers get null.
 */
export function sharedBodyContract(): BodyContract | null {
    if (shared !== undefined) return shared;
    shared = null;
    shared = loadBodyContract();
    return shared;
}

export interface BodyIssue {
    /** The field, dotted as models/validation-issues.ts writes it (`items.0.name`); '' is the body. */
    field: string;
    /** One of the detail codes validateBody answers with: required, unknown_field, invalid_type, ... */
    reason: string;
    max?: number;
    min?: number;
    /** The limit is a number of characters, not of items or a numeric bound. */
    text?: boolean;
    /** For invalid_type: the type the contract names. */
    expected?: string;
}

/** Field names come from the caller; keep what reaches a log line short and printable. */
function safeName(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 80);
}

function dotted(instancePath: string, extra?: string): string {
    const parts = instancePath.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (extra !== undefined) parts.push(extra);
    return safeName(parts.join('.'));
}

/**
 * The first ajv error as a field and a reason, never the value: ajv's errors carry the schema's
 * words (the missing property, the expected type, the limit) and not the data, because `verbose` is
 * off.
 */
export function firstIssue(errors: readonly ErrorObject[] | null | undefined): BodyIssue {
    const e = errors?.[0];
    if (!e) return { field: '', reason: 'invalid' };
    const p = e.params as Record<string, unknown>;
    switch (e.keyword) {
        case 'required': return { field: dotted(e.instancePath, String(p.missingProperty)), reason: 'required' };
        case 'additionalProperties': return { field: dotted(e.instancePath, String(p.additionalProperty)), reason: 'unknown_field' };
        case 'unevaluatedProperties': return { field: dotted(e.instancePath, String(p.unevaluatedProperty)), reason: 'unknown_field' };
        case 'maxLength': case 'maxItems': case 'maxProperties': case 'maximum': case 'exclusiveMaximum':
            return { field: dotted(e.instancePath), reason: 'too_long', max: Number(p.limit), text: e.keyword === 'maxLength' };
        case 'minLength': case 'minItems': case 'minProperties': case 'minimum': case 'exclusiveMinimum':
            return { field: dotted(e.instancePath), reason: 'too_short', min: Number(p.limit), text: e.keyword === 'minLength' };
        case 'type': return { field: dotted(e.instancePath), reason: 'invalid_type', expected: String(p.type) };
        case 'enum': case 'const': return { field: dotted(e.instancePath), reason: 'invalid_value' };
        case 'format': case 'pattern': return { field: dotted(e.instancePath), reason: 'invalid_format' };
        default: return { field: dotted(e.instancePath), reason: safeName(e.keyword) };
    }
}
