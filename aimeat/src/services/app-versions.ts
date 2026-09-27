/**
 * @file src/services/app-versions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The version list of one published app, as GET /v1/apps/:owner/:filename/versions
 *   answers it. One implementation for the REST route and the MCP tool, so the two cannot drift on
 *   which fields a version carries or how the owner segment is read.
 * @structure
 *   - AppVersionsRefusal — the refusal a caller renders (`CODE: message` on MCP, the envelope on REST)
 *   - AppVersionView / AppVersionsView — the answer, field for field what the route sends
 *   - listAppVersionsView() — resolve the app, list its versions, load the live version's provenance
 * @usage
 *   const out = await listAppVersionsView(storage, config, ownerSegment, filename);
 *   if (!out.ok) return refuse(out.status, out.code, out.message);
 *   // out.data is the envelope data; out.provenance goes to setProvenanceHeaders + envelopeMeta
 * @version-history
 *   v1.0.0 — 2026-09-27 — Extracted from the route in src/routes/apps/read.ts, so the MCP tool can
 *     call the same code. The route's answer is unchanged. The former MCP tool aimeat_app_versions
 *     read storage directly and did not return ai_provenance_id or the live provenance.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { loadServedProvenance, type ServedProvenance } from './ai-provenance-marks.js';

/** A refusal, with the HTTP status the REST route answers and the code both surfaces carry. */
export interface AppVersionsRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

/** One published version, in the wire shape of the REST answer. */
export interface AppVersionView {
  version_number: number;
  version: string | undefined;
  size: number;
  created_at: string;
  /** The provenance record of THIS version; each publish is its own content. */
  ai_provenance_id: string | null;
}

/** The data part of the REST envelope, key order included. */
export interface AppVersionsView {
  owner: string;
  filename: string;
  versions: AppVersionView[];
  total: number;
}

/**
 * List every published version of an app.
 *
 * `owner` is the raw owner segment: the legacy full-GHII form (`owner@node`) is read with
 * localAccountName, which keeps an identity of another node whole. `provenance` is the LIVE
 * version's record, for the REST route's `AI-Disclosure` header and `meta.provenance`.
 */
export async function listAppVersionsView(
  storage: Storage,
  config: AimeatConfig,
  owner: string,
  filename: string,
): Promise<{ ok: true; data: AppVersionsView; provenance: ServedProvenance | undefined } | AppVersionsRefusal> {
  // Tolerate the legacy full-GHII owner segment (owner@node) in old links.
  const ownerName = localAccountName(owner);

  // Apps live in the owner's canonical bucket (ownerGaii = owner@nodeId),
  // not under any agent GAII. Resolve the row by owner name, then list that
  // exact bucket so every published version is returned.
  const app = await storage.getAppByOwnerName(ownerName, filename);
  if (!app) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `App "${filename}" not found for owner "${ownerName}"` };
  }

  const versions = await storage.listAppVersions(app.ownerGaii, filename);
  // TARGET-058: per version, because each publish is its own content and carries its own
  // statement; `meta.provenance` is the LIVE version's, on the one envelope carrier.
  const provenance = await loadServedProvenance(storage, config, app.aiProvenanceId);
  return {
    ok: true,
    data: {
      owner: ownerName,
      filename,
      versions: versions.map(v => ({
        version_number: v.versionNumber,
        version: v.manifest.version,
        size: v.size,
        created_at: v.createdAt,
        ai_provenance_id: v.aiProvenanceId ?? null,
      })),
      total: versions.length,
    },
    provenance,
  };
}
