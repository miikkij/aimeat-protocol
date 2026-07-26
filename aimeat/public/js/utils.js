import { swallowed } from '/js/swallowed.js';
/**
 * @file public/js/utils.js
 * @description Shared browser helpers used across all portal/SPA views — HTML/attribute escaping and
 *   entity decoding, relative-time and byte formatting, clipboard copy, locale detection/persistence,
 *   a whitelist HTML sanitizer, star-field generation, and a broken-image SVG fallback handler.
 *
 * @structure
 *   - escHtml/escAttr/decodeEntities: XSS-safe escaping + reversal of double-escaped names
 *   - timeAgo/formatBytes: human-readable time and size formatting
 *   - detectLocale/persistLocale: en/fi preference via URL → localStorage → cookie → navigator
 *   - sanitizeHtml: strip to a safe tag/attribute whitelist
 *   - copyToClipboard/generateStars/handleImgError: clipboard, background stars, image error placeholder
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

/** Micros per whole currency unit — money amounts are 6-decimal micro-units (matches USDC/x402). */
export const MONEY_UNIT = 1_000_000;

/** Format money micro-units as "1.50 EUR" / "0.002 USD" (≥2 decimals, up to 6 when sub-cent). */
export function fmtMoney(micros, currency) {
  const s = ((Number(micros) || 0) / MONEY_UNIT).toFixed(6).replace(/(\.\d{2}\d*?)0+$/, '$1');
  return currency ? `${s} ${currency}` : s;
}

/** Parse a major-unit input ("1.50", "0,002") into integer money micro-units; null if not positive. */
export function microsFromInput(str) {
  const n = parseFloat(String(str).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * MONEY_UNIT);
}

/** HTML-escape a string (prevents XSS in user-generated content). */
export function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Decode the common HTML entities back to plain text. Some names (e.g. workspace registry names)
 *  were HTML-escaped at write by older import paths, so a literal "STT & Voice" reached storage as
 *  "STT &amp; Voice" and then double-escaped on render. Names are plain text — decode them for
 *  display. HTM re-escapes on render, so this stays XSS-safe. Decode &amp; LAST so "&amp;lt;"
 *  resolves to "&lt;", not "<". */
export function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Attribute-escape a string (for use inside HTML attributes). */
export function escAttr(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an ISO timestamp as a relative time string (e.g., "3m ago"). */
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Format bytes to human-readable size. */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/** Copy text to clipboard with fallback. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  }
}

/** Detect user's preferred locale from URL → localStorage → cookie → navigator. */
export function detectLocale() {
  // 1. URL parameter
  const params = new URLSearchParams(window.location.search);
  const langParam = params.get('lang');
  if (langParam === 'en' || langParam === 'fi') return langParam;

  // 2. localStorage
  const stored = localStorage.getItem('aimeat-lang');
  if (stored === 'en' || stored === 'fi') return stored;

  // 3. Cookie
  const match = document.cookie.match(/(?:^|;\s*)aimeat-lang=(en|fi)(?:;|$)/);
  if (match) return match[1];

  // 4. Browser language
  const nav = (navigator.language || '').split('-')[0].toLowerCase();
  if (nav === 'fi') return 'fi';

  return 'en';
}

/** Persist locale preference to localStorage and cookie. */
export function persistLocale(locale) {
  localStorage.setItem('aimeat-lang', locale);
  document.cookie = `aimeat-lang=${locale};path=/;max-age=31536000;SameSite=Lax`;
}

/** Strip HTML tags, allowing only a safe whitelist. */
export function sanitizeHtml(html) {
  if (!html) return '';
  const ALLOWED = /^(b|i|em|strong|code|a|br|p|ul|ol|li|blockquote)$/i;
  const div = document.createElement('div');
  div.innerHTML = String(html);
  function walk(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) continue; // text node — keep
      if (child.nodeType !== 1) { child.remove(); continue; }
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED.test(tag)) {
        // Replace disallowed element with its text content
        child.replaceWith(document.createTextNode(child.textContent || ''));
        continue;
      }
      // Strip all attributes except href on <a>
      for (const attr of Array.from(child.attributes)) {
        if (tag === 'a' && attr.name === 'href') {
          // Only allow http(s) and relative URLs
          if (!/^(https?:\/\/|\/)/.test(attr.value)) child.removeAttribute('href');
          child.setAttribute('rel', 'noopener noreferrer');
          child.setAttribute('target', '_blank');
        } else {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  }
  walk(div);
  return div.innerHTML;
}

/** Generate twinkling star elements for background canvas. */
export function generateStars(container, count = 80) {
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDuration = (2 + Math.random() * 4) + 's';
    star.style.animationDelay = (Math.random() * 5) + 's';
    container.appendChild(star);
  }
}

/**
 * Broken image fallback handler.
 * Probes the original URL with HEAD to determine the reason (auth vs not found),
 * then replaces the <img> with an inline SVG placeholder.
 *
 * Usage in Preact/HTM:  onError=${handleImgError}
 */
export function handleImgError(e) {
  const img = e.target;
  if (img.dataset.fallback) return; // already handled
  img.dataset.fallback = '1';

  const src = img.src;
  const w = img.width || img.clientWidth || 40;
  const h = img.height || img.clientHeight || 40;

  // Probe with HEAD to get status code
  fetch(src, { method: 'HEAD' }).then(r => {
    const status = r.status;
    let label, icon;
    if (status === 401 || status === 403) {
      label = 'Login';
      icon = `<path d="M12 2C9.24 2 7 4.24 7 7v3H5v10h14V10h-2V7c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v3H9V7c0-1.66 1.34-3 3-3zm-5 8h10v6H7v-6z" fill="currentColor" opacity=".7"/>`;
    } else {
      label = 'N/A';
      icon = `<path d="M21 5v6.59l-3-3L13.41 13 9 8.59 3 14.59V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2zm0 14c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2v-2.58l6-6L13.41 15 18 10.41l3 3V19z" fill="currentColor" opacity=".5"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="1.5" opacity=".5"/>`;
    }
    applyFallbackSvg(img, w, h, label, icon);
  }).catch((err) => {
    swallowed('utils', err);
    applyFallbackSvg(img, w, h, 'N/A',
      `<path d="M21 5v6.59l-3-3L13.41 13 9 8.59 3 14.59V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2zm0 14c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2v-2.58l6-6L13.41 15 18 10.41l3 3V19z" fill="currentColor" opacity=".5"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="1.5" opacity=".5"/>`);
  });
}

function applyFallbackSvg(img, w, h, label, iconPath) {
  const fontSize = Math.max(8, Math.min(w * 0.2, 11));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" rx="4" fill="%23222" stroke="%23444" stroke-width="1"/>` +
    `<g transform="translate(${w/2 - 12},${h/2 - 14})" color="%23888">${iconPath}</g>` +
    `<text x="${w/2}" y="${h/2 + 14}" text-anchor="middle" fill="%23777" font-family="sans-serif" font-size="${fontSize}">${label}</text>` +
    `</svg>`;
  img.src = `data:image/svg+xml,${svg}`;
  img.style.objectFit = 'contain';
}
