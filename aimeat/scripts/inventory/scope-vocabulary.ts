/**
 * @file scripts/inventory/scope-vocabulary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The permission words, from both ends: what the OWNER can grant, and what a DOOR
 *   demands. Two lists that are supposed to be the same list.
 *
 *   EXTRACTED, not written twice. `readVocabulary` lived inside build-inventory.ts and
 *   check:scope-parity needs the identical answer — a second copy would drift the day one of them
 *   learned about a new shape, and `check:copied-logic` would refuse it anyway. The report and the
 *   gate now read the same function, which is the point of the rule they are both enforcing.
 * @structure
 *   - readVocabulary(): the words the owner is OFFERED, parsed from the screen they are offered on
 *   - demandedScopes(): the words a door asks for, from requireScope() calls across the sources
 * @usage
 *   const vocabulary = readVocabulary(aimeatDir);
 *   const demanded = demandedScopes(sourceFiles);
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted from build-inventory.ts (pure move) and joined by
 *     demandedScopes(), for the scope-parity gate.
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The words the OWNER can grant, read from the screen they are granted on.
 *
 * That source and not a server-side constant on purpose: a permission the owner is OFFERED and
 * nothing asks for is the defect this exists to find, and only the owner-facing list shows the
 * offer. Parsed rather than imported, like everything else here — the module is browser JS with no
 * declarations, and importing it would buy an `any` and a typecheck exception for nothing.
 */
export function readVocabulary(aimeatDir: string): Set<string> {
    const file = join(aimeatDir, 'public', 'views', 'profile', 'agents', 'scope-model.js');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.ESNext, true);
    const words = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
            const prop = (name: string): ts.Expression | undefined => node.properties
                .find((p): p is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name)?.initializer;
            const key = prop('key');
            const permissions = prop('permissions');
            if (key && ts.isStringLiteral(key) && permissions && ts.isArrayLiteralExpression(permissions)) {
                for (const p of permissions.elements) {
                    if (ts.isStringLiteral(p)) words.add(`${key.text}:${p.text}`);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return words;
}

/** One place a route demands a permission word. */
export interface ScopeDemand {
    word: string;
    file: string;
    line: number;
}

/**
 * Every word a ROUTE demands, from `requireScope('word')` across the sources.
 *
 * The other direction from readVocabulary, and the reason both live here. A word a door requires
 * that the owner's screen never offers cannot be granted by anybody: the door is closed to every
 * principal that has to be given permission, which is not the same as closed by design and reads
 * identically from outside. Two of those were live on 2026-09-04 (`app:read`, `events:emit`).
 *
 * Only the literal argument is read. A `requireScope(SOME_CONST)` is not resolved here on purpose:
 * this list is used to find words that are demanded and NOT grantable, so a name it cannot resolve
 * must not become a finding. scope-mentions.ts follows constants, and it answers the opposite
 * question — where a KNOWN word is mentioned — where a miss costs a false finding instead.
 */
export function demandedScopes(files: readonly ts.SourceFile[]): ScopeDemand[] {
    const out: ScopeDemand[] = [];
    for (const sf of files) {
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)
                && ts.isIdentifier(node.expression)
                && node.expression.text === 'requireScope'
                && node.arguments.length > 0) {
                for (const arg of node.arguments) {
                    if (!ts.isStringLiteral(arg)) continue;
                    const { line } = sf.getLineAndCharacterOfPosition(arg.getStart(sf));
                    out.push({ word: arg.text, file: sf.fileName, line: line + 1 });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return out;
}
