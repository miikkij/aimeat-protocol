/**
 * @file audit-browser-libs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Report: the node routes the portal's browser services and the app libraries both
 *   call, and those they call with different query parameters. A report, never a gate: it exits 0
 *   whatever it finds. How it reads the source: scripts/inventory/browser-lib-routes.ts.
 * @usage
 *   pnpm audit:browser-libs             # the report, and whether the recorded baseline is current
 *   pnpm audit:browser-libs -- --write  # record the current differences in security/browser-lib-routes.json
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS_DIR, APPS_SKIP, BASELINE, PORTAL_DIR, libraryCalls, routeDifferences } from './inventory/browser-lib-routes.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..');

const portal = libraryCalls(join(AIMEAT, PORTAL_DIR));
const apps = libraryCalls(join(AIMEAT, APPS_DIR), APPS_SKIP);
const { shared, differences } = routeDifferences(portal, apps);

const doc = {
    note: 'REPORT, never a gate. The node routes that both browser client libraries call (the portal\'s aimeat/public/js/services/ and the app libraries in aimeat/src/static/sdk-libs/, served as /v1/libs/aimeat-*.js) with different query parameter names, as `pnpm audit:browser-libs -- --write` last recorded them. A difference is a place to look, not a defect: the two serve different screens and may ask a route for different things. `pnpm debt` counts the entries. Written 2026-10-18 (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille, brief doc-mvdq71zdgo3o).',
    portalRoutes: portal.size,
    appRoutes: apps.size,
    sharedRoutes: shared.length,
    differences,
};
const text = JSON.stringify(doc, null, 2) + '\n';
const path = join(AIMEAT, BASELINE);

if (process.argv.includes('--write')) {
    writeFileSync(path, text, 'utf8');
    console.log(`✓ wrote ${BASELINE}: ${Object.keys(differences).length} route(s) called with different parameters`);
} else {
    console.log(`Portal services call ${portal.size} routes, the app libraries ${apps.size}; ${shared.length} are called by both.`);
    console.log(`${Object.keys(differences).length} of those are called with different query parameters:`);
    for (const [route, d] of Object.entries(differences)) {
        console.log(`  ${route}\n    portal: ${d.portal.join(', ') || '(none)'}\n    apps:   ${d.apps.join(', ') || '(none)'}`);
    }
    const current = existsSync(path) && readFileSync(path, 'utf8').replace(/\r\n/g, '\n') === text;
    console.log(current ? `${BASELINE} is current.` : `${BASELINE} is not current: \`pnpm audit:browser-libs -- --write\` records it.`);
}
