/**
 * @file public/components/DataMap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app is, what it is used for, and where its data actually lives.
 *
 *   WHO READS THIS. Somebody — a person or an AI — about to work on an app they did not write. The
 *   paragraph at the top is what they need first and the rows are second, which is why the paragraph
 *   is not a caption under a table.
 *
 *   THE CONTRADICTION IS THE HEADLINE. An app that says several people share it, whose every row
 *   lands in one person's own memory, is the defect this whole feature exists to catch. When it is
 *   there it goes above everything, panel-wide, in body text — never as a corner badge.
 * @structure DataMapPanel · DataMapLine
 * @usage
 *   import { DataMapPanel, DataMapLine } from '/components/DataMap.js';
 *   <DataMapLine stamp=${app.data_map} onOpen=${...} />
 *   <DataMapPanel map=${map} findings=${findings} />
 * @version-history
 *   v2.0.0 — 2026-08-25 — Rewritten for aimeat.datamap/2. v1 rendered a key pattern and its
 *     compliance columns and never said what the app was for, so it answered nobody's question.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import {
  labelKeyFor, orderRows, contradictionOf, placesOf, stateOf, DATA_MAP_SPEC,
} from '/components/data-map/model.js';

const html = htm.bind(h);

/** An axis value in the reader's language, or the raw word when this build does not know it. */
function label(axis, value) {
  const key = labelKeyFor(axis, value);
  return key ? t(key) : String(value || '');
}

/**
 * The one line a list shows: where this app's data is.
 *
 * Built from the stamp, so a list of 35 apps renders without opening 35 documents.
 */
export function DataMapLine({ stamp, onOpen }) {
  // A stamp from an older spec is a stamp from the version that GUESSED, and 110 apps on the
  // production node still carry one. Reading it as a map makes the list say "written" about an app
  // nobody has described, which is the exact lie this rewrite removed from everywhere else.
  const current = stamp && stamp.spec === DATA_MAP_SPEC;
  const missing = !current || stamp.missing;
  // A contradiction is not the same news as an unfinished sentence, and the list is where somebody
  // scanning 35 apps decides which one to open. It must be distinguishable without opening any.
  const state = missing ? 'missing'
    : stamp.gap?.code === 'DATAMAP_FORM_CONTRADICTED' ? 'contradicted'
    : stamp.gap ? 'unfinished'
    : 'stated';
  const text = missing ? t('dataMap.line.missing') : stamp.summary;

  return html`
    <button type="button" class=${`dm-line dm-line-${state}`} onClick=${onOpen}>
      <span class="dm-line-state">${t(`dataMap.state.${state}`)}</span>
      <span class="dm-line-text">${text}</span>
      <span class="dm-line-open">${t('dataMap.line.open')}</span>
    </button>`;
}

/** One row of the first table. Two lines: the address and what it is, then the sentence. */
function Row({ row }) {
  return html`
    <div class=${`dm-row${row.why ? '' : ' dm-row-unexplained'}`}>
      <div class="dm-row-head">
        <span class="dm-what">${row.what}</span>
        <span class="dm-holds">${row.holds}</span>
        <span class="dm-where">${label('where', row.where)}${row.whereExactly
          ? html` <span class="dm-where-exact">${row.whereExactly}</span>` : null}</span>
      </div>
      <div class="dm-row-facts">
        <span>${label('kind', row.kind)}</span>
        <span>${label('use', row.usedFor)}</span>
        <span>${label('readers', row.readers)}</span>
        <span>${label('loss', row.lossRisk)}</span>
        <span>${label('kept', row.keptFor)}</span>
        ${row.personalData === 'yes' ? html`<span class="dm-personal">${t('dataMap.personal.yes')}</span>` : null}
      </div>
      <div class=${`dm-why${row.why ? '' : ' dm-why-missing'}`}>
        ${row.why || t('dataMap.row.noWhy')}
      </div>
    </div>`;
}

/** The whole map. The paragraph first, because that is what makes the rows judgeable. */
export function DataMapPanel({ map, findings, appLabel }) {
  if (!map || map.spec !== DATA_MAP_SPEC || map.source === 'none') {
    return html`
      <div class="dm-panel dm-panel-missing">
        <h3 class="dm-title">${t('dataMap.title')}</h3>
        <p class="dm-missing">${t('dataMap.panel.missing')}</p>
      </div>`;
  }

  const contradiction = contradictionOf(map);
  const places = placesOf(map);
  const rows = orderRows(map.held || []);

  return html`
    <div class=${`dm-panel dm-panel-${stateOf(map)}`}>
      <h3 class="dm-title">${t('dataMap.title')}${appLabel ? ` — ${appLabel}` : ''}</h3>

      ${contradiction ? html`
        <p class="dm-contradiction">${t(contradiction)}</p>` : null}

      <div class="dm-about">
        <p class="dm-what-para">${map.what || html`<em>${t('dataMap.panel.noWhat')}</em>`}</p>
        <p class="dm-used-for"><b>${t('dataMap.usedForLabel')}</b> ${map.usedFor
          || html`<em>${t('dataMap.panel.noUsedFor')}</em>`}</p>
        <p class="dm-form"><b>${t('dataMap.formLabel')}</b> ${label('form', map.form)}</p>
      </div>

      <div class="dm-arrangement">
        <h4>${t('dataMap.arrangementLabel')}</h4>
        <p>${map.arrangement || html`<em>${t('dataMap.panel.noArrangement')}</em>`}</p>
        ${places.length > 0 ? html`
          <ul class="dm-places">
            ${places.map(p => html`<li key=${p.where}>${label('where', p.where)} · ${p.n}</li>`)}
          </ul>` : null}
      </div>

      ${rows.length > 0 ? html`
        <div class="dm-rows">
          <h4>${t('dataMap.rowsLabel')}</h4>
          ${rows.map((r, i) => html`<${Row} key=${r.what + i} row=${r} />`)}
        </div>` : null}

      ${(map.machinery || []).length > 0 ? html`
        <div class="dm-machinery">
          <h4>${t('dataMap.machineryLabel')}</h4>
          <p>${map.machinery.join(' · ')}</p>
        </div>` : null}

      ${(map.leaves || []).length > 0 ? html`
        <div class="dm-leaves">
          <h4>${t('dataMap.leavesLabel')}</h4>
          <ul>
            ${map.leaves.map((l, i) => html`
              <li key=${i}>${l.what} → ${l.to}
                ${l.recallable ? '' : html` <span class="dm-no-recall">${t('dataMap.leaves.noRecall')}</span>`}</li>`)}
          </ul>
        </div>` : null}

      ${(map.elsewhere || []).length > 0 ? html`
        <div class="dm-elsewhere">
          <h4>${t('dataMap.elsewhereLabel')}</h4>
          ${map.elsewhere.map((e, i) => html`
            <div class="dm-else-row" key=${i}>
              <div class="dm-row-head">
                <span class="dm-what">${e.what}</span>
                <span class="dm-holds">${t(`dataMap.elsewhere.${e.status}`)}</span>
              </div>
              <div class="dm-row-facts">
                <span>${t('dataMap.elsewhere.whereLabel')} ${e.where}</span>
                <span>${t('dataMap.elsewhere.controlledByLabel')} ${e.controlledBy}</span>
              </div>
              <div class="dm-why">${e.deletion}</div>
            </div>`)}
        </div>` : null}

      ${(findings || []).length > 0 ? html`
        <div class="dm-findings">
          <h4>${t('dataMap.findingsLabel')}</h4>
          <ul>${findings.map(f => html`<li key=${f.code}>${f.message}</li>`)}</ul>
        </div>` : null}
    </div>`;
}
