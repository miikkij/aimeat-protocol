/**
 * @file scripts/inventory/owner-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every place a refusal is decided by comparing the owner NAME on the verified token.
 *
 *   INVARIANT 11, AND WHY IT IS NOT OBVIOUS. `auth.owner` carries the human's name on every kind of
 *   credential alike: an owner session, an agent JWT, an ecosystem app's token, a personal access
 *   token, an app grant. So `if (record.owner !== req.auth.owner) return 403` refuses a different
 *   PERSON and admits everything acting in this person's name. For reading someone's own data that is
 *   usually what was meant. For changing the ACCOUNT — password, email, recovery, deletion, tokens —
 *   it is not: the question there is whether a person is present, and no comparison of names can ask
 *   it. `requireOwnerPrincipal()` asks it, and `requireRole('owner')` does not, because an agent
 *   minted for that owner carries the owner role too.
 *
 *   WHAT IS COLLECTED. A comparison of `<verified token>.owner` against something, where the branch it
 *   guards refuses: a 401/403/404 status, an `error(` envelope, or a throw. A comparison that guards
 *   a branch doing something else — choosing a label, picking a default, deciding what to include in
 *   a response — is not a gate and is not reported.
 *
 *   LISTED, NOT JUDGED, and this one leans the other way from most: it reports a door even when the
 *   comparison is exactly right, if nothing on that door names the principal. A reader decides which
 *   of the two kinds it is. What the gate refuses is a NEW one appearing with nobody having looked.
 * @structure ownerDecisions(): one row per refusing comparison, with the door and its guards
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. Invariant 11 was the last of the four written rules from the
 *     August 2026 audit with no gate reading the places it applies to.
 */
import ts from 'typescript';
import { relative } from 'node:path';
import { callsInside, enclosingUnit } from './entries.js';

/** The verified token, declared on Express's Request in src/auth/middleware.ts. */
const AUTH_TYPE = 'VerifiedToken';

/** The middleware that asks whether a PERSON is present, rather than what role a token carries. */
export const PRINCIPAL_GUARDS = ['requireOwnerPrincipal', 'requireOperatorPrincipal', 'requireOwnerSession'];

/**
 * The roles a principal test must EXCLUDE, and the reason this is the mark to look for.
 *
 * A door can ask the principal question without any middleware, by computing it:
 *
 *   const isOwnerSession = (roles.includes('owner') || roles.includes('operator'))
 *     && !roles.includes('agent') && !roles.includes('ecosystem');
 *
 * `resolveIdentity` is written the same way, and so is DELETE /v1/agents/:name, which implements
 * invariant 11 in depth and cites it by name. What separates that from a role check is the NEGATION:
 * naming the person means refusing the things acting in their name. So a unit that negates an
 * agent-or-ecosystem role test has asked the question, whatever middleware it carries.
 *
 * The first version of this gate had only the middleware list and reported that door as untriaged
 * debt — a gate crying at the one handler that got it right, which is how a gate gets switched off.
 */
const IN_HANDLER_PRINCIPAL_ROLES = ['agent', 'ecosystem'];

/**
 * The statuses that mean "not you". 409 is deliberately absent: a conflict is a statement about the
 * STATE of the request, not about the caller, and including it caught POST /v1/admin/roles/revoke —
 * whose `req.auth.owner === owner` comparison is a lockout guard ("you cannot revoke your own
 * operator role"), the opposite of an authorization decision. Invariant 11 is about who a refusal
 * refuses, so a status that refuses nobody does not belong in the population.
 */
const REFUSING_CODES = ['401', '403', '404'];

export interface OwnerDecision {
    file: string;
    line: number;
    /** `PATCH /v1/ghii/:name` for a route handler, `canManage` for a named function. */
    unit: string;
    /**
     * Does the unit name the principal rather than only compare a name — through a middleware from
     * PRINCIPAL_GUARDS, or by computing the test itself with a negated agent/ecosystem role check?
     */
    namesPrincipal: boolean;
    /** The comparison as written. */
    text: string;
}

/** Is this expression a read of `.owner` off the verified token? */
function isAuthOwner(checker: ts.TypeChecker, node: ts.Expression): boolean {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'owner') return false;
    return checker.typeToString(checker.getTypeAtLocation(node.expression)).includes(AUTH_TYPE);
}

/**
 * Does this branch refuse?
 *
 * Read as: it sets a refusing HTTP status, builds an `error(…)` envelope, or throws. A branch that
 * merely returns early is NOT counted — an early return with a 200 beside it is a shortcut, not a
 * gate, and counting it would fill the list with reads that chose a cheaper path.
 */
function branchRefuses(node: ts.Node): boolean {
    const statuses: string[] = [];
    let envelopeOrThrow = false;

    const visit = (n: ts.Node): void => {
        if (ts.isThrowStatement(n)) envelopeOrThrow = true;
        if (ts.isCallExpression(n)) {
            const callee = n.expression;
            const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
                : ts.isIdentifier(callee) ? callee.text : '';
            if ((name === 'status' || name === 'sendStatus') && n.arguments[0]) statuses.push(n.arguments[0].getText());
            if (name === 'error') envelopeOrThrow = true;
        }
        ts.forEachChild(n, visit);
    };
    visit(node);

    // The status is the answer when there is one. `error(` is this repo's envelope and appears under
    // every failure code including 400 and 409, so reading it alone counted a lockout guard —
    // "you cannot revoke your own operator role", a 409 about the request's state rather than about
    // the caller — as an authorization decision. Only where no status is set does the envelope or a
    // throw stand on its own, which is the service-layer shape.
    if (statuses.length > 0) return statuses.some(s => REFUSING_CODES.some(code => s.includes(code)));
    return envelopeOrThrow;
}

/**
 * Does this unit compute the principal test itself, by refusing what acts in the person's name?
 *
 * Looks for a negated role test — `!roles.includes('agent')`, `!req.auth!.roles.includes('ecosystem')`
 * — anywhere in the unit. The negation is the whole signal; a positive `roles.includes('owner')` is a
 * role check and invariant 11 is about the difference.
 */
function computesPrincipalTest(unit: ts.Node): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
            const operand = n.operand;
            if (ts.isCallExpression(operand) && ts.isPropertyAccessExpression(operand.expression)
                && operand.expression.name.text === 'includes') {
                const arg = operand.arguments[0];
                if (arg && ts.isStringLiteral(arg) && IN_HANDLER_PRINCIPAL_ROLES.includes(arg.text)) {
                    found = true;
                    return;
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(unit);
    return found;
}

/** The `if` this comparison is the test of, if it is one. */
function guardedIf(node: ts.Node): ts.IfStatement | undefined {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
        if (ts.isIfStatement(n)) return n.expression.getStart() <= node.getStart() && node.getEnd() <= n.expression.getEnd() ? n : undefined;
        // A comparison folded into a larger boolean is still the test of the `if` above it.
        if (ts.isBinaryExpression(n) || ts.isParenthesizedExpression(n) || ts.isPrefixUnaryExpression(n)) continue;
        return undefined;
    }
    return undefined;
}

export function ownerDecisions(program: ts.Program, files: ts.SourceFile[], root: string): OwnerDecision[] {
    const checker = program.getTypeChecker();
    const rows: OwnerDecision[] = [];

    for (const source of files) {
        const rel = relative(root, source.fileName).split('\\').join('/');
        const visit = (node: ts.Node): void => {
            if (ts.isBinaryExpression(node)
                && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
                    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)
                && (isAuthOwner(checker, node.left) || isAuthOwner(checker, node.right))) {
                const ifStatement = guardedIf(node);
                const refuses = ifStatement
                    ? branchRefuses(ifStatement.thenStatement) || (ifStatement.elseStatement ? branchRefuses(ifStatement.elseStatement) : false)
                    : false;
                if (refuses) {
                    const found = enclosingUnit(node);
                    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
                    rows.push({
                        file: rel,
                        line: line + 1,
                        unit: found?.unit ?? '<module>',
                        namesPrincipal: found
                            ? PRINCIPAL_GUARDS.some(g => callsInside(found.body).has(g)) || computesPrincipalTest(found.body)
                            : false,
                        text: source.text.split('\n')[line].trim().slice(0, 130),
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return rows;
}
