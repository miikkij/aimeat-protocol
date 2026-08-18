/**
 * @file organism-import.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Import an organism bundle ZIP: create a NEW organism (settings from organism.json; the
 *   importer becomes creator/admin/member, with a fresh discussion board) and restore every workspace
 *   under it via restoreWorkspace(). Membership/board from the source are NOT restored — only the
 *   organism's settings + its workspace content.
 * @structure importOrganism(storage, config, { importerGaii, importerOwner, zip }) ·
 *   restoreOrganismFromFiles(storage, config, { importerGaii, importerOwner, files })
 * @version-history
 *   v1.1.0 -- 2026-06-24 -- Secretary P5 (S-B): extract restoreOrganismFromFiles() (the create-org +
 *     restore-workspaces core operating on an already-unzipped file map) so the use-case template
 *     instantiate flow can reuse it without re-implementing organism creation. importOrganism now
 *     unzips then delegates. Behaviour unchanged for the bundle-import path.
 *   v1.0.0 -- 2026-06-09 -- Initial: organism bundle import (create org + restore all workspaces).
 */
import { v4 as uuidv4 } from 'uuid';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { unzipBuffer, restoreWorkspace } from './workspace-import.js';
import { ORG_EXPORT_VERSION } from './organism-export.js';
import { logger } from '../utils/logger.js';

interface OrgJson {
  aimeatOrganismExport: string;
  organism: { name?: string; description?: string; type?: string; joinPolicy?: string; visibility?: string; interests?: unknown[] };
  workspaces?: Array<{ ws: string; name?: string; folder?: string }>;
}

export interface OrganismImportResult { organism_id: string; name: string; workspaces: Array<{ from: string; ws: string }> }

/** Allowed entry layout for an organism bundle ZIP — anything else is rejected as a bad format. */
const ORGANISM_ALLOW = (n: string) =>
  n === 'organism.json' ||
  /^workspaces\/[A-Za-z0-9_-]+\/workspace\.json$/.test(n) ||
  /^workspaces\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9._-]+$/.test(n);

export async function importOrganism(
  storage: Storage,
  config: AimeatConfig,
  opts: { importerGaii: string; importerOwner: string; zip: Buffer },
): Promise<OrganismImportResult> {
  const { importerGaii, importerOwner, zip } = opts;
  const files = await unzipBuffer(zip, ORGANISM_ALLOW);
  return restoreOrganismFromFiles(storage, config, { importerGaii, importerOwner, files });
}

/**
 * Create a new organism + restore its workspaces from an ALREADY-UNZIPPED file map (organism.json +
 * workspaces/{ws}/workspace.json + images/). The importer becomes the new organism's creator. Extracted
 * so the use-case template instantiate flow (Secretary P5 / S-B) can reuse organism creation without
 * re-implementing it — it unzips with a broader allowlist (to permit template.json) and then calls this.
 */
export async function restoreOrganismFromFiles(
  storage: Storage,
  config: AimeatConfig,
  opts: { importerGaii: string; importerOwner: string; files: Map<string, Buffer> },
): Promise<OrganismImportResult> {
  const { importerGaii, importerOwner, files } = opts;
  const ojBuf = files.get('organism.json');
  if (!ojBuf) throw new Error('organism.json missing from the ZIP');
  let oj: OrgJson;
  try { oj = JSON.parse(ojBuf.toString('utf8')); } catch { throw new Error('organism.json is not valid JSON'); }
  if (!oj || oj.aimeatOrganismExport !== ORG_EXPORT_VERSION || !oj.organism) throw new Error('Unrecognised organism export (wrong format/version)');

  const o = oj.organism;
  const name = (o.name && String(o.name).trim()) || 'Imported organism';
  const type = ['community', 'team', 'club', 'cooperative', 'project'].includes(o.type ?? '') ? (o.type as string) : 'project';
  const joinPolicy = ['open', 'approval_required', 'invite_only'].includes(o.joinPolicy ?? '') ? (o.joinPolicy as string) : 'invite_only';
  const visibility = ['public', 'listed', 'private'].includes(o.visibility ?? '') ? (o.visibility as string) : 'private';

  // Create the new organism (mirrors POST /v1/organisms; the importer is the creator).
  const id = uuidv4();
  const now = new Date().toISOString();
  const boardId = `org-${id}`;
  await storage.createBoard({
    id: boardId, name: `${name} — Discussion`, description: `Discussion board for ${name}`,
    visibility: visibility === 'public' ? 'public' : 'shared', ownerGaii: importerGaii, allowedGaiis: [], createdAt: now,
  });
  await storage.createOrganism({
    id, name, description: o.description || '', type: type as 'community' | 'team' | 'club' | 'cooperative' | 'project',
    location: {}, interests: Array.isArray(o.interests) ? o.interests as string[] : [],
    // An import makes a NEW organism here, so the importer both made it and holds it. The exporting
    // node's creator is not carried over: they have no account on this node to be an owner of.
    creatorGhii: importerOwner, createdBy: importerOwner, owners: [importerOwner],
    admins: [importerOwner], members: [importerOwner], agentGaiis: [],
    boardId, joinPolicy: joinPolicy as 'open' | 'approval_required' | 'invite_only', maxMembers: 500,
    visibility: visibility as 'public' | 'listed' | 'private',
    moderationConfig: { flagsEnabled: true, autoHideThreshold: 3, appealsEnabled: true },
    memoryNamespace: `organism.${id}`, createdAt: now, updatedAt: now,
  });
  await storage.createMembership({ id: uuidv4(), organismId: id, ghii: importerOwner, role: 'creator', status: 'active', joinedAt: now });

  // Restore each workspace into the new organism.
  const restored: Array<{ from: string; ws: string }> = [];
  for (const w of (oj.workspaces ?? [])) {
    const folder = w.folder || `workspaces/${w.ws}`;
    const jb = files.get(`${folder}/workspace.json`);
    if (!jb) continue;
    let data;
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    try { data = JSON.parse(jb.toString('utf8')); } catch { continue; }
    const imgs = new Map<string, Buffer>();
    for (const [fname, buf] of files) if (fname.startsWith(`${folder}/images/`)) imgs.set(fname.slice(folder.length + 1), buf);
    try {
      const r = await restoreWorkspace(storage, config, { orgId: id, importerGaii, importerOwner, data, images: imgs });
      restored.push({ from: w.ws, ws: r.ws });
    } catch (err) { logger.warn('name: skip a workspace that fails to restore', { error: String(err) }); }
  }

  return { organism_id: id, name, workspaces: restored };
}
