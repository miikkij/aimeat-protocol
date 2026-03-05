/**
 * AIMEAT Shared Utilities
 * Common helper functions used across all portal views.
 */

/** HTML-escape a string (prevents XSS in user-generated content). */
export function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
