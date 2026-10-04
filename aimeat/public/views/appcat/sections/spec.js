/**
 * @file public/views/appcat/sections/spec.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Design spec": the one document beside the app that says what it
 *   is for, its screens, where its data lives and what was decided, read and written here by the
 *   owner (and over MCP by their AI). The block is Settings > Apps' own (DesignSpecBlock), so both
 *   places show the same document the same way. Shown on the person's own app and on an app they
 *   hold a development right on (d.isBuilder): the node keeps the spec inside the build and answers
 *   nobody else.
 * @structure meta · SpecSection({ d })
 * @usage const mod = await import('./sections/spec.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-10-04 — Shown to a builder of somebody else's app too.
 *   v1.0.0 — 2026-10-04 — Initial (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 */
import { h } from 'preact';
import htm from 'htm';
import { DesignSpecBlock } from '/views/profile/apps/design-spec.js';
import { buildCtx } from '/views/appcat/sections/build-ctx.js';

const html = htm.bind(h);

export const meta = { id: 'spec', title: 'detail.spec', show: (d) => !!(d && d.app && (d.isOwn || d.isBuilder)) };

export default function SpecSection({ d }) {
  const b = buildCtx(d);
  return html`<${DesignSpecBlock} key=${b.path} ctx=${b.ctx} app=${b.app} path=${b.path} owner=${b.isOwner} heading=${false} />`;
}
