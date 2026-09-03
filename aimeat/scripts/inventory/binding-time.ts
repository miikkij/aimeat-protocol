/**
 * @file scripts/inventory/binding-time.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question D of wish-invarianttiauditointi: two defects whose whole cause is WHEN a
 *   name is bound rather than what it holds.
 *
 *   Both were found by hand on 2026-09-03 and neither is a wrong check — they are the shape the
 *   wish is about, an invariant kept by everyone remembering the same thing:
 *
 *   D1, THE CLOSURE OVER A LATER CONST. A function that names a `const` declared further down the
 *   same scope works right up until it is CALLED before that line runs. The enrolment case was a
 *   const declared inside a branch that another path leaves by `return`, so every invoke threw and
 *   the migration had never worked for anybody. The code reads fine: the name is in scope, the
 *   editor resolves it, and nothing about the line says "this runs first".
 *
 *   D2, THE HANDLER THAT GAINED A PARAMETER. `onClick=${migrate}` passes the function itself, so
 *   the click event arrives as its first argument. Harmless while `migrate()` takes none — and
 *   wrong from the day somebody adds one, in a diff that touches a different file. Nobody
 *   revisits every call site of a function when they give it a parameter; that is the point.
 *
 *   WHAT THIS REPORTS. Candidates. D1 in particular cannot be settled statically: whether the
 *   closure runs before the declaration depends on who calls it, and a tool that guessed would be
 *   wrong in both directions the way the 2026-08-16 handler-source detector was. So it lists the
 *   shape and leaves the judgement, and it says which ones sit in a branch — the enrolment case's
 *   own tell.
 * @structure tdzClosures(files) · handlerArity(files)
 * @usage const { tdz, handlers } = bindingTime(sourceFiles, root);
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question D).
 */
import ts from 'typescript';
import { relative } from 'node:path';

export interface TdzCandidate {
    file: string;
    line: number;
    /** The name the closure reads. */
    name: string;
    /** Where that name is declared, always later in the same scope. */
    declaredLine: number;
    /** The closure sits inside an if/try/switch, so another path can leave before the declaration. */
    inBranch: boolean;
}

export interface HandlerCandidate {
    file: string;
    line: number;
    /** The prop, e.g. `onClick`. */
    prop: string;
    /** The function passed by name. */
    fn: string;
    /** How many parameters that function declares. */
    arity: number;
    /** The first parameter's name — what decides whether this is a defect or ordinary code. */
    firstParam: string;
}

/**
 * Parameter names that mean "the event", which is what this call actually passes.
 *
 * `onClick=${handleCollapse}` where `handleCollapse(event)` is not a defect: it is the normal way
 * to write a handler, and the event is exactly what it wants. Counting those made the first run
 * report 106 candidates, most of them correct code — noise that would have buried the one row worth
 * reading. The defect is the OTHER shape: a function whose first parameter is data, receiving a
 * click event instead.
 *
 * A heuristic, and named as one. It cannot tell `pick(value)` used correctly elsewhere from
 * `pick(value)` wired to a click; it narrows the list to the rows where that question is worth
 * asking, and a person answers it.
 */
const EVENT_NAMES = new Set(['e', 'ev', 'evt', 'event', '_e', '_event']);

const rel = (f: ts.SourceFile, root: string): string => relative(root, f.fileName).split('\\').join('/');

/** The function-ish scope a node sits in, which is where a `const` is hoisted-but-dead. */
function enclosingScope(node: ts.Node): ts.Node | undefined {
    for (let n = node.parent; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
            || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return n;
    }
    return undefined;
}

/**
 * Closures that read a `const`/`let` declared later in the same scope.
 *
 * The scope walked is the closure's OWN enclosing function, because that is where a temporal dead
 * zone can exist: a name from an outer scope is already bound by the time the inner function is
 * created, and a name in the same scope may not be.
 */
export function tdzClosures(files: readonly ts.SourceFile[], root: string): TdzCandidate[] {
    const out: TdzCandidate[] = [];

    for (const source of files) {
        const at = (n: ts.Node): number => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;

        const visit = (node: ts.Node): void => {
            if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
                const scope = enclosingScope(node);
                if (scope) {
                    // Every const/let in that scope, with the line it is bound on.
                    const declared = new Map<string, number>();
                    const collectDecls = (n: ts.Node): void => {
                        if (ts.isVariableStatement(n)
                            && (n.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0) {
                            for (const d of n.declarationList.declarations) {
                                if (ts.isIdentifier(d.name)) declared.set(d.name.text, at(d));
                            }
                        }
                        // Do not descend into nested functions: their consts are a different scope.
                        if (n !== scope && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
                            || ts.isArrowFunction(n) || ts.isMethodDeclaration(n))) return;
                        ts.forEachChild(n, collectDecls);
                    };
                    collectDecls(scope);

                    const closureLine = at(node);
                    const seen = new Set<string>();
                    const readIdentifiers = (n: ts.Node): void => {
                        if (ts.isIdentifier(n) && declared.has(n.text) && !seen.has(n.text)) {
                            const declaredLine = declared.get(n.text) as number;
                            const isOwnDeclaration = n.parent && ts.isVariableDeclaration(n.parent) && n.parent.name === n;
                            if (!isOwnDeclaration && declaredLine > closureLine) {
                                seen.add(n.text);
                                let inBranch = false;
                                for (let p = node.parent; p && p !== scope; p = p.parent) {
                                    if (ts.isIfStatement(p) || ts.isTryStatement(p) || ts.isSwitchStatement(p)) inBranch = true;
                                }
                                out.push({ file: rel(source, root), line: closureLine, name: n.text, declaredLine, inBranch });
                            }
                        }
                        ts.forEachChild(n, readIdentifiers);
                    };
                    readIdentifiers(node);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return out;
}

/**
 * `onClick=${handler}` in an HTM template where `handler` declares parameters.
 *
 * The frontend is HTM template literals, so the prop is text inside a template rather than JSX the
 * compiler parses. Read from the template's text on purpose: the question is syntactic — is the
 * function passed BY NAME rather than wrapped — and the arity comes from the declaration, which is
 * parsed properly.
 */
export function handlerArity(files: readonly ts.SourceFile[], root: string): HandlerCandidate[] {
    const out: HandlerCandidate[] = [];

    for (const source of files) {
        // Every function declared in this file, by name, with how many parameters it takes.
        const arity = new Map<string, { n: number; first: string }>();
        const collect = (n: ts.Node): void => {
            const nameOf = (ps: ts.NodeArray<ts.ParameterDeclaration>): string =>
                ps[0] && ts.isIdentifier(ps[0].name) ? ps[0].name.text : '';
            if (ts.isFunctionDeclaration(n) && n.name) arity.set(n.name.text, { n: n.parameters.length, first: nameOf(n.parameters) });
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
                && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
                arity.set(n.name.text, { n: n.initializer.parameters.length, first: nameOf(n.initializer.parameters) });
            }
            ts.forEachChild(n, collect);
        };
        collect(source);

        const text = source.getText();
        for (const m of text.matchAll(/\b(on[A-Z][A-Za-z]*)=\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
            const [, prop, fn] = m;
            const info = arity.get(fn);
            if (info !== undefined && info.n > 0 && !EVENT_NAMES.has(info.first)) {
                const line = source.getLineAndCharacterOfPosition(m.index ?? 0).line + 1;
                out.push({ file: rel(source, root), line, prop, fn, arity: info.n, firstParam: info.first });
            }
        }
    }
    return out;
}
