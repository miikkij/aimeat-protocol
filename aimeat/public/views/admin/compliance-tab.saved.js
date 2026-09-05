/**
 * @file compliance-tab.saved.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 06 of the admin Compliance page: the reports this node has kept, one row
 *   each with its stamp, its kind and a door that opens it in place or downloads it.
 *
 *   WHY IT EXISTS. The scheduled job has been writing a report into the node's own store on the
 *   first of every month since this feature shipped, and no screen could read one back. A record
 *   nobody can open is not evidence, so the archive was doing nothing for the person it was written
 *   for.
 *
 *   A KEPT REPORT IS FROZEN, WHICH IS THE POINT. The page rebuilds the report on every load, so its
 *   numbers move as the window slides and as somebody edits the register. A kept one never moves
 *   again. That is what makes it answerable a year later, and it is why the row says which of the
 *   two kinds it is: the schedule's closed month, or a moment a person chose.
 *
 *   OPENING ONE FETCHES IT, AND ONLY THEN. The index carries ids and stamps, never bodies — a year
 *   of reports is a large read, and the list exists so somebody can choose before paying for one.
 *   The download fetches the same way and hands the JSON over as it was stored.
 *
 *   KEEPING ONE IS THE TAB'S ACTION, offered here and in the toolbar, so the list only needs to
 *   know when to read again: the `refresh` prop changes and it does.
 * @structure
 *   - readableId(id) — `2026-08-23-1930` as `2026-08-23 19:30`
 *   - OpenedReport — one kept report's facts, in place
 *   - SavedReports (default) — the rows
 * @usage imported by compliance-tab.js, rendered beside the paste
 * @version-history
 *   v2.0.0 — 2026-09-05 — The poster face: rows with a mono stamp and a chip, Open and Download as
 *     doors, the keep action lifted to the tab and offered in the section's header.
 *   v1.0.0 — 2026-08-23 — BR-02. The monthly job had no reader.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { downloadBlob } from '/js/utils.js';
import { swallowed } from '/js/swallowed.js';
import { num, Spinner } from './shared.js';
import { classCounts } from './compliance-tab.gaps.js';
import { classWord } from './compliance-tab.register.js';

const C = (key, params) => t('admin.compliance.' + key, params);

/** `2026-08-23-1930` reads as a time to nobody. `2026-08-23 19:30` does. */
export function readableId(id) {
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/.exec(id);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : id;
}

/** A stored report, opened in place: enough to see what is in it without leaving the page. */
function OpenedReport({ report }) {
  const scope = report?.scope || {};
  const usecases = report?.register?.usecases || [];
  const tr = report?.derived?.ai_transparency || {};
  const usage = report?.derived?.ai_usage || {};
  const classes = classCounts(usecases).map(c => `${classWord(c.cls)} ${num(c.n)}`).join(', ');
  return html`
    <div class="adm-cmp-open">
      <span class="adm-cmp-mono">${scope.node_id || ''} · ${(scope.period?.from || '').slice(0, 10)} → ${(scope.period?.to || '').slice(0, 10)} · ${C('printGenerated', { at: (scope.generated_at || '').replace('T', ' ').slice(0, 16) })}</span>
      ${C('savedFacts', {
        entries: num(usecases.length), gaps: num((report?.gaps || []).length), calls: num(usage.calls ?? 0),
        public: num(tr.public_total ?? 0), unlabelled: num(tr.unlabelled ?? 0), v: report?.register?.questionnaire?.version || '',
      })}${classes ? ` · ${classes}` : ''}
    </div>`;
}

export default function SavedReports({ refresh, keeping, onKeep, onError }) {
  const [reports, setReports] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [opened, setOpened] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/admin/compliance/reports');
      setReports(r?.data?.reports || []);
    } catch (e) {
      // The list failing must not take the page down with it: everything above this section is a
      // live report the operator still needs to read.
      setReports([]);
      swallowed('compliance-saved: list', e);
    }
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  const fetchOne = async (id) => {
    const r = await apiGet(`/v1/admin/compliance/reports?id=${encodeURIComponent(id)}`);
    return r?.data?.report || null;
  };

  const open = async (id) => {
    if (openId === id) { setOpenId(null); setOpened(null); return; }
    setOpenId(id);
    setOpened(null);
    try {
      setOpened(await fetchOne(id));
    } catch (e) {
      onError?.(e?.message || C('savedOpenFailed'));
      swallowed('compliance-saved: open', e);
      setOpenId(null);
    }
  };

  const download = async (id) => {
    try {
      const report = openId === id && opened ? opened : await fetchOne(id);
      downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `compliance-${id}.json`);
    } catch (e) {
      onError?.(e?.message || C('savedOpenFailed'));
      swallowed('compliance-saved: download', e);
    }
  };

  return html`
    <section class="og-sec adm-cmp-no-print" id="adm-cmp-06">
      <div class="og-sec-h"><h2>${C('savedTitle')}<small>06</small></h2>
        <div class="og-doors"><button type="button" class="og-door og-door--quiet" disabled=${keeping} onClick=${onKeep}>${keeping ? C('savedSaving') : C('savedNow')}</button></div></div>
      <p class="adm-cmp-lead">${C('savedNote')}</p>
      ${reports === null ? html`<${Spinner} text=${C('loading')} />` : null}
      ${reports?.length === 0 ? html`<div class="adm-cmp-empty adm-cmp-empty--last">${C('savedEmpty')}</div>` : null}
      ${(reports || []).map((r, i) => html`
        <div class="adm-mrow adm-mrow--two ${i === reports.length - 1 ? 'adm-mrow--last' : ''}" key=${r.id}>
          <span>
            <span class="adm-cmp-stamp">${readableId(r.id)}</span>
            <span class="og-chip adm-cmp-chip--dim">${t(r.kind === 'monthly' ? 'admin.compliance.savedKindMonthly' : 'admin.compliance.savedKindManual')}</span>
            <span class="adm-why">${r.generated_at ? C('printGenerated', { at: String(r.generated_at).replace('T', ' ').slice(0, 16) }) : ''}</span>
            ${openId === r.id ? (opened ? html`<${OpenedReport} report=${opened} />` : html`<${Spinner} text=${C('loading')} />`) : null}
          </span>
          <span class="adm-cmp-right">
            <button type="button" class="og-door og-door--quiet" onClick=${() => open(r.id)}>${openId === r.id ? C('close') : C('edit')}</button>
            <button type="button" class="og-door og-door--quiet" onClick=${() => download(r.id)}>${C('savedDownload')}</button>
          </span>
        </div>`)}
    </section>`;
}
