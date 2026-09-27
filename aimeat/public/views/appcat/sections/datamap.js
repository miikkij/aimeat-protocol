/**
 * @file public/views/appcat/sections/datamap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Where this app puts what" (features F338–F340): the app's data map
 *   from GET /v1/datamap/apps/{owner}/{file}, drawn by components/DataMap.js with appcat's own
 *   `dataMap.*` words (appcat.dataMap.*, which carry Spanish too). Shown on every detail view. Like the
 *   old page, the read sends no token (F340, kept as it behaves: the route decides what it shows, and
 *   a visitor's view and the owner's are the same here). The shell draws the chapter line and the
 *   headline from `meta`; this is the body.
 * @structure meta · DataMapSection({ d })
 * @usage const mod = await import('./sections/datamap.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's js/data-map.js on components (appcat detail
 *     builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { DataMap } from '/components/DataMap.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

export const meta = { id: 'datamap', title: 'dataMap.title', show: () => true };

export default function DataMapSection({ d }) {
  const [state, setState] = useState({ loading: true, map: null, findings: [] });
  const owner = d.owner;
  const filename = d.filename;
  useEffect(() => {
    if (!owner || !filename) return undefined;
    let live = true;
    setState({ loading: true, map: null, findings: [] });
    fetch('/v1/datamap/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename))
      .then((r) => r.json())
      .then((json) => {
        if (!live) return;
        const data = (json && json.data) || {};
        setState({ loading: false, map: data.data_map || null, findings: data.findings || [] });
      })
      // eslint-disable-next-line aimeat/no-silent-catch -- as on the old page, a map that cannot be read is said as "no map yet"
      .catch(() => { if (live) setState({ loading: false, map: null, findings: [] }); });
    return () => { live = false; };
  }, [owner, filename]);
  return html`<${DataMap} loading=${state.loading} map=${state.map} findings=${state.findings} say=${(k) => x(k)} />`;
}
