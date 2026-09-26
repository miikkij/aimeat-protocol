/**
 * @file src/utils/app-frame-assets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three files of the isolated frame (audit A7-1), read off disk once: the page that
 *   holds an app on a node several people share (src/static/app-frame.html), its script
 *   (src/static/app-frame.js), and the script the node puts in front of the app's own markup
 *   (src/static/app-frame-shim.js). They are real files rather than strings in this module so an
 *   editor, a linter and `node --check` can read them, the same reason app-sw-source.ts gives.
 * @structure appFrameHostHtml() · appFrameHostScript() · appFrameCoreScript() · appFrameShimSource() — each the file's text,
 *   or null when the static tree was not shipped with this node. Cached after the first read.
 *   FRAME_SUPPORT_MARK · withFrameShim(body) — the support script put in front of an app's markup,
 *   under the attribute services/app-serve-marks-strip.ts recognises it by.
 * @usage
 *   import { appFrameHostHtml } from '../utils/app-frame-assets.js';
 *   const html = appFrameHostHtml(); if (html) res.send(html);
 * @version-history
 *   v1.1.0 — 2026-09-26 — appFrameCoreScript(): the grant and consent module app-frame.js imports.
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetDir } from '../server-bootstrap/asset-dirs.js';

/** Each file once read. `undefined` means "not looked for yet"; `null` means "not there". */
const cache = new Map<string, string | null>();

/**
 * One file of the static tree, or null. resolveAssetDir carries the four layouts the node runs in;
 * src/static is the tree whose name changes in the package (src/static → dist/static), so the path
 * is never built by hand here.
 */
function staticFile(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  const dir = resolveAssetDir('static', dirname(fileURLToPath(import.meta.url)), process.cwd());
  let text: string | null = null;
  if (dir) {
    try {
      text = readFileSync(join(dir, name), 'utf-8');
    } catch (err) {
      // The tree exists and the file does not: a packaging fault. Said once; the callers fall back
      // to serving the app sandboxed without the page around it.
      console.warn(`[app-frame] src/static/${name} is not readable: ${(err as Error).message}`);
    }
  }
  cache.set(name, text);
  return text;
}

/** The page that holds an app in the isolated frame. */
export function appFrameHostHtml(): string | null {
  return staticFile('app-frame.html');
}

/** That page's script, served at /app-frame.js. */
export function appFrameHostScript(): string | null {
  return staticFile('app-frame.js');
}

/** The grant and consent module that script imports, served at /app-frame-core.js (the App Catalog bundles it). */
export function appFrameCoreScript(): string | null {
  return staticFile('app-frame-core.js');
}

/**
 * The script put in front of an app in the isolated frame, without its leading comment block: it
 * goes into every app the frame serves, and the header is for the people reading the file.
 */
export function appFrameShimSource(): string | null {
  const text = staticFile('app-frame-shim.js');
  return text === null ? null : text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '');
}

/**
 * The attribute the support script's tag carries. It is a serve mark like the badge: a copy of the
 * app as the frame received it, published again, has the script taken out before it is stored
 * (services/app-serve-marks-strip.ts), and every serve puts the current one in once.
 */
export const FRAME_SUPPORT_MARK = 'data-aimeat-frame-support';

/**
 * Put the frame support script in front of everything the app wrote: right after `<head>`, else after
 * `<html>`, else after the doctype, else at the very start. It has to run before the app's first line,
 * because that line may be the localStorage read the browser refuses in an opaque origin.
 */
export function withFrameShim(body: Buffer | Uint8Array | string): Buffer {
  const raw = typeof body === 'string' ? body : Buffer.from(body).toString('utf-8');
  const source = appFrameShimSource();
  if (!source) return Buffer.from(raw, 'utf-8');
  const tag = `<script ${FRAME_SUPPORT_MARK}>${source}</script>`;
  const at = [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /^\s*<!doctype[^>]*>/i]
    .map(re => re.exec(raw))
    .find((m): m is RegExpExecArray => m !== null);
  const cut = at ? at.index + at[0].length : 0;
  return Buffer.from(raw.slice(0, cut) + tag + raw.slice(cut), 'utf-8');
}
