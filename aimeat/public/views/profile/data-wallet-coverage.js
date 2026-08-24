/**
 * @file data-wallet-coverage.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "What is stored here that nobody has described" — the coverage view, for the person
 *   whose store it is.
 *
 *   IT SITS ABOVE THE PERMISSION SUMMARY, not below it. That card counts "N memory keys" without
 *   saying which, and this is the drill-down that counter is asking for; what needs action goes
 *   above the totals, the way the compliance tab already orders its own page.
 *
 *   THE BROWSER NEVER SEES THE KEYS. The server folds the whole store into families and sends the
 *   answer — on the heaviest account here that is 18,446 keys arriving as about 27 rows. A surface
 *   that grouped them itself would ship eighteen thousand strings to draw twenty-seven lines.
 *
 *   ONE SENTENCE CARRIES BOTH NUMBERS a person acts on, because a percentage alone is not something
 *   anyone can do anything about. Then the groups, biggest first: naming the top few is most of the
 *   work, and naming one is a single form and no republish of anything.
 * @structure DataWalletCoverage
 * @usage html`<${DataWalletCoverage} showToast=${showToast} />`
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial, for TARGET-073.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { timeAgo } from '/js/utils.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

const BARS = ['schema-locked', 'declared-space', 'platform-prefix', 'owner-named', 'none'];
/** How many groups the list draws. The rest are counted in a line under it, never dropped in silence. */
const ROOTS_SHOWN = 50;
const BAR_KEY = {
  'schema-locked': 'locked', 'declared-space': 'declared',
  'platform-prefix': 'platform', 'owner-named': 'named', none: 'unknown',
};

/** The form that turns one unexplained group into a described one. */
function NameForm({ family, onSaved, onCancel, showToast }) {
  const [holds, setHolds] = useState('');
  const [why, setWhy] = useState('');
  const [personal, setPersonal] = useState('unstated');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiPost('/v1/datamap/name', { family, holds, why, personal_data: personal });
      showToast?.(t('dataMapCoverage.saved'));
      onSaved();
    } catch (e) {
      showToast?.(e.message || t('profile.error'), true);
    } finally { setBusy(false); }
  }

  return html`
    <div class="dwc-form">
      <label class="dwc-label">${t('dataMapCoverage.form.holds')}
        <input type="text" value=${holds} onInput=${e => setHolds(e.target.value)} />
      </label>
      <label class="dwc-label">${t('dataMapCoverage.form.why')}
        <input type="text" value=${why} onInput=${e => setWhy(e.target.value)} />
      </label>
      <label class="dwc-label">${t('dataMapCoverage.form.personal')}
        <select value=${personal} onChange=${e => setPersonal(e.target.value)}>
          <option value="unstated">${t('dataMap.personal.unstated')}</option>
          <option value="yes">${t('dataMap.personal.yes')}</option>
          <option value="no">${t('dataMap.personal.no')}</option>
        </select>
      </label>
      <div class="dwc-form-actions">
        <button class="btn-primary btn-sm" disabled=${busy} onClick=${save}>${t('dataMapCoverage.form.save')}</button>
        <button class="btn-outline btn-sm" disabled=${busy} onClick=${onCancel}>${t('dataMapCoverage.form.cancel')}</button>
      </div>
    </div>`;
}

export function DataWalletCoverage({ showToast }) {
  const [report, setReport] = useState(null);
  const [naming, setNaming] = useState(null);

  async function load() {
    try {
      const r = await apiGet('/v1/datamap/coverage');
      setReport(r?.data ?? r ?? null);
    } catch (err) { swallowed('data-wallet-coverage', err); setReport(null); }
  }
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { load(); }, []);
  // 'memory' is deliberately absent: it ticks constantly on a store this size, and this view is a
  // slow-moving summary rather than a live counter.
  useEffect(() => onLiveUpdate(['data-map'], () => loadRef.current()), []);

  if (!report) return null;
  if (report.unexplainedKeys === 0) {
    return html`
      <div class="dwc">
        <h3 class="dwc-title">${t('dataMapCoverage.title')}</h3>
        <p class="dwc-lede">${t('dataMapCoverage.noneUnknown')}</p>
      </div>`;
  }

  const total = report.totalKeys || 1;
  // The list is the drill-down, not the archive. An account with 70 unexplained groups renders 70
  // rows and reads as a wall, so the largest are shown and the remainder is SAID rather than
  // dropped: a cap nobody mentions reads as "that is all of it".
  const all = report.roots ?? [];
  const shown = all.slice(0, ROOTS_SHOWN);
  const rest = (report.unexplainedFamilies ?? all.length) - shown.length;
  return html`
    <div class="dwc">
      <h3 class="dwc-title">${t('dataMapCoverage.title')}</h3>
      <p class="dwc-lede">
        ${t('dataMapCoverage.oneLine', {
          total: report.totalKeys,
          keys: report.unexplainedKeys,
          groups: report.unexplainedFamilies,
        })}
      </p>

      <div class="dwc-bar" role="img" aria-label=${t('dataMapCoverage.title')}>
        ${BARS.map(tier => {
          const n = report.byTier?.[tier] ?? 0;
          if (!n) return null;
          return html`<span key=${tier} class=${`dwc-seg dwc-seg-${BAR_KEY[tier]}`}
            style=${`flex-grow:${n}`} title=${`${t(`dataMap.basis.${BAR_KEY[tier]}`)}: ${n}`}></span>`;
        })}
      </div>
      <div class="dwc-legend">
        ${BARS.map(tier => (report.byTier?.[tier] ? html`
          <span key=${tier} class="dwc-legend-item">
            <span class=${`dwc-dot dwc-seg-${BAR_KEY[tier]}`}></span>
            ${t(`dataMap.basis.${BAR_KEY[tier]}`)} ${report.byTier[tier]}
          </span>` : null))}
      </div>

      <div class="dwc-roots">
        ${shown.map(r => html`
          <div class="dwc-root" key=${r.family}>
            <div class="dwc-root-head">
              <span class="dwc-family">${r.family}</span>
              <span class="dwc-count">${r.keys === 1
                ? t('dataMapCoverage.root.countOne')
                : t('dataMapCoverage.root.count', { n: r.keys })}</span>
              <span class="dwc-when">${r.lastWritten ? timeAgo(r.lastWritten) : ''}</span>
              <button class="btn-outline btn-sm" onClick=${() => setNaming(naming === r.family ? null : r.family)}>
                ${t('dataMapCoverage.sayWhatThisIs')}
              </button>
            </div>
            <div class="dwc-sample">${(r.sample ?? []).join(' · ')}</div>
            ${naming === r.family ? html`
              <${NameForm} family=${r.family} showToast=${showToast}
                onCancel=${() => setNaming(null)}
                onSaved=${() => { setNaming(null); loadRef.current(); }} />` : null}
          </div>`)}
      </div>
      ${rest > 0 ? html`
        <p class="dwc-more">${t('dataMapCoverage.moreGroups', { n: shown.length, rest })}</p>` : null}

      <ul class="dwc-limits">
        ${(report.notCovered ?? []).map(line => html`<li key=${line}>${line}</li>`)}
      </ul>
      <p class="dwc-asof">
        ${t('dataMapCoverage.asOf', { at: new Date(report.asOf).toLocaleString() })}
        ${' · '}${Math.round((report.identified / total) * 100)}%
      </p>
    </div>`;
}

export default DataWalletCoverage;
