/**
 * @file scheduler-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Scheduler: the status page for what is done in the owner's name while they
 *   are away. Loads the schedule aggregate (managed, extension crons, each agent's self-reported
 *   scheduler) and the server's projected fire-times for the next seven days, derives the cover's
 *   model from them, and renders the poster face (scheduler/cover.js): what fires next, the week's
 *   rhythm, the continuous jobs, the rarer ones, the register, and each schedule as its own page
 *   with its actions. The server owns the clock; the handlers here call the same services the old
 *   card called.
 * @structure
 *   - SchedulerTab (default) — state, the two loads, the action handlers, the ctx bag, render
 * @usage Registered in profile.js TABS as { id:'scheduler', component: SchedulerTab }.
 * @version-history
 *   v2.0.0 -- 2026-08-30 -- The poster face (design canvas "AIMEAT Ajastimen sivu", direction A). The
 *     seven-column week grid and the wall of cards are replaced by the cover; a schedule opens as a
 *     page; the create form moved to scheduler/create-form.js. Loading and live updates unchanged.
 *   v1.2.0 -- 2026-08-24 -- Live update listens on 'scheduler', the domain the emitters actually send.
 *     It listened on 'schedules', which nothing emits, so this tab had never refreshed on a schedule
 *     change. A domain is a free-form string with no allowlist, so the typo could only go quiet.
 *   v1.1.0 -- 2026-07-16 -- Mount folds schedules + agents into GET /v1/scheduler/tab (getSchedulerTab);
 *     occurrences stay a range-driven request; individual reads kept as fallback.
 *   v1.1.0 -- 2026-07-03 -- Add SchedulerCalendar (day/week/month cadence view) at the top.
 *   v1.0.0 -- 2026-06-03 -- Initial master scheduler view
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { listAgents } from '/js/services/agents.js';
import { listAllSchedules, getSchedulerTab, listScheduleOccurrences, getScheduleDetail, setScheduleEnabled, triggerSchedule, deleteSchedule } from '/js/services/schedules.js';
import { swallowed } from '/js/swallowed.js';
import { buildModel, startOfDay } from './scheduler/model.js';
import { renderSchedulerView } from './scheduler/cover.js';
export { CreateForm } from './scheduler/create-form.js';

const html = htm.bind(h);
const WINDOW_DAYS = 7;

export default function SchedulerTab({ showToast }) {
  const [data, setData] = useState({ managed: [], extensions: [], agentInternal: [] });
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  // The next seven days as the server projects them: enumerated fire-times plus the continuous jobs
  // it summarises instead of listing.
  const [occ, setOcc] = useState({ occurrences: [], frequent: [] });
  const [occLoading, setOccLoading] = useState(true);
  // The poster face
  const [view, setView] = useState({ kind: 'cover' });
  const [nextOpen, setNextOpen] = useState(false);
  const [rhythmSort, setRhythmSort] = useState('time');
  const [regFilter, setRegFilter] = useState('all');
  const [regQuery, setRegQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null); // { id, runs, loading }

  const loadData = useCallback(async () => {
    try {
      const ov = await getSchedulerTab();
      if (ov) {
        setData(ov.schedules);
        setAgents(ov.agents);
      } else {
        const [schedRes, agentsRes] = await Promise.all([listAllSchedules(), listAgents().catch(err => { swallowed('scheduler-tab: SchedulerTab', err); return null; })]);
        setData(schedRes?.data || { managed: [], extensions: [], agentInternal: [] });
        setAgents(agentsRes?.data?.agents || []);
      }
      setError(null);
      setReloadTick((n) => n + 1);
    } catch (e) {
      setError(e.message || 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => {
    loadData();
    // 'scheduler', not 'schedules': that is the word every emitter sends (schedule-write.ts,
    // admin-scheduler.ts, scheduler.ts, mcp/agent-schedules.ts).
    return onLiveUpdate(['scheduler', 'agent-tasks'], () => loadRef.current());
  }, [loadData]);

  // The window starts today at midnight; refetched whenever the schedules change.
  const start = useMemo(() => startOfDay(new Date()), []);
  useEffect(() => {
    let alive = true;
    setOccLoading(true);
    const end = new Date(start.getTime() + WINDOW_DAYS * 864e5);
    listScheduleOccurrences(start, end)
      .then(res => { if (alive) setOcc({ occurrences: res?.data?.occurrences || [], frequent: res?.data?.frequent || [] }); })
      .catch(err => { swallowed('scheduler-tab: occurrences', err); if (alive) setOcc({ occurrences: [], frequent: [] }); })
      .finally(() => { if (alive) setOccLoading(false); });
    return () => { alive = false; };
  }, [start, reloadTick]);

  const model = useMemo(() => buildModel({ ...data, ...occ, start, now: new Date() }), [data, occ, start]);

  // A schedule's page loads its run log when it opens, and again after every action on it.
  const detailId = view.kind === 'detail' ? view.id : null;
  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    let alive = true;
    setDetail({ id: detailId, runs: [], loading: true });
    getScheduleDetail(detailId)
      .then(d => { if (alive) setDetail({ id: detailId, runs: d?.runs || [], loading: false }); })
      .catch(err => { swallowed('scheduler-tab: detail', err); if (alive) setDetail({ id: detailId, runs: [], loading: false }); });
    return () => { alive = false; };
  }, [detailId, reloadTick]);

  const pickView = (v) => { setView(v); setEditOpen(false); };
  const toggleMore = (id) => setMoreOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); await loadData(); } catch (e) { showToast?.(e.message, true); } finally { setBusy(false); }
  };
  const onToggle = (s) => run(() => setScheduleEnabled(s.id, s.enabled === false));
  // "Run now" reports what actually happened: an agent task can decline to create a task (a previous
  // run is still active, or a run limit is reached), which used to look like success.
  const onTrigger = (s) => run(async () => {
    const d = await triggerSchedule(s.id);
    if (d.outcome === 'created') showToast?.(t('profile.scheduler.runCreated'));
    else if (d.outcome === 'busy') showToast?.(t('profile.scheduler.runBusy'), true);
    else if (d.outcome === 'limited') showToast?.(t('profile.scheduler.runLimited'), true);
    else if (d.outcome === 'error') showToast?.(d.reason || t('profile.scheduler.runError'), true);
    else showToast?.(t('profile.scheduler.triggered'));
  });
  const onCancel = (s) => {
    if (!window.confirm(t('profile.scheduler.confirmCancel'))) return;
    run(async () => { await deleteSchedule(s.id); showToast?.(t('profile.scheduler.cancelled')); setView({ kind: 'cover' }); });
  };

  if (loading) return html`<div class="sch-loading">${t('profile.scheduler.loading')}</div>`;

  const ctx = {
    showToast, loadData, error, agents, model, internal: data.agentInternal || [], reloadTick, occLoading,
    view, pickView, nextOpen, setNextOpen, rhythmSort, setRhythmSort, regFilter, setRegFilter, regQuery, setRegQuery,
    showSearch, setShowSearch, agentsOpen, setAgentsOpen, moreOpen, toggleMore, editOpen, setEditOpen,
    busy, detail, onToggle, onTrigger, onCancel,
  };
  return renderSchedulerView(ctx);
}
