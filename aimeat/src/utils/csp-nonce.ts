/**
 * @file csp-nonce.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Inject a per-request CSP nonce into <script> and <style> tags of an
 *   HTML string so inline scripts/styles satisfy the node's Content-Security-Policy
 *   (script-src 'self' 'nonce-...'). Used when serving operator-authored HTML such as
 *   custom portal templates, which are trusted and may contain inline <script> blocks.
 *
 *   A page served WITHOUT the nonce (a page built from a stranger's markup) can still run the inline
 *   scripts the node itself added to it: addedScriptHashes() names them by their CSP hash, which
 *   allows exactly that text and nothing else.
 * @structure injectCspNonce(html, nonce) · addedScriptHashes(before, after) · withScriptHashes(csp, hashes)
 * @usage
 *   import { injectCspNonce } from '../utils/csp-nonce.js';
 *   res.type('text/html').send(injectCspNonce(html, res.locals.cspNonce as string | undefined));
 * @version-history
 *   v1.1.0 — 2026-10-30 — addedScriptHashes() and withScriptHashes(): the Design Book preview of a
 *     grown genre or a component carries no nonce, and the node's AI-label script on it was refused.
 *   v1.0.0 — 2026-06-04 — Extracted shared helper for portal template serving.
 */
import { createHash } from 'node:crypto';

/**
 * Add `nonce="<nonce>"` to every `<script>`/`<style>` open tag. Returns a new string
 * (never mutates), so it is safe to call per-request on cached HTML. No-op without a nonce.
 */
export function injectCspNonce(html: string, nonce: string | undefined): string {
  if (!nonce) return html;
  return html
    .replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`)
    .replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
}

/** The text of every inline (no src) executable <script> in the page. */
function inlineScripts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && type !== 'text/javascript' && type !== 'module') continue;
    out.push(m[2] ?? '');
  }
  return out;
}

/**
 * The CSP hashes ('sha256-…') of the inline scripts `after` has and `before` did not: the ones a
 * step of the node's own (the serve marks) added. A script the page already carried is left out,
 * so its author gains nothing; a copy of the node's own text runs only that text.
 */
export function addedScriptHashes(before: string, after: string): string[] {
  const had = new Map<string, number>();
  for (const s of inlineScripts(before)) had.set(s, (had.get(s) ?? 0) + 1);
  const hashes = new Set<string>();
  for (const s of inlineScripts(after)) {
    const n = had.get(s) ?? 0;
    if (n > 0) { had.set(s, n - 1); continue; }
    hashes.add(`'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

/** The policy with these hashes added to its script-src; unchanged when there are none or no script-src. */
export function withScriptHashes(csp: string, hashes: string[]): string {
  if (!hashes.length) return csp;
  return csp.replace(/script-src ([^;]*)/, (_m, list: string) => `script-src ${list} ${hashes.join(' ')}`);
}
