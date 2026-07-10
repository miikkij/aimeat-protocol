/**
 * @file workspace-export.ts
 * @description Full-fidelity export of an organism workspace as a ZIP (a `workspace.json` with all
 *   data + an `images/` folder of the real image binaries — no base64 inlining). The data captures
 *   the manifest, locked schemas, document sections, sources, and every object record (draft /
 *   latest / version.N), plus references to the embedded images. Owner/creator backup + portability.
 *
 *   Export is bounded by what the exporter can READ: their own records pass directly, others go
 *   through the consent guard — so a personal backup captures your content + anything you're granted.
 * @structure
 *   - WS_EXPORT_VERSION, WorkspaceExportJson
 *   - exportWorkspace(storage, config, { orgId, ws, exporterGaii, exportedAt }) -> { buffer, filename }
 * @usage import { exportWorkspace } from '../services/workspace-export.js';
 * @version-history
 *   v1.0.0 -- 2026-06-09 -- Initial: ZIP export (workspace.json + images/) reusing archiver.
 *   v1.0.1 -- 2026-06-13 -- archiver v8: archiver('zip') -> new ZipArchive()
 *   v1.1.0 -- 2026-07-10 -- An owner-level exporter with ACTIVE organism membership captures every
 *     record (matching the live human-member read model); per-record consent bounding stays for
 *     agent (GAII) exporters. Cross-member records used to vanish from every export silently.
 */
import { ZipArchive } from 'archiver';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { authorizeRead } from './access-guard.js';

export const WS_EXPORT_VERSION = '1.0';

export interface ExportObject { namespace: string; id: string; role: string; value: unknown; visibility: string; createdAt: string; updatedAt: string; version: number }
export interface ExportImage { key: string; file: string; mimeType: string; visibility: string }
export interface WorkspaceExportJson {
  aimeatWorkspaceExport: string;
  exportedAt: string;
  source: { organismId: string; ws: string; nodeId: string };
  name: string;
  manifest: unknown;
  readme: unknown;
  config: unknown;
  schemas: Record<string, { schema: unknown; mode: string }>;
  sections: Record<string, unknown>;
  sources: unknown;
  objects: ExportObject[];
  images: ExportImage[];
}

/** Pull storage keys out of an image URL: /v1/storage/<key> or /v1/pub/<ghii>/<key>. */
const STORAGE_URL_RE = /\/v1\/(?:storage|pub\/[^/)\s]+)\/([^\s)\]"'>]+)/g;

/** Collect a workspace's full data + image binaries WITHOUT zipping — the reusable core shared by
 *  the single-workspace export and the organism bundle export. Image file names are relative
 *  ("images/img-N.ext"), as referenced by each object's `img.file`. */
export async function collectWorkspace(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; ws: string; exporterGaii: string; exportedAt: string },
): Promise<{ json: WorkspaceExportJson; images: Map<string, Buffer> }> {
  const { orgId, ws, exporterGaii, exportedAt } = opts;
  const root = `organism.${orgId}.w.${ws}`;

  // An owner-level exporter (GHII, no '#') who is an active member of the organism reads the whole
  // workspace live (workspace-access middleware: a human owner session needs no consent), so the
  // export includes the same — per-record consent bounding would silently drop records owned by
  // OTHER members from every member's export, including the organism creator's. Agent exporters
  // (GAII) keep the consent-bounded path, matching their live read rights.
  let isActiveMemberOwner = false;
  if (!exporterGaii.includes('#')) {
    const m = await storage.getMembership(orgId, exporterGaii.split('@')[0]);
    isActiveMemberOwner = !!m && m.status === 'active';
  }

  const { items } = await storage.listAllMemory({ prefix: `${root}.`, limit: 10000 });
  const readable: MemoryRecord[] = [];
  for (const r of items) {
    if (isActiveMemberOwner || r.ownerGaii === exporterGaii) { readable.push(r); continue; }
    const d = await authorizeRead(storage, config, { ownerGaii: r.ownerGaii, accessorGaii: exporterGaii, resourceKey: r.key, visibility: r.visibility, groupId: r.groupId, action: 'read' });
    if (d.allowed) readable.push(r);
  }

  const out: WorkspaceExportJson = {
    aimeatWorkspaceExport: WS_EXPORT_VERSION, exportedAt,
    source: { organismId: orgId, ws, nodeId: config.nodeId },
    name: ws, manifest: null, readme: null, config: null,
    schemas: {}, sections: {}, sources: null, objects: [], images: [],
  };
  const namespaces = new Set<string>();
  const imageKeys = new Set<string>();

  for (const r of readable) {
    const rel = r.key.slice(root.length + 1);   // after "root."
    if (rel === 'meta.manifest') { out.manifest = r.value; const m = r.value as { name?: string } | null; if (m?.name) out.name = m.name; continue; }
    if (rel === 'meta.readme') { out.readme = r.value; continue; }
    if (rel === 'meta.sources') { out.sources = r.value; continue; }
    if (rel === 'meta.config') { out.config = r.value; continue; }
    if (rel.startsWith('meta.sections.')) { out.sections[rel.slice('meta.sections.'.length)] = r.value; continue; }
    if (rel.startsWith('access.')) continue;   // access requests are not workspace content

    // An object instance: <namespace…>.<id>[.draft|.latest|.version.N]
    const parts = rel.split('.');
    let role = '';
    let core = parts;
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    if (last === 'draft' || last === 'latest') { role = last; core = parts.slice(0, -1); }
    else if (secondLast === 'version' && /^\d+$/.test(last)) { role = `version.${last}`; core = parts.slice(0, -2); }
    const id = core[core.length - 1];
    const namespace = core.slice(0, -1).join('.');
    if (!namespace || !id) continue;
    namespaces.add(namespace);
    out.objects.push({ namespace, id, role, value: r.value, visibility: r.visibility, createdAt: r.createdAt, updatedAt: r.updatedAt, version: r.version });
    const md = (r.value && typeof r.value === 'object') ? (r.value as { markdown?: unknown }).markdown : undefined;
    if (typeof md === 'string') for (const m of md.matchAll(STORAGE_URL_RE)) imageKeys.add(decodeURIComponent(m[1]));
  }

  // Locked schemas per namespace.
  for (const ns of namespaces) {
    const sc = await storage.getSchema(`${root}.${ns}`, 'prefix');
    if (sc) out.schemas[ns] = { schema: sc.schemaJson, mode: sc.schemaMode };
  }

  // Storage files under the workspace prefix (images the exporter owns), in case some aren't
  // referenced in markdown yet.
  try {
    const files = await storage.listStorageFiles(exporterGaii);
    for (const f of files) if (f.key.startsWith(`${root}.`) || f.key.startsWith(`organism.${orgId}.img.`)) imageKeys.add(f.key);
  } catch { /* listing is best-effort */ }

  const images = new Map<string, Buffer>();
  let imgN = 0;
  for (const key of imageKeys) {
    const file = await storage.getStorageFile(exporterGaii, key).catch(() => null);
    if (!file) continue;
    const ext = (file.mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    const fileName = `images/img-${imgN++}.${ext}`;
    out.images.push({ key, file: fileName, mimeType: file.mimeType, visibility: file.visibility });
    images.set(fileName, file.data);
  }
  return { json: out, images };
}

/** Export a single workspace as a standalone ZIP (workspace.json + images/). */
export async function exportWorkspace(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; ws: string; exporterGaii: string; exportedAt: string },
): Promise<{ buffer: Buffer; filename: string }> {
  const { json, images } = await collectWorkspace(storage, config, opts);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });
  for (const [name, data] of images) archive.append(data, { name });
  archive.append(JSON.stringify(json, null, 2), { name: 'workspace.json' });
  archive.finalize();
  const buffer = await done;
  const safe = String(json.name).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'workspace';
  return { buffer, filename: `workspace-${safe}.zip` };
}
