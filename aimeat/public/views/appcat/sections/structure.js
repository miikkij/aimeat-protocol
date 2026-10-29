/**
 * @file public/views/appcat/sections/structure.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Structure": how many of the app's eight steps are done, the next
 *   one, and the way to the app's structure page (/v1/appcat/structure, views/appcat/structure.js),
 *   where the person follows the app and picks its layout and look. Read from GET
 *   /v1/apps/:owner/:filename/structure (services/app-structure.ts). Shown on the person's own app and
 *   on an app they hold a development right on, as the design spec is.
 * @structure meta · StructureSection({ d })
 * @usage const mod = await import('./sections/structure.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Note } from '/components/Note.js';
import { Meter } from '/components/Figure.js';
import { Action } from '/components/Action.js';
import { swallowed } from '/js/swallowed.js';
import { x } from '/views/appcat/i18n.js';
import { readStructure } from '/views/appcat/structure-data.js';

const html = htm.bind(h);

export const meta = { id: 'structure', title: 'detail.structure', show: (d) => !!(d && d.app && (d.isOwn || d.isBuilder)) };

export default function StructureSection({ d }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    let live = true;
    readStructure(d.owner, d.filename).then((r) => { if (live) setS(r); }).catch((err) => swallowed('appcat structure: read', err));
    return () => { live = false; };
  }, [d.owner, d.filename]);
  if (!s) return null;
  const href = `/v1/appcat/structure?app=${encodeURIComponent(`${d.owner}/${d.filename}`)}`;
  return html`
    <${Note} kind="lead" chapter>${x('detail.structureLead', { fine: s.fine, total: s.total })}<//>
    <${Meter} pct=${s.total ? Math.round((s.fine / s.total) * 100) : 0} thin />
    ${s.next ? html`<${Note}>${x(`structure.next.${s.next}`)}<//>` : null}
    <${Action} small href=${href}>${x('detail.structureOpen')}<//>`;
}
