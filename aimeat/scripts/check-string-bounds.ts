/**
 * @file scripts/check-string-bounds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every Zod string in the server source has a length limit, so no request field is
 *   unbounded by accident.
 *
 *   WHY. On 2026-10-27 about 370 `z.string()` calls under src/ had no `.max()`, so a title, a name or
 *   a note could be as long as the request body allowed (5 MB, 15 MB on the file routes), and the
 *   browser had no number to give its field (wish
 *   wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli). They were all given one from
 *   models/input-limits.ts the same day, so the allowance is zero and there is no baseline.
 *
 *   WHAT COUNTS AS BOUNDED. A `z.string()` whose method chain holds `.max(`, `.length(`, or a format
 *   whose text has a fixed shape (`.uuid()`, `.datetime()`, `.date()`, `.time()`, `.ipv4()`,
 *   `.ipv6()`, `.ulid()`, `.cuid()`, `.cuid2()`, `.nanoid()`, `.base64url()` is NOT one). The helpers
 *   in models/input-limits.ts (`safeText`, `requiredText`, `boundedText`) are bounded by
 *   construction; `documentText()` is bounded by the request body limit and is how a whole document
 *   says so. A record's KEY schema (the first argument of `z.record`) is not read: its length is the
 *   body's, and a limit on a map key is not what a person sees in a form.
 *
 *   An exception is a line in security/string-bounds-exemptions.json with the reason it needs none.
 * @structure scan(file, source) · main()
 * @usage cd aimeat && pnpm check:string-bounds         # the gate
 *        cd aimeat && pnpm check:string-bounds --list  # every hit, file:line
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial, at zero (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AIMEAT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXEMPTIONS = path.join(AIMEAT, 'security', 'string-bounds-exemptions.json');

const BOUNDING = new Set(['max', 'length', 'uuid', 'guid', 'datetime', 'date', 'time', 'ipv4', 'ipv6', 'ulid', 'cuid', 'cuid2', 'nanoid']);
// Tests, served browser code, seeded data and generated files are not request handling. The tool
// catalog's OUTPUT schemas describe what the node answers, not what it takes, and the MCP SDK checks a
// tool's answer against them, so a limit there would fail the node's own reply.
const SKIP = /[/\\](static|data|generated)[/\\]|\.test\.ts$|[/\\]__tests__[/\\]|\.d\.ts$|[/\\]tool-catalog[/\\]output-schemas\.ts$/;

export interface Hit { file: string; line: number; text: string }

function tsFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) tsFiles(full, out);
        else if (full.endsWith('.ts') && !SKIP.test(full)) out.push(full);
    }
    return out;
}

/** `z.string()` or `z.coerce.string()`. */
function isZString(node: ts.Node): node is ts.CallExpression {
    if (!ts.isCallExpression(node) || node.arguments.length > 1) return false;
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'string') return false;
    const target = callee.expression;
    if (ts.isIdentifier(target)) return target.text === 'z';
    return ts.isPropertyAccessExpression(target) && target.name.text === 'coerce' && ts.isIdentifier(target.expression) && target.expression.text === 'z';
}

/** The method names chained after `call`: `z.string().trim().max(5).optional()` → trim, max, optional. */
function chainAfter(call: ts.CallExpression): string[] {
    const names: string[] = [];
    let cur: ts.Node = call;
    while (ts.isPropertyAccessExpression(cur.parent) && cur.parent.expression === cur && ts.isCallExpression(cur.parent.parent)) {
        names.push(cur.parent.name.text);
        cur = cur.parent.parent;
    }
    return names;
}

/** The first argument of `z.record(...)`: a map key's schema. */
function isRecordKey(call: ts.CallExpression): boolean {
    const p = call.parent;
    return ts.isCallExpression(p) && p.arguments[0] === call && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === 'record';
}

export function scan(file: string, source: ts.SourceFile): Hit[] {
    const hits: Hit[] = [];
    const visit = (node: ts.Node): void => {
        if (isZString(node) && !isRecordKey(node) && !chainAfter(node).some(n => BOUNDING.has(n))) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            hits.push({ file, line: line + 1, text: source.text.split('\n')[line].trim().slice(0, 140) });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return hits;
}

export function main(): boolean {
    const list = process.argv.includes('--list');
    const exempt = JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as { note: string; exempt: Record<string, string> };
    const hits: Hit[] = [];
    for (const full of tsFiles(path.join(AIMEAT, 'src'))) {
        const text = readFileSync(full, 'utf-8');
        if (!text.includes('string(')) continue;
        const rel = path.relative(AIMEAT, full).split(path.sep).join('/');
        hits.push(...scan(rel, ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)));
    }
    // An exemption names the file and the line's text, so it survives lines moving above it.
    const key = (h: Hit): string => `${h.file} :: ${h.text}`;
    const fresh = hits.filter(h => exempt.exempt[key(h)] === undefined);
    const stale = Object.keys(exempt.exempt).filter(k => !hits.some(h => key(h) === k));

    console.log('');
    console.log('  Zod strings without a length limit');
    console.log('  ' + '─'.repeat(62));
    console.log(`  unbounded         ${String(hits.length).padStart(4)}   under src/`);
    console.log(`  listed            ${String(Object.keys(exempt.exempt).length).padStart(4)}   security/string-bounds-exemptions.json`);
    console.log(`  NEW, not listed   ${String(fresh.length).padStart(4)}`);
    console.log('');
    if (list || fresh.length > 0) for (const h of (list ? hits : fresh)) console.log(`    ${h.file}:${h.line}  ${h.text}`);

    if (fresh.length > 0) {
        console.error('');
        console.error('✖ A z.string() with no length limit takes whatever the request body allows. Give it');
        console.error('  one from models/input-limits.ts: .max(INPUT_LIMITS.<class>), or safeText(max) /');
        console.error('  requiredText(max) for text a person reads, or documentText() for a whole document.');
        return false;
    }
    if (stale.length > 0) {
        console.error(`✖ ${stale.length} listed exemption${stale.length === 1 ? ' is' : 's are'} gone. Delete to keep the list true:`);
        for (const k of stale) console.error(`    ${k}`);
        return false;
    }
    console.log('  ✓ every Zod string under src/ has a length limit');
    return true;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly && !main()) process.exit(1);
