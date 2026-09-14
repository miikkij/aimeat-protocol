/**
 * @file landing-v2-signage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The digital signage showcase on the front page (TARGET-075): one whole system built
 *   here by asking, an admin panel and the screens it drives, and the screen itself running live
 *   inside the page. The frame is the real kiosk app on its own origin, so what a visitor sees is
 *   what the sign shows at that moment; two doors under it open the screen full size and the admin
 *   panel. The addresses are the block's settings, so an operator can point the frame at their own
 *   screen.
 *
 *   FRAMING WORKS BECAUSE THE APP ALLOWS IT. An app served on its own origin names the apex in its
 *   frame-ancestors (utils/app-csp.ts) and the apex names the app host in its frame-src, so the
 *   page needs nothing else. A screen that needs a sign-in shows its sign-in door in the frame,
 *   which is why the default is a public screen.
 * @structure SignageShowcase
 * @usage import { SignageShowcase } from '/views/landing-v2-signage.js';
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial. Jouni: the signage example before the four prompts, as one app.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

export const SIGNAGE_SCREEN_URL = 'https://signage-kiosk.apps.aimeat.io/?org=cd750579-99a2-44fe-a996-88ab502a679a&ws=ws-mrgbxgh294h&screen=aimeat-launch';
export const SIGNAGE_ADMIN_URL = 'https://signage-admin.apps.aimeat.io/';

/**
 * The showcase: the claim, the live screen, the two doors. `url` is the screen the frame shows and
 * `admin` the panel it was made in; both are the block's settings.
 */
export function SignageShowcase({ url = SIGNAGE_SCREEN_URL, admin = SIGNAGE_ADMIN_URL }) {
  return html`
    <section class="ld-v2-signage">
      <h2 class="ld-sh-h2 ld-v2-h2-row">
        <span>${tr('landing2.signageTitle1', 'One whole system, built by asking:')}</span>
        <span class="ld-sh-accent">${tr('landing2.signageTitle2', 'digital signage')}</span>
      </h2>
      <p class="ld-sh-text ld-v2-signage-sub">${tr('landing2.signageSub', 'An admin panel, the screens it drives, and the screen itself, all made here by telling an AI what was wanted. The frame below is that screen, live: what you see is what the sign shows right now.')}</p>
      <div class="ld-v2-signage-frame">
        <iframe class="ld-v2-signage-iframe" src=${url} loading="lazy" title=${tr('landing2.signageFrameTitle', 'The live signage screen')}
          sandbox="allow-scripts allow-same-origin" referrerpolicy="strict-origin-when-cross-origin"></iframe>
        <span class="ld-sh-sticker ld-sh-sticker--live">${tr('landing.showLive', 'Live · all real')}</span>
      </div>
      <div class="ld-v2-doors">
        <a class="ld-sh-door showroom-door" href=${url} target="_blank" rel="noopener">${tr('landing2.signageOpenScreen', 'Open the screen full size →')}</a>
        <a class="ld-sh-door showroom-door" href=${admin} target="_blank" rel="noopener">${tr('landing2.signageOpenAdmin', 'Open the admin panel it was made in →')}</a>
      </div>
    </section>`;
}
