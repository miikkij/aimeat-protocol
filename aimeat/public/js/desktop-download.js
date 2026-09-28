/**
 * @file desktop-download.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which desktop app download a person needs, from the platform their browser runs on.
 *
 *   The AIMEAT desktop app ships for Windows, Apple-silicon Macs and Linux since 2026-09-29, each
 *   at a fixed address on the `desktop-latest` release that the release workflow rewrites on every
 *   `desktop-v*` release, so these links carry no version and outlive every release. A page that
 *   offers the app links to the file for the person's own platform, and to the release page when
 *   the platform is one no build exists for (a phone, a tablet, something unrecognised), where
 *   every file is listed and nothing is guessed.
 *
 *   The same fixed addresses are served to the setup guide by src/services/desktop-app-offer.ts.
 *   Change the file names in both places, and in .github/workflows/release-desktop.yml, together.
 * @structure ownPlatform() · desktopDownloadUrl() · DESKTOP_RELEASE_PAGE
 * @usage import { desktopDownloadUrl } from '/js/desktop-download.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial: Windows, Mac (Apple silicon) and Linux.
 */

const FIXED = 'https://github.com/miikkij/aimeat-protocol/releases/download/desktop-latest';

/** Every file, listed: where a person goes when no build fits their platform. */
export const DESKTOP_RELEASE_PAGE = 'https://github.com/miikkij/aimeat-protocol/releases/tag/desktop-latest';

/**
 * The platform this browser runs on, as the desktop builds name it, or '' when it is not one of
 * them. A phone is never one: Android reports Linux, and an iPad can report a Mac.
 * @returns {'windows'|'mac'|'linux'|''}
 */
export function ownPlatform() {
  const nav = /** @type {any} */ (navigator);
  const ua = String(nav.userAgent || '');
  if (/android|iphone|ipad|ipod/i.test(ua) || (nav.maxTouchPoints > 1 && /mac/i.test(ua))) return '';
  const p = String(nav.userAgentData?.platform || nav.platform || '').toLowerCase();
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'mac';
  if (p.includes('linux')) return 'linux';
  return '';
}

/** The installer for this person's platform, or the release page when none fits. */
export function desktopDownloadUrl() {
  switch (ownPlatform()) {
    case 'windows': return `${FIXED}/AIMEAT-Personal-Node-setup.exe`;
    case 'mac': return `${FIXED}/AIMEAT-Personal-Node.dmg`;
    case 'linux': return `${FIXED}/AIMEAT-Personal-Node.AppImage`;
    default: return DESKTOP_RELEASE_PAGE;
  }
}
