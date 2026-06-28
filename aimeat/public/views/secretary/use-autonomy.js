/**
 * @file secretary/use-autonomy.js
 * @description Phase 4 — autonomous tick + Home feed + calendar. A hook that loads the Secretary's
 *   activity feed (`secretary.feed`) and its autonomous schedule (a `secretary`-kind scheduled job),
 *   and lets the owner enable / run-now / pause the daily check-in. The backend `secretary` scheduler
 *   kind (services/scheduler.ts) runs the active context's brain on the owner's key each fire and
 *   appends a briefing to the feed — unless stop-spending is on. See docs/plans/2026-06-23-secretary-feature.md (Phase 4).
 * @structure useAutonomy({ showToast }) -> { feed, schedule, loading, refresh, enableTick, runTick, toggleTick, running }
 * @usage const auto = useAutonomy({ showToast }); ... feedCard(auto) / automationCard(auto)
 * @version-history v0.1.0 — 2026-06-24 — Phase 4: autonomous tick, feed, calendar controls.
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { api, apiGet, apiPost, apiPatch } from '/js/api.js';
import { t } from '/js/i18n.js';

const DAILY_CRON = '0 8 * * *'; // every day at 08:00 (server-local)

export function useAutonomy({ showToast }) {
  const [feed, setFeed] = useState([]);
  const [schedule, setSchedule] = useState(null); // the secretary-kind ScheduledJobRecord, or null
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [feedR, schedR] = await Promise.all([
        apiGet('/v1/memory/secretary.feed').catch(() => null),
        apiGet('/v1/schedules').catch(() => null),
      ]);
      const items = (feedR && feedR.data && feedR.data.value && Array.isArray(feedR.data.value.items)) ? feedR.data.value.items : [];
      setFeed(items);
      const managed = (schedR && schedR.data && Array.isArray(schedR.data.managed)) ? schedR.data.managed : [];
      setSchedule(managed.find((j) => j.type === 'secretary') || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Re-fetch on server-reported changes (the tick writes the feed + schedule state server-side).
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [refresh]);

  // Remove one entry from the activity feed (an item in the single secretary.feed memory record).
  const deleteFeedItem = useCallback(async (id) => {
    if (!id) return;
    const r = await apiGet('/v1/memory/secretary.feed').catch(() => null);
    const items = (r && r.data && r.data.value && Array.isArray(r.data.value.items)) ? r.data.value.items : [];
    const next = items.filter((it) => it && it.id !== id);
    await apiPost('/v1/memory', { key: 'secretary.feed', value: { items: next }, visibility: 'private' }).catch(() => {});
    setFeed(next);
  }, []);

  const enableTick = useCallback(async () => {
    try {
      await apiPost('/v1/schedules', { kind: 'secretary', cron: DAILY_CRON, display_name: t('secretary.auto.scheduleName') });
      showToast(t('secretary.auto.enabled'));
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.auto.error')}: ${e.message}`, true);
    }
  }, [refresh, showToast]);

  const runTick = useCallback(async () => {
    if (!schedule) return;
    setRunning(true);
    try {
      // The tick makes a (possibly slow) AI call server-side — use api() with a long timeout + no
      // retries so it isn't aborted/re-fired by apiPost's 30s default. (See long-ai-call gotcha.)
      const r = await api(`/v1/schedules/${schedule.id}/trigger`, { method: 'POST', body: '{}', timeoutMs: 1_800_000, retries: 0 });
      const outcome = r && r.data && r.data.outcome;
      // 'busy'/'limited'/'error' come back with a reason; 'ran' means a feed entry was produced.
      if (outcome && outcome !== 'ran' && outcome !== 'created') {
        const reason = String((r.data && r.data.reason) || outcome);
        const human = /stop-spending/i.test(reason) ? t('secretary.auto.skipStopSpending')
          : /budget/i.test(reason) ? t('secretary.auto.skipBudget')
          : /no secretary context/i.test(reason) ? t('secretary.auto.skipNoContext')
          : reason;
        showToast(`${t('secretary.auto.skipped')}: ${human}`);
      } else {
        showToast(t('secretary.auto.ran'));
      }
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.auto.error')}: ${e.message}`, true);
    } finally {
      setRunning(false);
    }
  }, [schedule, refresh, showToast]);

  const toggleTick = useCallback(async () => {
    if (!schedule) return;
    try {
      await apiPatch(`/v1/schedules/${schedule.id}`, { enabled: !schedule.enabled });
      await refresh();
    } catch (e) {
      showToast(`${t('secretary.auto.error')}: ${e.message}`, true);
    }
  }, [schedule, refresh, showToast]);

  return { feed, schedule, loading, running, refresh, enableTick, runTick, toggleTick, deleteFeedItem };
}
