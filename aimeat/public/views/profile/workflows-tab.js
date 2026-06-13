/**
 * @file workflows-tab.js
 * @description Profile › Workflows — the owner-facing surface for Agent Workflows (declared, ordered
 *   agent pipelines with per-step input/output signals). Three views: a list of workflows with a
 *   health sparkline; a detail view showing the derived blueprint (the "whole workflow" graph) + the
 *   recent runs; and a single-run view with the per-step timeline (state + expected-vs-observed).
 *   Run-now offers a signals-only health check or a full live run. Reads the /v1/workflows API; the
 *   deterministic engine is node-owned. See docs/plans/2026-06-13-agent-workflows-node-plan.md §12.
 * @structure WorkflowsTab (default) — view state machine (list | detail | run)
 * @usage Registered in profile.js TABS as { id:'workflows', component: WorkflowsTab }.
 * @version-history
 *   v1.0.0 -- 2026-06-13 -- Phase 9: list + blueprint + runs + run-now + health.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { listWorkflows, getBlueprint, getHealth, listRuns, getRun, runWorkflow } from '/js/services/workflows.js';

const html = htm.bind(h);

/** Pick a display string from a localized value (string | { locale: text }). */
function loc(s) {
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.en_US || s.fi_FI || Object.values(s)[0] || '';
}

function triggerSummary(trigger) {
  if (!trigger) return '';
  if (trigger.kind === 'schedule') return `${t('profile.workflows.trigger.schedule')} · ${trigger.cron}${trigger.timezone ? ` (${trigger.timezone})` : ''}`;
  if (trigger.kind === 'event') return `${t('profile.workflows.trigger.event')} · ${trigger.on}`;
  return t('profile.workflows.trigger.manual');
}

/** Map a run/step status to a badge CSS modifier. */
function statusClass(status) {
  if (status === 'done' || status === 'green') return 'wf-badge--ok';
  if (status === 'partial' || status === 'red' || (typeof status === 'string' && status.endsWith('-red')) || status === 'timed-out') return 'wf-badge--err';
  if (status === 'skipped') return 'wf-badge--muted';
  return 'wf-badge--run';
}

function StatusBadge({ status }) {
  if (!status) return html`<span class="wf-muted">—</span>`;
  return html`<span class="wf-badge ${statusClass(status)}">${status}</span>`;
}

/** A tiny sparkline of the last-N run states for one step (green/red bars). */
function Sparkline({ steps }) {
  if (!steps || steps.length === 0) return html`<span class="wf-muted">—</span>`;
  return html`<span class="wf-spark" title=${t('profile.workflows.health.title')}>
    ${steps.map(s => {
      const total = s.green + s.red;
      const cls = total === 0 ? 'wf-spark-bar--none' : s.red > 0 ? 'wf-spark-bar--err' : 'wf-spark-bar--ok';
      return html`<span class="wf-spark-bar ${cls}" title=${`${s.stepId}: ${s.green}✓ / ${s.red}✗`}></span>`;
    })}
  </span>`;
}

export default function WorkflowsTab({ showToast }) {
  // view: { name:'list' } | { name:'detail', id } | { name:'run', id, runId }
  const [view, setView] = useState({ name: 'list' });
  const [items, setItems] = useState([]); // [{ def, health }]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadList = useCallback(async () => {
    try {
      const res = await listWorkflows();
      const defs = res?.data?.workflows || [];
      const withHealth = await Promise.all(defs.map(async (def) => {
        const hr = await getHealth(def.id).catch(() => null);
        return { def, health: hr?.data || null };
      }));
      setItems(withHealth);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRef = useRef(loadList);
  loadRef.current = loadList;
  useEffect(() => {
    loadList();
    const handler = () => { if (view.name === 'list') loadRef.current(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadList, view.name]);

  const doRun = async (id, mode) => {
    try {
      const res = await runWorkflow(id, mode);
      const runId = res?.data?.runId;
      showToast?.(t('profile.workflows.runStarted'), 'success');
      if (runId) setView({ name: 'run', id, runId });
      else loadList();
    } catch (e) {
      showToast?.(e.message || 'Run failed', 'error');
    }
  };

  if (loading) return html`<div class="wf-loading">${t('profile.workflows.loading')}</div>`;
  if (view.name === 'detail') return html`<${DetailView} id=${view.id} onBack=${() => { setView({ name: 'list' }); loadList(); }} onOpenRun=${(runId) => setView({ name: 'run', id: view.id, runId })} onRun=${doRun} />`;
  if (view.name === 'run') return html`<${RunView} id=${view.id} runId=${view.runId} onBack=${() => setView({ name: 'detail', id: view.id })} />`;

  // ── list ──
  return html`
    <div class="wf-tab">
      <div class="wf-head">
        <div>
          <div class="section-title">${t('profile.workflows.title')}</div>
          <div class="section-desc">${t('profile.workflows.desc')}</div>
        </div>
      </div>
      ${error && html`<div class="wf-error">${error}</div>`}
      ${items.length === 0
        ? html`<div class="wf-empty">${t('profile.workflows.empty')}</div>`
        : html`<div class="wf-card-list">
            ${items.map(({ def, health }) => html`
              <div class="wf-card" key=${def.id}>
                <div class="wf-card-main" onClick=${() => setView({ name: 'detail', id: def.id })}>
                  <div class="wf-card-title">
                    ${loc(def.title) || def.id}
                    <${StatusBadge} status=${health?.lastStatus} />
                  </div>
                  <div class="wf-card-meta">${triggerSummary(def.trigger)}</div>
                  <div class="wf-card-meta">
                    ${t('profile.workflows.stepCount', { count: def.steps?.length || 0 })}
                    ${health?.lastRunAt ? html` · ${t('profile.workflows.lastRun')} ${timeAgo(health.lastRunAt)}` : ''}
                  </div>
                  <${Sparkline} steps=${health?.steps} />
                </div>
                <div class="wf-card-actions">
                  <button class="btn-outline" onClick=${() => doRun(def.id, 'signals-only')}>${t('profile.workflows.check')}</button>
                  <button class="btn-primary" onClick=${() => doRun(def.id, 'full')}>${t('profile.workflows.run')}</button>
                </div>
              </div>`)}
          </div>`}
    </div>`;
}

// ── Detail: blueprint + recent runs ─────────────────────────────────────────────
function DetailView({ id, onBack, onOpenRun, onRun }) {
  const [blueprint, setBlueprint] = useState(null);
  const [runs, setRuns] = useState([]);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    const [bp, rr] = await Promise.all([getBlueprint(id).catch(e => ({ _err: e.message })), listRuns(id).catch(() => null)]);
    if (bp?._err) setErr(bp._err); else setBlueprint(bp?.data || null);
    setRuns(rr?.data?.runs || []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  return html`
    <div class="wf-tab">
      <div class="wf-detail-head">
        <button class="btn-ghost" onClick=${onBack}>← ${t('profile.workflows.back')}</button>
        <div class="wf-detail-title">${id}</div>
        <div class="wf-detail-actions">
          <button class="btn-outline" onClick=${() => onRun(id, 'signals-only')}>${t('profile.workflows.check')}</button>
          <button class="btn-primary" onClick=${() => onRun(id, 'full')}>${t('profile.workflows.run')}</button>
        </div>
      </div>

      ${err && html`<div class="wf-error">${err}</div>`}

      <div class="wf-section-title">${t('profile.workflows.blueprint')}</div>
      ${blueprint && html`<div class="wf-graph">
        ${blueprint.nodes.map(n => html`<div class="wf-node" key=${n.stepId}>
          <div class="wf-node-id">${n.stepId}</div>
          <div class="wf-node-agent">${(n.agents || []).join(', ')} · ${n.offerId}</div>
          ${n.reads.length > 0 && html`<div class="wf-node-io">↘ ${n.reads.join(', ')}</div>`}
          ${n.writes.length > 0 && html`<div class="wf-node-io">↗ ${n.writes.join(', ')}</div>`}
          ${(() => {
            const deps = (blueprint.edges || []).filter(e => e.to === n.stepId).map(e => e.from);
            return deps.length > 0 ? html`<div class="wf-node-dep">${t('profile.workflows.after')}: ${deps.join(', ')}</div>` : '';
          })()}
        </div>`)}
      </div>`}

      <div class="wf-section-title">${t('profile.workflows.recentRuns')}</div>
      ${runs.length === 0
        ? html`<div class="wf-empty">${t('profile.workflows.noRuns')}</div>`
        : html`<table class="wf-table"><tbody>
            ${runs.map(r => html`<tr key=${r.runId} class="wf-run-row" onClick=${() => onOpenRun(r.runId)}>
              <td>${timeAgo(r.startedAt)}</td>
              <td><${StatusBadge} status=${r.status} /></td>
              <td class="wf-muted">${r.mode}</td>
            </tr>`)}
          </tbody></table>`}
    </div>`;
}

// ── Run: per-step timeline ──────────────────────────────────────────────────────
function RunView({ id, runId, onBack }) {
  const [run, setRun] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getRun(id, runId).then(r => setRun(r?.data || null)).catch(e => setErr(e.message)); }, [id, runId]);

  return html`
    <div class="wf-tab">
      <div class="wf-detail-head">
        <button class="btn-ghost" onClick=${onBack}>← ${t('profile.workflows.back')}</button>
        <div class="wf-detail-title">${t('profile.workflows.run')} · ${run ? timeAgo(run.startedAt) : runId.slice(0, 8)}</div>
        ${run && html`<${StatusBadge} status=${run.status} />`}
      </div>
      ${err && html`<div class="wf-error">${err}</div>`}
      ${run && html`<div class="wf-steps">
        ${Object.entries(run.steps).map(([stepId, s]) => html`<div class="wf-step" key=${stepId}>
          <div class="wf-step-row">
            <${StatusBadge} status=${s.state} />
            <span class="wf-step-id">${stepId}</span>
            ${s.reads?.length > 0 && html`<span class="wf-muted">↘ ${s.reads.length}</span>`}
            ${s.writes?.length > 0 && html`<span class="wf-muted">↗ ${s.writes.length}</span>`}
            ${s.attempt > 0 && html`<span class="wf-muted">${t('profile.workflows.attempt')} ${s.attempt + 1}</span>`}
          </div>
          ${(s.outputObserved || s.inputObserved) && html`<pre class="wf-observed">${JSON.stringify(s.outputObserved || s.inputObserved, null, 2)}</pre>`}
        </div>`)}
        ${(run.inspections || []).length > 0 && html`<div class="wf-inspections">${t('profile.workflows.inspectorDispatched', { count: run.inspections.length })}</div>`}
      </div>`}
    </div>`;
}
