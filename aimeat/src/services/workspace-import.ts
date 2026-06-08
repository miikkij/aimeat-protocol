/**
 * @file workspace-import.ts
 * @description Restore a workspace export ZIP as a NEW workspace in a target organism. Unzips with
 *   yauzl, remaps the organism/workspace ids in every key (record + document IDS ARE PRESERVED, so
 *   [[wiki-links]] and cross-references stay valid), re-locks the JSON schemas, re-creates the image
 *   binaries (DEDUPED — skipped if the target storage key already exists), rewrites image URLs in
 *   document markdown to the new keys, and registers the new workspace under the importer.
 * @structure importWorkspace(storage, config, { orgId, importerGaii, importerOwner, zip }) -> result
 * @usage import { importWorkspace } from '../services/workspace-import.js';
 * @version-history
 *   v1.0.0 -- 2026-06-09 -- Initial: ZIP import with id remap, schema re-lock, image dedup + URL rewrite.
 */
import yauzl from 'yauzl';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { WorkspaceExportJson, ExportObject, ExportImage } from './workspace-export.js';
import { WS_EXPORT_VERSION } from './workspace-export.js';

/** Read every entry of a ZIP buffer into a filename → Buffer map. */
function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) { reject(err || new Error('not a zip')); return; }
      const files = new Map<string, Buffer>();
      zipfile.on('error', reject);
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }   // directory
        zipfile.openReadStream(entry, (e, stream) => {
          if (e || !stream) { reject(e || new Error('read fail')); return; }
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zipfile.readEntry(); });
          stream.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve(files));
      zipfile.readEntry();
    });
  });
}

const STORAGE_URL_RE = /\/v1\/(?:storage|pub\/[^/)\s]+)\/([^\s)\]"'>]+)/g;

export interface ImportResult { ws: string; objects: number; documents: number; images: number; images_deduped: number; schemas: number }

export async function importWorkspace(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; importerGaii: string; importerOwner: string; zip: Buffer },
): Promise<ImportResult> {
  const { orgId, importerGaii, importerOwner, zip } = opts;
  const files = await unzip(zip);
  const jsonBuf = files.get('workspace.json');
  if (!jsonBuf) throw new Error('workspace.json missing from the ZIP');
  let data: WorkspaceExportJson;
  try { data = JSON.parse(jsonBuf.toString('utf8')); } catch { throw new Error('workspace.json is not valid JSON'); }
  if (!data || data.aimeatWorkspaceExport !== WS_EXPORT_VERSION || !data.manifest) {
    throw new Error('Unrecognised workspace export (wrong format/version)');
  }

  const newWs = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const oldRoot = `organism.${data.source.organismId}.w.${data.source.ws}`;
  const newRoot = `organism.${orgId}.w.${newWs}`;
  const now = new Date().toISOString();

  const writeMem = async (key: string, value: unknown, visibility: 'private' | 'owner' | 'group' | 'public' = 'private') => {
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
  const remapKey = (key: string): string => {
    if (key.startsWith(`${oldRoot}.`)) return `${newRoot}.${key.slice(oldRoot.length + 1)}`;
    const legacy = `organism.${data.source.organismId}.img.`;
    if (key.startsWith(legacy)) return `${newRoot}.img.${key.slice(legacy.length)}`;
    return key;
  };
  const urlByOldKey = new Map<string, string>();
  let imagesCreated = 0, imagesDeduped = 0;
  for (const img of (data.images || []) as ExportImage[]) {
    const bin = files.get(img.file);
    const newKey = remapKey(img.key);
    const isPublic = img.visibility === 'public';
    urlByOldKey.set(img.key, isPublic ? `/v1/pub/${importerGaii}/${newKey}` : `/v1/storage/${encodeURIComponent(newKey)}`);
    if (!bin) continue;
    const existing = await storage.getStorageFile(importerGaii, newKey).catch(() => null);
    if (existing) { imagesDeduped++; continue; }   // already present — reuse, don't duplicate
    await storage.createStorageFile({
      key: newKey, ownerGaii: importerGaii, visibility: (img.visibility as 'private' | 'owner' | 'group' | 'public') || 'private',
      mimeType: img.mimeType || 'application/octet-stream', size: bin.length, data: bin, createdAt: now,
    });
    imagesCreated++;
  }
  const rewrite = (md: unknown): unknown => typeof md === 'string'
    ? md.replace(STORAGE_URL_RE, (whole, keyEnc) => urlByOldKey.get(decodeURIComponent(keyEnc)) || whole)
    : md;

  // 3) Manifest (id → target org), readme, config, sections, sources.
  await writeMem(`${newRoot}.meta.manifest`, { ...(data.manifest as Record<string, unknown>), id: orgId });
  if (data.readme != null) await writeMem(`${newRoot}.meta.readme`, data.readme);
  if (data.config != null) await writeMem(`${newRoot}.meta.config`, data.config);
  for (const [type, secs] of Object.entries(data.sections || {})) await writeMem(`${newRoot}.meta.sections.${type}`, secs);
  if (data.sources != null) await writeMem(`${newRoot}.meta.sources`, data.sources);

  // 4) Objects (records + documents) — preserve ids, rewrite image URLs in markdown.
  let objects = 0, documents = 0;
  for (const o of (data.objects || []) as ExportObject[]) {
    const suffix = o.role === '' ? '' : `.${o.role}`;
    const key = `${newRoot}.${o.namespace}.${o.id}${suffix}`;
    let value = o.value;
    if (value && typeof value === 'object' && 'markdown' in (value as Record<string, unknown>)) {
      value = { ...(value as Record<string, unknown>), markdown: rewrite((value as Record<string, unknown>).markdown) };
      documents++;
    } else {
      objects++;
    }
    await writeMem(key, value, (o.visibility as 'private' | 'owner' | 'group' | 'public') || 'private');
  }

  // 5) Register the new workspace under the importer.
  const regKey = `organism.${orgId}.meta.workspaces`;
  const regRec = await storage.getMemory(importerGaii, regKey);
  const list = ((regRec?.value as { workspaces?: unknown[] } | undefined)?.workspaces) ?? [];
  await writeMem(regKey, { workspaces: [...list, { id: newWs, name: data.name || newWs, createdAt: now, createdBy: importerOwner }] });

  return { ws: newWs, objects, documents, images: imagesCreated, images_deduped: imagesDeduped, schemas };
}
