/**
 * @file src/services/ui-library/entries-views-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the special views of Settings & Controls about work: automation, offers and the calibrator. The purpose half only; facts.generated.ts carries what the
 *   files say.
 * @structure WORK_VIEW_ENTRIES
 * @usage import { WORK_VIEW_ENTRIES } from './entries-views-work.js';
 * @version-history
 *   v1.2.0 — 2026-09-27 — The Score chart, Offer map, Offer request, Rating stars, Week rhythm, Job chips,
 *     Workflow steps, Morsel flow, Schedule calendar and Ecosystem automation move here from
 *     entries-settings.ts (past its length limit), each rewritten to its component's API; the Offer
 *     request is unused (no page writes its classes now).
 *   v1.1.0 — 2026-09-27 — The task graph, the series bars, the peek, the plan steps, the run view and
 *     the step strip: each a component with its own sheet (the catalogue pass, work views).
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import type { UiEntryWritten } from './types.js';

export const WORK_VIEW_ENTRIES: UiEntryWritten[] = [
    {
        id: 'task-graph', name: 'TaskGraph', kind: 'component', status: 'active',
        summary: 'The order of a crew\'s tasks as a picture: each task a grey box in a thin frame with its id in bold typewriter and its agent in small grey words, a coral arrow from a task to each task that reads it, the tasks laid out in rows by how deep they read. A task the check found a problem in has a danger-coloured frame. It scrolls sideways when it is wider than its place.',
        module: '/components/TaskGraph.js', sheet: '/css/components/task-graph.css',
        data: {
            shape: 'TaskGraph({ tasks, problemIds }) · layoutTasks(tasks) → { nodes, edges, width, height }',
            fields: {
                tasks: 'the crew\'s tasks in order, each { id, agent, context }: context names the earlier tasks it reads',
                problemIds: 'a Set of the indexes of the tasks the check anchored an error to',
                layoutTasks: 'the layout alone: a box per task and an edge per read, for a page that needs the numbers',
            },
        },
        useFor: ['Seeing in which order a crew\'s tasks run and which task reads which, beside the crew\'s editor.'],
        variants: [
            { name: 'problem', class: 'task-graph-node--problem', prop: 'problemIds', when: 'a task the check found a problem in' },
        ],
        example: { tasks: [{ id: 'collect', agent: 'bot' }, { id: 'draft', agent: 'invoice-drafter', context: ['collect'] }], problemIds: [] },
        note: 'Moved on 2026-09-26 out of views/profile/agents/crew-dag.js (TaskDag, which re-exports it) with its layout unchanged; its sheet was css/components/crew-dag.css (.pf-agd-crew-dag). With no tasks it draws nothing.',
    },
    {
        id: 'series-bars', name: 'SeriesBars', kind: 'component', status: 'active',
        summary: 'A short series of numbers as a strip of coral bars under a heavy ink rule, one bar per point, the highest at the strip\'s full height; each bar says its label and value as its tooltip.',
        module: '/components/SeriesBars.js', sheet: '/css/components/series-bars.css',
        data: {
            shape: 'SeriesBars({ series, height })',
            fields: {
                series: 'the points in order, each { label, value }',
                height: 'the strip\'s height in pixels, 56 by default; the width is the column\'s',
            },
        },
        useFor: ['A few numbers a person added over time, read at a glance: the aggregate part of a living document.'],
        variants: [
            { name: 'taller', prop: 'height', when: 'a strip with more room for the differences to show' },
        ],
        example: { series: [{ label: 'June', value: 12 }, { label: 'July', value: 18 }, { label: 'August', value: 9 }] },
        note: 'Moved on 2026-09-26 out of views/profile/living-tab.js (renderChart) and css/views/living.css (.pf-ld-chart), unchanged. With no points it draws nothing.',
    },
    {
        id: 'peek', name: 'Peek', kind: 'component', status: 'active',
        summary: 'A text shown three ways: its first line in grey cut with an ellipsis, its top 9rem under a fade, or all of it; a small square icon button takes it to the next way (⌄ shows more, ⌃ closes).',
        module: '/components/Peek.js', sheet: '/css/components/peek.css',
        data: {
            shape: 'Peek({ view, line, children }) · PeekToggle({ view, onToggle, label }) · nextPeek(view)',
            fields: {
                view: 'line | peek | full: how much of the text shows',
                line: 'the one line shown in the line way',
                children: 'the whole text (a Markdown) for the peek and full ways',
                onToggle: 'the press on the icon button; the page moves the way on with nextPeek',
                label: 'the icon button\'s name, as its tooltip and for a screen reader',
                nextPeek: 'the order of the ways: line, peek, full, line',
            },
        },
        useFor: ['A long note in a list of notes, where the person chooses how much of each to read.'],
        variants: [
            { name: 'line', class: 'peek-line', prop: 'view="line"', when: 'only the first line, so many notes fit on the screen' },
            { name: 'peek', class: 'peek--peek', prop: 'view="peek"', when: 'the top of the text under a fade' },
            { name: 'full', prop: 'view="full"', when: 'all of the text' },
        ],
        example: { view: 'peek', line: 'Call Nordic Ferries about the seat map', children: 'Call Nordic Ferries about the seat map. They want the new layout by Friday…' },
        note: 'Built on 2026-09-26 from the Notebook note\'s three views (.pf-nb-note-text, its --peek fade and .pf-nb-note-line in css/views/notebook.css), with the look they had.',
    },
    {
        id: 'plan-steps', name: 'PlanSteps', kind: 'component', status: 'active',
        summary: 'The steps of a plan the AI made, one under the other, each under the section rule: a head in a line (a tag, the title in bold, what stands after it), the lines about it, and its ways at its foot. A step done is dimmed a little and a step skipped more; a step to pick has a check box before its title; the grey line in italics says why.',
        module: '/components/PlanSteps.js', sheet: '/css/components/plan-steps.css',
        data: {
            shape: 'PlanSteps({ children }) · PlanStep({ state, pick, before, title, after, doors, children }) · PlanNote({ children })',
            fields: {
                state: 'done | skipped: a step already done, or one left out',
                pick: '{ checked, onChange(checked, e), disabled }: the title is the words of a check box',
                before: 'what stands before the title: the step\'s kind as a tag',
                title: 'the step, in bold',
                after: 'what stands after the title: the agent it goes to, a status, where a piece goes',
                doors: 'the ways at the step\'s foot',
                children: 'the lines under the head, often a PlanNote',
                PlanNote: 'the grey line in italics: the plan\'s summary, a step\'s reason, what a step waits for',
            },
        },
        useFor: ['A plan the AI proposes for one thing, step by step, where the person runs, picks or skips each step.'],
        variants: [
            { name: 'done', class: 'plan-step--done', prop: 'state="done"', when: 'a step already done' },
            { name: 'skipped', class: 'plan-step--skipped', prop: 'state="skipped"', when: 'a step left out' },
            { name: 'to pick', class: 'plan-step-pick', prop: 'pick', when: 'a step the person takes or leaves with a check box: a piece of a note to split off' },
            { name: 'why', class: 'plan-note', prop: 'PlanNote', when: 'the reason for a step, or the plan\'s summary' },
        ],
        example: { steps: [{ kind: 'link', title: 'Link the note to Nordic Ferries', state: 'done' }, { kind: 'task', title: 'Ask invoice-drafter for a quote', after: 'invoice-drafter' }] },
        note: 'Built on 2026-09-26 from a Notebook note\'s enrich plan and its split pieces (.pf-nb-plan-steps, .pf-nb-plan-step, .pf-nb-chunk-pick, .pf-nb-enrich-summary, .pf-nb-suggest-reason in css/views/notebook.css), with the values unchanged.',
    },
    {
        id: 'run-view', name: 'RunView', kind: 'component', status: 'active',
        summary: 'What opens under a run of several models: its steps as rows that fold open, each model\'s block (a heavy ink edge on the grey ground, the name, the score as a figure, a typewriter line), the checkpoints a judge scored (a green ✓ or a coral ✗, expected, got, weight), two lists of proposals side by side, the numbered proposals with the chosen ones on coral, a folded output, the line under the options and the dashed box an answer is pasted into.',
        module: '/components/RunView.js', sheet: '/css/components/run-view.css',
        data: {
            shape: 'RunSteps({ children }) · RunStep({ num, name, right, done, open, onToggle, children }) · RunStepDoors({ children }) · RunCopies({ label, children }) · RunModel({ name, figure, tone, meta, children }) · RunChecks({ head, rows }) · RunColumns({ children }) · RunColumn({ label, children }) · RunProposals({ items }) · RunOutput({ label, children }) · RunApply({ note, children }) · RunPaste({ label, children })',
            fields: {
                RunStep: 'one step as a fold row: num, name, the mono word at the right (right), done (its number in green), open and onToggle; the body under it while open',
                RunStepDoors: 'the ways at a step\'s foot, under a dashed line',
                RunCopies: 'a small typewriter label and the copy actions after it',
                RunModel: 'one model\'s block: name, figure (the score) in tone fine | notice | dim, meta (a typewriter line); the children under the head',
                RunChecks: 'head = [mark, checkpoint, expected, got, weight]; rows = [{ key, pass, name, description, expected, actual, weight }]',
                RunColumn: 'one of two columns side by side, with its row label',
                RunProposals: 'items = [{ key, n, chosen, text, notes, tags: [{ label, tone }] }]: the chosen ones\' numbers on coral',
                RunOutput: 'a long output folded behind its label, shown as a code block',
                RunApply: 'the line under the options: the loud action and its copy, with note in typewriter under them',
                RunPaste: 'the dashed box an answer is pasted into, its row label on top',
            },
        },
        useFor: ['The opened run of a calibration: how each model answered, how a judge scored it, and what to change next.'],
        variants: [
            { name: 'passed', class: 'run-check-pass', prop: 'rows[].pass', when: 'a checkpoint the answer met' },
            { name: 'failed', class: 'run-check-fail', prop: 'rows[].pass = false', when: 'a checkpoint the answer missed' },
            { name: 'chosen', class: 'is-on', prop: 'items[].chosen', when: 'a proposal the chosen option takes' },
            { name: 'paste', class: 'run-paste', prop: 'RunPaste', when: 'the person brings back an answer from their own chat' },
        ],
        example: { steps: ['Generate', 'Analyze', 'Reflect', 'Synthesize'], models: [{ name: 'Mistral Small 3.2', figure: '82 %', tone: 'fine' }] },
        note: 'Built on 2026-09-26 from the opened run of views/profile/calibrator/run.js, which it replaced: the markup of css/components/calibration-run.css (.cal-steps … .cal-paste) and the folded output of css/views/calibrator-poster.css (.cal-pre), under the component\'s own class names. A step\'s row is the fold row (components/Folds.js).',
    },
    {
        id: 'step-strip', name: 'StepStrip', kind: 'component', status: 'active',
        summary: 'The steps of an automation as small framed boxes in a line that wraps: each step\'s name in bold with a typewriter line under it, pressed to open that step. The frame is coral under the pointer, green when the step\'s last run went through, coral on a coral-tinted ground when it failed; in a chain a grey arrow stands between two steps.',
        module: '/components/StepStrip.js', sheet: '/css/components/step-strip.css',
        data: {
            shape: 'StepStrip({ steps, chain })',
            fields: {
                steps: '[{ key, name, sub, state, onOpen, title }]: sub is who runs it or how its last run went; state = done | failed, or nothing for a step not run yet',
                chain: 'the steps run one after the other: an arrow between two steps',
            },
        },
        useFor: ['An automation\'s steps under its row, when a person reads where it went through and where it stopped.'],
        variants: [
            { name: 'chain', class: 'step-strip-arrow', prop: 'chain', when: 'the steps run one after the other' },
            { name: 'done', class: 'step-strip-step--done', prop: 'steps[].state="done"', when: 'the step\'s last run went through' },
            { name: 'failed', class: 'step-strip-step--failed', prop: 'steps[].state="failed"', when: 'the step\'s last run failed or stalled' },
        ],
        example: { chain: true, steps: [{ name: 'Collect the hours', sub: 'bot', state: 'done' }, { name: 'Draft an invoice', sub: 'invoice-drafter', state: 'failed' }] },
        note: 'Built on 2026-09-26 from the Offers page\'s "runs on its own" lines, with the values of offer-lines.css (.op-steps, .op-step, .op-arrow); the line itself is the List with the strip in its row.',
    },
    // Moved here from entries-settings.ts on 2026-09-27 (that file had passed its length limit), each
    // rewritten to its component's API in the same pass.
    {
        id: 'score-chart', name: 'Score chart', kind: 'component', status: 'active',
        summary: 'Scores from 0 to 100 % over a row of rounds, in the Object box: one line per series (ink, then coral, then sun, then the usage colours), the oldest round on the left with its name over a grey line, the legend beside the plot with a square in each line\'s colour, the name and the last score. A point says its series, score and round as its tooltip. On a phone the legend goes under the plot.',
        module: '/components/ScoreChart.js', sheet: '/css/components/score-chart.css',
        data: {
            shape: 'ScoreChart({ title, rounds, series }) · colorAt(i)',
            fields: {
                title: 'what the chart shows: the legend\'s heading and the picture\'s name for a screen reader',
                rounds: 'the x axis, oldest first: [{ key, label, sub }], the label in ink over the sub in grey',
                series: '[{ key, label, values }]: one value per round, null where the series has no score in it',
                colorAt: 'the colour of the i-th series, for a page that names it elsewhere',
            },
        },
        useFor: ['How the scores of a few models moved over a series of runs.'],
        variants: [
            { name: 'one round', prop: 'rounds.length = 1', when: 'the first run: a point per series in the middle, no line yet' },
        ],
        example: { title: 'Score per run', rounds: [{ key: 'r1', label: 'Run 1', sub: 'v1' }, { key: 'r2', label: 'Run 2', sub: 'v2' }], series: [{ key: 'm', label: 'Mistral Small 3.2', values: [54, 82] }, { key: 'g', label: 'Gemini 2.5 Flash', values: [71, 77] }] },
        note: 'Moved on 2026-09-25 from calibrator-poster.css; on 2026-09-26 the plot and the legend moved out of views/profile/calibrator/chart.js into this component with its own class names (.score-chart, .score-chart-legend, .score-chart-swatch in place of .cal-chart and .cal-legend). The calibrator\'s chart.js still turns its runs into rounds and series. With no round or no score it draws nothing.',
    },
    {
        id: 'offer-map', name: 'Offer map', kind: 'component', status: 'active',
        summary: 'Every offer at once, grouped by the need it answers, read four ways: columns (one per need), a grid (a row per agent, a column per need, scrolling inside when the page is narrow), blocks (one per need, wider the more it holds) or a tree (a flowchart). An offer is a framed tile that opens its own page in a new tab, with its title, a small "opens elsewhere" mark and its agent\'s tag; the frame and the mark turn coral under the pointer. A need\'s head carries its count in typewriter letters.',
        module: '/components/OfferMap.js', sheet: '/css/components/offer-map.css',
        data: {
            shape: 'OfferMap({ mode, groups, chart, onPick, agentLabel })',
            fields: {
                mode: 'columns | grid | tiles | tree: how the offers are laid out (columns by default)',
                groups: '[{ key, label, items: [{ key, title, href, agent, online, mark }] }]: a need and its offers; mark is the agent\'s tag (a Mark with its presence), online false dims the agent in the grid',
                chart: 'the flowchart source of the tree (Mermaid)',
                onPick: 'onPick(groupIndex, itemIndex): a press on an offer in the tree',
                agentLabel: 'the grid\'s first column head',
            },
        },
        useFor: ['Seeing every offer at once, grouped by what it is for.'],
        variants: [
            { name: 'columns', class: 'offer-map-cols', prop: 'mode="columns"', when: 'a column per need, as many as fit at 10rem' },
            { name: 'grid', class: 'offer-map-grid', prop: 'mode="grid"', when: 'who offers what: a row per agent, a column per need, each tile a line' },
            { name: 'blocks', class: 'offer-map-blocks', prop: 'mode="tiles"', when: 'a block per need that grows with its count, each tile compact' },
            { name: 'tree', class: 'offer-map-scroll', prop: 'mode="tree"', when: 'the needs and offers as a flowchart; a press on an offer picks it' },
            { name: 'away', class: 'offer-map-grid-agent--off', prop: 'items[].online = false', when: 'an agent that is not present, dimmed in the grid' },
        ],
        example: { mode: 'columns', groups: [{ key: 'write', label: 'Write', items: [{ key: 'inv', title: 'Draft an invoice', agent: 'invoice-drafter', online: true }] }, { key: 'find', label: 'Find', items: [{ key: 'web', title: 'Search the web', agent: 'bot', online: false }] }] },
        note: 'Moved on 2026-09-25 from offers-poster.css; on 2026-09-26 it became components/OfferMap.js with its own class names (.offer-map-*), the grid\'s column cuts main had (n1 to n6) and a block\'s growth by its count in place of the inline --op-n. The sheet\'s old op- rules (.op-tile, .op-cols, .op-matrix, .op-mx-*, .op-blocks) were written only by the design lab\'s old demo.',
    },
    {
        id: 'offer-request', name: 'Offer request', kind: 'component', status: 'unused',
        summary: 'Asking an offer, as the Offers page once wrote it by hand: what the offer does in a reading size, the request field, the row with the button and its coral-framed warnings, and what came of it beside a sun edge with the provenance in typewriter. No page writes these classes now; the offer\'s page draws the same parts with the kit.',
        module: null, sheet: '/css/components/offer-request.css', classes: ['op-ask', 'op-request', 'op-ask-row', 'op-warn', 'op-result'],
        data: { shape: '<p class="op-ask">…</p><textarea class="og-textarea op-request"></textarea><div class="op-ask-row"><button class="poster-slab">Ask</button><span class="op-warn">…</span></div><div class="op-result">…<small>…</small></div>', fields: { ask: 'what the offer does', warn: 'what to know before asking', result: 'what happened, and who did it' } },
        useFor: ['Asking one agent\'s offer from its page.'],
        variants: [],
        example: { ask: 'Draft an invoice from the hours logged this month.' },
        note: 'Moved on 2026-09-25 from offers-poster.css with its class names. Since 2026-09-26 views/profile/offers/offer-page.js (renderOffer) draws the request with the kit instead: the ask a lead Note, the request a TextArea, the send a Loud control with the warnings beside it as the small aside Note (the irreversible tone for an effect that cannot be undone), and what came of it a Box in the edge tone with a typewriter Note. Only the design lab\'s demo writes these classes; the sheet stays until Jouni says keep or delete.',
    },
    {
        id: 'rating-stars', name: 'Rating stars', kind: 'component', status: 'active',
        summary: 'Five stars, the given ones dark and the others as grey outlines, so 4 of 5 reads at a glance. To give a rating each star is a button that says its number, and the stars up to the one under the pointer turn dark; to read one, the stars are a smaller picture whose words for a screen reader are "4/5".',
        module: '/components/Stars.js', sheet: '/css/components/rating-stars.css',
        data: {
            shape: 'Stars({ value, onPick, row, disabled, label })',
            fields: {
                value: 'the rating, 0 to 5 (rounded and held to that range)',
                onPick: 'onPick(n): the stars are buttons that give n; without it the stars are only read',
                row: 'the read stars small enough to stand beside a status in a narrow column',
                disabled: 'the buttons do nothing now (a rating being sent)',
                label: 'the name of the stars to give, for a screen reader',
            },
        },
        useFor: ['Rating a delivery an agent made.', 'A rating read in a line: a review, a rated task.', 'A rating in a narrow table column beside a status: the row cut.'],
        variants: [
            { name: 'to give', class: 'stars-star', prop: 'onPick', when: 'the person rates: five buttons' },
            { name: 'given', class: 'on', prop: 'value', when: 'a star up to the rating' },
            { name: 'shown', class: 'stars--shown', prop: 'no onPick', when: 'a rating you read in a line, not pressable' },
            { name: 'row', class: 'stars--row', prop: 'row', when: 'the shown tone cut small (.7rem) for a narrow column beside a status, as in a delivery row' },
        ],
        example: { value: 4 },
        note: 'Moved on 2026-09-25 from offers-poster.css with its class names (.op-stars, .op-star: the library\'s names, kept). On 2026-09-26 every star rating in Settings & Controls took it (Jouni\'s decision "Rating stars"): the Offers, an agent\'s Quality and Tasks, the rate dialog, the Work tab; the same day components/Stars.js began to draw it from data. On 2026-09-27 it took its own class names (.stars, .stars-star, .stars--shown, .stars--row; a move, every rule kept) and the sheet\'s rating row (.op-rate, .op-rate-note) went: nothing wrote it, the pages lay out that row with the kit.',
    },
    {
        id: 'week-rhythm', name: 'Week rhythm', kind: 'component', status: 'active',
        summary: 'A week at a glance: one row per repeating job with its time in typewriter, its name as the way into it with a typewriter note, a mark on each day it fires and the last time it ran; the days as columns under their heads, today\'s column on a pale sun under a sun head. A mark is coral when an agent does the job and faint on a day it does not fire. On a narrow screen the last run and the note go.',
        module: '/components/WeekRhythm.js', sheet: '/css/components/week-rhythm.css',
        data: {
            shape: 'WeekRhythm({ heads, days, rows })',
            fields: {
                heads: '{ time, name, last }: the words over the time, name and last-run columns',
                days: '[{ key, label, sub, today }]: the day columns, a weekday over its date; today on the sun',
                rows: '[{ key, time, name, note, onOpen, openLabel, days, agent, last }]: days is seven true or false, one per column; agent marks an agent\'s job; onOpen makes the name the way into the job',
            },
        },
        useFor: ['Which schedules fire on which days of this week.'],
        variants: [
            { name: 'today', class: 'week-rhythm-today', prop: 'days[].today', when: 'today\'s column' },
            { name: 'agent', class: 'week-rhythm-day--agent', prop: 'rows[].agent', when: 'an agent does the job' },
            { name: 'no', class: 'week-rhythm-day--no', prop: 'rows[].days[i] = false', when: 'it does not fire that day' },
        ],
        example: { heads: { time: 'Time', name: 'Schedule', last: 'Last run' }, rows: [{ time: '06:00', name: 'Morning digest', note: 'every day', agent: true, last: 'today 06:00' }] },
        note: 'Moved on 2026-09-25 from scheduler-poster.css with its class names; on 2026-09-26 it became components/WeekRhythm.js, which the Scheduler page gives its data. On 2026-09-27 it took its own class names (.week-rhythm, .week-rhythm-*; .week-rhythm-open for the name it drew as .og-tbl-name), every rule kept.',
    },
    {
        id: 'job-chips', name: 'Job chips', kind: 'component', status: 'active',
        summary: 'Jobs that run all the time, as a wrapping row of framed buttons: the name in bold, how often in typewriter; coral under the pointer, a coral frame when the last run failed. A press opens the job.',
        module: '/components/JobChips.js', sheet: '/css/components/job-chips.css',
        data: {
            shape: 'JobChips({ items })',
            fields: { items: '[{ key, name, note, warn, title, onOpen }]: note says how often it runs; warn marks a job whose last run failed; title is the tooltip' },
        },
        useFor: ['Jobs that run all the time, each one opens its page.'],
        variants: [{ name: 'warn', class: 'job-chips-job--warn', prop: 'items[].warn', when: 'its last run failed' }],
        example: { items: [{ key: 'mail', name: 'Check the mailbox', note: 'every 30 min · ~48/day' }] },
        note: 'Moved on 2026-09-25 from scheduler-poster.css with its class names; on 2026-09-26 it became components/JobChips.js, which the Scheduler page gives its data. On 2026-09-27 it took its own class names (.job-chips, .job-chips-job, .job-chips-job--warn), every rule kept.',
    },
    {
        id: 'workflow-steps', name: 'Workflow steps', kind: 'component', status: 'active',
        summary: 'A workflow\'s steps, one per row with a rule under it: the number in coral typewriter, the name in bold with its agent in typewriter under it, what it takes and gives in grey lines (a memory key in typewriter), anything more the step shows, and on the right its state as a Status with what was seen, a line each. On a narrow screen the state goes under the words.',
        module: '/components/WorkflowSteps.js', sheet: '/css/components/workflow-steps.css',
        data: {
            shape: 'WorkflowSteps({ steps })',
            fields: {
                steps: '[{ key, num, title, sub, lines, extra, state, notes }]',
                sub: 'the agent that does the step',
                lines: 'what it takes and gives: words, or { text, code: true } for a memory key',
                extra: 'anything more the step shows (the pictures it made)',
                state: '{ word, tone }: the step\'s state as a Status, tone fine | attention | danger | off',
                notes: 'what was seen, a line each under the state',
            },
        },
        useFor: ['The steps of a chain of agent jobs, and how each went in a run.'],
        variants: [
            { name: 'key', class: 'workflow-steps-line--key', prop: 'lines[] = { text, code: true }', when: 'the memory key a step writes, in typewriter' },
            { name: 'state', prop: 'state', when: 'a run: how each step went, with what was seen' },
        ],
        example: { steps: [{ key: 'hours', num: '01', title: 'Collect the hours', sub: 'invoice-drafter', lines: ['First. Takes the month.', { text: 'writes wf/invoice/hours', code: true }], state: { word: 'produced', tone: 'fine' }, notes: ['3 rows seen'] }] },
        note: 'Moved on 2026-09-25 from workflows-poster.css with its class names; on 2026-09-26 it became components/WorkflowSteps.js, which the Workflows page (a workflow and one of its runs) gives its data. On 2026-09-27 it took its own class names (.workflow-steps-step, -num, -body, -line, -line--key, -state), every rule kept.',
    },
    {
        id: 'morsel-flow', name: 'Morsel flow', kind: 'component', status: 'active',
        summary: 'Where the morsels came from and where they went, and how fast the balance fills: two columns side by side, each in the Object box, headed by its total as a poster figure (green for what came in, coral for what went out) with a typewriter count at the head\'s right end, then its sources one per row with the sum at the right. The pace is a sentence beside the one Meter. One column on a phone.',
        module: '/components/MorselFlow.js', sheet: '/css/components/morsel-flow.css',
        data: {
            shape: 'MorselFlow({ columns }) · MorselPace({ title, words, pct, figure })',
            fields: {
                columns: '[{ key, total, tone, title, count, rows, empty }]: total is the figure at the head in tone fine (came in) | notice (went out); title the words after it; count the typewriter line at the right; empty the grey line when there are no rows',
                rows: '[{ key, title, sub, sum }]: a source, a typewriter line under it, its sum',
                title: 'the pace sentence\'s bold start',
                words: 'the rest of the pace sentence',
                pct: 'how full the meter is, 0 to 100',
                figure: 'the words on the meter: the balance of the cap',
            },
        },
        useFor: ['The morsel balance\'s flow on the Wallet page.'],
        variants: [
            { name: 'came in', prop: 'tone="fine"', when: 'the column of what came in: its total in green' },
            { name: 'went out', prop: 'tone="notice"', when: 'the column of what went out: its total in coral' },
            { name: 'empty', class: 'morsel-flow-src--empty', prop: 'rows = []', when: 'a column with no rows: its grey line' },
            { name: 'pace', class: 'morsel-pace', prop: 'MorselPace', when: 'how fast the balance fills, beside the meter' },
        ],
        example: { columns: [{ key: 'in', total: '+120', tone: 'fine', title: 'Came in', count: '12 rows', rows: [{ key: 'accrual', title: 'Daily accrual', sub: '30 times', sum: '+90' }] }, { key: 'out', total: '-40', tone: 'notice', title: 'Went out', rows: [] }] },
        note: 'Moved on 2026-09-25 from wallet-poster.css; on 2026-09-26 it became components/MorselFlow.js with its own class names (.morsel-flow, .morsel-flow-col, .morsel-flow-head, .morsel-flow-count, .morsel-flow-src, .morsel-pace); the numerals are the Figure and the bar the one Meter, so .wal-pace and .wal-bar went. The sheet\'s old .wal-flow, .wal-col, .wal-col-h and .wal-src rules were written only by the design lab\'s old demo. What morsels buy is the Item grid.',
    },
    {
        id: 'schedule-calendar', name: 'Schedule calendar', kind: 'component', status: 'active',
        summary: 'The runs of scheduled jobs on a month, a week or a day: each run a chip striped in its kind\'s colour, today framed in coral, a legend of the kinds, the mode tabs and the ‹ Today › moves over it. The jobs that run too often for the grid stand in a "continuously running" strip above it, which shows six and then more, and can fold them into the grid as one ⟳ chip a day. A press on a run or a job opens that schedule.',
        module: '/components/ScheduleCalendar.js', sheet: '/css/components/schedule-calendar.css',
        data: {
            shape: 'ScheduleCalendar({ mode, onMode, onPrev, onNext, onToday, anchor, loading, truncated, events, frequent, kinds, hasSchedules, onJump, words }) · calendarWindow(mode, anchor) · shiftAnchor(mode, ms, dir) · readerToday() · startOfDay(d)',
            fields: {
                mode: 'month | week | day', onMode: 'a press on a mode tab', onPrev: '‹', onNext: '›', onToday: 'Today',
                anchor: 'the day the window is drawn around (a Date)',
                loading: 'the runs are loading: "· loading…" after the range', truncated: 'some later runs are left out: a line says so',
                events: '[{ at, scheduleId, kind, name, past }]: one run each; kind = ai | agent | ext | eco | core colours its stripe',
                frequent: '[{ scheduleId, kind, name, cadence, perDay, approxPerDay }]: the jobs too frequent to draw one chip a run',
                kinds: '[{ key, label }]: the legend',
                hasSchedules: 'there are schedules, so an empty window says "nothing in this range" rather than "none yet"',
                onJump: 'onJump(scheduleId): a press on a run or a job',
                words: 'the words it shows: month, week, day, prev, next, today, loading, truncated, noEvents, empty, frequentTitle, freqHideGrid, freqShowGrid, showLess, showMore(n), ran, upcoming, earlier, later',
                calendarWindow: 'the window a mode shows around its anchor, { start, end, title }: the page loads the runs for it',
            },
        },
        useFor: ['When scheduled things will run, when the time is what a person reads.'],
        variants: [
            { name: 'month', class: 'schedule-calendar-month', prop: 'mode="month"', when: 'six weeks of days, three runs a day and "+n"' },
            { name: 'week', class: 'schedule-calendar-week', prop: 'mode="week"', when: 'seven columns, every run of each day' },
            { name: 'day', class: 'schedule-calendar-day', prop: 'mode="day"', when: 'the hours from 06 to 22, the earlier and later runs above and under' },
            { name: 'today', class: 'schedule-calendar-cell--today', when: 'the day that is today, framed in coral (schedule-calendar-weekcol--today in a week)' },
            { name: 'past', class: 'schedule-calendar-ev--past', prop: 'events[].past', when: 'a run that has already happened' },
            { name: 'continuously running', class: 'schedule-calendar-freq', prop: 'frequent', when: 'jobs that run too often to draw one chip a run' },
            { name: 'cut short', class: 'schedule-calendar-trunc', prop: 'truncated', when: 'the window holds more runs than it draws' },
        ],
        example: { mode: 'week', kinds: [{ key: 'ai', label: 'AI' }, { key: 'agent', label: 'Agent task' }, { key: 'ext', label: 'Extension' }, { key: 'eco', label: 'Ecosystem app' }, { key: 'core', label: 'Core' }] },
        note: 'Moved unchanged out of views/scheduler.css on 2026-09-25; on 2026-09-26 it became components/ScheduleCalendar.js, which takes data (views/profile/scheduler-calendar.js keeps the loading and the words). The sheet\'s .schedule-calendar-ev--sec colour is not drawn: the calendar knows the kinds ai, agent, ext, eco and core, and any other kind is drawn as core, as on main. On 2026-09-27 it took its own class names (.sch-cal-* → .schedule-calendar-*), and its poster rules moved in from profile-poster.css; every rule kept.',
    },
    {
        id: 'eco-automation', name: 'Ecosystem automation', kind: 'component', status: 'active',
        summary: 'An ecosystem app\'s automation: its one flow as numbered steps in a card under the section rule (a coral number over each step, what the step sets under it, a rule between two steps, the one save at the card\'s foot), the latest run as a status timeline (a dot per stage on a line, in its state\'s colour, the stage\'s name in bold with its marks and what it says), and a job\'s run log (when in typewriter, how it went as a Status, what started it, how long it took, why it failed).',
        module: '/components/EcoAutomation.js', sheet: '/css/components/eco-automation.css',
        data: {
            shape: 'FlowCard({ save, children }) · FlowStep({ num, off, children }) · StatusTimeline({ title, children }) · StatusStep({ state, label, marks, children }) · RunLog({ rows })',
            fields: {
                save: 'the one action at the card\'s foot',
                num: 'the step\'s number and title line, in coral',
                off: 'a step that cannot be set now: greyed',
                title: 'the timeline\'s small heading',
                state: 'ok | wait | off | error: the colour of a stage\'s dot',
                label: 'the stage\'s name', marks: 'the tags beside the name (the agents)',
                rows: '[{ key, when, result: { word, tone }, trigger, duration, reason }]: a job\'s runs, newest first; tone is the Status tone fine | danger | off',
            },
        },
        useFor: ['Setting up what an outside app\'s data goes through, and seeing where its latest run is.'],
        variants: [
            { name: 'ok', class: 'eco-automation-dot--ok', prop: 'state="ok"', when: 'a stage that is done' },
            { name: 'wait', class: 'eco-automation-dot--wait', prop: 'state="wait"', when: 'a stage waiting for something' },
            { name: 'off', class: 'eco-automation-dot--off', prop: 'state="off"', when: 'a stage that is not set up' },
            { name: 'error', class: 'eco-automation-dot--error', prop: 'state="error"', when: 'a stage that failed' },
            { name: 'disabled step', class: 'eco-automation-step--off', prop: 'off', when: 'a step that cannot be set yet' },
            { name: 'run log', class: 'eco-automation-log', prop: 'RunLog', when: 'a job\'s past runs' },
        ],
        example: { steps: ['1. What this app produces', '2. Run on a schedule'], stages: [{ state: 'ok', label: 'Published' }, { state: 'wait', label: 'Processed' }, { state: 'off', label: 'Delivered' }] },
        note: 'Moved unchanged out of views/profile.css on 2026-09-25; on 2026-09-26 it became components/EcoAutomation.js, which the ecosystem tab gives its data for each connected app. On 2026-09-27 it took its own class names (.pf-eco-auto-* and .pf-eco-recipe-head → .eco-automation-*), and the card\'s poster rule moved in from profile-poster.css; every rule kept. The produced facts, the schedule\'s controls, a job\'s facts and doors and the agents\' tags are drawn by the kit now (Stack, Row, Check, Actions, Marks), so their rules went.',
    },
];
