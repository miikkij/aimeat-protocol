/**
 * @file src/services/app-screenshot-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Set or clear the screenshot of a published app WITHOUT re-publishing it. One
 *   implementation for POST and DELETE /v1/apps/:owner/:filename/screenshot and the MCP tool, so the
 *   filename check, the image check, the storage key, the bucket and the change event are written
 *   once.
 *
 *   Authorisation stays with the caller, because each surface knows its caller differently. The
 *   REST route passes an `authorize` gate that runs after the app lookup and before the input check,
 *   which is the order the route has always refused in. An MCP handler that resolved the owner
 *   before the call passes no gate.
 * @structure
 *   - AppScreenshotRefusal — the refusal a caller renders (`CODE: message` on MCP, the envelope on REST)
 *   - AppScreenshotGate — the caller's authorisation, asked with the resolved app
 *   - storeAppScreenshot() — validate the base64 image and store it under the app's bucket (upsert)
 *   - clearAppScreenshot() — delete the stored screenshot; auto-capture makes a new one later
 * @usage
 *   const out = await storeAppScreenshot(storage, { owner, filename, screenshot, screenshot_mime_type });
 *   if (!out.ok) return refuse(out.status, out.code, out.message);
 * @version-history
 *   v1.0.0 — 2026-09-27 — Extracted from the POST and DELETE screenshot routes in
 *     src/routes/apps/read.ts, so the MCP tool can call the same code. REST answers are unchanged.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AppRecord } from '../storage/types/apps.js';
import { emitChange } from './event-bus.js';
import { decodeStrictBase64 } from '../utils/base64.js';
import { imageUploadType } from '../utils/raster-image.js';
import { localAccountName } from '../utils/gaii.js';

/** Largest screenshot the node stores, in bytes. */
const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024;

/** A refusal, with the HTTP status the REST route answers and the code both surfaces carry. */
export interface AppScreenshotRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

/**
 * The caller's authorisation, asked after the app is found. Null lets the call continue; a refusal
 * is returned to the caller as it is.
 */
export type AppScreenshotGate = (app: AppRecord) => Promise<AppScreenshotRefusal | null>;

/** Which app: the raw owner segment (the legacy `owner@node` form is accepted) and the filename. */
export interface AppScreenshotTarget {
  owner: string;
  filename: string;
}

/** The data part of the POST answer, key order included. */
export interface AppScreenshotStored {
  filename: string;
  owner: string;
  screenshot_url: string;
}

/** The data part of the DELETE answer, key order included. */
export interface AppScreenshotCleared {
  filename: string;
  owner: string;
  cleared: true;
  note: string;
}

/** Path traversal protection (defense in depth): the filename is one path segment. */
function unsafeFilename(filename: string): boolean {
  const decodedFn = decodeURIComponent(filename);
  return decodedFn.includes('..') || decodedFn.includes('/') || decodedFn.includes('\\')
    || decodedFn.includes('%2f') || decodedFn.includes('%2F')
    || decodedFn.includes('%5c') || decodedFn.includes('%5C')
    || decodedFn.includes('\0');
}

/** The filename check, the app lookup and the caller's gate, in the order the routes refuse in. */
async function resolveScreenshotApp(
  storage: Storage, target: AppScreenshotTarget, authorize: AppScreenshotGate | undefined,
): Promise<{ ok: true; app: AppRecord } | AppScreenshotRefusal> {
  const { filename } = target;
  const owner = localAccountName(target.owner);
  if (unsafeFilename(filename)) {
    return { ok: false, status: 400, code: 'INVALID_FILENAME', message: 'Filename contains invalid characters' };
  }
  const app = await storage.getAppByOwnerName(owner, filename);
  if (!app) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `App "${filename}" not found for owner "${owner}"` };
  }
  const refused = authorize ? await authorize(app) : null;
  if (refused) return refused;
  return { ok: true, app };
}

/**
 * Set or replace an app's screenshot. createStorageFile upserts, so this overwrites an existing one.
 *
 * `screenshot` is base64 image data, at most 2 MB decoded. The bytes must be a PNG, JPEG, WebP, GIF
 * or AVIF image and are stored as the type they are; `screenshot_mime_type`, when given, must name
 * that type.
 */
export async function storeAppScreenshot(
  storage: Storage,
  input: AppScreenshotTarget & { screenshot?: unknown; screenshot_mime_type?: unknown },
  authorize?: AppScreenshotGate,
): Promise<{ ok: true; data: AppScreenshotStored } | AppScreenshotRefusal> {
  const found = await resolveScreenshotApp(storage, input, authorize);
  if (!found.ok) return found;
  const { app } = found;
  const { filename, screenshot, screenshot_mime_type } = input;

  if (!screenshot || typeof screenshot !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'screenshot (base64 image) is required' };
  }
  const screenshotData = decodeStrictBase64(screenshot);
  if (!screenshotData) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'screenshot must be base64-encoded image data' };
  }
  if (screenshotData.length > MAX_SCREENSHOT_SIZE) {
    return { ok: false, status: 413, code: 'TOO_LARGE', message: `Screenshot exceeds 2MB limit (${screenshotData.length} bytes)` };
  }
  // CHECKED, NOT BELIEVED, like the icon. The bytes must be a PNG, JPEG, WebP, GIF or AVIF image
  // and are stored as the type they are; a label naming anything else is refused, because the
  // GET route serves this key to anybody from the node's own origin (A7-2).
  const screenshotMime = imageUploadType(screenshotData, screenshot_mime_type);
  if (!screenshotMime) {
    return {
      ok: false, status: 400, code: 'INVALID_INPUT',
      message: 'A screenshot must be a PNG, JPEG, WebP, GIF or AVIF image, and screenshot_mime_type, when given, must say which.',
    };
  }

  await storage.createStorageFile({
    key: `apps/screenshots/${filename}`,
    ownerGaii: app.ownerGaii,   // match the app row's bucket so the GET route finds it
    visibility: 'public',
    mimeType: screenshotMime,
    size: screenshotData.length,
    data: screenshotData,
    createdAt: new Date().toISOString(),
  });

  emitChange('apps');
  return {
    ok: true,
    data: {
      filename,
      owner: app.ownerName,
      screenshot_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(filename)}/screenshot`,
    },
  };
}

/**
 * Clear an app's screenshot without rendering a new one. The node's scheduled auto-capture job
 * makes a new one on its next scan; `note` says whether that job is on.
 */
export async function clearAppScreenshot(
  storage: Storage,
  config: AimeatConfig,
  target: AppScreenshotTarget,
  authorize?: AppScreenshotGate,
): Promise<{ ok: true; data: AppScreenshotCleared } | AppScreenshotRefusal> {
  const found = await resolveScreenshotApp(storage, target, authorize);
  if (!found.ok) return found;
  const { app } = found;
  const { filename } = target;

  await storage.deleteStorageFile(app.ownerGaii, `apps/screenshots/${filename}`);
  emitChange('apps');
  return {
    ok: true,
    data: {
      filename,
      owner: app.ownerName,
      cleared: true,
      note: config.screenshotAutoCapture
        ? 'Screenshot cleared. The node will capture a fresh one on its next scheduled scan.'
        : 'Screenshot cleared. Auto-capture is off on this node — set a new one manually, or enable AIMEAT_SCREENSHOT_AUTO.',
    },
  };
}
