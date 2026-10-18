/**
 * @file scripts/inventory/browser-lib-routes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two browser client libraries, as an inventory of the node routes each calls: the
 *   portal's services (aimeat/public/js/services/) and the libraries apps load from /v1/libs
 *   (aimeat/src/static/sdk-libs/, the source of /v1/libs/aimeat-*.js). They are two products and stay
 *   two; this lists the routes BOTH call, and among those the ones they call with different query
 *   parameters, which is where one of them is likely to have missed a change the other followed.
 *
 *   A SHRINK-ONLY RATCHET (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille,
 *   brief doc-mvdq71zdgo3o; first a report, a gate since Jouni's yes on 2026-10-18):
 *   `pnpm audit:browser-libs` prints it, `pnpm check:browser-libs` fails on a differing route that
 *   security/browser-lib-routes.json does not list, and `pnpm debt` counts that file.
 *
 *   READING THE SOURCE. Every string or template literal that contains `/v1/`, outside comments. The
 *   path is the literal from `/v1/` to its query; a literal that ends in `/` and is followed by
 *   `+ <expression>` gets a `{}` segment, and `${...}` is `{}`. The parameters are the `name=` pairs in
 *   the literals of the same line. Its documented limit: a parameter set through URLSearchParams
 *   (`p.set('agent', ...)`) or a path built in a variable over several lines is not seen.
 * @structure
 *   - libraryCalls(dir, skip): route -> the parameter names seen with it
 *   - routeDifferences(portal, apps): the shared routes and the differing ones
 *   - PORTAL_DIR, APPS_DIR, APPS_SKIP, BASELINE
 * @usage import { libraryCalls, routeDifferences } from './inventory/browser-lib-routes.js';
 * @version-history
 *   v1.1.0 — 2026-10-18 — The report became a shrink-only gate (scripts/audit-browser-libs.ts --check).
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PORTAL_DIR = 'public/js/services';
export const APPS_DIR = 'src/static/sdk-libs';
/** Under APPS_DIR: the built bundles, which are generated from the sources this reads (check:sdk). */
export const APPS_SKIP = ['dist'];
export const BASELINE = 'security/browser-lib-routes.json';

/** route -> the query parameter names seen with it, across a library. */
export type RouteCalls = Map<string, Set<string>>;

function walk(dir: string, skip: string[]): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (skip.includes(name)) continue;
        if (statSync(full).isDirectory()) out.push(...walk(full, skip));
        else if (/\.(m?js|ts)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** JavaScript with its comments blanked, line numbers kept. */
const code = (text: string): string => text
    .replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** The routes one source text calls, with their parameter names. Exported for the self-test. */
export function callsInText(text: string, into: RouteCalls = new Map()): RouteCalls {
    for (const line of code(text).split('\n')) {
        if (!line.includes('/v1/')) continue;
        const literals = [...line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)];
        const at = literals.findIndex(l => l[2].includes('/v1/'));
        if (at < 0) continue;
        // Follow a concatenation: '/v1/organisms/' + id + '/workspace?ws=' is /v1/organisms/{}/workspace.
        let url = literals[at][2].slice(literals[at][2].indexOf('/v1/'));
        let end = literals[at].index! + literals[at][0].length;
        for (let i = at + 1; i <= literals.length; i++) {
            const next = literals[i];
            const between = line.slice(end, next ? next.index : undefined);
            if (!next) { if (url.endsWith('/') && /^\s*\+/.test(between)) url += '{}'; break; }
            if (/^\s*\+\s*$/.test(between)) url += next[2];
            else if (/^\s*\+[^'"`;,]*\+\s*$/.test(between)) url += '{}' + next[2];
            else { if (url.endsWith('/') && /^\s*\+/.test(between)) url += '{}'; break; }
            end = next.index! + next[0].length;
        }
        const path = url.replace(/\$\{[^}]*\}/g, '{}').split('?')[0].replace(/\/+$/, '');
        const params = new Set<string>();
        for (const l of literals.slice(at)) for (const m of l[2].matchAll(/[?&]([A-Za-z_][A-Za-z0-9_]*)=/g)) params.add(m[1]);
        const seen = into.get(path) ?? new Set<string>();
        for (const p of params) seen.add(p);
        into.set(path, seen);
    }
    return into;
}

/** Every route a library under `dir` calls. */
export function libraryCalls(dir: string, skip: string[] = []): RouteCalls {
    const calls: RouteCalls = new Map();
    for (const file of walk(dir, skip)) callsInText(readFileSync(file, 'utf8'), calls);
    return calls;
}

export interface RouteDifference { portal: string[]; apps: string[] }

/** The routes both libraries call, and those among them whose parameter names differ. */
export function routeDifferences(portal: RouteCalls, apps: RouteCalls): { shared: string[]; differences: Record<string, RouteDifference> } {
    const shared = [...portal.keys()].filter(r => apps.has(r)).sort();
    const differences: Record<string, RouteDifference> = {};
    for (const r of shared) {
        const a = [...portal.get(r)!].sort();
        const b = [...apps.get(r)!].sort();
        if (a.join(',') !== b.join(',')) differences[r] = { portal: a, apps: b };
    }
    return { shared, differences };
}
