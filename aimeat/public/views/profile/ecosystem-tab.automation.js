/**
 * @file public/views/profile/ecosystem-tab.automation.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The GEAI card "Automation" flow and its pieces — <EcoScheduleLog> (per-schedule
 *   run-history), <EcoStatusChip> (status-timeline chip), <EcoAgentPicker> (recommendation-aware
 *   agent picker), and <EcoAutomationSection> (the unified turnkey publish→process→deliver flow).
 *   Extracted from ecosystem-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.23.0 -- 2026-09-26 -- An advisory's dates and source are the Listing's typewriter line (.listing-meta), a unification: Jouni's decision "Meta line".
 *   v1.22.0 -- 2026-09-26 -- The recipe's agents, schedule, delivery and e-mail choices are the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.21.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.20.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.19.0 -- 2026-09-26 -- A list of things to do or of steps is the numbered list (components/NumberedIndex.js: IndexList with IndexItem, or IndexStep for a step that opens nothing): the overview's next steps with the line under each name and the first on the sun, the Wallet key steps, a calibration run's proposals, the MCP and Agents connect steps, the basic agents, a server's setup steps (the number said once), the ecosystem steps out of their grey box, the decision rules' order and the notes of your own AI use; a place keeps only its margin (a unification: Jouni's decision "Numbered list").
 *   v1.18.0 -- 2026-09-26 -- A control that opens a panel below it is the Tab's fold tone (.poster-tab--fold, is-on while open), and the parameters section that is one row until opened is the FoldSection; their own toggles, carets and arrows go (a unification: Jouni's decision Tabs and filters, and the look most tabs use).
 *   v1.17.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.16.0 -- 2026-09-25 -- The ecosystem card's help lines are the Hint (.poster-hint); their own sizes go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.15.0 -- 2026-09-25 -- A node's agents, the CORS chain, the ecosystem's identifiers and its pairing code are inline code (.code-inline); their own mono looks go (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- The last labels over a field or a group wear .poster-label: the classic AI settings, the presence dialog, the scope groups, the ecosystem's trigger and sample, the scheduler's edit form, P&L's fields, the task runner's name; a place keeps its layout (Jouni's decision "Row label", a unification).
 *   v1.13.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v1.10.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- A grey help note is the Hint (poster-hint, components/Hint.js), as every other Settings hint (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { Modal } from '/components/Modal.js';
import { JsonValue } from '/components/JsonView.js';
import { LoadingLine } from './shared.js';
import { getAutomationRecipe, getAutomationOverview, putAutomationRecipe, listPendingAdvisories, approveAdvisory, rejectAdvisory } from '/js/services/ecosystem.js';
import { formatUntil } from './schedule-item.js';
import { listAppSchedules, createCapabilitySchedule, setScheduleEnabled, triggerSchedule, getScheduleDetail, setScheduleCron } from '/js/services/schedules.js';
import { listAgents } from '/js/services/agents.js';
import { listOrganisms, currentGhii } from '/js/services/organisms.js';
import { CADENCES, CRON_TO_CADENCE, defaultTriggerGlob, primarySchedulable, allowedCadencesFor, recommendationFor } from './ecosystem-tab.helpers.js';
import { swallowed } from '/js/swallowed.js';
import { Hint } from '/components/Hint.js';
import { IndexList, IndexStep } from '/components/NumberedIndex.js';

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
    return html`<${LoadingLine} text=${t('profile.ecosystem.automationLogLoading')} />`;
  }
  if (runs.length === 0) {
    return html`<div class="poster-quiet pf-eco-auto-log-empty">${t('profile.ecosystem.automationLogEmpty')}</div>`;
  }
  return html`
    <div class="pf-eco-auto-log">
      ${runs.map(r => html`
        <div class="pf-eco-auto-log-row" key=${r.id || r.createdAt}>
          <span class="pf-eco-auto-log-time poster-time">${r.createdAt ? timeAgo(r.createdAt) : ''}</span>
          <span class=${runResultClass(r.result)}>${t(`profile.ecosystem.automationRunResult_${r.result}`)}</span>
          ${r.trigger && html`<span class="pf-eco-dim pf-eco-auto-log-trigger">${r.trigger}</span>`}
          ${typeof r.durationMs === 'number' && html`<span class="pf-eco-dim pf-eco-auto-log-dur">${t('profile.ecosystem.automationDuration', { ms: r.durationMs })}</span>`}
          ${r.errorMessage && html`<span class="pf-eco-dim pf-eco-auto-log-reason">${r.errorMessage}</span>`}
        </div>`)}
    </div>`;
}

/** How a run went, as a Status: ok is fine, an error is danger, a skipped run (or anything else) is off. */
function runResultClass(result) {
  return `poster-status poster-status--${result === 'ok' || result === 'success' ? 'fine' : result === 'error' ? 'danger' : 'off'}`;
}

/** An advisory's severity as a Status: high or critical is danger, medium needs a look, the rest is off. */
function severityClass(sev) {
  return `poster-status poster-status--${sev === 'high' || sev === 'critical' ? 'danger' : sev === 'medium' ? 'attention' : 'off'}`;
}

/**
 * The status-timeline Status for one chain step. `state` is one of:
 * 'ok' (fine), 'wait' and 'off' (off: neutral), 'error' (danger).
 */
function EcoStatusChip({ state, label }) {
  return html`<span class=${`poster-status poster-status--${state === 'ok' ? 'fine' : state === 'error' ? 'danger' : 'off'}`}>${label}</span>`;
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
    return html`<div class="poster-quiet">${t('profile.ecosystem.recipeAgentsEmpty')}</div>`;
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
    <label class="pf-eco-recipe-agent check-line" key=${a.name}>
      <input type="checkbox" checked=${selAgents.includes(a.name)} onChange=${() => onToggle(a.name)} />
      <span>${a.name}</span>
    </label>`;

  return html`
    <div class="pf-eco-rec-picker">
      ${recommended.length > 0 && html`
        <div class="pf-eco-rec-list">
          ${recommended.map(({ agent, why }) => html`
            <label class="pf-eco-rec-agent poster-box" key=${agent.name}>
              <input type="checkbox" checked=${selAgents.includes(agent.name)} onChange=${() => onToggle(agent.name)} />
              <span class="pf-eco-rec-agent-body">
                <span class="pf-eco-rec-agent-head">
                  <span class="pf-eco-rec-agent-name">${agent.name}</span>
                  <span class="poster-chip poster-chip--coral">${t('profile.ecosystem.recommendedChip')}</span>
                </span>
                ${why && html`<span class="pf-eco-dim pf-eco-rec-why">${why}</span>`}
              </span>
            </label>`)}
        </div>`}

      ${declaresRecommendations && recommended.length === 0 && html`
        <div class="pf-eco-rec-missing">
          ${recommendedAgents.filter(d => d?.name || d?.why).map((d, i) => html`
            <p class="poster-hint pf-eco-rec-missing-line" key=${d.name || i}>
              ${t('profile.ecosystem.recommendedMissing', {
                name: d.name || '—',
                why: (d.why && (d.why[locale] || d.why.en || d.why.fi)) || '',
              })}
            </p>`)}
        </div>`}

      ${rest.length > 0 && (recommended.length > 0 || declaresRecommendations
        ? html`
          <div class="pf-eco-rec-rest">
            <button type="button" class=${`poster-tab poster-tab--fold ${showAll ? 'is-on' : ''}`} aria-expanded=${showAll} onClick=${() => setShowAll(o => !o)}>
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
      <div class="pf-eco-section poster-row--thing">
        <div class="pf-eco-section-title">${t('profile.ecosystem.automationTitle')}</div>
        <div class="poster-hint">${t('profile.ecosystem.autoRevoked')}</div>
        <${Hint}>${t('profile.ecosystem.revokeReconnectHint')}<//>
      </div>`;
  }

  if (!loaded) {
    return html`
      <div class="pf-eco-section poster-row--thing">
        <div class="pf-eco-section-title">${t('profile.ecosystem.automationTitle')}</div>
        <${LoadingLine} text=${t('profile.ecosystem.automationLoading')} />
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
    <div class="pf-eco-section poster-row--thing pf-eco-auto-flow" data-eco-auto=${app.app}>
      <div class="pf-eco-section-title">${t('profile.ecosystem.automationTitle')}</div>
      <${Hint}>${t('profile.ecosystem.autoIntro')}<//>

      <button type="button" class=${`poster-tab poster-tab--fold ${showHow ? 'is-on' : ''}`} aria-expanded=${showHow} onClick=${() => setShowHow(o => !o)}>
        ${t('profile.ecosystem.autoHowTitle')}
      </button>
      ${showHow && html`
        <div class="pf-eco-auto-how">
          <${Hint}>${t('profile.ecosystem.autoHowLead')}<//>
          <${IndexList} steps className="pf-eco-auto-how-steps">
            ${[1, 2, 3, 4].map((n) => html`<${IndexStep} key=${n}>${t(`profile.ecosystem.autoHowStep${n}`)}<//>`)}
          <//>
          <p class="poster-hint pf-eco-auto-how-doc">${t('profile.ecosystem.autoHowDoc')}</p>
        </div>`}

      <!-- ── the ONE config card, read top-to-bottom ── -->
      <div class="pf-eco-auto-flow-card poster-row--thing">
        <!-- ① What this app produces -->
        <div class="pf-eco-auto-flow-step">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep1')}</div>
          ${primary
            ? html`
              <div class="pf-eco-auto-produces">
                <span class="code-inline pf-eco-auto-produces-cap">${primary.id}</span>
                ${primary.produces && html`<span class="pf-eco-dim">${t('profile.ecosystem.autoProduces')}: <span class="code-inline">${primary.produces}</span></span>`}
                ${producesKey && html`<span class="pf-eco-dim">${t('profile.ecosystem.autoDepositKey')}: <span class="code-inline">${defaultTriggerGlob(app)}</span></span>`}
              </div>`
            : html`<div class="pf-eco-dim">${t('profile.ecosystem.automationNoCaps')}</div>`}
        </div>

        <!-- ② Run on a schedule -->
        <div class="pf-eco-auto-flow-step ${primary ? '' : 'pf-eco-auto-flow-step-disabled'}">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep2')}</div>
          <div class="pf-eco-auto-flow-controls">
            <select class="select-field" value=${cadence} disabled=${!primary}
              onChange=${e => setCadence(e.target.value)}>
              ${allowedCadences.map(c => html`<option value=${c.key} key=${c.key}>${t(`profile.ecosystem.automationCadence_${c.key}`)}</option>`)}
            </select>
            <label class="pf-eco-recipe-toggle check-line">
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
          <select class="select-field" value=${organism} onChange=${e => setOrganism(e.target.value)}>
            <option value="">${t('profile.ecosystem.recipeOrganismNone')}</option>
            ${orgs.map(o => html`<option value=${o.id} key=${o.id}>${o.name || o.id}</option>`)}
          </select>
        </div>

        <!-- ⑤ Deliver guidance -->
        <div class="pf-eco-auto-flow-step">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep5')}</div>
          <div class="pf-eco-recipe-radios">
            <label class="pf-eco-recipe-radio check-line">
              <input type="radio" name=${`eco-delivery-${app.app}`} checked=${requireApproval} onChange=${() => setRequireApproval(true)} />
              <span>
                <span class="pf-eco-recipe-radio-title">${t('profile.ecosystem.recipeDeliveryApprove')}</span>
                <span class="poster-hint">${t('profile.ecosystem.recipeDeliveryApproveHint')}</span>
              </span>
            </label>
            <label class="pf-eco-recipe-radio check-line">
              <input type="radio" name=${`eco-delivery-${app.app}`} checked=${!requireApproval} onChange=${() => setRequireApproval(false)} />
              <span>
                <span class="pf-eco-recipe-radio-title">${t('profile.ecosystem.recipeDeliveryPush')}</span>
                <span class="poster-hint">${t('profile.ecosystem.recipeDeliveryPushHint')}</span>
              </span>
            </label>
          </div>
          <label class="pf-eco-recipe-toggle pf-eco-auto-flow-email check-line">
            <input type="checkbox" checked=${email} onChange=${e => setEmail(e.target.checked)} />
            <span>${t('profile.ecosystem.recipeEmail')}</span>
          </label>
        </div>

        <!-- Advanced: trigger key -->
        <div class="pf-eco-auto-flow-step pf-eco-auto-flow-advanced">
          <button type="button" class=${`poster-tab poster-tab--fold ${showAdvanced ? 'is-on' : ''}`} aria-expanded=${showAdvanced} onClick=${() => setShowAdvanced(o => !o)}>
            ${t('profile.ecosystem.autoAdvanced')}
          </button>
          ${showAdvanced && html`
            <div class="pf-eco-auto-flow-advanced-body">
              <label class="poster-label">${t('profile.ecosystem.recipeTriggerLabel')}</label>
              <input type="text" class="og-input"
                value=${triggerGlob} placeholder=${defaultTriggerGlob(app)}
                onInput=${e => setTriggerGlob(e.target.value)} />
              <${Hint}>${t('profile.ecosystem.recipeTriggerHelp')}<//>
            </div>`}
        </div>

        <!-- ONE Save -->
        <div class="pf-eco-auto-flow-save">
          <button class="poster-slab poster-slab--control" disabled=${saving} onClick=${onSave}>${t('profile.ecosystem.autoSave')}</button>
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
                        ? html`${timeAgo(primaryJob.lastRunAt)}${primaryJob.lastRunResult ? html` · <span class=${runResultClass(primaryJob.lastRunResult)}>${primaryJob.lastRunResult}</span>` : ''}`
                        : '—'}
                    </span>
                    <span class="pf-eco-dim">${t('profile.ecosystem.automationNextRun')}: ${primaryJob.enabled ? formatUntil(primaryJob.nextRunAt) : '—'}</span>
                  </div>
                  ${lastAttempt && lastAttempt.outcome === 'busy' && html`
                    <div class="poster-hint">
                      ${/offline|unavailable/i.test(lastAttempt.reason)
                        ? t('profile.ecosystem.automationRunSkippedOffline')
                        : t('profile.ecosystem.automationRunSkipped', { reason: lastAttempt.reason })}
                    </div>`}
                  <div class="pf-eco-auto-job-actions">
                    <button class="poster-action poster-action--small" disabled=${running} onClick=${onRunNow}>${t('profile.ecosystem.automationRunNow')}</button>
                    <button class="poster-action poster-action--small" aria-expanded=${openLog} onClick=${() => setOpenLog(o => !o)}>
                      ${openLog ? t('profile.ecosystem.automationHideLog') : t('profile.ecosystem.automationShowLog')}
                    </button>
                  </div>
                  ${openLog && html`<${EcoScheduleLog} jobId=${primaryJob.id} refreshKey=${logRefresh} />`}`
                : html`<div class="poster-hint">${t('profile.ecosystem.autoStatusPublishedHint')}</div>`}
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
                ? html`<div class="poster-hint">${t('profile.ecosystem.autoStatusNoAgents')}</div>`
                : html`
                  <div class="pf-eco-auto-status-agents">
                    ${selAgents.map(name => html`<span class="poster-chip" key=${name}>${name}</span>`)}
                  </div>
                  <div class="poster-hint">${t('profile.ecosystem.autoStatusProcessedHint')}</div>`}
            </div>
          </div>

          <!-- deliver -->
          <div class="pf-eco-auto-status-step">
            <div class="pf-eco-auto-status-head">
              <span class="pf-eco-auto-status-dot pf-eco-auto-status-dot-${deliverState}"></span>
              <strong class="pf-eco-auto-status-label">${t('profile.ecosystem.autoStatusDelivered')}</strong>
              ${pendingCount > 0 && html`<span class="poster-count poster-count--waiting">${pendingCount}</span>`}
            </div>
            <div class="pf-eco-auto-status-body">
              <${Hint}>${t('profile.ecosystem.autoStatusDeliveredHint')}<//>
              ${advisories === undefined
                ? html`<${LoadingLine} text=${t('profile.ecosystem.advLoading')} />`
                : advisories.length === 0
                  ? html`<div class="poster-quiet">${t('profile.ecosystem.advPendingEmpty')}</div>`
                  : html`
                    <div class="pf-eco-adv-list">
                      ${advisories.map(p => {
                        const a = p.advisory || {};
                        return html`
                          <div class="pf-eco-adv-item" key=${p.id}>
                            <div class="pf-eco-adv-head">
                              <strong class="pf-eco-adv-title">${a.title || p.id}</strong>
                              ${a.kind && html`<span class="poster-chip">${t('profile.ecosystem.advKind')}: ${a.kind}</span>`}
                              ${a.severity && html`<span class=${severityClass(a.severity)}>${t('profile.ecosystem.advSeverity')}: ${a.severity}</span>`}
                              ${a.status && html`<span class="poster-chip">${a.status}</span>`}
                            </div>
                            ${(a.effective_from || a.effective_until) && html`
                              <div class="pf-eco-dim pf-eco-adv-meta listing-meta">
                                ${t('profile.ecosystem.advEffective')}: ${a.effective_from || '…'} → ${a.effective_until || '…'}
                              </div>`}
                            <div class="pf-eco-adv-body">
                              <${JsonValue} value=${a.body !== undefined ? a.body : a} />
                            </div>
                            ${a.source && html`<div class="pf-eco-dim pf-eco-adv-meta listing-meta">${t('profile.ecosystem.advSource')}: ${a.source}</div>`}
                            ${a.rationale && html`
                              <div class="pf-eco-adv-rationale">
                                <span class="pf-eco-dim">${t('profile.ecosystem.advRationale')}:</span>
                                <${JsonValue} value=${a.rationale} />
                              </div>`}
                            <div class="pf-eco-adv-actions">
                              <button class="poster-action poster-action--small" disabled=${!!advBusy[p.id]} onClick=${() => onApproveAdv(p.id)}>
                                ${t('profile.ecosystem.advApprove')}
                              </button>
                              <button class="poster-action poster-action--small poster-action--danger" disabled=${!!advBusy[p.id]} onClick=${() => setConfirmId(p.id)}>
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

      <${Modal} open=${!!confirmId} onClose=${() => setConfirmId(null)} title=${t('profile.ecosystem.advReject')} size="sm"
        footer=${html`
          <button class="poster-action" onClick=${() => setConfirmId(null)}>${t('common.cancel')}</button>
          <button class="poster-slab poster-slab--control poster-slab--danger" onClick=${() => onRejectAdv(confirmId)}>${t('profile.ecosystem.advReject')}</button>`}>
        <p>${t('profile.ecosystem.advRejectConfirm')}</p>
      <//>
    </div>`;
}
