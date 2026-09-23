/**
 * @file stats-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Statistics page in the poster face (design canvas "AIMEAT Admin Statistics"):
 *   what this node counted over a period you pick, what is true at this second, and which counters
 *   have nothing behind them.
 *
 *   THE PAGE OPENS ON THE BIGGEST NUMBER, and on a node reachable from the public internet that is
 *   usually the count of people and machines refused at the door. The old page did not show that
 *   counter at all above the fold, while giving a quarter of its top row to a consent counter that
 *   had reached 2 in the node's life. What an operator opens Statistics for is "is anything
 *   happening to us", and the answer was four screens down.
 *
 *   ONE READ, TWO SHAPES. The period read is the ranged call; the node's whole life comes from the
 *   un-ranged snapshot the dashboard shell already made. Holding both is what lets a row tell the
 *   difference between a counter at zero for this week and a counter nothing has ever written —
 *   which the old page could not do, and which is why `requests_total` read 0 for two months
 *   without anyone being able to see that its middleware had never been mounted.
 * @structure
 *   - Period — the chips and the two dates, in section 01's header, governing only what is under it
 *   - RightNow (01) — the word, the five rows, the strip
 *   - AskAi (06) — what an agent can do with these, and the paste
 *   - StatsTab (default) — the reads, and the six sections
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.2.0 -- 2026-09-22 -- Composed from the shared component set: sections, the period as tab
 *     actions and date fields, the strip as a numeral band, the paste in an aside; the page's own
 *     sheet is gone, so a theme or a part now reaches this page like every other.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v3.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v3.0.0 — 2026-09-12 — The poster face and six numbered sections. Counted-over-a-period and
 *     live-at-this-second are now separate sections, a counter with nothing behind it says so
 *     instead of drawing a zero, the empty weekly and monthly charts are gone, and the two charts
 *     that remain each own their axis and are drawn without Chart.js.
 *   v2.0.2 -- 2026-05-21 -- Replace inline styles with CSS classes, i18n weekday
 *     labels, use periodCustom/periodFrom/periodTo i18n keys on date inputs
 *   v2.0.1 -- 2026-05-21 -- i18n chart labels, chart cleanup on unmount, live
 *     badges on gauge cards, section header CSS classes, breakdown table th fix
 *   v2.0.0 -- 2026-05-21 -- Major rewrite: time range selector, email / push /
 *     mailbox notification sections, per-day charts, self-managed data fetching
 *   v1.0.0 -- 2026-05-01 -- Initial stats tab with basic cards and Chart.js charts
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, fmtUp, Badge, Row, Spinner, ErrorBox } from './shared.js';
import { Section, Columns, Stack, Text, Action, CopyAction, Field, NumeralBand, Surface } from '/components/poster-parts.js';
import { getNodeUrl } from '/js/services/auth.js';
import * as api from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import { rangeFor, daysInRange, counterRows } from './stats-tab.data.js';
import { WhatMoved, TheDays } from './stats-tab.days.js';
import { LiveNow, DidItArrive } from './stats-tab.live.js';
import { buildStatsPrompt } from './stats-tab.prompt.js';

const S = (key, params) => t('admin.stats.' + key, params);

const PRESETS = ['today', '7d', '30d', 'all'];

/**
 * The period control, and it lives in section 01's header rather than above the page.
 *
 * That placement is the fix for the thing the old page got wrong: a control at the top of a page
 * looks like it governs the page. It governs sections 01, 02, 03 and 05, and section 04 says in its
 * own first sentence that nothing governs it.
 */
function Period({ period, custom, onPick, onCustom, onApply }) {
  const [open, setOpen] = useState(false);
  return html`
    <${Stack} direction="wrap" align="center" density="compact" role="group" label=${S('period.label')}>
      <${Text} kind="caption" tone="muted">${S('period.label')}<//>
      ${PRESETS.map(p => html`
        <${Action} key=${p} kind="tab" selected=${period === p}
          onClick=${() => { setOpen(false); onPick(p); }}>${S('period.' + p)}<//>`)}
      ${open ? html`
        <${Stack} direction="wrap" align="center" density="compact">
          <${Field} type="date" width="narrow" value=${custom.from} ariaLabel=${S('period.from')}
            onInput=${e => onCustom({ ...custom, from: e.target.value })} />
          <${Text} tone="muted">–<//>
          <${Field} type="date" width="narrow" value=${custom.to} ariaLabel=${S('period.to')}
            onInput=${e => onCustom({ ...custom, to: e.target.value })} />
          <${Action} kind="tab" disabled=${!custom.from || !custom.to}
            onClick=${onApply}>${S('period.apply')}<//>
        <//>`
    : html`<${Action} onClick=${() => setOpen(true)}>${S('period.pick')}<//>`}
    <//>`;
}

/**
 * Section 01: the word, and the five rows under it.
 *
 * The word is whichever counter is largest over the period, because that is the thing an operator
 * is here to find out. When the largest is a refusal it wears the accent, which is the page saying
 * something is happening to you rather than by you.
 */
function RightNow({ rows, live, days, from, to, control }) {
  // `lead !== false` keeps the denominators out. See COUNTERS in stats-tab.data.js: a counter that
  // counts a superset of the others wins this sort on every node and names nothing.
  const ranked = [...rows]
    .filter(r => r.state === 'live' && r.lead !== false)
    .sort((a, b) => b.total - a.total);
  const lead = ranked[0] || null;
  const perDay = lead && days.length ? Math.round(lead.total / days.length) : 0;
  const alarming = !!lead && lead.role === 'critical';

  const by = (key) => rows.find(r => r.key === key) || { total: 0, ever: 0, state: 'never', failed: 0 };
  const reads = by('memory_reads');
  const writes = by('memory_writes');
  const schema = by('schema_validations');
  const requests = by('requests_total');
  const grants = by('consent_grants');
  const revokes = by('consent_revocations');
  const refused = by('auth_failures_total');
  const memoryOps = reads.total + writes.total;
  const consentOps = grants.total + revokes.total;
  const consentEver = grants.ever + revokes.ever;

  const stamp = [
    from && to ? `${from} → ${to}` : S('now.everything'),
    S('now.fromTallies'),
    S('now.readAt', { at: fmtTime(new Date()) }),
  ].join(' · ');

  return html`
    <${Section} id="adm-st-01" title=${S('now.title')} count="01" actions=${control}>
      <${Columns} layout="trailing" collapse=${900} density="roomy">
        <${Stack}>
          <${Text} kind="heading" tone=${alarming ? 'danger' : 'plain'}>
            ${lead ? S('now.word', { n: num(lead.total), what: S('word.' + lead.name) }) : S('now.wordNothing')}
          <//>
          <${Text}>
            ${!lead ? S('now.lineNothing')
    : alarming ? S('now.lineRefused', { n: num(perDay) })
      : S('now.lineOrdinary', { what: S('counter.' + lead.name).toLowerCase(), n: num(perDay) })}
          <//>
          <${Text} kind="mono" tone="muted">${stamp}<//>
          ${alarming ? html`
            <${Stack} direction="wrap" align="center">
              <${Action} tone="danger" href="#/admin/security">${S('now.seeWho')}<//>
            <//>` : null}
        <//>

        <div>
          ${Row({
    title: S('counter.refused'), why: S('now.refusedWhy'),
    chip: refused.state === 'live'
      ? html`<${Badge} type="danger" label=${S('now.aDay', { n: num(Math.round(refused.total / Math.max(1, days.length))) })} />`
      : html`<${Badge} type="muted" label=${S('now.chipQuiet')} />`,
    value: S('now.inPeriod', { n: num(refused.total) }),
  })}
          ${Row({
    title: S('now.memory'), why: S('now.memoryWhy'),
    chip: html`<${Badge} type=${memoryOps ? 'success' : 'muted'}
      label=${memoryOps ? S('now.chipHealthy') : S('now.chipQuiet')} />`,
    value: S('now.memoryValue', { n: num(memoryOps), r: num(reads.total), w: num(writes.total) }),
  })}
          ${Row({
    title: S('counter.schema'), why: S('now.schemaWhy'),
    chip: schema.failed
      ? html`<${Badge} type="warning" label=${S('now.chipFailed', { n: num(schema.failed) })} />`
      : html`<${Badge} type=${schema.total ? 'success' : 'muted'}
        label=${schema.total ? S('now.chipAllPassed') : S('now.chipQuiet')} />`,
    value: S('now.schemaValue', { n: num(schema.total) }),
  })}
          ${Row({
    title: S('counter.requests'), why: requests.state === 'never' ? S('now.requestsNoneWhy') : S('now.requestsWhy'),
    chip: requests.state === 'never'
      ? html`<${Badge} type="muted" label=${S('now.chipNothingYet')} />`
      : html`<${Badge} type="info" label=${S('now.aDay', { n: num(Math.round(requests.total / Math.max(1, days.length))) })} />`,
    value: requests.state === 'never' ? 'requests_total' : S('now.inPeriod', { n: num(requests.total) }),
  })}
          ${Row({
    title: S('now.consent'), why: S('now.consentWhy'), last: true,
    chip: html`<${Badge} type="muted" label=${S('now.chipEver', { n: num(consentEver) })} />`,
    value: S('now.inPeriod', { n: num(consentOps) }),
  })}
        </div>
      <//>

      <${NumeralBand} tone="plain" size="small" items=${[
    { label: lead ? S('word.' + lead.name) : S('strip.nothing'), value: lead ? num(lead.total) : '0',
      tone: alarming ? 'coral' : undefined,
      note: lead ? S('strip.aDay', { n: num(perDay) }) : S('strip.nothingSub') },
    { label: S('strip.memory'), value: num(memoryOps), note: S('strip.memorySub', { r: num(reads.total), w: num(writes.total) }) },
    { label: S('strip.schema'), value: num(schema.total), note: S('strip.schemaSub', { n: num(schema.failed) }) },
    { label: S('strip.up'), value: fmtUp(live.uptime_seconds || 0),
      note: S('strip.upSub', { at: (live.started_at || '').slice(0, 16).replace('T', ' ') }) },
  ]} />
    <//>`;
}

/** Section 06: what an agent can do with these numbers, and the paste. */
function AskAi({ from, to }) {
  const paste = buildStatsPrompt({ url: getNodeUrl(), from, to });
  return html`
    <${Section} id="adm-st-06" title=${S('ai.title')} count="06"
      actions=${html`<${CopyAction} text=${paste} label=${S('ai.copy')} />`}>
      <${Columns} layout="equal" collapse=${900} density="roomy">
        <div>
          <${Text}>${S('ai.lead')}<//>
          ${Row({ title: S('ai.read'), why: S('ai.readWhy'), chip: null, value: 'aimeat_admin_statistics' })}
          ${Row({ title: S('ai.who'), why: S('ai.whoWhy'), chip: null, value: 'aimeat_admin_security_overview' })}
          ${Row({ title: S('ai.raw'), why: S('ai.rawWhy'), chip: null, value: '/v1/metrics', last: true })}
        </div>
        <${Surface} kind="aside">
          <${Stack} density="compact">
            <${Text} kind="label">${S('ai.label')}<//>
            <${Text} lines>${paste}<//>
          <//>
        <//>
      <//>
    <//>`;
}

export default function StatsTab({ data }) {
  const [period, setPeriod] = useState('7d');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [applied, setApplied] = useState(null);
  const [sd, setSd] = useState(data?.stats || null);
  const [numbers, setNumbers] = useState(false);
  const [failed, setFailed] = useState(null);

  // The node's whole life, from the un-ranged read the dashboard shell already made. It is what
  // lets a row say "nothing has ever written this" instead of drawing a zero for the period.
  const life = data?.stats || {};

  const load = useCallback(async (p, range) => {
    try {
      const r = p === 'custom' ? range : rangeFor(p);
      const resp = await api.getStats(r?.from, r?.to);
      if (resp.data) { setSd(resp.data); setFailed(null); }
    } catch (err) {
      // A refused or unreachable read says so. The page holding its last good numbers behind a
      // spinner that never stops is the one outcome an operator cannot act on.
      swallowed('stats-tab: load', err);
      setFailed(err?.message || String(err));
    }
  }, []);

  useEffect(() => { load(period, applied); }, [period, applied, load]);
  // Statistics counts everything, so it follows every live update rather than a list of domains.
  useEffect(() => onLiveUpdate(null, () => load(period, applied)), [period, applied, load]);

  if (!sd) return failed ? html`<${ErrorBox} message=${failed} />` : html`<${Spinner} text=${S('loading')} />`;

  const from = sd.from || '';
  const to = sd.to || '';
  const daily = sd.daily || sd.daily_history || {};
  const days = daysInRange(from, to, daily);
  const rows = counterRows(sd, life, daily, days);

  const control = html`<${Period} period=${period} custom=${custom}
    onPick=${(p) => { setApplied(null); setPeriod(p); }}
    onCustom=${setCustom}
    onApply=${() => { setApplied({ ...custom }); setPeriod('custom'); }} />`;

  return html`<div>
    <${RightNow} rows=${rows} live=${sd} days=${days} from=${from} to=${to} control=${control} />
    <${WhatMoved} rows=${rows} days=${days} onShowNumbers=${() => {
    setNumbers(true);
    document.getElementById('adm-st-03')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }} />
    <${TheDays} daily=${daily} days=${days} showNumbers=${numbers} onToggle=${() => setNumbers(v => !v)} />
    <${LiveNow} live=${sd} gauges=${sd.gauges || {}} />
    <${DidItArrive} period=${sd} />
    <${AskAi} from=${from} to=${to} />
  </div>`;
}
