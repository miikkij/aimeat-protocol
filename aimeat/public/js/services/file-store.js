/**
 * @file public/js/services/file-store.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The calls of where stored files keep their bytes (src/routes/file-store.ts), as thin
 *   wrappers over the shared api.js helpers. The person's side (their own named S3 buckets or Azure
 *   containers, one of them the default: read, connect, make default, disconnect, move files between
 *   places) serves the Settings & Controls page "Your own storage" (views/profile/storage-tab.js) and
 *   the Memory tab's upload, which reads the stores a file may be put in; the operator's side (the
 *   environment's store, the server's named stores with their default and who may choose them, a test,
 *   moving files between places, and the decisions on people's own stores) serves the admin page "File
 *   storage" (views/admin/file-stores-tab.js). Every call resolves to the AIMEAT envelope and throws
 *   on a refusal, with the server's `code` and `status` on the error.
 * @structure getMyFileStore · connectMyFileStore · makeMyStoreDefault · removeMyFileStore · moveMyFiles ·
 *   getNodeFileStore · setNodeStore · removeNodeStore · testNodeFileStore · moveNodeFiles ·
 *   decideOwnerFileStore · fileSize
 * @usage import { getMyFileStore } from '/js/services/file-store.js';
 *        const r = await getMyFileStore(); r.data.stores
 * @version-history
 *   v1.2.0 — 2026-10-30 — Named stores (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-):
 *     makeMyStoreDefault; removeMyFileStore(name); moveMyFiles({ to, from, limit }) replaces
 *     moveMyFiles(direction, limit); setNodeStore and removeNodeStore for the server's named stores;
 *     testNodeFileStore(name); moveNodeFiles({ limit, after, from, to }) replaces moveNodeFiles(limit, after).
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
/** The body fields that are set, so an absent option is not sent as `undefined`. */
const given = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ── The person's side ──
/**
 * The rule here, the approval, the person's stores (`stores`, one `default`), where a new file goes
 * (`new_files_go_to`), the stores a file may be put in (`choices`) and the files per place.
 */
export const getMyFileStore = () => apiGet('/v1/file-store');
/**
 * Connect a named store of the person's own, or give one new keys (the same `name`). The node tests it
 * before it saves anything: 200 outcome 'connected' or 202 'waiting_for_operator', both with
 * `test.steps` and the new `view`. `make_default: true` makes it the default.
 */
export const connectMyFileStore = (body) => apiPut('/v1/file-store', body);
/** Make one of the person's stores the default: no test, outcome 'updated'. */
export const makeMyStoreDefault = (name) => apiPut('/v1/file-store', { name, make_default: true });
/** Disconnect the store `name`; refused with FILES_IN_STORE while any file is still in it. */
export const removeMyFileStore = (name) => apiDelete(`/v1/file-store${name ? `?name=${enc(name)}` : ''}`);
/**
 * Move up to `limit` of the person's files to `to` ('home', 'own:<name>' or 'node:<name>'); `from`
 * ('own:<name>', 'node:<name>', 'database') narrows to the files of one place. Answers
 * `{ to, moved, skipped, failed, remaining }`.
 */
export const moveMyFiles = ({ to, from, limit }) => apiPost('/v1/file-store/move', given({ to, from, limit }));

// ── The operator's side ──
/** The environment's store, the named stores, the file counts per place, and every person's stores and requests. */
export const getNodeFileStore = () => apiGet('/v1/admin/file-store');
/**
 * Add a named store of the server, give it new keys (with `kind` and the address: tested first), or
 * change only `selectable` and `make_default` (without `kind`). 201 'added' or 200 'updated'.
 */
export const setNodeStore = (name, body) => apiPut(`/v1/admin/file-store/stores/${enc(name)}`, body);
/** Remove a named store; refused with FILES_IN_STORE while files are in it. The bucket is not touched. */
export const removeNodeStore = (name) => apiDelete(`/v1/admin/file-store/stores/${enc(name)}`);
/** Write, read, read part, list and remove one small object: in the environment's store, or in the named store `name`. */
export const testNodeFileStore = (name) => apiPost('/v1/admin/file-store/test', given({ name }));
/**
 * Move up to `limit` files out of `from` ('database' when not given, or 'node:<name>'), to `to` (a
 * 'node:<name>') or, without it, where each owner's new files go; pass the answer's `next` as `after`.
 */
export const moveNodeFiles = ({ limit, after, from, to }) => apiPost('/v1/admin/file-store/move', given({ limit, after, from, to }));
/** Approve, decline or revoke one person's own store; a decline and a revoke name a note the person reads. */
export const decideOwnerFileStore = (owner, decision, note) =>
  apiPost(`/v1/admin/file-store/owners/${enc(owner)}/decision`, { decision, ...(note ? { note } : {}) });
