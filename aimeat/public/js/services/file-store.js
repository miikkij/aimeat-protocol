/**
 * @file public/js/services/file-store.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The calls of where stored files keep their bytes (src/routes/file-store.ts), as thin
 *   wrappers over the shared api.js helpers. The person's side (their own S3 bucket or Azure container:
 *   read, connect, disconnect, move files in or back out) serves the Settings & Controls page "Your own
 *   storage" (views/profile/storage-tab.js); the operator's side (the node's store, its test, moving
 *   older files out of the database, and the decisions on people's own stores) serves the admin page
 *   "File storage" (views/admin/file-stores-tab.js). Every call resolves to the AIMEAT envelope and
 *   throws on a refusal, with the server's `code` and `status` on the error.
 * @structure getMyFileStore · connectMyFileStore · removeMyFileStore · moveMyFiles · getNodeFileStore ·
 *   testNodeFileStore · moveNodeFiles · decideOwnerFileStore · fileSize
 * @usage import { getMyFileStore } from '/js/services/file-store.js';
 *        const r = await getMyFileStore(); r.data.store
 * @version-history
 *   v1.1.1 — 2026-10-29 — fileSize counts in thousands (1 kB = 1000 B), as the symbols kB, MB and GB say;
 *     it divided by 1024.
 *   v1.1.0 — 2026-10-29 — fileSize: a byte count in the unit that fits (B, kB, MB, GB), so a few small
 *     files no longer read "0 MB". fmtBytes in /js/format.js stops at MB, and a store holds gigabytes.
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';
import { num } from '/js/format.js';

/** @type {Array<{ unit: string, size: number }>} */
const UNITS = [{ unit: 'GB', size: 1000 ** 3 }, { unit: 'MB', size: 1000 ** 2 }, { unit: 'kB', size: 1000 }];

/**
 * A byte count in the largest unit it fills (B, kB, MB, GB), one decimal under 10 and none above, in
 * the reader's own number style. The units are decimal SI units (1 kB = 1000 B), as their symbols say;
 * the symbols are the same in English, Finnish and Spanish.
 */
export function fileSize(bytes) {
  const b = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  for (const { unit, size } of UNITS) {
    if (b >= size) {
      const v = b / size;
      return `${num(v < 10 ? Math.round(v * 10) / 10 : Math.round(v))} ${unit}`;
    }
  }
  return `${num(b)} B`;
}

const enc = encodeURIComponent;

// ── The person's side ──
/** The rule here, the approval, the connected store and the person's file counts. */
export const getMyFileStore = () => apiGet('/v1/file-store');
/**
 * Connect (or replace) the person's own store. The node tests it before it saves anything: 200
 * outcome 'connected' or 202 'waiting_for_operator', both with `test.steps` and the new `view`.
 */
export const connectMyFileStore = (body) => apiPut('/v1/file-store', body);
/** Disconnect it; refused with FILES_IN_STORE while any file is still in it. */
export const removeMyFileStore = () => apiDelete('/v1/file-store');
/** Move up to `limit` files: 'own' into the person's store, 'home' back to the node. */
export const moveMyFiles = (direction, limit) => apiPost('/v1/file-store/move', { direction, ...(limit ? { limit } : {}) });

// ── The operator's side ──
/** The node's store, the file counts per place, and every person's store and request. */
export const getNodeFileStore = () => apiGet('/v1/admin/file-store');
/** Write, read, read part, list and remove one small object in the node's store. */
export const testNodeFileStore = () => apiPost('/v1/admin/file-store/test', {});
/** Move up to `limit` files out of the database; pass the answer's `next` as `after` to go on. */
export const moveNodeFiles = (limit, after) => apiPost('/v1/admin/file-store/move', { ...(limit ? { limit } : {}), ...(after ? { after } : {}) });
/** Approve, decline or revoke one person's own store; a decline and a revoke name a note the person reads. */
export const decideOwnerFileStore = (owner, decision, note) =>
  apiPost(`/v1/admin/file-store/owners/${enc(owner)}/decision`, { decision, ...(note ? { note } : {}) });
