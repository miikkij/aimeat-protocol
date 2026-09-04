/**
 * @file scripts/inventory/call-graph.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which function calls which, resolved through the imports rather than guessed from
 *   names.
 *
 *   WHY IT IS BUILT AND NOT BOUGHT. The two published TypeScript call-graph builders (Jelly,
 *   js-callgraph) are research tools that approximate, and their own papers say where they break:
 *   closures and dynamic dispatch fracture reachability. This repo does not need a general answer. It
 *   needs one about a codebase whose doors are registered in fixed shapes and whose services are
 *   plain exported functions imported by name — and for THAT the compiler's own symbol resolution is
 *   exact. `checker.getSymbolAtLocation` on the callee, then through the import alias to the
 *   declaration, is not a heuristic.
 *
 *   WHAT IT CANNOT SEE, and this is the part that must be read before anything is concluded from it:
 *   a call through a variable (`const fn = cond ? a : b; fn()`), a callback passed as an argument and
 *   invoked elsewhere, a method dispatched on a runtime-chosen object, and anything reached through
 *   `await import(...)`. Every unresolved call is COUNTED, and the report prints the count, because a
 *   graph that hides its own blind spots is worse than none: it turns "I could not see it" into "it
 *   is not there". Reachability computed here is a LOWER BOUND — what it finds is real, what it
 *   misses is unknown.
 *
 *   The `storage.*` leaves are the point of the whole thing. They resolve to the declarations on the
 *   Storage interface, so "which doors can reach this table" becomes a question with an answer.
 * @structure
 *   - FnNode: one function, keyed `file#name`
 *   - buildCallGraph(): nodes, edges, and the unresolved count
 *   - reachable(): forward closure from a set of roots
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. Phase 1 of the wish measured that its last question (what a
 *     publish exposes) could not be answered from mentions and needed this.
 */
import ts from 'typescript';
import { relative } from 'node:path';

/** `src/services/apps.ts#publishApp`. The file is part of the key because names repeat. */
export type FnId = string;

export interface FnNode {
    id: FnId;
    file: string;
    name: string;
    line: number;
    /** A method declared on an interface rather than a function with a body — a leaf we can name. */
    isInterfaceMethod: boolean;
}

export interface CallGraph {
    nodes: Map<FnId, FnNode>;
    /** caller → callees. */
    edges: Map<FnId, Set<FnId>>;
    /** Calls whose target could not be resolved to a declaration in src/. */
    unresolved: number;
    /** Calls resolved to something outside src/ (node built-ins, npm). Not a blind spot. */
    external: number;
    /**
     * What the unresolved calls LOOK like, counted by callee text. One number for the blind spot
     * says how much is missing; this says what kind, which is the difference between "the graph is
     * 37% guesswork" and "the graph cannot follow `this.x()` inside a provider, and there are 4000
     * of those".
     */
    unresolvedBy: Map<string, number>;
}

const rel = (f: ts.SourceFile, root: string): string => relative(root, f.fileName).split('\\').join('/');

/** The name a function-like declaration is known by, or undefined when it has none worth keying on. */
function declName(node: ts.Node): string | undefined {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node))
        && node.name && ts.isIdentifier(node.name)) return node.name.text;
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
        && node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        return node.parent.name.text;
    }
    // `{ async setMemory(record) {…} }` in a provider's method object.
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
        && node.parent && ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) {
        return node.parent.name.text;
    }
    return undefined;
}

const isFunctionLike = (n: ts.Node): boolean =>
    ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isMethodSignature(n)
    || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

/**
 * The declaration a callee refers to, followed through import aliases.
 *
 * `getAliasedSymbol` is what turns `import { publishApp } from '../services/apps.js'` into the
 * declaration in that file. Without it every cross-module call resolves to the import statement and
 * the graph has no edges between files at all.
 */
function resolveCallee(checker: ts.TypeChecker, callee: ts.Expression): ts.Declaration | undefined {
    let symbol = checker.getSymbolAtLocation(
        ts.isPropertyAccessExpression(callee) ? callee.name : callee,
    );
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) {
        try { symbol = checker.getAliasedSymbol(symbol); } catch { /* not an alias after all */ }
    }
    const declarations = symbol.getDeclarations() ?? [];
    return declarations.find(d => isFunctionLike(d) || ts.isVariableDeclaration(d));
}

/** The function-like node a declaration stands for: a variable declaration wraps its initializer. */
function functionOf(decl: ts.Declaration): ts.Node | undefined {
    if (isFunctionLike(decl)) return decl;
    if (ts.isVariableDeclaration(decl) && decl.initializer && isFunctionLike(decl.initializer)) return decl.initializer;
    return undefined;
}

export function buildCallGraph(program: ts.Program, files: ts.SourceFile[], root: string): CallGraph {
    const checker = program.getTypeChecker();
    const nodes = new Map<FnId, FnNode>();
    const edges = new Map<FnId, Set<FnId>>();
    const inScope = new Set(files.map(f => f.fileName));
    let unresolved = 0;
    let external = 0;
    const unresolvedBy = new Map<string, number>();

    /** The shape of a callee, for the blind-spot breakdown: `this.x()`, `a.b()`, or a bare name. */
    const shapeOf = (callee: ts.Expression): string => {
        if (ts.isPropertyAccessExpression(callee)) {
            const target = callee.expression;
            if (target.kind === ts.SyntaxKind.ThisKeyword) return 'this.<method>()';
            if (ts.isIdentifier(target)) return `${target.text}.<method>()`;
            return '<expression>.<method>()';
        }
        if (ts.isIdentifier(callee)) return '<name>()';
        return '<other>()';
    };
    const missed = (callee: ts.Expression): void => {
        unresolved += 1;
        const shape = shapeOf(callee);
        unresolvedBy.set(shape, (unresolvedBy.get(shape) ?? 0) + 1);
    };

    /** Register a function-like node and return its id, or undefined when it has no usable name. */
    const register = (fn: ts.Node): FnId | undefined => {
        const source = fn.getSourceFile();
        const name = declName(fn) ?? (ts.isVariableDeclaration(fn.parent ?? fn) ? undefined : undefined);
        if (!name) return undefined;
        const file = rel(source, root);
        const id = `${file}#${name}`;
        if (!nodes.has(id)) {
            nodes.set(id, {
                id, file, name,
                line: source.getLineAndCharacterOfPosition(fn.getStart(source)).line + 1,
                isInterfaceMethod: ts.isMethodSignature(fn),
            });
        }
        return id;
    };

    for (const source of files) {
        // The function-like ancestors of a node, innermost first, so a call inside a nested arrow is
        // attributed to the nearest NAMED function rather than dropped.
        const enclosing = (n: ts.Node): FnId | undefined => {
            for (let p: ts.Node | undefined = n; p; p = p.parent) {
                if (isFunctionLike(p) && declName(p)) return register(p);
            }
            return undefined;
        };

        const visit = (n: ts.Node): void => {
            if (isFunctionLike(n) && declName(n)) register(n);

            if (ts.isCallExpression(n)) {
                const from = enclosing(n);
                if (from) {
                    const decl = resolveCallee(checker, n.expression);
                    if (!decl) {
                        missed(n.expression);
                    } else if (!inScope.has(decl.getSourceFile().fileName)) {
                        external += 1;
                    } else {
                        const fn = functionOf(decl);
                        const to = fn ? register(fn) : undefined;
                        if (!to) missed(n.expression);
                        else if (to !== from) {
                            if (!edges.has(from)) edges.set(from, new Set());
                            (edges.get(from) as Set<FnId>).add(to);
                        }
                    }
                }
            }
            ts.forEachChild(n, visit);
        };
        visit(source);
    }

    return { nodes, edges, unresolved, external, unresolvedBy };
}

/** Everything reachable from these roots, by following edges forward. */
export function reachable(graph: CallGraph, roots: Iterable<FnId>): Set<FnId> {
    const seen = new Set<FnId>();
    const queue = [...roots];
    while (queue.length > 0) {
        const id = queue.pop() as FnId;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const next of graph.edges.get(id) ?? []) if (!seen.has(next)) queue.push(next);
    }
    return seen;
}

/** The shortest path from one of the roots to `target`, for a report that has to be believable. */
export function pathTo(graph: CallGraph, roots: Iterable<FnId>, target: FnId): FnId[] | undefined {
    const previous = new Map<FnId, FnId | null>();
    const queue: FnId[] = [];
    for (const r of roots) { previous.set(r, null); queue.push(r); }
    for (let i = 0; i < queue.length; i += 1) {
        const id = queue[i];
        if (id === target) {
            const path: FnId[] = [];
            for (let step: FnId | null | undefined = id; step; step = previous.get(step)) path.unshift(step);
            return path;
        }
        for (const next of graph.edges.get(id) ?? []) {
            if (!previous.has(next)) { previous.set(next, id); queue.push(next); }
        }
    }
    return undefined;
}
