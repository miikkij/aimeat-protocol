/**
 * @file public/views/profile/storage/store-words.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words for a store and for a refusal about one, shared by the page "Your own storage"
 *   (views/profile/storage-tab.js), the admin page "File storage" (views/admin/file-stores-tab.js) and
 *   the Memory tab's upload and file list (views/profile/memory-tab/). The API names a place by a store
 *   id: `database`, `node:<name>` (a named store of the server; `node:s3` and `node:azure` are the store
 *   the environment names), `own:<name>` (one of the person's own stores). A person reads these as
 *   "this service", "the service's store "x"" and "your store "x""; an operator reads the database, the
 *   store set on the Config page and the store "x". A refusal's code becomes a sentence in the reader's
 *   language, with the server's own message kept as the detail where it names something the reader can
 *   act on (the step of a test, the missing fields).
 * @structure storeNameOf · isEnvStore · storeWords · storeShort · refusalWords · RefusalNote
 * @usage storeWords('own:archive')                  // "your store "archive""
 *        storeWords('node:s3', { operator: true })  // "the store set on the Config page"
 *        const { text, detail } = refusalWords(err);
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);

/** The kinds the environment's store is named by: `node:s3` and `node:azure` are not named stores. */
const ENV_KINDS = new Set(['s3', 'azure']);
/** The refusals a screen says in its own words; any other code shows the server's message. */
const KNOWN = new Set([
  'FILES_IN_STORE', 'STORE_TEST_FAILED', 'STORE_ALREADY_CONNECTED', 'UNKNOWN_STORE', 'STORE_NOT_SELECTABLE',
  'STORE_NOT_TAKING_FILES', 'STORE_NOT_REACHABLE', 'NO_ENCRYPTION_KEY', 'OWNER_FILE_STORES_OFF', 'INVALID_INPUT',
  'NO_OWN_STORAGE',
]);
/** The refusals whose server message names what to fix (the failed step, the missing fields, the count). */
const WITH_DETAIL = new Set(['STORE_TEST_FAILED', 'INVALID_INPUT', 'FILES_IN_STORE']);

/** The name part of a store id ('own:archive' → 'archive'), or '' for `database` and `home`. */
export function storeNameOf(id) {
  const s = String(id || '');
  const colon = s.indexOf(':');
  return colon < 0 ? '' : s.slice(colon + 1);
}

/** Whether the id is the store the environment names (`node:s3`, `node:azure`), not a named store. */
export function isEnvStore(id) {
  const s = String(id || '');
  return s.startsWith('node:') && ENV_KINDS.has(storeNameOf(s));
}

/**
 * A store id in the reader's words. `operator` speaks to the person who runs the server, who knows the
 * database and the Config page apart; a person reads both as "this service".
 * @param {string} id @param {{ operator?: boolean }} [opts]
 */
export function storeWords(id, opts = {}) {
  const s = String(id || 'database');
  const who = opts.operator ? 'operator' : 'person';
  const name = storeNameOf(s);
  if (s === 'database' || s === 'home') return t(`fileStore.at.${who}.database`);
  if (isEnvStore(s)) return t(`fileStore.at.${who}.env`);
  if (s.startsWith('own:')) return t(`fileStore.at.${who}.own`, { name });
  if (s.startsWith('node:')) return t(`fileStore.at.${who}.node`, { name });
  return s;
}

/**
 * A file's store as a short phrase inside a line ("in your store "x""), for a named store only: '' for
 * the database and the store the environment names, where a person never chose anything.
 */
export function storeShort(id) {
  const s = String(id || 'database');
  if (s === 'database' || isEnvStore(s)) return '';
  if (s.startsWith('own:')) return t('fileStore.at.short.own', { name: storeNameOf(s) });
  if (s.startsWith('node:')) return t('fileStore.at.short.node', { name: storeNameOf(s) });
  return '';
}

/**
 * A refusal in the reader's words: `text` the sentence, `detail` the server's own message where it
 * names what to fix (else ''). A code no screen knows shows the server's message as the text.
 * @param {any} e the error api.js threw
 * @returns {{ text: string, detail: string }}
 */
export function refusalWords(e) {
  const code = e && e.code;
  const message = (e && e.message) || '';
  if (!code || !KNOWN.has(code)) return { text: message || t('common.error'), detail: '' };
  return { text: t('fileStore.refusal.' + code), detail: WITH_DETAIL.has(code) ? message : '' };
}

/**
 * A refusal under the control that met it: the sentence as an error message, the server's detail as a
 * hint under it. `refusal` is what refusalWords gave, or null for nothing.
 */
export function RefusalNote({ refusal }) {
  if (!refusal) return null;
  return html`
    <${Note} kind="message" error>${refusal.text}<//>
    ${refusal.detail ? html`<${Note} kind="hint">${refusal.detail}<//>` : null}`;
}
