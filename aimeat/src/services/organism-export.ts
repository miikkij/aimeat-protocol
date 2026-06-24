/**
 * @file organism-export.ts
 * @description Export a whole organism as one ZIP — its settings + every workspace the exporter can
 *   read, each under workspaces/{ws}/ (workspace.json + images/), plus a top-level organism.json.
 *   Reuses collectWorkspace() so a workspace is captured identically whether exported alone or in a
 *   bundle. Membership (members/board) is NOT exported — only the organism's settings; on import the
 *   importer becomes the new organism's creator.
 * @structure ORG_EXPORT_VERSION; exportOrganism(storage, config, { orgId, exporterGaii, exportedAt, skeleton?, templateJson? })
 * @version-history
 *   v1.1.0 -- 2026-06-24 -- Secretary P5 (S-B): add `skeleton` mode (strip every workspace's objects +
 *     images, keeping only schema/purpose/structure — content-free, safe to publish) and an optional
 *     top-level `templateJson` (use-case template metadata: specialists + extension deps + scope presets).
 *     Default behaviour (full bundle, no template.json) is unchanged.
 *   v1.0.0 -- 2026-06-09 -- Initial: organism bundle export (settings + all workspaces).
 *   v1.0.1 -- 2026-06-13 -- archiver v8: archiver('zip') -> new ZipArchive()
 */
import { ZipArchive } from 'archiver';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { collectWorkspace } from './workspace-export.js';

export const ORG_EXPORT_VERSION = '1.0';

export async function exportOrganism(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; exporterGaii: string; exportedAt: string; skeleton?: boolean; templateJson?: Record<string, unknown> },
): Promise<{ buffer: Buffer; filename: string; workspaces: number }> {
  const { orgId, exporterGaii, exportedAt, skeleton, templateJson } = opts;
  const org = await storage.getOrganism(orgId);
  if (!org) throw new Error('Organism not found');

  const reg = await storage.getMemory(exporterGaii, `organism.${orgId}.meta.workspaces`);
  const wss = ((reg?.value as { workspaces?: Array<{ id: string; name?: string }> } | undefined)?.workspaces) ?? [];

  const orgJson: Record<string, unknown> = {
    aimeatOrganismExport: ORG_EXPORT_VERSION,
    exportedAt,
    source: { organismId: orgId, nodeId: config.nodeId },
    organism: {
      name: org.name, description: org.description, type: org.type,
      joinPolicy: org.joinPolicy, visibility: org.visibility, interests: org.interests,
    },
    workspaces: [] as Array<{ ws: string; name: string; folder: string }>,
  };

  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });

  let count = 0;
  for (const w of wss) {
    try {
      const { json, images } = await collectWorkspace(storage, config, { orgId, ws: w.id, exporterGaii, exportedAt });
      const folder = `workspaces/${w.id}`;
      // Skeleton mode: a use-case template keeps the STRUCTURE (manifest/purpose/locked schemas/document
      // sections) but drops all content — object records + image binaries — so it round-trips content-free
      // and is safe to publish. Full mode embeds everything (the original backup behaviour).
      if (skeleton) {
        json.objects = [];
        json.images = [];
      } else {
        for (const [name, data] of images) archive.append(data, { name: `${folder}/${name}` });
      }
      archive.append(JSON.stringify(json, null, 2), { name: `${folder}/workspace.json` });
      (orgJson.workspaces as Array<{ ws: string; name: string; folder: string }>).push({ ws: w.id, name: json.name, folder });
      count++;
    } catch { /* skip a workspace the exporter can't read */ }
  }

  if (skeleton) orgJson.skeleton = true;
  archive.append(JSON.stringify(orgJson, null, 2), { name: 'organism.json' });
  // A use-case template carries its specialist directives + extension deps + scope presets in template.json.
  if (templateJson) archive.append(JSON.stringify(templateJson, null, 2), { name: 'template.json' });
  archive.finalize();
  const buffer = await done;
  const safe = String(org.name).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'organism';
  const prefix = templateJson ? 'template' : 'organism';
  return { buffer, filename: `${prefix}-${safe}.zip`, workspaces: count };
}
