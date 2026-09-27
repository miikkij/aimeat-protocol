/**
 * @file src/services/ui-library/entries-views-knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the special views of Settings & Controls about knowledge, organisms, documents and the account. The purpose half only; facts.generated.ts carries what the
 *   files say.
 * @structure KNOWLEDGE_VIEW_ENTRIES
 * @usage import { KNOWLEDGE_VIEW_ENTRIES } from './entries-views-knowledge.js';
 * @version-history
 *   v1.2.0 — 2026-09-27 — PagePreview's email and live (SitePreview folded in), from the admin pages.
 *   v1.1.1 — 2026-09-27 — SetupGuide draws its own names from setup-guide.css (formerly .ast-* in
 *     hello-mcp.css; a move).
 *   v1.1.0 — 2026-09-27 — The special views of the organism pages, the Memory and Access pages, the
 *     overview, Portfolio and the Agents page: activity-calendar, people, snapshot-timeline, mind-map,
 *     doc-view, qr-code, code-grid, stored-value, page-preview, number-band, open-card, how-to and
 *     setup-guide (the catalogue pass).
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import type { UiEntryWritten } from './types.js';

export const KNOWLEDGE_VIEW_ENTRIES: UiEntryWritten[] = [
    // The organism pages (page groups G2a and G2b).
    {
        id: 'activity-calendar', name: 'ActivityCalendar', kind: 'component', status: 'active',
        summary: 'A year of activity as a calendar: one small square per day, one column per week, each square split into four quarters that say four counts at once in green shades from pale to full; the month names over the weeks, the day names down the side, and a key under it that names the quarters and shows the shades from less to more. It scrolls sideways on a phone.',
        module: '/components/ActivityCalendar.js', sheet: '/css/components/activity-calendar.css',
        data: {
            shape: 'ActivityCalendar({ weeks, months, days, quarters, less, more })',
            fields: {
                weeks: 'the weeks, each seven days from Sunday: a day is null when it is still to come, or { title, levels: [a, b, c, d] }, its tooltip and the level 0 to 4 of its upper left, upper right, lower left and lower right quarter',
                months: 'one word per week: the month\'s short name where a month starts, else empty',
                days: 'the seven words down the side, empty where a day has none',
                quarters: 'the four words of the key, in the order of the levels',
                less: 'the word at the pale end of the shade key', more: 'the word at the full end',
            },
        },
        useFor: ['How busy a workspace was, day by day over a year, when four counts (documents and records, each as drafts and as published) matter at once.'],
        variants: [
            { name: 'level', class: 'activity-calendar-q--4', prop: 'weeks[].levels', when: 'a quarter\'s shade: level 0 is the grey ground, 1 to 3 more green, 4 the full green' },
            { name: 'to come', class: 'activity-calendar-day--future', prop: 'a day of null', when: 'a day of this week that is still to come: an empty place' },
        ],
        example: { months: ['Sep', '', '', '', 'Oct'], days: ['', 'Mon', '', 'Wed', '', 'Fri', ''], quarters: ['↖ Docs draft', '↗ Docs published', '↙ Records draft', '↘ Records published'], less: 'Less', more: 'More' },
        note: 'Was the heatmap (heatmap.css, .pj-hm-*) of views/profile/organisms/activity-panel.js; the activity panel of a workspace draws it.',
    },
    {
        id: 'people', name: 'People', kind: 'component', status: 'active',
        summary: 'Who takes part in a place, one person per Object box: a person mark and the name in bold, the person\'s tags, the node they come from in small grey letters when it is not this one, and a tally of what they did here; under that line the agents that act for them, each a small rounded chip with its own tally, green-rimmed when it is one of the viewer\'s own and dashed and dimmed when it is someone else\'s.',
        module: '/components/People.js', sheet: '/css/components/people.css',
        data: {
            shape: 'People({ children }) · Person({ name, marks, node, count, countTitle, children }) · AgentChips({ children }) · AgentChip({ own, ghost, title, count, countTitle, children })',
            fields: {
                name: 'the person', marks: 'their tags (you, creator, guest)', node: 'the node they come from, when it is not this one',
                count: 'how many things they did here (the tally; none drawn for 0)', countTitle: 'the tally\'s tooltip',
                children: 'People: the persons; Person: their agents (AgentChip); AgentChip: the agent\'s name',
                own: 'one of the viewer\'s own agents', ghost: 'someone else\'s agent, of which the viewer sees only what it did',
                title: 'the chip\'s tooltip (the agent\'s GAII)',
            },
        },
        useFor: ['The people of an organism or a workspace, each with the agents that act in their name.'],
        variants: [
            { name: 'own agent', class: 'agent-chip--own', prop: 'own', when: 'an agent of the person looking: a green rim' },
            { name: 'someone else\'s agent', class: 'agent-chip--ghost', prop: 'ghost', when: 'an agent the viewer only sees the work of: dashed and dimmed' },
            { name: 'from another node', class: 'people-node', prop: 'node', when: 'the person comes from another node: its name after theirs' },
        ],
        example: { name: 'sandbox', count: 14, agents: [{ name: 'bot', own: true, count: 9 }, { name: 'invoice-drafter', ghost: true, count: 2 }] },
        note: 'Was the People list (people-list.css) and the Agent chip (agent-chip.css), the .pj-part-* rules of views/profile/organisms/participants-panel.js; the People panel of an organism draws it.',
    },
    {
        id: 'snapshot-timeline', name: 'SnapshotTimeline', kind: 'component', status: 'active',
        summary: 'How a thing\'s shape grew, point by point: a diagram of the whole history on top over a hairline, then two columns, the points as a list (a date, what changed, the counts in small grey bold) with a grey edge on the left that turns coral on the chosen one, and beside it the picture of the chosen point. The columns stack on a phone.',
        module: '/components/SnapshotTimeline.js', sheet: '/css/components/snapshot-timeline.css',
        data: {
            shape: 'SnapshotTimeline({ diagram, points, picture })',
            fields: {
                diagram: 'the picture of the whole history (a Mermaid timeline)',
                points: '[{ key, date, event, counts, on, onPick }]: a point in time, what changed, the counts then, whether it is chosen, and what a press does',
                picture: 'the picture of the chosen point (a Mermaid map)',
            },
        },
        useFor: ['Going back through the history of an organism\'s structure and seeing it as it was at one point.'],
        variants: [
            { name: 'chosen', class: 'is-on', prop: 'points[].on', when: 'the point whose picture is shown: the coral edge on the grey ground' },
        ],
        example: { points: [{ date: '2026-09-02', event: 'Workspace Client briefs added', counts: '3 ws · 12 docs', on: true }, { date: '2026-08-20', event: 'Organism created', counts: '1 ws · 0 docs' }] },
        note: 'Was the Organism timeline (org-timeline.css, .pj-timeline-*) of views/profile/organisms/timeline-panel.js; the timeline panel of an organism draws it.',
    },
    {
        id: 'mind-map', name: 'MindMap', kind: 'component', status: 'active',
        summary: 'A structure map a person can press, in the Object box: the options that redraw it (drop-downs and check lines in one wrapping row of small grey words), the diagram, which scrolls when it is tall and dims a node under the pointer, and a hint under it; a node\'s heat colours it green, amber or red from the theme.',
        module: '/components/MindMap.js', sheet: '/css/components/mind-map.css',
        data: {
            shape: 'MindMap({ chart, options, onNode, hint })',
            fields: {
                chart: 'the diagram\'s Mermaid source (a node takes :::heat1, heat2 or heat3 for its heat)',
                options: '[{ kind: \'select\', key, label, value, options, onChange } | { kind: \'check\', key, label, checked, onChange }]: what redraws the map',
                onNode: 'called with { text, id, inNode } when a node is pressed: its words, the id of the flowchart node it is in, and whether it is in one',
                hint: 'the grey line under the map',
            },
        },
        useFor: ['An organism\'s structure drawn as a map, where a pressed node leads to the thing it names.'],
        variants: [
            { name: 'options', class: 'mind-map-options', prop: 'options', when: 'the map has ways to redraw it: which workspace, how deep, what to show' },
            { name: 'heat', class: 'heat1', prop: 'chart (:::heat1)', when: 'a node coloured by how much happens there: heat1 green, heat2 amber, heat3 red' },
        ],
        example: { chart: 'mindmap\n  root((Harbour Studio))\n    Client briefs\n    Price list', hint: 'Press a node to open it.' },
        note: 'Was the .pj-mindmap-* and .pj-mm-* rules of views/profile.css; views/profile/organisms/mindmap.js builds the chart and says where a node leads.',
    },
    {
        id: 'doc-view', name: 'DocView', kind: 'component', status: 'active',
        summary: 'A document as a person reads it: its bar (the title in bold and the tools after it), a line of facts under it, and the text, which keeps a reading width. Inside a workspace page the text stands on the page itself; alone, in its own window, it stands in the raised Object box with air inside. DocSplit puts the Markdown field and its preview side by side, one under the other on a phone.',
        module: '/components/DocView.js', sheet: '/css/components/doc-view.css',
        data: {
            shape: 'DocView({ title, tools, facts, framed, onClick, children }) · DocSplit({ children })',
            fields: {
                title: 'the document\'s name', tools: 'what stands after the title: which version, edit, publish, open in its own window',
                facts: 'created, saved, published', framed: 'the document stands alone: the text in the raised box',
                onClick: 'a press inside the text (a wiki link, a file)', children: 'DocView: the text (Markdown); DocSplit: the field and the preview',
            },
        },
        useFor: ['Reading one document of a workspace, on the workspace page or in its own window.', 'Editing a document\'s Markdown beside its preview (DocSplit).'],
        variants: [
            { name: 'framed', class: 'doc-view-body--framed', prop: 'framed', when: 'the document in its own window: the text in the raised box' },
            { name: 'split', class: 'doc-split', prop: 'DocSplit', when: 'the Markdown field and its preview side by side' },
        ],
        example: { title: 'Seat map study', facts: 'Created 2 Sep · saved today · published', children: '## Findings\nTwelve bookings asked for a window seat.' },
        note: 'Was .pj-doc-toolbar, .pj-doc-vtitle, .pj-doc-meta, .pj-doc-view and .pj-doc-grid of views/profile.css and views/organism.css; views/profile/organisms/document.js draws it.',
    },
    // The Access and Memory pages (page group G3).
    {
        id: 'qr-code', name: 'QrCode', kind: 'component', status: 'active',
        summary: 'A QR code to scan with a phone: the picture the server drew, 200 pixels square, on white in a thin frame whatever the theme, because a scanner reads dark on light. Nothing is drawn without a picture.',
        module: '/components/QrCode.js', sheet: '/css/components/qr-code.css',
        data: { shape: 'QrCode({ src, alt, size })', fields: { src: 'the picture (a data URL)', alt: 'what it is, for a screen reader', size: 'its width and height in pixels (200)' } },
        useFor: ['Setting up two-step sign-in: the code the authenticator app scans.'],
        variants: [],
        example: { src: 'data:image/png;base64,…', alt: 'QR code for your authenticator app' },
        note: 'Was .pf-2fa-qr of views/profile.css; the two-step sign-in section of the Access page draws it.',
    },
    {
        id: 'code-grid', name: 'CodeGrid', kind: 'component', status: 'active',
        summary: 'Short codes a person writes down or copies, each in the typewriter face, in a grid on the copy ground, so ten of them can be counted at a glance.',
        module: '/components/CodeGrid.js', sheet: '/css/components/code-grid.css',
        data: { shape: 'CodeGrid({ codes })', fields: { codes: 'the codes, in their order' } },
        useFor: ['The backup codes of two-step sign-in, shown once to be kept.'],
        variants: [],
        example: { codes: ['4f7k-29qm', 'b8rt-11xz', 'p0wd-73hc'] },
        note: 'Was .pf-2fa-codes of views/profile.css; the two-step sign-in section of the Access page draws it.',
    },
    {
        id: 'stored-value', name: 'StoredValue', kind: 'component', status: 'active',
        summary: 'A stored value, read the way it reads best: a text as prose in a reading width (Markdown when it reads like Markdown), a flat object as the Facts with each value\'s line breaks kept, anything else, or the value as written, as the Code block that scrolls after 60% of the window; a picture the value names stands over it, and the loading line while it comes.',
        module: '/components/StoredValue.js', sheet: '/css/components/stored-value.css',
        data: {
            shape: 'StoredValue({ value, name, raw, loadingLabel }) · looksLikeMarkdown(s)',
            fields: {
                value: 'the value; undefined while it loads', name: 'the key it is stored under (a picture\'s name can come from it)',
                raw: 'show the value as written (JSON for an object)', loadingLabel: 'the words of the loading line',
                looksLikeMarkdown: 'whether a text has a heading, a list, bold words or a link',
            },
        },
        useFor: ['Reading one memory record\'s value on its page.'],
        variants: [
            { name: 'prose', class: 'stored-value-prose', prop: 'value (a text)', when: 'a text: prose, or Markdown when it reads like it' },
            { name: 'as written', class: 'stored-value-raw', prop: 'raw', when: 'the value as it is stored, or a value that is neither a text nor a flat object' },
        ],
        example: { name: 'studio/prices/day-rate', value: { currency: 'EUR', day: 640, half_day: 360 } },
        note: 'Was renderValue of views/profile/memory-tab/cover.js with .mp-prose and .mp-raw; a memory record\'s page draws it.',
    },
    // The overview, Portfolio and the Agents page (page groups G8 and G1a).
    {
        id: 'page-preview', name: 'PagePreview', kind: 'component', status: 'active',
        summary: 'A web page shown as it will look, in the raised Object box with no inner air: a sandboxed frame (scripts run, nothing else is allowed) 34rem high, 24rem on a phone; the loading line until the page\'s text is there. An email shows where nothing in it runs, 600px wide on white. A live page of this site shows by its address, with its title as a row label, three ways over it (wide, phone, fold it away), a grey note under it, the link that opens it, and each of its parts numbered in an ink square as the list beside it numbers them.',
        module: '/components/PagePreview.js', sheet: '/css/components/page-preview.css',
        data: {
            shape: 'PagePreview({ title, srcdoc, loading, loadingLabel, email, live, src, href, openLabel, wideLabel, phoneLabel, foldLabel, unfoldLabel, note, markedNote, marks, refresh, empty })',
            fields: {
                title: 'the frame\'s name, for a screen reader; live: also the row label over it', srcdoc: 'the page\'s whole HTML', loading: 'the page is on its way', loadingLabel: 'the words of the loading line',
                email: 'an email as it reaches its reader: nothing in it runs (a sandbox with no permission), 600px wide and 420px high on the white ground, centred',
                live: 'a live page of this site by its address, beside the thing that arranges it', src: 'live: the frame\'s address', refresh: 'live: a new value loads the page again',
                href: 'live: the link that opens the page on its own', openLabel: 'live: that link\'s words',
                'wideLabel, phoneLabel, foldLabel, unfoldLabel': 'live: the words of the three ways (wide, phone width, fold it away and back)',
                note: 'live: the grey line under the frame', markedNote: 'live: added to the note while the parts are numbered',
                marks: 'live: { root, count }: the element whose children are the parts, and how many are shown; each part gets its number only when the count matches, since a wrong number is worse than none',
                empty: 'live: a line in the frame\'s place and nothing else (a page behind a sign-in)',
            },
        },
        useFor: ['Seeing a published page before it goes out, such as a portfolio.', 'An operator\'s email template before it is sent (email), and the front page beside the list that arranges its parts (live).'],
        variants: [
            { name: 'loading', prop: 'loading, or no srcdoc', when: 'the page\'s text is not there yet' },
            { name: 'email', class: 'page-preview-frame--mail', prop: 'email', when: 'an email template: nothing runs, 600px on white (the operator\'s Email page)' },
            { name: 'live', class: 'page-preview-live', prop: 'live src', when: 'the front page by its address, with its three ways, its note and its link (the operator\'s Portal page)' },
            { name: 'live, phone', class: 'page-preview-live-frame--phone', prop: 'live (the phone way pressed)', when: 'the same page at a phone\'s width' },
            { name: 'live, nothing to show', class: 'page-preview-live-empty', prop: 'live empty', when: 'a page behind a sign-in: a line in the frame\'s place' },
        ],
        example: { title: 'Lumo Bakery portfolio', srcdoc: '<h1>Lumo Bakery</h1><p>Seasonal bread, baked at five.</p>' },
        note: 'Was .pf-prev and .pf-prev-frame of the Portfolio page (views/profile/portfolio/page.js). On 2026-09-27 it took the admin Email page\'s template preview (email, main\'s .adm-em-stage) and folded in SitePreview, the admin Portal page\'s live preview (live, main\'s .adm-pt-pv* and .adm-pt-frame); SitePreview.js and site-preview.css are gone, their look is page-preview.css\'s .page-preview-live*. The numbers inside the framed page carry their own look, since no sheet of this page reaches into the frame.',
    },
    {
        id: 'number-band', name: 'NumberBand', kind: 'component', status: 'active',
        summary: 'The numbers of an account on a diagonal coral band with a sun stripe under it: each number big in the poster face with its word in small capitals under it, a door to the page it counts that turns sun under the pointer. No numbers, no band. The fitted band is as tall as its numbers, so a second row still stands on the coral; on a phone it is a solid coral block in two columns with the sun flat along its foot.',
        module: '/components/NumberBand.js', sheet: '/css/components/number-band.css',
        data: {
            shape: 'NumberBand({ items, fitted })',
            fields: {
                items: '[{ key, icon, n, label, onOpen, fine }]: the number, its word, where it leads; `fine` marks something earned (morsels); `icon` is said to nobody',
                fitted: 'the band as tall as its numbers, the sun stripe near its foot, the words in the body face; in it a number without onOpen is a figure, not a door',
            },
        },
        useFor: ['The overview of Settings & Controls: how much the person has, each number a way to where it is.',
            'The app catalogue\'s counts over its lists and over an opened app (fitted): numbers to read, not doors.'],
        variants: [
            { name: 'earned', class: 'number-band-value--fine', prop: 'items[].fine', when: 'a number that counts something earned, such as morsels' },
            { name: 'fitted', class: 'number-band--fitted', prop: 'fitted', when: 'numbers to read, one row or two, on a band that fits them' },
            { name: 'figure', class: 'number-band-item--figure', prop: 'fitted, an item without onOpen', when: 'a number that only says its figure: no pointer, no sun under it' },
        ],
        themeHooks: { selector: '.number-band', hooks: [
            { name: '--number-band-ground', kind: 'colour', default: 'var(--accent)', what: 'the band' },
            { name: '--number-band-stripe', kind: 'colour', default: 'var(--sun)', what: 'the stripe under the band, and a number under the pointer' },
            { name: '--number-band-ink', kind: 'colour', default: 'var(--bg)', what: 'the numbers and their words on the band' },
        ] },
        example: { items: [{ key: 'memory', n: 128, label: 'Memories' }, { key: 'agents', n: 3, label: 'Agents' }, { key: 'morsels', n: 420, label: 'Morsels', fine: true }] },
        note: 'Was the ProfileCard\'s stats of views/profile/landing-page.cards.js (.pf-lp-stat*); its own names since 2026-09-27. The numbers keep the band\'s ink whatever colour a style gives big numbers, so Pebble no longer draws them in its accent on its accent band. fitted came with appcat (2026-09-27): it draws the old app catalogue\'s band (.cat-band) over the lists and in an opened app\'s head.',
    },
    {
        id: 'open-card', name: 'OpenCard', kind: 'component', status: 'active',
        summary: 'One thing of a list opened in place as a card of its own: its name as a full-width section title after a small sun ▼ that closes it, under it the thing\'s words (an id line, a row of marks, what a mark opened) and a side column at the right, then lines between hairlines that each say one thing with a way to change it, tabs in labelled groups with the chosen one on the sun, and the chosen tab\'s panel beside the sun edge. The card ends in the heavy rule.',
        module: '/components/OpenCard.js', sheet: '/css/components/open-card.css',
        data: {
            shape: 'OpenCard({ title, onClose, id, marks, more, side, children }) · CardLine({ label, below, children }) · TabGroups({ groups, value, onSelect }) · CardPanel({ children })',
            fields: {
                title: 'the thing\'s name', onClose: 'a press on the headline or the free part of the mast; without it the headline closes nothing',
                id: 'the first line under the name (a control that copies the id)', marks: 'tags, statuses, a switch, a tag field',
                more: 'what a mark opened, the words\' whole width', side: 'the column at the right: a sticker, links out',
                label: 'CardLine: the row label', below: 'CardLine: a control that opens under the line',
                groups: 'TabGroups: [{ key, label, items: [{ value, label, dot }] }]; `dot` new, or failed in the danger colour; a group with no items is left out',
                value: 'the chosen tab', onSelect: 'called with a tab\'s value', children: 'OpenCard: the lines, notices, tabs and panel; CardPanel: the tab\'s content',
            },
        },
        useFor: ['An agent opened from the list of agents, with everything about it in one card.'],
        variants: [
            { name: 'closes', class: 'open-card-title--closes', prop: 'onClose', when: 'the card closes from its headline (in a list); without it the card is the whole window' },
            { name: 'with a side', class: 'open-card-side', prop: 'side', when: 'something at the right: the one way to change it, links out' },
            { name: 'a line', class: 'open-card-line', prop: 'CardLine', when: 'one thing said with its way to change it, between hairlines' },
            { name: 'tab groups', class: 'open-card-tabs', prop: 'TabGroups', when: 'many tabs, sorted under group words' },
        ],
        example: { title: 'invoice-drafter', id: 'invoice-drafter#sandbox@aimeat-local-001-dev', groups: [{ key: 'work', label: 'Work', items: [{ value: 'tasks', label: 'Tasks', dot: 'new' }, { value: 'offers', label: 'Offers' }] }] },
        note: 'Was the opened agent of the Agents page (agp-card, agp-mast, agp-runs, agp-nav, agp-panel of views/profile/agents/agent-card.js and css/views/agents-poster.css).',
    },
    {
        id: 'how-to', name: 'HowTo', kind: 'component', status: 'active',
        summary: 'A short written how-to for one platform: numbered steps in reading lines, the commands to type in coral typewriter letters on a pale coral patch, a link to a runtime. It draws HTML a developer wrote into the code, never words a user or an agent supplied.',
        module: '/components/HowTo.js', sheet: '/css/components/how-to.css',
        data: { shape: 'HowTo({ html })', fields: { html: 'the steps as HTML, from a constant in the code (views/profile/agents/connect-prompts.js PLATFORMS)' } },
        useFor: ['The Agents page\'s steps for a person who has no Node.js yet, platform by platform.'],
        variants: [],
        example: { html: '<ol><li>Install Node.js 24 from <a href="https://nodejs.org">nodejs.org</a>.</li><li>Run <code>npx aimeat connect</code>.</li></ol>' },
        note: 'Was .platform-content of views/profile.css, drawn by views/profile/agents-tab.js.',
    },
    {
        id: 'setup-guide', name: 'SetupGuide', kind: 'component', status: 'active',
        summary: 'How to attach this node to one AI tool: a lead, the tools to pick from (the library\'s tab row, or the guide\'s own classic buttons) with a small "recommended" word, the one-click install row, the steps, the command with its copy door, what to put in each field with its copy door, and the vendor\'s own instructions as a more link. InstructionsDialog puts the organism\'s instruction block and where it goes in the reader\'s tool in the site\'s dialog. The tool picked is remembered in this browser.',
        module: '/components/SetupGuide.js', sheet: '/css/components/setup-guide.css',
        classes: ['setup-guide', 'setup-guide-lead', 'setup-guide-tools', 'setup-guide-tool', 'setup-guide-tool--active', 'setup-guide-reco', 'setup-guide-plans', 'setup-guide-warn', 'setup-guide-steps', 'setup-guide-cmd', 'setup-guide-cmd-text', 'setup-guide-code', 'setup-guide-params', 'setup-guide-params-head', 'setup-guide-param', 'setup-guide-param-label', 'setup-guide-param-value', 'setup-guide-param-note', 'setup-guide-param-empty', 'setup-guide-note', 'setup-guide-modal', 'setup-guide-label', 'setup-guide-select', 'setup-guide-where', 'setup-guide-where-head', 'setup-guide-where-path'],
        data: {
            shape: 'SetupGuide({ poster, asideInstall, facts, stepRows }) · InstructionsDialog({ open, onClose })',
            fields: {
                poster: 'the tool picker is the library\'s tab row (the Settings pages and the home); otherwise the guide\'s classic tool buttons',
                asideInstall: 'the one-click install row stands in the attention note\'s frame (the MCP page)',
                facts: 'the fields to fill in are the Facts instead of the classic rows',
                stepRows: 'the steps are the numbered list\'s rows instead of the classic list',
                open: 'InstructionsDialog: the dialog is open', onClose: 'InstructionsDialog: closes it',
            },
        },
        useFor: ['Telling a person, tool by tool, how to connect their AI to this node over MCP.', 'Giving a person the instruction block of an organism and the place to paste it in their tool (InstructionsDialog).'],
        variants: [
            { name: 'classic', class: 'setup-guide-tool--active', prop: 'poster={false}', when: 'the guide\'s own tool buttons, the chosen one marked' },
            { name: 'poster', prop: 'poster', when: 'the tool picker is the library\'s tab row' },
            { name: 'facts', prop: 'facts', when: 'the fields to fill in as the Facts' },
            { name: 'step rows', prop: 'stepRows', when: 'the steps as the numbered list\'s rows' },
            { name: 'install aside', prop: 'asideInstall', when: 'the one-click install row in the attention note\'s frame' },
        ],
        example: { poster: true, facts: true, stepRows: true },
        note: 'Moved out of views/profile/ai-setup-guide.js (McpSetupGuide, which still maps the old class props tabClass, activeClass and installClassName to these options for its callers). It reads the table of tools from the node (GET /v1/ai-tools), so its demo shows what this node answers. Its look is its own sheet, setup-guide.css (.setup-guide-*, formerly the .ast-* rules of hello-mcp.css, moved unchanged on 2026-09-27).',
    },
];
