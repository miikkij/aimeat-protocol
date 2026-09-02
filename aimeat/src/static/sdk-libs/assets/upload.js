/**
 * @file assets/upload.js
 * @description Putting a file where everyone can load it, and getting back the address a manifest
 *   entry carries.
 *
 *   THERE ARE TWO ADDRESSES FOR A STORED FILE AND ONLY ONE OF THEM IS FOR ASSETS.
 *   /v1/storage/<key> (which AIMEAT.storage.publicUrl builds) needs an Authorization header, so it
 *   works for the person who owns the file and for nobody else: a player who is signed out, or
 *   signed in as themselves, gets nothing. /v1/pub/<owner-ghii>/<key> is the anonymous read, and it
 *   is the address every asset in a manifest uses. That is why `visibility: 'public'` is the
 *   default here and why anything else is called out at the time it is uploaded, rather than
 *   discovered as a broken sprite later.
 *
 *   THE UPLOAD IS THE APP'S OWN CALL. This library never uploads on its own, never sweeps a
 *   folder, never retries in the background. The app hands it a file, it hands back an address.
 * @structure publicAddress() · upload(file, opts)
 * @usage
 *   const put = await AIMEAT.assets.upload(pngBlob, { app: 'ridge', key: 'ridge/hero.png' });
 *   lib.add('images', 'hero', { file: put.url, w: 32, h: 40, bytes: put.bytes });
 *   await lib.save();
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the public upload and the /v1/pub address it answers with.
 */
import { refuse } from './manifest.js';

/** The storage library, when the page loaded one. */
function storageLib() {
  const root = typeof window !== 'undefined' ? /** @type {any} */ (window).AIMEAT : null;
  return root && root.storage ? root.storage : null;
}

/**
 * The anonymous address of a stored file: what a player's browser asks for, with no header and no
 * account. Each path segment is encoded on its own, so a key with a slash in it stays a path.
 * @param {string} ownerGhii   the file owner, 'alice@node-id'
 * @param {string} key
 * @returns {string}
 */
export function publicAddress(ownerGhii, key) {
  const owner = encodeURIComponent(String(ownerGhii || ''));
  const path = String(key || '').split('/').map(encodeURIComponent).join('/');
  return '/v1/pub/' + owner + '/' + path;
}

/**
 * What a file is called in storage when the app did not say: the app's own folder, the kind, and
 * the file's name. It reads as a path in a listing, which is what makes a manifest base worth having.
 * @param {any} file
 * @param {{ app?: string, kind?: string, key?: string }} opts
 * @returns {string}
 */
function storageKey(file, opts) {
  if (opts.key) return String(opts.key);
  const name = (file && typeof file.name === 'string' && file.name) ? file.name : 'file-' + Date.now();
  const parts = [];
  if (opts.app) parts.push(String(opts.app));
  if (opts.kind) parts.push(String(opts.kind));
  parts.push(name);
  return parts.join('/');
}

/**
 * @typedef {object} UploadOptions
 * @property {string} [app]         the app this file belongs to, used to name it in storage
 * @property {string} [key]         the storage key, when the app names it itself
 * @property {string} [kind]        'images' | 'audio' | 'fonts' | …, a folder inside the app's
 * @property {'public'|'private'} [visibility]  'public' by default, because a player has to read it
 * @property {string} [mime_type]
 */

/**
 * Upload one file and get back the address to write into the manifest.
 *
 * @param {File|Blob|string} file    a File, a Blob, or base64 text
 * @param {UploadOptions} [opts]
 * @returns {Promise<{ key: string, url: string, bytes: number }>}
 */
export async function upload(file, opts) {
  const store = storageLib();
  if (!store || typeof store.upload !== 'function') {
    refuse('upload() needs the storage library. Add '
      + '<script src="/v1/libs/aimeat-storage.js"></script> to the page (after aimeat-auth.js), or '
      + 'upload the file another way and pass its /v1/pub/<owner>/<key> address to add() yourself.');
  }
  const o = opts || /** @type {UploadOptions} */ ({});
  const key = storageKey(file, o);
  const visibility = o.visibility || 'public';
  if (visibility !== 'public') {
    console.warn('[aimeat-assets] "' + key + '" is being uploaded as ' + visibility + '. A player '
      + 'who is not you cannot read it, so a manifest entry pointing at it will draw nothing. '
      + 'Upload assets as public and keep saves private.');
  }

  /** @type {any} */
  const written = await store.upload(file, {
    key: key,
    visibility: visibility,
    mime_type: o.mime_type || (file && /** @type {any} */ (file).type) || undefined,
  });

  const owner = written && (written.owner_gaii || written.ownerGaii);
  const url = (written && written.embed_url)
    || (owner ? publicAddress(owner, written.key || key) : '');
  if (!url) {
    refuse('the upload of "' + key + '" answered without an address. Nothing was written to the '
      + 'manifest; check the file in storage before trying again.');
  }
  return {
    key: (written && written.key) || key,
    url: url,
    bytes: (written && typeof written.size === 'number') ? written.size : 0,
  };
}
