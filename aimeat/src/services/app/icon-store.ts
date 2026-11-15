/**
 * @file src/services/app/icon-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Set the icon IMAGE of a published app without republishing it: the PNG an iPhone puts
 *   on its home screen and Android mints a WebAPK with. One implementation for
 *   POST /v1/apps/:owner/:filename/icon and the aimeat_app_manage action icon_upload, so the PNG
 *   check, the size limit, the storage key and the bucket are written once.
 *
 *   TWO SOURCES FOR THE BYTES. `icon` is the PNG as base64. `storageKey` names a file the CALLER
 *   already stored with aimeat_storage_upload or POST /v1/storage, read from the caller's own
 *   namespace. The second exists because an agent connected over MCP stores a picture with the
 *   upload tool, and that tool writes to the agent's own namespace by design: the icon is read from
 *   the app OWNER's namespace under apps/icons/<filename>, so a picture an agent uploaded never
 *   became the icon, and no tool said so (an app's agent hit this on 2026-11-14). Naming the file
 *   here copies its bytes into the owner's bucket under the icon key.
 *
 *   The stored file is read through services/file-refs.ts resolveFileRef (the read guard and the
 *   caller's classification reader, as GET /v1/storage/{key} reads), always in the caller's own
 *   namespace, and it must be allowed to leave, because the icon is served to anybody: a file the
 *   caller may not see answers as absent, and a file whose label keeps it in its organism is refused.
 *
 *   Authorisation stays with the caller, as in screenshot-store.ts: the route passes its gate,
 *   which runs after the app lookup and before the input check; the MCP handler resolves the
 *   target first and passes none.
 * @structure AppIconRefusal · AppIconGate · storeAppIcon
 * @usage
 *   const out = await storeAppIcon({ storage, config }, { owner, filename, icon, storageKey, reader });
 *   if (!out.ok) return refuse(out.status, out.code, out.message);
 * @version-history
 *   v1.0.0 — 2026-11-15 — Extracted from POST /v1/apps/:owner/:filename/icon (routes/apps/icon.ts),
 *     with `storageKey` added (wish-kirjautumista-vaativa-sovellus-asentuu-puhelimeen-ja-agentti).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AppRecord } from '../../storage/types/apps.js';
import type { ContentReader } from '../classification/reader.js';
import { fileTarget } from '../classification/labels.js';
import { resolveFileRef, fileRefFor } from '../file-refs.js';
import { emitChange } from '../event-bus.js';
import { decodeStrictBase64 } from '../../utils/base64.js';
import { localAccountName } from '../../utils/gaii.js';
import { appIconKey } from './seo.js';

/** A square icon, 512 pixels at the very most, so a megabyte is already generous. */
export const MAX_ICON_SIZE = 1024 * 1024;

/** A refusal, with the HTTP status the REST route answers and the code both interfaces carry. */
export interface AppIconRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

/** The caller's authorisation, asked after the app is found. Null lets the call continue. */
export type AppIconGate = (app: AppRecord) => Promise<AppIconRefusal | null>;

/** The data part of the answer, key order included. */
export interface AppIconStored {
  filename: string;
  owner: string;
  icon_url: string;
  /** Where the bytes came from: the request itself, or the caller's stored file. */
  source: 'inline' | 'storage';
  size_bytes: number;
}

const refuse = (status: number, code: string, message: string): AppIconRefusal => ({ ok: false, status, code, message });

/** Path traversal protection (defense in depth): the filename is one path segment. */
function unsafeFilename(filename: string): boolean {
  const decoded = decodeURIComponent(filename);
  return decoded.includes('..') || decoded.includes('/') || decoded.includes('\\')
    || decoded.includes('%2f') || decoded.includes('%2F')
    || decoded.includes('%5c') || decoded.includes('%5C')
    || decoded.includes('\0');
}

/** PNG, CHECKED RATHER THAN BELIEVED: the magic number is the test, never a caller's mime type. */
function isPng(data: Buffer): boolean {
  return data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47;
}

/**
 * The bytes of a file the caller stored, read from the caller's own namespace through its reader,
 * and allowed to leave as a public picture. A file the caller may not see is absent.
 */
async function callerStoredBytes(
  deps: { storage: Storage; config: AimeatConfig }, reader: ContentReader, key: string, appRef: string,
): Promise<{ ok: true; data: Buffer } | AppIconRefusal> {
  const owner = reader.identity;
  const missing = refuse(404, 'NOT_FOUND', `You have no stored file "${key}". Upload the PNG with aimeat_storage_upload first, then name its key here.`);
  if (!owner) return missing;
  // The reference is built here with the caller's own identity, so a key shaped like another
  // person's reference ("bob@node/x.png") is a key in the caller's namespace, never a foreign read.
  const resolved = await resolveFileRef(deps.storage, deps.config, fileRefFor(owner, key), {
    gaii: owner, sub: reader.auth?.sub, owner: reader.auth?.owner, reader,
  });
  if (resolved.access !== 'granted' || !resolved.file || resolved.ownerGaii !== owner) return missing;
  const file = resolved.file;
  if (file.size > MAX_ICON_SIZE) {
    return refuse(413, 'TOO_LARGE', `The file "${key}" is ${file.size} bytes; an icon is at most 1 MB.`);
  }
  const { left } = await reader.leave([key], (k) => fileTarget(owner, k, file.workspaceRef), { kind: 'external', to: `app-icon:${appRef}` });
  if (left.length) {
    return refuse(403, 'CLASSIFIED', `"${key}" is ${left[0]!.reason}, so it cannot become an icon that anybody can see.`);
  }
  return { ok: true, data: Buffer.from(file.data) };
}

/**
 * Set or replace an app's icon image. createStorageFile upserts, so this overwrites an existing one.
 * Exactly one of `icon` (base64 PNG) and `storageKey` (a file in the caller's own namespace, which
 * needs `reader`) is given.
 */
export async function storeAppIcon(
  deps: { storage: Storage; config: AimeatConfig },
  input: { owner: string; filename: string; icon?: unknown; storageKey?: unknown; reader?: ContentReader },
  authorize?: AppIconGate,
): Promise<{ ok: true; data: AppIconStored } | AppIconRefusal> {
  const { storage } = deps;
  const { filename } = input;
  const owner = localAccountName(input.owner);
  if (unsafeFilename(filename)) return refuse(400, 'INVALID_FILENAME', 'Filename contains invalid characters');

  const app = await storage.getAppByOwnerName(owner, filename);
  if (!app) return refuse(404, 'NOT_FOUND', `App "${filename}" not found for owner "${owner}"`);
  const refused = authorize ? await authorize(app) : null;
  if (refused) return refused;

  const hasIcon = typeof input.icon === 'string' && input.icon !== '';
  const hasKey = typeof input.storageKey === 'string' && input.storageKey !== '';
  if (hasIcon === hasKey) {
    return refuse(400, 'INVALID_INPUT', 'Give exactly one of icon (the PNG as base64) and storage_key (a PNG you stored with aimeat_storage_upload).');
  }

  let data: Buffer;
  if (hasKey) {
    if (!input.reader) return refuse(400, 'INVALID_INPUT', 'storage_key needs a signed-in caller whose stored files can be read.');
    const read = await callerStoredBytes(deps, input.reader, input.storageKey as string, `${app.ownerName}/${filename}`);
    if (!read.ok) return read;
    data = read.data;
  } else {
    const decoded = decodeStrictBase64(input.icon as string);
    if (!decoded) return refuse(400, 'INVALID_INPUT', 'icon must be base64-encoded image data');
    data = decoded;
  }
  if (data.length > MAX_ICON_SIZE) return refuse(413, 'TOO_LARGE', `Icon exceeds 1MB limit (${data.length} bytes)`);
  // An SVG stored here would be accepted, served, and silently ignored by the one surface it exists for.
  if (!isPng(data)) {
    return refuse(400, 'INVALID_INPUT', 'The icon must be a PNG. An iPhone home screen ignores SVG, which is the one place this icon is for.');
  }

  await storage.createStorageFile({
    key: appIconKey(filename),
    ownerGaii: app.ownerGaii,   // the app row's bucket, so GET .../icon and the app origin find it
    visibility: 'public',
    mimeType: 'image/png',
    size: data.length,
    data,
    createdAt: new Date().toISOString(),
  });

  emitChange('apps');
  return {
    ok: true,
    data: {
      filename,
      owner: app.ownerName,
      icon_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(filename)}/icon`,
      source: hasKey ? 'storage' : 'inline',
      size_bytes: data.length,
    },
  };
}
