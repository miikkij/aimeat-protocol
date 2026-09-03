/**
 * @file scripts/inventory/identity-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every place a route or a service reads `sub` off the verified token, and whether the
 *   same unit of code also asks `resolveIdentity()` who the caller is.
 *
 *   WHAT `sub` IS AND WHY READING IT IS A DECISION. `resolveIdentity(auth, nodeId)` returns
 *   `owner@nodeId` for an owner session and `auth.sub` for everything else. So on an agent or an
 *   ecosystem token the two are the same value, and on an OWNER session they are not: `sub` is the
 *   bare account name. Store under `sub` and the owner's own record lands under `alice` instead of
 *   `alice@node-id`, where list, search and update cannot see it. That is why CLAUDE.md says every
 *   route that stores or retrieves by identity goes through `resolveIdentity` and never raw `sub` —
 *   a rule that has been written down for months with nothing reading the places it applies to.
 *
 *   LISTED, NOT JUDGED. Reading `sub` is not a defect by itself: it is the right value for comparing
 *   against a bare owner name in a path, for a log line, and for anything that means "the account"
 *   rather than "the identity data is filed under". This module cannot tell those apart, because
 *   telling them apart means knowing what the parameter on the other side of the call MEANS. What it
 *   can do is name the unit and say whether `resolveIdentity` appears anywhere in it, which turns a
 *   rule nobody could check into a list a person can read.
 * @structure
 *   - AUTH_TYPE: the type whose `sub` this is about
 *   - identityReads(): one row per read, carrying the enclosing door or function
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, for check-identity-resolution.ts.
 */
import ts from 'typescript';
import { relative } from 'node:path';
import { callsInside } from './entries.js';

/** The verified token, declared on Express's Request in src/auth/middleware.ts. */
const AUTH_TYPE = 'VerifiedToken';

/** The call that turns a verified token into the identity data is filed under. */
const RESOLVER = 'resolveIdentity';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

export interface IdentityRead {
    file: string;
    line: number;
    /** `POST /v1/memory` for a route handler, `listForOwner` for a named function. */
    unit: string;
    /** Does anything in the same unit call resolveIdentity()? */
    resolvesToo: boolean;
    /**
     * Is the value handed to a call, rather than compared, logged or interpolated? This is what
     * separates the debt worth triaging first from the rest: `listWorkByProvider(req.auth!.sub)`
     * hands an identity to something that files or finds data by it, while `req.auth?.sub ?? 'anon'`
     * in a template and `if (!payload?.sub)` are the account name and a presence test, which is
     * what `sub` is for. Both stay in the population — one hop is not proof of anything — but a
     * person triaging 141 units should start with the ones that pass it on.
     */
    asArgument: boolean;
    /** The line as written, trimmed, so a reader can judge without opening the file. */
    text: string;
}

/**
 * The unit a read belongs to, walking outwards.
 *
 * A route handler is an anonymous arrow, so the name that survives an edit is the door it hangs on —
 * the same identity `check-route-scopes.ts` keys its exemptions by, and for the same reason: a line
 * number goes stale the moment anything above it moves. Outside a router, the nearest named function
 * is the unit. The search stops at the first of the two, so a helper declared inside a handler is
 * reported as the helper.
 */
function enclosingUnit(node: ts.Node): { unit: string; body: ts.Node } | undefined {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && VERBS.has(n.expression.name.text) && n.arguments.length >= 2) {
            const first = n.arguments[0];
            if (first && ts.isStringLiteral(first)) {
                return { unit: `${n.expression.name.text.toUpperCase()} ${first.text}`, body: n };
            }
        }
        if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) {
            if (n.name && ts.isIdentifier(n.name)) return { unit: n.name.text, body: n };
        }
        // `const listForOwner = async (…) => {…}` and `function listForOwner()` both read as the
        // name they are bound to; an arrow with no name keeps walking outwards.
        if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n))
            && n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) {
            return { unit: n.parent.name.text, body: n };
        }
    }
    return undefined;
}

/**
 * Is the read handed straight to a call? `f(req.auth!.sub)` yes, and so does one narrowing hop —
 * `f(req.auth!.sub as string)`, `f(req.auth?.sub ?? '')` — because the value still arrives at the
 * callee. A comparison, a template string or an object literal is not, even though a property
 * assignment often ends up somewhere: proving THAT needs the call graph this does not build.
 */
function isCallArgument(node: ts.Node): boolean {
    let n: ts.Node = node;
    for (let hops = 0; hops < 3 && n.parent; hops += 1) {
        const p: ts.Node = n.parent;
        if (ts.isCallExpression(p) && p.arguments.some(a => a === n)) return true;
        if (ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p)
            || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
            n = p;
            continue;
        }
        return false;
    }
    return false;
}

/** Is this expression's type the verified token? */
function isAuthObject(checker: ts.TypeChecker, expr: ts.Expression): boolean {
    return checker.typeToString(checker.getTypeAtLocation(expr)).includes(AUTH_TYPE);
}

export function identityReads(program: ts.Program, files: ts.SourceFile[], root: string): IdentityRead[] {
    const checker = program.getTypeChecker();
    const rows: IdentityRead[] = [];

    for (const source of files) {
        const rel = relative(root, source.fileName).split('\\').join('/');
        const visit = (node: ts.Node): void => {
            let hit: ts.Node | undefined;

            // req.auth!.sub  ·  req.auth?.sub  ·  auth.sub
            if (ts.isPropertyAccessExpression(node) && node.name.text === 'sub'
                && isAuthObject(checker, node.expression)) hit = node;

            // const { sub } = req.auth!  ·  const { sub, owner } = auth
            if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
                && node.initializer && isAuthObject(checker, node.initializer)
                && node.name.elements.some(e => ts.isIdentifier(e.propertyName ?? e.name)
                    && (e.propertyName ?? e.name).getText(source) === 'sub')) hit = node;

            if (hit) {
                const found = enclosingUnit(hit);
                const line = source.getLineAndCharacterOfPosition(hit.getStart(source)).line;
                rows.push({
                    file: rel,
                    line: line + 1,
                    unit: found?.unit ?? '<module>',
                    resolvesToo: found ? callsInside(found.body).has(RESOLVER) : false,
                    asArgument: isCallArgument(hit),
                    text: source.text.split('\n')[line].trim().slice(0, 120),
                });
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return rows;
}
