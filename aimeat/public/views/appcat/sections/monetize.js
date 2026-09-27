/**
 * @file public/views/appcat/sections/monetize.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Monetize section of the app detail view ("Monetize — sell tool calls"), for an
 *   own published app: the tools of the app's manifest (`apps.{filename}.tools`, the public memory
 *   record GET /v1/memory/… reads and POST /v1/memory writes) that agents can buy per call. One row
 *   per tool: its name and what it does, the price per call (or "not for sale", and "in EXCHANGE"
 *   when listed), how a bought call is delivered (an instant call through its binding, or a task to an
 *   agent or to the owner), Edit and ✕, and the reason a tool flagged for EXCHANGE cannot be listed.
 *   "Add tool" and Edit open the four-question editor (monetize-editor.js) in the row's place. As the
 *   old catalogue's js/monetize.js; the manifest is shared with the EXCHANGE & ODPS section
 *   (tools-manifest.js).
 * @structure meta · MonetizeSection({ d })
 * @usage loaded by the detail view: import('./sections/monetize.js')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (appcat sections-d): the chapter's lead, empty line
 *     and door row; "in EXCHANGE" a green word after the price (Tinted fine); the blocked reason is
 *     the row's own line under it (the cut draws it); the parts stand without a Stack's gaps.
 *   v1.0.0 — 2026-09-27 — Initial (appcat detail builder C), from the old catalogue's js/monetize.js.
 */
import { h } from 'preact';
import htm from 'htm';
import { Action, Loud, Actions } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { x } from '/views/appcat/i18n.js';
import { confirmAsk } from '/views/appcat/dialogs/confirm.js';
import { useToolsManifest, patchManifest, manifestNow, writeManifest, blockedReason, priceLabel } from '/views/appcat/sections/tools-manifest.js';
import { ToolEditor } from '/views/appcat/sections/monetize-editor.js';

const html = htm.bind(h);

export const meta = { id: 'monetize', title: 'monetize.title', show: (d) => !!d.isOwnPublished };

/** One tool: what it is, its price, how it is delivered, its doors, and why it is not listed. */
function ToolRow({ tool, i, onDelete }) {
  const why = blockedReason(tool);
  const mode = tool.action_id ? x('monetize.fulfillCall') : x('monetize.fulfillTask');
  const binding = tool.action_id || (tool.agent ? '→ ' + tool.agent : x('monetize.taskToOwner'));
  // The cut (listing.css name-price-delivery-doors) draws the reason in the warning colour.
  return html`<${Row} below=${why ? '⚠ ' + why : null}>
    <${Name} desc=${tool.description || null}>${tool.name}<//>
    <${Cell}>
      <${Label} block>${x('monetize.priceCol')}<//>
      ${priceLabel(tool)}${tool.exchange ? html` <${Tinted} tone="fine">${x('monetize.exchangeOn')}<//>` : null}
    <//>
    <${Cell}>
      <${Label} block>${mode}<//>
      <${Note} kind="meta" inline mono>${binding}<//>
    <//>
    <${Doors}>
      <${Action} small onClick=${() => patchManifest({ editing: i })}>${x('detail.editDetails')}<//>
      <${Action} small tone="danger" title=${x('monetize.deleteHint')} ariaLabel=${x('monetize.deleteHint')} onClick=${() => onDelete(i)}>✕<//>
    <//>
  <//>`;
}

function Tools({ tools, from, onDelete }) {
  if (!tools.length) return null;
  return html`<${List} cols="name-price-delivery-doors">
    ${tools.map((tool, k) => html`<${ToolRow} key=${(tool.name || '') + ':' + (from + k)} tool=${tool} i=${from + k} onDelete=${onDelete} />`)}
  <//>`;
}

export default function MonetizeSection({ d }) {
  const m = useToolsManifest(d);
  if (m.state === 'off' || m.ref !== d.ref) return null;

  const remove = async (i) => {
    const now = manifestNow();
    if (now.busy || !now.doc || !now.doc.tools[i]) return;
    if (!(await confirmAsk(x('monetize.confirmDelete', { name: now.doc.tools[i].name })))) return;
    const cur = manifestNow();
    if (cur.busy || !cur.doc || !cur.doc.tools[i]) return;
    const tools = cur.doc.tools.slice();
    tools.splice(i, 1);
    patchManifest({ busy: true });
    const next = { ...cur.doc, tools };
    try {
      await writeManifest(next);
      patchManifest({ doc: next, editing: -1, busy: false });
      d.notice(x('monetize.saved'), 'success');
    } catch (e) {
      patchManifest({ busy: false });
      d.notice(x('monetize.saveFailed') + ': ' + e.message, 'error');
    }
  };

  const lede = html`<${Note} kind="lead" chapter>${x('monetize.hint')}<//>`;
  if (m.state === 'loading') return html`${lede}<${Note} kind="quiet" size="small" inline>…<//>`;

  const tools = (m.doc && m.doc.tools) || [];
  const at = m.editing;
  let body;
  if (!tools.length && at === -1) body = html`<${Note} kind="quiet" chapter inline>${x('monetize.empty')}<//>`;
  else if (at >= 0 && at < tools.length) {
    body = html`
      <${Tools} tools=${tools.slice(0, at)} from=${0} onDelete=${remove} />
      <${ToolEditor} key=${'edit-' + at} d=${d} m=${m} index=${at} />
      <${Tools} tools=${tools.slice(at + 1)} from=${at + 1} onDelete=${remove} />`;
  } else body = html`<${Tools} tools=${tools} from=${0} onDelete=${remove} />`;

  return html`
    ${lede}
    ${body}
    ${at === -2 ? html`<${ToolEditor} key="new" d=${d} m=${m} index=${-2} />` : null}
    ${at === -1 ? html`<${Actions} chapter><${Loud} control onClick=${() => patchManifest({ editing: -2 })}>${x('monetize.addTool')}<//><//>` : null}`;
}
