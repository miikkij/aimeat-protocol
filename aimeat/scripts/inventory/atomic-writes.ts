/**
 * @file scripts/inventory/atomic-writes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every code path that reads a stored record and later writes the same key back with an
 *   unconditional write, so a second request that read the same version in between has its change
 *   overwritten (a lost update), or both requests pass the same check.
 *
 *   WHAT IT LOOKS FOR, NARROWLY. Inside one unit of code (a named function or a route handler, as
 *   `enclosingUnit` names it), a READ of key K followed later in the source by a WRITE of key K:
 *
 *     read   storage.getMemory(owner, K)
 *     write  storage.setMemory({ key: K, … })  ·  storage.setMemory({ ...rec, … }) where rec came
 *            from the read  ·  writeMemoryRecord(deps, caller, { key: K, … }) with no expectedVersion
 *
 *   and the same through a WRAPPER: a function anywhere in src/ whose parameter is handed straight
 *   to one of the above as the key (`getRecord(storage, key)`, `putRecord(storage, key, …)`). The
 *   wrappers are found by the compiler's symbols, to a fixed point, so a wrapper of a wrapper counts.
 *   Two keys are the same when their expressions are the same text after whitespace, `!`, `as` and
 *   parentheses are removed, and read the same variables. The owner is not compared (see
 *   sameOwner). A record written back from the read (`...rec`) is matched by the variable's symbol.
 *
 *   NOT A PAIR: a read used only for the record's bookkeeping (`prev?.version`, `createdAt`), which
 *   is a blind write carrying the version on; a read and a write on two arms of one `if`; a read
 *   followed by a second, deciding read of the same record, where the pair is the second.
 *
 *   MEASURED ON 2026-10-18: 130 hits in 84 files on src/; every one read by hand, 8 false positives.
 *   Their shapes, all left in because each fix would hide a true race elsewhere: a read that takes
 *   only a counter or timestamp INSIDE the value (`value.version`, `value.created`, `createdBy`); a
 *   read that only decides a status code (`!!(await getMemory(…))`); a read handed to a helper that
 *   uses it only for the version; a read before a wrapper that reads the record again itself; two
 *   owners with one key variable (POST /v1/memory/copy). Each such entry says so in the baseline.
 *
 *   WHAT MAKES A PAIR SAFE. A conditional write of the same key in the same unit:
 *   `setMemoryIfVersion`, `createMemoryIfAbsent`, `writeMemoryRecord` with `expectedVersion`, or a
 *   call to a function that does one of those with the key as its parameter (`updateRecord` in
 *   services/record-cas.ts, `claimSessionForCompletion` in commerce/session-claim.ts). The unit
 *   is then using the version, and its unconditional write of that key is either the fallback for a
 *   backend without compare-and-swap or a write on a record it has already claimed.
 *
 *   WHAT IT DOES NOT COUNT AS SAFE: `storage.transaction()`. On PostgreSQL a transaction runs at READ
 *   COMMITTED and `getMemory` takes no row lock (providers/postgres-kysely/methods/memory.ts), so two
 *   transactions both read version N and both write N+1. A pair inside a transaction is reported and
 *   carries `inTransaction`, so a person triaging it sees that it is already wrapped.
 *
 *   WHAT IT CANNOT SEE, and the gate's header repeats it. A read and a write of one record through
 *   two different keys' expressions (`subKey(buyer)` here, `` `subscriptions.${buyer}` `` there); a
 *   read in one function and the write in its caller; a key computed inside a wrapper from a
 *   parameter (`subscriptionsOf(storage, buyer)` reads `subscriptions.${buyer}`); reads through other
 *   storage methods (`listMemory`, `getMemoryByKeys`) and writes through table methods (balances,
 *   ledger rows), which have their own atomic operations.
 * @structure
 *   - AtomicWriteHit: one unit, one key
 *   - atomicWriteHits(program, files, root): the hits, with the wrapper table built first
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-tarkistus-ei-atomiselle-kirjoitukselle-uudessa-koodissa).
 */
import ts from 'typescript';
import { relative } from 'node:path';
import { enclosingUnit } from './entries.js';

export interface AtomicWriteHit {
    file: string;
    /** `POST /v1/x` for a route handler, the function's name otherwise. */
    unit: string;
    /** The key as written at the read, normalised. */
    key: string;
    readLine: number;
    writeLine: number;
    /** The write call as written, trimmed, so a reader can judge without opening the file. */
    text: string;
    /** Both the read and the write run inside a `storage.transaction()` callback. */
    inTransaction: boolean;
}

type Kind = 'read' | 'write' | 'cas';

interface Site {
    kind: Kind;
    call: ts.CallExpression;
    /** The key expression, when the site names one. */
    key?: ts.Expression;
    /** The owner expression, when the site names one: `getMemory(owner, …)`, `{ ownerGaii: owner }`. */
    owner?: ts.Expression;
    /** For a write: the identifier whose record it spreads or writes back (`...rec`, `setMemory(rec)`). */
    from?: ts.Identifier;
}

/** `ownerIndex` is -1 when the owner is not one of the wrapper's parameters. */
interface Wrapper { kind: Kind; keyIndex: number; ownerIndex: number }

const READ = 'getMemory';
const WRITE = 'setMemory';
const CAS = new Set(['setMemoryIfVersion', 'createMemoryIfAbsent']);
const SERVICE_WRITE = 'writeMemoryRecord';

function unwrap(e: ts.Expression): ts.Expression {
    let n = e;
    while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
        || ts.isSatisfiesExpression(n) || ts.isAwaitExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
    return n;
}

/** The comparable text of a key expression. */
export function keyText(e: ts.Expression): string {
    const strip = (n: ts.Node): string => {
        if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
            || ts.isSatisfiesExpression(n)) return strip(n.expression);
        const kids: string[] = [];
        let last = n.getStart();
        const text = n.getText();
        const base = n.getStart();
        // Rebuild the text with each child stripped, so `a!.b as string` and `a.b` compare equal.
        n.forEachChild(c => {
            kids.push(text.slice(last - base, c.getStart() - base));
            kids.push(strip(c));
            last = c.getEnd();
        });
        if (kids.length === 0) return text;
        kids.push(text.slice(last - base));
        return kids.join('');
    };
    return strip(e).replace(/\s+/g, '');
}

/**
 * The variables a key expression reads, in order. Two keys with the same text are one key only
 * when these are the same variables: `for (const k of a) read(k)` and a later `for (const k of b)
 * write(k)` have the same text and two different `k`.
 */
function keyVariables(checker: ts.TypeChecker, e: ts.Expression): (ts.Symbol | undefined)[] {
    const out: (ts.Symbol | undefined)[] = [];
    const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
            out.push(n.parent && ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n
                ? checker.getShorthandAssignmentValueSymbol(n.parent)
                : checker.getSymbolAtLocation(n));
        }
        ts.forEachChild(n, visit);
    };
    visit(e);
    return out;
}

function sameKey(checker: ts.TypeChecker, a: ts.Expression, b: ts.Expression): boolean {
    if (keyText(a) !== keyText(b)) return false;
    const va = keyVariables(checker, a);
    const vb = keyVariables(checker, b);
    return va.length === vb.length && va.every((s, i) => s === vb[i]);
}

/**
 * Are the two nodes on different arms of one `if`, `?:` or `switch`, so that no run reaches both?
 * Then they are not a read followed by a write.
 */
function exclusiveArms(a: ts.Node, b: ts.Node): boolean {
    const chain = (n: ts.Node): ts.Node[] => { const c: ts.Node[] = []; for (let p: ts.Node | undefined = n; p; p = p.parent) c.push(p); return c; };
    const ca = chain(a);
    const cb = new Set(chain(b));
    const lca = ca.find(n => cb.has(n));
    if (!lca) return false;
    const armOf = (c: ts.Node[]): ts.Node | undefined => c[c.indexOf(lca) - 1];
    const x = armOf(ca);
    const y = armOf(chain(b));
    if (!x || !y || x === y) return false;
    if (ts.isIfStatement(lca)) return (x === lca.thenStatement && y === lca.elseStatement) || (y === lca.thenStatement && x === lca.elseStatement);
    if (ts.isConditionalExpression(lca)) return x !== lca.condition && y !== lca.condition;
    if (ts.isCaseBlock(lca)) return true;
    return false;
}

function propertyNamed(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
    return obj.properties.find(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))
        && ts.isIdentifier(p.name) && p.name.text === name);
}

/** The value of property `name` in an object literal, shorthand included. */
function propertyValue(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    const p = propertyNamed(obj, name);
    if (p && ts.isPropertyAssignment(p)) return p.initializer;
    if (p && ts.isShorthandPropertyAssignment(p)) return p.name;
    return undefined;
}

/** What key a record expression carries: its `key` property, or the record it was spread from. */
function recordKey(checker: ts.TypeChecker, expr: ts.Expression, depth = 0): { key?: ts.Expression; owner?: ts.Expression; from?: ts.Identifier } {
    const e = unwrap(expr);
    if (ts.isObjectLiteralExpression(e)) {
        const key = propertyValue(e, 'key');
        if (key) return { key, owner: propertyValue(e, 'ownerGaii') };
        const spread = e.properties.find(ts.isSpreadAssignment);
        if (spread) {
            const s = unwrap(spread.expression);
            if (ts.isIdentifier(s)) return { from: s };
        }
        return {};
    }
    if (ts.isIdentifier(e) && depth < 2) {
        // `const record = { key, … }; await storage.setMemory(record)` reads as the literal.
        const decl = checker.getSymbolAtLocation(e)?.valueDeclaration;
        if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.isObjectLiteralExpression(unwrap(decl.initializer))) {
            return recordKey(checker, decl.initializer, depth + 1);
        }
        return { from: e };
    }
    return {};
}

/** The function a call goes to, as the node the wrapper table is keyed by. */
function calleeDecl(checker: ts.TypeChecker, call: ts.CallExpression): ts.Node | undefined {
    const target = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
    let sym = checker.getSymbolAtLocation(target);
    if (sym && (sym.flags & ts.SymbolFlags.Alias)) sym = checker.getAliasedSymbol(sym);
    const d = sym?.valueDeclaration ?? sym?.declarations?.[0];
    if (!d) return undefined;
    if (ts.isVariableDeclaration(d) && d.initializer) {
        const i = unwrap(d.initializer);
        if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) return i;
    }
    return d;
}

function mentionsExpectedVersion(input: ts.ObjectLiteralExpression): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && ts.isIdentifier(n.name) && n.name.text === 'expectedVersion') found = true;
        else ts.forEachChild(n, visit);
    };
    visit(input);
    return found;
}

function siteOf(checker: ts.TypeChecker, call: ts.CallExpression, wrappers: Map<ts.Node, Wrapper>): Site | undefined {
    const args = call.arguments;
    const callee = call.expression;
    if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        if (name === READ && args.length >= 2) return { kind: 'read', call, key: args[1], owner: args[0] };
        if (name === WRITE && args.length === 1) return { kind: 'write', call, ...recordKey(checker, args[0]) };
        if (CAS.has(name) && args.length >= 1) return { kind: 'cas', call, ...recordKey(checker, args[0]) };
    }
    if (ts.isIdentifier(callee) && callee.text === SERVICE_WRITE && args.length >= 3) {
        const input = unwrap(args[2]);
        if (!ts.isObjectLiteralExpression(input)) return undefined;
        const key = propertyValue(input, 'key');
        if (!key) return undefined;
        // `...(typeof v === 'number' ? { expectedVersion: v } : {})` hands the caller's version on:
        // the service then refuses a write over a newer one, which is the condition asked for.
        return { kind: mentionsExpectedVersion(input) ? 'cas' : 'write', call, key };
    }
    const decl = calleeDecl(checker, call);
    const w = decl && wrappers.get(decl);
    if (w && args[w.keyIndex]) return { kind: w.kind, call, key: args[w.keyIndex], owner: w.ownerIndex >= 0 ? args[w.ownerIndex] : undefined };
    return undefined;
}

type FnLike = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;
const isFnLike = (n: ts.Node): n is FnLike => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
    || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

function nearestFn(n: ts.Node): FnLike | undefined {
    for (let p = n.parent; p; p = p.parent) if (isFnLike(p)) return p;
    return undefined;
}

/** Inside the function argument of a `.transaction(…)` call. */
function inTransaction(n: ts.Node): boolean {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (isFnLike(p) && p.parent && ts.isCallExpression(p.parent) && ts.isPropertyAccessExpression(p.parent.expression)
            && p.parent.expression.name.text === 'transaction' && p.parent.arguments.includes(p as ts.Expression)) return true;
    }
    return false;
}

/** The index of the parameter of `fn` this expression names, or -1. */
function paramIndex(checker: ts.TypeChecker, fn: FnLike, e: ts.Expression | undefined): number {
    if (!e) return -1;
    const u = unwrap(e);
    if (!ts.isIdentifier(u)) return -1;
    // `{ key }` names the property at the identifier; the variable it reads is asked for separately.
    const sym = u.parent && ts.isShorthandPropertyAssignment(u.parent) && u.parent.name === u
        ? checker.getShorthandAssignmentValueSymbol(u.parent)
        : checker.getSymbolAtLocation(u);
    const d = sym?.valueDeclaration;
    if (!d || !ts.isParameter(d) || d.parent !== fn) return -1;
    return fn.parameters.indexOf(d);
}

/**
 * The wrapper table: a function whose parameter reaches a read, a write or a conditional write as
 * its key. Built to a fixed point so a wrapper of a wrapper counts. A function that conditionally
 * writes the key is a `cas` wrapper whatever else it does; one that reads and writes it without
 * a condition is a `write` (it is reported itself, and a caller's read before it is a second race).
 */
function buildWrappers(checker: ts.TypeChecker, calls: ts.CallExpression[]): Map<ts.Node, Wrapper> {
    const wrappers = new Map<ts.Node, Wrapper>();
    for (let round = 0; round < 6; round++) {
        let changed = false;
        const seen = new Map<FnLike, Map<number, { kinds: Set<Kind>; ownerIndex: number }>>();
        for (const call of calls) {
            const fn = nearestFn(call);
            if (!fn || fn.parameters.length === 0) continue;
            const site = siteOf(checker, call, wrappers);
            if (!site) continue;
            const i = paramIndex(checker, fn, site.key);
            if (i < 0) continue;
            const byParam = seen.get(fn) ?? new Map<number, { kinds: Set<Kind>; ownerIndex: number }>();
            const entry = byParam.get(i) ?? { kinds: new Set<Kind>(), ownerIndex: -1 };
            entry.kinds.add(site.kind);
            if (entry.ownerIndex < 0) entry.ownerIndex = paramIndex(checker, fn, site.owner);
            byParam.set(i, entry);
            seen.set(fn, byParam);
        }
        for (const [fn, byParam] of seen) {
            for (const [i, { kinds, ownerIndex }] of byParam) {
                const kind: Kind = kinds.has('cas') ? 'cas' : kinds.has('write') ? 'write' : 'read';
                const prev = wrappers.get(fn);
                if (!prev || prev.kind !== kind || prev.keyIndex !== i || prev.ownerIndex !== ownerIndex) {
                    // One key parameter per wrapper; a conditional write outranks a write outranks a read.
                    if (prev && rank(prev.kind) > rank(kind)) continue;
                    wrappers.set(fn, { kind, keyIndex: i, ownerIndex });
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }
    return wrappers;
}

const rank = (k: Kind): number => (k === 'cas' ? 2 : k === 'write' ? 1 : 0);

/**
 * The expression a read's result is bound from: up through `await`, parentheses, casts and a
 * `.catch(…)` that turns a failed read into null.
 */
function boundExpression(call: ts.CallExpression): ts.Node {
    let n: ts.Node = call;
    for (;;) {
        const p = n.parent;
        if (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p))) { n = p; continue; }
        if (p && ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text === 'catch'
            && p.parent && ts.isCallExpression(p.parent) && p.parent.expression === p) { n = p.parent; continue; }
        return n;
    }
}

/** The variables a read's result is bound to: `const rec = await …`, `const { value, prev } = …`. */
function boundSymbols(checker: ts.TypeChecker, call: ts.CallExpression): ts.Symbol[] {
    const p = boundExpression(call).parent;
    if (!p || !ts.isVariableDeclaration(p)) return [];
    const names = ts.isIdentifier(p.name) ? [p.name]
        : ts.isObjectBindingPattern(p.name) ? p.name.elements.flatMap(e => (ts.isIdentifier(e.name) ? [e.name] : []))
            : [];
    return names.flatMap(n => { const s = checker.getSymbolAtLocation(n); return s ? [s] : []; });
}

/**
 * Do two sites name the same owner? Measured on 2026-10-18 and NOT used to drop a pair: comparing
 * the owner expressions removed one false positive (POST /v1/memory/copy reads `source_gaii` and
 * writes `callerGaii`) and one true race on a money route (readGuestCheckout reads `seller` and
 * writes `session.sellerGhii`, the same value). Two texts can name one owner, so a difference proves
 * nothing; it only orders which read a write pairs with.
 */
function sameOwner(checker: ts.TypeChecker, a: Site, b: Site): boolean {
    return !a.owner || !b.owner || sameKey(checker, a.owner, b.owner);
}

/** The stored record's bookkeeping, which a write copies over without deciding anything on it. */
const METADATA = new Set(['version', 'createdAt', 'visibility', 'tags', 'ttlHours', 'ownerGaii', 'key', 'updatedAt', 'expiresAt']);

function insideMetadataProperty(n: ts.Node): boolean {
    for (let p = n.parent; p && !ts.isStatement(p); p = p.parent) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && METADATA.has(p.name.text)) return true;
    }
    return false;
}

/**
 * Is every use of the read's result in `unit` a read of the record's bookkeeping (`prev?.version`,
 * `rec.createdAt`)? Then the read decides nothing: it is a blind write that carries the version
 * number on, the shape of every module's own `putRecord`. Its CALLER's read is the race, and that
 * is reported where it is. One use of the value, a spread, or a truthiness test is a decision.
 */
function readsOnlyMetadata(checker: ts.TypeChecker, unit: ts.Node, call: ts.CallExpression): boolean {
    const decl = boundExpression(call).parent;
    if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return false;
    const sym = checker.getSymbolAtLocation(decl.name);
    if (!sym) return false;
    let uses = 0;
    let metadataOnly = true;
    const visit = (x: ts.Node): void => {
        if (!metadataOnly) return;
        if (ts.isIdentifier(x) && x !== decl.name && checker.getSymbolAtLocation(x) === sym) {
            uses += 1;
            const p = x.parent;
            const access = p && (ts.isPropertyAccessExpression(p) && p.expression === x) ? p : undefined;
            // `version: existing ? existing.version + 1 : 1` tests the record only to fill in its
            // bookkeeping, so a use inside a bookkeeping property counts as bookkeeping.
            if (!(access && METADATA.has(access.name.text)) && !insideMetadataProperty(x)) metadataOnly = false;
        }
        ts.forEachChild(x, visit);
    };
    visit(unit);
    return metadataOnly && uses > 0;
}

function lineOf(source: ts.SourceFile, n: ts.Node): number {
    return source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
}

export function atomicWriteHits(program: ts.Program, files: ts.SourceFile[], root: string): AtomicWriteHit[] {
    const checker = program.getTypeChecker();
    const calls: ts.CallExpression[] = [];
    const callsOf = new Map<ts.SourceFile, ts.CallExpression[]>();
    for (const source of files) {
        const mine: ts.CallExpression[] = [];
        const visit = (n: ts.Node): void => {
            if (ts.isCallExpression(n)) mine.push(n);
            ts.forEachChild(n, visit);
        };
        visit(source);
        callsOf.set(source, mine);
        calls.push(...mine);
    }
    const wrappers = buildWrappers(checker, calls);

    const hits: AtomicWriteHit[] = [];
    for (const source of files) {
        const rel = relative(root, source.fileName).split('\\').join('/');
        const units = new Map<ts.Node, { unit: string; sites: Site[] }>();
        for (const call of callsOf.get(source) ?? []) {
            const site = siteOf(checker, call, wrappers);
            if (!site) continue;
            const found = enclosingUnit(call);
            if (!found) continue;
            const u = units.get(found.body) ?? { unit: found.unit, sites: [] };
            u.sites.push(site);
            units.set(found.body, u);
        }
        for (const [body, { unit, sites }] of units) {
            const guards = sites.filter(s => s.kind === 'cas' && s.key);
            const reported = new Set<string>();
            const reads = sites.filter(s => s.kind === 'read' && s.key);
            const sameRecord = (a: Site, b: Site): boolean => sameKey(checker, a.key!, b.key!) && sameOwner(checker, a, b);
            for (const r of reads) {
                const k = keyText(r.key!);
                if (reported.has(k) || guards.some(g => sameKey(checker, g.key!, r.key!))) continue;
                if (readsOnlyMetadata(checker, body, r.call)) continue;
                const bound = boundSymbols(checker, r.call);
                const w = sites.find(s => s.kind === 'write' && s.call.getStart() > r.call.getEnd()
                    && !exclusiveArms(r.call, s.call)
                    && ((s.key && sameKey(checker, s.key, r.key!))
                        || (s.from !== undefined && bound.includes(checker.getSymbolAtLocation(s.from)!))));
                if (!w) continue;
                // A second read of the record before the write, one that decides something itself, is
                // the one the write is paired with: the first was then an existence check, and the
                // pair is reported from the second. A second read that only fetches the version for
                // the write (publishSkill) leaves the pair with the first.
                if (reads.some(r2 => r2 !== r && r2.call.getStart() > r.call.getEnd() && r2.call.getEnd() < w.call.getStart()
                    && sameRecord(r, r2) && !readsOnlyMetadata(checker, body, r2.call))) continue;
                reported.add(k);
                const line = lineOf(source, w.call);
                hits.push({
                    file: rel, unit, key: k, readLine: lineOf(source, r.call), writeLine: line,
                    text: source.text.split('\n')[line - 1].trim().slice(0, 140),
                    inTransaction: inTransaction(r.call) && inTransaction(w.call),
                });
            }
        }
    }
    return hits.sort((a, b) => a.file.localeCompare(b.file) || a.readLine - b.readLine);
}
