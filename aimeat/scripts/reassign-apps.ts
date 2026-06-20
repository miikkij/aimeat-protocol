/**
 * @file reassign-apps.ts
 * @description One-off operator migration: reassign published apps from one owner
 *   (default "anonymous") to another real owner. Moves EVERY version row, the
 *   screenshot, the download counter, and any subdomain mapping, then deletes the
 *   source rows. Needed because apps published anonymously (or by an anonymous
 *   agent) are owned by "anonymous", so the H-2 silent SSO correctly declines to
 *   hand the signed-in user a token for an app they do not own — moving ownership
 *   to the user makes their own apps auto-log-in like any owned app.
 * @structure parse args → createStorage → for each source app: collision-guard,
 *   copy versions/screenshot/downloads to the target bucket, delete source,
 *   re-point subdomain mappings. Dry-run by default; pass --apply to execute.
 * @usage cd aimeat && pnpm exec node --import tsx scripts/reassign-apps.ts \
 *          --to happydude500001 [--from anonymous] [--filename graph.html] \
 *          --db mongodb --db-url "$DATABASE_URL" [--apply]
 *        AIMEAT_NODE_ID must match the node (e.g. aimeat-finland-001-genesis) so the
 *        target app bucket key resolves correctly when the owner is not yet in the
 *        identity table (a registered owner resolves regardless).
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial (move anonymous-owned apps to a real owner for H-2 SSO).
 */
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import { resolveGhii } from '../src/utils/ghii-resolver.js';

function arg(name: string, def = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

const FROM = arg('from', 'anonymous');
const TO = arg('to');
const ONLY = arg('filename');
const APPLY = flag('apply');
const provider = (arg('db', process.env.AIMEAT_STORAGE || 'sqlite')) as StorageProvider;
const nodeId = process.env.AIMEAT_NODE_ID || 'aimeat-local-001-dev';

async function main(): Promise<void> {
  if (!TO) { console.error('ERROR: --to <ownerName> is required'); process.exit(1); }
  if (TO === FROM) { console.error('ERROR: --to must differ from --from'); process.exit(1); }

  const storage = await createStorage({
    provider,
    sqlitePath: arg('db-path', './data/aimeat.db'),
    dbUrl: arg('db-url', process.env.DATABASE_URL),
  });

  const toGhii = await resolveGhii(storage, TO, `${TO}@${nodeId}`);
  console.log(`\nReassign apps:  "${FROM}"  →  "${TO}"  (target bucket: ${toGhii})`);
  console.log(`Mode: ${APPLY ? '\x1b[31mAPPLY\x1b[0m' : 'DRY-RUN'}${ONLY ? `  (only ${ONLY})` : ''}\n`);

  // Latest row per (ownerGaii, filename); we expand to all versions below.
  const { apps } = await storage.listApps({ limit: 100000, offset: 0 });
  const src = apps.filter((a) => a.ownerName === FROM && (!ONLY || a.filename === ONLY));
  if (!src.length) { console.log(`No apps owned by "${FROM}"${ONLY ? ` matching ${ONLY}` : ''}.`); process.exit(0); }

  let moved = 0, skipped = 0;
  for (const a of src) {
    const fromGaii = a.ownerGaii;
    console.log(`• ${a.filename}  (source bucket ${fromGaii})`);

    const clash = await storage.getApp(toGhii, a.filename);
    if (clash) { console.log('  SKIP — target already has this filename (version collision)\n'); skipped++; continue; }

    const versions = await storage.listAppVersions(fromGaii, a.filename);
    const downloads = await storage.getAppDownloads(fromGaii, a.filename).catch(() => 0);
    const shot = await storage.getStorageFile(fromGaii, `apps/screenshots/${a.filename}`).catch(() => null);
    const subs = (await storage.listSubdomainSites()).filter((s) => s.kind === 'app' && s.target === `${FROM}/${a.filename}`);
    console.log(`  ${versions.length} version(s) · screenshot:${shot ? 'yes' : 'no'} · downloads:${downloads} · subdomain(s):${subs.map((s) => s.subdomain).join(',') || 'none'}`);

    if (!APPLY) { console.log('  (dry-run — nothing written)\n'); continue; }

    for (const v of versions) await storage.createApp({ ...v, ownerGaii: toGhii, ownerName: TO });
    if (shot) { await storage.createStorageFile({ ...shot, ownerGaii: toGhii }); await storage.deleteStorageFile(fromGaii, shot.key); }
    for (let i = 0; i < downloads; i++) await storage.incrementAppDownloads(toGhii, a.filename);
    await storage.deleteApp(fromGaii, a.filename);
    const now = new Date().toISOString();
    for (const s of subs) await storage.updateSubdomainSite(s.subdomain, { target: `${TO}/${a.filename}`, updatedAt: now });
    console.log('  \x1b[32m✓ moved\x1b[0m\n');
    moved++;
  }

  console.log(APPLY
    ? `Done. Moved ${moved}, skipped ${skipped}.`
    : `Dry-run complete: ${src.length} app(s) would move. Re-run with --apply to execute.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
