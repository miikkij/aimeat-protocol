/**
 * @file scripts/check-unit-ports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A unit test never listens on, connects to or names as "nothing listens here" a fixed
 *   port. It listens on port 0 and reads `server.address().port`; a port nobody listens on is one the
 *   system handed out and the test closed again.
 *
 *   WHY THIS IS A GATE. Vitest runs about 900 unit files in parallel. On the GitHub runner every
 *   `listen(0)` in every one of them takes a port from Linux's ephemeral range (32768-60999), and so
 *   does every outgoing connection, so a fixed port in that range belongs to whichever file asks first.
 *   In the week from 2026-10-12 main's CI went red three times for this one reason (runs 39066814119,
 *   39097196231, 39104128734): mcp-node-registry.test.ts listened on 40686, another file's socket
 *   held it, listen failed with EADDRINUSE and the hook timed out after 10 s. On Windows the range is
 *   49152-65535 and the files pass, so the first person to see it is CI. 1b53ec165 and 4deb4c3a5
 *   moved the six files known then to port 0; mcp-client-invoke's "a port nothing listens on" was
 *   another file's live server in the same run. Nothing stopped the next file until this.
 *
 *   WHAT IS A FINDING, in test/unit/ and in src/**\/__tests__/ (the unit project's include):
 *   - `listen-fixed`: a `.listen(...)` call whose port is not 0: a number other than 0, a constant
 *     initialised to one, an object with such a `port`, or any other expression (an environment
 *     variable, a sum), because only 0 is known to be free.
 *   - `connect-fixed`: `net.connect`, `net.createConnection` or `.connect({ port })` with a fixed
 *     port number other than 0.
 *   - `dead-port`: a loopback URL with a port from 1024 up, in a test whose title or nearby lines
 *     say nothing answers there (unreachable, dead, nothing listens, ECONNREFUSED). A URL
 *     that only fills a config field (`baseUrl: 'http://localhost:40050'`) connects nowhere and is
 *     not read; that is why the words decide, and why ALLOWED exists for the rare false reading.
 *   Comments and string fixtures are not code, so a fixture that writes `listen(40686)` inside a
 *   string is not a finding.
 * @structure unitPortFindings(file, source) · compareWithAllowed(findings, allowed) · ALLOWED · main()
 * @usage cd aimeat && pnpm check:unit-ports
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (wish-a-gate-refuses-a-fixed-listen-port-in-a-unit-test). Seeded
 *     empty; the one dead port it found, mcp-servers-route.test.ts's 40690, was moved to a closed one.
 */
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Shape = 'listen-fixed' | 'connect-fixed' | 'dead-port';

export interface Finding { file: string; line: number; shape: Shape; text: string }

/**
 * `file:shape:port` → why this fixed port is safe. Empty on purpose: no unit file needs one. An
 * entry needs a reason a reader can check, such as a port below 1024 that nothing on a CI runner
 * binds.
 */
export const ALLOWED: Record<string, string> = {};

const LOOPBACK_URL = /\b(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?:\.[a-z0-9.-]*)?:(\d{2,5})\b/gi;
/**
 * Words that say nothing answers at an address. Not "refused" or "refuses": in this codebase those
 * mean a policy said no (a remote address, a copy the browser blocked), and every such test names
 * an address it never connects to.
 */
const SAYS_NOTHING_ANSWERS = /\b(unreachable|dead|nothing (?:is )?listen(?:s|ing)?(?: on| at)?|nobody listens|connection refused|ECONNREFUSED|does not answer|will not answer|closed port)\b/i;

/** The literal value of a numeric or numeric-string expression, or null. */
function literalNumber(node: ts.Expression): number | null {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isStringLiteral(node) && /^\d+$/.test(node.text)) return Number(node.text);
    if (ts.isParenthesizedExpression(node)) return literalNumber(node.expression);
    return null;
}

/** `name → initialiser` for every variable declared in the file with one. */
function initialisers(sf: ts.SourceFile): Map<string, ts.Expression> {
    const out = new Map<string, ts.Expression>();
    const visit = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) out.set(n.name.text, n.initializer);
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

/** The port a listen-like argument names: 0 when provably 0, a number when fixed, NaN when unknown. */
function portOf(arg: ts.Expression, vars: Map<string, ts.Expression>): number {
    const lit = literalNumber(arg);
    if (lit !== null) return lit;
    if (ts.isIdentifier(arg)) {
        const init = vars.get(arg.text);
        const v = init ? literalNumber(init) : null;
        return v === null ? Number.NaN : v;
    }
    return Number.NaN;
}

/** The `port` property of an object literal argument, or undefined when it has none. */
function portProperty(obj: ts.ObjectLiteralExpression): ts.Expression | undefined {
    for (const p of obj.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText() === 'port') return p.initializer;
        if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'port') return p.name;
    }
    return undefined;
}

/** The title of the it()/test() call around a node, or ''. */
function enclosingTestTitle(node: ts.Node): string {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if (ts.isCallExpression(n)) {
            const callee = n.expression;
            const name = ts.isIdentifier(callee) ? callee.text
                : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : '';
            const first = n.arguments[0];
            if ((name === 'it' || name === 'test') && first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) return first.text;
        }
    }
    return '';
}

/** Every fixed-port use in one unit test file. Pure: a source string in, a list out. */
export function unitPortFindings(file: string, source: string): Finding[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const vars = initialisers(sf);
    const lines = source.split(/\r?\n/);
    const out: Finding[] = [];
    const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const add = (n: ts.Node, shape: Shape): void => { out.push({ file, line: lineOf(n), shape, text: n.getText(sf).slice(0, 120) }); };

    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
            const method = n.expression.name.text;
            const target = n.expression.expression;
            const first = n.arguments[0];
            if (method === 'listen' && first && !ts.isArrowFunction(first) && !ts.isFunctionExpression(first)) {
                const port = ts.isObjectLiteralExpression(first)
                    ? (portProperty(first) === undefined ? 0 : portOf(portProperty(first)!, vars))
                    : portOf(first, vars);
                if (port !== 0) add(n, 'listen-fixed');
            }
            const onNet = ts.isIdentifier(target) && target.text === 'net';
            if (first && ((onNet && (method === 'connect' || method === 'createConnection')) || method === 'connect')) {
                const portExpr = ts.isObjectLiteralExpression(first) ? portProperty(first) : onNet ? first : undefined;
                const port = portExpr ? literalNumber(portExpr) : null;
                if (port !== null && port !== 0) add(n, 'connect-fixed');
            }
        }
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
            for (const m of n.text.matchAll(LOOPBACK_URL)) {
                if (Number(m[1]) < 1024) continue;
                const line = lineOf(n);
                const nearby = lines.slice(Math.max(0, line - 4), line + 1).join('\n');
                if (SAYS_NOTHING_ANSWERS.test(enclosingTestTitle(n)) || SAYS_NOTHING_ANSWERS.test(nearby)) {
                    out.push({ file, line, shape: 'dead-port', text: m[0] });
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

/** The port a finding names, for its ALLOWED key; '' when it names none. */
function portIn(f: Finding): string {
    return /:(\d{2,5})\b/.exec(f.text)?.[1] ?? /\((\d{2,5})\b/.exec(f.text)?.[1] ?? '';
}

export function allowedKey(f: Finding): string { return `${f.file}:${f.shape}:${portIn(f)}`; }

/** Findings ALLOWED does not cover, and ALLOWED entries no finding uses any more. */
export function compareWithAllowed(findings: Finding[], allowed: Record<string, string>): { fresh: Finding[]; stale: string[] } {
    const used = new Set(findings.map(allowedKey));
    return {
        fresh: findings.filter(f => !(allowedKey(f) in allowed)),
        stale: Object.keys(allowed).filter(k => !used.has(k)),
    };
}

/** This gate's own test: its fixtures are the old texts this gate refuses, written out on purpose. */
const OWN_TEST = 'test/unit/check-unit-ports.test.ts';

/** Every file the unit project runs: test/unit/**\/*.test.ts and src/**\/__tests__/**\/*.test.ts. */
function unitFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string, inTests: boolean): void => {
        let names: string[];
        try { names = readdirSync(dir); } catch { return; }
        for (const name of names) {
            if (name === 'node_modules') continue;
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full, inTests || name === '__tests__');
            else if (inTests && name.endsWith('.test.ts')) out.push(path.relative(root, full).replace(/\\/g, '/'));
        }
    };
    walk(path.join(root, 'test', 'unit'), true);
    walk(path.join(root, 'src'), false);
    return out.filter(f => f !== OWN_TEST).sort();
}

function main(): void {
    const root = process.cwd();
    const files = unitFiles(root);
    const findings = files.flatMap(f => unitPortFindings(f, readFileSync(path.join(root, f), 'utf-8')));
    const { fresh, stale } = compareWithAllowed(findings, ALLOWED);
    if (!fresh.length && !stale.length) {
        console.log(`\n  ✓ no unit test uses a fixed port (${files.length} files read, ${Object.keys(ALLOWED).length} allowed)\n`);
        return;
    }
    if (fresh.length) {
        console.error('\n  Unit tests that use a fixed port\n');
        for (const f of fresh) console.error(`    ${f.file}:${f.line}  ${f.shape}  ${f.text}`);
        console.error(`\n  ✖ ${fresh.length} fixed port(s). About 900 unit files run in parallel on CI, and a fixed`);
        console.error('    port there belongs to whichever file asks first (EADDRINUSE, or a 10 s hook timeout).');
        console.error('    Listen on port 0 and read server.address().port. For a port nothing listens on,');
        console.error('    listen on 0, read the port, close the server and use that port.\n');
    }
    if (stale.length) {
        console.error('  ALLOWED names a fixed port no file uses any more; delete the entry:');
        for (const k of stale) console.error(`    ${k}`);
    }
    process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
