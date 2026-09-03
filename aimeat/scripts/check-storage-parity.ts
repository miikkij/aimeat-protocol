/**
 * @file scripts/check-storage-parity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The static half of the storage contract: every table with an owner-scoped column is
 *   named in the deletion cascade of BOTH providers, or is on a written exemption list. The dynamic
 *   half is test/unit/storage-conformance.test.ts, which runs the same scenario against both and
 *   compares the result; this one catches the table nobody thought about, which is how the audit's
 *   H-30 happened — Postgres cleared five tables where SQLite cleared thirty, and both returned true.
 *
 *   Erasure is the reason this is a gate and not a report. The developer decided on 2026-08-10 that a
 *   deleted username is released rather than reserved, which puts the whole weight on the cascade:
 *   if nothing owner-scoped survives, there is nothing for the next registrant to inherit.
 * @structure
 *   - OWNER_COLUMNS: the column names that make a table owner-scoped
 *   - main(): read the schema, read both cascades, report tables missing from either
 * @usage
 *   cd aimeat && pnpm check:storage-parity            # report
 *   cd aimeat && pnpm check:storage-parity --strict   # the hook/CI gate
 *   cd aimeat && pnpm check:storage-parity --seed     # rewrite the exemption file
 * @version-history
 *   v1.1.0 — 2026-09-04 — SQLITE_NAME_OVERRIDES: the second way this gate goes blind. A table the two
 *     providers NAME differently can never match the case/plural candidates, so its SQLite side is
 *     permanently absent and the exemption silencing it reads like a decision. MemoryVersion (SQLite:
 *     memory_history) was in that state for 25 days.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, step 5c / systemic pattern 5).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PG_SCHEMA = join(ROOT, 'src', 'storage', 'providers', 'postgres-kysely', 'migrations');
const PG_METHODS = join(ROOT, 'src', 'storage', 'providers', 'postgres-kysely', 'methods');
const SQLITE_METHODS = join(ROOT, 'src', 'storage', 'providers', 'sqlite', 'methods');
const EXEMPTIONS = join(ROOT, 'security', 'storage-parity-exemptions.json');

/**
 * A column of one of these names makes a row belong to somebody.
 *
 * THE LIST IS THE GATE'S EYESIGHT, so a name missing from it is a table this check cannot see at
 * all. `principal` was missing until 2026-08-29 and `Connection` is addressed by it, which is why a
 * table holding sealed credentials to people's mailboxes was in neither backend's owner cascade and
 * no gate said so. When you add a table whose owner column has a new name, add the name here in the
 * same change — a sweep of db-types.ts on that date found 58 tables carrying an owner-ish column
 * outside this list, so the next one is not hypothetical.
 */
const OWNER_COLUMNS = [
    'ownerGaii', 'ownerName', 'buyerOwner', 'sellerOwner', 'agentGaii', 'flaggedBy',
    'principal',
];

/**
 * NOT YET IN THE LIST ABOVE, and the reason is scope rather than doubt. Adding `ownerGhii`,
 * `publisher`, `createdBy` and `authorGhii` was tried on 2026-08-29 and turned this gate red with
 * eighteen tables at once: Capability, DirectMessage, ContactConsent, Conversation, Company,
 * WorkspaceRow, Package, PublishAttempt, UsageCall(+Archive), UsageRollup, AccountEvent(+Archive),
 * AiProvenance and the four Finance tables.
 *
 * They do not share an answer. Some must be deleted and are not. Some must SURVIVE their owner —
 * the finance tables because accounting law requires six years, the provenance records because they
 * answer "who made this?" for content that outlives the account — and those need an exemption with
 * the reason written down, not a deletion. Working through eighteen judgement calls belongs in its
 * own change with the developer, so the names stay out until then rather than being exempted in a
 * batch, which would turn the gate into a list of things nobody looked at.
 */

interface ExemptionFile { note: string; exempt: Record<string, string> }

function readAll(dir: string): string {
    if (!existsSync(dir)) return '';
    return readdirSync(dir)
        .filter(f => f.endsWith('.ts') || f.endsWith('.sql'))
        .map(f => readFileSync(join(dir, f), 'utf-8'))
        .join('\n');
}

/**
 * Tables in the Postgres schema that carry an owner-scoped column.
 *
 * `IF NOT EXISTS` is optional in the pattern, and it has to be: without it this scan silently skipped
 * every table written in that style, which on 2026-08-24 was four of them — GroupShare (0033),
 * AgentUsageEventArchive (0036) and the two tally tables (0050). A gate that cannot see a table
 * reports green about it, which is worse than reporting nothing, because green is read as checked.
 */
function ownerScopedTables(schema: string): Map<string, string[]> {
    const tables = new Map<string, string[]>();
    const re = /CREATE TABLE (?:IF NOT EXISTS )?"(\w+)" \(([\s\S]*?)\n\);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(schema))) {
        const [, table, body] = m;
        const cols = OWNER_COLUMNS.filter(c => new RegExp(`"${c}"`).test(body));
        if (cols.length) tables.set(table, cols);
    }
    return tables;
}

/**
 * Tables the two providers do not merely spell differently, but NAME differently, so no amount of
 * case and plural juggling below will ever connect them.
 *
 * This is the second way this gate can be blind, and it is quieter than the first. A missing owner
 * column (the list above) makes the table invisible entirely; a missing name mapping makes the
 * POSTGRES side visible and the SQLITE side permanently absent, so the table reports as "missing in
 * sqlite" forever and the exemption that silences it reads like a decision somebody made. MemoryVersion
 * sat in the exemption file from 2026-08-10 to 2026-09-04 in exactly that state: SQLite calls the
 * table memory_history, and neither provider cleared it, but only one of those two facts was true of
 * the report. Add a line here in the same change that names a table differently on the two sides.
 */
const SQLITE_NAME_OVERRIDES: Record<string, string> = {
    MemoryVersion: 'memory_history',
};

/** The SQLite table name for a Postgres table: PascalCase to snake_case, pluralised loosely. */
function sqliteCandidates(pgTable: string): string[] {
    const override = SQLITE_NAME_OVERRIDES[pgTable];
    if (override) return [override];
    const snake = pgTable.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    return [snake, `${snake}s`, `${snake}es`, pgTable.toLowerCase(), `${pgTable.toLowerCase()}s`];
}

function main(): void {
    const strict = process.argv.includes('--strict');
    const seed = process.argv.includes('--seed');

    const schema = readAll(PG_SCHEMA);
    const pgCascade = readAll(PG_METHODS);
    const sqliteCascade = readAll(SQLITE_METHODS);
    const tables = ownerScopedTables(schema);

    const missing: { table: string; columns: string[]; where: string }[] = [];
    for (const [table, cols] of tables) {
        // "named in the cascade" is deliberately loose: the delete may be a Kysely deleteFrom, a raw
        // DELETE, or a helper. What matters is that the table name appears in the provider's delete
        // paths at all — a table nobody mentions is a table nobody clears.
        const inPg = new RegExp(`deleteFrom\\('${table}'\\)`).test(pgCascade);
        const inSqlite = sqliteCandidates(table).some(c => new RegExp(`DELETE FROM ${c}\\b`, 'i').test(sqliteCascade));
        if (inPg && inSqlite) continue;
        missing.push({
            table, columns: cols,
            where: !inPg && !inSqlite ? 'neither provider' : (!inPg ? 'postgres-kysely' : 'sqlite'),
        });
    }

    if (seed) {
        const exempt: Record<string, string> = {};
        for (const t of missing) {
            exempt[t.table] = `Seeded 2026-08-10. Owner-scoped by ${t.columns.join('/')} and not cleared in ${t.where}. `
                + 'Decide: add it to the cascade, or record here why the row must outlive its owner '
                + '(an immutable ledger entry, a counterparty\'s copy, an anonymised aggregate).';
        }
        writeFileSync(EXEMPTIONS, JSON.stringify({
            note: 'Owner-scoped tables not cleared by one or both deletion cascades. Seeded from the state on '
                + '2026-08-10 so the gate can only ratchet down. A deleted username is released for reuse '
                + '(decision 2026-08-10), so anything left here is inheritable by the next registrant.',
            exempt,
        } as ExemptionFile, null, 2) + '\n');
        console.log(`Seeded ${missing.length} exemptions into ${relative(ROOT, EXEMPTIONS)}`);
        return;
    }

    const exempt = existsSync(EXEMPTIONS)
        ? (JSON.parse(readFileSync(EXEMPTIONS, 'utf-8')) as ExemptionFile).exempt
        : {};
    const fresh = missing.filter(t => !exempt[t.table]);

    console.log('');
    console.log('  Storage parity — owner-scoped tables vs the deletion cascades');
    console.log('  ' + '─'.repeat(62));
    console.log(`  owner-scoped tables      ${String(tables.size).padStart(4)}`);
    console.log(`  not cleared somewhere    ${String(missing.length).padStart(4)}`);
    console.log(`  NEW, not exempt          ${String(fresh.length).padStart(4)}`);
    console.log('');

    if (fresh.length) {
        for (const t of fresh) console.log(`    ${t.table.padEnd(28)} ${t.columns.join('/').padEnd(22)} missing in ${t.where}`);
        console.log('');
        console.log('  A deleted username is released for reuse, so a surviving owner-scoped row is');
        console.log('  inheritable by whoever registers that name next. Add the table to the cascade,');
        console.log('  or record in security/storage-parity-exemptions.json why it must outlive its owner.');
        console.log('');
    }

    if (strict && fresh.length) {
        console.error(`✖ ${fresh.length} owner-scoped table(s) newly outside a deletion cascade.`);
        process.exit(1);
    }
    console.log(fresh.length ? '  (report only — pass --strict to gate)' : '  ✓ no new owner-scoped tables outside the cascades');
}

main();
