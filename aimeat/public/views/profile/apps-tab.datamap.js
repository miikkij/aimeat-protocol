/**
 * @file public/views/profile/apps-tab.datamap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map on one app card in My Apps: one line, and it opens where you are.
 *
 *   IT DOES NOT NAVIGATE. Clicking a line in your own app list used to throw you into the app
 *   catalogue, which is a different page with a different job. The map opens under the card you
 *   clicked, and the list keeps its scroll position and its state.
 *
 *   IT FETCHES NOTHING UNTIL OPENED. The list runs to 169 apps on the production node. The closed
 *   line renders from the stamp the list already has; the document is pulled for the one card
 *   somebody opens, once, and kept.
 * @structure AppDataMap({ owner, filename, stamp })
 * @usage <${AppDataMap} owner=${owner} filename=${filename} stamp=${a.data_map} />
 * @version-history
 *   v1.0.0 — 2026-08-25 — Split out of apps-tab.js, which is near the file-length ceiling.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { DataMapLine, DataMapPanel } from '/components/DataMap.js';
import { Spinner } from './shared.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

export function AppDataMap({ owner, filename, stamp }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);   // { map, findings } once fetched
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (state || loading) return;
    setLoading(true);
    try {
      // apiGet returns the whole envelope, so the payload is under `.data`.
      const r = await apiGet(`/v1/datamap/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}`);
      setState({ map: r?.data?.data_map ?? null, findings: r?.data?.findings ?? [] });
    } catch (err) {
      swallowed('apps-tab: data map', err);
      setState({ map: null, findings: [] });
    } finally {
      setLoading(false);
    }
  }

  return html`
    <div class="pf-app-datamap">
      <${DataMapLine} stamp=${stamp} onOpen=${toggle} />
      ${open ? html`
        <div class="pf-app-datamap-open">
          ${loading ? html`<${Spinner} />` : html`
            <${DataMapPanel} map=${state?.map} findings=${state?.findings} appLabel=${filename} />`}
          <button class="btn-ghost btn-sm" onClick=${() => setOpen(false)}>${t('common.close')}</button>
        </div>` : null}
    </div>`;
}
