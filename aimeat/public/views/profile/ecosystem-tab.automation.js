/**
 * @file public/views/profile/ecosystem-tab.automation.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The GEAI card "Automation" flow and its pieces — <EcoScheduleLog> (per-schedule
 *   run-history), <EcoStatusChip> (status-timeline chip), <EcoAgentPicker> (recommendation-aware
 *   agent picker), and <EcoAutomationSection> (the unified turnkey publish→process→deliver flow).
 *   Extracted from ecosystem-tab.js to satisfy max-file-lines.
 * @version-history
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
import { Modal } from '/components/Modal.js';
import { JsonValue } from '/components/JsonView.js';
import { Spinner } from './shared.js';
import { getAutomationRecipe, getAutomationOverview, putAutomationRecipe, listPendingAdvisories, approveAdvisory, rejectAdvisory } from '/js/services/ecosystem.js';
import { formatUntil } from './schedule-item.js';
import { listAppSchedules, createCapabilitySchedule, setScheduleEnabled, triggerSchedule, getScheduleDetail, setScheduleCron } from '/js/services/schedules.js';
import { listAgents } from '/js/services/agents.js';
import { listOrganisms, currentGhii } from '/js/services/organisms.js';
import { CADENCES, CRON_TO_CADENCE, defaultTriggerGlob, primarySchedulable, allowedCadencesFor, recommendationFor } from './ecosystem-tab.helpers.js';
import { swallowed } from '/js/swallowed.js';

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

  if (runs === undefined) {
    return html`<div class="pf-eco-dim pf-eco-auto-log-loading"><${Spinner} /> ${t('profile.ecosystem.automationLogLoading')}</div>`;
  }
  if (runs.length === 0) {
    return html`<div class="pf-eco-dim pf-eco-auto-log-empty">${t('profile.ecosystem.automationLogEmpty')}</div>`;
  }
  return html`
    <div class="pf-eco-auto-log">
      ${runs.map(r => html`
        <div class="pf-eco-auto-log-row" key=${r.id || r.createdAt}>
          <span class="pf-eco-dim pf-eco-auto-log-time">${r.createdAt ? timeAgo(r.createdAt) : ''}</span>
          <span class="pf-eco-chip pf-eco-auto-result-${r.result}">${t(`profile.ecosystem.automationRunResult_${r.result}`)}</span>
          ${r.trigger && html`<span class="pf-eco-dim pf-eco-auto-log-trigger">${r.trigger}</span>`}
          ${typeof r.durationMs === 'number' && html`<span class="pf-eco-dim pf-eco-auto-log-dur">${t('profile.ecosystem.automationDuration', { ms: r.durationMs })}</span>`}
          ${r.errorMessage && html`<span class="pf-eco-dim pf-eco-auto-log-reason">${r.errorMessage}</span>`}
        </div>`)}
    </div>`;
}

/**
 * The status-timeline chip for one chain step. `state` is one of:
 * 'ok' (green), 'wait' (neutral/dimmed), 'off' (paused/dimmed), 'error' (danger).
 */
function EcoStatusChip({ state, label }) {
  return html`<span class="pf-eco-chip pf-eco-auto-status-chip pf-eco-auto-status-${state}">${label}</span>`;
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
    return html`<div class="pf-eco-dim">${t('profile.ecosystem.recipeAgentsEmpty')}</div>`;
  }

  // Partition the owner's agents into recommended (with why) and the rest.
  const recommended = [];
  const rest = [];
  for (const a of agents) {
    const rec = recommendationFor(a, recommendedAgents, locale);
    if (rec.recommended) recommended.push({ agent: a, why: rec.why });
    else rest.push(a);
  }

  const agentLabel = (a) => html`
    <label class="pf-eco-recipe-agent" key=${a.name}>
      <input type="checkbox" checked=${selAgents.includes(a.name)} onChange=${() => onToggle(a.name)} />
      <span>${a.name}</span>
    </label>`;

  return html`
    <div class="pf-eco-rec-picker">
      ${recommended.length > 0 && html`
        <div class="pf-eco-rec-list">
          ${recommended.map(({ agent, why }) => html`
            <label class="pf-eco-rec-agent" key=${agent.name}>
              <input type="checkbox" checked=${selAgents.includes(agent.name)} onChange=${() => onToggle(agent.name)} />
              <span class="pf-eco-rec-agent-body">
                <span class="pf-eco-rec-agent-head">
                  <span class="pf-eco-rec-agent-name">${agent.name}</span>
                  <span class="pf-eco-chip pf-eco-rec-chip">${t('profile.ecosystem.recommendedChip')}</span>
                </span>
                ${why && html`<span class="pf-eco-dim pf-eco-rec-why">${why}</span>`}
              </span>
            </label>`)}
        </div>`}

      ${declaresRecommendations && recommended.length === 0 && html`
        <div class="pf-eco-rec-missing">
          ${recommendedAgents.filter(d => d?.name || d?.why).map((d, i) => html`
            <p class="pf-eco-dim pf-eco-rec-missing-line" key=${d.name || i}>
              ${t('profile.ecosystem.recommendedMissing', {
                name: d.name || '—',
                why: (d.why && (d.why[locale] || d.why.en || d.why.fi)) || '',
              })}
            </p>`)}
        </div>`}

      ${rest.length > 0 && (recommended.length > 0 || declaresRecommendations
        ? html`
          <div class="pf-eco-rec-rest">
            <button class="pf-eco-auto-how-toggle" aria-expanded=${showAll} onClick=${() => setShowAll(o => !o)}>
              <span class="pf-eco-caret">${showAll ? '▼' : '▶'}</span>
              ${showAll ? t('profile.ecosystem.hideAllAgents') : t('profile.ecosystem.showAllAgents', { n: rest.length })}
            </button>
            ${showAll && html`<div class="pf-eco-recipe-agents pf-eco-rec-rest-list">${rest.map(agentLabel)}</div>`}
          </div>`
        : html`<div class="pf-eco-recipe-agents">${rest.map(agentLabel)}</div>`)}
    </div>`;
}

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

  if (revoked) {
    return html`
      <div class="pf-eco-section">
        <div class="pf-eco-section-title">${t('profile.ecosystem.automationTitle')}</div>
        <div class="pf-eco-dim">${t('profile.ecosystem.autoRevoked')}</div>
        <p class="pf-eco-dim pf-eco-reconnect-hint">${t('profile.ecosystem.revokeReconnectHint')}</p>
      </div>`;
  }

  if (!loaded) {
    return html`
      <div class="pf-eco-section">
        <div class="pf-eco-section-title">${t('profile.ecosystem.automationTitle')}</div>
        <div class="pf-eco-dim pf-eco-data-loading"><${Spinner} /> ${t('profile.ecosystem.automationLoading')}</div>
      </div>`;
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
    <div class="pf-eco-section pf-eco-auto-flow" data-eco-auto=${app.app}>
      <div class="pf-eco-section-title">${t('profile.ecosystem.automationTitle')}</div>
      <p class="pf-eco-dim pf-eco-auto-flow-intro">${t('profile.ecosystem.autoIntro')}</p>

      <button class="pf-eco-auto-how-toggle" aria-expanded=${showHow} onClick=${() => setShowHow(o => !o)}>
        <span class="pf-eco-caret">${showHow ? '▼' : '▶'}</span>
        ${t('profile.ecosystem.autoHowTitle')}
      </button>
      ${showHow && html`
        <div class="pf-eco-auto-how">
          <p class="pf-eco-dim pf-eco-auto-how-lead">${t('profile.ecosystem.autoHowLead')}</p>
          <ol class="pf-eco-auto-how-steps">
            <li>${t('profile.ecosystem.autoHowStep1')}</li>
            <li>${t('profile.ecosystem.autoHowStep2')}</li>
            <li>${t('profile.ecosystem.autoHowStep3')}</li>
            <li>${t('profile.ecosystem.autoHowStep4')}</li>
          </ol>
          <p class="pf-eco-dim pf-eco-auto-how-doc">${t('profile.ecosystem.autoHowDoc')}</p>
        </div>`}

      <!-- ── the ONE config card, read top-to-bottom ── -->
      <div class="pf-eco-auto-flow-card">
        <!-- ① What this app produces -->
        <div class="pf-eco-auto-flow-step">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep1')}</div>
          ${primary
            ? html`
              <div class="pf-eco-auto-produces">
                <span class="pf-eco-mono pf-eco-auto-produces-cap">${primary.id}</span>
                ${primary.produces && html`<span class="pf-eco-dim">${t('profile.ecosystem.autoProduces')}: <span class="pf-eco-mono">${primary.produces}</span></span>`}
                ${producesKey && html`<span class="pf-eco-dim">${t('profile.ecosystem.autoDepositKey')}: <span class="pf-eco-mono">${defaultTriggerGlob(app)}</span></span>`}
              </div>`
            : html`<div class="pf-eco-dim">${t('profile.ecosystem.automationNoCaps')}</div>`}
        </div>

        <!-- ② Run on a schedule -->
        <div class="pf-eco-auto-flow-step ${primary ? '' : 'pf-eco-auto-flow-step-disabled'}">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep2')}</div>
          <div class="pf-eco-auto-flow-controls">
            <select class="pf-eco-select" value=${cadence} disabled=${!primary}
              onChange=${e => setCadence(e.target.value)}>
              ${allowedCadences.map(c => html`<option value=${c.key} key=${c.key}>${t(`profile.ecosystem.automationCadence_${c.key}`)}</option>`)}
            </select>
            <label class="pf-eco-recipe-toggle">
              <input type="checkbox" checked=${scheduleOn} disabled=${!primary} onChange=${e => setScheduleOn(e.target.checked)} />
              <span>${t('profile.ecosystem.autoScheduleOn')}</span>
            </label>
          </div>
        </div>

        <!-- ③ Process with agent(s) — recommended first, the rest behind a disclosure -->
        <div class="pf-eco-auto-flow-step">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep3')}</div>
          <${EcoAgentPicker} app=${app} agents=${agents} selAgents=${selAgents} onToggle=${toggleAgent} />
        </div>

        <!-- ④ Store results in organism -->
        <div class="pf-eco-auto-flow-step">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep4')}</div>
          <select class="pf-eco-select" value=${organism} onChange=${e => setOrganism(e.target.value)}>
            <option value="">${t('profile.ecosystem.recipeOrganismNone')}</option>
            ${orgs.map(o => html`<option value=${o.id} key=${o.id}>${o.name || o.id}</option>`)}
          </select>
        </div>

        <!-- ⑤ Deliver guidance -->
        <div class="pf-eco-auto-flow-step">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep5')}</div>
          <div class="pf-eco-recipe-radios">
            <label class="pf-eco-recipe-radio">
              <input type="radio" name=${`eco-delivery-${app.app}`} checked=${requireApproval} onChange=${() => setRequireApproval(true)} />
              <span>
                <span class="pf-eco-recipe-radio-title">${t('profile.ecosystem.recipeDeliveryApprove')}</span>
                <span class="pf-eco-dim pf-eco-recipe-radio-hint">${t('profile.ecosystem.recipeDeliveryApproveHint')}</span>
              </span>
            </label>
            <label class="pf-eco-recipe-radio">
              <input type="radio" name=${`eco-delivery-${app.app}`} checked=${!requireApproval} onChange=${() => setRequireApproval(false)} />
              <span>
                <span class="pf-eco-recipe-radio-title">${t('profile.ecosystem.recipeDeliveryPush')}</span>
                <span class="pf-eco-dim pf-eco-recipe-radio-hint">${t('profile.ecosystem.recipeDeliveryPushHint')}</span>
              </span>
            </label>
          </div>
          <label class="pf-eco-recipe-toggle pf-eco-auto-flow-email">
            <input type="checkbox" checked=${email} onChange=${e => setEmail(e.target.checked)} />
            <span>${t('profile.ecosystem.recipeEmail')}</span>
          </label>
        </div>

        <!-- Advanced: trigger key -->
        <div class="pf-eco-auto-flow-step pf-eco-auto-flow-advanced">
          <button class="pf-eco-auto-how-toggle" aria-expanded=${showAdvanced} onClick=${() => setShowAdvanced(o => !o)}>
            <span class="pf-eco-caret">${showAdvanced ? '▼' : '▶'}</span>
            ${t('profile.ecosystem.autoAdvanced')}
          </button>
          ${showAdvanced && html`
            <div class="pf-eco-auto-flow-advanced-body">
              <label class="pf-eco-recipe-label">${t('profile.ecosystem.recipeTriggerLabel')}</label>
              <input type="text" class="pf-eco-recipe-trigger-input pf-eco-mono"
                value=${triggerGlob} placeholder=${defaultTriggerGlob(app)}
                onInput=${e => setTriggerGlob(e.target.value)} />
              <p class="pf-eco-dim pf-eco-recipe-trigger-help">${t('profile.ecosystem.recipeTriggerHelp')}</p>
            </div>`}
        </div>

        <!-- ONE Save -->
        <div class="pf-eco-auto-flow-save">
          <button class="btn-primary btn-sm" disabled=${saving} onClick=${onSave}>${t('profile.ecosystem.autoSave')}</button>
        </div>
      </div>

      <!-- ── Status — latest run (publish → process → deliver) ── -->
      <div class="pf-eco-auto-status">
        <div class="pf-eco-recipe-head">${t('profile.ecosystem.autoStatusTitle')}</div>
        <div class="pf-eco-auto-status-timeline">

          <!-- publish -->
          <div class="pf-eco-auto-status-step">
            <div class="pf-eco-auto-status-head">
              <span class="pf-eco-auto-status-dot pf-eco-auto-status-dot-${publishState}"></span>
              <strong class="pf-eco-auto-status-label">${t('profile.ecosystem.autoStatusPublished')}</strong>
              <${EcoStatusChip} state=${publishState} label=${primaryJob
                ? (primaryJob.enabled ? t('profile.ecosystem.automationOn') : t('profile.ecosystem.automationPaused'))
                : t('profile.ecosystem.autoStatusNotScheduled')} />
            </div>
            <div class="pf-eco-auto-status-body">
              ${primaryJob
                ? html`
                  <div class="pf-eco-auto-job-meta">
                    <span class="pf-eco-dim">
                      ${t('profile.ecosystem.automationLastRun')}: ${primaryJob.lastRunAt
                        ? html`${timeAgo(primaryJob.lastRunAt)}${primaryJob.lastRunResult ? html` · <span class="pf-eco-auto-result-${primaryJob.lastRunResult}">${primaryJob.lastRunResult}</span>` : ''}`
                        : '—'}
                    </span>
                    <span class="pf-eco-dim">${t('profile.ecosystem.automationNextRun')}: ${primaryJob.enabled ? formatUntil(primaryJob.nextRunAt) : '—'}</span>
                  </div>
                  ${lastAttempt && lastAttempt.outcome === 'busy' && html`
                    <div class="pf-eco-dim pf-eco-auto-lastattempt">
                      ${/offline|unavailable/i.test(lastAttempt.reason)
                        ? t('profile.ecosystem.automationRunSkippedOffline')
                        : t('profile.ecosystem.automationRunSkipped', { reason: lastAttempt.reason })}
                    </div>`}
                  <div class="pf-eco-auto-job-actions">
                    <button class="btn-ghost btn-sm" disabled=${running} onClick=${onRunNow}>${t('profile.ecosystem.automationRunNow')}</button>
                    <button class="btn-ghost btn-sm" aria-expanded=${openLog} onClick=${() => setOpenLog(o => !o)}>
                      ${openLog ? t('profile.ecosystem.automationHideLog') : t('profile.ecosystem.automationShowLog')}
                    </button>
                  </div>
                  ${openLog && html`<${EcoScheduleLog} jobId=${primaryJob.id} refreshKey=${logRefresh} />`}`
                : html`<div class="pf-eco-dim">${t('profile.ecosystem.autoStatusPublishedHint')}</div>`}
            </div>
          </div>

          <!-- process -->
          <div class="pf-eco-auto-status-step">
            <div class="pf-eco-auto-status-head">
              <span class="pf-eco-auto-status-dot pf-eco-auto-status-dot-${processState}"></span>
              <strong class="pf-eco-auto-status-label">${t('profile.ecosystem.autoStatusProcessed')}</strong>
            </div>
            <div class="pf-eco-auto-status-body">
              ${selAgents.length === 0
                ? html`<div class="pf-eco-dim">${t('profile.ecosystem.autoStatusNoAgents')}</div>`
                : html`
                  <div class="pf-eco-auto-status-agents">
                    ${selAgents.map(name => html`<span class="pf-eco-chip" key=${name}>${name}</span>`)}
                  </div>
                  <div class="pf-eco-dim pf-eco-auto-status-note">${t('profile.ecosystem.autoStatusProcessedHint')}</div>`}
            </div>
          </div>

          <!-- deliver -->
          <div class="pf-eco-auto-status-step">
            <div class="pf-eco-auto-status-head">
              <span class="pf-eco-auto-status-dot pf-eco-auto-status-dot-${deliverState}"></span>
              <strong class="pf-eco-auto-status-label">${t('profile.ecosystem.autoStatusDelivered')}</strong>
              ${pendingCount > 0 && html`<span class="pf-eco-chip pf-eco-auto-status-pending-count">${pendingCount}</span>`}
            </div>
            <div class="pf-eco-auto-status-body">
              <p class="pf-eco-dim pf-eco-auto-status-note">${t('profile.ecosystem.autoStatusDeliveredHint')}</p>
              ${advisories === undefined
                ? html`<div class="pf-eco-dim pf-eco-data-loading"><${Spinner} /> ${t('profile.ecosystem.advLoading')}</div>`
                : advisories.length === 0
                  ? html`<div class="pf-eco-dim">${t('profile.ecosystem.advPendingEmpty')}</div>`
                  : html`
                    <div class="pf-eco-adv-list">
                      ${advisories.map(p => {
                        const a = p.advisory || {};
                        return html`
                          <div class="pf-eco-adv-item" key=${p.id}>
                            <div class="pf-eco-adv-head">
                              <strong class="pf-eco-adv-title">${a.title || p.id}</strong>
                              ${a.kind && html`<span class="pf-eco-chip pf-eco-adv-kind">${t('profile.ecosystem.advKind')}: ${a.kind}</span>`}
                              ${a.severity && html`<span class="pf-eco-chip pf-eco-adv-sev pf-eco-adv-sev-${a.severity}">${t('profile.ecosystem.advSeverity')}: ${a.severity}</span>`}
                              ${a.status && html`<span class="pf-eco-chip">${a.status}</span>`}
                            </div>
                            ${(a.effective_from || a.effective_until) && html`
                              <div class="pf-eco-dim pf-eco-adv-meta">
                                ${t('profile.ecosystem.advEffective')}: ${a.effective_from || '…'} → ${a.effective_until || '…'}
                              </div>`}
                            <div class="pf-eco-adv-body">
                              <${JsonValue} value=${a.body !== undefined ? a.body : a} />
                            </div>
                            ${a.source && html`<div class="pf-eco-dim pf-eco-adv-meta">${t('profile.ecosystem.advSource')}: ${a.source}</div>`}
                            ${a.rationale && html`
                              <div class="pf-eco-adv-rationale">
                                <span class="pf-eco-dim">${t('profile.ecosystem.advRationale')}:</span>
                                <${JsonValue} value=${a.rationale} />
                              </div>`}
                            <div class="pf-eco-adv-actions">
                              <button class="btn-success btn-sm" disabled=${!!advBusy[p.id]} onClick=${() => onApproveAdv(p.id)}>
                                ${t('profile.ecosystem.advApprove')}
                              </button>
                              <button class="btn-ghost btn-sm pf-eco-adv-reject" disabled=${!!advBusy[p.id]} onClick=${() => setConfirmId(p.id)}>
                                ${t('profile.ecosystem.advReject')}
                              </button>
                            </div>
                          </div>`;
                      })}
                    </div>`}
            </div>
          </div>

        </div>
      </div>

      <${Modal} open=${!!confirmId} onClose=${() => setConfirmId(null)} title=${t('profile.ecosystem.advReject')}>
        <p>${t('profile.ecosystem.advRejectConfirm')}</p>
        <div class="pf-eco-revoke-actions">
          <button class="btn-ghost" onClick=${() => setConfirmId(null)}>${t('common.cancel')}</button>
          <button class="btn-danger-solid" onClick=${() => onRejectAdv(confirmId)}>${t('profile.ecosystem.advReject')}</button>
        </div>
      <//>
    </div>`;
}
