/**
 * @file compliance-tab.saved.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The compliance reports this node has kept, and the button that keeps one now.
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
 *   OPENING ONE FETCHES IT, AND ONLY THEN. The index carries titles, never bodies — a year of
 *   reports is a large read, and the list exists so somebody can choose before paying for one.
 * @structure
 *   - SavedReports (default) — the list, the save button, and one report opened in place
 * @usage imported by compliance-tab.js, rendered under the register
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02. The monthly job had no reader.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { downloadBlob } from '/js/utils.js';
import { swallowed } from '/js/swallowed.js';
import { Empty, Spinner } from './shared.js';

/** `2026-08-23-1930` reads as a time to nobody. `2026-08-23 19:30` does. */
function readableId(id) {
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/.exec(id);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : id;
}

/** A stored report, opened in place: enough to see what is in it without leaving the page. */
function OpenedReport({ id, report }) {
  const scope = report?.scope || {};
  const usecases = report?.register?.usecases || [];
  const byClass = new Map();
  for (const u of usecases) {
    const label = u.risk?.label || u.risk?.class || '—';
    byClass.set(label, (byClass.get(label) || 0) + 1);
  }
  return html`
    <div class="adm-cmp-saved-open">
      <p class="adm-cmp-note">
        ${scope.node_id || ''}
        ${' · '}${(scope.period?.from || '').slice(0, 10)}–${(scope.period?.to || '').slice(0, 10)}
        ${' · '}${t('admin.compliance.printGenerated').replace('{at}', (scope.generated_at || '').replace('T', ' ').slice(0, 16))}
      </p>
      <ul class="adm-cmp-saved-facts">
        <li>${t('admin.compliance.savedEntries').replace('{n}', usecases.length)}</li>
        <li>${t('admin.compliance.savedGaps').replace('{n}', (report?.gaps || []).length)}</li>
        ${[...byClass].map(([label, n]) => html`<li key=${label}>${label}: ${n}</li>`)}
      </ul>
      <button
        type="button"
        class="btn-outline"
        onClick=${() => downloadBlob(
          new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
          `compliance-${id}.json`,
        )}
      >${t('admin.compliance.savedDownload')}</button>
    </div>
  `;
}

export default function SavedReports({ days, onSaved, onError }) {
  const [reports, setReports] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [opened, setOpened] = useState(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => { load(); }, [load]);

  const open = async (id) => {
    if (openId === id) { setOpenId(null); setOpened(null); return; }
    setOpenId(id);
    setOpened(null);
    try {
      const r = await apiGet(`/v1/admin/compliance/reports?id=${encodeURIComponent(id)}`);
      setOpened(r?.data?.report || null);
    } catch (e) {
      onError?.(e?.message || t('admin.compliance.savedOpenFailed'));
      swallowed('compliance-saved: open', e);
      setOpenId(null);
    }
  };

  const saveNow = async () => {
    setBusy(true);
    try {
      const r = await apiPost('/v1/admin/compliance/snapshot', { since_days: days });
      await load();
      onSaved?.(t('admin.compliance.savedDone').replace('{id}', readableId(r?.data?.id || '')));
    } catch (e) {
      onError?.(e?.message || t('admin.compliance.savedFailed'));
      swallowed('compliance-saved: save', e);
    }
    setBusy(false);
  };

  return html`
    <section class="adm-cmp-section adm-cmp-no-print">
      <h3>${t('admin.compliance.savedTitle')}</h3>
      <p class="adm-cmp-note">${t('admin.compliance.savedNote')}</p>

      <div class="adm-cmp-actions">
        <button type="button" class="btn-primary" disabled=${busy} onClick=${saveNow}>
          ${busy ? t('admin.compliance.savedSaving') : t('admin.compliance.savedNow')}
        </button>
      </div>

      ${reports === null && html`<${Spinner} text=${t('admin.compliance.loading')} />`}
      ${reports?.length === 0 && html`<${Empty} text=${t('admin.compliance.savedEmpty')} />`}
      ${reports?.length > 0 && html`
        <ul class="adm-cmp-saved-list">
          ${reports.map(r => html`
            <li key=${r.id}>
              <div class="adm-cmp-saved-row">
                <span class="adm-cmp-saved-id">${readableId(r.id)}</span>
                <span class="adm-cmp-saved-kind">
                  ${t(r.kind === 'monthly' ? 'admin.compliance.savedKindMonthly' : 'admin.compliance.savedKindManual')}
                </span>
                <button type="button" class="btn-ghost" onClick=${() => open(r.id)}>
                  ${openId === r.id ? t('admin.compliance.close') : t('admin.compliance.edit')}
                </button>
              </div>
              ${openId === r.id && (opened
                ? html`<${OpenedReport} id=${r.id} report=${opened} />`
                : html`<${Spinner} text=${t('admin.compliance.loading')} />`)}
            </li>
          `)}
        </ul>
      `}
    </section>
  `;
}
