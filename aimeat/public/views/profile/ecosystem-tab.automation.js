/**
 * @file public/views/profile/ecosystem-tab.automation.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The GEAI card "Automation" flow and its pieces — <EcoScheduleLog> (per-schedule
 *   run-history), <EcoStatusChip> (status-timeline chip), <EcoAgentPicker> (recommendation-aware
 *   agent picker), and <EcoAutomationSection> (the unified turnkey publish→process→deliver flow).
 *   Extracted from ecosystem-tab.js to satisfy max-file-lines.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: the config is one box of labelled steps
 *     (Fields, the delivery mode two choice Actions), the how-it-works and advanced blocks Folds, the
 *     status a timeline of three ListRows whose marker is the step's state, the run log a timeline of
 *     rows, an advisory a box; no own classes. The triangle glyphs are gone.
 *   2026-09-13 -- V2v: compose section top rules from poster.css.
 *   v1.1.1 — 2026-09-13 — The reject-advisory dialog's actions sit in its footer.
 *   v1.1.0 — 2026-07-16 — Card mount folds schedules + recipe + organisms + advisories into GET
 *     /v1/ecosystem-apps/:app/automation (getAutomationOverview); agent list stays separate; fallback kept.
 *   v1.0.0 — 2026-07-13 — Extracted from ecosystem-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { Fold, Stack, ListRow, Steps, Surface, Chip, Text, Action, Field, Dialog } from '/components/poster-parts.js';
import { JsonValue } from '/components/JsonView.js';
import { Spinner } from './shared.js';
import { getAutomationRecipe, getAutomationOverview, putAutomationRecipe, listPendingAdvisories, approveAdvisory, rejectAdvisory } from '/js/services/ecosystem.js';
import { formatUntil } from './schedule-item.js';
import { listAppSchedules, createCapabilitySchedule, setScheduleEnabled, triggerSchedule, getScheduleDetail, setScheduleCron } from '/js/services/schedules.js';
import { listAgents } from '/js/services/agents.js';
import { listOrganisms, currentGhii } from '/js/services/organisms.js';
import { CADENCES, CRON_TO_CADENCE, defaultTriggerGlob, primarySchedulable, allowedCadencesFor, recommendationFor } from './ecosystem-tab.helpers.js';
import { swallowed } from '/js/swallowed.js';

/** A run result as a timeline marker tone. */
const resultTone = (r) => (r === 'success' ? 'success' : r === 'error' ? 'danger' : r === 'skipped' ? 'sun' : 'muted');
/** A status-step state as a tone: ok (done), error, and waiting or paused (quiet). */
const stateTone = (s) => (s === 'ok' ? 'success' : s === 'error' ? 'danger' : 'muted');

/** A spinner with the words it waits for. */
const loadingLine = (words) => html`<${Stack} direction="horizontal" density="compact" align="center"><${Spinner} /><${Text} tone="muted">${words}<//><//>`;

/**
 * The per-schedule run-history log: lazy-fetches GET /v1/schedules/:id on first
 * expand (and after a Run-now via the `refreshKey` bump) and renders the recent
 * runs as a compact list — relative time + a result chip (success/error/skipped)
 * + error/skip reason + duration + trigger source. SKIPPED runs (offline attempts
 * that don't advance lastRun) show here with their reason — the whole point.
 */
function EcoScheduleLog({ jobId, refreshKey }) {
  const [runs, setRuns] = useState(undefined); // undefined = loading

  useEffect(() => {
    let alive = true;
    setRuns(undefined);
    getScheduleDetail(jobId)
      .then(d => { if (alive) setRuns(Array.isArray(d.runs) ? d.runs : []); })
      .catch((err) => { swallowed('ecosystem-tab.automation', err); if (alive) setRuns([]); });
    return () => { alive = false; };
  }, [jobId, refreshKey]);

  if (runs === undefined) return loadingLine(t('profile.ecosystem.automationLogLoading'));
  if (runs.length === 0) return html`<${Text} tone="muted">${t('profile.ecosystem.automationLogEmpty')}<//>`;
  return html`
    <${Stack} density="compact">
      ${runs.map(r => html`
        <${ListRow} key=${r.id || r.createdAt} kind="chronology" density="compact"
          time=${r.createdAt ? timeAgo(r.createdAt) : ''} marker=${resultTone(r.result)}
          name=${t(`profile.ecosystem.automationRunResult_${r.result}`)} detailKind="text"
          detail=${[r.trigger, typeof r.durationMs === 'number' ? t('profile.ecosystem.automationDuration', { ms: r.durationMs }) : '', r.errorMessage].filter(Boolean).join(' · ') || undefined} />`)}
    <//>`;
}

/**
 * The status-timeline chip for one chain step. `state` is one of:
 * 'ok' (green), 'wait' (neutral/dimmed), 'off' (paused/dimmed), 'error' (danger).
 */
function EcoStatusChip({ state, label }) {
  return html`<${Chip} tone=${stateTone(state)}>${label}<//>`;
}

/**
 * The "③ Process with agent(s)" picker — recommendation-aware so the owner sees WHICH of their agents
 * fit THIS app and WHY, instead of a flat list of dozens.
 *
 * The app DECLARES the agent(s) it works best with in its manifest (`automation.recommended_agents`:
 * an exact `name` and/or capability `match_tags` + a bilingual `why`). For each of the owner's agents
 * (the list the picker already has) we compute whether it's recommended — by NAME or by a tag/capability
 * overlap (we match against the agent's `tags`, `capabilities`, `technical_capabilities`,
 * `domain_capabilities` from GET /v1/agents). Recommended agents render FIRST, each with a "★ Suositeltu"
 * chip + the app's `why` line, on a subtly highlighted row. The rest sit behind a collapsed
 * "Näytä kaikki agentit" disclosure so the long list never overwhelms.
 *
 * If the app declares recommendations but the owner has NO matching agent, we surface a hint naming the
 * recommended agent + its `why`, pointing the owner at the setup guide above (where the agent is built).
 */
function EcoAgentPicker({ app, agents, selAgents, onToggle }) {
  const [showAll, setShowAll] = useState(false);
  const locale = getLocale();
  const recommendedAgents = app?.automation?.recommended_agents;
  const declaresRecommendations = Array.isArray(recommendedAgents) && recommendedAgents.length > 0;

  if (agents.length === 0) {
    return html`<${Text} tone="muted">${t('profile.ecosystem.recipeAgentsEmpty')}<//>`;
  }

  // Partition the owner's agents into recommended (with why) and the rest.
  const recommended = [];
  const rest = [];
  for (const a of agents) {
    const rec = recommendationFor(a, recommendedAgents, locale);
    if (rec.recommended) recommended.push({ agent: a, why: rec.why });
    else rest.push(a);
  }

  const agentBox = (a) => html`<${Field} key=${a.name} type="checkbox" label=${a.name} value=${selAgents.includes(a.name)} onChange=${() => onToggle(a.name)} />`;

  return html`
    <${Stack} density="compact">
      ${recommended.length > 0 && html`<${Stack} density="compact">
        ${recommended.map(({ agent, why }) => html`<${Surface} key=${agent.name} kind="box" density="compact" tone="sun"><${Stack} density="compact">
          ${agentBox(agent)}
          <${Stack} direction="wrap" density="compact" align="center">
            <${Chip} tone="sun">${t('profile.ecosystem.recommendedChip')}<//>
            ${why && html`<${Text} kind="caption">${why}<//>`}
          <//>
        <//><//>`)}
      <//>`}

      ${declaresRecommendations && recommended.length === 0 && html`<${Stack} density="compact">
        ${recommendedAgents.filter(d => d?.name || d?.why).map((d, i) => html`
          <${Text} key=${d.name || i} kind="caption" tone="muted">
            ${t('profile.ecosystem.recommendedMissing', {
              name: d.name || '—',
              why: (d.why && (d.why[locale] || d.why.en || d.why.fi)) || '',
            })}
          <//>`)}
      <//>`}

      ${rest.length > 0 && (recommended.length > 0 || declaresRecommendations
        ? html`<${Stack} density="compact">
            <${Stack} direction="horizontal" align="start">
              <${Action} kind="text" expanded=${showAll} onClick=${() => setShowAll(o => !o)}>
                ${showAll ? t('profile.ecosystem.hideAllAgents') : t('profile.ecosystem.showAllAgents', { n: rest.length })}
              <//>
            <//>
            ${showAll && html`<${Stack} density="compact">${rest.map(agentBox)}<//>`}
          <//>`
        : html`<${Stack} density="compact">${rest.map(agentBox)}<//>`)}
    <//>`;
}

/** One numbered step of the config card: its label and its controls. */
const configStep = (label, body) => html`<${Stack} density="compact"><${Text} kind="label">${label}<//>${body}<//>`;

/**
 * The unified "Automation" section of one expanded GEAI card — ONE turnkey flow.
 *
 * The mental model it makes visible: the app and the agents NEVER talk directly. AIMEAT is the
 * broker. The chain reads top-to-bottom:
 *   app publishes data → AIMEAT recipe triggers the agent → agent writes results back →
 *   AIMEAT delivers approved guidance to the app.
 *
 * The operator configures ONE coherent card (what the app produces · run on a schedule · process
 * with agents · store in organism · deliver guidance · advanced trigger key) and hits a single
 * "Save automation" button. That one Save performs BOTH backend writes:
 *   (a) the publish eco-capability SCHEDULE — created / cadence-patched / deleted to match the
 *       "Run on a schedule" toggle + cadence; and
 *   (b) the automation RECIPE — PUT with the selected agents, organism, email, delivery mode and
 *       trigger keyGlob.
 * The user sees one object; two server objects back it.
 *
 * Below the config, a single vertical 3-step STATUS timeline (publish → process → deliver)
 * aggregates everything observable frontend-only so the operator never hops views:
 *   • Published — the publish schedule's last/next run + result, with an honest "Run now".
 *   • Processed — the configured agents (runs when data is published; we do NOT fabricate a task
 *     status we cannot fetch).
 *   • Delivered — the pending advisories with inline Approve / Reject.
 *
 * Lazy-loads everything on first expand and refreshes on aimeat-live-update.
 */
export function EcoAutomationSection({ app, showToast }) {
  const revoked = app.status === 'revoked';
  const primary = primarySchedulable(app);
  const allowedCadences = allowedCadencesFor(primary);

  // ── loaded reference data ──
  const [loaded, setLoaded] = useState(false);
  const [schedules, setSchedules] = useState([]);   // this app's eco-capability schedules
  const [agents, setAgents] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [advisories, setAdvisories] = useState(undefined); // undefined = never loaded

  // ── editable config (the ONE screen) ──
  const [scheduleOn, setScheduleOn] = useState(false);
  const [cadence, setCadence] = useState((allowedCadences[0] && allowedCadences[0].key) || 'weekly');
  const [selAgents, setSelAgents] = useState([]);
  const [organism, setOrganism] = useState('');
  const [email, setEmail] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false); // default = push
  const [triggerGlob, setTriggerGlob] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── status-timeline interaction state ──
  const [running, setRunning] = useState(false);        // Run-now in flight
  const [lastAttempt, setLastAttempt] = useState(null); // { outcome, reason } from Run-now
  const [openLog, setOpenLog] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);
  const [advBusy, setAdvBusy] = useState({});           // advisory id → bool
  const [confirmId, setConfirmId] = useState(null);     // advisory id pending reject confirm

  // The publish schedule for the primary capability (the one the schedule toggle drives).
  const primaryJob = primary
    ? schedules.find(j => j.input?.capability_id === primary.id)
    : schedules[0];

  const load = async () => {
    const ownerName = (currentGhii().split('@')[0]) || '';
    // Mount fold: ONE composite (schedules + recipe + organisms + advisories) + the agent list (kept
    // separate — its domain_capabilities shape drives recipe-agent selection). On composite failure, fall
    // back to the individual reads.
    const [ov, agentList] = await Promise.all([
      getAutomationOverview(app.app),
      listAgents().catch(err => { swallowed('ecosystem-tab.automation: ownerName', err); return []; }),
    ]);
    let schedList, recipe, orgs, advList;
    if (ov) {
      schedList = ov.schedules; recipe = ov.recipe; orgs = ov.organisms; advList = ov.advisories;
    } else {
      const [s, r, orgResp, a] = await Promise.all([
        listAppSchedules(app.app).catch(err => { swallowed('ecosystem-tab.automation: ownerName', err); return []; }),
        getAutomationRecipe(app.app).catch(err => { swallowed('ecosystem-tab.automation: ownerName', err); return null; }),
        (ownerName ? listOrganisms({ member: ownerName }) : Promise.resolve(null)).catch(err => { swallowed('ecosystem-tab.automation: ownerName', err); return null; }),
        listPendingAdvisories(app.app).catch(err => { swallowed('ecosystem-tab.automation: ownerName', err); return null; }),
      ]);
      schedList = s; recipe = r; orgs = orgResp?.data?.organisms || []; advList = a;
    }
    setSchedules(schedList);
    setAgents(agentList.filter(a => !a.name?.startsWith('session-')));
    setOrgs(orgs);
    setAdvisories(advList === null ? [] : advList);

    // Reflect the publish schedule into the "Run on a schedule" controls.
    const job = primary
      ? schedList.find(j => j.input?.capability_id === primary.id)
      : schedList[0];
    if (job) {
      setScheduleOn(!!job.enabled);
      setCadence(CRON_TO_CADENCE[job.cron] || ((allowedCadences[0] && allowedCadences[0].key) || 'weekly'));
    } else {
      setScheduleOn(false);
    }

    // Reflect the recipe into the processing/delivery controls.
    if (recipe) {
      setSelAgents(Array.isArray(recipe.agents) ? recipe.agents : []);
      setOrganism(recipe.organism || '');
      setEmail(!!recipe.email);
      setRequireApproval(!!recipe.require_approval);
      setTriggerGlob(recipe.trigger?.keyGlob || defaultTriggerGlob(app));
    } else {
      setTriggerGlob(defaultTriggerGlob(app));
    }
    setLoaded(true);
  };

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    loadRef.current();
    return onLiveUpdate(['ecosystem-apps', 'apps'], () => loadRef.current());
  }, [app.app]);

  function toggleAgent(name) {
    setSelAgents(list => list.includes(name) ? list.filter(n => n !== name) : [...list, name]);
  }

  // The ONE Save: reconcile the publish schedule (a) AND PUT the recipe (b).
  async function onSave() {
    setSaving(true);
    try {
      // (a) Reconcile the publish eco-capability schedule against the schedule controls.
      if (primary) {
        const cron = (CADENCES.find(c => c.key === cadence) || CADENCES[0]).cron;
        const existing = primary
          ? schedules.find(j => j.input?.capability_id === primary.id)
          : null;
        if (scheduleOn) {
          if (!existing) {
            await createCapabilitySchedule(app.app, primary.id, cron, {
              displayName: `${app.display_name || app.app} · ${primary.id}`,
            });
          } else {
            if (existing.cron !== cron) await setScheduleCron(existing.id, cron);
            if (!existing.enabled) await setScheduleEnabled(existing.id, true);
          }
        } else if (existing) {
          // Turning the schedule off: pause it (keep history) rather than delete.
          if (existing.enabled) await setScheduleEnabled(existing.id, false);
        }
      }

      // (b) PUT the recipe (processing + delivery + trigger).
      await putAutomationRecipe(app.app, {
        agents: selAgents,
        organism: organism || null,
        email,
        require_approval: requireApproval,
        enabled: true,
        trigger: { keyGlob: triggerGlob.trim() },
      });

      showToast?.(t('profile.ecosystem.autoSaved'), 'success');
      await load();
    } catch (err) {
      swallowed('ecosystem-tab.automation: cron', err);
      showToast?.(t('profile.ecosystem.autoSaveError'), 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── status: Published — Run now ──
  async function onRunNow() {
    if (!primaryJob) return;
    setRunning(true);
    try {
      const res = await triggerSchedule(primaryJob.id);
      const outcome = res.outcome || 'success';
      const reason = res.reason || '';
      setLastAttempt({ outcome, reason });
      if (outcome === 'busy') {
        const offline = /offline|unavailable/i.test(reason);
        showToast?.(offline
          ? t('profile.ecosystem.automationRunSkippedOffline')
          : t('profile.ecosystem.automationRunSkipped', { reason }), false);
      } else if (outcome === 'error') {
        showToast?.(t('profile.ecosystem.automationRunFailed', { reason }), true);
      } else {
        showToast?.(t('profile.ecosystem.automationRunOk'), false);
      }
      setLogRefresh(n => n + 1);
      await load();
    } catch (e) {
      showToast?.(t('profile.ecosystem.automationRunFailed', { reason: e?.message || '' }), true);
    } finally {
      setRunning(false);
    }
  }

  // ── status: Delivered — approve / reject ──
  async function onApproveAdv(id) {
    setAdvBusy(b => ({ ...b, [id]: true }));
    try {
      const res = await approveAdvisory(app.app, id);
      const appName = app.display_name || app.app;
      if (res.delivery === 'delivered') {
        showToast?.(t('profile.ecosystem.advDelivered', { app: appName }), 'success');
        setAdvisories(list => (list || []).filter(p => p.id !== id));
      } else if (res.delivery === 'offline-retry') {
        showToast?.(t('profile.ecosystem.advOfflineRetry', { app: appName }), 'info');
      } else {
        showToast?.(t('profile.ecosystem.advFailed'), 'warning');
      }
    } catch (err) {
      swallowed('ecosystem-tab.automation: onApproveAdv', err);
      showToast?.(t('profile.ecosystem.advError'), 'error');
    } finally {
      setAdvBusy(b => ({ ...b, [id]: false }));
    }
  }

  async function onRejectAdv(id) {
    setConfirmId(null);
    setAdvBusy(b => ({ ...b, [id]: true }));
    try {
      await rejectAdvisory(app.app, id);
      showToast?.(t('profile.ecosystem.advRejected'), 'success');
      setAdvisories(list => (list || []).filter(p => p.id !== id));
    } catch (err) {
      swallowed('ecosystem-tab.automation: onRejectAdv', err);
      showToast?.(t('profile.ecosystem.advError'), 'error');
    } finally {
      setAdvBusy(b => ({ ...b, [id]: false }));
    }
  }

  const heading = html`<${Text} kind="label">${t('profile.ecosystem.automationTitle')}<//>`;

  if (revoked) {
    return html`<${Stack} density="compact">
      ${heading}
      <${Text} tone="muted">${t('profile.ecosystem.autoRevoked')}<//>
      <${Text} kind="caption" tone="muted">${t('profile.ecosystem.revokeReconnectHint')}<//>
    <//>`;
  }

  if (!loaded) {
    return html`<${Stack} density="compact">${heading}${loadingLine(t('profile.ecosystem.automationLoading'))}<//>`;
  }

  // Derived display strings.
  const producesKey = primary?.produces_key || primary?.produces || '';
  const pendingCount = (advisories || []).length;

  // Status-step states.
  const publishState = !primaryJob ? 'wait'
    : (primaryJob.lastRunResult === 'error' ? 'error'
      : (primaryJob.enabled ? (primaryJob.lastRunAt ? 'ok' : 'wait') : 'off'));
  const processState = selAgents.length === 0 ? 'wait' : 'ok';
  const deliverState = pendingCount > 0 ? 'wait' : 'ok';

  return html`
    <${Stack}>
      ${heading}
      <${Text} tone="muted">${t('profile.ecosystem.autoIntro')}<//>

      <${Fold} title=${t('profile.ecosystem.autoHowTitle')} open=${showHow} onToggle=${() => setShowHow(o => !o)}>
        <${Stack} density="compact">
          <${Text} tone="muted">${t('profile.ecosystem.autoHowLead')}<//>
          <${Steps} items=${[t('profile.ecosystem.autoHowStep1'), t('profile.ecosystem.autoHowStep2'), t('profile.ecosystem.autoHowStep3'), t('profile.ecosystem.autoHowStep4')]} />
          <${Text} kind="caption" tone="muted">${t('profile.ecosystem.autoHowDoc')}<//>
        <//>
      <//>

      <!-- ── the ONE config card, read top-to-bottom ── -->
      <${Surface} kind="box"><${Stack}>
        ${configStep(t('profile.ecosystem.autoStep1'), primary
          ? html`<${Stack} density="compact">
              <${Text} kind="mono">${primary.id}<//>
              ${primary.produces && html`<${Text} kind="caption" tone="muted">${t('profile.ecosystem.autoProduces')}: <${Text} kind="mono">${primary.produces}<//><//>`}
              ${producesKey && html`<${Text} kind="caption" tone="muted">${t('profile.ecosystem.autoDepositKey')}: <${Text} kind="mono">${defaultTriggerGlob(app)}<//><//>`}
            <//>`
          : html`<${Text} tone="muted">${t('profile.ecosystem.automationNoCaps')}<//>`)}

        ${configStep(t('profile.ecosystem.autoStep2'), html`<${Stack} direction="wrap" density="compact" align="center">
          <${Field} type="select" width="narrow" ariaLabel=${t('profile.ecosystem.autoStep2')} value=${cadence} disabled=${!primary}
            onChange=${e => setCadence(e.target.value)}
            options=${allowedCadences.map(c => ({ value: c.key, label: t(`profile.ecosystem.automationCadence_${c.key}`) }))} />
          <${Field} type="checkbox" label=${t('profile.ecosystem.autoScheduleOn')} value=${scheduleOn} disabled=${!primary} onChange=${e => setScheduleOn(e.target.checked)} />
        <//>`)}

        ${configStep(t('profile.ecosystem.autoStep3'), html`<${EcoAgentPicker} app=${app} agents=${agents} selAgents=${selAgents} onToggle=${toggleAgent} />`)}

        ${configStep(t('profile.ecosystem.autoStep4'), html`<${Field} type="select" ariaLabel=${t('profile.ecosystem.autoStep4')} value=${organism} onChange=${e => setOrganism(e.target.value)}
          options=${[{ value: '', label: t('profile.ecosystem.recipeOrganismNone') }, ...orgs.map(o => ({ value: o.id, label: o.name || o.id }))]} />`)}

        ${configStep(t('profile.ecosystem.autoStep5'), html`
          <${Stack} direction="wrap" density="compact" role="radiogroup" label=${t('profile.ecosystem.autoStep5')}>
            <${Action} kind="choice" semantics="radio" selected=${requireApproval} onClick=${() => setRequireApproval(true)}
              title=${t('profile.ecosystem.recipeDeliveryApprove')}>${t('profile.ecosystem.recipeDeliveryApproveHint')}<//>
            <${Action} kind="choice" semantics="radio" selected=${!requireApproval} onClick=${() => setRequireApproval(false)}
              title=${t('profile.ecosystem.recipeDeliveryPush')}>${t('profile.ecosystem.recipeDeliveryPushHint')}<//>
          <//>
          <${Field} type="checkbox" label=${t('profile.ecosystem.recipeEmail')} value=${email} onChange=${e => setEmail(e.target.checked)} />`)}

        <${Fold} title=${t('profile.ecosystem.autoAdvanced')} open=${showAdvanced} onToggle=${() => setShowAdvanced(o => !o)}>
          <${Stack} density="compact">
            <${Field} label=${t('profile.ecosystem.recipeTriggerLabel')} value=${triggerGlob} placeholder=${defaultTriggerGlob(app)}
              onInput=${e => setTriggerGlob(e.target.value)} />
            <${Text} kind="caption" tone="muted">${t('profile.ecosystem.recipeTriggerHelp')}<//>
          <//>
        <//>

        <${Stack} direction="horizontal" align="start">
          <${Action} kind="primary" disabled=${saving} onClick=${onSave}>${t('profile.ecosystem.autoSave')}<//>
        <//>
      <//><//>

      <!-- ── Status — latest run (publish → process → deliver) ── -->
      <${Stack} density="compact">
        <${Text} kind="label">${t('profile.ecosystem.autoStatusTitle')}<//>

        <${ListRow} kind="chronology" marker=${stateTone(publishState)} name=${t('profile.ecosystem.autoStatusPublished')}
          value=${html`<${EcoStatusChip} state=${publishState} label=${primaryJob
            ? (primaryJob.enabled ? t('profile.ecosystem.automationOn') : t('profile.ecosystem.automationPaused'))
            : t('profile.ecosystem.autoStatusNotScheduled')} />`}>
          ${primaryJob
            ? html`<${Stack} density="compact">
                <${Text} kind="caption" tone="muted">
                  ${t('profile.ecosystem.automationLastRun')}: ${primaryJob.lastRunAt
                    ? html`${timeAgo(primaryJob.lastRunAt)}${primaryJob.lastRunResult ? html` · <${Text} kind="label" tone=${resultTone(primaryJob.lastRunResult) === 'danger' ? 'danger' : resultTone(primaryJob.lastRunResult) === 'success' ? 'success' : 'plain'}>${primaryJob.lastRunResult}<//>` : ''}`
                    : '—'}
                <//>
                <${Text} kind="caption" tone="muted">${t('profile.ecosystem.automationNextRun')}: ${primaryJob.enabled ? formatUntil(primaryJob.nextRunAt) : '—'}<//>
                ${lastAttempt && lastAttempt.outcome === 'busy' && html`<${Text} kind="caption" tone="coral">
                  ${/offline|unavailable/i.test(lastAttempt.reason)
                    ? t('profile.ecosystem.automationRunSkippedOffline')
                    : t('profile.ecosystem.automationRunSkipped', { reason: lastAttempt.reason })}
                <//>`}
                <${Stack} direction="wrap" density="compact">
                  <${Action} kind="text" disabled=${running} onClick=${onRunNow}>${t('profile.ecosystem.automationRunNow')}<//>
                  <${Action} kind="text" expanded=${openLog} onClick=${() => setOpenLog(o => !o)}>
                    ${openLog ? t('profile.ecosystem.automationHideLog') : t('profile.ecosystem.automationShowLog')}
                  <//>
                <//>
                ${openLog && html`<${EcoScheduleLog} jobId=${primaryJob.id} refreshKey=${logRefresh} />`}
              <//>`
            : html`<${Text} kind="caption" tone="muted">${t('profile.ecosystem.autoStatusPublishedHint')}<//>`}
        <//>

        <${ListRow} kind="chronology" marker=${stateTone(processState)} name=${t('profile.ecosystem.autoStatusProcessed')}>
          ${selAgents.length === 0
            ? html`<${Text} kind="caption" tone="muted">${t('profile.ecosystem.autoStatusNoAgents')}<//>`
            : html`<${Stack} density="compact">
                <${Stack} direction="wrap" density="compact">${selAgents.map(name => html`<${Chip} key=${name}>${name}<//>`)}<//>
                <${Text} kind="caption" tone="muted">${t('profile.ecosystem.autoStatusProcessedHint')}<//>
              <//>`}
        <//>

        <${ListRow} kind="chronology" marker=${stateTone(deliverState)} name=${t('profile.ecosystem.autoStatusDelivered')}
          value=${pendingCount > 0 ? html`<${Chip} tone="sun">${pendingCount}<//>` : null}>
          <${Stack} density="compact">
            <${Text} kind="caption" tone="muted">${t('profile.ecosystem.autoStatusDeliveredHint')}<//>
            ${advisories === undefined
              ? loadingLine(t('profile.ecosystem.advLoading'))
              : advisories.length === 0
                ? html`<${Text} tone="muted">${t('profile.ecosystem.advPendingEmpty')}<//>`
                : advisories.map(p => {
                  const a = p.advisory || {};
                  return html`<${Surface} key=${p.id} kind="box" density="compact"><${Stack} density="compact">
                    <${Stack} direction="wrap" density="compact" align="center">
                      <${Text}><strong>${a.title || p.id}</strong><//>
                      ${a.kind && html`<${Chip}>${t('profile.ecosystem.advKind')}: ${a.kind}<//>`}
                      ${a.severity && html`<${Chip} tone=${a.severity === 'high' || a.severity === 'critical' ? 'danger' : a.severity === 'medium' ? 'coral' : 'plain'}>${t('profile.ecosystem.advSeverity')}: ${a.severity}<//>`}
                      ${a.status && html`<${Chip} tone="muted">${a.status}<//>`}
                    <//>
                    ${(a.effective_from || a.effective_until) && html`<${Text} kind="caption" tone="muted">
                      ${t('profile.ecosystem.advEffective')}: ${a.effective_from || '…'} → ${a.effective_until || '…'}
                    <//>`}
                    <${JsonValue} value=${a.body !== undefined ? a.body : a} />
                    ${a.source && html`<${Text} kind="caption" tone="muted">${t('profile.ecosystem.advSource')}: ${a.source}<//>`}
                    ${a.rationale && html`<${Stack} density="compact">
                      <${Text} kind="caption" tone="muted">${t('profile.ecosystem.advRationale')}:<//>
                      <${JsonValue} value=${a.rationale} />
                    <//>`}
                    <${Stack} direction="wrap" density="compact">
                      <${Action} tone="success" disabled=${!!advBusy[p.id]} onClick=${() => onApproveAdv(p.id)}>${t('profile.ecosystem.advApprove')}<//>
                      <${Action} kind="text" tone="danger" disabled=${!!advBusy[p.id]} onClick=${() => setConfirmId(p.id)}>${t('profile.ecosystem.advReject')}<//>
                    <//>
                  <//><//>`;
                })}
          <//>
        <//>
      <//>

      <${Dialog} open=${!!confirmId} onClose=${() => setConfirmId(null)} title=${t('profile.ecosystem.advReject')} size="small"
        actions=${html`
          <${Action} onClick=${() => setConfirmId(null)}>${t('common.cancel')}<//>
          <${Action} kind="primary" tone="danger" onClick=${() => onRejectAdv(confirmId)}>${t('profile.ecosystem.advReject')}<//>`}>
        <${Text}>${t('profile.ecosystem.advRejectConfirm')}<//>
      <//>
    <//>`;
}
