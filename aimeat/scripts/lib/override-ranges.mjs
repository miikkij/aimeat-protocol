/**
 * @file scripts/lib/override-ranges.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule a dependency override's VALUE is held to, read by scripts/check-overrides.mjs
 *   and test/unit/override-ranges.test.ts: every alternative of the value stays inside one major
 *   version and has an upper bound.
 *
 *   WHY. pnpm resolves an override to the highest version its value allows, and it applies a ranged
 *   override (`name@>=2.0.0 <2.1.4`) to every dependent whose own range merely overlaps the selector.
 *   So `"brace-expansion@>=2.0.0 <2.1.4": ">=2.1.4"` handed brace-expansion 5.0.9 to every package
 *   that had asked for ^2.0.2, and minimatch@9 crashed with `brace_expansion_1.default is not a
 *   function` two weeks later, in a tool the override never named (2026-09; js-yaml had done the same
 *   on 2026-08-23). An open `>=` reads as "at least the patched version" and `pnpm audit` is green
 *   after it, which is why it was written twelve times. A value like `^2.1.4` keeps the major the
 *   dependents asked for. When dependents of several majors overlap the selector (vitest's peer
 *   `^6.4.0 || ^7.0.0 || ^8.0.0` against a vite 7.x selector), the value names each major it keeps,
 *   `^7.3.5 || ^8.0.0`, so nothing is moved to a major nobody asked for.
 * @structure flattenOverrides() · overrideRangeProblems()
 * @usage import { overrideRangeProblems } from './lib/override-ranges.mjs'
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial; replaces docs/pitfalls.md §59.
 */

import { parseRange } from './npm-shrinkwrap.mjs';

/**
 * An `overrides` block as flat rules. pnpm writes `parent>child`; npm nests the child under the parent,
 * with `.` for the parent's own value. Both come out as `{ key: 'parent>child', value }`.
 * @param {Record<string, unknown>} overrides
 * @returns {Array<{ key: string, value: unknown }>}
 */
export function flattenOverrides(overrides, prefix = '') {
    const out = [];
    for (const [key, value] of Object.entries(overrides ?? {})) {
        if (value !== null && typeof value === 'object') {
            for (const inner of flattenOverrides(value, `${prefix}${key}>`)) {
                out.push(inner.key.endsWith('>.') ? { key: inner.key.slice(0, -2), value: inner.value } : inner);
            }
        } else {
            out.push({ key: `${prefix}${key}`, value });
        }
    }
    return out;
}

/** The highest major an alternative's upper comparator admits: `<5.0.0-0` and `<5.0.0` admit 4. */
function topMajor(upper) {
    const v = upper.v;
    const exclusiveAtMajor = upper.op === '<' && v.minor === 0 && v.patch === 0
        && (v.pre.length === 0 || (v.pre.length === 1 && v.pre[0] === 0));
    return exclusiveAtMajor ? v.major - 1 : v.major;
}

/**
 * Each override whose value can resolve outside one major, with the reason.
 * A removal (`-`) has no version and passes. A value outside the semver subset the shrinkwrap rules
 * read is reported, so a new syntax is looked at instead of passing unread.
 * @param {Record<string, unknown>} overrides an `overrides` or `pnpm.overrides` block
 * @returns {Array<{ key: string, value: string, reason: string }>}
 */
export function overrideRangeProblems(overrides) {
    const problems = [];
    for (const { key, value } of flattenOverrides(overrides)) {
        if (value === '-') continue;
        const text = String(value);
        let sets;
        try {
            if (typeof value !== 'string' || text.startsWith('$') || text.includes(':')) throw new Error('not a version range');
            sets = parseRange(text);
        } catch (err) {
            problems.push({ key, value: text, reason: `this check cannot read the value (${err instanceof Error ? err.message : String(err)})` });
            continue;
        }
        for (const set of sets) {
            const lowers = set.filter(c => c.op === '>=' || c.op === '>' || c.op === '=');
            const uppers = set.filter(c => c.op === '<' || c.op === '<=' || c.op === '=');
            if (uppers.length === 0) {
                problems.push({ key, value: text, reason: 'it has no upper bound, so pnpm resolves it to the newest major there is' });
                break;
            }
            const low = lowers.length ? Math.max(...lowers.map(c => c.v.major)) : 0;
            const high = Math.min(...uppers.map(topMajor));
            if (high > low) {
                problems.push({ key, value: text, reason: `one alternative spans majors ${low} to ${high}; write one alternative per major (^${low}.x.y || ^${high}.0.0)` });
                break;
            }
        }
    }
    return problems;
}
