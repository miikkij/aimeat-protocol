/**
 * @file src/services/memory-versions/diff.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What changed between two JSON values, as a short list a person or an AI can read:
 *   one line per added, removed or changed path. Storage keeps whole versions (memory_history); the
 *   difference is computed when it is read, so nothing about the stored shape depends on it.
 *
 *   ARRAYS OF RECORDS ARE MATCHED BY IDENTITY, not by position, when every element on both sides is
 *   an object with the same identity field (`@id`, `id`, `key`, `ref`, `term`, `slug`) and the values
 *   are unique. A concept inserted at the top of a list then shows as one addition, not as every
 *   later element changed. Other arrays are compared by index.
 *
 *   BOUNDED. At most `maxChanges` lines, and every shown value is cut to `maxValueChars`, so a
 *   rewrite of a 30 kB record answers in a few kilobytes.
 * @structure JsonChange · JsonDiff · diffJson()
 * @usage
 *   const { changes, truncated } = diffJson(before, after);
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial: the change list of aimeat_memory_history.
 */

export interface JsonChange {
    /** Where: `core`, `concepts[term=release].means`, `@graph[@id=vocab:ctx.x/decision/y]`, `views[2]`. */
    path: string;
    op: 'added' | 'removed' | 'changed';
    before?: unknown;
    after?: unknown;
}

export interface JsonDiff {
    changes: JsonChange[];
    /** True when there were more changes than `maxChanges`. */
    truncated: boolean;
}

const IDENTITY_FIELDS = ['@id', 'id', 'key', 'ref', 'term', 'slug'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        const bb = b as unknown[];
        return a.length === bb.length && a.every((x, i) => sameJson(x, bb[i]));
    }
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    const ak = Object.keys(ao), bk = Object.keys(bo);
    return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && sameJson(ao[k], bo[k]));
}

/** The identity field every element of both arrays carries, unique per side, or null. */
function identityField(a: unknown[], b: unknown[]): string | null {
    const all = [...a, ...b];
    if (all.length === 0 || !all.every(isPlainObject)) return null;
    for (const f of IDENTITY_FIELDS) {
        const sides = [a, b] as Array<Array<Record<string, unknown>>>;
        const ok = sides.every(side => {
            const seen = new Set<string>();
            for (const el of side) {
                const v = el[f];
                if (typeof v !== 'string' || seen.has(v)) return false;
                seen.add(v);
            }
            return true;
        });
        if (ok) return f;
    }
    return null;
}

function shown(v: unknown, max: number): unknown {
    if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v;
    if (v === null || typeof v !== 'object') return v;
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : v;
}

function join(path: string, seg: string): string {
    if (!path) return seg;
    return seg.startsWith('[') ? path + seg : `${path}.${seg}`;
}

/** The changes from `before` to `after`. */
export function diffJson(before: unknown, after: unknown, opts?: { maxChanges?: number; maxValueChars?: number }): JsonDiff {
    const maxChanges = opts?.maxChanges ?? 100;
    const maxValueChars = opts?.maxValueChars ?? 200;
    const changes: JsonChange[] = [];
    let truncated = false;

    const push = (c: JsonChange): boolean => {
        if (changes.length >= maxChanges) { truncated = true; return false; }
        changes.push({
            path: c.path || '(whole value)', op: c.op,
            ...(c.op !== 'added' ? { before: shown(c.before, maxValueChars) } : {}),
            ...(c.op !== 'removed' ? { after: shown(c.after, maxValueChars) } : {}),
        });
        return true;
    };

    const walk = (a: unknown, b: unknown, path: string): void => {
        if (truncated || sameJson(a, b)) return;
        if (isPlainObject(a) && isPlainObject(b)) {
            const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
            for (const k of keys) {
                if (truncated) return;
                const p = join(path, k);
                if (!(k in a)) push({ path: p, op: 'added', after: b[k] });
                else if (!(k in b)) push({ path: p, op: 'removed', before: a[k] });
                else walk(a[k], b[k], p);
            }
            return;
        }
        if (Array.isArray(a) && Array.isArray(b)) {
            const f = identityField(a, b);
            if (f) {
                const left = new Map(a.map(el => [(el as Record<string, unknown>)[f] as string, el]));
                const right = new Map(b.map(el => [(el as Record<string, unknown>)[f] as string, el]));
                for (const [id, el] of left) {
                    if (truncated) return;
                    const p = join(path, `[${f}=${id}]`);
                    if (!right.has(id)) push({ path: p, op: 'removed', before: el });
                    else walk(el, right.get(id), p);
                }
                for (const [id, el] of right) {
                    if (truncated) return;
                    if (!left.has(id)) push({ path: join(path, `[${f}=${id}]`), op: 'added', after: el });
                }
                return;
            }
            const n = Math.max(a.length, b.length);
            for (let i = 0; i < n; i++) {
                if (truncated) return;
                const p = join(path, `[${i}]`);
                if (i >= a.length) push({ path: p, op: 'added', after: b[i] });
                else if (i >= b.length) push({ path: p, op: 'removed', before: a[i] });
                else walk(a[i], b[i], p);
            }
            return;
        }
        push({ path, op: 'changed', before: a, after: b });
    };

    walk(before, after, '');
    return { changes, truncated };
}
