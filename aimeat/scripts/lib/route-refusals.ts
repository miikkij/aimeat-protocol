/**
 * @file scripts/lib/route-refusals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which authenticated routes of the contract an E2E suite asserts a refusal from. The
 *   route half of check:denial-coverage (QA audit 2026-10, P3-08 and package W29): the suite half
 *   asks whether a suite ever asserts a refusal at all, and a suite that refuses one route says
 *   nothing about the forty others it drives.
 *
 *   HOW A REFUSAL IS TIED TO A ROUTE. A suite is cut into its `test(` blocks (the whole file when it
 *   has none). A block that holds a refusal assertion (an `assert(` whose condition compares with
 *   401 or 403 and is not negated) refuses every route it names. A route is named by a string or
 *   template literal holding its path; `${...}` holes and concrete ids match the contract's
 *   parameters. The method is the nearest HTTP method word before the path in the same statement
 *   (`method: 'POST'`, `'DELETE', '/v1/...'`, `.patch(`), and GET when there is none. A block that
 *   calls one of the suite's own top-level helpers (`const review = (id) => json(`/v1/flags/${id}`,
 *   { method: 'PUT' })`) names the routes that helper names. It is a text
 *   match: a route can be credited by a block that refuses a different call, so the count of
 *   uncovered routes is a floor, never a ceiling.
 *
 *   WHICH ROUTES. Every operation in openapi.yaml whose `security` list is non-empty and does not
 *   offer the empty alternative `{}`: a route a caller must be signed in for. A public route, or one
 *   that answers an anonymous caller differently rather than refusing, has no refusal to test.
 * @structure authenticatedOperations · routeMatchers · testBlocks · refusalIn · namedRoutes · helperRoutes · refusedRoutes
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit P3-08, W29).
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** A contract operation as `METHOD /path/{param}`, the key every list in this check uses. */
export type RouteKey = string;

/** The `METHOD path` keys of every operation a caller must be signed in for. */
export function authenticatedOperations(openapiPath: string): RouteKey[] {
    const spec = parseYaml(readFileSync(openapiPath, 'utf8')) as { paths: Record<string, Record<string, { security?: unknown } | undefined>> };
    const out: RouteKey[] = [];
    for (const [path, ops] of Object.entries(spec.paths ?? {})) {
        for (const method of METHODS) {
            const op = ops?.[method];
            if (!op) continue;
            const security = op.security as unknown[] | undefined;
            if (!Array.isArray(security) || security.length === 0) continue;
            if (security.some(s => s && typeof s === 'object' && Object.keys(s as object).length === 0)) continue;
            out.push(`${method.toUpperCase()} ${path}`);
        }
    }
    return out.sort();
}

interface Matcher { key: RouteKey; method: string; re: RegExp; literalSegments: number }

/** One regular expression per operation: a `{param}` segment matches any one segment. */
export function routeMatchers(keys: RouteKey[]): Matcher[] {
    return keys.map(key => {
        const [method, path] = key.split(' ') as [string, string];
        const segments = path.split('/').filter(Boolean);
        const body = segments.map(s => (/^\{[^}]+\}$/.test(s) ? '[^/]+' : s.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))).join('/');
        return {
            key, method,
            re: new RegExp(`^/${body}/?$`),
            literalSegments: segments.filter(s => !s.startsWith('{')).length,
        };
    });
}

/** The suite cut at every `test(` call; the whole file when it has none. */
export function testBlocks(source: string): string[] {
    const starts = [...source.matchAll(/\b(?:await\s+)?test\s*\(/g)].map(m => m.index);
    if (starts.length === 0) return [source];
    return starts.map((start, i) => source.slice(start, starts[i + 1] ?? source.length));
}

/**
 * Does the block assert a refusal? An `assert(` whose condition (up to the first top-level comma)
 * compares with 401 or 403, not negated. `r.status !== 403` is the positive control and does not
 * count. Answers which statuses it found, so a caller can tell an anonymous 401 from a 403.
 */
export function refusalIn(block: string): { s401: boolean; s403: boolean } {
    const found = { s401: false, s403: false };
    const re = /\bassert\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
        let depth = 1;
        let i = m.index + m[0].length;
        const start = i;
        for (; i < block.length && depth > 0; i++) {
            const c = block[i];
            if (c === '(' || c === '[' || c === '{') depth++;
            else if (c === ')' || c === ']' || c === '}') depth--;
            else if (c === ',' && depth === 1) break;
        }
        const condition = block.slice(start, i);
        for (const hit of condition.matchAll(/\b40([13])\b/g)) {
            if (isNegatedStatus(condition, hit.index)) continue;
            if (hit[1] === '1') found.s401 = true; else found.s403 = true;
        }
    }
    return found;
}

/**
 * Is the status at `at` on the negated side of a comparison: `x !== 403`, `403 != x`,
 * `![401, 403].includes(x)`? Whitespace between the operator and the number is skipped.
 */
export function isNegatedStatus(condition: string, at: number): boolean {
    const before = condition.slice(Math.max(0, at - 40), at);
    const after = condition.slice(at + 3, at + 40);
    if (/!==?\s*$/.test(before)) return true;
    if (/^\s*!==?/.test(after)) return true;
    // ![401, 403].includes(...) and !(x === 403)
    if (/!\s*\[[^\]]*$/.test(before)) return true;
    if (/!\s*\(\s*[\w.$[\]?]*\s*===?\s*$/.test(before)) return true;
    return false;
}

/** Matchers grouped by method and first path segment, built once per matcher list. */
const INDEX = new WeakMap<Matcher[], Map<string, Matcher[]>>();

/** The matchers that can match `path` for `method`: same method, same first segment. */
function candidates(matchers: Matcher[], method: string, path: string): Matcher[] {
    let index = INDEX.get(matchers);
    if (!index) {
        index = new Map();
        for (const mt of matchers) {
            const first = mt.key.split(' ')[1]!.split('/')[1] ?? '';
            const k = `${mt.method} ${first}`;
            const list = index.get(k) ?? [];
            list.push(mt);
            index.set(k, list);
        }
        INDEX.set(matchers, index);
    }
    return index.get(`${method} ${path.split('/')[1] ?? ''}`) ?? [];
}

const METHOD_WORD =/(?:method\s*:\s*['"`]|['"`]|\.)(GET|POST|PUT|PATCH|DELETE|get|post|put|patch|delete)(?:['"`]|\s*\()/g;

/** The routes a block names: `METHOD /path` with the path's `${...}` holes kept as one segment. */
export function namedRoutes(block: string, matchers: Matcher[]): Set<RouteKey> {
    const out = new Set<RouteKey>();
    const literal = /(['"`])(?:\$\{[^}]*\})?(\/(?:v1|v2|mcp|local|a2a|\.well-known|api|oauth|federation)[^'"`\s?#]*)/g;
    for (const m of block.matchAll(literal)) {
        const path = m[2]!.replace(/\$\{[^}]*\}/g, 'X').replace(/\/+$/, '');
        const at = m.index;
        // The nearest method word before the path, inside the same statement (200 characters back,
        // stopping at the previous `;` or line that starts a new await).
        const windowStart = Math.max(0, at - 200);
        let back = block.slice(windowStart, at);
        const cut = Math.max(back.lastIndexOf(';'), back.lastIndexOf('await '));
        if (cut >= 0) back = back.slice(cut);
        const ahead = block.slice(at, at + 200);
        const aheadCut = ahead.search(/;|\n\s*(?:await|const|let)\b/);
        const aheadPart = aheadCut >= 0 ? ahead.slice(0, aheadCut) : ahead;
        const words = [...back.matchAll(METHOD_WORD)].map(w => w[1]!.toUpperCase());
        const aheadWords = [...aheadPart.matchAll(METHOD_WORD)].map(w => w[1]!.toUpperCase());
        const method = words.at(-1) ?? aheadWords[0] ?? 'GET';
        let best: Matcher | undefined;
        for (const mt of candidates(matchers, method, path)) {
            if (mt.method !== method || !mt.re.test(path)) continue;
            if (!best || mt.literalSegments > best.literalSegments) best = mt;
        }
        if (best) out.add(best.key);
    }
    return out;
}

/**
 * The suite's own top-level helpers that name a route: `const review = (id) => json(`/v1/flags/${id}`,
 * { method: 'PUT' })` or `async function setMaintenance(...)`. A block that calls `review(` names
 * PUT /v1/flags/{id} as surely as one that writes the path out. A definition runs from its first
 * line to the next top-level statement.
 */
export function helperRoutes(source: string, matchers: Matcher[]): Map<string, Set<RouteKey>> {
    const out = new Map<string, Set<RouteKey>>();
    const def = /^(?:export\s+)?(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>|(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\()/gm;
    for (const m of source.matchAll(def)) {
        const name = m[1] ?? m[2];
        if (!name) continue;
        const rest = source.slice(m.index);
        const end = rest.slice(1).search(/\n(?=\S)(?!\s*[)}\]])/);
        const body = end >= 0 ? rest.slice(0, end + 1) : rest;
        const routes = namedRoutes(body, matchers);
        if (routes.size) out.set(name, routes);
    }
    return out;
}

/** Every authenticated route some block of these suites both names (or calls a helper naming it) and refuses. */
export function refusedRoutes(sources: string[], matchers: Matcher[]): Set<RouteKey> {
    const covered = new Set<RouteKey>();
    for (const source of sources) {
        const helpers = helperRoutes(source, matchers);
        for (const block of testBlocks(source)) {
            const r = refusalIn(block);
            if (!r.s401 && !r.s403) continue;
            for (const key of namedRoutes(block, matchers)) covered.add(key);
            for (const [name, routes] of helpers) {
                if (new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`).test(block)) for (const key of routes) covered.add(key);
            }
        }
    }
    return covered;
}
