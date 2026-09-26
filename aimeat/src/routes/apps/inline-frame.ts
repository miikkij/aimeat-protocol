/**
 * @file src/routes/apps/inline-frame.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The isolated frame on the app download route (audit A7-1). On a node that several
 *   people share and that has no app origin (services/app-isolation.ts), a runnable app request on
 *   the node's own address gets one of two answers, and neither puts the app's bytes in the node's
 *   origin:
 *     - a browser opening the app gets the page that holds the frame (src/static/app-frame.html). It
 *       carries none of the app's bytes; its script builds an opaque-origin iframe back to
 *       `?mode=frame` and gets the app its own grant;
 *     - everything else (that iframe, `?mode=frame` itself, an API client) gets the bytes with the
 *       CSP `sandbox` directive, and with the frame support script (src/static/app-frame-shim.js,
 *       put in place by utils/app-frame-assets.ts withFrameShim) as the document's first script.
 *   `?mode=frame` is sandboxed on every node, so the address means the same thing wherever it is
 *   used. A node with an app origin never reaches this file (its apex redirects), and a node one
 *   person uses answers 'plain' for `?mode=inline`, exactly as before.
 * @structure RunnableAnswer · runnableAnswer(config, storage, req, mode) · sendFrameHost(res) ·
 *   sandboxedCsp(config) · withFrameShim(body) · FRAME_HOST_CSP
 * @usage
 *   const answer = await runnableAnswer(config, storage, req, 'inline');
 *   if (answer === 'host') { sendFrameHost(res); return; }
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { appIsolationMode } from '../../services/app-isolation.js';
import { appCsp } from '../../utils/app-csp.js';
import { appFrameHostHtml, withFrameShim } from '../../utils/app-frame-assets.js';

/** host: the page that holds the frame · sandboxed: the bytes in an opaque origin · plain: as before. */
export type RunnableAnswer = 'host' | 'sandboxed' | 'plain';

/**
 * The page that holds the frame runs one script of the node's own and nothing inline, frames only the
 * node, and is framed only by the node: an app in its frame cannot put the page inside itself.
 */
export const FRAME_HOST_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * A browser loading a document: a person opening the link, or a page of the node framing it.
 * `Sec-Fetch-Dest` is a header a script cannot set, and a wrong answer here costs nothing either way:
 * the bytes are sandboxed whichever answer is given, and the page only adds the way to sign in.
 */
function isDocumentLoad(req: Request): boolean {
  const dest = String(req.headers['sec-fetch-dest'] ?? '').toLowerCase();
  return dest === 'document' || dest === 'iframe' || dest === 'frame';
}

/** Which answer a runnable request on the node's own address gets. */
export async function runnableAnswer(
  config: AimeatConfig, storage: Storage, req: Request, mode: 'inline' | 'frame',
): Promise<RunnableAnswer> {
  if (mode === 'frame') return 'sandboxed';
  if ((await appIsolationMode(config, storage)) !== 'isolated-frame') return 'plain';
  // Without the static tree the page cannot be served; the bytes still go out sandboxed, only without
  // a page to sign in through.
  return isDocumentLoad(req) && appFrameHostHtml() ? 'host' : 'sandboxed';
}

/** Send the page that holds the frame. The same page for every app and every person. */
export function sendFrameHost(res: Response): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', FRAME_HOST_CSP);
  // Revalidated, so a node version with a newer page reaches the next open.
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(appFrameHostHtml());
}

/** The CSP for the bytes in the frame: the app's usual policy with the `sandbox` directive in front. */
export function sandboxedCsp(config: AimeatConfig): string {
  let nodeOrigin = '';
  // eslint-disable-next-line aimeat/no-silent-catch -- an unparseable baseUrl has no origin to name; 'self' still stands
  try { nodeOrigin = new URL(config.baseUrl).origin; } catch { /* 'self' only */ }
  return appCsp(nodeOrigin, '', { sandboxed: true });
}

/** The support script in front of the app's markup lives with the file it reads (utils/app-frame-assets.ts). */
export { withFrameShim };
