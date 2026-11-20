/**
 * @file public/views/profile/reports-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings & Controls page "Reports": the person's report subscriptions, one memory record
 *   each under `reports.sub.<id>` (services/reports/subscriptions.ts). The person's AI makes and changes
 *   them in chat; this page shows every one in its scope (own work, a workspace, an organism, the whole
 *   AIMEAT), when it goes out and to whom, when it last went out or why it did not, and holds the
 *   controls that need a screen: pause, resume and remove.
 *
 *   EVERY WRITE IS THE WHOLE RECORD ON ITS VERSION (PUT /v1/memory/:key with `version`): a version the
 *   scheduler or the AI wrote meanwhile answers 409 VERSION_CONFLICT, and the page reads the list again.
 *
 *   LIVE: read again on the `memory` domain of the `aimeat-live-update` event, so a subscription the AI
 *   saves in chat shows here without a reload. No timer.
 * @structure x · subOf · whenWords · scopeWords · stateOf · ReportsTab (default)
 * @usage registered in profile.js TABS as id 'reports', listed in the Business group of SIDEBAR_GROUPS.
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 4).
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiDelete } from '/js/api.js';
import { date, time } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';

const x = (k, v) => t('reports.' + k, v);
const PREFIX = 'reports.sub.';
const enc = encodeURIComponent;
const SKIPS = ['nothing', 'not-operator', 'organism-gone', 'not-organism-owner', 'no-workspace-read', 'invalid'];

/** A memory row as the page reads a subscription; the scheduler checks the same record again at every send. */
function subOf(row) {
  const v = row?.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const id = String(row.key).slice(PREFIX.length);
  return { key: row.key, id, version: row.version, value: v, name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : id };
}

/** "Every Monday at 09:00": the UTC hour the record holds, on the reader's own clock. */
function whenWords(v) {
  const at = new Date();
  at.setUTCHours(Number.isInteger(v.hour) ? v.hour : 7, 0, 0, 0);
  const clock = time(at, { hour: '2-digit', minute: '2-digit' });
  if (v.cadence === 'weekly') {
    // 2026-11-23 is a Monday: weekday 1..7 lands on Monday..Sunday.
    const day = new Date(Date.UTC(2026, 10, 22 + (Number.isInteger(v.weekday) ? v.weekday : 1), 12));
    return x('cadence.weekly', { day: date(day, { weekday: 'long' }), time: clock });
  }
  if (v.cadence === 'monthly') return x('cadence.monthly', { d: Number.isInteger(v.monthDay) ? v.monthDay : 1, time: clock });
  if (v.cadence === 'cron') return x('cadence.cron', { cron: String(v.cron ?? '') });
  if (['daily', 'every-other-day', 'burst'].includes(v.cadence)) return x('cadence.' + v.cadence, { time: clock });
  return x('cadence.unknown');
}

/** Whose work the report covers, with the organism's name when the person can see it. */
function scopeWords(v, orgNames) {
  const org = orgNames[v.orgId] || v.orgId || '';
  if (v.scope === 'organism') return x('scope.organism', { org });
  if (v.scope === 'workspace') return x('scope.workspace', { org });
  if (v.scope === 'node') return x('scope.node');
  return x('scope.own');
}

/** The state mark and the line under the name: paused, not sent and why, or when it last went out. */
function stateOf(v) {
  if (v.paused === true) return { tone: 'off', word: x('state.paused') };
  if (typeof v.lastSkip === 'string' && v.lastSkip !== 'nothing') return { tone: 'attention', word: x('state.skipped') };
  return { tone: 'fine', word: x('state.on') };
}

function lastWords(v) {
  if (typeof v.lastSkip === 'string' && SKIPS.includes(v.lastSkip)) {
    return x('skip.' + v.lastSkip, { detail: typeof v.lastSkipDetail === 'string' ? v.lastSkipDetail : '' });
  }
  return v.lastSentAt ? x('lastSent', { when: date(v.lastSentAt) }) : x('never');
}

export default function ReportsTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const toast = (msg, isError) => showToast?.(msg, isError);
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orgNames, setOrgNames] = useState({});

  const load = useCallback(async () => {
    try {
      const rows = (await apiGet(`/v1/memory?prefix=${enc(PREFIX)}&limit=200`))?.data?.items || [];
      setItems(rows.map(subOf).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)));
      setFailed(false);
    } catch (e) { swallowed('reports-tab: list', e); setFailed(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load);
  liveRef.current = load;
  useEffect(() => onLiveUpdate(['memory'], () => liveRef.current()), []);

  // An organism's name, read only when a subscription names one.
  const needsOrgs = (items || []).some((s) => s.value.orgId);
  useEffect(() => {
    if (!needsOrgs) return undefined;
    let live = true;
    getOrganismsTab().then((tab) => { if (live) setOrgNames(Object.fromEntries((tab?.mine || []).map((o) => [o.id, o.name]))); });
    return () => { live = false; };
  }, [needsOrgs]);

  const setPaused = async (s, paused) => {
    setBusy(true);
    try {
      await apiPut(`/v1/memory/${enc(s.key)}`, { value: { ...s.value, paused }, version: s.version });
      toast(x(paused ? 'pausedToast' : 'resumedToast', { name: s.name }));
    } catch (e) {
      toast(e?.code === 'VERSION_CONFLICT' ? x('conflict') : (e?.message || x('failed')), true);
    } finally { setBusy(false); await load(); }
  };

  const remove = (s) => confirm(x('deleteConfirm', { name: s.name }), async () => {
    setBusy(true);
    try {
      await apiDelete(`/v1/memory/${enc(s.key)}`);
      toast(x('deletedToast', { name: s.name }));
    } catch (e) { toast(e?.message || x('failed'), true); } finally { setBusy(false); await load(); }
  }, { danger: true, title: x('delete'), confirmLabel: x('delete') });

  const row = (s) => {
    const v = s.value;
    const st = stateOf(v);
    const to = ['me', 'owners', 'members', 'operators'].includes(v.recipients) ? v.recipients : 'me';
    const what = (Array.isArray(v.contents) ? v.contents : []).filter((c) => ['value', 'data', 'rhythm', 'goals', 'measures'].includes(c)).map((c) => x('content.' + c)).join(', ');
    return html`
      <${Row} key=${s.key} faded=${v.paused === true}>
        <${Name} meta=${scopeWords(v, orgNames)}>${s.name}<//>
        <${Desc} sub=${lastWords(v)}>${[whenWords(v), x('to.' + to), what].filter(Boolean).join(' · ')}<//>
        <${Cell}><${Mark} kind="status" tone=${st.tone}>${st.word}<//><//>
        <${Doors}>
          <${Action} small row disabled=${busy} onClick=${() => setPaused(s, v.paused !== true)}>${v.paused === true ? x('resume') : x('pause')}<//>
          <${Action} small row disabled=${busy} onClick=${() => remove(s)}>${x('delete')}<//>
        <//>
      <//>`;
  };

  return html`
    <${SettingsPage} name="reports"
      crumb=${[t('nav.profile'), t('profile.landing.menuBusiness'), t('profile.tabs.reports')]}
      title=${t('profile.tabs.reports')} help="concept.reportSubscription" desc=${x('desc')}
      start=${html`<${PageStart} id="reports" done=${items ? items.length > 0 : null} />`}
      after=${html`<${ConfirmUI} />`}>
      ${failed ? html`<${Note} kind="quiet">${x('failed')}<//>` : null}
      <${List} cols="name-desc-state-doors" loading=${!items && !failed ? x('loading') : false}
        head=${[x('col.name'), x('col.when'), x('col.state'), '']}
        empty=${html`<${Note} kind="quiet"><b>${x('emptyLead')}</b> ${x('emptyBody')}<//>`}>
        ${(items || []).map(row)}
      <//>
    <//>`;
}
