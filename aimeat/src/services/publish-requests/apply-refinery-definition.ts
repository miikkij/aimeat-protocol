/**
 * @file src/services/publish-requests/apply-refinery-definition.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner allowed where a mail refinery reads and files mail, which an app or an agent
 *   that may not run the refinery asked for (services/refinery/definition-ask.ts filed it). The asked
 *   fields are written into the owner's definition as the owner, on the version that is read, and
 *   nothing else in the record changes. A definition removed since ends the request `outdated`.
 * @structure applyRefineryDefinition
 * @usage registered in appliers.ts under the kind 'refinery-definition'
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26, refinery/pipeline:loadDefinition:definition-writer-not-bound).
 */
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { DESTINATION_FIELDS } from '../refinery/definition-ask.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

type Json = Record<string, unknown>;

export async function applyRefineryDefinition(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const key = String(request.target.key ?? '');
  let asked: Json;
  try {
    asked = JSON.parse(String(request.target.fields ?? '')) as Json;
  } catch {
    return { ok: false, reason: 'the asked change could not be read' };
  }
  if (!key.endsWith('.config') || !asked || typeof asked !== 'object') return { ok: false, reason: 'the asked change could not be read' };
  let found = true;
  await updateRecord<Json | null>(ctx.storage, ownerGhii, key,
    (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : null),
    (stored) => {
      if (!stored) { found = false; return UNCHANGED; }
      const next: Json = { ...stored };
      // Only the destination fields, as asked: one the writer left out is left out.
      for (const f of DESTINATION_FIELDS) { if (f in asked) next[f] = asked[f]; else delete next[f]; }
      return next;
    }, {
      tag: 'refinery',
      visibility: (rec) => rec?.visibility ?? 'private',
      tags: (rec) => rec?.tags ?? ['refinery'],
    });
  if (!found) return { ok: false, reason: 'the refinery definition was removed after the request was made' };
  return { ok: true };
}
