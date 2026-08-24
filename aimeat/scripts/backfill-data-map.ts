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
 *   v1.2.0 — 2026-08-25 — It reads the NODE'S OWN configuration, applying the database overrides
 *     the server applies at boot. Without that step a script runs on the shipped defaults, and the
 *     production apply refused all 146 writes with "Memory key limit reached (1000)" for an owner
 *     already holding 6,152 keys — proof enough on its own that 1000 was never the real ceiling. The
 *     same skip is what put the wrong node id on every lookup in v1.0.0. One missing step, two
 *     different failures, both of which read as a finding about the node.
 *     Also: the ceiling in force is printed in the report, and a run refuses up front when there is
 *     not enough room for one key per app — 146 identical refusals bury their own message.
 *   v1.1.0 — 2026-08-25 — Three fixes, all found by the first production run, which reported 113
 *     apps as storing nothing and would have written 113 empty maps as a success.
 *       - The owner identity comes from the RECORD (app.ownerGaii), not from `${ownerName}@${config
 *         .nodeId}`. The script's own node id went on the front, every keyed lookup missed, no app's
 *         bytes were read, and so no app had any scope words to derive from. The listing and the
 *         lookup can no longer disagree, because they now use the same string.
 *       - adminView, so PARKED and operator-hidden apps are included. A parked app still stores what
 *         it stores. Without it the run silently covered 137 of 169 apps and called itself complete.
 *       - It refuses to write when the first app's bytes cannot be read, and warns when the owners
 *         hold zero memory keys. The first is unambiguous; the second is normal on a new node, which
 *         is why it warns rather than refusing.
 *     The refusal is defence in depth and I could not make it fire after the identity fix, because
 *     that fix closes the only path I know of. What IS verified is the answer: the same database that
 *     produced "every app stores nothing" now reports 3 of 4 asking to store something.
 *   v1.0.0 — 2026-08-24 — Initial, for TARGET-073.
 */
import { createStorage } from '../src/storage/storage-factory.js';
import { loadConfig, applyConfigOverrides } from '../src/config.js';
import { ConfigProvenance } from '../src/services/config-provenance.js';
import { ALL_CONFIG_MAP } from '../src/services/config-schema.js';
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

  // THE NODE'S OWN SETTINGS, not this script's compiled-in defaults. A node keeps its configuration
  // in the database and applies it at boot (server-bootstrap/config-init.ts); a script that skips
  // that step runs against the shipped defaults instead. On production that meant a key ceiling of
  // 1000 while the node runs a far higher one, and every one of 146 writes was refused with
  // "Memory key limit reached (1000)" — for an owner already holding 6,152 keys, which is proof
  // enough on its own that 1000 was never the real ceiling. The same skip is what put the wrong node
  // id on every lookup in the run before that. One step, two classes of failure.
  const provenance = new ConfigProvenance();
  provenance.initDefaults(Object.keys(ALL_CONFIG_MAP));
  const overrides = await applyConfigOverrides(config, storage, provenance);
  if (overrides.applied.length > 0) {
    console.log(`  read ${overrides.applied.length} setting(s) from this node's own configuration`);
  }
  const at = new Date().toISOString();

  // adminView, because a PARKED app still stores what it stores. Without it listApps hides parked
  // and operator-hidden apps from anyone who is not their owner, and a script has no viewer — on
  // production that silently dropped 32 of 169 apps from a run that reported itself complete.
  const page = 200;
  const apps: Awaited<ReturnType<typeof storage.listApps>>['apps'] = [];
  for (let offset = 0; ; offset += page) {
    const chunk = await storage.listApps({ limit: page, offset, adminView: true });
    apps.push(...chunk.apps);
    if (apps.length >= chunk.total || chunk.apps.length === 0) break;
  }
  const targets = apps.filter(a => !onlyOwner || a.ownerName === onlyOwner);

  console.log(`\n  Data map backfill — ${provider}${apply ? '' : '  (REPORT ONLY, pass --apply to write)'}`);
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log(`  apps on this node          ${apps.length}`);
  console.log(`  in scope                   ${targets.length}${onlyOwner ? `  (owner ${onlyOwner})` : ''}`);
  console.log(`  key ceiling in force       ${config.memoryMaxKeysPerAgent}   (one map is one key per app)`);

  // PREFLIGHT. Every app storing nothing is possible; every app storing nothing while most of them
  // ask for memory scopes is a broken read, and the difference is worth refusing to write over.
  // Measured on production 2026-08-24: 84 of 168 apps declare aimeat-scopes, 73 of them memory:write.
  let refuseToWrite = false;

  const byCode = new Map<string, number>();
  let declared = 0, derived = 0, storesNothing = 0, alreadyHad = 0, written = 0, failed = 0, unreadable = 0, askedForSomething = 0;

  // A first pass that only READS, so the refusal is decided before a single write happens. Two
  // symptoms mean the lookups are missing rather than the apps being empty: bytes that will not load
  // at all, and an owner whose whole key store reads as zero.
  const probeKeys = await storage.countMemory([...new Set(targets.map(a => a.ownerGaii))]);
  const probeBytes = targets.length > 0 ? await storage.getApp(targets[0].ownerGaii, targets[0].filename) : null;
  // Bytes that will not load is UNAMBIGUOUS: the app row is there in the listing and the lookup for
  // the same app misses, so the identity is wrong and every map would come out empty.
  if (targets.length > 0 && !probeBytes) {
    refuseToWrite = true;
    console.log('');
    console.log('  REFUSING TO WRITE. The bytes of the first app in scope could not be read, so the');
    console.log('  identity these lookups use is wrong. Every map would come out empty, and every one');
    console.log('  would be a lie about a real app.');
  }
  // Zero memory keys only WARNS. On a live account it is the same tell, but a fresh node with one
  // app and nothing stored yet is a legitimate state, and refusing there would be wrong.
  if (targets.length > 0 && probeKeys === 0) {
    console.log('');
    console.log('  Note: these owners hold 0 memory keys. On a new node that is normal. On an account');
    console.log('  that has been in use it means the identity is wrong — check before applying.');
  }

  // HEADROOM, checked once instead of discovered 146 times. One map is one key, so a run needs as
  // many free keys as it has apps in scope. Learning that from 146 identical refusals is how the
  // real message gets buried in its own repetition.
  const needed = targets.length;
  const ceiling = config.memoryMaxKeysPerAgent;
  if (needed > 0 && probeKeys + needed > ceiling) {
    refuseToWrite = true;
    console.log('');
    console.log('  REFUSING TO WRITE. There is not enough room under the key ceiling:');
    console.log(`    these owners hold ${probeKeys} keys, the ceiling in force is ${ceiling},`);
    console.log(`    and ${needed} more are needed — one per app.`);
    console.log('    If this node runs a higher ceiling than the number above, this script is not');
    console.log("    reading the node's own configuration, and that is the thing to fix.");
  }

  for (const app of targets) {
    const appId = app.filename.replace(/\.html$/i, '');
    // The identity from the RECORD, never one composed from config. Composing it put the script's
    // own node id on the front, and when that differed from the stored one — which is exactly what
    // happened the first time this ran on production — every lookup missed, every app read as
    // storing nothing, and the run reported 113 empty maps as a success.
    const ownerGhii = app.ownerGaii;
    const existing = await readAppDataMap(storage, ownerGhii, appId);
    if (existing) { alreadyHad++; continue; }

    const full = await storage.getApp(ownerGhii, app.filename);
    if (!full) { unreadable++; console.log(`    ? ${app.ownerName}/${app.filename}: its bytes could not be read`); continue; }
    const html = /html/i.test(full.mimeType) ? full.data.toString('utf8') : '';
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
    if (scopes.some(s => s.startsWith('memory:') || s.startsWith('storage:') || s.startsWith('organism:'))) askedForSomething++;
    if (lint.map.held.length === 0) storesNothing++;
    if (lint.map.gap) byCode.set(lint.map.gap.code, (byCode.get(lint.map.gap.code) ?? 0) + 1);

    if (!apply) continue;
    if (refuseToWrite) continue;
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
  if (unreadable > 0) console.log(`  BYTES UNREADABLE           ${unreadable}   <- a lookup missed; nothing was derived for these`);
  console.log(`  the app stated its own     ${declared}`);
  console.log(`  worked out by the node     ${derived}`);
  console.log(`  asks to store something    ${askedForSomething}`);
  console.log(`  stores nothing at all      ${storesNothing}`);
  if (askedForSomething > 0 && storesNothing >= targets.length - alreadyHad) {
    refuseToWrite = true;
    console.log('    ^ every app came out empty while some of them ask for memory or storage.');
    console.log('      That is a broken read, not a node full of static apps.');
  }
  if (apply) console.log(`  written                    ${written}${failed ? `   (${failed} failed)` : ''}`);
  console.log('\n  what each one would be told:');
  for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${code}`);
  }

  // The sizing the write tally's table was gated on, printed where somebody deciding will see it.
  const memoryKeys = await storage.countMemory([...new Set(targets.map(a => a.ownerGaii))]);
  console.log('\n  the write tally, for scale:');
  console.log(`    memory keys held by these owners   ${memoryKeys}`);
  console.log('    the tally starts EMPTY and gains one row per (key, principal) pair as things are');
  console.log('    written from now on. Nothing seeds it: the writer was never recorded before it existed.');

  if (refuseToWrite) {
    console.log('');
    console.log('  Nothing was written, on purpose. Fix the reads and run the report again.');
    process.exit(2);
  }
  if (!apply) console.log('\n  Nothing was written. Re-run with --apply.\n');
  else console.log(`\n  ${written} map(s) written. Each one says of itself that nobody has checked it.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
