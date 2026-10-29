/**
 * @file src/storage/blob/blob-http.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The HTTP and XML pieces the S3 and Azure Blob clients share: RFC 3986 encoding of an
 *   object key, reading the few XML elements a listing or an error carries, and turning a failed
 *   answer into a BlobStoreError whose message a person can act on. Both services answer in XML, and
 *   only a handful of elements are ever read, so this reads them by name rather than parsing a tree.
 * @structure uriEncode · xmlValues · xmlValue · failure · bodyBuffer · bodyText · drain ·
 *   SMALL_BODY_MAX_BYTES · OBJECT_READ_MAX_BYTES (every answer is read under a ceiling)
 * @usage const keys = xmlValues(text, 'Key');
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { BlobStoreError } from './blob-types.js';
import { readBodyCapped, readBodyPrefix, readTextCapped } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';

/**
 * RFC 3986 percent-encoding: every byte except `A-Z a-z 0-9 - _ . ~`. encodeURIComponent leaves
 * `! ' ( ) *` alone, and a signature computed over a path that the server encodes differently is
 * refused, so those five are encoded here too. `keepSlash` leaves `/` as it is, for an object key.
 */
export function uriEncode(s: string, keepSlash: boolean): string {
  const out = encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? out.replace(/%2F/g, '/') : out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlDecode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (_m, name: string, dec?: string, hex?: string) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name]);
}

/**
 * The text of every `<tag>…</tag>` in `xml`, in order. An element that holds other elements (one
 * `<Contents>` of a listing) is read with `raw`, so its inner values are decoded once, when they are
 * read, and a key containing `&amp;lt;` does not turn into `<`.
 */
export function xmlValues(xml: string, tag: string, raw = false): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(raw ? m[1] : xmlDecode(m[1]));
  return out;
}

export function xmlValue(xml: string, tag: string): string | undefined {
  return xmlValues(xml, tag)[0];
}

/**
 * A BlobStoreError for an answer that was not a success. The store's own code (`AccessDenied`,
 * `AuthenticationFailed`, `NoSuchBucket`, `ContainerNotFound`) is kept, because it is what tells an
 * operator which setting is wrong; the status alone does not.
 */
export async function failure(res: Response, what: string, where: string): Promise<BlobStoreError> {
  let text = '';
  try {
    text = (await readTextCapped(res, SMALL_BODY_MAX_BYTES)) ?? '';
  } catch (err) {
    // The status below is still reported; only the store's own code and message are missing.
    logger.warn('file store: an error answer could not be read', { where, status: res.status, error: err instanceof Error ? err.message : String(err) });
  }
  const code = xmlValue(text, 'Code') ?? res.headers.get('x-ms-error-code') ?? `HTTP_${res.status}`;
  const detail = xmlValue(text, 'Message')?.split('\n')[0].trim().replace(/\.+$/, '');
  return new BlobStoreError(`${what} failed at ${where}: ${res.status} ${code}${detail ? ` (${detail})` : ''}`, res.status, code);
}

/** An error answer, a listing page: a store's own answers that are not file bytes. */
export const SMALL_BODY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The largest object a read takes: 5 GiB, the most one S3 PUT (and so one write here) can store, and
 * far above the node's own per-file ceiling (1024 MB at most). A larger answer is refused rather than
 * held, because something other than this node wrote it.
 */
export const OBJECT_READ_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** An object's bytes, read under OBJECT_READ_MAX_BYTES. */
export async function bodyBuffer(res: Response, where: string): Promise<Buffer> {
  const body = await readBodyCapped(res, OBJECT_READ_MAX_BYTES);
  if (body === null) throw new BlobStoreError(`An object at ${where} is larger than ${OBJECT_READ_MAX_BYTES} bytes`, res.status, 'TOO_LARGE');
  return body;
}

/** A listing's XML, read under SMALL_BODY_MAX_BYTES. */
export async function bodyText(res: Response, where: string): Promise<string> {
  const text = await readTextCapped(res, SMALL_BODY_MAX_BYTES);
  if (text === null) throw new BlobStoreError(`A listing from ${where} is larger than ${SMALL_BODY_MAX_BYTES} bytes`, res.status, 'TOO_LARGE');
  return text;
}

/** Read and drop an answer whose body says nothing (a stored object's ETag, a 404), so the
 *  connection goes back to the pool. Bounded, so a store that answers with megabytes cannot hold us. */
export async function drain(res: Response): Promise<void> {
  await readBodyPrefix(res, 64 * 1024);
}
