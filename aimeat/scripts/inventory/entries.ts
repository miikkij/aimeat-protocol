/**
 * @file scripts/inventory/entries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Finding every door in the source, by parsing rather than by matching text.
 *
 *   WHY THE COMPILER AND NOT A REGEX. A guard chain is written four ways here — inline calls,
 *   `...operator` spreading a const array, an array passed whole, and a bare identifier — and a
 *   regex that handles three of them reports the fourth as ungated. That is not hypothetical: it
 *   happened on 2026-09-03 during this same audit, where a scan called eight write routes unguarded
 *   because its pattern missed `const operator = [...]` with a space before the `=`. An inventory
 *   that is wrong in the permissive direction is worse than none, so this walks the AST.
 *
 *   WHY THIS IS POSSIBLE AT ALL. Doors here are registered in fixed shapes: `router.<verb>(path,
 *   ...guards, handler)`, `mcp.tool(name, ...)`, and a literal table for the CLI dispatch. A
 *   codebase that registered routes dynamically could not be enumerated this way, and the audit
 *   would need a different instrument.
 * @structure collectRestRoutes · collectMcpTools · collectCliDispatch · callsInside · EntryPoint
 * @usage const entries = [...collectRestRoutes(program), ...collectMcpTools(program)];
 * @version-history
 *   v1.1.0 — 2026-09-04 — callsInside() lives here now. Two gates written the same day each carried
 *     their own copy of it, which is the shape check:copied-logic exists to refuse.
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1).
 */
import ts from 'typescript';
import { relative } from 'node:path';
import type { GuardCall } from './principals.js';

export type EntryKind = 'rest' | 'mcp.node' | 'mcp.connector' | 'cli.dispatch';

export interface EntryPoint {
    kind: EntryKind;
    /** `GET /v1/apps/:owner/legal`, or the tool's name. */
    id: string;
    file: string;
    line: number;
    guards: GuardCall[];
    /** The handler's position, for the call-graph pass that comes later. */
    handlerLine: number;
}

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

/**
 * Every function called anywhere inside a node, by name, however deeply nested.
 *
 * Used to answer "does this handler do X somewhere in its body" — verify a peer signature, resolve
 * the caller's identity — without following the call any further. One hop, deliberately: what a
 * callee does in turn is a question for a call graph, and this walk must not be read as one.
 */
export function callsInside(node: ts.Node): Set<string> {
    const names = new Set<string>();
    const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
            const callee = n.expression;
            if (ts.isIdentifier(callee)) names.add(callee.text);
            else if (ts.isPropertyAccessExpression(callee)) names.add(callee.name.text);
        }
        ts.forEachChild(n, visit);
    };
    visit(node);
    return names;
}

function lineOf(node: ts.Node, source: ts.SourceFile): number {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function rel(source: ts.SourceFile, root: string): string {
    return relative(root, source.fileName).split('\\').join('/');
}

/** The string-literal arguments of a call, which is where scope words and role names live. */
function stringArgs(node: ts.CallExpression): string[] {
    return node.arguments
        .filter((a): a is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
            ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))
        .map(a => a.text);
}

/**
 * Turn one middleware argument into the guards it stands for.
 *
 * The four shapes, all of them live in this repo:
 *   requireAuth()                      a call
 *   requireAuth                        an identifier (rare, but legal)
 *   ...operator                        a spread of a const array declared in the same file
 *   operator                           the array passed whole (Express accepts it)
 */
function guardsFromArg(arg: ts.Expression, arrays: Map<string, GuardCall[]>): GuardCall[] {
    if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
        return [{ name: arg.expression.text, args: stringArgs(arg) }];
    }
    if (ts.isSpreadElement(arg) && ts.isIdentifier(arg.expression)) {
        return arrays.get(arg.expression.text) ?? [{ name: `...${arg.expression.text}`, args: [] }];
    }
    if (ts.isIdentifier(arg)) {
        const known = arrays.get(arg.text);
        if (known) return known;
        return [{ name: arg.text, args: [] }];
    }
    if (ts.isArrayLiteralExpression(arg)) {
        return arg.elements.flatMap(e => guardsFromArg(e, arrays));
    }
    return [];
}

/**
 * `const operator = [requireAuth(), requireRole('operator')] as const;` → the two guards.
 *
 * Collected across ALL files and merged, not per file, because a chain is sometimes declared in one
 * module and spread in another — `codeInviteGuards` is declared in organisms/shared.ts and used in
 * organisms/workspace-access.ts. A per-file map reports those rows as ungated, which is the
 * permissive direction and therefore the one that must not happen.
 */
export function guardArraysIn(source: ts.SourceFile): Map<string, GuardCall[]> {
    const found = new Map<string, GuardCall[]>();
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            let init: ts.Expression = node.initializer;
            // `[...] as const` and `[...] satisfies X` wrap the array.
            while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
            if (ts.isArrayLiteralExpression(init)) {
                const guards = init.elements.flatMap(e => guardsFromArg(e, found));
                if (guards.length > 0) found.set(node.name.text, guards);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

/** Every `router.get('/path', …)` in the file, with its chain resolved. */
export function collectRestRoutes(source: ts.SourceFile, root: string, arrays: Map<string, GuardCall[]>): EntryPoint[] {
    const out: EntryPoint[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const verb = node.expression.name.text;
            const target = node.expression.expression;
            const onRouter = ts.isIdentifier(target) && /^(router|app)$/.test(target.text);
            const first = node.arguments[0];
            if (VERBS.has(verb) && onRouter && first && ts.isStringLiteral(first)) {
                const middle = node.arguments.slice(1, -1);
                const handler = node.arguments[node.arguments.length - 1];
                out.push({
                    kind: 'rest',
                    id: `${verb.toUpperCase()} ${first.text}`,
                    file: rel(source, root),
                    line: lineOf(node, source),
                    guards: middle.flatMap(a => guardsFromArg(a, arrays)),
                    handlerLine: handler ? lineOf(handler, source) : lineOf(node, source),
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}

/**
 * Every `mcp.tool('name', …)` / `mcp.registerTool('name', …)`.
 *
 * A tool carries no middleware: its gate is the scope filter applied at registration
 * (mcp/index.ts patches mcp.tool for the duration), so `guards` is empty by construction and the
 * scope word comes from catalog/scopes.ts instead. Recorded as its own kind so the difference is
 * visible rather than read as "an unguarded door".
 */
export function collectMcpTools(source: ts.SourceFile, root: string, kind: 'mcp.node' | 'mcp.connector'): EntryPoint[] {
    const out: EntryPoint[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text;
            const first = node.arguments[0];
            if ((method === 'tool' || method === 'registerTool') && first && ts.isStringLiteral(first)) {
                out.push({
                    kind, id: first.text,
                    file: rel(source, root), line: lineOf(node, source),
                    guards: [],
                    handlerLine: lineOf(node, source),
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}

/**
 * The CLI dispatch table: `{ name: 'aimeat_x', handler: … }` objects in tool-call-defs-*.ts.
 *
 * The third surface, and the one CLAUDE.md records as having lost a parameter in silence three
 * times in one week. It has no guards either — the node's own route it forwards to holds them —
 * so what the inventory is for here is presence: a tool on two surfaces and not this one.
 */
export function collectCliDispatch(source: ts.SourceFile, root: string): EntryPoint[] {
    const out: EntryPoint[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
            const nameProp = node.properties.find((p): p is ts.PropertyAssignment =>
                ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'name');
            const hasHandler = node.properties.some(p =>
                (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isShorthandPropertyAssignment(p))
                && p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'handler');
            if (nameProp && hasHandler && ts.isStringLiteral(nameProp.initializer)) {
                out.push({
                    kind: 'cli.dispatch', id: nameProp.initializer.text,
                    file: rel(source, root), line: lineOf(node, source),
                    guards: [],
                    handlerLine: lineOf(node, source),
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
}
