/**
 * @file public/views/appcat/sections/build-ctx.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the build sections of the app page (spec, roadmap, builders) hand to the blocks
 *   they borrow from Settings > Apps: the app's /v1/apps path, the app as those blocks read it, the
 *   signed-in account, and a `showToast(text, isError)` that speaks through the catalogue's notice.
 * @structure buildCtx(d) → { path, app, me, isOwner, ctx }
 * @usage const b = buildCtx(d); html`<${DesignSpecBlock} ctx=${b.ctx} app=${b.app} path=${b.path} owner=${b.isOwner} />`
 * @version-history
 *   v1.0.0 — 2026-10-04 — Initial (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 */
import { bareOwner } from '/views/appcat/dialogs/app-io.js';

export function buildCtx(d) {
  const owner = bareOwner(d.owner || d.rowOwner);
  const me = d.me ? bareOwner(d.me) : '';
  return {
    path: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(d.filename)}`,
    app: { owner, filename: d.filename, manifest: { ...d.manifest, name: d.meta?.name || d.manifest?.name } },
    me,
    isOwner: !!d.isOwn,
    ctx: { showToast: (text, isError) => d.notice(text, isError ? 'error' : 'success') },
  };
}
