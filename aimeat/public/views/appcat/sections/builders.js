/**
 * @file public/views/appcat/sections/builders.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Who else may build this": the people with a development right
 *   on this app or on every app of the owner, giving one on this app and taking one back
 *   (AppBuildersBlock). Shown on the person's own app; the routes answer the owner only.
 * @structure meta · BuildersSection({ d })
 * @usage const mod = await import('./sections/builders.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 */
import { h } from 'preact';
import htm from 'htm';
import { AppBuildersBlock } from '/views/profile/apps/app-builders-block.js';
import { buildCtx } from '/views/appcat/sections/build-ctx.js';

const html = htm.bind(h);

export const meta = { id: 'builders', title: 'detail.builders', show: (d) => !!(d && d.app && d.isOwn) };

export default function BuildersSection({ d }) {
  const b = buildCtx(d);
  return html`<${AppBuildersBlock} key=${b.path} ctx=${b.ctx} path=${b.path} />`;
}
