/**
 * @file ecosystem-tab.js
 * @description Profile "Ecosystem apps" tab — the owner-facing surface for GEAI (ecosystem app)
 *   principals, the near-copy sibling of the Agents tab. Covers the core loop: pending
 *   "hello integration" requests (approve with a scope preset / deny), the connected-GEAI list, and
 *   per-app grants + outbound event subscriptions + the account-correspondence binding with a
 *   typed-name revoke. Listens for aimeat-live-update and polls pending requests, like the Agents tab.
 * @structure EcosystemTab(default) — loadData, pending poll, connect panel, app cards, revoke modal
 * @usage Registered as a TABS entry in views/profile.js (id 'ecosystem').
 * @version-history
 *   v1.0.0 — 2026-06-14 — Initial Ecosystem apps tab (chunk 6): pending approve/deny, connected list,
 *     grants, subscriptions, binding + typed-name revoke. Full card sub-tabs + workflow-authoring
 *     additions deferred to a follow-up.
 *   v1.1.0 — 2026-06-15 — Add "Data this app wrote" section to the expanded card: lazy-loads the app's
 *     eco: memory on first expand, refreshes on the live poll, renders key/value/visibility/time rows.
 *   v1.2.0 — 2026-06-15 — "Data this app wrote" rows are now expandable: collapsed shows key + visibility
 *     chip + timeAgo; expanded renders the FULL value readably (pretty-printed JSON for objects/arrays,
 *     the shared safe Markdown viewer for markdown-looking strings, a plain block otherwise). Added a
 *     direction caption under "Event subscriptions" clarifying AIMEAT → this app (outbound) delivery.
 *   v1.3.0 — 2026-06-15 — Render the expanded value via the shared <JsonValue> (components/JsonView.js)
 *     — a structured key/value TREE for JSON (same as the agent Tasks view), Markdown for strings —
 *     instead of raw pretty-printed JSON in a <pre>. Human-readable, not raw JSON.
 *   v1.3.1 — 2026-06-15 — Compact font for the value tree (matches the agent style); the written-data
 *     section now refreshes ONLY on the aimeat-live-update event (not the 10s timer) and seamlessly
 *     (spinner only on first load), so a viewed entry never collapses under a poll.
 *   v1.4.0 — 2026-06-15 — Add the "Automation" section to the expanded card: schedule a connected app's
 *     capabilities on a daily/weekly/monthly cadence. Per-capability enable toggle (creates/deletes an
 *     eco-capability schedule), a list of the app's existing schedules with cadence/enabled/last+next
 *     run + Run-now + delete, lazy-loaded on expand and refreshed on the live-update event.
 *   v1.5.0 — 2026-06-15 — Add the recipe config block (B4) under Automation: <EcoRecipeConfig> — a
 *     per-(owner,app) "when this app publishes data" recipe (process-with-agents checklist, store-in-organism
 *     dropdown, email toggle, approve/push delivery radio, Enabled master toggle, Save). Lazy-loads the
 *     recipe + the owner's agents + organisms, reflects loaded state, refreshes on aimeat-live-update,
 *     toasts on save. Shows the resolved trigger keyGlob read-only.
 *   v1.7.0 — 2026-06-15 — Automation schedule-row UX (3 fixes): (1) "Run now" reports the HONEST
 *     trigger outcome — success/skip(busy)/error — with offline-aware skip wording (the connector
 *     tunnel hint) instead of a fake green success, + a per-row last-attempt note for skips; (2) a
 *     per-schedule run-history log expander (<EcoScheduleLog>, GET /v1/schedules/:id) listing recent
 *     runs incl. SKIPPED ones with their reason/duration/trigger; (3) the read-only cadence chip is
 *     now an editable <select> that PATCHes the cron of an existing schedule (custom crons preserved).
 *   v1.8.0 — 2026-06-15 — Make the recipe trigger keyGlob EDITABLE: the read-only "Triggers on" line is
 *     now a text input prefilled from the recipe's stored keyGlob, else derived from the app's automation
 *     hint (defaultTriggerGlob — prefers produces_key over produces), with a help line. Save now sends
 *     trigger:{keyGlob}. Fixes recipes never firing because the default glob didn't match the deposit key.
 *   v1.6.0 — 2026-06-15 — Add the "Pending advisories" approval surface (B7/B8): <EcoPendingAdvisories>
 *     under Automation. Lists the recipe's gated agent-produced advisories awaiting approval; each shows
 *     title + kind/severity chips + effective dates + the body rendered readably via <JsonValue> (never
 *     raw JSON) + source/rationale, with Approve (→ deliver over the tunnel) and Reject (→ confirm-modal,
 *     then drop). Approve handles the 202 offline-retry/failed case by keeping the row + an info/warning
 *     toast; delivered/rejected drop the row. Lazy-loads + refreshes on aimeat-live-update.
 *   v2.1.0 — 2026-06-15 — Add the guided **Setup playbook** ("Käyttöönotto") + the **MCP promo** block
 *     to the TOP of the expanded card (<EcoSetupPlaybook>). The playbook reads the live recipe / schedule
 *     / agent state and shows a 4-step checklist with derived statuses (app connected · connect your
 *     processing agent · set up automation · choose an organism) + overall progress, each with a one-line
 *     WHY and a CTA. The framing leads with "why AIMEAT": your insights are MCP-reachable from any AI chat,
 *     the agent is YOURS (the app only recommends a template), and the organism is where insights outlast
 *     the app. The MCP promo block builds a real sample memory key from the app's produce key + the owner's
 *     org and offers a copyable "ask it in Claude/Grok/ChatGPT" prompt. Frontend-only; no backend logic.
 *     Operator how-to: docs/ecosystem-app-automation-howto.md.
 *   v2.0.0 — 2026-06-15 — REWORK the Automation section into ONE turnkey flow. The three stacked
 *     sub-sections (per-capability cadence rows, the schedules list, <EcoRecipeConfig>) and the separate
 *     <EcoPendingAdvisories> are MERGED into a single <EcoAutomationSection>: a "How this works" 4-hop
 *     expander, ONE numbered config card (① what the app produces · ② run on a schedule · ③ process with
 *     agents · ④ store in organism · ⑤ deliver guidance + email · Advanced trigger key), and ONE "Save
 *     automation" button that performs BOTH backend writes — reconciles the publish eco-capability
 *     SCHEDULE (create / cadence-patch / pause) to match ② AND PUTs the RECIPE (③④⑤ + keyGlob). Below it,
 *     a single vertical 3-step STATUS timeline (publish → process → deliver): publish = the schedule's
 *     last/next run + result + an honest Run-now + run-log; process = the configured agents (honest "runs
 *     when data is published", no fabricated task status); deliver = the pending advisories folded in with
 *     inline Approve/Reject. Lazy-loads schedules+agents+orgs+recipe+advisories on expand, refreshes on
 *     aimeat-live-update. Frontend-only; no backend logic changed. Operator how-to: docs/ecosystem-app-automation-howto.md.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import { Modal } from '/components/Modal.js';
import { JsonValue } from '/components/JsonView.js';
import { Spinner } from './shared.js';
import { listEcosystemApps, listAppData, listPending, approve, revoke, listSubscriptions, subscribe, unsubscribe, getAutomationRecipe, putAutomationRecipe, listPendingAdvisories, approveAdvisory, rejectAdvisory } from '/js/services/ecosystem.js';
import { formatUntil } from './schedule-item.js';
import { listAppSchedules, createCapabilitySchedule, setScheduleEnabled, triggerSchedule, getScheduleDetail, setScheduleCron } from '/js/services/schedules.js';
import { listAgents } from '/js/services/agents.js';
import { listOrganisms, currentGhii } from '/js/services/organisms.js';

/**
 * One "Data this app wrote" entry: collapsed row (key + visibility chip + timeAgo) that expands to
 * the FULL value rendered HUMAN-READABLY via the shared <JsonValue> — a key/value tree for JSON
 * (the same structured renderer the agent Tasks view uses), safe Markdown for non-JSON strings.
 */
function EcoDataEntry({ entry }) {
  const [open, setOpen] = useState(false);
  return html`
    <div class="pf-eco-data-entry">
      <button class="pf-eco-data-row" onClick=${() => setOpen(o => !o)}
        aria-expanded=${open} title=${open ? t('profile.ecosystem.dataCollapse') : t('profile.ecosystem.dataExpand')}>
        <span class="pf-eco-caret">${open ? '▼' : '▶'}</span>
        <span class="pf-eco-mono pf-eco-data-key">${entry.key}</span>
        <span class="pf-eco-chip pf-eco-data-vis">${entry.visibility}</span>
        <span class="pf-eco-dim pf-eco-data-time">${entry.updated_at ? timeAgo(entry.updated_at) : ''}</span>
      </button>
      ${open && html`
        <div class="pf-eco-data-body">
          <${JsonValue} value=${entry.value} />
        </div>`}
    </div>`;
}

// Scope presets the owner picks at approval — lean read + deposit (ecosystem apps mostly deposit
// refined data + subscribe to events). 'full' grants the wildcard.
const ECO_PRESETS = {
  readonly: ['memory:read', 'organism:read'],
  standard: ['memory:read', 'memory:write', 'knowledge:contribute', 'organism:read', 'events:subscribe', 'events:emit'],
  full: ['*'],
};
const OUTBOUND_EVENTS = ['memory.write', 'memory.delete', 'offer.ordered', 'workflow.step', 'binding.revoked', '*'];

function keyFp(pub) {
  if (!pub) return '';
  return pub.length > 12 ? `${pub.slice(0, 8)}…${pub.slice(-4)}` : pub;
}

// ── Automation: cadence ⇄ cron ──────────────────────────────────────────────
// The UI offers three coarse cadences; each maps to a fixed 08:00 cron. The
// reverse map turns a known cron back into a human cadence label for the list.
const CADENCES = [
  { key: 'daily', cron: '0 8 * * *' },
  { key: 'weekly', cron: '0 8 * * 1' },
  { key: 'monthly', cron: '0 8 1 * *' },
];
const CRON_TO_CADENCE = Object.fromEntries(CADENCES.map(c => [c.cron, c.key]));

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
      .catch(() => { if (alive) setRuns([]); });
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
 * Derive the default trigger keyGlob from the app's automation hint. Mirrors the node's
 * defaultKeyGlob (routes/ecosystem-apps.ts): prefer `produces_key` (the deposit KEY PREFIX,
 * e.g. `feedback.stats`) over `produces` (a SCHEMA ref, e.g. `feedback-stats@1`, which is NOT a
 * deposit key); turn a bare prefix into a glob, else fall back to `eco.{app}.*`.
 */
function defaultTriggerGlob(app) {
  const schedulable = app?.automation?.schedulable || [];
  const entry = schedulable.find(s => s.produces_key) || schedulable.find(s => s.produces);
  const base = entry?.produces_key || entry?.produces;
  if (base) return base.includes('*') ? base : `${base}.*`;
  return `eco.${app?.app}.*`;
}

/**
 * Pick the app's PRIMARY schedulable capability — the one the unified flow centres on:
 * "this app produces X on a schedule". Prefers an entry that declares `produces` (so we can
 * show what it deposits); falls back to the first schedulable, else null.
 */
function primarySchedulable(app) {
  const schedulable = (app?.automation && app.automation.schedulable) || [];
  return schedulable.find(s => s.produces || s.produces_key) || schedulable[0] || null;
}

/** Allowed cadences for a schedulable entry (restricted by its `cadences`, else all three). */
function allowedCadencesFor(entry) {
  const allow = entry && Array.isArray(entry.cadences) ? entry.cadences : null;
  return allow ? CADENCES.filter(c => allow.includes(c.key)) : CADENCES;
}

/**
 * The status-timeline chip for one chain step. `state` is one of:
 * 'ok' (green), 'wait' (neutral/dimmed), 'off' (paused/dimmed), 'error' (danger).
 */
function EcoStatusChip({ state, label }) {
  return html`<span class="pf-eco-chip pf-eco-auto-status-chip pf-eco-auto-status-${state}">${label}</span>`;
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
function EcoAutomationSection({ app, showToast }) {
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
    const [schedList, agentList, recipe, orgResp, advList] = await Promise.all([
      listAppSchedules(app.app).catch(() => []),
      listAgents().catch(() => []),
      getAutomationRecipe(app.app).catch(() => null),
      (ownerName ? listOrganisms({ member: ownerName }) : Promise.resolve(null)).catch(() => null),
      listPendingAdvisories(app.app).catch(() => null),
    ]);
    setSchedules(schedList);
    setAgents(agentList.filter(a => !a.name?.startsWith('session-')));
    setOrgs(orgResp?.data?.organisms || []);
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
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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

        <!-- ③ Process with agent(s) -->
        <div class="pf-eco-auto-flow-step">
          <div class="pf-eco-auto-flow-num">${t('profile.ecosystem.autoStep3')}</div>
          ${agents.length === 0
            ? html`<div class="pf-eco-dim">${t('profile.ecosystem.recipeAgentsEmpty')}</div>`
            : html`
              <div class="pf-eco-recipe-agents">
                ${agents.map(a => html`
                  <label class="pf-eco-recipe-agent" key=${a.name}>
                    <input type="checkbox" checked=${selAgents.includes(a.name)} onChange=${() => toggleAgent(a.name)} />
                    <span>${a.name}</span>
                  </label>`)}
              </div>`}
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

/**
 * The owner's bare org/owner name, used to build a concrete sample memory key (e.g.
 * `feedback.stats.<org>.latest`). Empty string when the session can't be read.
 */
function ownerOrgName() {
  return (currentGhii().split('@')[0]) || '';
}

/**
 * Build the sample memory key the MCP promo invites the operator to query. Mirrors the
 * recipe trigger: prefer the app's deposit KEY PREFIX (`produces_key`), else `produces`, else
 * `eco.<app>`; append the owner's org + `.latest` so it reads as a real, copyable key. Returns
 * `{ key, derived }` — `derived` is false when we had to fall back to a generic example.
 */
function sampleMemoryKey(app) {
  const schedulable = app?.automation?.schedulable || [];
  const entry = schedulable.find(s => s.produces_key) || schedulable.find(s => s.produces);
  const base = (entry?.produces_key || entry?.produces || '').replace(/[@:].*$/, '').replace(/\*+/g, '').replace(/\.+$/, '');
  const org = ownerOrgName();
  if (base) {
    return { key: org ? `${base}.${org}.latest` : `${base}.latest`, derived: true };
  }
  return { key: org ? `eco.${app?.app || 'app'}.${org}.latest` : `eco.${app?.app || 'app'}.latest`, derived: false };
}

/**
 * The guided **Setup playbook** ("Käyttöönotto") + **MCP promo** that sit at the TOP of an expanded
 * GEAI card. This is a GUIDE, not a settings panel — the real config lives in <EcoAutomationSection>
 * below. It reads the live recipe / schedule / agent state and reflects progress.
 *
 * The framing leads with the "why AIMEAT" payoff the operator is about to ask for:
 *   • your insights become reachable from ANY AI chat (Claude / Grok / ChatGPT) over MCP;
 *   • the processing agent is YOURS — the app only recommends a prompt template, it doesn't own it;
 *   • results land in an organism, so they outlast the app and get reused everywhere.
 *
 * The 4 steps + their derived status:
 *   1. App connected — always ✅ (the card only renders for a connected app).
 *   2. Connect your processing agent — ✅ when the recipe has agents selected.
 *   3. Set up automation — ✅ when a publish schedule is enabled AND the recipe is enabled with agents.
 *   4. Choose an organism — ✅ when the recipe has an organism set.
 *
 * Lazy-loads recipe + schedules + agents on first render, refreshes on aimeat-live-update.
 */
function EcoSetupPlaybook({ app, showToast }) {
  const [loaded, setLoaded] = useState(false);
  const [recipe, setRecipe] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [agentCount, setAgentCount] = useState(0);

  const load = async () => {
    const [recipeResp, schedList, agentList] = await Promise.all([
      getAutomationRecipe(app.app).catch(() => null),
      listAppSchedules(app.app).catch(() => []),
      listAgents().catch(() => []),
    ]);
    setRecipe(recipeResp);
    setSchedules(Array.isArray(schedList) ? schedList : []);
    setAgentCount((Array.isArray(agentList) ? agentList : []).filter(a => !a.name?.startsWith('session-')).length);
    setLoaded(true);
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    loadRef.current();
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [app.app]);

  // CTA: jump to the profile Agents tab (deep-link the profile SPA honours on load).
  function gotoAgents() {
    window.location.assign(`${window.location.pathname}?tab=agents`);
  }
  // CTA: scroll the expanded card's Automation config into view.
  function focusAutomation() {
    const card = document.querySelector(`[data-eco-auto="${app.app}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const sample = sampleMemoryKey(app);
  const samplePrompt = t('profile.ecosystem.mcpSamplePrompt', {
    key: sample.key,
    organism: t('profile.ecosystem.mcpSampleOrganismFallback'),
  });

  // Derived step statuses.
  const hasAgents = !!(recipe && Array.isArray(recipe.agents) && recipe.agents.length > 0);
  const scheduleOn = schedules.some(j => j.enabled);
  const automationOn = scheduleOn && hasAgents && !!(recipe && recipe.enabled);
  const hasOrganism = !!(recipe && recipe.organism);

  const steps = [
    { done: true, title: t('profile.ecosystem.setupStep1Title'), why: t('profile.ecosystem.setupStep1Why'), cta: null },
    {
      done: hasAgents, title: t('profile.ecosystem.setupStep2Title'), why: t('profile.ecosystem.setupStep2Why'),
      cta: hasAgents ? null : { label: t('profile.ecosystem.setupStep2Cta'), onClick: gotoAgents },
      note: agentCount === 0 ? t('profile.ecosystem.setupStep2NoAgents') : null,
    },
    {
      done: automationOn, title: t('profile.ecosystem.setupStep3Title'), why: t('profile.ecosystem.setupStep3Why'),
      cta: automationOn ? null : { label: t('profile.ecosystem.setupStep3Cta'), onClick: focusAutomation },
    },
    {
      done: hasOrganism, title: t('profile.ecosystem.setupStep4Title'), why: t('profile.ecosystem.setupStep4Why'),
      cta: hasOrganism ? null : { label: t('profile.ecosystem.setupStep4Cta'), onClick: focusAutomation },
    },
  ];
  const doneCount = steps.filter(s => s.done).length;

  return html`
    <div class="pf-eco-section pf-eco-setup">
      <div class="pf-eco-section-title">${t('profile.ecosystem.setupTitle')}</div>
      <p class="pf-eco-dim pf-eco-setup-lead">${t('profile.ecosystem.setupLead')}</p>

      <div class="pf-eco-setup-progress">
        <span class="pf-eco-chip pf-eco-setup-progress-chip">${t('profile.ecosystem.setupProgress', { done: doneCount, total: steps.length })}</span>
      </div>

      ${!loaded
        ? html`<div class="pf-eco-dim pf-eco-data-loading"><${Spinner} /> ${t('profile.ecosystem.setupLoading')}</div>`
        : html`
          <ol class="pf-eco-setup-steps">
            ${steps.map((s, i) => html`
              <li class="pf-eco-setup-step ${s.done ? 'pf-eco-setup-step-done' : ''}" key=${i}>
                <span class="pf-eco-setup-dot ${s.done ? 'pf-eco-setup-dot-done' : 'pf-eco-setup-dot-wait'}">${s.done ? '✓' : ''}</span>
                <div class="pf-eco-setup-step-body">
                  <div class="pf-eco-setup-step-title">${s.title}</div>
                  <div class="pf-eco-dim pf-eco-setup-step-why">${s.why}</div>
                  ${s.note && html`<div class="pf-eco-dim pf-eco-setup-step-note">${s.note}</div>`}
                  ${s.cta && html`<button class="btn-outline btn-sm pf-eco-setup-cta" onClick=${s.cta.onClick}>${s.cta.label}</button>`}
                </div>
              </li>`)}
          </ol>`}

      <!-- MCP promo: ask your insights from any AI chat -->
      <div class="pf-eco-mcp">
        <div class="pf-eco-mcp-head">
          <span class="pf-eco-mcp-icon">💬</span>
          <strong class="pf-eco-mcp-title">${t('profile.ecosystem.mcpTitle')}</strong>
        </div>
        <p class="pf-eco-dim pf-eco-mcp-sub">${t('profile.ecosystem.mcpSub')}</p>
        <p class="pf-eco-dim pf-eco-mcp-connect">${t('profile.ecosystem.mcpConnect')}</p>
        <div class="pf-eco-mcp-sample">
          <div class="pf-eco-mcp-sample-label">${t('profile.ecosystem.mcpSampleLabel')}</div>
          <div class="pf-eco-mcp-sample-row">
            <code class="pf-eco-mcp-sample-prompt">${samplePrompt}</code>
            <${CopyButton} className="copy-prompt-btn" text=${samplePrompt} />
          </div>
          ${!sample.derived && html`<p class="pf-eco-dim pf-eco-mcp-sample-note">${t('profile.ecosystem.mcpSampleGeneric')}</p>`}
        </div>
      </div>
    </div>`;
}

export default function EcosystemTab({ onStats, showToast }) {
  const [apps, setApps] = useState([]);
  const [pending, setPending] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);     // expanded geai
  const [presetByCode, setPresetByCode] = useState({}); // userCode → preset
  const [revokeApp, setRevokeApp] = useState(null);   // app pending typed-name revoke
  const [revokeInput, setRevokeInput] = useState('');
  const [subForm, setSubForm] = useState({});         // app → { event }
  const [appData, setAppData] = useState({});         // geai → array of memory entries (undefined = never loaded)

  // Load (or refresh) the memory a given app wrote. Lazy on first expand, then on the live poll.
  const loadAppData = async (app, geai) => {
    try {
      const items = await listAppData(app);
      setAppData(d => ({ ...d, [geai]: items }));
    } catch (e) {
      // Leave the cached value (if any); a transient failure shouldn't blank the section.
    }
  };

  const expandedRef = useRef(null);
  expandedRef.current = expanded;
  const appsRef = useRef([]);
  appsRef.current = apps;

  const loadData = async () => {
    try {
      const [a, p, s] = await Promise.all([listEcosystemApps(), listPending(), listSubscriptions()]);
      setApps(a); setPending(p); setSubs(s);
      onStats?.({ ecosystem: a.length });
    } catch (e) {
      showToast?.(t('profile.ecosystem.loadError'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadRef = useRef(loadData);
  loadRef.current = loadData;

  // Toggle a card; lazy-load its written data the first time it opens.
  function toggleCard(app) {
    if (expanded === app.geai) { setExpanded(null); return; }
    setExpanded(app.geai);
    if (appData[app.geai] === undefined) loadAppData(app.app, app.geai);
  }
  useEffect(() => {
    loadRef.current();
    // Event-driven: when AIMEAT pushes a live update (e.g. the app just deposited data), refresh the
    // lists AND — seamlessly, without collapsing the open entry — the open card's written data. The
    // "Data this app wrote" section updates on THIS event, not on a timer.
    const handler = () => {
      loadRef.current();
      const openGeai = expandedRef.current;
      if (openGeai) {
        const openApp = appsRef.current.find(x => x.geai === openGeai);
        if (openApp) loadAppData(openApp.app, openApp.geai);
      }
    };
    window.addEventListener('aimeat-live-update', handler);
    // A slow timer only keeps the app list + pending onboarding requests fresh; it does NOT
    // re-fetch the written-data section (that is event-driven above), so a viewed entry never
    // collapses under a poll.
    const poller = setInterval(() => loadRef.current(), 10000);
    return () => { window.removeEventListener('aimeat-live-update', handler); clearInterval(poller); };
  }, []);

  async function onApprove(userCode) {
    const preset = presetByCode[userCode] || 'standard';
    try {
      await approve(userCode, { action: 'approve', scopes: ECO_PRESETS[preset] });
      showToast?.(t('profile.ecosystem.approved'), 'success');
      await loadData();
    } catch (e) { showToast?.(t('profile.ecosystem.approveError'), 'error'); }
  }
  async function onDeny(userCode) {
    try { await approve(userCode, { action: 'deny' }); await loadData(); }
    catch (e) { showToast?.(t('profile.ecosystem.approveError'), 'error'); }
  }
  async function onRevokeConfirm() {
    const app = revokeApp;
    setRevokeApp(null); setRevokeInput('');
    try { await revoke(app); showToast?.(t('profile.ecosystem.revoked'), 'success'); await loadData(); }
    catch (e) { showToast?.(t('profile.ecosystem.revokeError'), 'error'); }
  }
  async function onSubscribe(app) {
    const event = subForm[app]?.event || 'memory.write';
    try { await subscribe(app, event); setSubForm(f => ({ ...f, [app]: {} })); await loadData(); }
    catch (e) { showToast?.(t('profile.ecosystem.subError'), 'error'); }
  }
  async function onUnsubscribe(app, event) {
    try { await unsubscribe(app, event); await loadData(); }
    catch (e) { showToast?.(t('profile.ecosystem.subError'), 'error'); }
  }

  if (loading) return html`<div class="pf-eco"><${Spinner} /></div>`;

  const connectorCmd = 'aimeat connect serve --ecosystem';

  return html`
    <div class="pf-eco">
      <div class="pf-eco-head">
        <h3 class="section-title">
          ${t('profile.ecosystem.title')} <span class="pf-eco-count-badge">${apps.length}</span>
        </h3>
        <button class="${connectOpen ? 'btn-outline btn-sm' : 'btn-primary btn-sm'}" onClick=${() => setConnectOpen(o => !o)}>
          ${connectOpen ? t('common.close') : t('profile.ecosystem.connect')}
        </button>
      </div>
      <p class="section-desc">${t('profile.ecosystem.desc')}</p>

      ${connectOpen && html`
        <div class="pf-eco-connect">
          <p class="pf-eco-connect-note">${t('profile.ecosystem.connectNote')}</p>
          <div class="pf-eco-cmd-row">
            <code class="pf-eco-cmd">${connectorCmd}</code>
            <${CopyButton} className="copy-prompt-btn" text=${connectorCmd} />
          </div>
        </div>`}

      ${pending.length > 0 && html`
        <div class="pf-eco-pending">
          <div class="pf-eco-pending-title">${t('profile.ecosystem.pendingTitle')}</div>
          ${pending.map(r => html`
            <div class="pf-eco-pending-row" key=${r.user_code}>
              <div class="pf-eco-pending-info">
                <strong>${r.display_name || r.app}</strong>
                <span class="pf-eco-mono">eco:${r.app}</span>
                <span class="pf-eco-pill">${t('profile.ecosystem.waiting')}</span>
                ${r.validation && r.validation !== 'none' && html`
                  <span class="pf-eco-valid pf-eco-valid-${r.validation}"
                    title=${(r.validation_checks || []).filter(c => !c.ok).map(c => `${c.name}: ${c.detail || ''}`).join('; ')}>
                    ${t(`profile.ecosystem.validation.${r.validation}`)}
                  </span>`}
                <span class="pf-eco-dim">${t('profile.ecosystem.expiresIn', { n: Math.max(0, Math.round((r.expires_in || 0) / 60)) })}</span>
              </div>
              <div class="pf-eco-pending-grant">
                <label class="pf-eco-dim">${t('profile.ecosystem.grantLevel')}</label>
                <select class="pf-eco-select" onChange=${e => setPresetByCode(p => ({ ...p, [r.user_code]: e.target.value }))}>
                  <option value="standard" selected>${t('profile.ecosystem.presetStandard')}</option>
                  <option value="readonly">${t('profile.ecosystem.presetReadonly')}</option>
                  <option value="full">${t('profile.ecosystem.presetFull')}</option>
                </select>
                <button class="btn-success btn-sm" disabled=${r.validation === 'failed'} onClick=${() => onApprove(r.user_code)}>${t('profile.ecosystem.approve')}</button>
                <button class="btn-ghost btn-sm" onClick=${() => onDeny(r.user_code)}>${t('profile.ecosystem.deny')}</button>
              </div>
            </div>`)}
        </div>`}

      ${apps.length === 0
        ? html`<div class="pf-eco-empty">${t('profile.ecosystem.empty')}</div>`
        : apps.map(app => {
          const isOpen = expanded === app.geai;
          const appSubs = subs.filter(s => s.geai === app.geai);
          return html`
            <div class="pf-eco-card ${app.status === 'revoked' ? 'pf-eco-card-revoked' : ''}" key=${app.geai}>
              <div class="pf-eco-card-head" onClick=${() => toggleCard(app)}>
                <span class="pf-eco-caret">${isOpen ? '▼' : '▶'}</span>
                <span class="pf-eco-icon">🔌</span>
                <strong class="pf-eco-name">${app.display_name || app.app}</strong>
                <span class="pf-eco-mono">${app.geai}</span>
                <span class="pf-eco-status pf-eco-status-${app.status}">${t(`profile.ecosystem.status.${app.status}`)}</span>
                <span class="pf-eco-dim pf-eco-lastseen">${app.last_seen ? timeAgo(app.last_seen) : ''}</span>
              </div>
              ${isOpen && html`
                <div class="pf-eco-card-body">
                  ${app.status !== 'revoked' && html`<${EcoSetupPlaybook} app=${app} showToast=${showToast} />`}

                  <div class="pf-eco-section">
                    <div class="pf-eco-section-title">${t('profile.ecosystem.grants')}</div>
                    <div class="pf-eco-chips">
                      ${(app.scopes || []).map(s => html`<span class="pf-eco-chip" key=${s}>${s}</span>`)}
                    </div>
                    ${(app.data_areas || []).length > 0 && html`
                      <div class="pf-eco-areas">
                        ${app.data_areas.map((g, i) => html`
                          <div class="pf-eco-area" key=${i}>${g.area}: <span class="pf-eco-mono">${g.pattern}</span> (${(g.rights || []).join(', ')})</div>`)}
                      </div>`}
                  </div>

                  <div class="pf-eco-section">
                    <div class="pf-eco-section-title">${t('profile.ecosystem.subscriptions')}</div>
                    <p class="pf-eco-dim pf-eco-sub-direction">${t('profile.ecosystem.subscriptionsDirection')}</p>
                    ${appSubs.length === 0
                      ? html`<div class="pf-eco-dim">${t('profile.ecosystem.noSubs')}</div>`
                      : appSubs.map(s => html`
                        <div class="pf-eco-sub-row" key=${s.event + (s.createdAt || '')}>
                          <span class="pf-eco-mono">${s.event}</span>
                          ${s.match && html`<span class="pf-eco-dim">${JSON.stringify(s.match)}</span>`}
                          <button class="btn-ghost btn-sm" onClick=${() => onUnsubscribe(app.app, s.event)}>${t('profile.ecosystem.removeSub')}</button>
                        </div>`)}
                    ${app.status !== 'revoked' && html`
                      <div class="pf-eco-sub-add">
                        <select class="pf-eco-select" onChange=${e => setSubForm(f => ({ ...f, [app.app]: { event: e.target.value } }))}>
                          ${OUTBOUND_EVENTS.map(ev => html`<option value=${ev} key=${ev}>${ev}</option>`)}
                        </select>
                        <button class="btn-outline btn-sm" onClick=${() => onSubscribe(app.app)}>${t('profile.ecosystem.addSub')}</button>
                      </div>`}
                  </div>

                  <${EcoAutomationSection} app=${app} showToast=${showToast} />

                  <div class="pf-eco-section">
                    <div class="pf-eco-section-title">${t('profile.ecosystem.dataTitle')}</div>
                    ${appData[app.geai] === undefined
                      ? html`<div class="pf-eco-dim pf-eco-data-loading"><${Spinner} /> ${t('profile.ecosystem.dataLoading')}</div>`
                      : appData[app.geai].length === 0
                        ? html`<div class="pf-eco-dim">${t('profile.ecosystem.dataEmpty')}</div>`
                        : html`
                          <div class="pf-eco-data">
                            ${appData[app.geai].map(entry => html`
                              <${EcoDataEntry} entry=${entry} key=${entry.key} />`)}
                          </div>`}
                  </div>

                  <div class="pf-eco-section">
                    <div class="pf-eco-section-title">${t('profile.ecosystem.binding')}</div>
                    <div class="pf-eco-binding">
                      <div>${t('profile.ecosystem.aimeatSide')}: <span class="pf-eco-mono">${app.owner}</span></div>
                      <div>${t('profile.ecosystem.appOrigin')}: <span class="pf-eco-mono">${app.app}</span></div>
                      <div>${t('profile.ecosystem.keyFp')}: <span class="pf-eco-mono">${keyFp(app.public_key)}</span></div>
                      <p class="pf-eco-dim">${t('profile.ecosystem.bindingNote')}</p>
                    </div>
                    ${app.status !== 'revoked' && html`
                      <button class="btn-danger-solid btn-sm" onClick=${() => { setRevokeApp(app.app); setRevokeInput(''); }}>
                        ${t('profile.ecosystem.revoke')}
                      </button>`}
                  </div>
                </div>`}
            </div>`;
        })}

      <${Modal} open=${!!revokeApp} onClose=${() => setRevokeApp(null)} title=${t('profile.ecosystem.revokeTitle')}>
        <p>${t('profile.ecosystem.revokeWarn', { app: revokeApp })}</p>
        <input class="pf-eco-revoke-input" type="text" value=${revokeInput}
          placeholder=${revokeApp || ''} onInput=${e => setRevokeInput(e.target.value)} />
        <div class="pf-eco-revoke-actions">
          <button class="btn-ghost" onClick=${() => setRevokeApp(null)}>${t('common.cancel')}</button>
          <button class="btn-danger-solid" disabled=${revokeInput !== revokeApp} onClick=${onRevokeConfirm}>
            ${t('profile.ecosystem.revoke')}
          </button>
        </div>
      <//>
    </div>`;
}
