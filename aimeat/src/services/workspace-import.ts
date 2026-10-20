/**
 * @file workspace-import.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Restore a workspace export ZIP as a NEW workspace in a target organism. Unzips with
 *   yauzl, remaps the organism/workspace ids in every key (record + document IDS ARE PRESERVED, so
 *   [[wiki-links]] and cross-references stay valid), re-locks the JSON schemas, re-creates the image
 *   binaries (DEDUPED — skipped if the target storage key already exists), rewrites image URLs in
 *   document markdown to the new keys, and registers the new workspace under the importer.
 *
 *   THE ARCHIVE IS UNTRUSTED INPUT. Whoever made the ZIP chose every key and every visibility in it,
 *   so the restore applies the same write rules the ordinary doors apply
 *   (services/workspace-import-gates.ts): a level this caller may not set here is narrowed and named
 *   in `clamped`, an image key that falls outside the new workspace root is not written and is named
 *   in `skipped`, and the image bytes go through services/storage-file-write.ts, which carries the
 *   key fence, the app-owned-key refusal and the file ceilings.
 * @structure importWorkspace(storage, config, { orgId, importerGaii, importerOwner, caller, zip }) -> result
 * @usage import { importWorkspace } from '../services/workspace-import.js';
 * @version-history
 *   2026-10-20 -- The restore applies the write rules the archive's values would otherwise skip
 *     (secaudit 2026-10, workspace-import:restore-skips-write-gates): the organism-membership
 *     audience rule, the closed node, the label's audience cap and the publish gate decide each
 *     item's level (`clamped`); an image key is confined to the new workspace root and stored
 *     through writeStorageFile, so the app-owned keys and the file ceilings hold (`skipped`); and
 *     the workspace share is restored through setWorkspaceShareOp, never written raw. Every caller
 *     passes `caller`, the session's own facts, because a gate a door can forget is not a gate.
 *   2026-10-19 -- The workspace registry entry is appended on the registry's version (updateRecord),
 *     not written from the copy read before (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *   2026-10-15 -- The rows of the row spaces are restored (`rows` in the result), held to the
 *     workspace and organism row quotas before anything is written; a bundle made before then
 *     carries none (feature-list audit #68).
 *   v1.1.0 -- 2026-09-13 -- A record in a space the bundle's manifest does not declare is not written
 *     and is named in `skipped_undeclared` (undeclaredSpaceRefusal decides, as on every write door).
 *   v1.0.0 -- 2026-06-09 -- Initial: ZIP import with id remap, schema re-lock, image dedup + URL rewrite.
 */
import type { Storage, StoredVisibility } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { WorkspaceExportJson, ExportObject, ExportImage } from './workspace-export.js';
import { WS_EXPORT_VERSION } from './workspace-export.js';
import { safeUnzip, BACKUP_ZIP_LIMITS } from './safe-zip.js';
import { logger } from '../utils/logger.js';
import { undeclaredSpaceRefusal, isPlatformWorkspaceNamespace, type WriteObjectType } from './workspace-write-items.js';
import { prepareRowRestore, writeRestoredRows } from './workspace-transfer-rows.js';
import { updateRecord } from './record-cas.js';
import { writeStorageFile } from './storage-file-write.js';
import { memoryTarget } from './classification/label-rows.js';
import { fileTarget } from './classification/labels.js';
import { setWorkspaceShareOp } from './workspace-share.js';
import {
  importCallerContext, outsideWorkspaceRoot, restoredLevel,
  type ImportCaller, type RestoreClamp, type RestoreSkip,
} from './workspace-import-gates.js';

export type { ImportCaller } from './workspace-import-gates.js';

/** An organism's workspace registry record, as stored. */
const registryOf = (v: unknown): { workspaces: unknown[] } => ({ workspaces: ((v as { workspaces?: unknown[] } | undefined)?.workspaces) ?? [] });

const STORAGE_URL_RE = /\/v1\/(?:storage|pub\/[^/)\s]+)\/([^\s)\]"'>]+)/g;

/** Allowed entry layout for a single-workspace ZIP — anything else is rejected as a bad format. */
const WORKSPACE_ALLOW = (n: string) => n === 'workspace.json' || /^images\/[A-Za-z0-9._-]+$/.test(n);

/** The workspace's own share record, which is restored through its service and never written raw. */
const SHARE_OBJECT = (o: ExportObject): boolean => o.namespace === 'meta' && o.id === 'share' && o.role === '';

export interface ImportResult {
  ws: string; objects: number; documents: number; images: number; images_deduped: number; schemas: number;
  /** Rows restored into the workspace's row spaces. */
  rows: number;
  /** Records the bundle carried in spaces its own manifest does not declare: not written, and named
   *  here, because a write into an undeclared space is refused on every door (2026-09-13). */
  skipped_undeclared?: Array<{ namespace: string; id: string; role: string }>;
  /** What the restore did not write at all: an image key outside the new workspace, or one a write
   *  door refuses (services/workspace-import-gates.ts). */
  skipped?: RestoreSkip[];
  /** What the restore stored at a narrower level than the archive named, and why. */
  clamped?: RestoreClamp[];
}

/** Safely unzip a backup ZIP into a filename → Buffer map (hardened: bomb/traversal/format guards).
 *  Pass the format allowlist for the layout you expect; throws ZipSecurityError on a hostile/malformed
 *  archive. Used by the workspace import and (with the organism allowlist) the bundle import. */
export async function unzipBuffer(zip: Buffer, allowName?: (n: string) => boolean): Promise<Map<string, Buffer>> {
  return safeUnzip(zip, { ...BACKUP_ZIP_LIMITS, allowName });
}

/** Import a single standalone workspace ZIP. */
export async function importWorkspace(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; importerGaii: string; importerOwner: string; caller: ImportCaller; zip: Buffer },
): Promise<ImportResult> {
  const files = await unzipBuffer(opts.zip, WORKSPACE_ALLOW);
  const jsonBuf = files.get('workspace.json');
  if (!jsonBuf) throw new Error('workspace.json missing from the ZIP');
  let data: WorkspaceExportJson;
  try { data = JSON.parse(jsonBuf.toString('utf8')); } catch { throw new Error('workspace.json is not valid JSON'); }
  return restoreWorkspace(storage, config, {
    orgId: opts.orgId, importerGaii: opts.importerGaii, importerOwner: opts.importerOwner,
    caller: opts.caller, data, images: files,
  });
}

/** Restore a workspace from already-parsed data + an image map (filename → bytes). The reusable core
 *  shared by the single-workspace import and the organism bundle import. */
export async function restoreWorkspace(
  storage: Storage,
  config: AimeatConfig,
  opts: {
    orgId: string; importerGaii: string; importerOwner: string; caller: ImportCaller;
    data: WorkspaceExportJson; images: Map<string, Buffer>;
  },
): Promise<ImportResult> {
  const { orgId, importerGaii, importerOwner, caller, data, images: imageFiles } = opts;
  if (!data || data.aimeatWorkspaceExport !== WS_EXPORT_VERSION || !data.manifest) {
    throw new Error('Unrecognised workspace export (wrong format/version)');
  }

  const newWs = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const oldRoot = `organism.${data.source.organismId}.w.${data.source.ws}`;
  const newRoot = `organism.${orgId}.w.${newWs}`;
  const now = new Date().toISOString();
  const WHERE = 'workspace import';

  /** What the archive asked for and did not get, named in the result rather than failing the restore. */
  const clamped: RestoreClamp[] = [];
  const skipped: RestoreSkip[] = [];

  // 0) The rows of the row spaces, built and held to the workspace and organism quotas BEFORE
  // anything is written, so a bundle that does not fit is refused with nothing half restored
  // (feature-list audit #68). A bundle made before 2026-10-15 carries no `rows`.
  const rowPlan = await prepareRowRestore({ storage, config }, { orgId, ws: newWs, manifest: data.manifest, rows: data.rows, importerIdentity: importerGaii });

  const writeMem = async (key: string, value: unknown, visibility: StoredVisibility = 'private') => {
    const prev = await storage.getMemory(importerGaii, key);
    await storage.setMemory({
      key, ownerGaii: importerGaii, value, visibility, tags: [], ttlHours: null,
      version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
  };

  // 1) Re-lock the schemas.
  let schemas = 0;
  for (const [ns, sc] of Object.entries(data.schemas || {})) {
    if (!sc || !sc.schema) continue;
    await storage.setSchema({
      keyPattern: `${newRoot}.${ns}`, applyTo: 'prefix', schemaJson: sc.schema as Record<string, unknown>,
      schemaMode: (sc.mode === 'open' ? 'open' : 'strict'), lockedBy: importerGaii, setAt: now, updatedAt: now,
    });
    schemas++;
  }

  // 2) Images: re-create the binaries (deduped) + build old-key → new-URL map for markdown rewrite.
  // The remapped key is CONFINED to the new workspace root: the archive names the key, and one that
  // falls outside is a write into some other part of the importer's namespace, which is how an
  // app-owned key (`apps/icons/…`) was reachable through a restore (secaudit 2026-10). The bytes go
  // through services/storage-file-write.ts, so the key fence, the app-owned-key refusal and the per-
  // file and account ceilings hold here as they do on POST /v1/storage.
  const remapKey = (key: string): string => {
    if (key.startsWith(`${oldRoot}.`)) return `${newRoot}.${key.slice(oldRoot.length + 1)}`;
    const legacy = `organism.${data.source.organismId}.img.`;
    if (key.startsWith(legacy)) return `${newRoot}.img.${key.slice(legacy.length)}`;
    return key;
  };
  const urlByOldKey = new Map<string, string>();
  let imagesCreated = 0, imagesDeduped = 0;
  for (const img of (data.images || []) as ExportImage[]) {
    const newKey = remapKey(img.key);
    if (outsideWorkspaceRoot(newRoot, newKey)) {
      skipped.push({ key: img.key, reason: 'The archive names a storage key outside this workspace, so the image was not restored.' });
      continue;
    }
    const level = await restoredLevel({ storage, config }, caller,
      { key: newKey, target: fileTarget(importerGaii, newKey) }, img.visibility, WHERE);
    if (level.clamp) clamped.push(level.clamp);
    const isPublic = level.visibility === 'public';
    urlByOldKey.set(img.key, isPublic ? `/v1/pub/${importerGaii}/${newKey}` : `/v1/storage/${encodeURIComponent(newKey)}`);
    const bin = imageFiles.get(img.file);
    if (!bin) continue;
    const existing = await storage.getStorageFile(importerGaii, newKey).catch(err => { logger.warn('remapKey: continuing after a suppressed failure', { error: String(err) }); return null; });
    if (existing) { imagesDeduped++; continue; }   // already present — reuse, don't duplicate
    const stored = await writeStorageFile({ storage, config }, importerGaii, {
      key: newKey, data: bin, mimeType: img.mimeType || 'application/octet-stream',
      visibility: level.visibility,
    });
    if (!stored.ok) { skipped.push({ key: newKey, reason: stored.message }); continue; }
    imagesCreated++;
  }
  const rewrite = (md: unknown): unknown => typeof md === 'string'
    ? md.replace(STORAGE_URL_RE, (whole, keyEnc) => urlByOldKey.get(decodeURIComponent(keyEnc)) || whole)
    : md;

  // 3) Manifest (id → target org), readme, config, sections, sources. All private: these are the
  // workspace's own meta records, and who reads the workspace is decided by its access rules.
  await writeMem(`${newRoot}.meta.manifest`, { ...(data.manifest as Record<string, unknown>), id: orgId });
  if (data.readme != null) await writeMem(`${newRoot}.meta.readme`, data.readme);
  if (data.config != null) await writeMem(`${newRoot}.meta.config`, data.config);
  for (const [type, secs] of Object.entries(data.sections || {})) await writeMem(`${newRoot}.meta.sections.${type}`, secs);
  if (data.sources != null) await writeMem(`${newRoot}.meta.sources`, data.sources);

  // 4) Objects (records + documents) — preserve ids, rewrite image URLs in markdown.
  // A record in a space the bundle's own manifest does not declare is not written: the refusal every
  // write door applies (undeclaredSpaceRefusal) decides it here too. The import is not refused for it,
  // because that would make a backup of a workspace holding one stray record unrestorable; the skipped
  // records are named in the result instead.
  const bundleTypes = ((data.manifest as { objectTypes?: WriteObjectType[] }).objectTypes ?? []);
  const skippedUndeclared: Array<{ namespace: string; id: string; role: string }> = [];
  let objects = 0, documents = 0;
  let shareValue: unknown = undefined;
  for (const o of (data.objects || []) as ExportObject[]) {
    // The share is a decision about who may read this workspace, not content: it is restored
    // through setWorkspaceShareOp below, which asks the label cap and the publish gate.
    if (SHARE_OBJECT(o)) { shareValue = o.value; continue; }
    if (!isPlatformWorkspaceNamespace(o.namespace)
      && undeclaredSpaceRefusal(o.namespace, bundleTypes, { organismId: orgId, ws: newWs })) {
      skippedUndeclared.push({ namespace: o.namespace, id: o.id, role: o.role });
      continue;
    }
    const suffix = o.role === '' ? '' : `.${o.role}`;
    const key = `${newRoot}.${o.namespace}.${o.id}${suffix}`;
    let value = o.value;
    if (value && typeof value === 'object' && 'markdown' in (value as Record<string, unknown>)) {
      value = { ...(value as Record<string, unknown>), markdown: rewrite((value as Record<string, unknown>).markdown) };
      documents++;
    } else {
      objects++;
    }
    const level = await restoredLevel({ storage, config }, caller,
      { key, target: memoryTarget(importerGaii, key) }, o.visibility, WHERE);
    if (level.clamp) clamped.push(level.clamp);
    await writeMem(key, value, level.visibility);
  }

  // 4b) The rows of the row spaces, as prepared above. A row of a space the bundle's manifest does
  // not declare as a row space is named with the skipped records.
  const rows = await writeRestoredRows(storage, rowPlan.records);
  skippedUndeclared.push(...rowPlan.skipped);

  // 5) Register the new workspace under the importer, on the registry's version: a workspace created
  // or imported in the same organism meanwhile stays in the list.
  const regKey = `organism.${orgId}.meta.workspaces`;
  const entry = { id: newWs, name: data.name || newWs, createdAt: now, createdBy: importerOwner };
  await updateRecord(storage, importerGaii, regKey, registryOf,
    (reg) => ({ workspaces: [...reg.workspaces, entry] }), { tag: 'workspaces', tags: [], visibility: 'private' });

  // 6) The share, now that the workspace is registered. Through its own service, so the label cap and
  // the publish gate decide what an archive may open here.
  if (shareValue && typeof shareValue === 'object' && !Array.isArray(shareValue)) {
    await restoreShare({ storage, config }, caller, { orgId, ws: newWs, share: shareValue as Record<string, unknown> }, clamped, skipped);
  }

  return {
    ws: newWs, objects, documents, rows, images: imagesCreated, images_deduped: imagesDeduped, schemas,
    ...(skippedUndeclared.length ? { skipped_undeclared: skippedUndeclared } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(clamped.length ? { clamped } : {}),
  };
}

/**
 * Restore the workspace's share through setWorkspaceShareOp.
 *
 * THE PASSWORD IS NOT IN THE BUNDLE. The export masks the share's scrypt hash (services/secret-
 * records.ts), and a hash cannot be turned back into a password anyway, so a password share is
 * restored as 'account' — signed-in accounts only, which is closed rather than open — and the
 * narrowing is named. An end date already past is dropped: the share service refuses one, and a
 * target whose end has passed is not shared in any case.
 */
async function restoreShare(
  deps: { storage: Storage; config: AimeatConfig },
  caller: ImportCaller,
  what: { orgId: string; ws: string; share: Record<string, unknown> },
  clamped: RestoreClamp[],
  skipped: RestoreSkip[],
): Promise<void> {
  const { orgId, ws, share } = what;
  const key = `organism.${orgId}.w.${ws}.meta.share`;
  const asked = share.access;
  const access = asked === 'open' || asked === 'account' || asked === 'organism' ? asked : 'account';
  if (access !== asked) {
    clamped.push({
      key, asked: String(asked ?? 'password'), stored: access, reason: 'share_password_not_carried',
      message: 'A share password never leaves a backup, so this workspace is shared with signed-in accounts instead. Set a new password to share it that way again.',
    });
  }
  const nowMs = Date.now();
  const until: Record<string, string> = {};
  for (const [k, d] of Object.entries((share.until ?? {}) as Record<string, unknown>)) {
    const t = typeof d === 'string' ? Date.parse(d) : NaN;
    if (Number.isFinite(t) && t > nowMs) until[k] = new Date(t).toISOString();
  }
  const result = await setWorkspaceShareOp(deps, { sub: caller.principal, owner: caller.owner }, {
    orgId, ws,
    body: {
      public: typeof share.public === 'boolean' ? share.public : false,
      spaces: share.spaces, docs: share.docs, until, access,
    },
  }, { caller: importCallerContext(deps, caller), ...(caller.app ? { app: caller.app } : {}) });
  if (!result.ok) skipped.push({ key, reason: result.message });
  else if (result.asked) {
    clamped.push({
      key, asked: String(asked ?? access), stored: 'held', reason: 'needs_the_owner',
      message: 'Opening this workspace to anyone with the link waits for the owner; everything else was restored.',
    });
  }
}
