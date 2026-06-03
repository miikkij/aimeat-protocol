/**
 * @file csp-nonce.ts
 * @description Inject a per-request CSP nonce into <script> and <style> tags of an
 *   HTML string so inline scripts/styles satisfy the node's Content-Security-Policy
 *   (script-src 'self' 'nonce-...'). Used when serving operator-authored HTML such as
 *   custom portal templates, which are trusted and may contain inline <script> blocks.
 * @structure injectCspNonce(html, nonce)
 * @usage
 *   import { injectCspNonce } from '../utils/csp-nonce.js';
 *   res.type('text/html').send(injectCspNonce(html, res.locals.cspNonce as string | undefined));
 * @version-history
 *   v1.0.0 — 2026-06-04 — Extracted shared helper for portal template serving.
 */

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
