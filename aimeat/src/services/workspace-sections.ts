/**
 * @file src/services/workspace-sections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The section index of a workspace's document space, as plain data: what a valid index
 *   is, what changed between two of them, and how a change is applied on top of an index that has
 *   moved on since. No storage, no caller: services/workspace-member-changes.ts decides who may
 *   change an index and where it is written, and this file decides what the change is.
 *
 *   WHY A CHANGE IS A LIST OF STEPS AND NOT A NEW INDEX. The web page sends the whole index back
 *   every time a section is added, renamed or a document is dragged into one. A member's change that
 *   waits for an admin's approval can wait for days, and in that time the creator reorganises the
 *   same index. Approving "replace the index with the one the member saw" would undo the creator's
 *   work without a word, so a suggestion stores the steps that turn the index the member started
 *   from into the one they sent (diffSections), and an approval applies those steps to the index as
 *   it is at that moment (applySectionOps). When nothing moved in between, the result is exactly what
 *   the member sent.
 *
 *   A section is { id, name, parentId, documents, color? }. The page renders the tree from its roots,
 *   so a section that is its own parent recurses without end: validateSections refuses that and any
 *   longer cycle, and normalizeSectionTree breaks one that a merge produced.
 * @structure
 *   - Section, SectionOp — the index entry and one step of a change
 *   - SECTION_COLORS, MAX_SECTIONS, MAX_DOCS_PER_SECTION, MAX_SECTION_OPS — the bounds
 *   - validateSections(raw) — the index a caller sent, checked and cleaned, or the reason it is not one
 *   - readStoredSections(value) — the index a record holds, leniently (a broken record reads as empty)
 *   - diffSections(from, to) — the steps from one index to another
 *   - applySectionOps(current, ops) — those steps on top of another index
 *   - normalizeSectionTree(sections) — missing parents cleared, cycles broken, documents deduped
 *   - validateSectionOps(raw) — stored steps checked again before they are applied
 *   - summarizeSectionOps(ops) — the change in counts, for a person deciding on it
 * @usage
 *   const v = validateSections(body.sections); if ('error' in v) return refuse(400, v.error);
 *   const ops = diffSections(stored, v.sections);
 *   const merged = applySectionOps(storedNow, ops);
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: the member change doors (workspace actions for plain members).
 */

/** One section of a document space's index. */
export interface Section {
    id: string;
    name: string;
    parentId: string | null;
    documents: string[];
    color?: string;
}

/** One step of a change to an index. `id` always names a section. */
export type SectionOp =
    | { op: 'add'; id: string; name: string; parentId: string | null; color?: string }
    | { op: 'remove'; id: string }
    | { op: 'rename'; id: string; name: string }
    | { op: 'move'; id: string; parentId: string | null }
    | { op: 'color'; id: string; color: string | null }
    | { op: 'file'; id: string; doc: string }
    | { op: 'unfile'; id: string; doc: string };

/** The colour tags the page offers (workspace/color-picker.js). A colour is a class name there. */
export const SECTION_COLORS: readonly string[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
export const MAX_SECTIONS = 500;
export const MAX_DOCS_PER_SECTION = 5000;
/** How many steps one pending suggestion may carry before an admin has to look at it. */
export const MAX_SECTION_OPS = 1000;

const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 200;
const MAX_DOC_ID = 200;

/** A document id as the index holds it: a short string without control characters. */
function isDocId(v: unknown): v is string {
    // eslint-disable-next-line no-control-regex -- the point is to refuse control characters
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_DOC_ID && !/[\u0000-\u001f]/.test(v);
}

/** A parent chain that returns to where it started. */
function hasCycle(sections: Section[]): string | null {
    const parentOf = new Map(sections.map(s => [s.id, s.parentId]));
    for (const s of sections) {
        const seen = new Set<string>([s.id]);
        let p = s.parentId;
        while (p) {
            if (seen.has(p)) return s.id;
            seen.add(p);
            p = parentOf.get(p) ?? null;
        }
    }
    return null;
}

/**
 * The index a caller sent, checked and cleaned. Unknown fields are dropped, a missing name reads as
 * the empty name the page gives a section it has just added, and a document listed twice in one
 * section is listed once. What is refused: something that is not a list of sections, a duplicate or
 * malformed id, a parent that is not in the list or is the section itself, a cycle, a colour the page
 * does not offer, and an index past the size bounds.
 */
export function validateSections(raw: unknown): { sections: Section[] } | { error: string } {
    if (!Array.isArray(raw)) return { error: 'sections must be a list of sections, each { id, name, parentId, documents }.' };
    if (raw.length > MAX_SECTIONS) return { error: `A document space holds at most ${MAX_SECTIONS} sections; this list has ${raw.length}.` };
    const out: Section[] = [];
    const ids = new Set<string>();
    for (const [i, item] of raw.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: `sections[${i}] is not a section object.` };
        const s = item as Record<string, unknown>;
        if (typeof s.id !== 'string' || !SECTION_ID.test(s.id)) return { error: `sections[${i}] needs an id of letters, digits, '-' or '_' (at most 64).` };
        if (ids.has(s.id)) return { error: `Two sections have the id "${s.id}".` };
        ids.add(s.id);
        const name = s.name === undefined || s.name === null ? '' : s.name;
        if (typeof name !== 'string' || name.length > MAX_NAME) return { error: `The name of section "${s.id}" must be text of at most ${MAX_NAME} characters.` };
        const parentId = s.parentId === undefined || s.parentId === null || s.parentId === '' ? null : s.parentId;
        if (parentId !== null && typeof parentId !== 'string') return { error: `The parentId of section "${s.id}" must be another section's id or null.` };
        const docsRaw = s.documents === undefined || s.documents === null ? [] : s.documents;
        if (!Array.isArray(docsRaw) || docsRaw.length > MAX_DOCS_PER_SECTION || !docsRaw.every(isDocId)) {
            return { error: `The documents of section "${s.id}" must be a list of document ids (at most ${MAX_DOCS_PER_SECTION}).` };
        }
        const color = s.color === undefined || s.color === null || s.color === '' ? undefined : s.color;
        if (color !== undefined && (typeof color !== 'string' || !SECTION_COLORS.includes(color))) {
            return { error: `The colour of section "${s.id}" must be one of ${SECTION_COLORS.join(', ')}, or left out.` };
        }
        out.push({ id: s.id, name, parentId: parentId as string | null, documents: [...new Set(docsRaw as string[])], ...(color ? { color } : {}) });
    }
    for (const s of out) {
        if (s.parentId === s.id) return { error: `Section "${s.id}" cannot be its own parent.` };
        if (s.parentId !== null && !ids.has(s.parentId)) return { error: `Section "${s.id}" names a parent "${s.parentId}" that is not in the list.` };
    }
    const cyc = hasCycle(out);
    if (cyc) return { error: `The parents of section "${cyc}" lead back to it, so it would sit inside itself.` };
    return { sections: out };
}

/**
 * The index a stored record holds (`{ sections: [...] }`), read leniently: a record written before
 * any of this was checked may hold anything, and a reader must not fail on it. What cannot be read
 * as a section is left out, and the tree is normalized.
 */
export function readStoredSections(value: unknown): Section[] {
    const list = (value && typeof value === 'object' && !Array.isArray(value)) ? (value as { sections?: unknown }).sections : undefined;
    if (!Array.isArray(list)) return [];
    const out: Section[] = [];
    const ids = new Set<string>();
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const s = item as Record<string, unknown>;
        if (typeof s.id !== 'string' || !s.id || ids.has(s.id)) continue;
        ids.add(s.id);
        const color = typeof s.color === 'string' && SECTION_COLORS.includes(s.color) ? s.color : undefined;
        out.push({
            id: s.id,
            name: typeof s.name === 'string' ? s.name : '',
            parentId: typeof s.parentId === 'string' && s.parentId ? s.parentId : null,
            documents: Array.isArray(s.documents) ? [...new Set(s.documents.filter(isDocId))] : [],
            ...(color ? { color } : {}),
        });
    }
    return normalizeSectionTree(out);
}

/**
 * The steps that turn `from` into `to`. Sections are matched by id. The order of the sections and of
 * the documents inside one is not a step: the page has no way to reorder either, and a step for it
 * would undo an order somebody else set in the meantime.
 */
export function diffSections(from: Section[], to: Section[]): SectionOp[] {
    const before = new Map(from.map(s => [s.id, s]));
    const after = new Set(to.map(s => s.id));
    const ops: SectionOp[] = [];
    for (const s of to) {
        const f = before.get(s.id);
        if (!f) {
            ops.push({ op: 'add', id: s.id, name: s.name, parentId: s.parentId, ...(s.color ? { color: s.color } : {}) });
            for (const doc of s.documents) ops.push({ op: 'file', id: s.id, doc });
            continue;
        }
        if (f.name !== s.name) ops.push({ op: 'rename', id: s.id, name: s.name });
        if ((f.parentId ?? null) !== (s.parentId ?? null)) ops.push({ op: 'move', id: s.id, parentId: s.parentId ?? null });
        if ((f.color ?? null) !== (s.color ?? null)) ops.push({ op: 'color', id: s.id, color: s.color ?? null });
        const was = new Set(f.documents);
        const now = new Set(s.documents);
        for (const doc of f.documents) if (!now.has(doc)) ops.push({ op: 'unfile', id: s.id, doc });
        for (const doc of s.documents) if (!was.has(doc)) ops.push({ op: 'file', id: s.id, doc });
    }
    for (const f of from) if (!after.has(f.id)) ops.push({ op: 'remove', id: f.id });
    return ops;
}

/**
 * Apply steps on top of an index. Filing a document MOVES it: it leaves whichever section held it,
 * because the page shows a document in one place, and a document dragged from A to B while somebody
 * else moved it to C belongs where the last step put it rather than in two places. A step that names
 * a section which is no longer there does nothing, except `add`, which creates it.
 */
export function applySectionOps(current: Section[], ops: SectionOp[]): Section[] {
    let secs: Section[] = current.map(s => ({ ...s, documents: [...s.documents] }));
    const find = (id: string) => secs.find(s => s.id === id);
    for (const step of ops) {
        switch (step.op) {
            case 'add': {
                const s = find(step.id);
                if (s) {
                    s.name = step.name; s.parentId = step.parentId;
                    if (step.color) s.color = step.color;
                } else {
                    secs.push({ id: step.id, name: step.name, parentId: step.parentId, documents: [], ...(step.color ? { color: step.color } : {}) });
                }
                break;
            }
            case 'remove': secs = secs.filter(s => s.id !== step.id); break;
            case 'rename': { const s = find(step.id); if (s) s.name = step.name; break; }
            case 'move': { const s = find(step.id); if (s) s.parentId = step.parentId; break; }
            case 'color': {
                const s = find(step.id);
                if (s) { if (step.color) s.color = step.color; else delete s.color; }
                break;
            }
            case 'file': {
                const target = find(step.id);
                if (!target) break;
                for (const s of secs) if (s !== target) s.documents = s.documents.filter(d => d !== step.doc);
                if (!target.documents.includes(step.doc)) target.documents.push(step.doc);
                break;
            }
            case 'unfile': { const s = find(step.id); if (s) s.documents = s.documents.filter(d => d !== step.doc); break; }
        }
    }
    return normalizeSectionTree(secs);
}

/**
 * The tree the page can render: a parent that is gone makes its child a top-level section, a cycle
 * is broken at the section that closes it, and a document listed twice in one section is listed once.
 */
export function normalizeSectionTree(sections: Section[]): Section[] {
    const ids = new Set(sections.map(s => s.id));
    const out = sections.map(s => ({
        ...s,
        parentId: s.parentId && s.parentId !== s.id && ids.has(s.parentId) ? s.parentId : null,
        documents: [...new Set(s.documents)],
    }));
    for (let guard = 0; guard < out.length; guard++) {
        const cyc = hasCycle(out);
        if (!cyc) break;
        const s = out.find(x => x.id === cyc);
        if (s) s.parentId = null;
    }
    return out;
}

/**
 * Steps read back from where they were stored, checked again before they are applied: a known step,
 * a well-formed section id, and the fields that step carries. Null when any step is not one, because
 * applying part of a change is a change nobody asked for.
 */
export function validateSectionOps(raw: unknown): SectionOp[] | null {
    if (!Array.isArray(raw) || raw.length > MAX_SECTION_OPS) return null;
    const out: SectionOp[] = [];
    const parentOk = (v: unknown) => v === null || (typeof v === 'string' && SECTION_ID.test(v));
    const nameOk = (v: unknown) => typeof v === 'string' && v.length <= MAX_NAME;
    for (const item of raw) {
        if (!item || typeof item !== 'object') return null;
        const o = item as Record<string, unknown>;
        if (typeof o.id !== 'string' || !SECTION_ID.test(o.id)) return null;
        switch (o.op) {
            case 'add':
                if (!nameOk(o.name) || !parentOk(o.parentId ?? null)) return null;
                if (o.color !== undefined && (typeof o.color !== 'string' || !SECTION_COLORS.includes(o.color))) return null;
                out.push({ op: 'add', id: o.id, name: o.name as string, parentId: (o.parentId ?? null) as string | null, ...(o.color ? { color: o.color as string } : {}) });
                break;
            case 'remove': out.push({ op: 'remove', id: o.id }); break;
            case 'rename': if (!nameOk(o.name)) return null; out.push({ op: 'rename', id: o.id, name: o.name as string }); break;
            case 'move': if (!parentOk(o.parentId ?? null)) return null; out.push({ op: 'move', id: o.id, parentId: (o.parentId ?? null) as string | null }); break;
            case 'color':
                if (o.color !== null && (typeof o.color !== 'string' || !SECTION_COLORS.includes(o.color))) return null;
                out.push({ op: 'color', id: o.id, color: (o.color ?? null) as string | null });
                break;
            case 'file': case 'unfile':
                if (!isDocId(o.doc)) return null;
                out.push({ op: o.op, id: o.id, doc: o.doc });
                break;
            default: return null;
        }
    }
    return out;
}

/** The change in counts, so a person deciding on it knows its size: "adds 1 section, files 2 documents". */
export function summarizeSectionOps(ops: SectionOp[]): string {
    const count = (op: SectionOp['op']) => ops.filter(o => o.op === op).length;
    const parts: string[] = [];
    const say = (n: number, one: string, many: string) => { if (n) parts.push(`${n} ${n === 1 ? one : many}`); };
    say(count('add'), 'section added', 'sections added');
    say(count('rename'), 'section renamed', 'sections renamed');
    say(count('move'), 'section moved', 'sections moved');
    say(count('color'), 'colour changed', 'colours changed');
    say(count('remove'), 'section removed', 'sections removed');
    say(count('file'), 'document filed', 'documents filed');
    say(count('unfile'), 'document taken out of a section', 'documents taken out of a section');
    return parts.length ? parts.join(', ') : 'no change';
}
