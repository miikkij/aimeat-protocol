/**
 * @file scripts/check-route-scopes.ts
 * @description The gate for Rule 10 invariant 4: every mutating route carries an explicit scope or
 *   role check. Whether a route requires a scope is stated in exactly one place, the argument list
 *   of an Express handler, and until this script nothing read that place. The August 2026 audit
 *   found roughly twenty findings that are each one entry in the list this produces.
 *
 *   Why it matters more than it reads: `requireScope`'s owner bypass deliberately excludes the
 *   `app` role, so `requireScope` is the ONLY middleware that stops an app-grant token. A mutating
 *   handler with `requireAuth()` alone is exactly the surface a granted app reaches holding whatever
 *   single scope the consent screen displayed.
 *
 *   Ratchet, not a wall: the exemption file is seeded with today's offenders, so the gate fails only
 *   on a NEW un-exempted handler. The count can go down and never up. Same shape as
 *   check-silent-catch.ts, which is the repo's established pattern for this.
 * @structure
 *   - GATES: middleware names that count as an explicit authorization decision
 *   - collectRoutes(): parse router.<verb>( calls and resolve their middleware chain
 *   - main(): compare against security/route-scope-exemptions.json; --strict exits 1 on new ones
 * @usage
 *   cd aimeat && pnpm check:route-scopes            # report
 *   cd aimeat && pnpm check:route-scopes --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:route-scopes --seed     # rewrite the exemption file from today's state
 * @version-history
 *   v1.1.0 — 2026-08-11 — requireOwnerPrincipal counts as a gate (August 2026 audit H-1/H-7), so
 *     the fourteen account-security routes it now carries could leave the exemption file.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, systemic pattern 1).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROUTES_DIR = join(ROOT, 'src', 'routes');
const EXEMPTIONS = join(ROOT, 'security', 'route-scope-exemptions.json');

/** Middleware that constitutes an explicit authorization decision. `requireAuth` is NOT one: it
 *  answers "is anyone there", never "may this principal do this". `requireOwnerPrincipal` is one:
 *  it answers "is this the account holder, or something acting for them", which is the decision the
 *  account-security doors need and the one no scope word can express. */
const GATES = ['requireScope', 'requireAnyScope', 'requireRole', 'requireRoleOrScope', 'requireOperator',
    'requireOwnerPrincipal'];

/** Verbs that change state. A GET is only checked when it already carries requireAuth (below). */
const MUTATING = ['post', 'put', 'patch', 'delete'];

export interface Finding {
    file: string;
    line: number;
    method: string;
    path: string;
}

interface ExemptionFile {
    /** Why this file exists, for whoever opens it in six months. */
    note: string;
    /** "file:line:METHOD:path" → one-line reason. Seeded entries carry the audit's reason. */
    exempt: Record<string, string>;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/**
 * The middleware section of a `router.verb(...)` call: everything between the path argument and the
 * handler. Stops at the handler's parameter list, which is the first `(req`/`(_req`/`(async` shape,
 * so a handler body full of parentheses never confuses the scan.
 */
function middlewareSection(source: string, from: number): string {
    const slice = source.slice(from, from + 900);
    const handlerAt = slice.search(/(async\s*)?\(\s*_?req\b|\basync\s*\(\s*_?\w*\s*[,)]/);
    return handlerAt > 0 ? slice.slice(0, handlerAt) : slice;
}

/** Middleware-array constants: `const auth = [requireAuth(), requireRole('operator')]`. */
function gatedArrayNames(source: string): Set<string> {
    const names = new Set<string>();
    const re = /const\s+(\w+)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
        if (GATES.some(g => m![2].includes(g))) names.add(m[1]);
    }
    return names;
}

/**
 * Federation is authorized by an Ed25519 peer signature verified inside the handler, not by a scope:
 * there is no auth middleware on `/v1/federation/*` by design (Rule 10 invariant 5), and a scope is
 * meaningless for a peer node. Those routes have their own gate and their own audit; asking them for
 * a scope would fill this list with noise and hide the routes that genuinely lack one.
 */
function isFederationRoute(rel: string, path: string): boolean {
    return rel.includes('/federation') || path.startsWith('/v1/federation');
}

export function collectRoutes(files: string[]): Finding[] {
    const findings: Finding[] = [];
    for (const file of files) {
        const source = readFileSync(file, 'utf-8');
        const rel = relative(ROOT, file).replace(/\\/g, '/');
        const arrays = gatedArrayNames(source);

        // A router-level gate applies to every route in the file: `router.use(requireAuth(), requireRole(...))`
        const routerLevelGate = /router\.use\(([^)]*(?:requireScope|requireRole|requireAnyScope)[^)]*)\)/.test(source);
        if (routerLevelGate) continue;

        const re = /router\.(post|put|patch|delete|get)\(\s*(['"`])([^'"`]+)\2\s*,?/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(source))) {
            const [, method, , path] = m;
            if (isFederationRoute(rel, path)) continue;
            const chain = middlewareSection(source, m.index + m[0].length);
            const hasGate = GATES.some(g => chain.includes(g))
                || [...arrays].some(name => new RegExp(`\\b${name}\\b`).test(chain));
            if (hasGate) continue;

            // A GET with no auth at all is a deliberately public read (catalogue, bootstrap, an
            // <img src> path). Only an AUTHENTICATED read is asked to say which scope it needs.
            if (method === 'get' && !chain.includes('requireAuth')) continue;

            const line = source.slice(0, m.index).split('\n').length;
            findings.push({ file: rel, line, method: method.toUpperCase(), path });
        }
    }
    return findings;
}

const key = (f: Finding) => `${f.file}:${f.line}:${f.method}:${f.path}`;
/** Line numbers move; the identity that survives an edit is file + method + path. */
const softKey = (f: Finding) => `${f.file}:${f.method}:${f.path}`;

function loadExemptions(): ExemptionFile {
    if (!existsSync(EXEMPTIONS)) return { note: '', exempt: {} };
    return JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile;
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');

    const files = walk(ROUTES_DIR);
    const findings = collectRoutes(files);

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const f of findings) {
            exempt[softKey(f)] = 'Seeded 2026-08-10 from the August audit. Not yet reviewed: this route '
                + 'changes state (or reads authenticated) without saying which scope it needs.';
        }
        const out: ExemptionFile = {
            note: 'Routes that mutate (or read while authenticated) without an explicit scope or role gate. '
                + 'Seeded from the state on 2026-08-10 so the gate can only ratchet down. Remove an entry when '
                + 'the route gets its gate; never add one without a written reason and an approver.',
            exempt,
        };
        writeFileSync(EXEMPTIONS, JSON.stringify(out, null, 2) + '\n');
        console.log(`Seeded ${findings.length} exemptions into ${relative(ROOT, EXEMPTIONS)}`);
        return;
    }

    const { exempt } = loadExemptions();
    const known = new Set(Object.keys(exempt));
    const fresh = findings.filter(f => !known.has(softKey(f)));
    const stale = [...known].filter(k => !findings.some(f => softKey(f) === k));

    const byFile = new Map<string, Finding[]>();
    for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);

    console.log('');
    console.log('  Route authorization gate — Rule 10 invariant 4');
    console.log('  ' + '─'.repeat(62));
    console.log(`  ungated handlers   ${String(findings.length).padStart(5)}`);
    console.log(`  of which exempt    ${String(findings.length - fresh.length).padStart(5)}   (seeded backlog, may only shrink)`);
    console.log(`  NEW, not exempt    ${String(fresh.length).padStart(5)}`);
    if (stale.length) console.log(`  exemptions now fixed ${String(stale.length).padStart(3)}   (remove them from the file)`);
    console.log('');

    if (fresh.length) {
        console.log('  A mutating route with requireAuth() alone is reachable by any app-grant token,');
        console.log('  whatever single scope its owner approved. Add requireScope/requireRole, or add an');
        console.log('  entry with a reason to security/route-scope-exemptions.json.');
        console.log('');
        for (const f of fresh) console.log(`    ${f.file}:${f.line}  ${f.method} ${f.path}`);
        console.log('');
    }

    if (strict && fresh.length) {
        console.error(`✖ ${fresh.length} new ungated route handler(s).`);
        process.exit(1);
    }
    console.log(fresh.length ? '  (report only — pass --strict to gate)' : '  ✓ no new ungated handlers');
}

main();
