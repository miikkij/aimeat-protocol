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
import { listEcosystemApps, listAppData, listPending, approve, revoke, listSubscriptions, subscribe, unsubscribe } from '/js/services/ecosystem.js';
import { formatUntil } from './schedule-item.js';
import { listAppSchedules, createCapabilitySchedule, setScheduleEnabled, deleteSchedule, triggerSchedule } from '/js/services/schedules.js';

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

/** Human label for a cron — one of the known cadences, else the raw cron string. */
function cronLabel(cron) {
  const key = CRON_TO_CADENCE[cron];
  return key ? t(`profile.ecosystem.automationCadence_${key}`) : cron;
}

/**
 * The "Automation" section of one expanded GEAI card: per-capability cadence +
 * enable toggle, and the list of the app's existing eco-capability schedules.
 * Lazy-loads on first expand and refreshes on the live-update event.
 */
function EcoAutomationSection({ app, showToast }) {
  const [schedules, setSchedules] = useState(undefined); // undefined = never loaded
  const [cadenceByCap, setCadenceByCap] = useState({});  // capabilityId → cadence key
  const [busy, setBusy] = useState({});                  // capabilityId/scheduleId → bool

  const caps = app.capabilities || [];
  // automation.schedulable[].cadences may restrict which cadences a capability allows.
  const schedulable = (app.automation && app.automation.schedulable) || [];
  const schedHint = Object.fromEntries(schedulable.map(s => [s.id, s]));

  const load = async () => {
    try {
      const list = await listAppSchedules(app.app);
      setSchedules(list);
    } catch (e) {
      setSchedules(s => (s === undefined ? [] : s));
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    load();
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [app.app]);

  // Allowed cadences for a capability (restricted by automation hint, else all three).
  function allowedCadences(capId) {
    const allow = schedHint[capId] && Array.isArray(schedHint[capId].cadences) ? schedHint[capId].cadences : null;
    return allow ? CADENCES.filter(c => allow.includes(c.key)) : CADENCES;
  }

  async function onEnable(capId) {
    const allowed = allowedCadences(capId);
    const cadenceKey = cadenceByCap[capId] || (allowed[0] && allowed[0].key) || 'weekly';
    const cron = (CADENCES.find(c => c.key === cadenceKey) || CADENCES[0]).cron;
    setBusy(b => ({ ...b, [capId]: true }));
    try {
      await createCapabilitySchedule(app.app, capId, cron, { displayName: `${app.display_name || app.app} · ${capId}` });
      showToast?.(t('profile.ecosystem.automationCreated'), 'success');
      await load();
    } catch (e) {
      showToast?.(t('profile.ecosystem.automationError'), 'error');
    } finally {
      setBusy(b => ({ ...b, [capId]: false }));
    }
  }

  async function onToggle(job) {
    setBusy(b => ({ ...b, [job.id]: true }));
    try {
      await setScheduleEnabled(job.id, !job.enabled);
      await load();
    } catch (e) {
      showToast?.(t('profile.ecosystem.automationError'), 'error');
    } finally {
      setBusy(b => ({ ...b, [job.id]: false }));
    }
  }

  async function onRunNow(job) {
    setBusy(b => ({ ...b, [job.id]: true }));
    try {
      await triggerSchedule(job.id);
      showToast?.(t('profile.ecosystem.automationTriggered'), 'success');
      await load();
    } catch (e) {
      showToast?.(t('profile.ecosystem.automationError'), 'error');
    } finally {
      setBusy(b => ({ ...b, [job.id]: false }));
    }
  }

  async function onDelete(job) {
    setBusy(b => ({ ...b, [job.id]: true }));
    try {
      await deleteSchedule(job.id);
      await load();
    } catch (e) {
      showToast?.(t('profile.ecosystem.automationError'), 'error');
    } finally {
      setBusy(b => ({ ...b, [job.id]: false }));
    }
  }

  const revoked = app.status === 'revoked';

  return html`
    <div class="pf-eco-section">
      <div class="pf-eco-section-title">${t('profile.ecosystem.automationTitle')}</div>
      <p class="pf-eco-dim pf-eco-auto-intro">${t('profile.ecosystem.automationIntro')}</p>

      ${!revoked && (caps.length === 0
        ? html`<div class="pf-eco-dim">${t('profile.ecosystem.automationNoCaps')}</div>`
        : html`
          <div class="pf-eco-auto-caps">
            ${caps.map(cap => {
              const allowed = allowedCadences(cap.id);
              const selected = cadenceByCap[cap.id] || (allowed[0] && allowed[0].key) || '';
              return html`
                <div class="pf-eco-auto-cap" key=${cap.id}>
                  <span class="pf-eco-mono pf-eco-auto-cap-id">${cap.id}</span>
                  <select class="pf-eco-select pf-eco-auto-cadence"
                    value=${selected}
                    onChange=${e => setCadenceByCap(m => ({ ...m, [cap.id]: e.target.value }))}>
                    ${allowed.map(c => html`<option value=${c.key} key=${c.key}>${t(`profile.ecosystem.automationCadence_${c.key}`)}</option>`)}
                  </select>
                  <button class="btn-outline btn-sm" disabled=${!!busy[cap.id]} onClick=${() => onEnable(cap.id)}>
                    ${t('profile.ecosystem.automationEnable')}
                  </button>
                </div>`;
            })}
          </div>`)}

      <div class="pf-eco-auto-list">
        ${schedules === undefined
          ? html`<div class="pf-eco-dim pf-eco-data-loading"><${Spinner} /> ${t('profile.ecosystem.automationLoading')}</div>`
          : schedules.length === 0
            ? html`<div class="pf-eco-dim">${t('profile.ecosystem.automationEmpty')}</div>`
            : schedules.map(job => html`
              <div class="pf-eco-auto-job ${job.enabled ? '' : 'pf-eco-auto-job-off'}" key=${job.id}>
                <div class="pf-eco-auto-job-main">
                  <span class="pf-eco-mono pf-eco-auto-job-cap">${job.input?.capability_id || ''}</span>
                  <span class="pf-eco-chip pf-eco-auto-cadence-chip">${cronLabel(job.cron)}</span>
                  <span class="pf-eco-chip ${job.enabled ? 'pf-eco-auto-on' : 'pf-eco-auto-paused'}">
                    ${job.enabled ? t('profile.ecosystem.automationOn') : t('profile.ecosystem.automationPaused')}
                  </span>
                </div>
                <div class="pf-eco-auto-job-meta">
                  <span class="pf-eco-dim">
                    ${t('profile.ecosystem.automationLastRun')}: ${job.lastRunAt
                      ? html`${timeAgo(job.lastRunAt)}${job.lastRunResult ? html` · <span class="pf-eco-auto-result-${job.lastRunResult}">${job.lastRunResult}</span>` : ''}`
                      : '—'}
                  </span>
                  <span class="pf-eco-dim">${t('profile.ecosystem.automationNextRun')}: ${job.enabled ? formatUntil(job.nextRunAt) : '—'}</span>
                </div>
                <div class="pf-eco-auto-job-actions">
                  <button class="btn-ghost btn-sm" disabled=${!!busy[job.id]} onClick=${() => onRunNow(job)}>${t('profile.ecosystem.automationRunNow')}</button>
                  <button class="btn-ghost btn-sm" disabled=${!!busy[job.id]} onClick=${() => onToggle(job)}>
                    ${job.enabled ? t('profile.ecosystem.automationDisable') : t('profile.ecosystem.automationEnable')}
                  </button>
                  <button class="btn-ghost btn-sm pf-eco-auto-del" disabled=${!!busy[job.id]} title=${t('profile.ecosystem.automationDelete')} onClick=${() => onDelete(job)}>✕</button>
                </div>
              </div>`)}
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
