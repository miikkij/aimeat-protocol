/**
 * @file agent-integration-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Agent integration page in the poster face (design canvas "AIMEAT
 *   Admin Agent integration"). Four sections: which tool each agent came from, how far the ones
 *   getting set up have come, how far the finished ones got, and which skill bundle each agent is
 *   handed. The reads are the same three routes as before; what changed is which of their numbers
 *   the page believes.
 *
 * @structure
 *   - AgentIntegrationTab (default): loads the three reads, renders the four sections
 *   - PlatformRegistry: the unrecognised headline, one row per platform, share of every agent
 *   - GettingSetUp: the four counters, and one row per stuck run with its two actions
 *   - StuckRun: a single stuck run — what it waits at, what that usually means, remind and skip
 *   - Readiness: the four score bands over the runs that finished
 *   - Bundles: one row per bundle that an agent actually asks for
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face, and three things the old screen showed as if they
 *     worked: "Not started" read onboarding.not_started while the route sends `pending`, so it was
 *     always 0; the readiness bars divided by completed + in progress + not started while counting
 *     only completed runs, so every bar read short and the footer called that sum the total; and
 *     "Regenerate all bundles" answered queued and did nothing, so it is gone, with the Notify
 *     button and the Bundle templates stub beside it (two "coming soon" buttons and three counters
 *     that were 0, 0 and --). The bundle rows are built from the platform registry, which carries
 *     the bundle name; /v1/admin/skill-bundles buckets an unknown platform as `generic` while the
 *     registry buckets it as `other`, and only one of the two can be right on one screen. The Add
 *     platform form is gone: the route it posted to keeps custom platforms in a module array that
 *     no detection path reads and no restart survives.
 *   v1.3.0 -- 2026-06-02 -- Admin design unification: main btn-* classes → adm-btn /
 *     adm-btn-action; the bespoke adm-agi-stat-card stat rows → canonical <StatsGrid>
 *     (tones success→green, accent→indigo). adm-agi-mono-sm retained (table cells).
 *   v1.2.0 -- 2026-05-24 -- Move readiness into onboarding, add bundle templates, add notify button
 *   v1.1.0 -- 2026-05-24 -- Fix M8 M9 F19 F20 F21 audit findings
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, Spinner } from './shared.js';
import * as api from '/js/services/admin-agent-integration.js';
import { swallowed } from '/js/swallowed.js';

const S = (key, params) => t('admin.agi.' + key, params);

/** A share of the whole, to one decimal, for a column that names its own maximum. */
function share(n, total) {
  if (!total) return '0 %';
  return `${(n / total * 100).toFixed(1)} %`;
}

/** The day a row is dated by. The hour matters on a stuck run, so it keeps its full stamp. */
function day(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (err) { swallowed('agent-integration: day', err); return ''; }
}

export default function AgentIntegrationTab({ session }) {
  useViewCSS('/css/views/admin-agent-integration.css');
  const [platforms, setPlatforms] = useState([]);
  const [totalAgents, setTotalAgents] = useState(0);
  const [onboarding, setOnboarding] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!session) return;
    try {
      const [platRes, onbRes, readRes] = await Promise.all([
        api.getPlatforms(session),
        api.getOnboardingOverview(session),
        api.getReadinessDistribution(session),
      ]);
      setPlatforms(platRes.data?.platforms || []);
      // The agent count comes from the route, which counts agents. Adding up the rows it drew was
      // what made the page report 76 agents on a node that holds 143.
      setTotalAgents(platRes.data?.total_agents ?? 0);
      setOnboarding(onbRes.data || null);
      setReadiness(readRes.data || null);
    } catch (err) { swallowed('agent-integration-tab: loadData', err); }
    setLoading(false);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => onLiveUpdate(['agents', 'agent-onboarding'], () => loadData()), [loadData]);

  if (loading) return html`<div class="og adm-agi"><${Spinner} /></div>`;

  return html`
    <div class="og adm-agi">
      <${PlatformRegistry} platforms=${platforms} totalAgents=${totalAgents} />
      <${GettingSetUp} onboarding=${onboarding} session=${session} onAction=${loadData} />
      <${Readiness} readiness=${readiness} />
      <${Bundles} platforms=${platforms} totalAgents=${totalAgents} />
    </div>
  `;
}

/* ── 01 · Which tool each agent came from ────────────────────────────────────────────────────── */

function PlatformRegistry({ platforms, totalAgents }) {
  // "Recognised" means a pattern in the registry matched. `other` is the bucket for everything
  // else, and a self-reported id is a name the agent typed that no pattern knows.
  const recognised = platforms
    .filter(p => p.id !== 'other' && !p.self_reported)
    .reduce((sum, p) => sum + (p.agent_count || 0), 0);
  const unrecognised = Math.max(totalAgents - recognised, 0);
  const withAgents = platforms.filter(p => (p.agent_count || 0) > 0).length;

  if (platforms.length === 0) {
    return html`<section class="og-sec og-sec--first">
      <div class="og-sec-h"><h2>${S('regTitle')}<small>01</small></h2></div>
      <p class="adm-agi-lead">${S('regEmpty')}</p>
    </section>`;
  }

  return html`
    <section class="og-sec og-sec--first">
      <div class="og-sec-h"><h2>${S('regTitle')}<small>01</small></h2></div>

      <div class="adm-agi-top">
        <div>
          <div class="adm-agi-lbl">${S('regHeroLabel')}</div>
          <div class="adm-agi-hero">${S('regHero', { n: num(unrecognised), total: num(totalAgents) })}</div>
          <p class="adm-agi-hero-sub">${S('regHeroSub')}</p>
        </div>
        <div><p class="adm-agi-lead">${S('regLead')}</p></div>
      </div>

      <div class="adm-agi-rows">
        <div class="adm-agi-hrow">
          <span>${S('colPlatform')}</span>
          <span class="r">${S('colAgents')}</span>
          <span>${S('colBundle')}</span>
          <span>${S('colRecognisedBy')}</span>
          <span>${S('colShare', { total: num(totalAgents) })}</span>
        </div>
        ${platforms.map(p => {
    const count = p.agent_count || 0;
    return html`
          <div class="adm-agi-row ${count === 0 ? 'is-none' : ''}" key=${p.id}>
            <span class="adm-agi-name">${p.display_name}<em>${p.id}</em></span>
            <span class="adm-agi-n r">${num(count)}</span>
            <span class="adm-agi-mono">${p.bundle_name}</span>
            <span class="adm-agi-mono">${p.self_reported
    ? S('recSelfReported')
    : p.id === 'other' ? S('recNothing') : p.detect_pattern}</span>
            <span class="adm-agi-bar">${count > 0
    ? html`<i style="width: ${Math.min(count / (totalAgents || 1) * 100, 100)}%"></i>`
    : null}</span>
          </div>`;
  })}
      </div>
      <div class="adm-agi-foot">
        <span>${S('regFoot', { agents: num(totalAgents), used: num(withAgents), rows: num(platforms.length) })}</span>
      </div>
    </section>
  `;
}

/* ── 02 · Getting set up ─────────────────────────────────────────────────────────────────────── */

function GettingSetUp({ onboarding, session, onAction }) {
  if (!onboarding) return null;
  const stuck = onboarding.stuck || [];
  const completed = onboarding.completed || 0;
  const inProgress = onboarding.in_progress || 0;
  // `pending` is the field the route sends. The old page read `not_started`, which nothing sends,
  // so this counter was 0 on every node whatever was waiting.
  const waiting = onboarding.pending || 0;

  return html`
    <section class="og-sec">
      <div class="og-sec-h"><h2>${S('setupTitle')}<small>02</small></h2></div>

      <div class="og-strip">
        <div><b>${num(completed)}</b><span>${S('cntFinished')}</span><small>${S('cntFinishedSub')}</small></div>
        <div><b>${num(inProgress)}</b><span>${S('cntPartway')}</span><small>${S('cntPartwaySub')}</small></div>
        <div><b>${num(waiting)}</b><span>${S('cntWaiting')}</span><small>${S('cntWaitingSub')}</small></div>
        <div class="adm-agi-cnt-stuck"><b>${num(stuck.length)}</b><span>${S('cntStuck')}</span><small>${S('cntStuckSub')}</small></div>
      </div>

      <p class="adm-agi-lead">${S('setupLead')}</p>

      ${stuck.length === 0
    ? html`<p class="adm-agi-note">${S('setupNoneStuck')}</p>`
    : html`<div class="adm-agi-stuck">
          ${stuck.map(s => html`<${StuckRun} run=${s} session=${session} onAction=${onAction} key=${s.agent_gaii} />`)}
        </div>`}
    </section>
  `;
}

function StuckRun({ run, session, onAction }) {
  const [acting, setActing] = useState(false);
  const [failed, setFailed] = useState(null);

  const act = async (fn, what) => {
    setActing(true);
    setFailed(null);
    try {
      await fn();
      onAction();
    } catch (err) {
      swallowed('agent-integration: ' + what, err);
      setFailed(err?.message || String(err));
    }
    setActing(false);
  };

  return html`
    <div class="adm-agi-srow">
      <span class="adm-agi-sname">${run.agent_gaii}
        <span class="adm-agi-sstep">${S('waitingAt', { step: run.current_step })}</span>
      </span>
      <span class="adm-agi-swhy">${meaningOf(run.current_step_id)}
        <span class="adm-agi-swhen">${run.never_moved
    ? S('startedNoStep', { day: day(run.stuck_since) })
    : S('lastStep', { when: dt(run.stuck_since) })}</span>
        ${failed && html`<span class="adm-agi-serr">${failed}</span>`}
      </span>
      <span class="adm-agi-sacts">
        <button type="button" class="adm-agi-sdoor" disabled=${acting}
          onClick=${() => act(() => api.sendReminder(session, run.agent_gaii), 'remind')}>${S('remind')}</button>
        ${run.current_step_id && html`
          <button type="button" class="adm-agi-sdoor" disabled=${acting}
            onClick=${() => act(() => api.skipOnboardingStep(session, run.agent_gaii, run.current_step_id), 'skip')}>${S('skip')}</button>`}
      </span>
    </div>
  `;
}

/** What waiting at this step usually means, keyed on the step's own id. */
function meaningOf(stepId) {
  const known = ['install_skill', 'configure_delivery', 'identify_platform', 'accept_test_task',
    'complete_test_task', 'read_directives', 'report_capabilities', 'send_test_message',
    'report_telemetry'];
  return known.includes(stepId) ? S('meaning.' + stepId) : S('meaning.other');
}

/* ── 03 · How far the finished ones got ──────────────────────────────────────────────────────── */

function Readiness({ readiness }) {
  const dist = readiness?.distribution || {};
  // The route's own total: the runs that finished. Nothing else has a level.
  const total = readiness?.total || 0;
  const levels = ['expert', 'full', 'standard', 'basic'];

  return html`
    <section class="og-sec">
      <div class="og-sec-h"><h2>${S('readyTitle')}<small>03</small></h2></div>
      <p class="adm-agi-lead">${S('readyLead')}</p>
      ${total === 0
    ? html`<p class="adm-agi-note">${S('readyEmpty')}</p>`
    : html`
        <div class="adm-agi-rows adm-agi-rows--ready">
          <div class="adm-agi-hrow">
            <span>${S('colLevel')}</span>
            <span class="r">${S('colAgents')}</span>
            <span class="r">${S('colShareShort')}</span>
            <span>${S('colShareOfFinished', { total: num(total) })}</span>
          </div>
          ${levels.map(level => {
    const count = dist[level] || 0;
    return html`
            <div class="adm-agi-row ${count === 0 ? 'is-none' : ''}" key=${level}>
              <span class="adm-agi-name">${t('agentOnboarding.readiness.' + level)}<em>${S('band.' + level)}</em></span>
              <span class="adm-agi-n r">${num(count)}</span>
              <span class="adm-agi-pct r">${share(count, total)}</span>
              <span class="adm-agi-bar" data-level=${level}>${count > 0
    ? html`<i style="width: ${count / total * 100}%"></i>`
    : null}</span>
            </div>`;
  })}
        </div>
        <p class="adm-agi-foot-note">${S('readyFoot', { total: num(total) })}</p>
      `}
    </section>
  `;
}

/* ── 04 · Skill bundles ──────────────────────────────────────────────────────────────────────── */

function Bundles({ platforms, totalAgents }) {
  // One row per bundle, not per platform: the generic bundle is what `other` and every
  // self-reported platform is handed, and those are three rows of the table above.
  const rows = useMemo(() => {
    const byBundle = new Map();
    for (const p of platforms) {
      const count = p.agent_count || 0;
      if (count === 0) continue;
      const generic = p.id === 'other' || !!p.self_reported;
      const cur = byBundle.get(p.bundle_name) || { bundle: p.bundle_name, agents: 0, generic: false, from: [] };
      cur.agents += count;
      cur.generic = cur.generic || generic;
      cur.from.push(p.display_name);
      byBundle.set(p.bundle_name, cur);
    }
    return [...byBundle.values()].sort((a, b) => b.agents - a.agents);
  }, [platforms]);

  return html`
    <section class="og-sec">
      <div class="og-sec-h"><h2>${S('bundlesTitle')}<small>04</small></h2></div>
      <p class="adm-agi-lead">${S('bundlesLead')}</p>
      ${rows.length === 0
    ? html`<p class="adm-agi-note">${S('bundlesEmpty')}</p>`
    : html`
        <div class="adm-agi-brows">
          <div class="adm-agi-bhrow">
            <span>${S('colBundle')}</span>
            <span class="r">${S('colAgents')}</span>
            <span>${S('colWhoGetsIt')}</span>
          </div>
          ${rows.map(r => html`
            <div class="adm-agi-brow" key=${r.bundle}>
              <span class="adm-agi-bname">${r.bundle}</span>
              <span class="adm-agi-n r">${num(r.agents)}</span>
              <span class="adm-agi-bwhat">${r.generic ? S('bundleGeneric') : S('bundleFor', { name: r.from[0] })}</span>
            </div>`)}
        </div>
        <p class="adm-agi-foot-note">${S('bundlesFoot', { total: num(totalAgents) })}</p>
      `}
    </section>
  `;
}
