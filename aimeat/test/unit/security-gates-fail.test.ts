/**
 * @file test/unit/security-gates-fail.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Each of nine security gates is shown to refuse a known breach of its rule, to pass the
 *   correct shape beside it, and to stay blind to one shape its own header says it cannot see, so
 *   that limit is a checked statement and not only a paragraph.
 *
 *   The nine had no test that named them or their detection function (QA audit S10-09): the gates
 *   for invariants 1 (check:identity-resolution), 3 (check:outbound-fetch), 5
 *   (check:federation-signatures), 9 (check:denial-coverage), 11 (check:owner-principal) and 15
 *   (check:scope-parity), plus check:open-writes, check:peer-paths and the shared triage clock.
 *
 *   HOW. The file-walking gates (outbound-fetch, peer-paths, denial-coverage) take their root from
 *   the working directory, so the real script runs in a child process against a fixture tree in a
 *   temp directory and the exit code is the verdict. The gates that read the compiler's program are
 *   pinned to the repository's own tsconfig, so their exported detection function runs on a small
 *   program built from fixture files; that is the code that decides what the gate reports.
 *   check:scope-parity's comparison is exported for the same reason (scripts/check-scope-parity.ts
 *   v1.x, findings()).
 * @usage cd aimeat && pnpm exec vitest run test/unit/security-gates-fail.test.ts
 * @version-history
 *   2026-10-18 — check:identity-resolution and check:owner-principal read all of src/ less an
 *     exclusion list, and a planted name comparison in src/commerce is reported
 *     (wish wish-identiteettitarkistukset-kaupank-yntikoodiin-ja-kolmeen-muuh).
 *   2026-10-18 — check:python-shapes and check:python-daemon each refuse a planted copy of the Python
 *     package and an allowlist missing an entry, and audit:browser-libs reports a planted difference
 *     (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 *   2026-10-16 — Merged beside W17 and W29: check:federation-signatures follows a helper of its own
 *     file (its limit is now another file's function), and check:denial-coverage runs its suite
 *     question alone on the fixture tree (AIMEAT_DENIAL_ROUTES=off), which has no openapi.yaml.
 *   2026-10-16 — Initial (QA audit S10-09).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFederationWrites } from '../../scripts/check-federation-signatures.js';
import { identityReads } from '../../scripts/inventory/identity-reads.js';
import { ownerDecisions } from '../../scripts/inventory/owner-decisions.js';
import { inGateScope } from '../../scripts/inventory/program.js';
import { collectDoors, openWriteDoors, toRows } from '../../scripts/inventory/doors.js';
import { staleTriage } from '../../scripts/inventory/triage-clock.js';
import { scopeParityFindings, scopeParitySources } from '../../scripts/check-scope-parity.js';
import { readVocabulary } from '../../scripts/inventory/scope-vocabulary.js';
import { callsInText, routeDifferences } from '../../scripts/inventory/browser-lib-routes.js';

const AIMEAT = fileURLToPath(new URL('../..', import.meta.url));
const TSX = import.meta.resolve('tsx');
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** A fixture tree: `files` maps a path under the root to its text. */
function tree(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'aimeat-gate-fixture-'));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text, 'utf8');
    }
    return root;
}

/** The real gate script, strict, with the fixture tree as its working directory. */
function runGate(script: string, root: string, env: Record<string, string> = {}): { code: number; out: string } {
    const r = spawnSync(process.execPath, ['--import', TSX, join(AIMEAT, 'scripts', script), '--strict'],
        { cwd: root, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

/** A parsed file with parents set, for the detectors that need no type checker. */
function source(path: string, text: string): ts.SourceFile {
    return ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true);
}

/** A typed program over fixture files, for the detectors that ask the checker what `req.auth` is. */
function typed(files: Record<string, string>): { program: ts.Program; files: ts.SourceFile[]; root: string } {
    const root = tree(files);
    const paths = Object.keys(files).map(p => join(root, p));
    const program = ts.createProgram(paths, { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, skipLibCheck: true, types: [] });
    program.getTypeChecker();
    return { program, files: paths.map(p => program.getSourceFile(p)!).filter(Boolean), root };
}

/** The declarations a route fixture needs: the verified token type and an Express-like router. */
const DECLS = `
interface VerifiedToken { sub: string; owner: string; roles: string[] }
interface Req { auth?: VerifiedToken; params: Record<string, string> }
interface Res { status(code: number): Res; json(body: unknown): void }
declare const router: { post(path: string, ...h: Array<(req: Req, res: Res) => void>): void; get(path: string, ...h: Array<(req: Req, res: Res) => void>): void };
declare function save(id: string): void;
declare function resolveIdentity(t: VerifiedToken, node: string): string;
declare function requireOwnerPrincipal(): (req: Req, res: Res) => void;
declare function error(node: string, code: string, msg: string): unknown;
`;

// ── Invariant 3: check:outbound-fetch ──
describe('check:outbound-fetch refuses a bare fetch of a caller-chosen URL', () => {
    const exemptions = JSON.stringify({ note: 'fixture', exempt: {} });
    it('refuses fetch(url)', () => {
        const root = tree({ 'src/services/x.ts': 'export async function f(url: string) { return fetch(url); }\n', 'security/outbound-fetch-exemptions.json': exemptions });
        const r = runGate('check-outbound-fetch.ts', root);
        expect(r.code).toBe(1);
        expect(r.out).toContain('src/services/x.ts');
    });
    it('passes safeFetch(url), a constant URL and a fetch( inside a line comment', () => {
        const root = tree({
            'src/services/x.ts': [
                'export async function f(url: string) { return safeFetch(url); }',
                // Two arguments: the gate reads the text up to the first comma as the URL, so a lone
                // literal followed by `)` is reported (it errs toward reporting).
                "export async function g() { return fetch('https://example.org/x', { method: 'GET' }); }",
                '// a fetch(url) in prose is not a call',
                'declare function safeFetch(u: string): Promise<unknown>;',
            ].join('\n') + '\n',
            'security/outbound-fetch-exemptions.json': exemptions,
        });
        expect(runGate('check-outbound-fetch.ts', root).code).toBe(0);
    });
    it('stays blind to a client that is not fetch (its documented limit: the rule stops at fetch)', () => {
        const root = tree({ 'src/services/x.ts': "import net from 'node:net';\nexport function f(host: string) { return net.connect(25, host); }\n", 'security/outbound-fetch-exemptions.json': exemptions });
        expect(runGate('check-outbound-fetch.ts', root).code).toBe(0);
    });
});

// ── check:peer-paths ──
describe('check:peer-paths refuses an unlisted peer writer or reader', () => {
    const ledger = (writers: Record<string, unknown>, readers: Record<string, unknown> = {}) => JSON.stringify({ about: 'fixture', writers, readers });
    it('refuses a new writer of a federation peer', () => {
        const root = tree({ 'src/routes/p.ts': 'export async function f(s: any, p: any) { await s.saveFederationPeer(p); }\n', 'security/peer-paths.json': ledger({}) });
        expect(runGate('check-peer-paths.ts', root).code).toBe(1);
    });
    it('refuses a new reader that trusts a peer url', () => {
        const root = tree({ 'src/routes/p.ts': 'export function f(peer: { url: string }) { return peer.url; }\n', 'security/peer-paths.json': ledger({}) });
        expect(runGate('check-peer-paths.ts', root).code).toBe(1);
    });
    it('passes a listed writer, and refuses it once its count grows', () => {
        const one = 'export async function f(s: any, p: any) { await s.saveFederationPeer(p); }\n';
        const listed = ledger({ 'src/routes/p.ts': { count: 1, why: 'fixture: the owner session binds the node id' } });
        expect(runGate('check-peer-paths.ts', tree({ 'src/routes/p.ts': one, 'security/peer-paths.json': listed })).code).toBe(0);
        const two = one + 'export async function g(s: any, p: any) { await s.saveFederationPeer(p); }\n';
        expect(runGate('check-peer-paths.ts', tree({ 'src/routes/p.ts': two, 'security/peer-paths.json': listed })).code).toBe(1);
    });
    it('stays blind to a destructured read (its documented limit: the `<peer>.url` shape only)', () => {
        const root = tree({ 'src/routes/p.ts': 'export function f(peer: { url: string }) { const { url } = peer; return url; }\n', 'security/peer-paths.json': ledger({}) });
        expect(runGate('check-peer-paths.ts', root).code).toBe(0);
    });
});

// ── Invariant 9: check:denial-coverage ──
describe('check:denial-coverage refuses a registered suite that never asserts a refusal', () => {
    const runner = "const ALL_SUITES = [\n    'test/e2e-fixture.ts',\n];\n";
    const exemptions = JSON.stringify({ note: 'fixture', exempt: {} });
    // The suite question alone: the fixture tree has no openapi.yaml for the route question.
    const run = (suite: string) => runGate('check-denial-coverage.ts', tree({ 'test/run-e2e-ci.ts': runner, 'test/e2e-fixture.ts': suite, 'security/denial-coverage-exemptions.json': exemptions }), { AIMEAT_DENIAL_ROUTES: 'off' });
    it('refuses a suite with only positive assertions', () => {
        expect(run("assert(r.status === 200, 'works');\n").code).toBe(1);
    });
    it('refuses a suite whose 403 is only in the message, and one that asserts !r.isError', () => {
        expect(run("assert(ok, 'expected 403 eventually');\n").code).toBe(1);
        expect(run("assert(!r.isError, 'the call worked');\n").code).toBe(1);
    });
    it('passes a suite that asserts a 403, and an MCP suite that asserts isError', () => {
        expect(run("assert(r.status === 403, 'refused');\n").code).toBe(0);
        expect(run("assert(r.isError, 'refused');\n").code).toBe(0);
    });
});

// ── Invariant 5: check:federation-signatures ──
describe('check:federation-signatures finds a federation write door that is neither owner-gated nor signed', () => {
    const doors = (text: string) => collectFederationWrites([source(join(AIMEAT, 'src/routes/federation-fixture.ts'), text)]);
    it('reports a door with no guard and no verify() as neither', () => {
        const [d] = doors("router.post('/v1/federation/x', (req, res) => { res.json({}); });");
        expect(d).toMatchObject({ id: 'POST /v1/federation/x', gated: false, verifies: false });
    });
    it('counts verify() in the handler as signed, and an owner role or a guard array as gated', () => {
        const all = doors([
            "router.post('/v1/federation/a', (req, res) => { if (!verify(k, p, s)) return; });",
            "router.post('/v1/federation/b', requireAuth(), requireRole('owner'), (req, res) => {});",
            'const peerGate = [requireAuth(), requireRole(\'owner\')];',
            "router.post('/v1/federation/c', ...peerGate, (req, res) => {});",
        ].join('\n'));
        expect(all.find(d => d.id.endsWith('/a'))).toMatchObject({ verifies: true });
        expect(all.find(d => d.id.endsWith('/b'))).toMatchObject({ gated: true });
        expect(all.find(d => d.id.endsWith('/c'))).toMatchObject({ gated: true });
    });
    it('does not count requireAuth() alone as gated: any signed-in account passes it', () => {
        const [d] = doors("router.post('/v1/federation/d', requireAuth(), (req, res) => {});");
        expect(d).toMatchObject({ gated: false, verifies: false });
    });
    it('follows a helper of its own file into its body, so a verify inside one counts as signed', () => {
        const [d] = doors("function check(req) { return verify(k, p, s); }\nrouter.post('/v1/federation/h', (req, res) => { check(req); });");
        expect(d).toMatchObject({ verifies: true });
    });
    it('does not follow a function of another file (its documented limit: own file only), so an imported verifier reads as neither', () => {
        const [d] = doors("import { check } from './elsewhere.js';\nrouter.post('/v1/federation/i', (req, res) => { check(req); });");
        expect(d).toMatchObject({ gated: false, verifies: false });
    });
});

// ── Invariant 1: check:identity-resolution ──
describe('check:identity-resolution finds a unit that hands `sub` on without resolving the caller', () => {
    let reads: ReturnType<typeof identityReads>;
    beforeAll(() => {
        const t = typed({ 'src/routes/fixture.ts': DECLS + [
            "router.post('/v1/raw', (req, res) => { save(req.auth!.sub); });",
            "router.post('/v1/resolved', (req, res) => { save(resolveIdentity(req.auth!, 'node')); console.log(req.auth!.sub); });",
            "router.post('/v1/person', (req, res) => { if (!req.auth!.roles.includes('agent')) save(req.auth!.sub); });",
        ].join('\n') });
        reads = identityReads(t.program, t.files, t.root);
    });
    it('reports the raw read, handed to a call', () => {
        expect(reads.find(r => r.unit === 'POST /v1/raw')).toMatchObject({ resolvesToo: false, asArgument: true });
    });
    it('does not report a unit that resolves, or computes the person test by hand', () => {
        expect(reads.filter(r => r.unit === 'POST /v1/resolved').every(r => r.resolvesToo)).toBe(true);
        expect(reads.filter(r => r.unit === 'POST /v1/person').every(r => r.resolvesToo)).toBe(true);
    });
});

// ── Invariant 11: check:owner-principal ──
describe('check:owner-principal finds a refusal decided by the owner name alone', () => {
    let rows: ReturnType<typeof ownerDecisions>;
    beforeAll(() => {
        const t = typed({ 'src/routes/fixture.ts': DECLS + [
            "router.post('/v1/name-only/:o', (req, res) => { if (req.auth!.owner !== req.params.o) { res.status(403).json({}); return; } });",
            "router.post('/v1/principal/:o', requireOwnerPrincipal(), (req, res) => { if (req.auth!.owner !== req.params.o) { res.status(403).json({}); return; } });",
            "router.post('/v1/conflict/:o', (req, res) => { if (req.auth!.owner === req.params.o) { res.status(409).json({}); return; } });",
        ].join('\n') });
        rows = ownerDecisions(t.program, t.files, t.root);
    });
    it('reports the name-only refusal', () => {
        expect(rows.find(r => r.unit === 'POST /v1/name-only/:o')).toMatchObject({ namesPrincipal: false });
    });
    it('marks the door that names the principal, and leaves a 409 lockout guard out', () => {
        expect(rows.find(r => r.unit === 'POST /v1/principal/:o')).toMatchObject({ namesPrincipal: true });
        expect(rows.find(r => r.unit === 'POST /v1/conflict/:o')).toBeUndefined();
    });
});

// ── Invariants 1 and 11: the scan covers all of src/, so src/commerce is read ──
describe('check:identity-resolution and check:owner-principal read all of src/ less an exclusion list', () => {
    it('scans src/commerce, src/auth, src/middleware and a directory nobody has named yet', () => {
        for (const dir of ['commerce', 'auth', 'middleware', 'tool-dispatch', 'brand-new-dir']) {
            expect(inGateScope(join(AIMEAT, 'src', dir, 'x.ts'))).toBe(true);
        }
    });
    it('leaves out unit tests, generated files, static browser code and seeded data', () => {
        for (const p of ['src/commerce/__tests__/x.test.ts', 'src/services/x.test.ts', 'src/services/ui-library/facts.generated.ts', 'src/static/x.ts', 'src/data/x.ts']) {
            expect(inGateScope(join(AIMEAT, p))).toBe(false);
        }
    });
    it('reports a planted name comparison and a raw `sub` handed on inside src/commerce', () => {
        const t = typed({ 'src/commerce/fixture.ts': DECLS + [
            "export function refund(auth: VerifiedToken, order: { owner: string }) { if (auth.owner !== order.owner) throw new Error('not yours'); }",
            'export function fileOrder(auth: VerifiedToken) { save(auth.sub); }',
        ].join('\n') });
        const scanned = t.files.filter(f => inGateScope(f.fileName));
        expect(ownerDecisions(t.program, scanned, t.root).find(r => r.unit === 'refund')).toMatchObject({ file: 'src/commerce/fixture.ts', namesPrincipal: false });
        expect(identityReads(t.program, scanned, t.root).find(r => r.unit === 'fileOrder')).toMatchObject({ file: 'src/commerce/fixture.ts', resolvesToo: false, asArgument: true });
    });
});

// ── check:open-writes ──
describe('check:open-writes finds a writing REST route that admits a caller with no credential', () => {
    const rows = (path: string, text: string) => openWriteDoors(toRows(collectDoors([source(join(AIMEAT, path), text)])));
    it('reports a POST with no middleware', () => {
        expect(rows('src/routes/fixture.ts', "router.post('/v1/open', (req, res) => {});").map(r => r.id)).toEqual(['POST /v1/open']);
    });
    it('does not report a gated POST, a GET, or a federation path (which the signature gate owns)', () => {
        expect(rows('src/routes/fixture.ts', [
            "router.post('/v1/closed', requireAuth(), (req, res) => {});",
            "router.get('/v1/read', (req, res) => {});",
            "router.post('/v1/federation/x', (req, res) => {});",
        ].join('\n'))).toEqual([]);
    });
    it('stays blind to a route registered outside src/routes (its documented limit, QA audit S10-03)', () => {
        expect(rows('src/mcp/fixture.ts', "app.post('/mcp/register', (req, res) => {});")).toEqual([]);
    });
});

// ── Invariant 15: check:scope-parity ──
describe('check:scope-parity finds a permission word on one side only', { timeout: 120_000 }, () => {
    let files: ts.SourceFile[];
    let vocabulary: Set<string>;
    beforeAll(() => {
        files = scopeParitySources(join(AIMEAT, 'src'));
        vocabulary = readVocabulary(AIMEAT);
    }, 120_000);
    it('the real tree has no finding outside the exemption file it is checked against', () => {
        const keys = scopeParityFindings(files, vocabulary, AIMEAT).map(f => f.key);
        expect(keys).not.toContain('demanded:fixture:made-up');
    });
    it('reports a word a route demands that the owner is never offered', () => {
        const route = source(join(AIMEAT, 'src/routes/fixture-scope.ts'), "router.post('/v1/x', requireScope('fixture:made-up'), (req, res) => {});");
        const keys = scopeParityFindings([...files, route], vocabulary, AIMEAT).map(f => f.key);
        expect(keys).toContain('demanded:fixture:made-up');
    });
    it('reports a word the owner is offered that no door asks for', () => {
        const keys = scopeParityFindings(files, new Set([...vocabulary, 'fixture:offered']), AIMEAT).map(f => f.key);
        expect(keys).toContain('offered:fixture:offered');
    });
});

// ── The shared triage clock ──
describe('the triage clock refuses an undated or stale clearance', () => {
    const today = new Date().toISOString().slice(0, 10);
    it('reports a triaged entry with no stamp, and one older than the ceiling', () => {
        const r = staleTriage({ a: 'right because X', b: 'right because Y [triaged 2020-01-01]' }, 90);
        expect(r.undated).toEqual(['a']);
        expect(r.stale.map(s => s.key)).toEqual(['b']);
    });
    it('passes a fresh stamp, and does not age a SEEDED question', () => {
        const r = staleTriage({ a: `right because X [triaged ${today}]`, b: 'SEEDED 2026-09-04, NOT TRIAGED' }, 90);
        expect(r).toMatchObject({ undated: [], stale: [], watched: 1 });
    });
});

// ── The pairs written twice: the Python package against the node and the connector ──
// Wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille. The real scripts run on a
// copy of the Python package's source (and of the allowlists), planted, through the environment
// variables the scripts read for exactly this.
describe('check:python-shapes and check:python-daemon refuse a difference nobody listed', { timeout: 180_000 }, () => {
    const PY = join(AIMEAT, '..', 'python', 'aimeat-crewai', 'src', 'aimeat_crewai');
    const FIXTURE = join(AIMEAT, '..', 'python', 'aimeat-crewai', 'tests', 'fixtures', 'node-offer-schema.json');
    /** The package's source, with `edit` applied to one file, in a temp directory. */
    function pythonCopy(edit?: { file: string; from: string; to: string }): string {
        const files: Record<string, string> = {};
        for (const name of readdirSync(PY).filter(n => n.endsWith('.py'))) files[name] = readFileSync(join(PY, name), 'utf8');
        if (edit) {
            expect(files[edit.file]).toContain(edit.from);
            files[edit.file] = files[edit.file].replace(edit.from, edit.to);
        }
        return tree(files);
    }
    /** An allowlist copy without the entry `drop`. */
    function allowlistWithout(file: string, drop: string): string {
        const j = JSON.parse(readFileSync(join(AIMEAT, 'security', file), 'utf8')) as { exempt: Record<string, string> };
        expect(j.exempt).toHaveProperty([drop]);
        delete j.exempt[drop];
        return join(tree({ 'allow.json': JSON.stringify(j) }), 'allow.json');
    }
    const run = (script: string, env: Record<string, string>) => runGate(script, AIMEAT, env);

    it('check:python-shapes passes the package as it is', () => {
        expect(run('check-python-shapes.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy() }).code).toBe(0);
    });
    it('check:python-shapes refuses a node field the Python builder does not name', () => {
        // The same finding a field added to OfferSchema makes: the node has `exchange`, build_offer does not.
        const r = run('check-python-shapes.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy(), AIMEAT_PARITY_SHAPE_ALLOWLIST: allowlistWithout('python-shape-parity.json', 'offer.field.node-only:exchange') });
        expect(r.code).toBe(1);
        expect(r.out).toContain('offer.field.node-only:exchange');
    });
    it('check:python-shapes refuses a field build_offer stops writing, and a signal op Python drops', () => {
        expect(run('check-python-shapes.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy({ file: 'offers.py', from: '"tags": tags,', to: '' }) }).out).toContain('offer.field.node-only:tags');
        expect(run('check-python-shapes.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy({ file: 'workflow_spec.py', from: '"json_valid", ', to: '' }) }).code).toBe(1);
    });
    it('check:python-shapes refuses a fixture that no longer matches the zod schemas', () => {
        const stale = join(tree({ 'f.json': readFileSync(FIXTURE, 'utf8').replace('"TOLL_MORSELS_MAX": 100', '"TOLL_MORSELS_MAX": 99') }), 'f.json');
        const r = run('check-python-shapes.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy(), AIMEAT_PARITY_FIXTURE: stale });
        expect(r.code).toBe(1);
        expect(r.out).toContain('no longer matches');
    });
    it('check:python-daemon passes the package as it is', () => {
        expect(run('check-python-daemon.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy() }).code).toBe(0);
    });
    it('check:python-daemon refuses a loopback route the serve daemon does not register, and a tool the connector lacks', () => {
        const route = run('check-python-daemon.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy({ file: 'daemon.py', from: '"/local/invoke/next"', to: '"/local/invoke/upcoming"' }) });
        expect(route.code).toBe(1);
        expect(route.out).toContain('local.python-only:GET /local/invoke/upcoming');
        const tool = run('check-python-daemon.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy({ file: 'daemon.py', from: '"aimeat_task_complete",', to: '"aimeat_task_finish",' }) });
        expect(tool.code).toBe(1);
        expect(tool.out).toContain('tool.not-on-connector:aimeat_task_finish');
    });
    it('check:python-daemon refuses an endpoint the connector calls and the daemon does not, once it is not listed', () => {
        const r = run('check-python-daemon.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy(), AIMEAT_PARITY_DAEMON_ALLOWLIST: allowlistWithout('python-daemon-parity.json', 'rest.connector-only:POST /v1/agents/{}/tasks/{}/complete') });
        expect(r.code).toBe(1);
        expect(r.out).toContain('rest.connector-only:POST /v1/agents/{}/tasks/{}/complete');
    });
    it('stays blind to what a field means (its documented limit): the namespace-versus-name defect of the open incident passes', () => {
        // daemon.py keys its manifest map by objectType.name; keying it by namespace changes no name the check reads.
        const r = run('check-python-daemon.ts', { AIMEAT_PARITY_PYTHON_SRC: pythonCopy({ file: 'daemon.py', from: 'ot["name"]: ot["contract"]', to: 'ot["namespace"]: ot["contract"]' }) });
        expect(r.code).toBe(0);
    });
});

describe('audit:browser-libs finds a route both libraries call with different parameters', () => {
    it('reports the planted difference and follows a concatenated path', () => {
        const portal = callsInText("apiGet('/v1/memory/' + encodeURIComponent(k) + '?soft=1');\nfetch(`/v1/organisms/${id}/search?q=${q}`);");
        const apps = callsInText("authFetch('/v1/memory/' + encodeURIComponent(k) + '?soft=1&owner_scope=true');\n// fetch('/v1/organisms/x/search?q=1')\nfetch('/v1/organisms/' + id + '/search?q=' + q);");
        const { shared, differences } = routeDifferences(portal, apps);
        expect(shared).toEqual(['/v1/memory/{}', '/v1/organisms/{}/search']);
        expect(differences).toEqual({ '/v1/memory/{}': { portal: ['soft'], apps: ['owner_scope', 'soft'] } });
    });
});
