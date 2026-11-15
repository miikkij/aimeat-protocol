/**
 * @file scripts/lib/e2e-coverage-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which E2E suites execute which lines of src/: the map is built from per-suite V8
 *   coverage of the nodes a sweep starts, and `pnpm gate` reads it to choose the suites a change can
 *   have reached instead of leaving that choice to memory.
 *
 *   WHY (report of 2026-11-15, 4.2.6). The gate ran the suites a change edited, the guard tier and
 *   the purpose tier. A change to a route that 30 other suites drive ran none of those 30 unless the
 *   session thought of them. The runner starts one node per suite, so each node's coverage is that
 *   one suite's coverage, and the map falls out of a coverage run of the whole sweep.
 *
 *   GRANULARITY. A function, not a file: a module's top level runs whenever anything imports it, so
 *   at file level a boot-path file would select every suite. The map keeps each executed function as
 *   [first line, last line, suites], in the lines of the TypeScript source (the tsx source map is
 *   decoded here, so no source-map dependency is needed). A changed line inside a function selects
 *   the suites that executed that function; a changed line outside every function (an import, a
 *   constant) selects the suites that executed any function of the file.
 *
 *   LINES MOVE. The map is built at one commit and read at another. selectSuites() takes the changed
 *   lines already translated into the map commit's numbering (translateLines, from `git diff -U0
 *   <map commit>`), so a file edited since the map was built still selects by the right functions.
 * @structure decodeMappings() · offsetToOriginalLine() · functionsOf() · CoverageMap · mergeMaps() ·
 *   translateLines() · selectSuites()
 * @version-history
 *   v1.0.0 -- 2026-11-15 -- Initial: per-suite function coverage for the gate's suite choice.
 */

/** One executed function: [first line, last line, indexes into CoverageMap.suites]. 1-based lines. */
export type FnEntry = [number, number, number[]];

export interface CoverageMap {
    /** The commit the sweep ran on. */
    commit: string;
    built: string;
    suites: string[];
    /** Repository-relative path (aimeat/src/...) → executed functions. */
    files: Record<string, FnEntry[]>;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/**
 * A source map's `mappings`, as per generated line the list of [generated column, original line]
 * (0-based), in column order. Only what line lookup needs is kept.
 */
export function decodeMappings(mappings: string): Array<Array<[number, number]>> {
    const lines: Array<Array<[number, number]>> = [];
    let origLine = 0;
    let srcIdx = 0;
    let origCol = 0;
    for (const lineText of mappings.split(';')) {
        const segs: Array<[number, number]> = [];
        let genCol = 0;
        for (const seg of lineText.split(',')) {
            if (!seg) continue;
            const vals: number[] = [];
            let value = 0;
            let shift = 0;
            for (const ch of seg) {
                const digit = B64_INDEX.get(ch);
                if (digit === undefined) throw new Error(`not a base64 VLQ digit: ${ch}`);
                value += (digit & 31) << shift;
                if (digit & 32) { shift += 5; continue; }
                vals.push(value & 1 ? -(value >>> 1) : value >>> 1);
                value = 0;
                shift = 0;
            }
            genCol += vals[0];
            if (vals.length >= 4) {
                srcIdx += vals[1];
                origLine += vals[2];
                origCol += vals[3];
                segs.push([genCol, origLine]);
            }
        }
        lines.push(segs);
    }
    void srcIdx; void origCol;
    return lines;
}

/** Generated line and column of a character offset, from the script's line lengths (without newlines). */
function offsetToGenerated(offset: number, lineLengths: number[]): [number, number] {
    let rest = offset;
    for (let line = 0; line < lineLengths.length; line++) {
        if (rest <= lineLengths[line]) return [line, rest];
        rest -= lineLengths[line] + 1;
    }
    return [Math.max(0, lineLengths.length - 1), 0];
}

/**
 * The original (1-based) line of a generated offset: the last mapping at or before its column on its
 * line, or else the nearest mapped line above. null when nothing maps.
 */
export function offsetToOriginalLine(offset: number, lineLengths: number[], decoded: Array<Array<[number, number]>>): number | null {
    const [gl, gc] = offsetToGenerated(offset, lineLengths);
    for (let l = gl; l >= 0; l--) {
        const segs = decoded[l] ?? [];
        if (segs.length === 0) continue;
        if (l < gl) return segs[segs.length - 1][1] + 1;
        let hit: [number, number] | null = null;
        for (const s of segs) { if (s[0] <= gc) hit = s; else break; }
        if (hit) return hit[1] + 1;
        // Before the first mapping of this line: the line above's last mapping is the closest.
    }
    return null;
}

/** V8's per-script coverage, as NODE_V8_COVERAGE writes it. */
export interface ScriptCoverage {
    url: string;
    functions: Array<{ functionName: string; isBlockCoverage: boolean; ranges: Array<{ startOffset: number; endOffset: number; count: number }> }>;
}

/** Node's source-map-cache entry for one script (stored under smc/ by test/coverage-preload.mjs). */
export interface SourceMapEntry { lineLengths: number[]; data: { mappings: string } | null }

/**
 * The executed functions of one script, as [first, last] original lines. The script's own top level
 * (the first function, whose range starts at 0) is left out: it ran because something imported it.
 */
export function functionsOf(script: ScriptCoverage, map: SourceMapEntry | null): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const decoded = map?.data?.mappings ? decodeMappings(map.data.mappings) : null;
    for (const fn of script.functions) {
        const r = fn.ranges[0];
        if (!r || r.count === 0 || r.startOffset === 0) continue;
        let a: number | null;
        let b: number | null;
        if (decoded && map) {
            a = offsetToOriginalLine(r.startOffset, map.lineLengths, decoded);
            b = offsetToOriginalLine(Math.max(r.startOffset, r.endOffset - 1), map.lineLengths, decoded);
        } else {
            a = null; b = null;
        }
        if (a === null || b === null) continue;
        out.push(a <= b ? [a, b] : [b, a]);
    }
    return out;
}

/** Several partial maps (one per shard) as one. Suites are re-indexed; equal functions are joined. */
export function mergeMaps(parts: CoverageMap[]): CoverageMap {
    const suites: string[] = [];
    const index = new Map<string, number>();
    const fns = new Map<string, Map<string, Set<number>>>();
    for (const part of parts) {
        for (const [file, entries] of Object.entries(part.files)) {
            const byRange = fns.get(file) ?? new Map<string, Set<number>>();
            for (const [a, b, ids] of entries) {
                const key = `${a}:${b}`;
                const set = byRange.get(key) ?? new Set<number>();
                for (const id of ids) {
                    const name = part.suites[id];
                    if (!index.has(name)) { index.set(name, suites.length); suites.push(name); }
                    set.add(index.get(name)!);
                }
                byRange.set(key, set);
            }
            fns.set(file, byRange);
        }
    }
    const files: Record<string, FnEntry[]> = {};
    for (const [file, byRange] of [...fns].sort((x, y) => x[0].localeCompare(y[0]))) {
        files[file] = [...byRange].map(([k, set]): FnEntry => {
            const [a, b] = k.split(':').map(Number);
            return [a, b, [...set].sort((x, y) => x - y)];
        }).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    }
    return { commit: parts[0]?.commit ?? '', built: new Date().toISOString(), suites, files };
}

/**
 * Lines of the current file, translated into the numbering of the map's commit, from a `git diff
 * -U0 <map commit> -- <file>` text. A changed line inside a hunk becomes the hunk's old range (a
 * pure insertion becomes the old line it follows); an unchanged line is shifted by the hunks above it.
 */
export function translateLines(currentLines: number[], diffText: string): number[] {
    const hunks: Array<{ oldStart: number; oldLen: number; newStart: number; newLen: number }> = [];
    for (const m of diffText.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
        hunks.push({ oldStart: Number(m[1]), oldLen: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), newLen: m[4] === undefined ? 1 : Number(m[4]) });
    }
    const out = new Set<number>();
    for (const line of currentLines) {
        let shift = 0;
        let inside: (typeof hunks)[number] | null = null;
        for (const h of hunks) {
            const newEnd = h.newStart + Math.max(h.newLen, 1) - 1;
            if (h.newLen > 0 && line >= h.newStart && line <= newEnd) { inside = h; break; }
            if (h.newLen === 0 ? line > h.newStart : line > newEnd) shift += h.oldLen - h.newLen;
        }
        if (inside) {
            if (inside.oldLen === 0) out.add(Math.max(1, inside.oldStart));
            else for (let l = inside.oldStart; l < inside.oldStart + inside.oldLen; l++) out.add(l);
        } else {
            out.add(line + shift);
        }
    }
    return [...out].sort((a, b) => a - b);
}

export interface Selection {
    suites: Set<string>;
    /** Changed files the map has no entry for: a new file, or one no suite executed. */
    unknown: string[];
}

/**
 * The suites that executed a changed line. `changes` maps a repository path to its changed lines in
 * the map commit's numbering; an empty list means the whole file (a deletion, or lines unknown).
 */
export function selectSuites(map: CoverageMap, changes: Map<string, number[]>): Selection {
    const suites = new Set<string>();
    const unknown: string[] = [];
    for (const [file, lines] of changes) {
        const entries = map.files[file];
        if (!entries || entries.length === 0) { unknown.push(file); continue; }
        const all = (): void => { for (const e of entries) for (const id of e[2]) suites.add(map.suites[id]); };
        if (lines.length === 0) { all(); continue; }
        for (const line of lines) {
            const hits = entries.filter(e => line >= e[0] && line <= e[1]);
            if (hits.length === 0) { all(); break; }
            // The innermost function is the one the line belongs to; an outer function that merely
            // contains it ran too, but its suites did not necessarily reach this line.
            const inner = hits.reduce((x, y) => (y[1] - y[0] < x[1] - x[0] ? y : x));
            for (const id of inner[2]) suites.add(map.suites[id]);
        }
    }
    return { suites, unknown };
}
