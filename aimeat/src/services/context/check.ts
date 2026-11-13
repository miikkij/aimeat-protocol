/**
 * @file src/services/context/check.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A machine check of one context: does what it points at still exist, and does what
 *   its ontology claims still stand in the sources it names. Behind GET /v1/memory/context-check/:slug
 *   and the aimeat_context_check MCP tool. It reads; it never changes the context.
 *
 *   WHAT IT CHECKS
 *   - the record: type, name, summary and core are there;
 *   - every `references[].ref` of kind `memory:<key>` and `context:<slug>` opens; other kinds
 *     (workspace, file, organism, app, https, another person's memory) are counted as not checked;
 *   - every context in `includes`, `excludes` and the leaves of `compose` exists;
 *   - a concept's `replacedBy` names another concept of the record;
 *   - the ontology module, when the record names one (`module: "vocab.ctx.<name>"`, read through its
 *     index `vocab.ctx.<name>.index` and the parts it lists, or `ontologyModules`, a list of keys):
 *     every source quote (`prov:wasDerivedFrom[].prov:value` from `dcterms:source` `memory:<key>`) is
 *     still found in that record, compared case-insensitive with whitespace collapsed and Markdown
 *     bold and code marks dropped, in its text or, for a record of fields, in its flat reading
 *     (field names before values); every
 *     `vocab:ctx.<module>/…` id the concepts name resolves, in the module, the core
 *     (`vocab.ctx.core`), the registry (`vocab.ctx.registry`) or another module the caller may read;
 *     a `dcterms:isReplacedBy` chain ends and does not loop; a superseded statement names its
 *     replacement; a statement has at least one source.
 *   - the lifecycle marks the connecting AI also sees: untouched for CONTEXT_STALE_DAYS, a core
 *     past CONTEXT_CORE_LARGE.
 *
 *   EVERY READ IS THE CALLER'S READ. A record goes through the same gates as aimeat_memory_read with
 *   owner_scope (the same-owner view, the organism rule, the classification reader), so the check
 *   tells nothing about a record the caller could not open: such a target is reported as "not found
 *   or not open to you", one finding for both.
 *
 *   BOUNDED. At most CHECK_MAX_READS records are read and CHECK_MAX_FINDINGS findings returned.
 * @structure CHECK_MAX_READS · CHECK_MAX_FINDINGS · ContextFinding · quoteStands() · isDefinition() · checkContext()
 * @usage
 *   const out = await checkContext({ storage, config }, caller, reader, 'lisbon-trip');
 * @version-history
 *   v1.1.0 — 2026-11-13 — A quote also stands in a record's flat reading (each field's name before its
 *     value, numbers included), so a quote taken from a JSON record is found (quoteStands); a concept
 *     under `…/class/` is a definition and gets no no-source warning. Both were false findings on
 *     real modules imported to an account.
 *   v1.0.0 — 2026-11-09 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import type { ContentReader } from '../classification/reader.js';
import { presentMemory } from '../classification/present-memory.js';
import { ownerScopeView, readsAsOwner } from '../owner-scope-read.js';
import { organismReadableRecords } from '../organism-namespace-access.js';
import { CONTEXT_PREFIX, CONTEXT_TYPE, CONTEXT_STALE_DAYS, CONTEXT_CORE_LARGE } from './index-line.js';

export const CHECK_MAX_READS = 400;
export const CHECK_MAX_FINDINGS = 200;

export interface ContextFinding {
    severity: 'error' | 'warning' | 'info';
    kind: string;
    /** The field or the concept id the finding is about. */
    where: string;
    message: string;
    source?: string;
}

export type ContextCheckResult =
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; status: number; code: string; message: string };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^vocab:ctx\.([a-z0-9][a-z0-9-]*)(\/|$)/;
const NOT_OPEN = 'not found or not open to you';

/** Every string leaf of a value, joined: the text a quote is looked for in. */
function textOf(v: unknown, out: string[] = []): string[] {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) textOf(x, out);
    else if (isObj(v)) for (const x of Object.values(v)) textOf(x, out);
    return out;
}
/** A quote is of the words, not the formatting: Markdown bold and code marks, case and runs of
 *  whitespace do not count. Measured on a real module: 16 of 636 quotes failed on `**` alone. */
const norm = (s: string): string => s.normalize('NFC').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A value read flat, each field's name before its value, numbers and booleans included:
 *  {"seeds":10,"measured":"2026-09-08"} reads "seeds 10 measured 2026-09-08". */
function flatOf(v: unknown, out: string[] = []): string[] {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.push(String(v));
    else if (Array.isArray(v)) for (const x of v) flatOf(x, out);
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) { out.push(k); flatOf(x, out); }
    return out;
}
/** The flat reading's comparison: also blind to the commas, colons and semicolons that separate
 *  fields when a quote is written out of a record. */
const loose = (s: string): string => norm(s).replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Whether a source quote still stands in a record's value: in its text (the string leaves), or, for
 * a record of fields, in its flat reading. A quote taken from a JSON record names a field and its
 * value ("runId parvi-a-42", "seeds 10"), which the string leaves alone never hold: measured on a
 * real module on 2026-11-13, three quotes from unchanged records were reported as gone.
 */
export function quoteStands(value: unknown, quote: string): boolean {
    if (norm(textOf(value).join('\n')).includes(norm(quote))) return true;
    return typeof value === 'object' && value !== null && loose(flatOf(value).join(' ')).includes(loose(quote));
}

/** A class of the module (`…/class/<Name>`, or typed as a class or a scheme) is a definition, and a
 *  definition names no source; only the statements under it do. */
export const isDefinition = (id: string, type: unknown): boolean =>
    /\/class\//.test(id) || (typeof type === 'string' && /Class|ConceptScheme/.test(type));

/** Every `vocab:ctx.…` id named anywhere inside a value, except under `@id` of the value itself. */
function idsIn(v: unknown, out: Set<string>, top = true): Set<string> {
    if (typeof v === 'string') { if (ID_RE.test(v)) out.add(v); }
    else if (Array.isArray(v)) for (const x of v) idsIn(x, out, false);
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) { if (!(top && k === '@id')) idsIn(x, out, false); }
    return out;
}

/** The leaf contexts of a compose expression. */
function composeLeaves(expr: unknown, out: string[] = []): string[] {
    if (typeof expr === 'string') out.push(expr);
    else if (Array.isArray(expr)) for (const x of expr) composeLeaves(x, out);
    else if (isObj(expr)) for (const x of Object.values(expr)) composeLeaves(x, out);
    return out;
}

/** The concepts of one ontology record: `concepts` or `@graph`. */
function conceptsOf(v: unknown): Json[] {
    if (!isObj(v)) return [];
    const list = Array.isArray(v.concepts) ? v.concepts : Array.isArray(v['@graph']) ? v['@graph'] : [];
    return list.filter(isObj);
}

/** Check one context of the caller's person. */
export async function checkContext(
    deps: { storage: Storage; config: AimeatConfig },
    caller: CallerContext,
    reader: ContentReader,
    slugOrKey: string,
    now = Date.now(),
): Promise<ContextCheckResult> {
    const { storage } = deps;
    if (caller.kind === 'ecosystem' || caller.kind === 'app' || caller.visitor || caller.kind === 'anonymous') {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: "A context is checked by its person or by one of that person's agents." };
    }
    const findings: ContextFinding[] = [];
    let findingsTruncated = false;
    const add = (f: ContextFinding): void => {
        if (findings.length >= CHECK_MAX_FINDINGS) { findingsTruncated = true; return; }
        findings.push(f);
    };

    // ── One read, through the caller's gates, cached ──
    const cache = new Map<string, MemoryRecord | null>();
    let reads = 0;
    let readsTruncated = false;
    const open = async (key: string): Promise<MemoryRecord | null> => {
        if (cache.has(key)) return cache.get(key)!;
        if (reads >= CHECK_MAX_READS) { readsTruncated = true; return null; }
        reads++;
        let rec = await storage.getMemory(caller.principal, key);
        if (!rec && caller.ownerGhii !== caller.principal) {
            const found = await storage.getMemory(caller.ownerGhii, key);
            rec = found && ownerScopeView([found], caller.principal, readsAsOwner(caller)).length ? found : null;
        }
        if (rec && !(await organismReadableRecords(deps, caller, [rec])).length) rec = null;
        const shown = rec ? await presentMemory(reader, rec) : null;
        cache.set(key, shown);
        return shown;
    };

    const key = slugOrKey.startsWith(CONTEXT_PREFIX) ? slugOrKey : CONTEXT_PREFIX + slugOrKey;
    const record = await open(key);
    if (!record) return { ok: false, status: 404, code: 'NOT_FOUND', message: `Context ${key} is ${NOT_OPEN}.` };
    const v = isObj(record.value) ? record.value : {};

    // ── The record ──
    if (v.type !== CONTEXT_TYPE) add({ severity: 'warning', kind: 'shape', where: 'type', message: `type is not ${CONTEXT_TYPE}` });
    for (const f of ['name', 'summary', 'core'] as const) {
        if (typeof v[f] !== 'string' || !(v[f] as string).trim()) add({ severity: 'error', kind: 'shape', where: f, message: `${f} is missing or empty` });
    }

    // ── References ──
    const refStats = { checked: 0, missing: 0, notChecked: 0 };
    const refs = Array.isArray(v.references) ? v.references.filter(isObj) : [];
    for (const [i, r] of refs.entries()) {
        const ref = typeof r.ref === 'string' ? r.ref : '';
        const where = `references[${i}] ${ref}`;
        let target: string | null = null;
        if (ref.startsWith('memory:') && !ref.slice(7).includes('/')) target = ref.slice(7);
        else if (ref.startsWith('context:')) target = CONTEXT_PREFIX + ref.slice(8);
        if (!target) { refStats.notChecked++; continue; }
        refStats.checked++;
        if (!(await open(target))) { refStats.missing++; add({ severity: 'error', kind: 'reference-missing', where, message: `the reference is ${NOT_OPEN}` }); }
        if (typeof r.openWhen !== 'string' || !r.openWhen.trim()) add({ severity: 'info', kind: 'reference-no-openwhen', where, message: 'the reference does not say when it is worth opening' });
    }

    // ── Included, excluded, composed contexts ──
    const linked = [
        ...(Array.isArray(v.includes) ? v.includes : []).map(x => ['includes', x] as const),
        ...(Array.isArray(v.excludes) ? v.excludes : []).map(x => ['excludes', x] as const),
        ...composeLeaves(v.compose).map(x => ['compose', x] as const),
    ];
    for (const [field, ref] of linked) {
        if (typeof ref !== 'string' || !ref.startsWith('context:')) {
            add({ severity: 'error', kind: 'compose-shape', where: field, message: `${JSON.stringify(ref)} is not context:<slug>` });
            continue;
        }
        if (!(await open(CONTEXT_PREFIX + ref.slice(8)))) add({ severity: 'error', kind: 'context-missing', where: `${field} ${ref}`, message: `the context is ${NOT_OPEN}` });
    }

    // ── Plain concepts ──
    const plain = Array.isArray(v.concepts) ? v.concepts.filter(isObj) : [];
    const terms = new Set(plain.map(c => c.term).filter((t): t is string => typeof t === 'string'));
    for (const c of plain) {
        if (typeof c.replacedBy === 'string' && c.replacedBy && !terms.has(c.replacedBy)) {
            add({ severity: 'warning', kind: 'replaced-by-unknown', where: `concepts[term=${String(c.term)}]`, message: `replacedBy names "${c.replacedBy}", which no concept of this context has` });
        }
    }

    // ── The ontology module ──
    const onto = { modules: 0, parts: 0, concepts: 0, quotesChecked: 0, quotesNotFound: 0, sourcesMissing: 0, idsChecked: 0, idsDangling: 0, idsUnopenable: 0 };
    const known = new Map<string, Json>();     // id -> concept, every module loaded
    const loadedModules = new Map<string, boolean>(); // module name -> readable

    const loadParts = async (keys: string[]): Promise<Json[]> => {
        const out: Json[] = [];
        for (const k of keys) {
            const rec = await open(k);
            if (!rec) { add({ severity: 'error', kind: 'module-part-missing', where: k, message: `the module part is ${NOT_OPEN}` }); continue; }
            onto.parts++;
            for (const c of conceptsOf(rec.value)) { if (typeof c['@id'] === 'string') known.set(c['@id'], c); out.push(c); }
        }
        return out;
    };
    /** A module by its base key: through its index when it has one, else the record itself. */
    const loadModule = async (base: string): Promise<{ readable: boolean; concepts: Json[] }> => {
        const index = await open(`${base}.index`);
        if (index && isObj(index.value)) {
            const parts = (Array.isArray(index.value['dcterms:hasPart']) ? index.value['dcterms:hasPart'] : [])
                .map(p => (isObj(p) && typeof p.key === 'string' ? p.key : null)).filter((k): k is string => !!k);
            return { readable: true, concepts: await loadParts(parts) };
        }
        const whole = await open(base);
        if (!whole) return { readable: false, concepts: [] };
        onto.parts++;
        const cs = conceptsOf(whole.value);
        for (const c of cs) if (typeof c['@id'] === 'string') known.set(c['@id'], c);
        return { readable: true, concepts: cs };
    };

    let own: Json[] = [];
    if (typeof v.module === 'string' && v.module.startsWith('vocab.ctx.')) {
        const m = await loadModule(v.module);
        if (!m.readable) add({ severity: 'error', kind: 'module-missing', where: `module ${v.module}`, message: `the ontology module is ${NOT_OPEN}` });
        else { onto.modules++; loadedModules.set(v.module.slice('vocab.ctx.'.length), true); own = m.concepts; }
    } else if (Array.isArray(v.ontologyModules) && v.ontologyModules.length) {
        const keys = v.ontologyModules.filter((k): k is string => typeof k === 'string');
        own = await loadParts(keys);
        onto.modules++;
        for (const k of keys) { const mm = /^vocab\.ctx\.([a-z0-9-]+)/.exec(k); if (mm) loadedModules.set(mm[1]!, true); }
    }

    if (own.length) {
        for (const shared of ['core', 'registry']) {
            if (!loadedModules.has(shared)) loadedModules.set(shared, (await loadModule(`vocab.ctx.${shared}`)).readable);
        }
        onto.concepts = own.length;
        for (const c of own) {
            const id = typeof c['@id'] === 'string' ? c['@id'] : '(a concept with no @id)';
            // Sources: each quote still stands in the record it names.
            const derived = Array.isArray(c['prov:wasDerivedFrom']) ? c['prov:wasDerivedFrom'].filter(isObj)
                : isObj(c['prov:wasDerivedFrom']) ? [c['prov:wasDerivedFrom'] as Json] : [];
            if (!derived.length && !isDefinition(id, c['@type'])) add({ severity: 'warning', kind: 'no-source', where: id, message: 'the statement names no source' });
            for (const d of derived) {
                const src = typeof d['dcterms:source'] === 'string' ? d['dcterms:source'] : '';
                const quote = typeof d['prov:value'] === 'string' ? d['prov:value'] : '';
                if (!src.startsWith('memory:') || src.slice(7).includes('/') || !quote) continue;
                onto.quotesChecked++;
                const rec = await open(src.slice(7));
                if (!rec) { onto.sourcesMissing++; add({ severity: 'error', kind: 'source-missing', where: id, source: src, message: `the source is ${NOT_OPEN}` }); continue; }
                if (!quoteStands(rec.value, quote)) {
                    onto.quotesNotFound++;
                    add({ severity: 'error', kind: 'quote-not-found', where: id, source: src, message: `the quote is no longer in its source: "${quote.slice(0, 120)}"` });
                }
            }
            // Ids: every id the concept names resolves.
            for (const ref of idsIn(c, new Set<string>())) {
                onto.idsChecked++;
                if (known.has(ref)) continue;
                const mod = ID_RE.exec(ref)![1]!;
                if (!loadedModules.has(mod)) {
                    const m = await loadModule(`vocab.ctx.${mod}`);
                    loadedModules.set(mod, m.readable);
                }
                if (known.has(ref)) continue;
                // A bare module id counts when its module is open.
                if (loadedModules.get(mod)) {
                    if (ref === `vocab:ctx.${mod}`) continue;
                    onto.idsDangling++;
                    add({ severity: 'error', kind: 'dangling-id', where: id, message: `${ref} names nothing in vocab.ctx.${mod}` });
                } else {
                    onto.idsUnopenable++;
                    add({ severity: 'info', kind: 'reference-unopenable', where: id, message: `${ref} points into vocab.ctx.${mod}, which is ${NOT_OPEN}` });
                }
            }
            // Replacement chains.
            const status = typeof c['aimeat:status'] === 'string' ? c['aimeat:status'] : '';
            const next = typeof c['dcterms:isReplacedBy'] === 'string' ? c['dcterms:isReplacedBy'] : null;
            if (/superseded$/.test(status) && !next) add({ severity: 'warning', kind: 'superseded-without-replacement', where: id, message: 'marked superseded, but names no replacement' });
            if (next) {
                const seen = new Set<string>([id]);
                let cur: string | null = next;
                while (cur) {
                    if (seen.has(cur)) { add({ severity: 'error', kind: 'replacement-loop', where: id, message: `the replacement chain loops at ${cur}` }); break; }
                    seen.add(cur);
                    const n: Json | undefined = known.get(cur);
                    cur = n && typeof n['dcterms:isReplacedBy'] === 'string' ? n['dcterms:isReplacedBy'] as string : null;
                }
            }
        }
    }

    // ── Lifecycle ──
    const lc = isObj(v.lifecycle) ? v.lifecycle : {};
    const shaped = Date.parse(String(lc.shapedAt ?? lc.createdAt ?? record.updatedAt));
    if (Number.isFinite(shaped) && now - shaped > CONTEXT_STALE_DAYS * 86_400_000) {
        add({ severity: 'info', kind: 'stale', where: 'lifecycle.shapedAt', message: `nobody has shaped it for over ${CONTEXT_STALE_DAYS} days` });
    }
    if (typeof v.core === 'string' && v.core.length > CONTEXT_CORE_LARGE) {
        add({ severity: 'info', kind: 'large-core', where: 'core', message: `the core is ${v.core.length} characters, past ${CONTEXT_CORE_LARGE}: condense it or split a part off` });
    }

    const errors = findings.filter(f => f.severity === 'error').length;
    return {
        ok: true,
        data: {
            context: key,
            version: record.version,
            healthy: errors === 0,
            counts: {
                errors, warnings: findings.filter(f => f.severity === 'warning').length, info: findings.filter(f => f.severity === 'info').length,
                references: refStats,
                ontology: onto,
                records_read: reads,
            },
            findings,
            ...(findingsTruncated ? { findings_truncated: true } : {}),
            ...(readsTruncated ? { reads_truncated: true } : {}),
        },
    };
}
