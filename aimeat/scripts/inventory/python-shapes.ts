/**
 * @file scripts/inventory/python-shapes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The offer and signal shapes written twice, compared field by field: the node's zod
 *   schemas (src/models/offer-schemas.ts, src/models/workflow-signals.ts) and the Python package's
 *   builders (python/aimeat-crewai/src/aimeat_crewai/offers.py, workflow_spec.py).
 *
 *   WHY IT EXISTS. The Python package builds an agent's offers document and its workflow signals by
 *   hand, in dicts, and says in its own docstring that "the node schema wins on any mismatch". Until
 *   2026-10-18 nothing compared them, so a field added to OfferSchema reached a Python crew only if
 *   someone remembered (architecture review 2026-08-11, quality round 2026-10-18; wish
 *   wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 *
 *   TWO HALVES, and they cover different things.
 *   - This module (the gate, `pnpm check:python-shapes`): the node side is the JSON Schema zod
 *     generates; the Python side is read from the source text, because the gate has no Python. It
 *     compares NAMES: every top-level offer field, which of them are required, the offers document's
 *     fields, every deterministic signal op and the fields each leaf carries, the composites, and
 *     the two constants both sides spell out (the pacing ceiling and the "no input" literal).
 *   - python/aimeat-crewai/tests/test_node_schema_parity.py (pytest, in the package's CI workflow):
 *     builds offers and signals with the Python builders and validates them against the same JSON
 *     Schema, read from the committed fixture this module writes. That half checks VALUES.
 *   The fixture is the node's schema as JSON. The gate fails when it is stale, so a node schema
 *   change reaches the pytest in the same commit.
 *
 *   READING THE PYTHON SOURCE. The extraction reads four literal shapes and nothing else: the
 *   `offer = {...}` and `optional = {...}` dicts in build_offer, the keyword-only signature of
 *   build_offer (a parameter without a default is required), the `doc = {...}` dict and its
 *   `doc["x"] =` assignments in build_offers_doc, and in workflow_spec.py the DETERMINISTIC_OPS
 *   frozenset, each Sig method's `_leaf("op", ..., name=...)` call and its `extra` dict, the llm
 *   and composite dict literals. When one of them is not found the gate fails with "cannot read",
 *   never green: a refactor of the Python builders has to come with a change here.
 * @structure
 *   - nodeShapes(): the JSON Schemas from zod, the fixture's content
 *   - readPythonShapes(src): what the Python builders emit, from the source text
 *   - shapeFindings(node, py): the finding ids (stable strings, the allowlist's keys)
 *   - SHAPE_CEILING, readShapeAllowlist()
 * @usage import { nodeShapes, readPythonShapes, shapeFindings } from './inventory/python-shapes.js';
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { OffersDocSchema, TOLL_MORSELS_MAX } from '../../src/models/offer-schemas.js';
import { SignalSchema } from '../../src/models/workflow-signals.js';

/** The number of allowlisted differences. Deleting an entry lowers it in the same change; raising it is the developer's decision. */
export const SHAPE_CEILING = 17;

type Json = Record<string, unknown>;

interface ObjectShape { properties: string[]; required: string[] }

/**
 * The node side, as the fixture holds it and as the comparison reads it. One offer is
 * `offersDoc.properties.offers.items` (its signals are `$ref`s into the document's own `$defs`), so
 * the offer is not written out a second time.
 */
export interface NodeShapes {
    offersDoc: Json;
    signal: Json;
    constants: { TOLL_MORSELS_MAX: number; REQUIRED_TO_FUNCTION_NONE: string };
}

/** One offer's schema, inside the offers document's. */
const offerOf = (offersDoc: Json): Json => ((offersDoc.properties as Record<string, Json>).offers.items as Json);

/** The node's schemas as JSON Schema (zod v4 `toJSONSchema`, input side, the shape a client sends). */
export function nodeShapes(): NodeShapes {
    const opts = { io: 'input', unrepresentable: 'any' } as const;
    return {
        offersDoc: z.toJSONSchema(OffersDocSchema, opts) as Json,
        signal: z.toJSONSchema(SignalSchema, opts) as Json,
        // The literal OfferSchema's `required_to_function` accepts beside a signal.
        constants: { TOLL_MORSELS_MAX, REQUIRED_TO_FUNCTION_NONE: 'none' },
    };
}

const objectShape = (s: Json): ObjectShape => ({
    properties: Object.keys((s.properties ?? {}) as Json),
    required: [...((s.required ?? []) as string[])],
});

interface SignalShapes {
    /** op -> its leaf's fields and required fields (kind/op/key/key_glob included). */
    ops: Map<string, ObjectShape>;
    llm: ObjectShape | null;
    /** The composite keys: all, any, when, then. */
    composites: string[];
}

/** The signal grammar from the JSON Schema: the deterministic ops (a oneOf), the llm leaf and the composites. */
export function nodeSignalShapes(signal: Json): SignalShapes {
    const ops = new Map<string, ObjectShape>();
    let llm: ObjectShape | null = null;
    const composites: string[] = [];
    const visit = (s: Json): void => {
        for (const k of ['anyOf', 'oneOf'] as const) for (const c of (s[k] ?? []) as Json[]) visit(c);
        const props = (s.properties ?? {}) as Record<string, Json>;
        const op = props.op?.const;
        const kind = props.kind?.const;
        if (typeof op === 'string') ops.set(op, objectShape(s));
        else if (kind === 'llm') llm = objectShape(s);
        else if (s.properties) composites.push(...Object.keys(props));
    };
    visit(signal);
    return { ops, llm, composites: [...new Set(composites)].sort() };
}

// ── Python side ──────────────────────────────────────────────────────────────

export interface PythonShapes {
    /** Every key build_offer can put on an offer, and the keys it always puts. */
    offer: ObjectShape;
    offersDoc: ObjectShape;
    signal: SignalShapes;
    constants: { TOLL_MORSELS_MAX: number | null; NONE: string | null };
    /** What could not be read; any entry fails the gate. */
    unreadable: string[];
}

/** The keys of the first `<name>...= {` dict literal after `from` (one level, string keys only). */
function dictKeys(text: string, name: string): string[] | null {
    const m = new RegExp(`\\b${name}\\b[^=\\n]*=\\s*\\{`).exec(text);
    if (!m) return null;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
    }
    const body = text.slice(start, i - 1);
    // Keys at the top level of the literal only: drop nested brackets first.
    let flat = body;
    for (let prev = ''; prev !== flat;) { prev = flat; flat = flat.replace(/\{[^{}]*\}|\[[^[\]]*\]|\([^()]*\)/g, ''); }
    return [...flat.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:/g)].map(k => k[1]);
}

/** The body of a top-level `def name(` up to the next top-level statement. */
function defBody(text: string, name: string, indent = ''): string | null {
    const start = text.search(new RegExp(`^${indent}def ${name}\\(`, 'm'));
    if (start < 0) return null;
    // From the line after the `def`; the signature's continuation lines are indented.
    const from = text.indexOf('\n', start) + 1;
    const next = text.slice(from).search(new RegExp(`^${indent}(?:def |class |@|[A-Za-z_])`, 'm'));
    return text.slice(start, next < 0 ? undefined : from + next);
}

/** build_offer's keyword-only parameters without a default: the ones a caller must pass. */
function requiredParams(body: string): string[] {
    const sig = /def build_offer\(([\s\S]*?)\)\s*->/.exec(body)?.[1] ?? '';
    return sig.split('\n').map(l => l.trim()).filter(l => /^[a-z_]+\s*:/.test(l) && !l.includes('=')).map(l => l.split(':')[0].trim());
}

/** The Python builders' shapes, from offers.py and workflow_spec.py under `src` (the package's source directory). */
export function readPythonShapes(src: string): PythonShapes {
    const unreadable: string[] = [];
    const offersPy = readFileSync(join(src, 'offers.py'), 'utf8');
    const specPy = readFileSync(join(src, 'workflow_spec.py'), 'utf8');

    // build_offer: `offer = {"id": id, ...}` always, `optional = {...}` when the value is not None.
    const buildOffer = defBody(offersPy, 'build_offer') ?? '';
    const base = dictKeys(buildOffer, 'offer');
    const optional = dictKeys(buildOffer, 'optional');
    if (!base || !optional) unreadable.push('offers.py build_offer: the `offer = {...}` or `optional = {...}` dict');
    const params = requiredParams(buildOffer);
    if (params.length === 0) unreadable.push('offers.py build_offer: its keyword-only signature');
    // A key is always on the offer when the base dict sets it from a parameter the caller must pass.
    const required = (base ?? []).filter(k => params.some(p => new RegExp(`["']${k}["']\\s*:\\s*${p}\\b`).test(buildOffer)));

    const buildDoc = defBody(offersPy, 'build_offers_doc') ?? '';
    const docBase = dictKeys(buildDoc, 'doc');
    if (!docBase) unreadable.push('offers.py build_offers_doc: the `doc = {...}` dict');
    const docExtra = [...buildDoc.matchAll(/\bdoc\[["']([A-Za-z_]+)["']\]\s*=/g)].map(m => m[1]);

    const toll = /^TOLL_MORSELS_MAX\s*=\s*(\d+)/m.exec(offersPy);
    const none = /^NONE\s*=\s*["']([^"']*)["']/m.exec(specPy);

    return {
        offer: { properties: [...new Set([...(base ?? []), ...(optional ?? [])])], required },
        offersDoc: { properties: [...new Set([...(docBase ?? []), ...docExtra])], required: docBase ?? [] },
        signal: readPythonSignals(specPy, unreadable),
        constants: { TOLL_MORSELS_MAX: toll ? Number(toll[1]) : null, NONE: none ? none[1] : null },
        unreadable,
    };
}

/** Sig's builders: per op the fields its leaf can carry and the ones it always carries. */
function readPythonSignals(specPy: string, unreadable: string[]): SignalShapes {
    const opsLiteral = /DETERMINISTIC_OPS\s*=\s*frozenset\(\s*\{([^}]*)\}/.exec(specPy)?.[1];
    if (!opsLiteral) unreadable.push('workflow_spec.py: the DETERMINISTIC_OPS frozenset');
    const declared = [...(opsLiteral ?? '').matchAll(/["']([a-z_]+)["']/g)].map(m => m[1]);
    // Every leaf `_leaf()` builds: kind and op always, exactly one of key | key_glob.
    const leafBase = { properties: ['kind', 'op', 'key', 'key_glob'], required: ['kind', 'op'] };
    const ops = new Map<string, ObjectShape>();
    const sigClass = specPy.slice(specPy.indexOf('class Sig'));
    for (const method of sigClass.split(/\n\s*@staticmethod\n/).slice(1)) {
        const call = /_leaf\(\s*["']([a-z_]+)["']\s*,\s*key\s*,\s*key_glob\s*(?:,\s*([^)]*))?\)/.exec(method);
        if (!call) continue;
        const always = new Set<string>();
        const maybe = new Set<string>();
        for (const kw of (call[2] ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
            if (kw.startsWith('**')) continue;
            always.add(kw.split('=')[0].trim());
        }
        const extraInit = dictKeys(method, 'extra');
        for (const k of extraInit ?? []) always.add(k);
        for (const m of method.matchAll(/\bextra\[["']([a-z_]+)["']\]\s*=/g)) maybe.add(m[1]);
        ops.set(call[1], {
            properties: [...leafBase.properties, ...always, ...maybe],
            required: [...leafBase.required, ...always],
        });
    }
    // An op Python supports is one validate_signal accepts (DETERMINISTIC_OPS); a builder for any other
    // op makes signals its own validator refuses, so it does not count. A declared op with no builder
    // carries the leaf's base fields only.
    for (const op of [...ops.keys()]) if (!declared.includes(op)) ops.delete(op);
    for (const op of declared) if (!ops.has(op)) ops.set(op, { ...leafBase });
    if (ops.size === 0) unreadable.push('workflow_spec.py: no Sig builder calls `_leaf("op", key, key_glob, ...)`');
    // Sig.llm returns the leaf dict itself: {"kind": "llm", "ask": ask, "key": key} or key_glob.
    const llmMethod = /def llm\([\s\S]*?(?=@staticmethod)/.exec(sigClass)?.[0] ?? '';
    const llmKeys = [...llmMethod.matchAll(/\{([^{}]*"kind":\s*"llm"[^{}]*)\}/g)]
        .flatMap(m => [...m[1].matchAll(/["']([a-z_]+)["']\s*:/g)].map(k => k[1]));
    if (llmKeys.length === 0) unreadable.push('workflow_spec.py: Sig.llm\'s leaf dict');
    const composites = [...sigClass.matchAll(/return\s*\{\s*["'](all|any|when)["']\s*:[^}]*\}/g)]
        .flatMap(m => [...m[0].matchAll(/["']([a-z_]+)["']\s*:/g)].map(k => k[1]));
    return {
        ops,
        llm: llmKeys.length ? { properties: [...new Set(llmKeys)], required: ['kind', 'ask'].filter(k => llmKeys.includes(k)) } : null,
        composites: [...new Set(composites)].sort(),
    };
}

// ── Comparison ───────────────────────────────────────────────────────────────

const minus = (a: string[], b: string[]): string[] => a.filter(x => !b.includes(x)).sort();

/** One side's object against the other's, as finding ids under `prefix`. */
function compareObject(prefix: string, node: ObjectShape, py: ObjectShape): string[] {
    return [
        ...minus(node.properties, py.properties).map(f => `${prefix}.field.node-only:${f}`),
        ...minus(py.properties, node.properties).map(f => `${prefix}.field.python-only:${f}`),
        // A field the node requires that the Python builder can leave out, and the other way round.
        ...minus(node.required, py.required).map(f => `${prefix}.required.node-only:${f}`),
        ...minus(py.required, node.required).map(f => `${prefix}.required.python-only:${f}`),
    ];
}

/** Every difference between the node's shapes and the Python builders', as stable ids. */
export function shapeFindings(node: NodeShapes, py: PythonShapes): string[] {
    const out: string[] = [];
    out.push(...compareObject('offer', objectShape(offerOf(node.offersDoc)), py.offer));
    out.push(...compareObject('offersDoc', objectShape(node.offersDoc), py.offersDoc));
    const ns = nodeSignalShapes(node.signal);
    const nodeOps = [...ns.ops.keys()];
    const pyOps = [...py.signal.ops.keys()];
    out.push(...minus(nodeOps, pyOps).map(op => `signal.op.node-only:${op}`));
    out.push(...minus(pyOps, nodeOps).map(op => `signal.op.python-only:${op}`));
    for (const op of nodeOps) {
        const p = py.signal.ops.get(op);
        if (p) out.push(...compareObject(`signal.${op}`, ns.ops.get(op)!, p));
    }
    if (ns.llm && py.signal.llm) out.push(...compareObject('signal.llm', ns.llm, py.signal.llm));
    out.push(...minus(ns.composites, py.signal.composites).map(k => `signal.composite.node-only:${k}`));
    out.push(...minus(py.signal.composites, ns.composites).map(k => `signal.composite.python-only:${k}`));
    if (py.constants.TOLL_MORSELS_MAX !== node.constants.TOLL_MORSELS_MAX) out.push('constant:TOLL_MORSELS_MAX');
    if (py.constants.NONE !== node.constants.REQUIRED_TO_FUNCTION_NONE) out.push('constant:NONE');
    return out;
}

// ── Allowlist ────────────────────────────────────────────────────────────────

export const SHAPE_ALLOWLIST = 'security/python-shape-parity.json';

/** The allowlist's entries: finding id -> the reason that difference is deliberate. */
export function readShapeAllowlist(aimeatDir: string): Record<string, string> {
    const raw = JSON.parse(readFileSync(join(aimeatDir, SHAPE_ALLOWLIST), 'utf8')) as { exempt?: Record<string, string> };
    return raw.exempt ?? {};
}
