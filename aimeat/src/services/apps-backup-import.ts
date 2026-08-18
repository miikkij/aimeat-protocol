/**
 * @file apps-backup-import.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Parse, inspect and selectively restore an app-catalog backup ZIP
 *   (produced by apps-backup-export). Two-phase UX mirrors the organism import:
 *   parse/inspect first WITHOUT writing anything, then restore only the selected
 *   apps/versions with an explicit per-app conflict mode — skip (default),
 *   append-versions, or import-as-copy. NOTHING is ever silently overwritten.
 *   Restore always writes into the CALLER's ownership; the manifest's owner may
 *   differ (node-to-node transfer is a use case). All ZIP parsing goes through
 *   safeUnzip (zip-slip / zip-bomb / format-allowlist hardening).
 * @structure parseAppsBackup; inspectAppsBackup; restoreAppsBackup; types
 * @usage import { parseAppsBackup, restoreAppsBackup } from '../services/apps-backup-import.js';
 * @version-history
 *   v1.0.0 — 2026-06-12 — Initial: selective app-catalog restore with conflict modes
 */
import type { Storage, AppManifest, CortexExtensionRecord } from '../storage/interface.js';
import { safeUnzip, BACKUP_ZIP_LIMITS, type SafeZipLimits } from './safe-zip.js';
import { APPS_BACKUP_VERSION } from './apps-backup-export.js';

const APP_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Format allowlist — any entry outside this layout rejects the whole ZIP. */
function allowName(name: string): boolean {
  return name === 'backup-manifest.json'
    || /^apps\/[A-Za-z0-9][A-Za-z0-9._-]*\/app\.json$/.test(name)
    || /^apps\/[A-Za-z0-9][A-Za-z0-9._-]*\/versions\/v\d+\.(html|bin)$/.test(name)
    || /^extensions\/[A-Za-z0-9][A-Za-z0-9._-]*\/ext\.json$/.test(name)
    || /^extensions\/[A-Za-z0-9][A-Za-z0-9._-]*\/manifest\.yaml$/.test(name)
    || /^extensions\/[A-Za-z0-9][A-Za-z0-9._-]*\/libs\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

export const APPS_BACKUP_ZIP_LIMITS: SafeZipLimits = { ...BACKUP_ZIP_LIMITS, allowName };

export interface ParsedBackupVersion {
  version: number;
  mimeType: string;
  size: number;
  createdAt: string;
  manifest: AppManifest;
  data: Buffer;
}

export interface ParsedBackupApp {
  filename: string;
  name: string;
  versions: ParsedBackupVersion[];   // ascending by version number
}

export interface ParsedBackupExtension {
  record: CortexExtensionRecord;
  libs: Map<string, string>;          // libName → content
}

export interface ParsedAppsBackup {
  source: { nodeId: string; owner: string };
  exportedAt: string;
  apps: ParsedBackupApp[];
  extensions: ParsedBackupExtension[];
}

/** Unzip + validate the backup. Throws ZipSecurityError / Error — writes nothing. */
export async function parseAppsBackup(zip: Buffer): Promise<ParsedAppsBackup> {
  const files = await safeUnzip(zip, APPS_BACKUP_ZIP_LIMITS);

  const manifestBuf = files.get('backup-manifest.json');
  if (!manifestBuf) throw new Error('backup-manifest.json missing — not an AIMEAT apps backup');
  const manifest = JSON.parse(manifestBuf.toString('utf8')) as {
    aimeatAppsBackup?: string;
    exportedAt?: string;
    source?: { nodeId?: string; owner?: string };
    apps?: Array<{ filename?: string; folder?: string }>;
    extensions?: Array<{ name?: string; folder?: string }>;
  };
  if (manifest.aimeatAppsBackup !== APPS_BACKUP_VERSION) {
    throw new Error(`Unsupported backup format version (expected ${APPS_BACKUP_VERSION})`);
  }

  const apps: ParsedBackupApp[] = [];
  for (const entry of manifest.apps ?? []) {
    const filename = String(entry.filename ?? '');
    if (!APP_SEGMENT.test(filename)) throw new Error(`Invalid app filename in manifest: "${filename}"`);
    const folder = `apps/${filename}`;
    const appJsonBuf = files.get(`${folder}/app.json`);
    if (!appJsonBuf) throw new Error(`${folder}/app.json missing`);
    const appJson = JSON.parse(appJsonBuf.toString('utf8')) as {
      filename?: string; name?: string;
      versions?: Array<{ version?: number; file?: string; mimeType?: string; size?: number; createdAt?: string; manifest?: AppManifest }>;
    };

    const versions: ParsedBackupVersion[] = [];
    for (const v of appJson.versions ?? []) {
      const num = Number(v.version);
      if (!Number.isInteger(num) || num < 1) throw new Error(`Invalid version number in ${folder}/app.json`);
      const file = String(v.file ?? '');
      if (!/^versions\/v\d+\.(html|bin)$/.test(file)) throw new Error(`Invalid version file reference in ${folder}/app.json`);
      const data = files.get(`${folder}/${file}`);
      if (!data) throw new Error(`${folder}/${file} missing`);
      versions.push({
        version: num,
        mimeType: typeof v.mimeType === 'string' ? v.mimeType : 'text/html',
        size: data.length,
        createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date().toISOString(),
        manifest: (v.manifest && typeof v.manifest === 'object') ? v.manifest : { name: filename, description: '', version: '1.0.0', category: 'tool', tags: [], authorDisplay: '', usesCortex: [] },
        data,
      });
    }
    versions.sort((a, b) => a.version - b.version);
    if (new Set(versions.map(v => v.version)).size !== versions.length) {
      throw new Error(`Duplicate version numbers for app "${filename}"`);
    }
    apps.push({ filename, name: String(appJson.name ?? filename), versions });
  }

  const extensions: ParsedBackupExtension[] = [];
  for (const entry of manifest.extensions ?? []) {
    const name = String(entry.name ?? '');
    if (!APP_SEGMENT.test(name)) throw new Error(`Invalid extension name in manifest: "${name}"`);
    const folder = `extensions/${name}`;
    const extJsonBuf = files.get(`${folder}/ext.json`);
    if (!extJsonBuf) throw new Error(`${folder}/ext.json missing`);
    const record = JSON.parse(extJsonBuf.toString('utf8')) as CortexExtensionRecord;
    if (record.name !== name) throw new Error(`Extension name mismatch in ${folder}/ext.json`);
    const libs = new Map<string, string>();
    for (const [path, buf] of files) {
      const m = path.match(/^extensions\/([A-Za-z0-9][A-Za-z0-9._-]*)\/libs\/([A-Za-z0-9][A-Za-z0-9._-]*)$/);
      if (m && m[1] === name) libs.set(m[2], buf.toString('utf8'));
    }
    extensions.push({ record, libs });
  }

  return {
    source: { nodeId: String(manifest.source?.nodeId ?? ''), owner: String(manifest.source?.owner ?? '') },
    exportedAt: String(manifest.exportedAt ?? ''),
    apps,
    extensions,
  };
}

// ── Inspect ──────────────────────────────────────────────────────────

export interface BackupInspection {
  source: { nodeId: string; owner: string };
  exported_at: string;
  apps: Array<{
    filename: string;
    name: string;
    exists: boolean;                 // caller already has an app with this filename
    existing_versions: number;
    versions: Array<{ version: number; size: number; created_at: string; semver: string }>;
  }>;
  extensions: Array<{ name: string; exists: boolean }>;
  totals: { apps: number; versions: number; extensions: number };
}

/** Pure read — reports what the backup contains and what would conflict. */
export async function inspectAppsBackup(
  storage: Storage,
  ownerGhii: string,
  parsed: ParsedAppsBackup,
): Promise<BackupInspection> {
  const apps = [];
  let versionTotal = 0;
  for (const app of parsed.apps) {
    const latest = await storage.getLatestVersionNumber(ownerGhii, app.filename);
    versionTotal += app.versions.length;
    apps.push({
      filename: app.filename,
      name: app.name,
      exists: latest > 0,
      existing_versions: latest > 0 ? (await storage.listAppVersions(ownerGhii, app.filename)).length : 0,
      versions: app.versions.map(v => ({
        version: v.version, size: v.size, created_at: v.createdAt, semver: v.manifest.version,
      })),
    });
  }
  const extensions = [];
  for (const ext of parsed.extensions) {
    extensions.push({ name: ext.record.name, exists: !!(await storage.getCortexExtension(ext.record.name)) });
  }
  return {
    source: parsed.source,
    exported_at: parsed.exportedAt,
    apps,
    extensions,
    totals: { apps: parsed.apps.length, versions: versionTotal, extensions: parsed.extensions.length },
  };
}

// ── Restore ──────────────────────────────────────────────────────────

export type AppConflictMode = 'skip' | 'append' | 'copy';
export type ExtConflictMode = 'skip' | 'copy';

export interface AppSelection {
  filename: string;
  versions?: number[];               // default: all versions in the backup
  conflict?: AppConflictMode;        // default: skip
}

export interface ExtSelection {
  name: string;
  conflict?: ExtConflictMode;        // default: skip
}

export interface RestoreSummary {
  apps_created: string[];
  apps_appended: string[];
  apps_copied: Array<{ from: string; to: string }>;
  apps_skipped: string[];
  versions_restored: number;
  extensions_created: string[];
  extensions_copied: Array<{ from: string; to: string }>;
  extensions_skipped: string[];
  errors: Array<{ item: string; message: string }>;
}

/** "name.html" → "name-restored.html" (then -restored-2, -3, … until free). */
async function uniqueCopyFilename(storage: Storage, ownerGhii: string, filename: string): Promise<string> {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? `${base}-restored${ext}` : `${base}-restored-${i}${ext}`;
    if (await storage.getLatestVersionNumber(ownerGhii, candidate) === 0) return candidate;
  }
  throw new Error(`Could not find a free copy name for "${filename}"`);
}

async function uniqueCopyExtName(storage: Storage, name: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? `${name}-restored` : `${name}-restored-${i}`;
    if (!(await storage.getCortexExtension(candidate))) return candidate;
  }
  throw new Error(`Could not find a free copy name for extension "${name}"`);
}

/**
 * Restores the selected apps/extensions into the CALLER's account. Conflicts
 * are resolved per item with an explicit mode; the default is skip — an
 * existing app is never touched without an explicit choice.
 */
export async function restoreAppsBackup(
  storage: Storage,
  opts: {
    owner: string;
    ownerGhii: string;
    parsed: ParsedAppsBackup;
    selections: AppSelection[];
    extensions?: ExtSelection[];
  },
): Promise<RestoreSummary> {
  const { owner, ownerGhii, parsed, selections } = opts;
  const summary: RestoreSummary = {
    apps_created: [], apps_appended: [], apps_copied: [], apps_skipped: [],
    versions_restored: 0,
    extensions_created: [], extensions_copied: [], extensions_skipped: [],
    errors: [],
  };

  const byFilename = new Map(parsed.apps.map(a => [a.filename, a]));

  for (const sel of selections) {
    try {
      const app = byFilename.get(sel.filename);
      if (!app) { summary.errors.push({ item: sel.filename, message: 'Not present in the backup' }); continue; }

      let versions = app.versions;
      if (sel.versions && sel.versions.length > 0) {
        const wanted = new Set(sel.versions);
        versions = app.versions.filter(v => wanted.has(v.version));
        if (versions.length !== wanted.size) {
          summary.errors.push({ item: sel.filename, message: 'Selection references versions not present in the backup' });
          continue;
        }
      }
      if (versions.length === 0) { summary.apps_skipped.push(sel.filename); continue; }

      const writeVersions = async (filename: string, renumberFrom?: number) => {
        let next = renumberFrom ?? 0;
        for (const v of versions) {
          const versionNumber = renumberFrom !== undefined ? ++next : v.version;
          await storage.createApp({
            ownerGaii: ownerGhii,
            ownerName: owner,
            filename,
            versionNumber,
            // Ownership transfers to the caller; everything else is preserved.
            manifest: { ...v.manifest, authorDisplay: owner },
            mimeType: v.mimeType,
            size: v.data.length,
            data: v.data,
            createdAt: v.createdAt,
          });
          summary.versions_restored++;
        }
      };

      const latest = await storage.getLatestVersionNumber(ownerGhii, sel.filename);
      if (latest === 0) {
        await writeVersions(sel.filename);                 // free name — keep original numbering
        summary.apps_created.push(sel.filename);
        continue;
      }

      const mode: AppConflictMode = sel.conflict ?? 'skip';
      if (mode === 'skip') {
        summary.apps_skipped.push(sel.filename);
      } else if (mode === 'append') {
        await writeVersions(sel.filename, latest);          // backup versions stack on top
        summary.apps_appended.push(sel.filename);
      } else if (mode === 'copy') {
        const copyName = await uniqueCopyFilename(storage, ownerGhii, sel.filename);
        await writeVersions(copyName);                      // keep original numbering under the new name
        summary.apps_copied.push({ from: sel.filename, to: copyName });
      } else {
        summary.errors.push({ item: sel.filename, message: `Unknown conflict mode "${String(mode)}"` });
      }
    } catch (e) {
      summary.errors.push({ item: sel.filename, message: (e as Error).message });
    }
  }

  const extByName = new Map(parsed.extensions.map(x => [x.record.name, x]));
  for (const sel of opts.extensions ?? []) {
    try {
      const ext = extByName.get(sel.name);
      if (!ext) { summary.errors.push({ item: sel.name, message: 'Not present in the backup' }); continue; }

      const writeExt = async (name: string) => {
        const record: CortexExtensionRecord = {
          ...ext.record,
          name,
          installedBy: owner,
          // Restored inactive — activation re-derives artifacts in this node's context.
          status: 'inactive',
          activatedAt: undefined,
          installedAt: new Date().toISOString(),
          namespace: ext.record.namespace === parsed.source.owner ? owner : ext.record.namespace,
        };
        await storage.createCortexExtension(record);
        for (const [lib, content] of ext.libs) await storage.setCortexLibFile(name, lib, content);
      };

      const exists = !!(await storage.getCortexExtension(sel.name));
      if (!exists) {
        await writeExt(sel.name);
        summary.extensions_created.push(sel.name);
      } else if ((sel.conflict ?? 'skip') === 'copy') {
        const copyName = await uniqueCopyExtName(storage, sel.name);
        await writeExt(copyName);
        summary.extensions_copied.push({ from: sel.name, to: copyName });
      } else {
        summary.extensions_skipped.push(sel.name);
      }
    } catch (e) {
      summary.errors.push({ item: sel.name, message: (e as Error).message });
    }
  }

  return summary;
}
