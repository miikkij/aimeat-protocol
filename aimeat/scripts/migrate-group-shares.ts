/**
 * @file scripts/migrate-group-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Turn every `visibility:'group'` memory record into a key-space share.
 *
 *   WHY THIS IS A SCRIPT AND NOT A BOOT STEP. It creates access rights, and access rights should not
 *   appear because a process restarted. Nothing is broken while it has not been run: records bound
 *   the old way keep being read the old way, so this is a move between two working mechanisms rather
 *   than a repair. Run it once the production numbers are known (how many group-visible records,
 *   how many groups), which is the count that decides whether the result is ten shares or ten
 *   thousand.
 *
 *   WHAT IT DOES NOT DO. It never widens anything: one record becomes one share whose pattern is
 *   that record's EXACT key, for the group the record already named. Nobody who could not read a
 *   record before can read it after. Widening a per-key share into a `space.**` pattern afterwards
 *   is an owner's decision, made in the interface, not something a migration should guess.
 *
 *   Records whose group no longer exists are reported and skipped: they have been unreadable by
 *   everyone since the group went, and inventing an audience for them is not a migration.
 * @usage
 *   cd aimeat && pnpm exec node --import tsx scripts/migrate-group-shares.ts --db sqlite --db-path ./data/aimeat.db
 *   cd aimeat && pnpm exec node --import tsx scripts/migrate-group-shares.ts --db postgres-kysely --db-url "$DATABASE_URL"
 *   Add --apply to write. Without it the script only reports what it would do.
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, alongside the key-space share table.
 */
import { randomUUID } from 'node:crypto';
import { createStorage } from '../src/storage/storage-factory.js';
import type { GroupShareRecord } from '../src/storage/interface.js';

function arg(name: string): string | undefined {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return process.argv[process.argv.indexOf(hit) + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const provider = arg('db') ?? 'sqlite';
  const storage = await createStorage({
    provider: provider as 'sqlite' | 'postgres-kysely',
    sqlitePath: arg('db-path'),
    dbUrl: arg('db-url'),
  });

  const all = await storage.listAllMemory({ visibility: 'group', limit: 100_000, offset: 0 });
  console.log(`Group-visible records: ${all.items.length}`);

  let created = 0, alreadyCovered = 0, orphaned = 0, unbound = 0;
  const groupCache = new Map<string, boolean>();

  for (const record of all.items) {
    const groupId = record.groupId;
    if (!groupId) {
      // A record marked `group` that never carried an id. Before 2026-08-11 this was the normal
      // outcome on SQLite (the column was never written) and on any record shared after creation.
      unbound++;
      continue;
    }
    if (!groupCache.has(groupId)) groupCache.set(groupId, !!(await storage.getSharingGroup(groupId)));
    if (!groupCache.get(groupId)) { orphaned++; continue; }

    const existing = await storage.listGroupSharesByGroups([groupId]);
    if (existing.some(s => s.ownerGaii === record.ownerGaii && s.keyPattern === record.key)) {
      alreadyCovered++;
      continue;
    }
    const share: GroupShareRecord = {
      id: randomUUID(),
      groupId,
      ownerGaii: record.ownerGaii,
      keyPattern: record.key,          // EXACT key. Never a widened pattern — see the header.
      note: 'migrated from visibility:group',
      createdAt: new Date().toISOString(),
      createdBy: record.ownerGaii,
    };
    if (apply) await storage.createGroupShare(share);
    created++;
  }

  console.log(`  shares ${apply ? 'created' : 'that WOULD be created'}: ${created}`);
  console.log(`  already covered by an identical share: ${alreadyCovered}`);
  console.log(`  skipped, group no longer exists:       ${orphaned}`);
  console.log(`  skipped, no group id on the record:    ${unbound}`);
  if (!apply) console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
