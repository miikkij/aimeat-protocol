/**
 * @file check-openapi-routes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The contract and the code name the same routes.
 *
 *   `openapi.yaml` is the canonical API contract, and the backend rule says a route and its entry
 *   land in the same commit. Nothing checked it. On 2026-09-18 the instruction review compared the
 *   two and found 80 (method, path) pairs declared in code and absent from the contract, and one
 *   entry describing a route that had been deleted from the code on 2026-05-21 in a security pass
 *   (POST /v1/federation/auth/refresh) and had answered 404 ever since. A client generated from
 *   that contract calls a route that is not there, and cannot call eighty that are.
 *
 *   TWO DIRECTIONS.
 *   1. Every `<router>.<method>('<path>'` under aimeat/src/ is in the contract, or is named in
 *      NOT_API with the reason it is not part of the API (a page a person opens, a static asset, a
 *      redirect, a development harness). The contract describes what a client calls.
 *   2. Every (method, path) in the contract is declared in code, or is named in DECLARED_ELSEWHERE
 *      with where it is served from (a sub-router mounted with `use`, a WebSocket upgrade, a path
 *      built from a constant).
 *
 *   Both lists hold ANSWERS, one sentence each. Neither is a backlog: there is no placeholder
 *   word, and a new route that is neither documented nor answered fails. `cli/` is left out: the
 *   connector's local server and its HTTP client calls are not this node's API.
 * @structure norm · contractPairs · codePairs · NOT_API · DECLARED_ELSEWHERE · main
 * @usage pnpm check:openapi-routes   (add --list to print every pair the code declares)
 * @version-history
 *   v1.0.2 — 2026-09-26 — GET /app-frame-core.js answered as a static asset (the module it imports).
 *   v1.0.1 — 2026-09-25 — GET /app-frame.js answered as a static asset (the isolated frame's page script).
 *   v1.0.0 — 2026-09-18 — Initial. Instruction review, item 13.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const SRC = join(REPO, 'aimeat', 'src');

/** A path with every parameter, template hole and wildcard written the same way. */
const norm = (p: string): string => p
    .replace(/\\/g, '')
    .replace(/\$\{[^}]+\}|:[A-Za-z_][A-Za-z0-9_]*\??|\{[^}]+\}|\*[A-Za-z_]*/g, '{}')
    .replace(/\/+$/, '') || '/';

/** `<method> <path>` pairs the code declares and the contract leaves out on purpose, with the reason. */
const PAGE = 'Sends an HTML page a person opens in a browser.';
const REDIRECT = 'Only redirects a browser to a page.';
const ASSET = 'A static file a browser or a crawler fetches (icon, script, manifest, robots, sitemap, ownership file).';
/** Every answer below was decided by reading the handler, on 2026-09-18. */
const NOT_API: Record<string, string> = {
    'GET /app-catalog.html': PAGE,
    'GET /app-silent.html': PAGE,
    'GET /spa.html': PAGE,
    'GET /v1/admin/setup': PAGE,
    'GET /v1/agents/verify': PAGE,
    'GET /v1/connect': PAGE,
    'GET /v1/connect/{}': PAGE,
    'GET /v1/echat': PAGE,
    'GET /v1/oauth/consent': PAGE,
    'GET /v1/portal': PAGE,
    'GET /v1/portfolio/{}': PAGE,
    'GET /v1/privacy': PAGE,
    'GET /v1/privacy/{}': PAGE,
    'GET /v1/terms': PAGE,
    'GET /v1/terms/{}': PAGE,
    'GET /{}/{}': 'On the bare app host: redirects to the app\'s own subdomain, or serves the app\'s HTML.',
    'GET /everything': REDIRECT,
    'GET /start': REDIRECT,
    'GET /v1/admin/ui': REDIRECT,
    'GET /v1/pricing': REDIRECT,
    'GET /app-frame.js': ASSET,
    'GET /app-frame-core.js': ASSET,
    'GET /apple-touch-icon.png': ASSET,
    'GET /favicon.ico': ASSET,
    'GET /favicon.svg': ASSET,
    'GET /icon.svg': ASSET,
    'GET /manifest.webmanifest': ASSET,
    'GET /robots.txt': ASSET,
    'GET /sitemap-portfolios.xml': ASSET,
    'GET /sw.js': ASSET,
    'GET /{}.txt': ASSET,
    'GET /v1/portal/cookie-consent.js': ASSET,
    // The contract documents GET /v1/libs, the catalogue that lists every library with its URL and
    // its usage document. A served .js bundle is what that catalogue points at, not an operation.
    'GET /v1/libs/aimeat-auth.js': ASSET,
    'GET /v1/libs/aimeat-{}.js': ASSET,
    'GET /v1/libs/portfolio-standalone.js': ASSET,
    'GET /v1/libs/test-harness': 'Registered only in development mode: an HTML page that loads every library.',
};

/** `<method> <path>` pairs the contract documents and a plain declaration does not show, with where they are served. */
const DECLARED_ELSEWHERE: Record<string, string> = {
    'GET /v1/a2a/{}/{}/agent-card.json': 'routes/a2a.ts mounts it with router.use, because the A2A SDK handler is an Express app of its own.',
    'POST /v1/a2a/{}/{}': 'routes/a2a.ts mounts the A2A JSON-RPC handler with router.use for the same reason.',
    'GET /v1/connect/tunnel': 'A WebSocket upgrade, registered on the HTTP server in index-start.ts, not on a router.',
    'GET /v1/schemas/ai-provenance/v1.json': 'routes/ai-provenance.ts declares it through the constant AI_PROVENANCE_SCHEMA_PATH, so the path is not a literal at the call.',
    'GET /v1/scim/v2/{}/Users': 'routes/scim.ts mounts a sub-router under /v1/scim/v2/:id with router.use; the SCIM paths are declared relative to it.',
    'POST /v1/scim/v2/{}/Users': 'The same SCIM sub-router.',
    'GET /v1/libs/aimeat-calendar.js': 'Served by the one family route /v1/libs/aimeat-:name.js in routes/libs.ts; the contract documents these two libraries by name.',
    'GET /v1/libs/aimeat-print.js': 'The same family route.',
};

function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? filesUnder(full) : [full];
    });
}

function contractPairs(): Map<string, string> {
    const spec = parseYaml(readFileSync(join(REPO, 'openapi.yaml'), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    const pairs = new Map<string, string>();
    for (const [path, ops] of Object.entries(spec.paths)) {
        for (const method of Object.keys(ops)) {
            if (/^(get|post|put|patch|delete)$/.test(method)) pairs.set(`${method.toUpperCase()} ${norm(path)}`, path);
        }
    }
    return pairs;
}

function codePairs(): Map<string, string> {
    const pairs = new Map<string, string>();
    // Any receiver: routers are named router, r, app, api and more. The ones left out are HTTP
    // CLIENTS whose calls look the same (`client.get('/v1/...')`), and the guest-side `ctx`.
    const decl = /\b(?!client\b|http\b|api\b|ctx\b)[A-Za-z_][A-Za-z0-9_]*\.(get|post|put|patch|delete)\(\s*(?:\[\s*)?['"`](\/[^'"`]*)['"`]/g;
    for (const file of filesUnder(SRC)) {
        if (!file.endsWith('.ts') || /[\\/](generated|cli)[\\/]/.test(file) || /index-connect\.ts$/.test(file)) continue;
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(decl)) {
            const key = `${m[1].toUpperCase()} ${norm(m[2])}`;
            if (!pairs.has(key)) pairs.set(key, file.slice(SRC.length + 1).replace(/\\/g, '/'));
        }
    }
    return pairs;
}

function main(): void {
    const contract = contractPairs();
    const code = codePairs();
    if (process.argv.includes('--list')) {
        for (const [pair, file] of [...code.entries()].sort()) console.log(`${contract.has(pair) ? ' ' : NOT_API[pair] ? '-' : '!'} ${pair}   ${file}`);
        return;
    }
    const undocumented = [...code.entries()].filter(([pair]) => !contract.has(pair) && !NOT_API[pair]).sort();
    const ghosts = [...contract.entries()].filter(([pair]) => !code.has(pair) && !DECLARED_ELSEWHERE[pair]).sort();
    const staleNotApi = Object.keys(NOT_API).filter(pair => !code.has(pair) || contract.has(pair));
    const staleElsewhere = Object.keys(DECLARED_ELSEWHERE).filter(pair => !contract.has(pair) || code.has(pair));

    if (undocumented.length) {
        console.error(`\n✗ ${undocumented.length} route(s) declared in code and missing from openapi.yaml:`);
        for (const [pair, file] of undocumented) console.error(`    ${pair}   (${file})`);
        console.error('  Add the entry to openapi.yaml in the same commit as the route. If it is not part of the API (a page,'
            + '\n  a static asset, a redirect, a development harness), add it to NOT_API in this script with the reason.');
    }
    if (ghosts.length) {
        console.error(`\n✗ ${ghosts.length} route(s) in openapi.yaml that no code declares:`);
        for (const [pair, path] of ghosts) console.error(`    ${pair}   (${path})`);
        console.error('  A contract entry for a route that answers 404 is worse than none. Remove it, or if the route is served'
            + '\n  in a way this script cannot see, add it to DECLARED_ELSEWHERE with where.');
    }
    for (const pair of staleNotApi) console.error(`\n✗ NOT_API names "${pair}", which is ${code.has(pair) ? 'in the contract now' : 'no longer declared in code'}. Remove the entry.`);
    for (const pair of staleElsewhere) console.error(`\n✗ DECLARED_ELSEWHERE names "${pair}", which is ${contract.has(pair) ? 'declared plainly in code now' : 'no longer in the contract'}. Remove the entry.`);
    if (undocumented.length || ghosts.length || staleNotApi.length || staleElsewhere.length) process.exit(1);
    console.log(`✓ the contract and the code name the same routes (${contract.size} documented, ${Object.keys(NOT_API).length} answered as not API)`);
}

main();
