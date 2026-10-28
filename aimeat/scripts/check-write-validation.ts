/**
 * @file scripts/check-write-validation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every REST route that writes (POST, PUT, PATCH) and reads a request body checks that
 *   body against a schema, or is listed. The list may only shrink.
 *
 *   WHY. On 2026-10-27 the node had about 790 writing routes, and 46 of them checked their body with
 *   validateBody. The rest checked it by hand, in as many ways as there were authors, or not at all,
 *   so whether a field had a length limit, and whether a form got back the name of the field that
 *   was wrong, depended on the route (wish
 *   wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli). A schema gives both: the
 *   limits from models/input-limits.ts, and a 400 whose details name each field
 *   (models/validation-issues.ts).
 *
 *   HOW A ROUTE IS CLASSED (by reading the source, so it is a heuristic, and says so):
 *   - schema: `validateBody(...)` in its middleware chain, or its inline handler parses with a Zod
 *     schema (`.safeParse(` / `.parse(`, not `JSON.parse(`).
 *   - no body: its inline handler never reads `req.body` and hands `req` to no other function.
 *   - by hand: its inline handler reads `req.body` and parses nothing.
 *   - elsewhere: the handler is not written inline, or hands `req` to another function, so what it
 *     does with the body cannot be read here.
 *   "By hand" and "elsewhere" must be listed in security/write-validation-baseline.json. Each entry
 *   was seeded `UNREVIEWED` on 2026-10-27; giving the route a schema removes it, and an entry whose
 *   route no longer needs one fails until it is deleted, so the count only falls.
 * @structure classify(file, source) · main()
 * @usage
 *   cd aimeat && pnpm check:write-validation          # the gate
 *   cd aimeat && pnpm check:write-validation --list   # every route and its class
 *   cd aimeat && pnpm check:write-validation --seed   # rewrite the baseline from today's code (ask first)
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import ts from 'typescript';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(AIMEAT, 'security', 'write-validation-baseline.json');
const WRITES = new Set(['post', 'put', 'patch']);
const SEED_REASON = 'UNREVIEWED — reads its body without a schema (seeded 2026-10-27).';

export type WriteClass = 'schema' | 'no body' | 'by hand' | 'elsewhere';
export interface WriteRoute { id: string; file: string; line: number; cls: WriteClass }

function tsFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== '__tests__') tsFiles(full, out); }
        else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

const PARSES = /(?<!JSON)\.(safeParse|parse)\(/;
/** `req` handed whole to another function: `f(req`, `f(x, req`. */
const HANDS_REQ = /[(,]\s*req\s*[,)]/;

function classOf(chain: readonly ts.Expression[], handler: ts.Expression, source: ts.SourceFile): WriteClass {
    if (chain.some(a => ts.isCallExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === 'validateBody')) return 'schema';
    if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return 'elsewhere';
    const body = handler.body.getText(source);
    if (PARSES.test(body)) return 'schema';
    const reads = /\breq\.body\b/.test(body) || /\{[^}]*\bbody\b[^}]*\}\s*=\s*req\b/.test(body);
    if (reads) return 'by hand';
    return HANDS_REQ.test(body) ? 'elsewhere' : 'no body';
}

export function classify(file: string, source: ts.SourceFile): WriteRoute[] {
    const out: WriteRoute[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && WRITES.has(node.expression.name.text)
            && ts.isIdentifier(node.expression.expression) && /^(router|app)$/.test(node.expression.expression.text)) {
            const [first, ...rest] = node.arguments;
            const handler = rest[rest.length - 1];
            if (first && ts.isStringLiteral(first) && handler) {
                const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
                out.push({
                    id: `${node.expression.name.text.toUpperCase()} ${first.text}`,
                    file, line: line + 1,
                    cls: classOf(rest.slice(0, -1), handler, source),
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}

function allRoutes(): WriteRoute[] {
    const routes: WriteRoute[] = [];
    for (const full of tsFiles(path.join(AIMEAT, 'src', 'routes'))) {
        const rel = path.relative(AIMEAT, full).split(path.sep).join('/');
        routes.push(...classify(rel, ts.createSourceFile(full, readFileSync(full, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)));
    }
    // The same method and path in two files (a route split, an alias) are two entries.
    const seen = new Map<string, number>();
    for (const r of routes) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
    for (const r of routes) if ((seen.get(r.id) ?? 0) > 1) r.id = `${r.id} (${r.file})`;
    return routes.sort((a, b) => a.id.localeCompare(b.id));
}

interface Baseline { note: string; unvalidated: Record<string, string> }

export function main(): boolean {
    const routes = allRoutes();
    const owed = routes.filter(r => r.cls === 'by hand' || r.cls === 'elsewhere');
    const count = (c: WriteClass): number => routes.filter(r => r.cls === c).length;

    if (process.argv.includes('--seed')) {
        const file: Baseline = {
            note: 'REST routes that write and read a request body without a schema, keyed `METHOD path`. '
                + 'Seeded 2026-10-27 by scripts/check-write-validation.ts. Every entry reads UNREVIEWED until '
                + 'its route checks its body with a Zod schema (validateBody, or safeParse in the handler), which '
                + 'removes the entry. The gate refuses a new route that is not listed, and an entry whose route '
                + 'no longer needs it.',
            unvalidated: Object.fromEntries(owed.map(r => [r.id, SEED_REASON])),
        };
        writeFileSync(BASELINE, JSON.stringify(file, null, 2) + '\n', 'utf-8');
        console.log(`  seeded ${owed.length} routes → ${BASELINE}`);
        return true;
    }

    const base = JSON.parse(readFileSync(BASELINE, 'utf-8')) as Baseline;
    const fresh = owed.filter(r => base.unvalidated[r.id] === undefined);
    const stale = Object.keys(base.unvalidated).filter(k => !owed.some(r => r.id === k));

    console.log('');
    console.log('  Writing REST routes and how they check their body');
    console.log('  ' + '─'.repeat(62));
    console.log(`  routes            ${String(routes.length).padStart(4)}   POST, PUT, PATCH under src/routes/`);
    console.log(`  schema            ${String(count('schema')).padStart(4)}`);
    console.log(`  no body           ${String(count('no body')).padStart(4)}`);
    console.log(`  by hand           ${String(count('by hand')).padStart(4)}`);
    console.log(`  elsewhere         ${String(count('elsewhere')).padStart(4)}   the handler is not inline, or hands req on`);
    console.log(`  listed            ${String(Object.keys(base.unvalidated).length).padStart(4)}   security/write-validation-baseline.json`);
    console.log(`  NEW, not listed   ${String(fresh.length).padStart(4)}`);
    console.log('');
    if (process.argv.includes('--list')) for (const r of routes) console.log(`    ${r.cls.padEnd(10)} ${r.id}  ${r.file}:${r.line}`);

    if (fresh.length > 0) {
        for (const r of fresh) console.log(`    ${r.cls.padEnd(10)} ${r.id}\n               ${r.file}:${r.line}`);
        console.error('');
        console.error('✖ A new writing route reads its body without a schema. Check it with');
        console.error('  validateBody(Schema, config.nodeId) (models/schemas.ts), its strings bounded from');
        console.error('  models/input-limits.ts: the limits hold and a form gets each field\'s error back.');
        return false;
    }
    if (stale.length > 0) {
        console.error(stale.length === 1
            ? '✖ 1 listed route now checks its body, needs none, or is gone. Delete its entry to lock the gain in:'
            : `✖ ${stale.length} listed routes now check their bodies, need none, or are gone. Delete their entries to lock the gain in:`);
        for (const k of stale) console.error(`    ${k}`);
        return false;
    }
    console.log(`  ✓ no writing route reads its body without a schema, beyond the ${owed.length} listed`);
    return true;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && !main()) process.exit(1);
