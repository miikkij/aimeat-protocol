/**
 * @file agent-integration-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Agent integration page in the poster face (design canvas "AIMEAT
 *   Admin Agent integration"). Four sections: which tool each agent came from, how far the ones
 *   getting set up have come, how far the finished ones got, and which skill bundle each agent is
 *   handed. The reads are the same three routes as before; what changed is which of their numbers
 *   the page believes. Every part is a library component; the page passes data and writes no class.
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
 *   v3.0.0 — 2026-09-27 — Library components only (the admin pages on the shared set): Section,
 *     Beside, Figure, FigureStrip, the List with a Meter for each share (the readiness bands keep
 *     their ladder as the Meter's tones), More, Note. The page sheet admin-agent-integration.css goes.
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
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, dt, Spinner } from './shared.js';
import * as api from '/js/services/admin-agent-integration.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure, Meter } from '/components/Figure.js';
import { List, Row as Item, Name, Desc, Num, Cell, Doors, More } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Beside } from '/components/Layout.js';

const S = (key, params) => t('admin.agi.' + key, params);

/** The four readiness bands, from the loudest to the quietest, as the Meter's tones: a ladder. */
const BAND_TONE = { expert: 'notice', full: undefined, standard: 'ink', basic: 'dim' };

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
    <${Fragment}>
      <${PlatformRegistry} platforms=${platforms} totalAgents=${totalAgents} />
      <${GettingSetUp} onboarding=${onboarding} session=${session} onAction=${loadData} />
      <${Readiness} readiness=${readiness} />
      <${Bundles} platforms=${platforms} totalAgents=${totalAgents} />
    <//>
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
    return html`<${Section} first num="01" title=${S('regTitle')}>
      <${Note} kind="lead">${S('regEmpty')}<//>
    <//>`;
  }

  // The registry spans the page rather than sitting beside the headline: its patterns are regular
  // expressions, which have no spaces to break at, and a narrow cell sets one character to a line.
  return html`
    <${Section} first num="01" title=${S('regTitle')}>
      <${Beside} wide side=${html`<${Note} kind="lead">${S('regLead')}<//>`}>
        <${Label} block>${S('regHeroLabel')}<//>
        <${Figure} n=${S('regHero', { n: num(unrecognised), total: num(totalAgents) })} />
        <${Note} kind="hint">${S('regHeroSub')}<//>
      <//>

      <${List} cols="name-n-code-code-bar"
        head=${[S('colPlatform'), { label: S('colAgents'), num: true }, S('colBundle'), S('colRecognisedBy'), S('colShare', { total: num(totalAgents) })]}>
        ${platforms.map(p => {
    const count = p.agent_count || 0;
    return html`
          <${Item} key=${p.id} hover faded=${count === 0}>
            <${Name} meta=${p.id}>${p.display_name}<//>
            <${Num}>${num(count)}<//>
            <${Cell} meta>${p.bundle_name}<//>
            <${Cell} meta>${p.self_reported
    ? S('recSelfReported')
    : p.id === 'other' ? S('recNothing') : p.detect_pattern}<//>
            <${Cell}>${count > 0 ? html`<${Meter} thin pct=${Math.min(count / (totalAgents || 1) * 100, 100)} />` : null}<//>
          <//>`;
  })}
      <//>
      <${More} note=${S('regFoot', { agents: num(totalAgents), used: num(withAgents), rows: num(platforms.length) })} />
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
    <${Section} num="02" title=${S('setupTitle')}>
      <${FigureStrip} wrap lead items=${[
    { key: 'done', n: num(completed), label: S('cntFinished'), sub: S('cntFinishedSub') },
    { key: 'partway', n: num(inProgress), label: S('cntPartway'), sub: S('cntPartwaySub') },
    { key: 'waiting', n: num(waiting), label: S('cntWaiting'), sub: S('cntWaitingSub') },
    // Stuck is a subset of partway, not a fourth peer: it is counted in coral, not in ink.
    { key: 'stuck', n: num(stuck.length), tone: 'notice', label: S('cntStuck'), sub: S('cntStuckSub') },
  ]} />

      <${Note} kind="lead">${S('setupLead')}<//>

      ${stuck.length === 0
    ? html`<${Note} kind="hint">${S('setupNoneStuck')}<//>`
    : html`<${List} cols="name-desc-doors">
          ${stuck.map(s => html`<${StuckRun} run=${s} session=${session} onAction=${onAction} key=${s.agent_gaii} />`)}
        <//>`}
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
    <${Item}>
      <${Name} code meta=${S('waitingAt', { step: run.current_step })}>${run.agent_gaii}<//>
      <${Desc} sub=${run.never_moved
    ? S('startedNoStep', { day: day(run.stuck_since) })
    : S('lastStep', { when: dt(run.stuck_since) })}>
        ${meaningOf(run.current_step_id)}
        ${failed && html`<${Note} kind="message" error>${failed}<//>`}
      <//>
      <${Doors}>
        <${Action} small disabled=${acting}
          onClick=${() => act(() => api.sendReminder(session, run.agent_gaii), 'remind')}>${S('remind')}<//>
        ${run.current_step_id && html`
          <${Action} small disabled=${acting}
            onClick=${() => act(() => api.skipOnboardingStep(session, run.agent_gaii, run.current_step_id), 'skip')}>${S('skip')}<//>`}
      <//>
    <//>
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
    <${Section} num="03" title=${S('readyTitle')}>
      <${Note} kind="lead">${S('readyLead')}<//>
      ${total === 0
    ? html`<${Note} kind="hint">${S('readyEmpty')}<//>`
    : html`
        <${List} cols="name-n-n-bar"
          head=${[S('colLevel'), { label: S('colAgents'), num: true }, { label: S('colShareShort'), num: true }, S('colShareOfFinished', { total: num(total) })]}>
          ${levels.map(level => {
    const count = dist[level] || 0;
    return html`
            <${Item} key=${level} hover faded=${count === 0}>
              <${Name} meta=${S('band.' + level)}>${t('agentOnboarding.readiness.' + level)}<//>
              <${Num}>${num(count)}<//>
              <${Num} quiet>${share(count, total)}<//>
              <${Cell}>${count > 0 ? html`<${Meter} thin tone=${BAND_TONE[level]} pct=${count / total * 100} />` : null}<//>
            <//>`;
  })}
        <//>
        <${Note} kind="hint">${S('readyFoot', { total: num(total) })}<//>
      `}
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
    <${Section} num="04" title=${S('bundlesTitle')}>
      <${Note} kind="lead">${S('bundlesLead')}<//>
      ${rows.length === 0
    ? html`<${Note} kind="hint">${S('bundlesEmpty')}<//>`
    : html`
        <${List} cols="name-n-desc"
          head=${[S('colBundle'), { label: S('colAgents'), num: true }, S('colWhoGetsIt')]}>
          ${rows.map(r => html`
            <${Item} key=${r.bundle}>
              <${Cell} code>${r.bundle}<//>
              <${Num}>${num(r.agents)}<//>
              <${Desc}>${r.generic ? S('bundleGeneric') : S('bundleFor', { name: r.from[0] })}<//>
            <//>`)}
        <//>
        <${Note} kind="hint">${S('bundlesFoot', { total: num(totalAgents) })}<//>
      `}
    <//>
  `;
}
