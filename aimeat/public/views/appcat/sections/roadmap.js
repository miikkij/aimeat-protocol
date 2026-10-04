/**
 * @file public/views/appcat/sections/roadmap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Roadmap": what has been done to the app and what people wish
 *   for it, with the form that adds a line. The block is Settings > Apps' own (RoadmapBlock). Shown
 *   on every published app, because the done lines are public and anybody signed in may leave a
 *   wish; the node decides what each reader sees.
 * @structure meta · RoadmapSection({ d })
 * @usage const mod = await import('./sections/roadmap.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 */
import { h } from 'preact';
import htm from 'htm';
import { RoadmapBlock } from '/views/profile/apps/roadmap-block.js';
import { buildCtx } from '/views/appcat/sections/build-ctx.js';

const html = htm.bind(h);

export const meta = { id: 'roadmap', title: 'detail.roadmap', show: (d) => !!(d && d.app) };

export default function RoadmapSection({ d }) {
  const b = buildCtx(d);
  return html`<${RoadmapBlock} key=${b.path} ctx=${b.ctx} path=${b.path} owner=${b.isOwner} me=${b.me} heading=${false} />`;
}
