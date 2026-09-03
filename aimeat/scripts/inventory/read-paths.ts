/**
 * @file scripts/inventory/read-paths.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Question B of wish-invarianttiauditointi: every read path to a table, and whether it
 *   excludes the rows that are supposed to be gone.
 *
 *   THE LEAK THIS IS SHAPED BY. A deleted memory record was hidden on fifteen read paths and not on
 *   the sixteenth. The sixteenth did not forget a condition — it never had one to forget, because it
 *   routes by CHOOSING A DIFFERENT TARGET (the full-text index) rather than by adding a `where`. A
 *   shared filter cannot reach a query that does not run through it, so "does the shared filter
 *   exist" is the wrong question and "does THIS path exclude it" is the right one. By key: 404. By
 *   text search: there it is.
 *
 *   WHAT IS COUNTED. Every `selectFrom('table')` in the Kysely provider and every `FROM table` in
 *   the SQLite provider's SQL strings, grouped by table, with the state columns that table HAS and
 *   whether each path mentions each of them. A path that mentions the column is not thereby proved
 *   correct — `deletedAt IS NOT NULL` mentions it too — so this reports MENTIONS, and the rows it
 *   cannot see a mention on are the candidates a person reads. Anything stronger would be claiming
 *   to know what the condition means, and a detector that claims that is the one that was wrong in
 *   both directions inside an hour on 2026-08-16.
 *
 *   The alternate-target column is the important one and it is why this exists at all: a path whose
 *   target is an FTS table, a view, or a second table holding the same rows never passes through the
 *   filter its siblings share, and it will never look wrong in a diff.
 * @structure STATE_COLUMNS · readPaths(files) · stateColumnsPerTable(files)
 * @usage const paths = readPaths(sourceFiles, root);
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1, question B).
 */
import ts from 'typescript';
import { relative } from 'node:path';

/**
 * The column names that mean "this row should not be seen any more".
 *
 * Both spellings, because the Kysely side is camelCase and the SQLite side is raw SQL. The list is
 * derived from what the schemas actually declare rather than guessed: it is the union of the state
 * columns found in db-types.ts and the SQLite schema files, and a name added to a schema later and
 * not added here is a hole in this instrument — which is why the generator reports the columns it
 * found per table beside the ones it knows.
 */
export const STATE_COLUMNS = [
    'deletedAt', 'deleted_at',
    'archivedAt', 'archived_at', 'archived',
    'revokedAt', 'revoked_at', 'revoked',
    'disabledAt', 'disabled_at', 'disabled',
    'expiresAt', 'expires_at',
    'ttlExpiresAt', 'ttl_expires_at',
] as const;

export interface ReadPath {
    /** The table or FTS target the query selects from. */
    target: string;
    file: string;
    line: number;
    /** The enclosing function, which is the unit a person reviews. */
    fn: string;
    /** State column names mentioned anywhere in that function. */
    mentions: string[];
    /** True when the target is not a plain table — an FTS index, a view, a join alias. */
    alternateTarget: boolean;
    provider: 'postgres-kysely' | 'sqlite';
}

/** The nearest enclosing named function, so a finding points at something a person can open. */
function enclosingName(node: ts.Node): string {
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
        if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
        if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) return n.name.text;
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    }
    return '(anonyymi)';
}

/** Every state column named anywhere inside the enclosing function of `node`. */
function mentionsIn(node: ts.Node, source: ts.SourceFile): string[] {
    let scope: ts.Node = node;
    for (let n: ts.Node | undefined = node; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
            scope = n;
            break;
        }
    }
    const text = scope.getText(source);
    return STATE_COLUMNS.filter(c => text.includes(c));
}

/** A target that is not a plain table: the shared filter never reaches it. */
function isAlternate(target: string): boolean {
    return /_fts\b|fts_|_view\b|_index\b|_search\b/i.test(target) || target === PARAMETERISED;
}

/**
 * The target of `FROM ${something}` — a table chosen at run time.
 *
 * THIS IS THE CLASS THE LEAK WAS IN, and the first version of this file missed it. The FTS search
 * is `FROM ${ftsTable} JOIN memory m …` with the table passed in as an argument, so the name of the
 * thing being read is not written down anywhere a reader or a scanner can see it. That is the same
 * property that made the leak invisible in review: nothing in the file says "memory_fts", so
 * nothing in the file looks like it needs the filter its siblings have.
 *
 * A parameterised target is therefore not one more row on the list. It is the top of it: a query
 * whose target cannot be known statically cannot be proved to exclude anything statically either,
 * and the honest thing an instrument can do is say so and hand it to a person.
 */
export const PARAMETERISED = '${…}';

/**
 * Every read path in the storage providers.
 *
 * Kysely: `selectFrom('x')`. SQLite: any string literal containing `FROM x`, which catches the raw
 * SQL this provider is written in — including `FROM memory_fts`, the one the leak came through.
 */
export function readPaths(files: readonly ts.SourceFile[], root: string): ReadPath[] {
    const out: ReadPath[] = [];

    for (const source of files) {
        if (!source.fileName.includes('/src/storage/')) continue;
        const provider: ReadPath['provider'] = source.fileName.includes('/sqlite/') ? 'sqlite' : 'postgres-kysely';
        const rel = relative(root, source.fileName).split('\\').join('/');
        const at = (n: ts.Node): number => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;

        const visit = (node: ts.Node): void => {
            // Kysely: selectFrom('table')
            if (ts.isCallExpression(node)
                && ts.isPropertyAccessExpression(node.expression)
                && node.expression.name.text === 'selectFrom') {
                const arg = node.arguments[0];
                if (arg && ts.isStringLiteral(arg)) {
                    out.push({
                        target: arg.text, file: rel, line: at(node), fn: enclosingName(node),
                        mentions: mentionsIn(node, source), alternateTarget: isAlternate(arg.text), provider,
                    });
                }
            }
            // SQLite: raw SQL in a string or template literal.
            const sql = ts.isStringLiteral(node) ? node.text
                : ts.isNoSubstitutionTemplateLiteral(node) ? node.text
                    : ts.isTemplateExpression(node) ? node.getText(source) : null;
            if (sql && /\bSELECT\b/i.test(sql)) {
                // A named target.
                for (const m of sql.matchAll(/\bFROM\s+([a-z_][a-z0-9_]*)/gi)) {
                    out.push({
                        target: m[1], file: rel, line: at(node), fn: enclosingName(node),
                        mentions: mentionsIn(node, source), alternateTarget: isAlternate(m[1]), provider,
                    });
                }
                // A target chosen at run time — see PARAMETERISED. Matched separately because the
                // pattern above requires a name, and the whole point of this case is that there
                // isn't one.
                for (const _ of sql.matchAll(/\bFROM\s+\$\{/gi)) {
                    out.push({
                        target: PARAMETERISED, file: rel, line: at(node), fn: enclosingName(node),
                        mentions: mentionsIn(node, source), alternateTarget: true, provider,
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return out;
}

/** Which state columns each table actually declares, read from the schemas rather than assumed. */
export function stateColumnsPerTable(files: readonly ts.SourceFile[]): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const source of files) {
        if (!source.fileName.includes('/src/storage/')) continue;
        const text = source.getText();
        // `CREATE TABLE x (...)` in the SQLite schema files carries the column list inline.
        for (const m of text.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)/gi)) {
            const [, table, body] = m;
            const found = STATE_COLUMNS.filter(c => new RegExp(`\\b${c}\\b`).test(body));
            if (found.length > 0) out.set(table, new Set([...(out.get(table) ?? []), ...found]));
        }
    }
    return out;
}
