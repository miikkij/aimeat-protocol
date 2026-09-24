/**
 * @file scripts/inventory/rest-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The CodeQL facts check:field-reach joins: which request fields each REST handler reads,
 *   which route each handler serves, which agent tool each handler function is, which functions in
 *   other files each of them calls, and which REST calls the connector and CLI tools make.
 *
 *   WHY CODEQL. On 2026-08-16 a detector that read each handler's source for the parameter names it
 *   mentioned was wrong in both directions within the hour. The question needs data flow: a field
 *   read three calls away in a service, through `Schema.safeParse(req.body).data`, through a copy
 *   made with a spread, is still a field the route takes. codeql/field-reach-facts.ql follows the
 *   value; this file runs it and reads the answer.
 *
 *   NOT ON THE SECURITY TAB. The query is an inventory, not a vulnerability, so it never runs in the
 *   CodeQL workflow (whose own comment records what low-precision queries did to that tab). It runs
 *   here, with the CLI, and the output is CSV nobody uploads.
 *
 *   COST AND CACHE. Measured 2026-09-14 on a Windows workstation: 88 s to build the database over
 *   src/, about 45 s to compile and run the query. The answer is cached under
 *   node_modules/.cache/field-reach/ by a hash of every file under src/, the query pack and the CLI
 *   version, so a second run over an unchanged tree reads files. CI builds it in its own step before
 *   check:fast.
 *
 *   WHERE THE CLI COMES FROM, in order: CODEQL_CLI (the path to the `codeql` executable), `codeql` on
 *   PATH, the per-user pointer `~/.aimeat/codeql.json` that `pnpm codeql:install` writes, and the
 *   GitHub runner's tool cache, which carries the CodeQL bundle on its hosted images. The pointer is
 *   what a workstation uses: it is read by every process, every worktree and every session, where an
 *   environment variable reaches only the shells started after it was set.
 * @structure CODEQL_BUNDLE, CODEQL_POINTER · resolveCodeql() · treeKey(cli) · buildFacts(cli, dir) ·
 *   loadFacts(opts) · parseCsv(text) · factsFromCsv(sets)
 * @usage
 *   const got = loadFacts({ build: true });
 *   if (got.facts) for (const r of got.facts.reads) console.log(r.kind, r.field, r.file, r.line, r.handler);
 * @version-history
 *   v1.1.0 — 2026-09-24 — resolveCodeql() reads ~/.aimeat/codeql.json. On 2026-09-16 the bundle was
 *     installed on the developer machine and pitfall 90 recorded CODEQL_CLI as naming it, but nothing
 *     set the variable, so the gate went on printing NOT MEASURED and passing; eight red CI pushes
 *     from 2026-09-16 to 2026-09-23 were findings that machine could have shown before the push.
 *   v1.0.0 — 2026-09-14 — Initial (wish-kenttien-tavoitettavuus-portiksi, step 3).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { AIMEAT } from './program.js';

/**
 * The CodeQL bundle a workstation installs: the release ci.yml downloads when the runner's tool cache
 * has none. Measured 2026-09-24: CI's tool cache carries the same 2.27.0, and a local measurement of
 * ea413de9d gave CI's counts and CI's cache key. Change both places together.
 */
export const CODEQL_BUNDLE = { tag: 'codeql-bundle-v2.27.0', version: '2.27.0' } as const;
/** `{ "cli": "<path to the codeql executable>", "version": "<its terse version>" }`, per user. */
export const CODEQL_POINTER = join(homedir(), '.aimeat', 'codeql.json');

/** The query pack: the query and its qlpack.yml. */
export const QUERY_DIR = join(AIMEAT, 'scripts', 'inventory', 'codeql');
const QUERY = join(QUERY_DIR, 'field-reach-facts.ql');
const CACHE_DIR = join(AIMEAT, 'node_modules', '.cache', 'field-reach');
/** The query's result sets, in the order the query declares them. */
export const RESULT_SETS = ['reads', 'routes', 'tools', 'calls', 'http'] as const;
type ResultSet = typeof RESULT_SETS[number];

export interface RestRead {
    /** `body` or `query`. */
    kind: 'body' | 'query';
    /** The property name read, as written: `organism_id`. Empty when `naming` is `unnamed`. */
    field: string;
    /**
     * `constant`: `body.organism_id`. `resolved`: `body[k]` with a string constant reaching `k`.
     * `unnamed`: `body[k]` and nothing CodeQL could follow names `k`, which is a blind spot.
     */
    naming: 'constant' | 'resolved' | 'unnamed';
    /** Where the field is read, relative to aimeat/. */
    file: string;
    line: number;
    /**
     * The route handler whose request this is, `file:line:column`, or `unrouted:file:line:column` when
     * the request reached this read through something no route registration names.
     */
    handler: string;
}

export interface Facts {
    reads: RestRead[];
    routes: { handler: string; method: string; path: string }[];
    tools: { surface: 'mcp.node' | 'mcp.connector' | 'cli.dispatch'; name: string; handler: string }[];
    calls: { unit: string; callee: string }[];
    http: { unit: string; method: string; path: string }[];
}

/** The `codeql` executable, or null when this machine has none. */
export function resolveCodeql(): string | null {
    const exe = process.platform === 'win32' ? 'codeql.exe' : 'codeql';
    if (process.env.CODEQL_CLI && existsSync(process.env.CODEQL_CLI)) return process.env.CODEQL_CLI;
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
        if (dir && existsSync(join(dir, exe))) return join(dir, exe);
    }
    if (existsSync(CODEQL_POINTER)) {
        try {
            const { cli } = JSON.parse(readFileSync(CODEQL_POINTER, 'utf-8')) as { cli?: string };
            if (cli && existsSync(cli)) return cli;
        } catch {
            // A pointer that does not parse names no CLI; `pnpm codeql:install` writes it again.
            console.error(`  ${CODEQL_POINTER} does not parse; run pnpm codeql:install`);
        }
    }
    // The hosted runner images carry the CodeQL bundle: $RUNNER_TOOL_CACHE/CodeQL/<version>/x64/codeql.
    const toolCache = process.env.RUNNER_TOOL_CACHE;
    if (toolCache && existsSync(join(toolCache, 'CodeQL'))) {
        for (const v of readdirSync(join(toolCache, 'CodeQL')).sort().reverse()) {
            const candidate = join(toolCache, 'CodeQL', v, 'x64', 'codeql', exe);
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
}

function run(cli: string, args: string[]): string {
    const r = spawnSync(cli, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
        throw new Error(`codeql ${args[0]} ${args[1] ?? ''} failed (exit ${r.status}):\n${(r.stderr || r.stdout || String(r.error)).slice(-4000)}`);
    }
    return r.stdout;
}

/** Every source file the database would hold, relative, sorted. */
function srcFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(relative(AIMEAT, p).split('\\').join('/'));
        }
    };
    walk(join(AIMEAT, 'src'));
    return out.sort();
}

/** A hash of what the answer depends on: the tree, the query pack, and the CLI's version. */
export function treeKey(cli: string): string {
    const h = createHash('sha256');
    h.update(run(cli, ['version', '--format=terse']).trim());
    for (const f of readdirSync(QUERY_DIR).sort()) h.update(f).update(readFileSync(join(QUERY_DIR, f)));
    for (const f of srcFiles()) h.update(f).update(readFileSync(join(AIMEAT, f)));
    return h.digest('hex').slice(0, 20);
}

/** Build the database over src/, run the query, and write one CSV per result set into `dir`. */
export function buildFacts(cli: string, dir: string): void {
    const work = mkdtempSync(join(tmpdir(), 'aimeat-field-reach-'));
    try {
        const config = join(work, 'codeql-config.yml');
        writeFileSync(config, 'paths:\n  - src\n');
        const db = join(work, 'db');
        const bqrs = join(work, 'facts.bqrs');
        run(cli, ['database', 'create', db, '--language=javascript-typescript', '--build-mode=none',
            `--source-root=${AIMEAT}`, `--codescanning-config=${config}`, '--threads=0', '--quiet']);
        run(cli, ['query', 'run', QUERY, `--database=${db}`, `--output=${bqrs}`, '--threads=0', '--quiet']);
        // Written into the work directory first and copied, not renamed: the temp directory and the
        // tree are on different drives on a Windows workstation, and a rename across devices fails.
        const staging = join(work, 'csv');
        mkdirSync(staging);
        for (const set of RESULT_SETS) {
            run(cli, ['bqrs', 'decode', bqrs, `--result-set=${set}`, '--format=csv', `--output=${join(staging, `${set}.csv`)}`]);
        }
        mkdirSync(dir, { recursive: true });
        for (const set of RESULT_SETS) copyFileSync(join(staging, `${set}.csv`), join(dir, `${set}.csv`));
    } finally {
        rmSync(work, { recursive: true, force: true });
    }
}

export type FactsResult =
    | { facts: Facts; dir: string; built: boolean }
    | { facts: null; reason: string };

/**
 * The facts for the current tree: from the cache when this tree was measured before, built when it
 * was not and `build` is true, and otherwise null with the reason.
 */
export function loadFacts(opts: { build: boolean }): FactsResult {
    const cli = resolveCodeql();
    if (!cli) return { facts: null, reason: 'no CodeQL CLI on this machine (run pnpm codeql:install)' };
    const dir = join(CACHE_DIR, treeKey(cli));
    const complete = (): boolean => RESULT_SETS.every(s => existsSync(join(dir, `${s}.csv`)));
    let built = false;
    if (!complete()) {
        if (!opts.build) return { facts: null, reason: `this tree has not been measured yet (${relative(AIMEAT, dir)})` };
        buildFacts(cli, dir);
        built = true;
    }
    const sets = Object.fromEntries(RESULT_SETS.map(s => [s, readFileSync(join(dir, `${s}.csv`), 'utf-8')])) as Record<ResultSet, string>;
    return { facts: factsFromCsv(sets), dir, built };
}

/**
 * RFC 4180 CSV as `codeql bqrs decode --format=csv` writes it: a header row, strings quoted, a quote
 * inside a string doubled. Returns the data rows.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
        } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.slice(1);
}

/**
 * The five result sets as typed facts.
 *
 * A row this cannot read throws. Skipping it would drop a read, a route or a tool, and every one of
 * those losses is in the permissive direction: the gate would stay green over what it never saw.
 */
export function factsFromCsv(sets: Record<ResultSet, string>): Facts {
    const rows = (set: ResultSet, width: number): string[][] => parseCsv(sets[set]).map(r => {
        if (r.length !== width) throw new Error(`field-reach-facts ${set}: a row with ${r.length} columns, expected ${width}: ${r.join(',').slice(0, 200)}`);
        return r;
    });
    const NAMING = new Set(['constant', 'resolved', 'unnamed']);
    const SURFACE = new Set(['mcp.node', 'mcp.connector', 'cli.dispatch']);
    return {
        reads: rows('reads', 6).map(([kind, field, naming, file, line, handler]) => {
            if ((kind !== 'body' && kind !== 'query') || !NAMING.has(naming) || !/^\d+$/.test(line)) {
                throw new Error(`field-reach-facts reads: a row this reader does not understand: ${kind},${field},${naming},${file},${line}`);
            }
            return { kind, field, naming: naming as RestRead['naming'], file, line: Number(line), handler };
        }),
        routes: rows('routes', 3).map(([handler, method, path]) => ({ handler, method, path })),
        tools: rows('tools', 3).map(([surface, name, handler]) => {
            if (!SURFACE.has(surface)) throw new Error(`field-reach-facts tools: unknown surface ${surface}`);
            return { surface: surface as Facts['tools'][number]['surface'], name, handler };
        }),
        calls: rows('calls', 2).map(([unit, callee]) => ({ unit, callee })),
        http: rows('http', 3).map(([unit, method, path]) => ({ unit, method, path })),
    };
}
