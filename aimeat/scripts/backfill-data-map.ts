/**
 * @file scripts/backfill-data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Give every app already on the node a data map, worked out from what the node can see.
 *
 *   WHY A SCRIPT AND NOT A BOOT STEP. It writes a document per app under the owner's identity, and a
 *   document should not appear because a process restarted. Nothing is broken while it has not run:
 *   an app without a map is stamped at its next publish anyway, so this only stops the base waiting
 *   for its authors to republish 169 apps.
 *
 *   IT WRITES BOTH THE DOCUMENT AND THE STAMP, and the second half was a correction. The plan said
 *   the stamp should wait for each app's next publish, on the reasoning that no manifest-mutation
 *   path exists outside publishApp. `storage.updateAppMeta` is exactly that path and has been there
 *   since June — it is what renaming an app uses. Left as planned, a backfilled map would have been
 *   invisible everywhere it is shown, because every listing reads the STAMP and none of them opens
 *   the document; 169 apps would have carried a map nobody could see until their authors happened to
 *   republish them. Verified in a browser, which is where it showed up.
 *
 *   WHAT A DERIVED MAP SAYS ABOUT ITSELF. `source: 'derived'`, every `why` empty, and the surfaces
 *   render that as a banner rather than a badge. An app that declares nothing still gets a map, and
 *   an app that stores nothing gets one that SAYS so — an absent map and an empty one read alike to
 *   a person, and only one of them is a finding.
 * @usage
 *   cd aimeat && pnpm exec node --import tsx scripts/backfill-data-map.ts --db sqlite --db-path ./data/aimeat.db
 *   cd aimeat && pnpm exec node --import tsx scripts/backfill-data-map.ts --db postgres-kysely --db-url "$DATABASE_URL"
 *   Add --apply to write. Without it it only reports. --owner <name> limits it to one account.
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial, for TARGET-073.
 */
import { createStorage } from '../src/storage/storage-factory.js';
import { loadConfig } from '../src/config.js';
import { parseAppScopes } from '../src/services/protected-resource.js';
import { parseDataMapMeta } from '../src/services/data-map/data-map-meta.js';
import { deriveDataMap } from '../src/services/data-map/data-map-derive.js';
import { readAppDataMap, writeAppDataMap, stampFor } from '../src/services/data-map/data-map-store.js';
import { lintDataMap } from '../src/services/data-map/data-map-lint.js';

function arg(name: string): string | undefined {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return process.argv[process.argv.indexOf(hit) + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const onlyOwner = arg('owner');
  const provider = (arg('db') ?? 'sqlite') as 'sqlite' | 'postgres-kysely';
  const storage = await createStorage({
    provider, sqlitePath: arg('db-path'), dbUrl: arg('db-url'),
  });
  const { config } = loadConfig();
  const at = new Date().toISOString();

  const { apps } = await storage.listApps({ limit: 1000, offset: 0 });
  // One row per (owner, filename): listApps already collapses to the latest version.
  const targets = apps.filter(a => !onlyOwner || a.ownerName === onlyOwner);

  console.log(`\n  Data map backfill — ${provider}${apply ? '' : '  (REPORT ONLY, pass --apply to write)'}`);
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log(`  apps on this node          ${apps.length}`);
  console.log(`  in scope                   ${targets.length}${onlyOwner ? `  (owner ${onlyOwner})` : ''}`);

  const byCode = new Map<string, number>();
  let declared = 0, derived = 0, storesNothing = 0, alreadyHad = 0, written = 0, failed = 0;

  for (const app of targets) {
    const appId = app.filename.replace(/\.html$/i, '');
    const ownerGhii = `${app.ownerName}@${config.nodeId}`;
    const existing = await readAppDataMap(storage, ownerGhii, appId);
    if (existing) { alreadyHad++; continue; }

    const full = await storage.getApp(ownerGhii, app.filename);
    const html = full && /html/i.test(full.mimeType) ? full.data.toString('utf8') : '';
    const scopes = html ? parseAppScopes(html) : [];
    const declaredMeta = html ? parseDataMapMeta(html) : null;

    const map = deriveDataMap({
      programKind: 'app', programId: appId, ownerName: app.ownerName, at,
      scopes, declaredMeta, declaredDoc: null, previous: null,
      manifest: { usesCortex: app.manifest.usesCortex ?? [] },
    });

    const lint = lintDataMap({
      map, scopes, programId: appId, at,
      declaresNothing: !declaredMeta,
    });

    if (declaredMeta) declared++; else derived++;
    if (lint.map.held.length === 0) storesNothing++;
    if (lint.map.gap) byCode.set(lint.map.gap.code, (byCode.get(lint.map.gap.code) ?? 0) + 1);

    if (!apply) continue;
    const res = await writeAppDataMap(
      { storage, config },
      { principal: ownerGhii, targetGaii: ownerGhii, roles: ['owner'], scopes: ['*'] },
      appId,
      lint.map,
    );
    if (!res.ok) { failed++; console.log(`    ✗ ${app.ownerName}/${app.filename}: ${res.message}`); continue; }
    // And the summary the listings actually read. Without this the map exists and nothing shows it.
    await storage.updateAppMeta(ownerGhii, app.filename, { dataMap: stampFor(lint.map, appId) });
    written++;
  }

  console.log(`  already had a map          ${alreadyHad}`);
  console.log(`  the app stated its own     ${declared}`);
  console.log(`  worked out by the node     ${derived}`);
  console.log(`  stores nothing at all      ${storesNothing}`);
  if (apply) console.log(`  written                    ${written}${failed ? `   (${failed} failed)` : ''}`);
  console.log('\n  what each one would be told:');
  for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${code}`);
  }

  // The sizing the write tally's table was gated on, printed where somebody deciding will see it.
  const memoryKeys = await storage.countMemory(
    [...new Set(targets.map(a => `${a.ownerName}@${config.nodeId}`))],
  );
  console.log('\n  the write tally, for scale:');
  console.log(`    memory keys held by these owners   ${memoryKeys}`);
  console.log('    the tally starts EMPTY and gains one row per (key, principal) pair as things are');
  console.log('    written from now on. Nothing seeds it: the writer was never recorded before it existed.');

  if (!apply) console.log('\n  Nothing was written. Re-run with --apply.\n');
  else console.log(`\n  ${written} map(s) written. Each one says of itself that nobody has checked it.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
