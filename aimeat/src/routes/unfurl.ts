/**
 * @file src/routes/unfurl.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generic link-preview (unfurl) endpoints. A client passes any http(s) URL and gets back
 *   its OpenGraph/Twitter-card metadata (title/description/image/siteName) so a pasted link can render
 *   as a rich card. Reusable by any client (inbox threads, notebook, workspace docs) — not tied to one
 *   view (SSR-free: returns JSON, never HTML).
 *
 *   Security: the page fetch and the image fetch BOTH go through `safeFetch` (Rule 10 invariant #3),
 *   which blocks SSRF (private/loopback/link-local/cloud-metadata targets, re-validated per redirect).
 *   Responses are size-capped and content-type-checked so a link to a huge file / non-HTML page can't be
 *   used to make the node slurp arbitrary bytes. The image is proxied (GET /v1/unfurl/image) rather than
 *   handed to the browser directly: the SPA's CSP is `img-src 'self' data: blob:` (no remote hosts), and
 *   proxying also keeps each viewer's IP from leaking to the third-party site. Both routes require auth.
 *
 * @structure
 *   - GET /v1/unfurl?url=      → { url, resolvedUrl, title, description, image, siteName }  (cached ~1h)
 *   - GET /v1/unfurl/image?url= → the remote image bytes, streamed back same-origin (auth'd, size-capped)
 *   - parseMeta(html, base)    → extract OG/Twitter/<title> metadata, resolving relative image URLs
 *   - readCapped(resp, max)    → read a response body up to a byte cap, then stop
 *
 * @version-history
 *   v1.0.0 — 2026-07-21 — Initial link-preview endpoints (inbox message link cards).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { safeFetch } from '../utils/url-validator.js';
import { cached } from '../services/cache.js';
import { logger } from '../utils/logger.js';

/** Page fetch caps — an unfurl only needs the <head>, so a small ceiling covers real pages. */
const MAX_HTML_BYTES = 512 * 1024;      // 512 KB of HTML is plenty to reach the OG tags
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB preview-image ceiling
const FETCH_TIMEOUT_MS = 8_000;
const UNFURL_TTL_MS = 3_600_000;         // preview metadata is stable — cache an hour
/** A desktop UA — some sites serve a bare / bot-hostile page to an unknown client, hiding OG tags. */
const UA = 'Mozilla/5.0 (compatible; AIMEAT-LinkPreview/1.0; +https://aimeat.io)';

/** Read a response body into a Buffer, stopping once `maxBytes` is exceeded (then cancelling the stream). */
async function readCapped(resp: Response, maxBytes: number): Promise<Buffer> {
  const reader = resp.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) { try { await reader.cancel(); } catch (err) { logger.warn('readCapped: noop', { error: String(err) }); } break; }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

/** Minimal HTML-entity decode for the short text we pull out of meta tags. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Find a <meta> tag's content by property/name, tolerating attribute order (content before or after). */
function metaByKey(html: string, key: string): string | null {
  const k = key.replace(/[.:]/g, '\\$&');
  const after = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*?content=["']([^"']*)["']`, 'i');
  const before = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${k}["']`, 'i');
  const m = after.exec(html) || before.exec(html);
  return m && m[1] ? decodeEntities(m[1].trim()) : null;
}

interface Preview {
  url: string;
  resolvedUrl: string;
  title: string | null;
  description: string | null;
  image: string | null;    // absolute original image URL; the client fetches it via /v1/unfurl/image
  siteName: string | null;
}

/** Pull OG/Twitter/<title> metadata out of a page, resolving a relative og:image against the page URL. */
function parseMeta(html: string, originalUrl: string, resolvedUrl: string): Preview {
  const head = html.slice(0, 200_000); // OG tags live in <head>; cap the regex work
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = metaByKey(head, 'og:title') || metaByKey(head, 'twitter:title')
    || (titleTag ? decodeEntities(titleTag[1].trim()) : null);
  const description = metaByKey(head, 'og:description') || metaByKey(head, 'twitter:description')
    || metaByKey(head, 'description');
  const rawImage = metaByKey(head, 'og:image') || metaByKey(head, 'og:image:url') || metaByKey(head, 'twitter:image');
  let image: string | null = null;
  if (rawImage) {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    try { image = new URL(rawImage, resolvedUrl).toString(); } catch { image = null; }
  }
  const siteName = metaByKey(head, 'og:site_name') || (() => {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    try { return new URL(resolvedUrl).hostname.replace(/^www\./, ''); } catch { return null; }
  })();
  return { url: originalUrl, resolvedUrl, title, description, image, siteName };
}

/** Fetch + parse one URL's preview (the cached compute). Throws on a blocked/failed fetch. */
async function computePreview(rawUrl: string): Promise<Preview> {
  const resp = await safeFetch(rawUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const ctype = (resp.headers.get('content-type') || '').toLowerCase();
  const resolvedUrl = resp.url || rawUrl;
  // A non-HTML target (a direct image/PDF/etc.) has no OG tags — return a bare, hostname-only preview so
  // the client can still show a minimal card (or skip it). Don't slurp the (possibly huge) body.
  if (!ctype.includes('text/html') && !ctype.includes('application/xhtml')) {
    try { await resp.body?.cancel(); } catch (err) { logger.warn('ctype: noop', { error: String(err) }); }
    let siteName: string | null = null;
    // eslint-disable-next-line aimeat/no-silent-catch -- noop
    try { siteName = new URL(resolvedUrl).hostname.replace(/^www\./, ''); } catch { /* noop */ }
    return { url: rawUrl, resolvedUrl, title: null, description: null, image: null, siteName };
  }
  const buf = await readCapped(resp, MAX_HTML_BYTES);
  return parseMeta(buf.toString('utf8'), rawUrl, resolvedUrl);
}

export function unfurlRouter(config: AimeatConfig): Router {
  const router = Router();

  // GET /v1/unfurl?url= — OpenGraph/Twitter-card metadata for a pasted link (auth'd, SSRF-safe, cached).
  router.get('/v1/unfurl', requireAuth(), async (req, res) => {
    const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!raw || !/^https?:\/\//i.test(raw)) {
      res.status(400).json(error(config.nodeId, 'INVALID_URL', 'An http(s) `url` query parameter is required.'));
      return;
    }
    try {
      const preview = await cached(`unfurl:${raw}`, UNFURL_TTL_MS, () => computePreview(raw));
      res.json(success(config.nodeId, preview));
    } catch (e) {
      // A blocked (SSRF) or failed fetch is a client-supplied-URL problem, not a server fault.
      res.status(422).json(error(config.nodeId, 'UNFURL_FAILED', (e as Error).message || 'Could not fetch the link.'));
    }
  });

  // GET /v1/unfurl/image?url= — proxy a preview image same-origin (the SPA CSP forbids remote img hosts).
  router.get('/v1/unfurl/image', requireAuth(), async (req, res) => {
    const raw = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!raw || !/^https?:\/\//i.test(raw)) {
      res.status(400).json(error(config.nodeId, 'INVALID_URL', 'An http(s) `url` query parameter is required.'));
      return;
    }
    try {
      const resp = await safeFetch(raw, {
        headers: { 'User-Agent': UA, Accept: 'image/*' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const ctype = (resp.headers.get('content-type') || '').toLowerCase();
      if (!ctype.startsWith('image/')) {
        try { await resp.body?.cancel(); } catch (err) { logger.warn('ctype: noop', { error: String(err) }); }
        res.status(415).json(error(config.nodeId, 'NOT_AN_IMAGE', 'The URL did not resolve to an image.'));
        return;
      }
      const buf = await readCapped(resp, MAX_IMAGE_BYTES);
      res.setHeader('Content-Type', ctype.split(';')[0]);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(buf);
    } catch (e) {
      res.status(422).json(error(config.nodeId, 'UNFURL_FAILED', (e as Error).message || 'Could not fetch the image.'));
    }
  });

  return router;
}
