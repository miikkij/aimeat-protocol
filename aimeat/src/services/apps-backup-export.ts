/**
 * @file apps-backup-export.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Export the owner's whole app catalog as one ZIP: EVERY published
 *   app with EVERY stored version (the version history is part of the property),
 *   plus the owner's installed cortex extensions (manifest + lib files). Mirrors
 *   the organism/workspace export-bundle conventions (archiver, versioned
 *   manifest, folder-per-item layout). The backup contains content + metadata
 *   only — never access codes, tokens or keys.
 * @structure APPS_BACKUP_VERSION; exportAppsBackup(storage, config, opts)
 * @usage import { exportAppsBackup } from '../services/apps-backup-export.js';
 * @version-history
 *   v1.0.0 — 2026-06-12 — Initial: owner app-catalog backup (apps + versions + extensions)
 *   v1.0.1 — 2026-06-13 — archiver v8: archiver('zip') -> new ZipArchive()
 */
import { ZipArchive } from 'archiver';
import type { Storage, AppRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';

export const APPS_BACKUP_VERSION = '1.0';

/** Folder/entry name segments must be plain — anything else is skipped, not mangled. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function versionFileName(v: AppRecord): string {
  return `v${v.versionNumber}.${v.mimeType.startsWith('text/html') ? 'html' : 'bin'}`;
}

export interface AppsBackupResult {
  /** Full ZIP when no sink was given; empty Buffer when streamed to a sink. */
  buffer: Buffer;
  filename: string;
  apps: number;
  versions: number;
  extensions: number;
}

/**
 * Builds the backup ZIP. When `sink` is given (e.g. the HTTP response) the
 * archive is streamed into it as it is built — backups can be large; otherwise
 * the full ZIP is returned as a Buffer.
 */
export async function exportAppsBackup(
  storage: Storage,
  config: AimeatConfig,
  opts: { owner: string; ownerGhii: string; exportedAt: string },
  sink?: NodeJS.WritableStream,
): Promise<AppsBackupResult> {
  const { owner, ownerGhii, exportedAt } = opts;

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on('error', reject);
    if (sink) {
      sink.on('error', reject);
      archive.on('end', () => resolve(Buffer.alloc(0)));
      archive.pipe(sink);
    } else {
      archive.on('data', (c: Buffer) => chunks.push(c));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
    }
  });

  const manifest: Record<string, unknown> = {
    aimeatAppsBackup: APPS_BACKUP_VERSION,
    exportedAt,
    source: { nodeId: config.nodeId, owner },
    apps: [] as Array<{ filename: string; name: string; folder: string; versions: number[] }>,
    extensions: [] as Array<{ name: string; folder: string }>,
  };

  // Subdomain mappings are included as informational metadata only (they are an
  // operator-managed resource; restore never recreates them).
  const subdomainByTarget = new Map<string, { subdomain: string; enabled: boolean }>();
  for (const s of await storage.listSubdomainSites()) {
    if (s.kind === 'app') subdomainByTarget.set(s.target, { subdomain: s.subdomain, enabled: s.enabled });
  }

  // ── Apps: every app in the owner's canonical bucket, every version ──
  let appCount = 0;
  let versionCount = 0;
  const { apps } = await storage.listApps({ ownerGaii: ownerGhii, limit: 100000 });
  for (const latest of apps) {
    if (!SAFE_SEGMENT.test(latest.filename)) continue; // publish validation makes this unreachable
    const versions = (await storage.listAppVersions(ownerGhii, latest.filename))
      .sort((a, b) => a.versionNumber - b.versionNumber);
    if (versions.length === 0) continue;

    const folder = `apps/${latest.filename}`;
    const versionMeta: Array<Record<string, unknown>> = [];
    for (const v of versions) {
      const file = versionFileName(v);
      // Prisma (Mongo/Postgres) returns Bytes columns as Uint8Array; archiver
      // accepts only Buffer/string/stream.
      const data = Buffer.isBuffer(v.data) ? v.data : Buffer.from(v.data);
      archive.append(data, { name: `${folder}/versions/${file}` });
      versionMeta.push({
        version: v.versionNumber,
        file: `versions/${file}`,
        mimeType: v.mimeType,
        size: v.size,
        createdAt: v.createdAt,
        manifest: v.manifest,
      });
      versionCount++;
    }

    const appJson = {
      filename: latest.filename,
      name: latest.manifest.name,
      mimeType: latest.mimeType,
      downloads: await storage.getAppDownloads(ownerGhii, latest.filename),
      protected: !!latest.accessCode,                       // flag only — the code itself is never exported
      subdomain: subdomainByTarget.get(`${owner}/${latest.filename}`) ?? null,
      versions: versionMeta,
    };
    archive.append(JSON.stringify(appJson, null, 2), { name: `${folder}/app.json` });
    (manifest.apps as Array<Record<string, unknown>>).push({
      filename: latest.filename,
      name: latest.manifest.name,
      folder,
      versions: versions.map(v => v.versionNumber),
    });
    appCount++;
  }

  // ── Cortex extensions installed by this owner ──
  let extCount = 0;
  const exts = await storage.listCortexExtensions({ installedBy: owner });
  for (const ext of exts) {
    if (!SAFE_SEGMENT.test(ext.name)) continue;
    const folder = `extensions/${ext.name}`;
    archive.append(JSON.stringify(ext, null, 2), { name: `${folder}/ext.json` });
    archive.append(ext.manifest ?? '', { name: `${folder}/manifest.yaml` });
    const libNames = ext.activationArtifacts?.libFiles ?? [];
    for (const lib of libNames) {
      if (!SAFE_SEGMENT.test(lib)) continue;
      const content = await storage.getCortexLibFile(ext.name, lib);
      if (content !== null) archive.append(content, { name: `${folder}/libs/${lib}` });
    }
    (manifest.extensions as Array<Record<string, unknown>>).push({ name: ext.name, folder });
    extCount++;
  }

  archive.append(JSON.stringify(manifest, null, 2), { name: 'backup-manifest.json' });
  archive.finalize();
  const buffer = await done;

  const date = exportedAt.slice(0, 10);
  const safeOwner = owner.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'owner';
  return {
    buffer,
    filename: `aimeat-apps-${safeOwner}-${date}.zip`,
    apps: appCount,
    versions: versionCount,
    extensions: extCount,
  };
}
