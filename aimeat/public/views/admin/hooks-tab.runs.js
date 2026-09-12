/**
 * @file hooks-tab.runs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 04 of the admin Hooks page: every call the node made, newest first.
 *
 *   This did not exist. A gate refused a registration, the node wrote a line to the server log, and
 *   the operator saw nothing: nine people turned away looked exactly like nine people not bothering
 *   to sign up. A refusal here names what it stopped, so an account that could not be created has a
 *   reason somebody can read back to the person who was turned away.
 *
 * @structure HookRuns({ data }) — the filter, the table, the empty state
 * @usage <${HookRuns} data=${data} />
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, when } from './shared.js';

const S = (key, params) => t('admin.hooks.' + key, params);

/** How many rows show before the rest are behind a word. */
const PAGE = 25;

/** The tone each answer reads as. `no_address` is muted: nothing went wrong, nothing happened. */
const TONE = { ok: 'healthy', refused: 'danger', no_answer: 'danger', no_address: 'muted', missing: 'watch' };

export function HookRuns({ data }) {
  const [refusedOnly, setRefusedOnly] = useState(false);
  const [all, setAll] = useState(false);

  const rows = useMemo(
    () => (data.runs || []).filter(r => (refusedOnly ? !r.allowed || r.answer === 'refused' || r.answer === 'no_answer' : true)),
    [data.runs, refusedOnly]);
  const shown = all ? rows : rows.slice(0, PAGE);

  return html`
    <section class="og-sec" id="adm-hook-04">
      <div class="og-sec-h"><h2>${S('runs.title')}<small>04</small></h2>
        <div class="adm-hook-filters">
          <button type="button" class=${'adm-hook-fchip' + (refusedOnly ? '' : ' on')} onClick=${() => { setRefusedOnly(false); setAll(false); }}>${S('runs.filterAll')}</button>
          <button type="button" class=${'adm-hook-fchip' + (refusedOnly ? ' on' : '')} onClick=${() => { setRefusedOnly(true); setAll(false); }}>${S('runs.filterRefused')}</button>
        </div>
      </div>
      <p class="adm-hook-lead">${S('runs.lead')}</p>

      ${rows.length === 0
        ? html`<div class="adm-hook-empty">${(data.runs || []).length === 0 ? S('runs.none') : S('runs.noneMatch')}</div>`
        : html`<div class="adm-table-scroll"><table class="adm-table adm-hook-tbl">
            <thead><tr>
              <th>${S('runs.colWhen')}</th><th>${S('runs.colMoment')}</th><th>${S('runs.colCalled')}</th>
              <th>${S('runs.colAnswer')}</th><th>${S('runs.colTook')}</th><th>${S('runs.colWhat')}</th>
            </tr></thead>
            <tbody>
              ${shown.map((r, i) => html`<tr key=${r.at + i}>
                <td class="adm-hook-when">${when(r.at)}</td>
                <td class="adm-hook-when">${r.hook}</td>
                <td class="adm-hook-when">${r.actionName || r.actionRef}</td>
                <td>
                  <${Badge} type=${TONE[r.answer] || 'muted'} label=${S('runs.answer_' + r.answer)} />
                  ${r.status ? html` <span class="adm-hook-mono">${r.status}</span>` : null}
                </td>
                <td class="adm-hook-num">${S('runs.ms', { n: r.ms })}</td>
                <td class="adm-hook-what">
                  ${r.subject || '—'}
                  ${!r.allowed ? html`<span class="adm-why">${S('runs.stopped')}${r.reason ? `: ${r.reason}` : ''}</span>`
                    : r.reason ? html`<span class="adm-why">${r.reason}</span>` : null}
                </td>
              </tr>`)}
            </tbody>
          </table></div>`}

      ${rows.length > 0 ? html`
        <div class="adm-hook-foot">
          <span class="adm-hook-mono">${S('runs.shown', { n: shown.length, total: rows.length, kept: data.summary.runs_kept })}</span>
          ${rows.length > PAGE ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => setAll(!all)}>${all ? S('runs.showFewer') : S('runs.showAll', { n: rows.length })}</button>` : null}
        </div>` : null}
    </section>`;
}
