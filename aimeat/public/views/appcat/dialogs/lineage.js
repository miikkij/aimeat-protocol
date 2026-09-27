/**
 * @file public/views/appcat/dialogs/lineage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fork lineage dialog (features F140, F125, F203): "Fork lineage {filename}", the help
 *   line, "Direct forks: {n} · total descendants: {n}", "Loading lineage…", and the tree of forks
 *   across owners, each level under the one it came from: "↳ owner/filename" ("●" on the app itself),
 *   its state (public, parked, hidden, deleted) and the day it was forked. With no forks: "No forks
 *   yet — this app has not been forked." Unguarded (F176).
 * @structure default LineageDialog({ owner, filename }) · Level({ ids, depth, tree })
 * @usage openDialog('lineage', { owner, filename })  — props: owner, filename (the app whose forks show).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the filename after the title (titleRef), the help, summary and
 *     status lines in the old sizes, the tree the old plain indented lines (List tone 'tree'; the app
 *     itself bold).
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old detail.js showLineageModal.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';
import { List, Row, Name } from '/components/List.js';
import { date } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { Status } from '/views/appcat/dialogs/parts.js';
import { appUrl } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

/** A fork's state as a status mark: public fine, parked off, hidden attention, deleted danger. */
const TONE = { public: 'fine', parked: 'off', hidden: 'attention', deleted: 'danger' };

/** The rows of one level of the tree, each with its children's level under it. */
function Level({ ids, depth, tree }) {
  const rows = ids.map((id) => {
    if (tree.seen.has(id)) return null;
    tree.seen.add(id);
    const n = tree.byId[id];
    if (!n) return null;
    const self = id === tree.self;
    const kids = tree.children[id] || [];
    const when = n.forkedAt ? date(n.forkedAt) : '';
    const word = x('lineage.status.' + n.status);
    return html`<${Row} key=${id} below=${kids.length ? html`<${Level} ids=${kids} depth=${depth + 1} tree=${tree} />` : null}>
      <${Name} attention=${self} tag=${html`<${Mark} kind="status" tone=${TONE[n.status]}>${word === 'appcat.lineage.status.' + n.status ? n.status : word}<//>`}
        after=${when ? html` <${Note} kind="meta" inline>${when}<//>` : null}>
        ${depth > 0 ? '↳ ' : ''}${n.owner}/${n.filename}${self ? ' ●' : ''}
      <//>
    <//>`;
  });
  return html`<${List} tone="tree">${rows}<//>`;
}

export default function LineageDialog({ owner, filename, close }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ text: x('lineage.loading'), tone: 'busy' });

  useEffect(() => {
    let live = true;
    fetch(appUrl(owner, filename, 'lineage'))
      .then((resp) => { if (!resp.ok) throw new Error(x('io.serverReturned', { status: resp.status })); return resp.json(); })
      .then((json) => { if (!live) return; setData(json.data || {}); setStatus(null); })
      .catch((e) => { if (live) setStatus({ text: '✘ ' + (e.message || x('lineage.failed')), tone: 'refused' }); });
    return () => { live = false; };
  }, [owner, filename]);

  let tree = null;
  if (data) {
    const nodes = data.nodes || [];
    const edges = data.edges || [];
    const byId = {};
    for (const n of nodes) byId[n.id] = n;
    const children = {};
    const hasParent = {};
    for (const e of edges) { (children[e.from] = children[e.from] || []).push(e.to); hasParent[e.to] = true; }
    let roots = nodes.filter((n) => !hasParent[n.id]).map((n) => n.id);
    if (!roots.length && data.self) roots = [data.self];
    tree = { byId, children, roots, self: data.self, seen: new Set(), none: nodes.length <= 1 && edges.length === 0 };
  }

  return html`<${Dialog} title=${x('lineage.title')} titleRef=${filename} size="lg"
    footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Stack} gap="tight">
      <${Note} kind="caption">${x('lineage.help')}<//>
      <${Note} kind="caption" size="medium">${data ? `${x('lineage.direct')}: ${data.directForkCount || 0} · ${x('lineage.total')}: ${data.descendantCount || 0}` : ''}<//>
    <//>
    <${Stack} gap="small">
      <${Status} keep status=${status} />
      ${tree && tree.none ? html`<${Note} kind="caption" size="large">${x('lineage.none')}<//>` : null}
      ${tree && !tree.none ? html`<${Level} ids=${tree.roots} depth=${0} tree=${tree} />` : null}
    <//>
  <//>`;
}
