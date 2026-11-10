/**
 * @file scripts/check-owner-agent-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds the number of direct `storage.getAgentsByOwner(...)` calls in src/services/ at
 *   its baseline, so an owner's agent list is read through loadOwnerAgents
 *   (src/services/db/owner-identity.ts), which reads it once per read scope and shares it.
 *
 *   WHY. A page's composite read the same owner's agent list from several services: twice in one
 *   GET /v1/overview, GET /v1/home/agents and GET /v1/memory/tab, and up to five times in a request
 *   before that (performance work 2026-11-09, architecture item 1). Each read is a round trip on
 *   PostgreSQL. A read through loadOwnerAgents inside runInReadScope costs one for the whole request;
 *   outside a scope it is the same direct read, so moving a call over never changes an answer.
 *   e2e-query-budget holds the other half: no request reads once per agent.
 *
 *   WHAT IT COUNTS. Every `.getAgentsByOwner(` in a .ts file under src/services/, owner-identity.ts
 *   (the one place that calls it on purpose) left out. It fails only when the count rises ABOVE the
 *   baseline. A count below it passes and prints the number to lower BASELINE to.
 *
 *   WHAT TO DO ON A REFUSAL. Call loadOwnerAgents(storage, owner) instead; when the caller is a
 *   composite, run it in runInReadScope (src/storage/read-scope/read-scope.ts) so its parts share the
 *   list. A write path that must see an agent it just created reads after the scope, not in it.
 * @structure BASELINE · directReads() · main()
 * @usage
 *   cd aimeat && pnpm check:owner-agent-reads
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (performance work, architecture item 1).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICES = path.join(ROOT, 'src', 'services');
const ALLOWED = path.join(SERVICES, 'db', 'owner-identity.ts');

/** The direct calls on 2026-11-10, after the overview, the Home agents band and the Memory page moved over. It may only fall. */
const BASELINE = 40;

/** Every direct call in src/services/, as `file:line`. */
function directReads(dir = SERVICES, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) { directReads(full, out); continue; }
    if (!name.endsWith('.ts') || full === ALLOWED) continue;
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      const n = line.split('.getAgentsByOwner(').length - 1;
      for (let k = 0; k < n; k++) out.push(`${path.relative(ROOT, full).replace(/\\/g, '/')}:${i + 1}`);
    });
  }
  return out;
}

function main(): void {
  const found = directReads();
  if (found.length > BASELINE) {
    console.error(`✗ src/services/ calls storage.getAgentsByOwner directly ${found.length} times, above the baseline of ${BASELINE}.`);
    console.error('  Read an owner\'s agents with loadOwnerAgents(storage, owner) from src/services/db/owner-identity.ts,');
    console.error('  inside runInReadScope when the caller composes several parts. The calls:');
    for (const f of found) console.error(`    ${f}`);
    process.exit(1);
  }
  if (found.length < BASELINE) {
    console.log(`✓ src/services/ calls storage.getAgentsByOwner directly ${found.length} times, below the baseline of ${BASELINE}: lower BASELINE in scripts/check-owner-agent-reads.ts to ${found.length}.`);
    return;
  }
  console.log(`✓ src/services/ calls storage.getAgentsByOwner directly ${found.length} times, at the baseline; new reads go through loadOwnerAgents.`);
}

main();
