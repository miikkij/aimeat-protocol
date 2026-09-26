/**
 * @file public/components/QrCode.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A QR code a person scans with a phone: the picture the server drew (a data URL), on
 *   white whatever the theme, because a scanner reads dark on light and the code is black. Its look
 *   is css/components/qr-code.css. A page passes the picture and its words; it never writes a class.
 * @structure QrCode({ src, alt, size })
 * @usage html`<${QrCode} src=${setup.qr_data_url} alt=${t('profile.security.twoFactor.qrAlt')} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the two-step sign-in QR of the Access page (formerly
 *     views/profile/security-tab/two-factor.js img.pf-2fa-qr, profile.css .pf-2fa-qr), a component
 *     that takes data (G3 page migration).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ src: string, alt: string, size?: number }} props */
export function QrCode({ src, alt, size = 200 }) {
  if (!src) return null;
  return html`<img class="qr-code" src=${src} alt=${alt} width=${size} height=${size} />`;
}

export default QrCode;
