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
 *   2026-09-22 -- Composed from the shared component set (Section, Columns, NumeralBand, Table,
 *     Meter, Action): no page sheet and no class of its own, so a theme change reaches it. The
 *     four readiness bands keep their colours through the meter's tone.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v2.1.0 — 2026-09-13 — Compose shared B1 headings; bar ratios are SVG data with CSS appearance.
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
import { date as fmtDate } from '/js/format.js';
import { num, dt, Spinner } from './shared.js';
import { Section, Columns, Stack, NumeralBand, Table, Meter, ListRow, Action, Text } from '/components/poster-parts.js';
import * as api from '/js/services/admin-agent-integration.js';
import { swallowed } from '/js/swallowed.js';

const S = (key, params) => t('admin.agi.' + key, params);

/** The four readiness bands run from the loudest to the quietest, so the rows read as a ladder. */
const LEVEL_TONE = { expert: 'coral', full: 'sun', standard: 'ink', basic: 'muted' };

/** A share of the whole, to one decimal, for a column that names its own maximum. */
function share(n, total) {
  if (!total) return '0 %';
  return `${(n / total * 100).toFixed(1)} %`;
}

/** The day a row is dated by. The hour matters on a stuck run, so it keeps its full stamp. */
function day(iso) {
  try { return fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (err) { swallowed('agent-integration: day', err); return ''; }
}

export default function AgentIntegrationTab({ session }) {
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

  if (loading) return html`<${Spinner} />`;

  return html`
    <${Stack}>
      <${PlatformRegistry} platforms=${platforms} totalAgents=${totalAgents} />
      <${GettingSetUp} onboarding=${onboarding} session=${session} onAction=${loadData} />
      <${Readiness} readiness=${readiness} />
      <${Bundles} platforms=${platforms} totalAgents=${totalAgents} />
    <//>
  `;
}

/** A name over its id: the two lines of a row's first cell. */
const named = (name, id, muted) => html`<${Stack} density="compact">
  ${muted ? html`<${Text} tone="muted">${name}<//>` : html`<strong>${name}</strong>`}
  <${Text} kind="mono" tone="muted">${id}<//>
<//>`;

/** A count in its column, read at the right edge. */
const count = (n, muted) => ({ text: html`<${Text} kind="mono" tone=${muted ? 'muted' : 'plain'}>${num(n)}<//>`, align: 'end' });

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
    return html`<${Section} title=${S('regTitle')} count="01"><${Text}>${S('regEmpty')}<//><//>`;
  }

  return html`
    <${Section} title=${S('regTitle')} count="01">
      <${Stack}>
        <${Columns} layout="trailing" collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="label">${S('regHeroLabel')}<//>
            <${Text} kind="number">${S('regHero', { n: num(unrecognised), total: num(totalAgents) })}<//>
            <${Text} kind="caption" tone="muted">${S('regHeroSub')}<//>
          <//>
          <${Text}>${S('regLead')}<//>
        <//>

        <${Table} density="compact" collapse=${640} label=${S('regTitle')}
          headers=${[S('colPlatform'), S('colAgents'), S('colBundle'), S('colRecognisedBy'), S('colShare', { total: num(totalAgents) })]}
          rows=${platforms.map(p => {
    const n = p.agent_count || 0;
    return [
      named(p.display_name, p.id, n === 0),
      count(n, n === 0),
      html`<${Text} kind="mono" tone="muted">${p.bundle_name}<//>`,
      html`<${Text} kind="mono" tone="muted">${p.self_reported
        ? S('recSelfReported')
        : p.id === 'other' ? S('recNothing') : p.detect_pattern}<//>`,
      n > 0 ? html`<${Meter} kind="progress" value=${Math.min(n / (totalAgents || 1) * 100, 100)} label=${p.display_name} />` : '',
    ];
  })} />
        <${Text} kind="caption" tone="muted">${S('regFoot', { agents: num(totalAgents), used: num(withAgents), rows: num(platforms.length) })}<//>
      <//>
    <//>
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
    <${Section} title=${S('setupTitle')} count="02">
      <${Stack}>
        <${NumeralBand} tone="plain" items=${[
    { label: S('cntFinished'), value: num(completed), note: S('cntFinishedSub') },
    { label: S('cntPartway'), value: num(inProgress), note: S('cntPartwaySub') },
    { label: S('cntWaiting'), value: num(waiting), note: S('cntWaitingSub') },
    // Stuck is a subset of partway, not a fourth peer: it is counted in coral, not in ink.
    { label: S('cntStuck'), value: num(stuck.length), note: S('cntStuckSub'), tone: 'coral' },
  ]} />

        <${Text}>${S('setupLead')}<//>

        ${stuck.length === 0
    ? html`<${Text} kind="caption" tone="muted">${S('setupNoneStuck')}<//>`
    : html`<div>
            ${stuck.map(s => html`<${StuckRun} run=${s} session=${session} onAction=${onAction} key=${s.agent_gaii} />`)}
          </div>`}
      <//>
    <//>
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
    <${ListRow} name=${run.agent_gaii} detailKind="text" detail=${S('waitingAt', { step: run.current_step })}
      value=${html`<${Stack} density="compact">
        <${Text}>${meaningOf(run.current_step_id)}<//>
        <${Text} kind="mono" tone="muted">${run.never_moved
    ? S('startedNoStep', { day: day(run.stuck_since) })
    : S('lastStep', { when: dt(run.stuck_since) })}<//>
        ${failed && html`<${Text} tone="danger">${failed}<//>`}
      <//>`}
      actions=${html`
        <${Action} disabled=${acting}
          onClick=${() => act(() => api.sendReminder(session, run.agent_gaii), 'remind')}>${S('remind')}<//>
        ${run.current_step_id && html`
          <${Action} disabled=${acting}
            onClick=${() => act(() => api.skipOnboardingStep(session, run.agent_gaii, run.current_step_id), 'skip')}>${S('skip')}<//>`}`} />
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
    <${Section} title=${S('readyTitle')} count="03" description=${S('readyLead')}>
      ${total === 0
    ? html`<${Text} kind="caption" tone="muted">${S('readyEmpty')}<//>`
    : html`<${Stack}>
        <${Table} density="compact" collapse=${600} label=${S('readyTitle')}
          headers=${[S('colLevel'), S('colAgents'), S('colShareShort'), S('colShareOfFinished', { total: num(total) })]}
          rows=${levels.map(level => {
    const n = dist[level] || 0;
    return [
      named(t('agentOnboarding.readiness.' + level), S('band.' + level), n === 0),
      count(n, n === 0),
      { text: html`<${Text} kind="mono" tone="muted">${share(n, total)}<//>`, align: 'end' },
      n > 0 ? html`<${Meter} kind="progress" tone=${LEVEL_TONE[level]} value=${n / total * 100} label=${t('agentOnboarding.readiness.' + level)} />` : '',
    ];
  })} />
        <${Text} kind="caption" tone="muted">${S('readyFoot', { total: num(total) })}<//>
      <//>`}
    <//>
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
    <${Section} title=${S('bundlesTitle')} count="04" description=${S('bundlesLead')}>
      ${rows.length === 0
    ? html`<${Text} kind="caption" tone="muted">${S('bundlesEmpty')}<//>`
    : html`<${Stack}>
        <${Table} density="compact" collapse=${600} label=${S('bundlesTitle')}
          headers=${[S('colBundle'), S('colAgents'), S('colWhoGetsIt')]}
          rows=${rows.map(r => [
    html`<${Text} kind="mono">${r.bundle}<//>`,
    count(r.agents),
    html`<${Text} tone="muted">${r.generic ? S('bundleGeneric') : S('bundleFor', { name: r.from[0] })}<//>`,
  ])} />
        <${Text} kind="caption" tone="muted">${S('bundlesFoot', { total: num(totalAgents) })}<//>
      <//>`}
    <//>
  `;
}
