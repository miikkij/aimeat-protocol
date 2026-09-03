/**
 * @file scripts/inventory/scope-mentions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Everywhere a permission word is actually demanded — all three ways, not just the one.
 *
 *   THE MISTAKE THIS EXISTS TO UNDO. The first cut of this inventory looked only at `requireScope()`
 *   on a route and the MCP tool table, and reported six words as having zero doors. Two of the six
 *   were wrong: `account:security` is enforced INSIDE `requireOwnerPrincipal()` (middleware.ts:467)
 *   and `memory:write-as-owner` INSIDE a handler (routes/memory/owner-target.ts:119). Neither is a
 *   `requireScope` call, and both are real gates.
 *
 *   So a word is demanded in at least three shapes, and a detector that knows one of them produces
 *   findings that are simply wrong:
 *     1. `requireScope('word')` on a route            — the middleware chain
 *     2. TOOL_SCOPES['aimeat_x'] = 'word'             — the MCP tool table
 *     3. the literal anywhere in a gate's own body    — inside another middleware, or in a handler
 *
 *   The third is answered syntactically on purpose. "Is this word asked for ANYWHERE" is a presence
 *   question, and presence is exactly what text can answer honestly. What it cannot answer is
 *   whether the check is CORRECT — and it does not claim to. It only rules a word out of the
 *   zero-doors list, which is the direction where a false negative costs a real finding and a false
 *   positive costs somebody an afternoon.
 *
 *   Constants are followed one level: `const ACCOUNT_SECURITY_SCOPE = 'account:security'` means a
 *   reference to that name counts as a mention of the word. Without it, a codebase that names its
 *   scopes properly looks like one that never checks them.
 * @structure scopeMentions(files, vocabulary) → word -> mentions
 * @usage const mentions = scopeMentions(sourceFiles, VOCABULARY);
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial, after two of the first six findings turned out to be the
 *     detector's fault rather than the code's.
 */
import ts from 'typescript';
import { relative } from 'node:path';

export interface Mention {
    file: string;
    line: number;
    /** `literal` = the word written out; `constant` = a reference to a name bound to it. */
    via: 'literal' | 'constant';
    /** The constant's name, when via is 'constant'. */
    name?: string;
}

/**
 * Where each vocabulary word is mentioned across the sources.
 *
 * Files that only DEFINE the vocabulary are excluded, because a definition is not a demand: the
 * owner-facing model lists what can be granted, and scope-coverage.ts binds the names. Counting
 * those would make every word look asked-for and the whole section would answer nothing.
 */
export function scopeMentions(
    files: readonly ts.SourceFile[],
    vocabulary: ReadonlySet<string>,
    root: string,
    excludeFiles: readonly string[] = [],
): Map<string, Mention[]> {
    const out = new Map<string, Mention[]>();
    const add = (word: string, m: Mention): void => {
        const list = out.get(word) ?? [];
        list.push(m);
        out.set(word, list);
    };
    const excluded = (f: ts.SourceFile): boolean => excludeFiles.some(x => f.fileName.includes(x));

    // Pass 1: literals, and the constants bound to them.
    const constants = new Map<string, string>();
    for (const source of files) {
        const rel = relative(root, source.fileName).split('\\').join('/');
        const visit = (node: ts.Node): void => {
            if (ts.isStringLiteral(node) && vocabulary.has(node.text)) {
                if (!excluded(source)) {
                    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
                    add(node.text, { file: rel, line, via: 'literal' });
                }
                // The binding is recorded even in an excluded file: scope-coverage.ts is where the
                // names live, and the point is to follow them OUT of it.
                const parent = node.parent;
                if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
                    constants.set(parent.name.text, node.text);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }

    // Pass 2: references to those constants, which is how a well-named codebase spells a demand.
    for (const source of files) {
        if (excluded(source)) continue;
        const rel = relative(root, source.fileName).split('\\').join('/');
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node) && constants.has(node.text)) {
                const isDeclaration = node.parent && ts.isVariableDeclaration(node.parent) && node.parent.name === node;
                if (!isDeclaration) {
                    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
                    add(constants.get(node.text) as string, { file: rel, line, via: 'constant', name: node.text });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }

    return out;
}
