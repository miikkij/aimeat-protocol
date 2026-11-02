/**
 * @file src/services/connections/drive-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One file of a connected SharePoint or OneDrive: read as text for the person's AI, or
 *   kept as a private file of theirs on this node, with where it came from.
 *
 *   THE TOKEN NEVER GOES TO THE DOWNLOAD. Graph answers a file's `/content` with a redirect to a
 *   pre-authenticated address on the tenant's own host. This reads the item's
 *   `@microsoft.graph.downloadUrl` through the ordinary read path (read.ts, with the token) and then
 *   fetches that address with no Authorization header at all, so the sealed token is sent to Graph
 *   and nowhere else.
 *
 *   SIZE IS ASKED BEFORE THE BYTES. The item says how large the file is, and a file over the node's
 *   per-file limit is refused before a byte is downloaded; the download itself is read under the same
 *   ceiling in case the item lied.
 *
 *   WHERE IT CAME FROM TRAVELS WITH IT. The answer names the item's address in SharePoint, its etag
 *   and when it last changed, and a stored copy carries the item in its tags, so a later read can ask
 *   the library's changes (`changes`, Graph's delta) whether the copy is stale.
 * @structure DriveFile · fetchDriveFile() · driveFileText() · storeDriveFile()
 * @usage const out = await storeDriveFile(ctx, deps, owner, connectionId, { drive_id, item_id }, { caller, app });
 * @version-history
 *   v1.1.0 — 2026-11-02 — storeDriveFile takes the caller and hands it to the storage write, so keeping
 *     a file at a key a page origin serves asks what the file routes ask (secaudit2026nov02d round 13,
 *     drive-files.ts:storeDriveFile:company-page-key-unfenced-no-page-writer).
 *   v1.0.0 — 2026-11-02 — Initial (wish-sharepoint-liitin-tiedostot-luettaviksi-ja-kirjoitettaviksi-).
 */
import type { ConnectContext } from './oauth.js';
import { readResource } from './read.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readBodyCapped } from '../../utils/read-capped.js';
import { writeStorageFile, type StorageWriteDeps } from '../storage-file-write.js';
import type { CallerContext } from '../caller-context.js';
import { extractFileText } from '../file-text/index.js';
import { pdfReadLimits } from '../file-text/pdf-bounded.js';
import { logger } from '../../utils/logger.js';

const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Plain text a person's AI is handed whole: the same ceiling a text attachment has. */
const MAX_PLAIN_TEXT_BYTES = 200 * 1024;

/** Where a file came from, as the answer and the stored copy name it. */
export interface DriveSource {
  drive_id: string;
  item_id: string;
  name: string;
  web_url: string | null;
  etag: string | null;
  last_modified: string | null;
  size: number;
  mime_type: string;
}

export type DriveFileResult =
  | { ok: true; bytes: Buffer; source: DriveSource }
  | { ok: false; status: number; code: string; message: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A read refusal as a status. One mapping, the one the read route uses. */
function statusOf(code: string): number {
  return code === 'NO_SUCH_RESOURCE' || code === 'BAD_PARAMETERS' ? 400
    : code === 'MISSING_PERMISSION' || code === 'REFUSED_BY_PROVIDER' ? 403
      : code === 'NOT_FOUND' ? 404
        : code === 'TOO_LARGE' ? 413
          : code === 'REVOKED' || code === 'UNREADABLE' ? 409 : 502;
}

/** One file's bytes and where it came from, up to `maxBytes`. */
export async function fetchDriveFile(
  ctx: ConnectContext, connectionId: string, input: { drive_id?: unknown; item_id?: unknown }, maxBytes: number,
): Promise<DriveFileResult> {
  const item = await readResource(ctx, connectionId, 'item', { drive_id: input.drive_id, item_id: input.item_id });
  if (!item.ok) return { ok: false, status: statusOf(item.code), code: item.code, message: item.message };

  const d = (item.data && typeof item.data === 'object' ? item.data : {}) as Record<string, unknown>;
  if (d.folder) {
    return { ok: false, status: 422, code: 'NOT_A_FILE', message: 'That is a folder. Read its contents (children) and pick a file.' };
  }
  const size = Number(d.size) || 0;
  if (size > maxBytes) {
    return { ok: false, status: 413, code: 'TOO_LARGE', message: `That file is ${Math.ceil(size / 1024 / 1024)} MB, more than this node takes in one file (${Math.floor(maxBytes / 1024 / 1024)} MB).` };
  }
  const download = text(d['@microsoft.graph.downloadUrl']);
  if (!/^https:\/\//.test(download)) {
    return { ok: false, status: 502, code: 'NO_DOWNLOAD', message: 'The file\'s library gave no download address. It may be a link or a notebook rather than a file.' };
  }
  const file = (d.file && typeof d.file === 'object' ? d.file : {}) as Record<string, unknown>;
  const source: DriveSource = {
    drive_id: text(input.drive_id),
    item_id: text(input.item_id),
    name: text(d.name) || text(input.item_id),
    web_url: text(d.webUrl) || null,
    etag: text(d.eTag) || null,
    last_modified: text(d.lastModifiedDateTime) || null,
    size,
    mime_type: text(file.mimeType) || 'application/octet-stream',
  };

  try {
    // No Authorization header: the address is pre-authenticated, and the token is Graph's alone.
    const resp = await safeFetch(download, { method: 'GET', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!resp.ok || !resp.body) {
      logger.warn(`[connections:drive] download answered ${resp.status}`);
      return { ok: false, status: 502, code: 'DOWNLOAD_FAILED', message: 'The file could not be downloaded just now. Try again shortly.' };
    }
    const bytes = await readBodyCapped(resp, maxBytes);
    if (bytes === null) {
      return { ok: false, status: 413, code: 'TOO_LARGE', message: `That file is larger than this node takes in one file (${Math.floor(maxBytes / 1024 / 1024)} MB).` };
    }
    return { ok: true, bytes, source };
  } catch (err) {
    logger.warn(`[connections:drive] download failed: ${(err as Error).message}`);
    return { ok: false, status: 502, code: 'DOWNLOAD_FAILED', message: 'The file could not be downloaded just now. Try again shortly.' };
  }
}

/**
 * One file as text for the person's AI: a Word document, a spreadsheet or a PDF through the node's
 * own readers (file-text), plain text as it is. Anything else is refused with what it is, so the AI
 * can offer to store it instead.
 */
export async function driveFileText(
  ctx: ConnectContext, connectionId: string, input: { drive_id?: unknown; item_id?: unknown },
): Promise<{ ok: true; text: string; note?: string; source: DriveSource } | { ok: false; status: number; code: string; message: string }> {
  const fileMax = ctx.config.storageMaxFileSizeMb * 1024 * 1024;
  const got = await fetchDriveFile(ctx, connectionId, input, fileMax);
  if (!got.ok) return got;
  const { bytes, source } = got;

  if (/^text\/|json|xml|csv/.test(source.mime_type) || /\.(txt|md|csv|json|xml|html?)$/i.test(source.name)) {
    const clipped = bytes.length > MAX_PLAIN_TEXT_BYTES;
    return {
      ok: true, source,
      text: bytes.subarray(0, MAX_PLAIN_TEXT_BYTES).toString('utf8'),
      ...(clipped ? { note: `Only the first ${MAX_PLAIN_TEXT_BYTES / 1024} kB of ${source.name} are here.` } : {}),
    };
  }
  const extracted = await extractFileText(bytes, source.mime_type, source.name, { pdfLimits: pdfReadLimits(ctx.config) });
  if (!extracted) {
    return {
      ok: false, status: 415, code: 'NOT_READABLE_AS_TEXT',
      message: `${source.name} is not a document this node reads as text (Word, Excel, PDF or plain text). Store it instead, and open it from there.`,
    };
  }
  return { ok: true, text: extracted.text, ...(extracted.note ? { note: extracted.note } : {}), source };
}

/** A file name safe inside a storage key: letters, digits, dot, dash and underscore. */
function safeKeyName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120) || 'file';
}

/**
 * One file kept as a private file of `ownerGhii`, tagged with the item it came from.
 *
 * `writer` is the caller the route or MCP tool serves, handed to the storage write as its
 * `publishGate` the way the generic file routes hand it. A key a page origin serves
 * (`company/<id>/index.html`, `portfolio/index.html`) then asks what those routes ask
 * (services/storage-page-keys.ts): without a writer the fence reads the write as the node's own and
 * asks nothing (secaudit2026nov02d round 13). The file is stored private either way.
 */
export async function storeDriveFile(
  ctx: ConnectContext, deps: StorageWriteDeps, ownerGhii: string, connectionId: string,
  input: { drive_id?: unknown; item_id?: unknown; key?: unknown },
  writer: { caller: CallerContext; app?: string },
): Promise<{ ok: true; key: string; source: DriveSource } | { ok: false; status: number; code: string; message: string }> {
  const fileMax = deps.config.storageMaxFileSizeMb * 1024 * 1024;
  const got = await fetchDriveFile(ctx, connectionId, input, fileMax);
  if (!got.ok) return got;
  const { bytes, source } = got;

  const key = text(input.key) || `sharepoint/${safeKeyName(source.item_id)}/${safeKeyName(source.name)}`;
  const written = await writeStorageFile(deps, ownerGhii, {
    key, data: bytes, mimeType: source.mime_type, visibility: 'private',
    tags: ['sharepoint', `sharepoint-item:${safeKeyName(source.item_id)}`],
    publishGate: writer,
  });
  if (!written.ok) return { ok: false, status: written.status, code: written.code, message: written.message };
  return { ok: true, key, source };
}
