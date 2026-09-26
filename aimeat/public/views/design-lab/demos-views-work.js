/**
 * @file public/views/design-lab/demos-views-work.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the special views of Settings & Controls about work: automation, offers and the calibrator, each drawn by calling the real component with sample data, in
 *   the page's scope root (.pf) as Settings & Controls draws it.
 * @structure WORK_VIEW_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { WORK_VIEW_DEMOS } from './demos-views-work.js';
 * @version-history
 *   v1.1.0 — 2026-09-27 — The work views' demos, each calling its component with data: the task graph, the
 *     series bars, the peek, the plan steps, the run view and the step strip (new), and the schedule
 *     calendar, week rhythm, job chips, workflow steps, ecosystem automation, score chart, morsel flow,
 *     offer map, offer request, rating stars, job prompt and progress steps (moved from demos-settings.js,
 *     which wrote their classes by hand).
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import { h } from 'preact';
import htm from 'htm';
import { calendar } from '/js/format.js';
import { SettingsRoot } from '/components/SettingsFrame.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Markdown } from '/components/Markdown.js';
import { TextArea } from '/components/TextField.js';
import { TaskGraph } from '/components/TaskGraph.js';
import { SeriesBars } from '/components/SeriesBars.js';
import { Peek, PeekToggle } from '/components/Peek.js';
import { PlanSteps, PlanStep, PlanNote } from '/components/PlanSteps.js';
import {
  RunSteps, RunStep, RunStepDoors, RunCopies, RunModel, RunChecks, RunColumns, RunColumn, RunProposals, RunOutput, RunApply, RunPaste,
} from '/components/RunView.js';
import { StepStrip } from '/components/StepStrip.js';
import { ScheduleCalendar } from '/components/ScheduleCalendar.js';
import { WeekRhythm } from '/components/WeekRhythm.js';
import { JobChips } from '/components/JobChips.js';
import { WorkflowSteps } from '/components/WorkflowSteps.js';
import { FlowCard, FlowStep, StatusTimeline, StatusStep, RunLog } from '/components/EcoAutomation.js';
import { ScoreChart } from '/components/ScoreChart.js';
import { MorselFlow, MorselPace } from '/components/MorselFlow.js';
import { OfferMap } from '/components/OfferMap.js';
import { Stars } from '/components/Stars.js';
import { JobPrompt } from '/components/JobPrompt.js';
import { ProgressSteps, ProgressNow } from '/components/ProgressSteps.js';

const html = htm.bind(h);
const noop = () => {};
const root = (children) => html`<${SettingsRoot}>${children}<//>`;
const LONG = 'A name long enough to wrap onto a second line, or to be cut, on a narrow phone screen';

/* ── Sample data ─────────────────────────────────────────────────────────────────────────────── */

const TASKS = [
  { id: 'collect', agent: 'bot' },
  { id: 'price', agent: 'invoice-drafter', context: ['collect'] },
  { id: 'check', agent: 'bot', context: ['collect'] },
  { id: 'draft', agent: 'invoice-drafter', context: ['price', 'check'] },
];
const WIDE_TASKS = [
  { id: 'read-mailbox', agent: 'bot' }, { id: 'read-calendar', agent: 'bot' }, { id: 'read-hours', agent: 'bot' },
  { id: 'read-contracts', agent: 'bot' }, { id: 'read-rates', agent: 'invoice-drafter' },
  { id: 'draft-invoice', agent: 'invoice-drafter', context: ['read-mailbox', 'read-calendar', 'read-hours', 'read-contracts', 'read-rates'] },
];

const SERIES = [
  { label: 'April', value: 9 }, { label: 'May', value: 12 }, { label: 'June', value: 18 },
  { label: 'July', value: 7 }, { label: 'August', value: 15 }, { label: 'September', value: 21 },
];

const NOTE_TEXT = 'Call Nordic Ferries about the seat map.\n\nThey want the new layout by Friday. Lumo Bakery asked for the same study last spring; the notes are in Harbour Studio\'s research space.\n\n- Seats per row\n- The café corner\n- Where the prams go';

/** A day this week at an hour, in the reader's clock (the calendar's runs are moments). */
const at = (dayOffset, hour, minute = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(hour, minute, 0, 0); return d; };
const CAL_WORDS = {
  month: 'Month', week: 'Week', day: 'Day', prev: 'Previous', next: 'Next', today: 'Today',
  loading: 'loading…', truncated: 'Some later occurrences are not shown in this view.',
  noEvents: 'Nothing scheduled in this range.', empty: 'No enabled schedules yet: create one above to see it here.',
  frequentTitle: 'Continuously running', freqHideGrid: 'Hide from grid', freqShowGrid: 'Show in grid',
  showLess: 'Show less', showMore: (n) => `+${n} more`, ran: 'ran', upcoming: 'upcoming', earlier: 'Earlier', later: 'Later',
};
const CAL_KINDS = [{ key: 'ai', label: 'AI' }, { key: 'agent', label: 'Agent task' }, { key: 'ext', label: 'Extension' }, { key: 'eco', label: 'Ecosystem app' }, { key: 'core', label: 'Core' }];
const calEvents = () => [
  { at: at(-1, 6), scheduleId: 's1', kind: 'agent', name: 'Morning digest', past: true },
  { at: at(-1, 22), scheduleId: 's2', kind: 'ai', name: 'Nightly librarian', past: true },
  { at: at(0, 6), scheduleId: 's1', kind: 'agent', name: 'Morning digest' },
  { at: at(0, 9, 30), scheduleId: 's3', kind: 'eco', name: 'Harbour Studio feedback' },
  { at: at(0, 13), scheduleId: 's4', kind: 'ext', name: 'Nordic Ferries timetable sync' },
  { at: at(0, 22), scheduleId: 's2', kind: 'ai', name: 'Nightly librarian' },
  { at: at(0, 23, 30), scheduleId: 's5', kind: 'core', name: 'Backup' },
  { at: at(1, 6), scheduleId: 's1', kind: 'agent', name: 'Morning digest' },
  { at: at(1, 7), scheduleId: 's6', kind: 'agent', name: LONG },
];
const FREQUENT = [
  { scheduleId: 'f1', kind: 'agent', name: 'Check the mailbox', cadence: 'every 30 min', perDay: '~48/day', approxPerDay: 48 },
  { scheduleId: 'f2', kind: 'ext', name: 'Watch the ferry feed', cadence: 'every 5 min', perDay: '~288/day', approxPerDay: 288 },
];
const MANY_FREQUENT = [...FREQUENT, ...['Lumo Bakery orders', 'Harbour Studio inbox', 'Invoice queue', 'Price watch', 'Seat map changes'].map((name, i) => (
  { scheduleId: 'm' + i, kind: i % 2 ? 'core' : 'agent', name, cadence: 'every 15 min', perDay: '~96/day', approxPerDay: 96 }))];
const calendarDemo = (props) => root(html`<${ScheduleCalendar} mode="week" onMode=${noop} onPrev=${noop} onNext=${noop} onToday=${noop}
  anchor=${new Date()} events=${calEvents()} frequent=${FREQUENT} kinds=${CAL_KINDS} hasSchedules onJump=${noop} words=${CAL_WORDS} ...${props} />`);

const WEEK_HEADS = { time: 'Time', name: 'Schedule', last: 'Last run' };
const weekDays = () => Array.from({ length: 7 }, (_, i) => { const d = at(i, 0); return { key: i, label: calendar(d, { weekday: 'short' }), sub: d.getDate(), today: i === 0 }; });

const OFFER_GROUPS = [
  { key: 'write', label: 'Write', items: [
    { key: 'inv', title: 'Draft an invoice', href: '#', agent: 'invoice-drafter', online: true, mark: html`<${Mark} presence="online">invoice-drafter<//>` },
    { key: 'sum', title: 'Summarise a long thread into five bullets', href: '#', agent: 'codex', online: false, mark: html`<${Mark} presence="idle" away="away">codex<//>` },
  ] },
  { key: 'find', label: 'Find', items: [
    { key: 'web', title: 'Search the web', href: '#', agent: 'bot', online: true, mark: html`<${Mark} presence="online">bot<//>` },
  ] },
  { key: 'watch', label: 'Watch', items: [
    { key: 'feed', title: 'Watch the Nordic Ferries timetable', href: '#', agent: 'bot', online: true, mark: html`<${Mark} presence="online">bot<//>` },
    { key: 'price', title: 'Tell me when a flour price changes for Lumo Bakery', href: '#', agent: 'codex', online: false, mark: html`<${Mark} presence="idle" away="away">codex<//>` },
    { key: 'long', title: LONG, href: '#', agent: 'invoice-drafter', online: true, mark: html`<${Mark} presence="online">invoice-drafter<//>` },
  ] },
];
const OFFER_TREE = 'flowchart LR\n  n0["Offers"] --> g0["Write"]\n  n0 --> g1["Find"]\n  g0 --> g0o0["Draft an invoice"]\n  g0 --> g0o1["Summarise a long thread"]\n  g1 --> g1o0["Search the web"]';

const ROUNDS = [{ key: 'r1', label: 'Run 1', sub: 'v1' }, { key: 'r2', label: 'Run 2', sub: 'v2' }, { key: 'r3', label: 'Run 3', sub: 'v3' }];
const SCORES = [
  { key: 'm', label: 'Mistral Small 3.2', values: [54, 71, 82] },
  { key: 'g', label: 'Gemini 2.5 Flash', values: [71, 74, 77] },
  { key: 'c', label: 'Claude Haiku 4.5', values: [null, 80, 88] },
];

const RUN_CHECKS = [
  { key: 1, pass: true, name: 'names the client', description: 'The invoice says who it is for.', expected: 'Nordic Ferries', actual: 'Nordic Ferries', weight: 'major' },
  { key: 2, pass: false, name: 'hours add up', description: 'The rows add up to the total.', expected: '38.5 h', actual: '36 h', weight: 'critical' },
  { key: 3, pass: true, name: 'currency', expected: 'EUR', actual: 'EUR', weight: 'minor' },
];

/* ── The demos ───────────────────────────────────────────────────────────────────────────────── */

export const WORK_VIEW_DEMOS = {
  'task-graph': { variants: [
    { name: 'four tasks, one reads two', render: () => root(html`<${TaskGraph} tasks=${TASKS} />`) },
    { name: 'problem', render: () => root(html`<${TaskGraph} tasks=${TASKS} problemIds=${new Set([2])} />`) },
    { name: 'long: wider than its place, it scrolls', render: () => root(html`<${TaskGraph} tasks=${WIDE_TASKS} />`) },
  ] },
  'series-bars': { variants: [
    { name: 'six months', render: () => root(html`<${SeriesBars} series=${SERIES} />`) },
    { name: 'taller', render: () => root(html`<${SeriesBars} series=${SERIES} height=${96} />`) },
    { name: 'long: a year of weeks', render: () => root(html`<${SeriesBars} series=${Array.from({ length: 52 }, (_, i) => ({ label: `Week ${i + 1}`, value: 5 + ((i * 7) % 13) }))} />`) },
  ] },
  peek: { variants: [
    { name: 'line', render: () => root(html`<${Peek} view="line" line=${NOTE_TEXT.split('\n')[0]}><${Markdown} text=${NOTE_TEXT} /><//><${PeekToggle} view="line" label="Show more of the note" onToggle=${noop} />`) },
    { name: 'peek', render: () => root(html`<${Peek} view="peek" line=${NOTE_TEXT.split('\n')[0]}><${Markdown} text=${NOTE_TEXT} /><//><${PeekToggle} view="peek" label="Show all of the note" onToggle=${noop} />`) },
    { name: 'full', render: () => root(html`<${Peek} view="full" line=${NOTE_TEXT.split('\n')[0]}><${Markdown} text=${NOTE_TEXT} /><//><${PeekToggle} view="full" label="Show one line" onToggle=${noop} />`) },
    { name: 'long first line, cut', render: () => root(html`<${Peek} view="line" line=${`${LONG}, and then some more words after it`}><${Markdown} text=${LONG} /><//>`) },
  ] },
  'plan-steps': { variants: [
    { name: 'a plan: done, to run, skipped', render: () => root(html`
      <${PlanNote}>Link the note to the client, then ask for a quote. · 82%<//>
      <${PlanSteps}>
        <${PlanStep} state="done" before=${html`<${Mark}>link<//>`} title="Link the note to Nordic Ferries" after=${html`<${Mark} kind="status" tone="fine">✓<//>`}>
          <${PlanNote}>The note names the ferry company twice.<//>
        <//>
        <${PlanStep} before=${html`<${Mark} tone="coral">task<//>`} title="Ask invoice-drafter for a quote" after=${html`<${Note} kind="meta" inline>→ invoice-drafter<//>`}
          doors=${html`<${Loud} control onClick=${noop}>Run<//><${Action} small onClick=${noop}>Skip<//>`}>
          <${Note} kind="meta">A quote for the seat map study, in euros.<//>
          <${PlanNote}>The client asked for a price by Friday.<//>
        <//>
        <${PlanStep} state="skipped" before=${html`<${Mark}>tag<//>`} title="Tag the note as research" after=${html`<${Mark} kind="status" tone="off">skipped<//>`} />
      <//>`) },
    { name: 'pieces to pick', render: () => root(html`
      <${PlanNote}>3 pieces<//>
      <${PlanSteps}>
        <${PlanStep} pick=${{ checked: true, onChange: noop }} title="The seat map" after=${html`<${Mark}>Harbour Studio ▸ Research<//>`}><${Markdown} text="Seats per row, and where the prams go." /><//>
        <${PlanStep} pick=${{ checked: true, onChange: noop }} title="The café corner" after=${html`<${Mark}>Lumo Bakery<//>`}><${Markdown} text="The café corner needs two more tables." /><//>
        <${PlanStep} state="skipped" pick=${{ checked: false, onChange: noop }} title=${LONG} after=${html`<${Mark}>Private<//>`} />
      <//>`) },
  ] },
  'run-view': { variants: [
    { name: 'steps, one open with a scored model', render: () => root(html`<${RunSteps}>
      <${RunStep} num=${1} name="Generate" right="done" done onToggle=${noop} />
      <${RunStep} num=${2} name="Analyze" right="2 scored" done open onToggle=${noop}>
        <${Note} kind="lead">A judge model compares each answer with the checkpoints.<//>
        <${RunModel} name="Mistral Small 3.2" figure="82 %" tone="fine" meta="3 checkpoints · 2 met">
          <${RunChecks} head=${['', 'Checkpoint', 'Expected', 'Got', 'Weight']} rows=${RUN_CHECKS} />
          <${RunOutput} label="View the analysis">The answer names the client and the currency. The hours are 2.5 short.<//>
        <//>
        <${RunModel} name="Gemini 2.5 Flash" figure="41 %" tone="notice" meta="3 checkpoints · 1 met" />
        <${RunStepDoors}>
          <${Actions}><${Action} small onClick=${noop}>Run this step here<//><${Action} small soft copy="Compare the answer with the checkpoints.">Copy the prompt<//><//>
          <${RunCopies} label="Copy a prompt for each model"><${Action} small soft copy="Mistral">Mistral Small 3.2<//><${Action} small soft copy="Gemini">Gemini 2.5 Flash<//><//>
        <//>
      <//>
      <${RunStep} num=${3} name="Reflect" right="waiting" onToggle=${noop} />
      <${RunStep} num=${4} name="Synthesize" right="waiting" onToggle=${noop} />
    <//>`) },
    { name: 'proposals side by side', render: () => root(html`<${RunModel} name="Mistral Small 3.2" meta="4 proposals">
      <${RunColumns}>
        <${RunColumn} label="The judge proposes"><${Note}>Say the total hours before the rows.<//><${Note}>Name the currency once, at the top.<//><//>
        <${RunColumn} label="Mistral Small 3.2 proposes"><${Note}>Ask for the hours as a table.<//><//>
      <//>
    <//>`) },
    { name: 'the synthesis: chosen proposals, apply, paste', render: () => root(html`
      <${Label} block>Grouped proposals<//>
      <${RunProposals} items=${[
        { key: 0, n: 1, chosen: true, text: 'Say the total hours before the rows.', notes: ['Both judges asked for it.', 'Sources: judge, Mistral Small 3.2'], tags: [{ label: 'high impact', tone: 'coral' }, { label: 'low risk' }] },
        { key: 1, n: 2, chosen: false, text: LONG, notes: ['One judge asked for it.'], tags: [{ label: 'low impact' }] },
      ]} />
      <${RunApply} note="The next version is written as a draft; you see it before it is used.">
        <${Loud} control onClick=${noop}>Apply option B as v4<//><${Action} small soft copy="Apply these proposals.">Copy the prompt<//>
      <//>
      <${RunPaste} label="Paste the synthesis from your own chat">
        <${TextArea} rows=${4} placeholder="Paste the answer here" ariaLabel="Paste an answer" onInput=${noop} />
        <${Actions}><${Action} small onClick=${noop}>Save<//><${Action} small soft onClick=${noop}>Cancel<//><//>
      <//>`) },
  ] },
  'step-strip': { variants: [
    { name: 'chain: done, failed, not run', render: () => root(html`<${StepStrip} chain steps=${[
      { key: 1, name: 'Collect the hours', sub: 'bot · ran today', state: 'done', onOpen: noop, title: 'Open the offer' },
      { key: 2, name: 'Draft an invoice', sub: 'invoice-drafter · failed', state: 'failed', onOpen: noop },
      { key: 3, name: 'Send it to Nordic Ferries', sub: 'bot', onOpen: noop },
    ]} />`) },
    { name: 'loose steps', render: () => root(html`<${StepStrip} steps=${[
      { key: 1, name: 'Watch the ferry feed', sub: 'bot', state: 'done', onOpen: noop },
      { key: 2, name: 'Lumo Bakery orders', sub: 'codex', onOpen: noop },
    ]} />`) },
    { name: 'long', render: () => root(html`<${StepStrip} chain steps=${[
      { key: 1, name: LONG, sub: 'invoice-drafter · a line long enough to be cut', state: 'done', onOpen: noop },
      { key: 2, name: 'Check', sub: 'bot', onOpen: noop },
    ]} />`) },
  ] },
  'schedule-calendar': { variants: [
    { name: 'week', render: () => calendarDemo({}) },
    { name: 'month', render: () => calendarDemo({ mode: 'month' }) },
    { name: 'day', render: () => calendarDemo({ mode: 'day' }) },
    { name: 'continuously running, more than six', render: () => calendarDemo({ frequent: MANY_FREQUENT }) },
    { name: 'loading, cut short', render: () => calendarDemo({ loading: true, truncated: true }) },
    { name: 'empty: no schedules yet', render: () => calendarDemo({ events: [], frequent: [], hasSchedules: false }) },
  ] },
  'week-rhythm': { variants: [
    { name: 'three jobs', render: () => root(html`<${WeekRhythm} heads=${WEEK_HEADS} days=${weekDays()} rows=${[
      { key: 'd', time: '06:00', name: 'Morning digest', note: 'every day', onOpen: noop, openLabel: 'Open Morning digest', days: [true, true, true, true, true, true, true], agent: true, last: 'today 06:00' },
      { key: 'l', time: '22:00', name: 'Nightly librarian', note: 'on weekdays', onOpen: noop, openLabel: 'Open Nightly librarian', days: [true, true, true, true, true, false, false], last: 'yesterday 22:00' },
      { key: 'x', time: '06 · 12 · 18', name: LONG, note: 'three times a day', onOpen: noop, openLabel: 'Open', days: [true, false, true, false, true, false, false], agent: true, last: 'never' },
    ]} />`) },
  ] },
  'job-chips': { variants: [
    { name: 'two jobs, one failed', render: () => root(html`<${JobChips} items=${[
      { key: 'm', name: 'Check the mailbox', note: 'every 30 min · ~48/day · 1,204 runs', onOpen: noop },
      { key: 'f', name: 'Watch the ferry feed', note: 'every 5 min · ~288/day', warn: true, title: 'The last run failed', onOpen: noop },
    ]} />`) },
    { name: 'long', render: () => root(html`<${JobChips} items=${[{ key: 'l', name: LONG, note: 'every 15 min · ~96/day', onOpen: noop }]} />`) },
  ] },
  'workflow-steps': { variants: [
    { name: 'a workflow', render: () => root(html`<${WorkflowSteps} steps=${[
      { key: 'a', num: '01', title: 'Collect the hours', sub: 'bot', lines: ['First. Takes the month. Gives the hours as a table.', { text: 'writes wf/invoice/hours', code: true }] },
      { key: 'b', num: '02', title: 'Draft an invoice', sub: 'invoice-drafter', lines: ['Takes the hours. Gives a draft for Nordic Ferries.', { text: 'writes wf/invoice/draft', code: true }] },
    ]} />`) },
    { name: 'a run: produced, waiting, failed', render: () => root(html`<${WorkflowSteps} steps=${[
      { key: 'a', num: '01', title: 'Collect the hours', sub: 'bot', lines: ['Gives the hours as a table.'], state: { word: 'produced', tone: 'fine' }, notes: ['3 rows seen', '0.8 s'] },
      { key: 'b', num: '02', title: 'Draft an invoice', sub: 'invoice-drafter', lines: ['Gives a draft.'], state: { word: 'waiting', tone: 'attention' }, notes: ['queued 09:12'] },
      { key: 'c', num: '03', title: LONG, sub: 'bot', lines: [{ text: 'writes wf/invoice/a-memory-key-long-enough-to-break-anywhere-on-a-phone', code: true }], state: { word: 'failed', tone: 'danger' }, notes: ['no key for the mail server'] },
    ]} />`) },
  ] },
  'eco-automation': { variants: [
    { name: 'the flow card', render: () => root(html`<${FlowCard} save=${html`<${Loud} control onClick=${noop}>Save automation<//>`}>
      <${FlowStep} num="1. What this app produces"><${Note}>Feedback, as records under the app's key.<//><//>
      <${FlowStep} num="2. Run on a schedule"><${Note}>Every morning at 06:00.<//><//>
      <${FlowStep} num="3. Deliver guidance" off><${Note}>Set a schedule first.<//><//>
    <//>`) },
    { name: 'the latest run: ok, wait, off, error', render: () => root(html`<${StatusTimeline} title="The latest run">
      <${StatusStep} state="ok" label="Published" marks=${html`<${Mark}>Harbour Studio<//>`}><${Note}>Today, 06:00.<//><//>
      <${StatusStep} state="wait" label="Processed" marks=${html`<${Mark}>bot<//>`}><${Note}>Waiting for an agent.<//><//>
      <${StatusStep} state="error" label="Checked"><${Note}>The agent could not read the records.<//><//>
      <${StatusStep} state="off" label="Delivered"><${Note}>Not set up.<//><//>
    <//>`) },
    { name: 'a job\'s run log', render: () => root(html`<${RunLog} rows=${[
      { key: 1, when: 'today 06:00', result: { word: 'ok', tone: 'fine' }, trigger: 'schedule', duration: '4 s' },
      { key: 2, when: 'yesterday 06:00', result: { word: 'failed', tone: 'danger' }, trigger: 'schedule', duration: '30 s', reason: 'The agent bot did not answer in time. A reason long enough to take its own line under the others.' },
      { key: 3, when: '25 Sep 14:10', result: { word: 'skipped', tone: 'off' }, trigger: 'by hand' },
    ]} />`) },
  ] },
  'score-chart': { variants: [
    { name: 'three models over three runs', render: () => root(html`<${ScoreChart} title="Score per run" rounds=${ROUNDS} series=${SCORES} />`) },
    { name: 'one round', render: () => root(html`<${ScoreChart} title="Score per run" rounds=${ROUNDS.slice(0, 1)} series=${SCORES.map((s) => ({ ...s, values: s.values.slice(0, 1) }))} />`) },
    { name: 'long model names', render: () => root(html`<${ScoreChart} title="Score per run" rounds=${ROUNDS} series=${[{ key: 'l', label: LONG, values: [40, 60, 70] }, ...SCORES.slice(0, 1)]} />`) },
  ] },
  'morsel-flow': { variants: [
    { name: 'came in and went out', render: () => root(html`<${MorselFlow} columns=${[
      { key: 'in', total: '+120', tone: 'fine', title: 'Came in', count: '12 rows · 1.9.–26.9.', rows: [{ key: 'a', title: 'Daily accrual', sub: '30 times', sum: '+90' }, { key: 'v', title: 'A vouch', sub: '3 times', sum: '+30' }] },
      { key: 'out', total: '-40', tone: 'notice', title: 'Went out', count: '4 rows', rows: [{ key: 'w', title: 'Memory writes', sub: '40 times', sum: '-40' }] },
    ]} />`) },
    { name: 'empty column', render: () => root(html`<${MorselFlow} columns=${[
      { key: 'in', total: '+30', tone: 'fine', title: 'Came in', rows: [{ key: 'a', title: 'Daily accrual', sub: '10 times', sum: '+30' }] },
      { key: 'out', total: '0', tone: 'notice', title: 'Went out', rows: [], empty: 'Nothing went out yet.' },
    ]} />`) },
    { name: 'pace', render: () => root(html`<${MorselPace} title="The pace." words="Your balance fills by about 3 morsels a day and reaches its cap in 12 days." pct=${64} figure="640 / 1,000" />`) },
    { name: 'long source name', render: () => root(html`<${MorselFlow} columns=${[{ key: 'in', total: '+9', tone: 'fine', title: 'Came in', rows: [{ key: 'l', title: LONG, sub: 'once', sum: '+9' }] }]} />`) },
  ] },
  'offer-map': { variants: [
    { name: 'columns', render: () => root(html`<${OfferMap} groups=${OFFER_GROUPS} />`) },
    { name: 'grid, one agent away', render: () => root(html`<${OfferMap} mode="grid" groups=${OFFER_GROUPS} agentLabel="Agent" />`) },
    { name: 'blocks', render: () => root(html`<${OfferMap} mode="tiles" groups=${OFFER_GROUPS} />`) },
    { name: 'tree', render: () => root(html`<${OfferMap} mode="tree" groups=${OFFER_GROUPS} chart=${OFFER_TREE} onPick=${noop} />`) },
  ] },
  // No page draws the offer request now (the offer's page composes it from the kit), and no component
  // draws its classes, so this demo writes the old markup: it is the only way the lab can show the sheet.
  'offer-request': { variants: [
    { name: 'the old markup (no page draws it)', render: () => root(html`<div class="og og-op"><p class="op-ask">Draft an invoice from the hours logged this month, in the client's currency.</p><textarea class="og-textarea op-request" rows="3" placeholder="What exactly do you need?"></textarea><div class="op-ask-row"><button type="button" class="poster-slab poster-slab--control">Ask</button><span class="op-warn">It sends mail outside: external send</span></div><div class="op-result">The request went to invoice-drafter.<small>Provenance: invoice-drafter · task t-123</small></div></div>`) },
  ] },
  'rating-stars': { variants: [
    { name: 'to give', render: () => root(html`<${Stars} value=${3} onPick=${noop} label="Rate the delivery" />`) },
    { name: 'to give, being sent', render: () => root(html`<${Stars} value=${4} onPick=${noop} disabled label="Rate the delivery" />`) },
    { name: 'shown in a line', render: () => root(html`<p>Creative <${Stars} value=${4} /> 4.0</p>`) },
    { name: 'row, beside a status', render: () => root(html`<${Mark} kind="status" tone="fine">done<//><${Stars} value=${4} row />`) },
    { name: 'none given', render: () => root(html`<${Stars} value=${0} />`) },
  ] },
  'job-prompt': { variants: [
    { name: 'title and body', render: () => root(html`<${JobPrompt} label="Creates each run" title="Morning digest" body="Read every workspace I belong to and list the open questions first." />`) },
    { name: 'title only', render: () => root(html`<${JobPrompt} label="Creates each run" title="Check the mailbox for Nordic Ferries" />`) },
    { name: 'long', render: () => root(html`<${JobPrompt} label="Creates each run" title=${LONG} body=${'Read the ferry timetable at https://example.org/nordic-ferries/timetables/autumn-2026/harbour-line-a-very-long-address and tell me what changed.\nThen write it to wf/ferries/changes.'} />`) },
  ] },
  'progress-steps': { variants: [
    { name: 'one step done, one running', render: () => root(html`<${ProgressSteps} steps=${['Reading the note', 'Finding where it belongs', 'Writing the suggestion']} at=${1} />`) },
    { name: 'in a dialog', render: () => root(html`<${ProgressNow} label="Loading…" title="The AI reads the response" step="Finding where it belongs" />`) },
    { name: 'long step', render: () => root(html`<${ProgressSteps} steps=${['Reading the note', LONG, 'Writing the suggestion']} at=${2} />`) },
  ] },
};
