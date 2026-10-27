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
 *   2026-10-27 — A restored version keeps only the intake forms the caller manages; each form left out
 *     is named in errors (secaudit2026oct26, restoredManifest:archive-intake-declaration-kept).
 *   2026-10-17 — A restored version keeps the app's access setting (who may open it), as it keeps the listing.
 *   v1.0.0 — 2026-06-12 — Initial: selective app-catalog restore with conflict modes
 *   v1.1.0 — 2026-09-28 — `append` onto an app a managed package install owns is refused per app
 *     (services/packages/install/package-managed.ts); `copy` still restores it beside the app.
 *   2026-10-16 — A restore applies the publish and install refusals it skipped (QA audit F10b-01): a new
 *     app counts against the per-owner app quota; an appended version carries the live app's access
 *     code, listing, forking, operator hide and search block, and its search settings, as a publish
 *     does; a new app keeps no operator's search approval from the ZIP. An extension is rebuilt from
 *     its manifest with parseCortexManifest, in a namespace the caller owns, under the cortex ceiling
 *     and the lib size limit, with every lib it declares present.
 */
import type { Storage, AppManifest, AppRecord, CortexExtensionRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { safeUnzip, BACKUP_ZIP_LIMITS, type SafeZipLimits } from './safe-zip.js';
import { APPS_BACKUP_VERSION } from './apps-backup-export.js';
import { managedChangeRefusal } from './packages/install/package-managed.js';
import { parseCortexManifest, validateNamespaceOwnership } from './cortex-manifest.js';
import { cortexInstallRefusal } from './install-quotas.js';
import { libsWithoutContent, missingLibsMessage } from './cortex-lifecycle.js';
import { managedIntakeForms } from './app-intake-forms.js';

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
 * The manifest a restored version is stored with. The author is the caller. The search settings are
 * the live app's when the version stacks on one, as a publish carries them (services/app-publish.ts);
 * a new app keeps the owner's own search switches from the ZIP but no operator's approval, which only
 * the operator's review sets (routes/admin-seo.ts).
 */
function restoredManifest(manifest: AppManifest, owner: string, live: AppRecord | null): AppManifest {
  const out: AppManifest = { ...manifest, authorDisplay: owner };
  if (live) {
    if (live.manifest?.seo) out.seo = live.manifest.seo;
    else delete out.seo;
  } else if (out.seo) {
    const ownersPart = { ...out.seo };
    delete ownersPart.approvedBy;
    delete ownersPart.approvedAt;
    out.seo = ownersPart;
  }
  return out;
}

/** The moderation and exposure columns a new version of `live` keeps, as a publish keeps them. */
function carriedState(live: AppRecord): Partial<AppRecord> {
  return {
    accessCode: live.accessCode,
    parked: !!live.parked,
    community: !!live.parked && !!live.community,
    access: live.access,
    forkable: !!live.forkable,
    operatorHidden: !!live.operatorHidden,
    operatorHiddenBy: live.operatorHiddenBy,
    operatorHiddenAt: live.operatorHiddenAt,
    operatorHideReason: live.operatorHideReason,
    operatorSeoBlocked: !!live.operatorSeoBlocked,
    operatorSeoBlockedBy: live.operatorSeoBlockedBy,
    operatorSeoBlockedAt: live.operatorSeoBlockedAt,
    operatorSeoBlockReason: live.operatorSeoBlockReason,
  };
}

/** The per-owner app quota a publish applies to a new app, as a sentence, or null. */
async function appQuotaRefusal(
  storage: Storage, ownerGhii: string, config: Pick<AimeatConfig, 'maxAppsPerAgent'>,
): Promise<string | null> {
  if (!(config.maxAppsPerAgent > 0)) return null;
  const { total } = await storage.listApps({ ownerGaii: ownerGhii, limit: 1 });
  return total >= config.maxAppsPerAgent
    ? `QUOTA_EXCEEDED: You have reached the maximum of ${config.maxAppsPerAgent} published apps. Delete an app you no longer need, then restore this one.`
    : null;
}

/**
 * The extension record a restore creates, built from the backup's manifest with the refusals
 * installCortex makes: the lib size limit, the cortex ceiling, a manifest that validates, a
 * namespace the caller owns (the backup's own owner name becomes the caller's), and every declared
 * lib present. Throws with the reason, which the restore reports per item.
 */
async function restoredExtension(
  storage: Storage,
  config: AimeatConfig,
  ext: ParsedBackupExtension,
  name: string,
  owner: string,
  sourceOwner: string,
  isOperator: boolean,
): Promise<CortexExtensionRecord> {
  const libs = Object.fromEntries(ext.libs);
  for (const [lib, content] of ext.libs) {
    if (Buffer.byteLength(content, 'utf8') / 1024 > config.cortexMaxLibSizeKb) {
      throw new Error(`QUOTA_EXCEEDED: The library "${lib}" is larger than this node allows (${config.cortexMaxLibSizeKb} KB).`);
    }
  }
  const ceiling = await cortexInstallRefusal({ storage, config }, true);
  if (ceiling) throw new Error(`${ceiling.code}: ${ceiling.message}`);

  const manifest = typeof ext.record.manifest === 'string' ? ext.record.manifest : '';
  const parsedManifest = parseCortexManifest(manifest, owner, ext.libs.size > 0 ? libs : undefined);
  if (!parsedManifest.ok || !parsedManifest.extension) {
    throw new Error(`INVALID_MANIFEST: The extension's manifest in the backup does not pass this node's checks: ${(parsedManifest.errors ?? []).join('; ')}`);
  }
  const fromManifest = parsedManifest.extension;
  const namespace = fromManifest.namespace === sourceOwner ? owner : fromManifest.namespace;
  if (!isOperator && !validateNamespaceOwnership(namespace, owner)) {
    throw new Error(`NAMESPACE_DENIED: The extension belongs to "${namespace}", which is not yours. Restore it under your own name "${owner}" or "community".`);
  }
  const missing = libsWithoutContent(fromManifest.components, libs);
  if (missing.length) throw new Error(`INVALID_MANIFEST: ${missingLibsMessage(missing)}`);

  return {
    ...fromManifest,
    name,
    namespace,
    installedBy: owner,
    // Restored inactive: activation derives its artifacts in this node's context.
    status: 'inactive',
    activatedAt: undefined,
    installedAt: new Date().toISOString(),
  };
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
    /** The app quota, the cortex ceiling and the lib size limit come from here. */
    config: AimeatConfig;
    /** The operator may restore an extension into any namespace, as installCortex lets them. */
    isOperator?: boolean;
  },
): Promise<RestoreSummary> {
  const { owner, ownerGhii, parsed, selections, config } = opts;
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

      // `live` is the app the versions stack on (append), whose moderation and exposure state they
      // carry as a publish carries it; a new app (free name, copy) starts with none of it.
      const writeVersions = async (filename: string, renumberFrom?: number, live?: AppRecord | null) => {
        let next = renumberFrom ?? 0;
        const named = new Set<string>();
        for (const v of versions) {
          const versionNumber = renumberFrom !== undefined ? ++next : v.version;
          // Ownership transfers to the caller; the operator-owned parts of the manifest do not.
          const manifest = restoredManifest(v.manifest, owner, live ?? null);
          // The archive's intake-form list keeps only the forms the caller manages, the rule a publish
          // applies; each one left out is named once, and the app is restored (secaudit2026oct26).
          if (manifest.intake !== undefined) {
            const { kept, dropped } = await managedIntakeForms(storage, owner, manifest.intake);
            if (kept.length) manifest.intake = kept; else delete manifest.intake;
            for (const d of dropped) {
              if (named.has(d.form)) continue;
              named.add(d.form);
              summary.errors.push({ item: sel.filename, message: `The intake form ${d.form} was left out of the restored app: ${d.why}` });
            }
          }
          await storage.createApp({
            ownerGaii: ownerGhii,
            ownerName: owner,
            filename,
            versionNumber,
            manifest,
            mimeType: v.mimeType,
            size: v.data.length,
            data: v.data,
            createdAt: v.createdAt,
            ...(live ? carriedState(live) : {}),
          });
          summary.versions_restored++;
        }
      };

      const latest = await storage.getLatestVersionNumber(ownerGhii, sel.filename);
      if (latest === 0) {
        const quota = await appQuotaRefusal(storage, ownerGhii, config);
        if (quota) { summary.errors.push({ item: sel.filename, message: quota }); continue; }
        await writeVersions(sel.filename);                 // free name — keep original numbering
        summary.apps_created.push(sel.filename);
        continue;
      }

      const mode: AppConflictMode = sel.conflict ?? 'skip';
      if (mode === 'skip') {
        summary.apps_skipped.push(sel.filename);
      } else if (mode === 'append') {
        // Stacking a backup on an app a managed package install owns would replace the package's
        // code (services/packages/install/package-managed.ts). `copy` restores it beside the app instead.
        const managed = await managedChangeRefusal(storage, owner, 'app', sel.filename, 'code');
        if (managed) { summary.errors.push({ item: sel.filename, message: `${managed.code}: ${managed.message}` }); continue; }
        await writeVersions(sel.filename, latest, await storage.getApp(ownerGhii, sel.filename));   // backup versions stack on top
        summary.apps_appended.push(sel.filename);
      } else if (mode === 'copy') {
        const quota = await appQuotaRefusal(storage, ownerGhii, config);
        if (quota) { summary.errors.push({ item: sel.filename, message: quota }); continue; }
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
        // The record is rebuilt from the manifest the ZIP carries, with the checks installCortex
        // makes, never taken from ext.json: a hand-made ext.json could name any namespace and any
        // components, and skip the ceiling and the lib size limit (QA audit F10b-01).
        const record = await restoredExtension(storage, config, ext, name, owner, parsed.source.owner, opts.isOperator === true);
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
