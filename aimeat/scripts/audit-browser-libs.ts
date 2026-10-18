/**
 * @file audit-browser-libs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node routes the portal's browser services and the app libraries both call, and
 *   those they call with different query parameters. How it reads the source:
 *   scripts/inventory/browser-lib-routes.ts.
 *
 *   A SHRINK-ONLY RATCHET since 2026-10-18 (Jouni: yes, it fails when the number grows). With
 *   `--check` (`pnpm check:browser-libs`, in check:fast) it fails on a route that differs and is not
 *   in security/browser-lib-routes.json, and on a listed route that no longer differs, which is
 *   deleted with `--write` so the gain is kept. `--write` refuses to add a route: a new difference
 *   is fixed in the library that missed the change, or recorded with `--write --reseed`, which is the
 *   developer's decision because it forgives it.
 *
 *   The baseline path comes from AIMEAT_BROWSER_LIBS_BASELINE when set, so the gate self-test runs
 *   this script against a planted copy.
 * @usage
 *   pnpm audit:browser-libs                       # the report
 *   pnpm check:browser-libs                       # the gate
 *   pnpm audit:browser-libs -- --write            # drop the routes that no longer differ
 *   pnpm audit:browser-libs -- --write --reseed   # record new ones too (the developer's decision)
 * @version-history
 *   v1.1.0 — 2026-10-18 — `--check`: the shrink-only gate; `--write` no longer adds a route without `--reseed`.
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS_DIR, APPS_SKIP, BASELINE, PORTAL_DIR, libraryCalls, routeDifferences, type RouteDifference } from './inventory/browser-lib-routes.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = process.env.AIMEAT_BROWSER_LIBS_BASELINE ?? join(AIMEAT, BASELINE);
const CHECK = process.argv.includes('--check');
const WRITE = process.argv.includes('--write');
const RESEED = process.argv.includes('--reseed');

const portal = libraryCalls(join(AIMEAT, PORTAL_DIR));
const apps = libraryCalls(join(AIMEAT, APPS_DIR), APPS_SKIP);
const { shared, differences } = routeDifferences(portal, apps);

const recorded = existsSync(PATH)
    ? ((JSON.parse(readFileSync(PATH, 'utf8')) as { differences?: Record<string, RouteDifference> }).differences ?? {})
    : {};
const added = Object.keys(differences).filter(r => !(r in recorded));
const gone = Object.keys(recorded).filter(r => !(r in differences));

function write(kept: Record<string, RouteDifference>): void {
    const doc = {
        note: 'A SHRINK-ONLY BASELINE: the node routes that both browser client libraries call (the portal\'s aimeat/public/js/services/ and the app libraries in aimeat/src/static/sdk-libs/, served as /v1/libs/aimeat-*.js) with different query parameter names. A difference is a place to look, not always a defect: the two serve different screens and may ask a route for different things. `pnpm check:browser-libs` fails on a differing route not listed here and on a listed route that no longer differs; `pnpm audit:browser-libs -- --write` deletes the latter, and adding a route (`--write --reseed`) is the developer\'s decision. `pnpm debt` counts the entries. Written 2026-10-18 (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille, brief doc-mvdq71zdgo3o).',
        portalRoutes: portal.size,
        appRoutes: apps.size,
        sharedRoutes: shared.length,
        differences: kept,
    };
    writeFileSync(PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

if (WRITE) {
    if (added.length > 0 && !RESEED) {
        console.error(`✗ --write adds no route: ${added.join(', ')} ${added.length === 1 ? 'differs' : 'differ'} and ${added.length === 1 ? 'is' : 'are'} not recorded. `
            + 'Make the library that missed the change follow, or record it with --write --reseed (the developer\'s decision).');
        process.exit(1);
    }
    const kept = RESEED ? differences : Object.fromEntries(Object.entries(differences).filter(([r]) => r in recorded));
    write(kept);
    console.log(`✓ wrote ${BASELINE}: ${Object.keys(kept).length} route(s) called with different parameters${gone.length ? `, ${gone.length} no longer differing removed` : ''}`);
} else if (CHECK) {
    const problems = [
        ...added.map(r => `${r} is called with different parameters (portal: ${differences[r].portal.join(', ') || 'none'}; apps: ${differences[r].apps.join(', ') || 'none'}) and is not in ${BASELINE}`),
        ...gone.map(r => `${BASELINE} lists ${r}, which no longer differs: run \`pnpm audit:browser-libs -- --write\` to keep the gain`),
    ];
    if (problems.length > 0) {
        console.error(`✗ check:browser-libs: ${problems.length} problem(s)`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error('  The list only shrinks: make the library that missed a route\'s change follow the other.');
        process.exit(1);
    }
    console.log(`✓ check:browser-libs: ${Object.keys(differences).length} of ${shared.length} shared routes differ in parameters, all recorded; the list only shrinks`);
} else {
    console.log(`Portal services call ${portal.size} routes, the app libraries ${apps.size}; ${shared.length} are called by both.`);
    console.log(`${Object.keys(differences).length} of those are called with different query parameters:`);
    for (const [route, d] of Object.entries(differences)) {
        console.log(`  ${route}\n    portal: ${d.portal.join(', ') || '(none)'}\n    apps:   ${d.apps.join(', ') || '(none)'}`);
    }
    if (added.length || gone.length) console.log(`${BASELINE}: ${added.length} not recorded, ${gone.length} no longer differing.`);
    else console.log(`${BASELINE} records every one of them.`);
}
