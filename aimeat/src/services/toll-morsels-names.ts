/**
 * @file src/services/toll-morsels-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The write side of the pacing-amount rename (ruling
 *   decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll, 2026-10-13): a knowledge
 *   package's `sharing.morsel_price` and a capability's `cost.morsels` are `toll_morsels` from 4.0.0.
 *
 *   One rule for both, on every route that writes them:
 *     - `toll_morsels` alone: taken as it is.
 *     - the old name alone: taken, stored as `toll_morsels`, and counted as a deprecated use
 *       (deprecated_use_by_type: knowledge_morsel_price, capability_cost_morsels) with the Deprecation
 *       headers on the response. From MORSEL_PRICE_NAMES_REMOVED_IN (config-pacing.ts) it is refused
 *       with 400 MORSEL_PRICE_REMOVED.
 *     - both names: they must say the same amount, or 400 TOLL_MORSELS_MISMATCH; the old name still
 *       counts as used.
 *     - the amount, under either name, is a number of at least 0, or 400 INVALID_INPUT.
 *   The stored object never carries the old name. Reads of a row stored before the rename go through
 *   utils/toll-name.ts.
 *
 *   The generic memory routes take a manifest under `packages/{id}/manifest` as the person wrote it
 *   and do not rename inside it; services/legacy-pacing-write.ts counts the old name there and refuses
 *   a mismatch with the same codes, and the knowledge routes answer the manifest under the new name.
 * @structure TollNameRefusal · normalizeKnowledgeSharing · normalizeCapabilityCost · presentKnowledgeManifest
 * @usage
 *   const sharing = normalizeKnowledgeSharing(pkg.sharing);
 *   if (!sharing.ok) return res.status(sharing.status).json(error(nodeId, sharing.code, sharing.message));
 *   pkg.sharing = sharing.value;
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 */
import { MORSEL_PRICE_NAMES_REMOVED_IN } from '../config-pacing.js';
import { TOLL_MORSELS, tollNameOnRead } from '../utils/toll-name.js';
import { noteDeprecatedUse, removedFrom } from './deprecation.js';

/** Why a write with a pacing amount was refused. */
export interface TollNameRefusal {
  ok: false;
  status: 400;
  code: 'MORSEL_PRICE_REMOVED' | 'TOLL_MORSELS_MISMATCH' | 'INVALID_INPUT';
  message: string;
}

type TollNameResult<T> = { ok: true; value: T } | TollNameRefusal;

interface RenamedField {
  /** The 3.x key inside the object. */
  oldKey: string;
  /** Where the object sits, for the messages: `sharing` or `cost`. */
  parent: string;
  /** The deprecated_use counter kind. */
  kind: string;
}

const KNOWLEDGE_SHARING: RenamedField = { oldKey: 'morsel_price', parent: 'sharing', kind: 'knowledge_morsel_price' };
const CAPABILITY_COST: RenamedField = { oldKey: 'morsels', parent: 'cost', kind: 'capability_cost_morsels' };

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function refuse(code: TollNameRefusal['code'], message: string): TollNameRefusal {
  return { ok: false, status: 400, code, message };
}

/**
 * The object as it is stored: `toll_morsels` and never the old key. Anything that is not a plain
 * object is left to the caller's own validation and comes back unchanged.
 */
function normalizeTollName<T>(obj: T, field: RenamedField, version?: string): TollNameResult<T> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: true, value: obj };
  const rec = obj as Record<string, unknown>;
  const oldPath = `${field.parent}.${field.oldKey}`;
  const newPath = `${field.parent}.${TOLL_MORSELS}`;
  const hasNew = rec[TOLL_MORSELS] !== undefined;
  if (hasNew && !isAmount(rec[TOLL_MORSELS])) {
    return refuse('INVALID_INPUT', `${newPath} is the pacing amount in whole morsels per use: a number of at least 0.`);
  }
  if (rec[field.oldKey] === undefined) return { ok: true, value: obj };

  if (removedFrom(MORSEL_PRICE_NAMES_REMOVED_IN, version)) {
    return refuse('MORSEL_PRICE_REMOVED',
      `${oldPath} was removed in ${MORSEL_PRICE_NAMES_REMOVED_IN}: a morsel is pacing, not a price. Send ${newPath}.`);
  }
  const old = rec[field.oldKey];
  if (!isAmount(old)) {
    return refuse('INVALID_INPUT', `${oldPath} (the old name of ${newPath}) is a number of at least 0.`);
  }
  if (hasNew && rec[TOLL_MORSELS] !== old) {
    return refuse('TOLL_MORSELS_MISMATCH',
      `${newPath} is ${String(rec[TOLL_MORSELS])} and ${oldPath} is ${String(old)}. They are two names for one pacing amount: send ${newPath} only.`);
  }
  noteDeprecatedUse({
    kind: field.kind, removedIn: MORSEL_PRICE_NAMES_REMOVED_IN, successor: newPath,
    notice: `A write named the pacing amount ${oldPath}; it is stored as ${newPath}.`,
  });
  return { ok: true, value: tollNameOnRead(obj, field.oldKey) };
}

/** A knowledge package's `sharing` as it is stored. */
export function normalizeKnowledgeSharing<T>(sharing: T, version?: string): TollNameResult<T> {
  return normalizeTollName(sharing, KNOWLEDGE_SHARING, version);
}

/** A capability's `cost` as it is stored. */
export function normalizeCapabilityCost<T>(cost: T, version?: string): TollNameResult<T> {
  return normalizeTollName(cost, CAPABILITY_COST, version);
}

/** A stored knowledge manifest as a reader is shown it: `sharing.toll_morsels`, never the old name. */
export function presentKnowledgeManifest<T>(manifest: T): T {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const m = manifest as { sharing?: unknown };
  if (!m.sharing || typeof m.sharing !== 'object') return manifest;
  return { ...manifest, sharing: tollNameOnRead(m.sharing, KNOWLEDGE_SHARING.oldKey) };
}
