/**
 * @file organism-import.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Import an organism bundle ZIP: create a NEW organism (settings from organism.json; the
 *   importer becomes creator/admin/member, with a fresh discussion board) and restore every workspace
 *   under it via restoreWorkspace(). Membership/board from the source are NOT restored — only the
 *   organism's settings + its workspace content.
 * @structure importOrganism(storage, config, { importerGaii, importerOwner, caller, zip }) ·
 *   restoreOrganismFromFiles(storage, config, { importerGaii, importerOwner, caller, files })
 * @version-history
 *   v1.4.0 -- 2026-10-20 -- The organism is created through createOrganismRecord, so an imported
 *     bundle meets the label's audience cap and the publish gate that POST /v1/organisms meets: a
 *     bundle naming a public organism, restored by a caller the node asks the owner about, is created
 *     private and the answer carries the request (secaudit 2026-10,
 *     workspace-import:restore-skips-write-gates). Every caller passes `caller`, the session's facts.
 *   v1.3.0 -- 2026-10-18 -- A listed or private imported organism's board is at `organism:<id>` (was
 *     'shared' with an empty roster, which refused the members; plan doc-mvcn6c7e4e5q, V3.5).
 *   v1.2.0 -- 2026-08-29 -- An imported type is kept as written (free text, cut to 40 characters); only an
 *     empty one falls back to "project".
 *   v1.1.0 -- 2026-06-24 -- Secretary P5 (S-B): extract restoreOrganismFromFiles() (the create-org +
 *     restore-workspaces core operating on an already-unzipped file map) so the use-case template
 *     instantiate flow can reuse it without re-implementing organism creation. importOrganism now
 *     unzips then delegates. Behaviour unchanged for the bundle-import path.
 *   v1.0.0 -- 2026-06-09 -- Initial: organism bundle import (create org + restore all workspaces).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { unzipBuffer, restoreWorkspace } from './workspace-import.js';
import { ORG_EXPORT_VERSION } from './organism-export.js';
import { logger } from '../utils/logger.js';
import { createOrganismRecord } from './organism-lifecycle.js';
import { importCallerContext, type ImportCaller } from './workspace-import-gates.js';
import type { PublishRequestedBody } from './publish-requests/door.js';

interface OrgJson {
  aimeatOrganismExport: string;
  organism: { name?: string; description?: string; type?: string; joinPolicy?: string; visibility?: string; interests?: unknown[] };
  workspaces?: Array<{ ws: string; name?: string; folder?: string }>;
}

export interface OrganismImportResult {
  organism_id: string;
  name: string;
  workspaces: Array<{ from: string; ws: string }>;
  /** The bundle named a public organism and making it public waits for the owner (publish gate). */
  publish_request?: PublishRequestedBody;
}

/** Allowed entry layout for an organism bundle ZIP — anything else is rejected as a bad format. */
const ORGANISM_ALLOW = (n: string) =>
  n === 'organism.json' ||
  /^workspaces\/[A-Za-z0-9_-]+\/workspace\.json$/.test(n) ||
  /^workspaces\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9._-]+$/.test(n);

export async function importOrganism(
  storage: Storage,
  config: AimeatConfig,
  opts: { importerGaii: string; importerOwner: string; caller: ImportCaller; zip: Buffer },
): Promise<OrganismImportResult> {
  const { importerGaii, importerOwner, caller, zip } = opts;
  const files = await unzipBuffer(zip, ORGANISM_ALLOW);
  return restoreOrganismFromFiles(storage, config, { importerGaii, importerOwner, caller, files });
}

/**
 * Create a new organism + restore its workspaces from an ALREADY-UNZIPPED file map (organism.json +
 * workspaces/{ws}/workspace.json + images/). The importer becomes the new organism's creator. Extracted
 * so the use-case template instantiate flow (Secretary P5 / S-B) can reuse organism creation without
 * re-implementing it — it unzips with a broader allowlist (to permit template.json) and then calls this.
 *
 * The organism itself is created through services/organism-lifecycle.ts, the same function
 * POST /v1/organisms calls, so the label's audience cap and the publish gate hold for a bundle as
 * they do for a create: the settings in an organism.json are the archive's words, not the node's.
 */
export async function restoreOrganismFromFiles(
  storage: Storage,
  config: AimeatConfig,
  opts: { importerGaii: string; importerOwner: string; caller: ImportCaller; files: Map<string, Buffer> },
): Promise<OrganismImportResult> {
  const { importerGaii, importerOwner, caller, files } = opts;
  const ojBuf = files.get('organism.json');
  if (!ojBuf) throw new Error('organism.json missing from the ZIP');
  let oj: OrgJson;
  try { oj = JSON.parse(ojBuf.toString('utf8')); } catch { throw new Error('organism.json is not valid JSON'); }
  if (!oj || oj.aimeatOrganismExport !== ORG_EXPORT_VERSION || !oj.organism) throw new Error('Unrecognised organism export (wrong format/version)');

  const o = oj.organism;
  const name = (o.name && String(o.name).trim()) || 'Imported organism';
  // A type is free text (2026-08-29): keep the exported word, cut to a label; only an empty one
  // falls back.
  const type = typeof o.type === 'string' && o.type.trim() ? o.type.trim().slice(0, 40) : 'project';
  // The bundle's words are validated here rather than left to the create's fallbacks, because an
  // unrecognised value there takes the NODE's starting level, which may be more open than a backup
  // should produce. An import that names nothing usable stays closed.
  const joinPolicy = ['open', 'approval_required', 'invite_only'].includes(o.joinPolicy ?? '') ? (o.joinPolicy as string) : 'invite_only';
  const visibility = ['public', 'listed', 'private'].includes(o.visibility ?? '') ? (o.visibility as string) : 'private';

  // Create the new organism through the shared service: the board, the record, the creator's
  // membership, the audience cap and the publish gate, all as POST /v1/organisms makes them.
  const created = await createOrganismRecord({ storage, config }, importerOwner, {
    name, description: o.description || '', type, joinPolicy, visibility,
    interests: Array.isArray(o.interests) ? o.interests : [],
    publishGate: { caller: importCallerContext({ storage, config }, caller), ...(caller.app ? { app: caller.app } : {}) },
  });
  if (!created.ok) throw new Error(created.message);
  const id = created.organism.id;

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
      const r = await restoreWorkspace(storage, config, { orgId: id, importerGaii, importerOwner, caller, data, images: imgs });
      restored.push({ from: w.ws, ws: r.ws });
    } catch (err) { logger.warn('name: skip a workspace that fails to restore', { error: String(err) }); }
  }

  return {
    organism_id: id, name, workspaces: restored,
    ...(created.publishRequest ? { publish_request: created.publishRequest } : {}),
  };
}
