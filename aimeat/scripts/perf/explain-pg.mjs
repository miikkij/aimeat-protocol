/**
 * @file scripts/perf/explain-pg.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EXPLAIN (ANALYZE, BUFFERS) of the statements that cost the most time on the Home, the
 *   Memory page and the Data Wallet, run against the PostgreSQL sandbox after scripts/perf/
 *   seed-real-size.ts. The statements are the ones the query trace named (trace-preload.mjs), with
 *   the sandbox owner's identities filled in. Read only: EXPLAIN ANALYZE of a SELECT changes nothing.
 * @usage AIMEAT_SANDBOX_DB_URL=postgresql://… node scripts/perf/explain-pg.mjs
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial, for the performance measurement at real account size.
 */
import pg from 'pg';

const url = process.env.AIMEAT_SANDBOX_DB_URL;
if (!url) { console.error('AIMEAT_SANDBOX_DB_URL is not set'); process.exit(1); }
const client = new pg.Client({ connectionString: url, statement_timeout: 60_000 });
await client.connect();

const owner = 'sandbox@aimeat-local-001-dev';
const { rows: agentRows } = await client.query(`select "gaii" from "Agent" where "owner" = 'sandbox'`);
const ids = [owner, ...agentRows.map(r => r.gaii)];
const { rows: orgRows } = await client.query(`select "id" from "Organism" order by "createdAt" limit 1`);
const org = orgRows[0]?.id ?? '';
const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
const since7 = new Date(Date.now() - 7 * 864e5).toISOString();

const STATEMENTS = [
  ['wallet: every transaction, newest first (GET /v1/wallet)',
    `select * from "Transaction" where "gaii" = $1 order by "timestamp" desc, "id" desc limit 100000`, [owner]],
  ['memory meta for owner and agents (GET /v1/memory/tab, /v1/memory?include=meta)',
    `select "key","ownerGaii","visibility","byteSize","updatedAt","tags" from "Memory" where "ownerGaii" = any($1) and "deletedAt" is null and "archived" = false`, [ids]],
  ['memory values for owner and agents (GET /v1/memory)',
    `select * from "Memory" where "ownerGaii" = any($1) and "deletedAt" is null and "archived" = false`, [ids]],
  ['tagged records of the owner (readAgentTies, overview appPlaces)',
    `select * from "Memory" where "ownerGaii" = $1 and "deletedAt" is null and "archived" = false and "tags" @> $2`, [owner, ['datamap']]],
  ['consent trail, 30 days, all rows (GET /v1/data-wallet)',
    `select * from "ConsentAudit" where "ownerGaii" = $1 and "timestamp" >= $2 order by "timestamp" desc`, [owner, since30]],
  ['one organism\'s key activity, 7 days (overview workspaceActivity, once per organism)',
    `select "key","ownerGaii","updatedAt" from "Memory" where "updatedAt" >= $1 and "key" like $2 and "key" not like '%.version.%' and "deletedAt" is null and "archived" = false order by "updatedAt" desc, "key", "ownerGaii" limit 200`, [since7, `organism.${org}.%`]],
  ['memory count only (data-wallet total_memory_keys)',
    `select count(*) from "Memory" where "ownerGaii" = $1 and "deletedAt" is null and "archived" = false`, [owner]],
];

for (const [title, sql, params] of STATEMENTS) {
  const { rows } = await client.query(`explain (analyze, buffers, format text) ${sql}`, params);
  const plan = rows.map(r => r['QUERY PLAN']);
  console.log(`\n### ${title}`);
  for (const l of plan.filter(l => /Scan|Sort|Limit|Aggregate|Execution Time|Planning Time|Rows Removed|Buffers: shared/.test(l)).slice(0, 12)) console.log('  ' + l.trim());
}
const { rows: sz } = await client.query(`select relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) as size from pg_stat_user_tables where relname in ('Memory','Transaction','ConsentAudit','UsageCall','AgentTask','App','StorageFile') order by pg_total_relation_size(relid) desc`);
console.log('\n### table sizes'); for (const r of sz) console.log(`  ${r.relname.padEnd(14)} ${String(r.n_live_tup).padStart(8)} rows  ${r.size}`);
await client.end();
