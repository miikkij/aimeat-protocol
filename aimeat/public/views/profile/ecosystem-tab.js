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
 *   v3.2.0 — 2026-07-13 — Split for max-file-lines: MOVED sub-components/helpers into relative sibling
 *     modules (ecosystem-tab.helpers.js — pure helpers/consts; ecosystem-tab.automation.js —
 *     EcoScheduleLog/EcoStatusChip/EcoAgentPicker/EcoAutomationSection; ecosystem-tab.cards.js —
 *     EcoDataEntry/EcoSetupGuide/EcoAskInClaude/EcoTechDetails). Behavior verbatim; this file keeps
 *     only the EcosystemTab default export.
 *   v3.1.0 — 2026-06-16 — RECOMMENDED AGENTS in the "③ Process with agent(s)" picker. The app DECLARES
 *     which agent(s) fit it best (manifest `automation.recommended_agents`: exact `name` and/or
 *     capability `match_tags` + a bilingual `why`). New <EcoAgentPicker> marks the owner's MATCHING
 *     agents "★ Suositeltu — <why>" and renders them FIRST (subtle highlight); the rest sit behind a
 *     collapsed "Näytä kaikki agentit" disclosure so the long list never overwhelms. Matching is by
 *     NAME or by overlap with the agent's tags/capabilities/technical_capabilities/domain_capabilities
 *     (from GET /v1/agents). When the app recommends an agent the owner hasn't connected, a hint names
 *     it + its why. Helpers: agentMatchStrings()/recommendationFor(). i18n: recommendedChip,
 *     showAllAgents, hideAllAgents, recommendedMissing (both locales). CSS pf-eco-rec-*. Frontend + i18n.
 *   v3.0.0 — 2026-06-16 — Card REDESIGN: the app's OWN bilingual Markdown setup guide (from its
 *     manifest `setup:{fi,en}`) is now what the card shows the user. REMOVED the hardcoded
 *     <EcoSetupPlaybook> (the 4-step checklist + its gotoAgents Agents-tab dump). Added
 *     <EcoSetupGuide> — renders app.setup[locale] (locale via getLocale(), fallback en→fi) as safe
 *     Markdown via the shared <Markdown>, with a graceful note when an app onboarded before this
 *     field (re-connect to load one). PULLED the MCP "Ask in Claude" promo OUT of the playbook into
 *     its OWN separate <EcoAskInClaude> section (a distinct capability: you query the produced
 *     analysis yourself over MCP, not part of the automated pipeline). The expanded card now reads
 *     top→bottom: header+value → setup guide → automation → ask in Claude → data → tech details →
 *     disconnect. Frontend + i18n only.
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
 *   v2.3.0 — 2026-06-16 — Fix the MCP promo sample prompt: it no longer guesses a raw owner-scoped
 *     memory key (`eco.<app>.<org>.latest`) the AI-chat principal can't read. It now targets the
 *     recipe's chosen ORGANISM by its resolved human NAME (where the agent's report actually lands and
 *     which an owner/member CAN read over MCP) — "open my '<Organism>' organism, read the latest
 *     analysis, add follow-up notes". When no organism is set yet it shows a "pick an organism first"
 *     hint instead of a broken prompt, plus an honest access note. EcoSetupPlaybook now loads the
 *     owner's organisms to resolve id→name. Removed sampleMemoryKey/ownerOrgName + the raw-key i18n
 *     (mcpSamplePrompt/mcpSampleOrganismFallback/mcpSampleGeneric). Frontend + i18n only.
 *   v2.2.0 — 2026-06-15 — NON-TECHNICAL card redesign (value-first + hide the plumbing). The expanded
 *     card is reordered human-first: friendly name + an "yhdistetty sinuna" subtitle (the scary raw
 *     `eco:…` principal string is REMOVED from the header), a one-line value statement (appValueLine),
 *     then the value-first Setup playbook → Automation → "what this app saved" → an accessible plain
 *     "Poista yhteys" disconnect. All the plumbing — the GEAI principal, raw grants/scopes (incl. `*`),
 *     event subscriptions and the binding — is relocated into ONE new collapsed <EcoTechDetails>
 *     ("Tekniset tiedot") disclosure with a subtly distinct faint background + 🔧 label at the very
 *     bottom. Subscribe/unsubscribe still work, just relocated. Copy is reworded benefit-first in i18n
 *     (no "resepti", no raw scope strings in the human area). Frontend + i18n only; no backend logic.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { Modal } from '/components/Modal.js';
import { Spinner } from './shared.js';
import { listEcosystemApps, listAppData, listPending, approve, revoke, listSubscriptions, subscribe, unsubscribe } from '/js/services/ecosystem.js';
import { ECO_PRESETS } from './ecosystem-tab.helpers.js';
import { EcoAutomationSection } from './ecosystem-tab.automation.js';
import { EcoDataEntry, EcoSetupGuide, EcoAskInClaude, EcoTechDetails } from './ecosystem-tab.cards.js';
import { swallowed } from '/js/swallowed.js';

export default function EcosystemTab({ onStats, showToast }) {
  const [apps, setApps] = useState([]);
  const [pending, setPending] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
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
    } catch (err) {
      // Leave the cached value (if any); a transient failure shouldn't blank the section.
      swallowed('ecosystem-tab: loadAppData', err);
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
    } catch (err) {
      swallowed('ecosystem-tab: loadData', err);
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
    // Push-only (no steady-state poll): react to ecosystem/app, agent, onboarding, and
    // memory (written-data) changes. The open card's written data updates on these events,
    // without collapsing the entry. Reconnect catch-up (live-updates.js) backstops gaps.
    return onLiveUpdate(['ecosystem-apps', 'agents', 'agent-onboarding', 'memory'], handler);
  }, []);

  async function onApprove(userCode) {
    const preset = presetByCode[userCode] || 'standard';
    try {
      await approve(userCode, { action: 'approve', scopes: ECO_PRESETS[preset] });
      showToast?.(t('profile.ecosystem.approved'), 'success');
      await loadData();
    } catch (err) { swallowed('ecosystem-tab', err); showToast?.(t('profile.ecosystem.approveError'), 'error'); }
  }
  async function onDeny(userCode) {
    try { await approve(userCode, { action: 'deny' }); await loadData(); }
    catch (err) { swallowed('ecosystem-tab', err); showToast?.(t('profile.ecosystem.approveError'), 'error'); }
  }
  async function onRevokeConfirm() {
    const app = revokeApp;
    setRevokeApp(null); setRevokeInput('');
    try { await revoke(app); showToast?.(t('profile.ecosystem.revoked'), 'success'); await loadData(); }
    catch (err) { swallowed('ecosystem-tab', err); showToast?.(t('profile.ecosystem.revokeError'), 'error'); }
  }
  async function onSubscribe(app) {
    const event = subForm[app]?.event || 'memory.write';
    try { await subscribe(app, event); setSubForm(f => ({ ...f, [app]: {} })); await loadData(); }
    catch (err) { swallowed('ecosystem-tab', err); showToast?.(t('profile.ecosystem.subError'), 'error'); }
  }
  async function onUnsubscribe(app, event) {
    try { await unsubscribe(app, event); await loadData(); }
    catch (err) { swallowed('ecosystem-tab', err); showToast?.(t('profile.ecosystem.subError'), 'error'); }
  }

  if (loading) return html`<div class="pf-eco"><${Spinner} /></div>`;

  return html`
    <div class="pf-eco">
      <div class="pf-eco-head">
        <h3 class="section-title">
          ${t('profile.ecosystem.title')} <span class="pf-eco-count-badge">${apps.length}</span>
        </h3>
      </div>
      <p class="section-desc">${t('profile.ecosystem.desc')}</p>

      ${pending.length > 0 && html`
        <div class="pf-eco-pending">
          <div class="pf-eco-pending-title">${t('profile.ecosystem.pendingTitle')}</div>
          <p class="pf-eco-dim pf-eco-pending-hint">${t('profile.ecosystem.pendingHint')}</p>
          ${pending.map(r => html`
            <div class="pf-eco-pending-row" key=${r.user_code}>
              <div class="pf-eco-pending-info">
                <strong>${r.display_name || r.app}</strong>
                ${r.user_code && html`<span class="pf-eco-pending-code">${t('profile.ecosystem.pendingCode')} <strong>${r.user_code}</strong></span>`}
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
        ? html`<div class="pf-eco-empty">
            <p>${t('profile.ecosystem.empty')}</p>
            <p class="pf-eco-empty-note">${t('profile.ecosystem.connectNote')}</p>
          </div>`
        : apps.map(app => {
          const isOpen = expanded === app.geai;
          const appSubs = subs.filter(s => s.geai === app.geai);
          return html`
            <div class="pf-eco-card ${app.status === 'revoked' ? 'pf-eco-card-revoked' : ''}" key=${app.geai}>
              <div class="pf-eco-card-head" onClick=${() => toggleCard(app)}>
                <span class="pf-eco-caret">${isOpen ? '▼' : '▶'}</span>
                <span class="pf-eco-icon">🔌</span>
                <span class="pf-eco-head-title">
                  <strong class="pf-eco-name">${app.display_name || app.app}</strong>
                  ${app.owner && html`<span class="pf-eco-dim pf-eco-head-owner">${t('profile.ecosystem.connectedAsYou', { owner: app.owner })}</span>`}
                </span>
                <span class="pf-eco-status pf-eco-status-${app.status}">${t(`profile.ecosystem.status.${app.status}`)}</span>
                <span class="pf-eco-dim pf-eco-lastseen">${app.last_seen ? timeAgo(app.last_seen) : ''}</span>
              </div>
              ${isOpen && html`
                <div class="pf-eco-card-body">
                  <p class="pf-eco-value-line">${t('profile.ecosystem.appValueLine')}</p>

                  ${app.status !== 'revoked' && html`<${EcoSetupGuide} app=${app} />`}

                  <${EcoAutomationSection} app=${app} showToast=${showToast} />

                  ${app.status !== 'revoked' && html`<${EcoAskInClaude} app=${app} />`}

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

                  ${app.status !== 'revoked' && html`
                    <div class="pf-eco-section pf-eco-disconnect">
                      <div class="pf-eco-section-title">${t('profile.ecosystem.disconnectTitle')}</div>
                      <p class="pf-eco-dim pf-eco-disconnect-hint">${t('profile.ecosystem.disconnectHint')}</p>
                      <button class="btn-danger-solid btn-sm" onClick=${() => { setRevokeApp(app.app); setRevokeInput(''); }}>
                        ${t('profile.ecosystem.disconnect')}
                      </button>
                    </div>`}

                  <${EcoTechDetails} app=${app} appSubs=${appSubs}
                    onUnsubscribe=${onUnsubscribe} onSubscribe=${onSubscribe}
                    subForm=${subForm} setSubForm=${setSubForm} />
                </div>`}
            </div>`;
        })}

      <${Modal} open=${!!revokeApp} onClose=${() => setRevokeApp(null)} title=${t('profile.ecosystem.revokeTitle', { app: revokeApp || '' })}>
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
