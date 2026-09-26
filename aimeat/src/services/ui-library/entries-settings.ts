/**
 * @file src/services/ui-library/entries-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the parts of Settings & Controls (UI consolidation phase 5): its
 *   frame, its side menu, and the parts its tabs share. The purpose half only; facts.generated.ts
 *   carries what the files say.
 * @structure SETTINGS_ENTRIES
 * @usage import { SETTINGS_ENTRIES } from './entries-settings.js';
 * @version-history
 *   v1.81.0 — 2026-09-26 — Rating stars has the row cut (.op-stars--row) for a narrow column beside a status; the Offers delivery rows draw it (Jouni's decision "offer-row-stars").
 *   v1.80.0 — 2026-09-26 — The Offer hits are the Listing (cut hit-doors), a hit's row .listing-row .op-hit (a unification: the look most tabs use).
 *   v1.79.0 — 2026-09-26 — The Package preview's entries are the Listing (cut tag-name); .kp-preview-entry goes (a unification: the look most tabs use).
 *   v1.78.0 — 2026-09-26 — The Listing's meta line outside a row (.listing-meta), Jouni's decision "Meta line".
 *   v1.77.0 — 2026-09-26 — The Morsel flow's pace meter writes its figure as the Meter's figure (.poster-meter-figure).
 *   v1.76.0 — 2026-09-26 — The Tag input's x is the Tag's remove mark (.poster-chip-x); .pj-tag-x goes (Jouni's decision "Remove mark", a unification).
 *   v1.75.0 — 2026-09-26 — The Rating stars: the given stars dark, the pointer's preview, the shown tone (Jouni's decision "Rating stars", a unification).
 *   v1.74.0 — 2026-09-26 — The Field row's entry moves to entries-settings-org.ts (this file is at its length limit), with Jouni's decision "Dashed field box".
 *   v1.73.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.72.0 — 2026-09-26 — The Document tree names a series' arrow (.pj-ov-chevron), moved into its sheet unchanged (UI consolidation phase 5, a move).
 *   v1.71.0 — 2026-09-26 — The password's requirements (.pf-pw-rules) are the library's Requirement list (css/components/requirement-list.css), moved unchanged (UI consolidation phase 5, a move).
 *   v1.70.0 — 2026-09-26 — The figures that open their tab (.pf-usage-chip*) are the library's Figure door (css/components/figure-door.css), moved unchanged (UI consolidation phase 5, a move).
 *   v1.69.0 — 2026-09-26 — The classic AI settings' model picker is the library's Model picker (css/components/model-picker.css): its frame, rows, group, empty line and show-all line; its own picker, row and meta rules go (a unification: the look most tabs use).
 *   v1.68.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.67.0 — 2026-09-26 — The Drag grip, moved out of the agent page's sheet (a move).
 *   v1.66.0 — 2026-09-26 — The Facts value's warn tone (.facts-v--warn).
 *   v1.65.0 — 2026-09-26 — The Figure strip's of cut (.og-strip-of).
 *   v1.64.0 — 2026-09-26 — PageSection's split (.og-split).
 *   v1.63.0 — 2026-09-26 — The fold row's done tone (.og-fold--done).
 *   v1.62.0 — 2026-09-26 — The Form fields' code cut, .og-input--code (a field that holds an identifier).
 *   v1.61.0 — 2026-09-25 — The signed-out door (.pf-door-*), its sheet moved unchanged from views/profile-door.css to css/components/signed-out-door.css (UI consolidation phase 5, a move).
 *   v1.60.0 — 2026-09-25 — The ecosystem automation (its flow, status timeline and run log: .pf-eco-auto-*, .pf-eco-recipe-head), moved unchanged out of views/profile.css into css/components/eco-automation.css (UI consolidation phase 5, a move).
 *   v1.59.0 — 2026-09-25 — FoldSection names its optional lead, a line under the row shown open or shut.
 *   v1.58.0 — 2026-09-25 — The schedule calendar (the scheduler's month, week and day, .sch-cal-*), moved unchanged out of views/scheduler.css into css/components/schedule-calendar.css (UI consolidation phase 5, a move).
 *   v1.57.0 — 2026-09-25 — An organism search hit is the library's Search hits (css/components/search-hits.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.56.0 — 2026-09-25 — The People panel's agent chip is the library's Agent chip (css/components/agent-chip.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.55.0 — 2026-09-25 — A notice's category is the Tag (.poster-chip, plain), a unification: Jouni's decision "Tag".
 *   v1.54.0 — 2026-09-25 — The devices signed in are the library's Device list (css/components/device-list.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.53.0 — 2026-09-25 — Discover's question desk is the library's Question desk (css/components/question-desk.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.52.0 — 2026-09-25 — The ways to do one thing are the library's How roads (css/components/how-roads.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.51.0 — 2026-09-25 — What morsels buy is the Item grid (css/components/item-grid.css), a unification: the look most tabs use.
 *   v1.50.0 — 2026-09-25 — The inbox rows are the library's Notification feed (css/components/notification-feed.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.49.0 — 2026-09-25 — The morsel flow is the library's Morsel flow (css/components/morsel-flow.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.48.0 — 2026-09-25 — A field and its button in a dashed row are the library's Field row (css/components/field-row.css), moved unchanged under one name (UI consolidation phase 5, a move).
 *   v1.47.0 — 2026-09-25 — The preview of a pasted package is the library's Package preview (css/components/package-preview.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.46.0 — 2026-09-25 — A package's entries are the library's Knowledge entry (css/components/knowledge-entry.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.45.0 — 2026-09-25 — A board's notices are the library's Board notices (css/components/board-notices.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.44.0 — 2026-09-25 — A workflow's steps are the library's Workflow steps (css/components/workflow-steps.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.43.0 — 2026-09-25 — The jobs that run all the time are the library's Job chips (css/components/job-chips.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.42.0 — 2026-09-25 — The week's rhythm is the library's Week rhythm (css/components/week-rhythm.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.41.0 — 2026-09-25 — What the AI found for a need is the library's Offer hits (css/components/offer-hits.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.40.0 — 2026-09-25 — Rating a delivery is the library's Rating stars (css/components/rating-stars.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.39.0 — 2026-09-25 — The request on an offer's page is the library's Offer request (css/components/offer-request.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.38.0 — 2026-09-25 — The map of offers is the library's Offer map (css/components/offer-map.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.37.0 — 2026-09-25 — The production lines are the library's Offer lines (css/components/offer-lines.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.36.0 — 2026-09-25 — The score chart is the library's Score chart (css/components/score-chart.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.35.0 — 2026-09-25 — A prompt's versions and its two editors are the library's Prompt versions (css/components/prompt-versions.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.34.0 — 2026-09-25 — The opened run's parts are the library's Calibration run (css/components/calibration-run.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.33.0 — 2026-09-25 — The model picker is the library's Model picker (css/components/model-picker.css), moved unchanged out of ai-poster.css and calibrator-poster.css (UI consolidation phase 5, a move).
 *   v1.32.0 — 2026-09-25 — The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.31.0 — 2026-09-25 — GaiiChip: an agent's GAII as a copy control, moved out of the agent page's sheet and the poster skin (UI consolidation phase 5, a move).
 *   v1.30.0 — 2026-09-25 — TaskDag: a crew's task-order picture, moved unchanged out of the agent Crew tab's sheet (UI consolidation phase 5, a move).
 *   v1.29.0 — 2026-09-25 — The To-do list: a task's steps, moved unchanged out of the agent Tasks tab's sheet (UI consolidation phase 5, a move).
 *   v1.28.0 — 2026-09-25 — The tag input, moved out of the profile sheet (UI consolidation phase 5, a move).
 *   v1.27.0 — 2026-09-25 — Choosing files to upload (the file drop), moved out of the profile sheet (UI consolidation phase 5, a move).
 *   v1.26.0 — 2026-09-25 — The file preview, moved out of the profile sheet (UI consolidation phase 5, a move).
 *   v1.25.0 — 2026-09-25 — The document tree of a workspace document space, moved out of the profile and organism sheets (UI consolidation phase 5, a move).
 *   v1.24.0 — 2026-09-25 — The colour tag of a workspace section, document or record, moved out of the profile sheet (UI consolidation phase 5, a move).
 *   v1.23.0 — 2026-09-25 — The heatmap (the activity calendar of a workspace), moved out of the profile sheet (UI consolidation phase 5, a move).
 *   v1.22.0 — 2026-09-25 — The More line: six identical copies under the lists of six tabs, one library part by a move.
 *   v1.21.0 — 2026-09-25 — The Loading mark: Contacts' blinking square, a library part by a move.
 *   v1.20.0 — 2026-09-25 — The Address preview: the line under the company name field, a library part by a move.
 *   v1.19.0 — 2026-09-25 — The Access log: an opened Data wallet trail group's rows, a library part by a move.
 *   v1.18.0 — 2026-09-25 — The Item grid: what the Data wallet's export holds, a library part by a move.
 *   v1.17.0 — 2026-09-25 — The App picker: the apps to make a package from in Packages, a library part by a move.
 *   v1.16.0 — 2026-09-25 — The Delegation lines: a mailbox's delegations in Email, a library part by a move.
 *   v1.15.0 — 2026-09-25 — The Sent log: Email's sent log, a library part by a move.
 *   v1.14.0 — 2026-09-25 — The Uses list: Email's uses of the address, a library part by a move.
 *   v1.13.0 — 2026-09-25 — The Tier list: AppDev's tiers, a library part by a move.
 *   v1.12.0 — 2026-09-25 — The Changelog: Libraries' changelog, a library part by a move.
 *   v1.11.0 — 2026-09-25 — The Proof ledger: Libraries' proof ledger, a library part by a move.
 *   v1.10.0 — 2026-09-25 — The Page row: Portfolio's page row with its thumbnail, a library part by a move.
 *   v1.9.0 — 2026-09-25 — The Facts are active: the Settings key and value pairs draw them (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — The Listing is active: the Settings listings draw it, with the listing--cols variant for a list that keeps columns on a phone (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — The Search line is active: the Settings tabs draw it (UI consolidation phase 5, a unification).
 *   v1.7.0 — 2026-09-25 — The Select field: the look most Settings tabs drew for a drop-down, now every Settings select (UI consolidation phase 5, a unification).
 *   v1.6.0 — 2026-09-25 — The Select field: the look most Settings tabs drew for a drop-down, now every Settings select (UI consolidation phase 5, a unification).
 *   v1.5.0 — 2026-09-25 — The Switch: the look most Settings tabs draw for a setting that is on or off (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — The Form message is active: the Settings tabs draw it (UI consolidation phase 5, a unification).
 *   v1.3.0 — 2026-09-25 — The Code block is active: the Settings tabs draw its inline cut (UI consolidation phase 5, a unification).
 *   v1.2.0 — 2026-09-25 — Facts, listing, search line, code block and form message: the looks most Settings tabs draw, unused until the tabs move.
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-09-25 — Initial: settings-frame and side-menu, moved out of the profile sheets.
 */
import type { UiEntryWritten } from './types.js';

export const SETTINGS_ENTRIES: UiEntryWritten[] = [
    {
        id: 'settings-frame', name: 'SettingsFrame', kind: 'component', status: 'active',
        summary: 'The frame of Settings & Controls: a side column for the menu, the content column beside it with the crumb of the open tab, and on a phone the menu as a drawer behind a loud-action Menu button.',
        module: '/components/SettingsFrame.js', sheet: '/css/components/settings-frame.css',
        data: {
            shape: 'SettingsFrame({ open, onToggle, onClose, menuLabel, menu, overview, dialogs, children }) · SettingsFrameHead({ children }) · SettingsFrameBody({ children })',
            fields: {
                open: 'true while the phone drawer is open', onToggle: 'the Menu button', onClose: 'a press on the scrim',
                menuLabel: 'the Menu button\'s word', menu: 'what the side column holds (a SideMenu)',
                overview: 'true on the overview: its section titles are a size larger', dialogs: 'dialogs the page has open, drawn first',
                children: 'the content: a SettingsFrameHead with the crumb and a SettingsFrameBody with the tab, or the overview',
            },
        },
        useFor: ['The outermost part of Settings & Controls. A page inside it does not set its own width or padding.'],
        variants: [
            { name: 'overview', class: 'settings-frame-content--overview', prop: 'overview', when: 'the overview, where no tab is open' },
            { name: 'drawer open', class: 'settings-frame--open', prop: 'open', when: 'on a phone, while the menu is shown' },
        ],
        example: { menuLabel: 'Menu', menu: '…', children: '…' },
    },
    {
        id: 'side-menu', name: 'SideMenu', kind: 'component', status: 'active',
        summary: 'The side menu of Settings & Controls, read as a table of contents: the way home, items as hairline rows with the open one on the sun, a coral count when something waits, a pin, groups under a coral capital word that fold, and "show all tools".',
        module: '/components/SideMenu.js', sheet: '/css/components/side-menu.css',
        data: {
            shape: 'SideMenuHome({ href, children }) · SideMenuItem({ active, onClick, count, pin, children }) · SideMenuGroup({ title, collapsed, onToggle, children }) · SideMenuMore({ onClick, children })',
            fields: {
                active: 'the item of the open view', count: 'how many wait there; shown when above 0',
                pin: '{ on, title, onToggle }: the pin that keeps the item under Pinned', title: 'the group\'s word',
                collapsed: 'the group is folded', onToggle: 'folds the group; without it the title is a plain word',
            },
        },
        useFor: ['The index beside a set of views that belong together. Items are views, not actions.'],
        variants: [
            { name: 'open item', class: 'side-menu-item--active', prop: 'active', when: 'the view shown now' },
            { name: 'pinned', class: 'side-menu-pin--on', prop: 'pin.on', when: 'the person keeps this item under Pinned' },
        ],
        example: { groups: [{ title: 'Information', items: ['Discover', 'Organisms', 'Memory'] }], active: 'Memory', count: 3 },
    },
    // The og- page kit, moved out of views/organism.css. Its class names stay (every tab, the organism
    // pages and the admin write them); each part is one entry.
    {
        id: 'tab-page', name: 'Tab page', kind: 'component', status: 'active',
        summary: 'The page of a Settings & Controls tab: the root that sets the headline sizes and the body face, the page column beside a dark contents rail with a sun shadow, and the tree that can take the rail\'s place.',
        module: null, sheet: '/css/components/tab-page.css', classes: ['og', 'og-grid', 'og-main', 'og-rail', 'og-rail-label', 'og-rail-link', 'og-tree'],
        data: { shape: '<div class="og"><div class="og-grid"><div class="og-main">…</div><nav class="og-rail">…</nav></div></div>', fields: { main: 'the page\'s sections', rail: 'a coral label and one link per section, the open one bright' } },
        useFor: ['The outermost part of a tab\'s page inside the Settings frame, and of the organism pages.'],
        variants: [{ name: 'page', class: 'og-page', when: 'a page of a workspace: the columns sit a little lower' }],
        example: { rail: ['Files', 'People', 'Settings'] },
    },
    {
        id: 'crumb-trail', name: 'Crumb trail', kind: 'component', status: 'active',
        summary: 'The mono path above a tab page\'s headline: the steps as coral links, the page you are on in ink.',
        module: null, sheet: '/css/components/crumb-trail.css', classes: ['og-crumb', 'og-crumb-link', 'og-crumb-here'],
        data: { shape: '<nav class="og-crumb"><button class="og-crumb-link">Organisms</button> / <span class="og-crumb-here">Harbour Studio</span></nav>', fields: { steps: 'the way back, one link each', here: 'where the person is' } },
        useFor: ['Above the headline of a page that sits inside another.'],
        variants: [], example: { steps: ['Organisms'], here: 'Harbour Studio' },
    },
    {
        id: 'page-head', name: 'Page head', kind: 'component', status: 'active',
        summary: 'The head of a tab page: the headline with a small mono aside, the chips under it, the grey description, and the doors on the right (stacked under it on a phone).',
        module: null, sheet: '/css/components/page-head.css', classes: ['og-mast', 'og-mast-words', 'og-title', 'og-chips', 'og-desc', 'og-mast-actions', 'og-doors'],
        data: { shape: '<header class="og-mast"><div class="og-mast-words"><h1 class="og-title poster-page-title">…</h1><div class="og-chips">…</div><p class="og-desc">…</p></div><div class="og-mast-actions">…</div></header>', fields: { title: 'the page\'s name', chips: 'the facts that name it', desc: 'one or two sentences', actions: 'the slab and the doors' } },
        useFor: ['The first thing on a tab page.'],
        variants: [{ name: 'page', class: 'og-mast--page', when: 'a page of a workspace: the head sits on its baseline' }],
        example: { title: 'Skills', desc: 'What your agents know how to do.' },
    },
    {
        id: 'figure-strip', name: 'Figure strip', kind: 'component', status: 'active',
        summary: 'A few figures between two heavy ink rules: the number in the poster face, its word, a mono line under it; two to a row on a phone.',
        module: null, sheet: '/css/components/figure-strip.css', classes: ['og-strip', 'og-strip-coral', 'og-strip-of'],
        data: { shape: '<div class="og-strip"><div><b>12</b><span>spaces</span><small>3 shared</small></div>…</div>', fields: { b: 'the number', span: 'what it counts', small: 'a detail' } },
        useFor: ['Under a page head, the few numbers that say how big a thing is.'],
        variants: [{ name: 'coral', class: 'og-strip-coral', when: 'a word instead of a number, in coral capitals' }, { name: 'of', class: 'og-strip-of', when: 'the part after the slash in "3/4": smaller, in grey' }],
        example: { figures: [['12', 'spaces'], ['4', 'people']] },
    },
    {
        id: 'page-section', name: 'PageSection', kind: 'component', status: 'active',
        summary: 'A section of a tab page: the heavy rule on top (or the section title\'s own), the title with a small mono number, the doors on the right, and its hint and lead lines.',
        module: '/components/PageSection.js', sheet: '/css/components/page-section.css',
        data: { shape: 'PageSection({ id, num, title, count, doors, first, children })', fields: { num: 'the section\'s number beside its title', count: 'a count instead of the number', doors: 'the section\'s actions', first: 'the first section: no rule on top' } },
        useFor: ['Each part of a tab page. A hint (.og-hint) and a lead (.og-lead) go inside it.'],
        variants: [{ name: 'first', class: 'og-sec--first', prop: 'first', when: 'the first section under the page head' }, { name: 'label hint', class: 'og-hint--label', when: 'a hint that names what follows' }, { name: 'split', class: 'og-split', when: 'a part of a section set off by a hairline: its last doors, a group inside it' }],
        example: { num: '01', title: 'Files', children: '…' },
    },
    {
        id: 'fold-row', name: 'FoldSection', kind: 'component', status: 'active',
        summary: 'Rows that open in place: a coral mono number, the name, a mono detail on the right and an arrow; a section that is one such row until it is opened.',
        module: '/components/FoldSection.js', sheet: '/css/components/fold-row.css',
        data: { shape: 'FoldSection({ id, num, title, sub, lead, open, onToggle, children }) · <div class="og-folds"><div class="og-fold"><i>01</i>…<span class="og-fold-r">…</span></div></div>', fields: { num: 'the row\'s number', title: 'its name', sub: 'a detail on the right', lead: 'a line under the row, shown open or shut', open: 'the body is shown' } },
        useFor: ['A list of things that each open in place, and a part of a page that is closed by default.'],
        variants: [
            { name: 'toggle', class: 'og-fold--toggle', when: 'the row is the button that opens a FoldSection' },
            { name: 'event', class: 'og-fold--event', when: 'a row of a list of events' },
            { name: 'done', class: 'og-fold--done', when: 'a step that is finished: its number in green' },
        ],
        example: { num: '04', title: 'Map', sub: '12 spaces', open: false },
    },
    {
        id: 'setting-box', name: 'Setting box', kind: 'component', status: 'active',
        summary: 'A box on a settings page: its coral poster-face label, a row with its button, and a confirmation line with its field.',
        module: null, sheet: '/css/components/setting-box.css', classes: ['og-box', 'og-box-label', 'og-box-row', 'og-box-confirm'],
        data: { shape: '<div class="og-box poster-aside"><span class="og-box-label">…</span><div class="og-box-row"><p>…</p><button>…</button></div></div>', fields: { label: 'what the box is about', row: 'the sentence and its button', confirm: 'the field that asks for the name before an act that cannot be undone' } },
        useFor: ['A setting that needs its own frame, such as leaving or deleting.'],
        variants: [], example: { label: 'Leave', row: 'You can come back when invited.' },
    },
    {
        id: 'form-fields', name: 'Form fields', kind: 'component', status: 'active',
        summary: 'The fields of a settings page: one or two columns, each a coral label over an underlined input or a framed text area, and the row of actions under them.',
        module: null, sheet: '/css/components/form-fields.css', classes: ['og-fields', 'og-field', 'og-label', 'og-input', 'og-input--code', 'og-textarea', 'og-actions'],
        data: { shape: '<div class="og-fields"><label class="og-field"><span class="og-label">Name</span><input class="og-input"></label></div><div class="og-actions">…</div>', fields: { label: 'what the field holds', input: 'one line', textarea: 'several lines' } },
        useFor: ['A form on a tab page.'],
        variants: [{ name: 'two columns', class: 'og-fields--2', when: 'short fields side by side (one column on a phone)' }, { name: 'code', class: 'og-input--code', when: 'a field that holds an identifier (a cron line, a key, an id): the typewriter face' }],
        example: { fields: ['Name', 'Description'] },
    },
    {
        id: 'space-table', name: 'Space table', kind: 'component', status: 'active',
        summary: 'A table of spaces: number, name with its marks, size, last change and a door; the head row in coral capitals, hidden on a phone with the last-change column.',
        module: null, sheet: '/css/components/space-table.css', classes: ['og-tbl', 'og-tbl-name', 'og-tbl-last', 'og-tbl-door'],
        data: { shape: '<div class="og-tbl og-tbl--head">…</div><div class="og-tbl"><div class="og-tbl-n">01</div><div class="og-tbl-nm"><button class="og-tbl-name">…</button></div>…</div>', fields: { n: 'the number', name: 'the space', last: 'the last change', door: 'open it' } },
        useFor: ['The spaces of an organism or a workspace, one row each.'],
        variants: [{ name: 'head', class: 'og-tbl--head', when: 'the heading row' }],
        example: { rows: [['01', 'Client briefs', '12', 'today']] },
    },
    // The kinds no decision covers, with the look most Settings tabs already draw (RUNBOOK 3a). Built
    // first, unused until the tabs move onto them.
    {
        id: 'facts', name: 'Facts', kind: 'component', status: 'active',
        summary: 'Named values in two columns: the name as the row label on the left, the value on the right with an optional grey line under it; one column on a phone.',
        module: null, sheet: '/css/components/facts.css', classes: ['facts', 'facts-k', 'facts-v', 'facts-v--warn'],
        data: { shape: '<dl class="facts"><dt class="facts-k poster-label">Version</dt><dd class="facts-v">1.4.0<small>published today</small></dd></dl>', fields: { k: 'what the value is (a row label)', v: 'the value, and a grey line under it' } },
        useFor: ['The facts of one thing: its version, who owns it, where it is used.'],
        variants: [{ name: 'wide', class: 'facts--wide', when: 'longer names, more air above' }, { name: 'warn', class: 'facts-v--warn', when: 'a value that needs a look: the attention colour' }],
        example: { facts: [['Version', '1.4.0'], ['Owner', 'sandbox']] },
        note: 'Built on 2026-09-25 with the look five Settings tabs draw as identical copies; the Settings facts moved onto it the same day.',
    },
    {
        id: 'listing', name: 'Listing', kind: 'component', status: 'active',
        summary: 'Things in rows of columns under a heading row: the name in bold with a small typewriter line, a grey description, who or where, the doors on the right; a row can open a framed panel under it. On a phone one column, or the narrow columns of its cut (listing--cols).',
        module: null, sheet: '/css/components/listing.css', classes: ['listing', 'listing-row', 'listing-name', 'listing-desc', 'listing-who', 'listing-doors', 'listing-open', 'listing-meta'],
        data: { shape: '<div class="listing listing--<cut>"><div class="listing-row listing-row--head">…</div><div class="listing-row"><div class="listing-name">…</div><div class="listing-desc">…</div><div class="listing-doors">…</div></div></div>', fields: { name: 'the thing', desc: 'what it is', who: 'whose it is or where', doors: 'what a person can do with it', open: 'the panel one row opens' } },
        useFor: ['A list of things a person owns or can install, when each needs a few columns.'],
        variants: [{ name: 'head', class: 'listing-row--head', when: 'the heading row' }, { name: 'open', class: 'is-open', when: 'the row whose panel is open' }, { name: 'cols', class: 'listing--cols', when: 'the list keeps the columns of its cut on a narrow screen instead of stacking' }, { name: 'meta', class: 'listing-meta', when: 'the grey typewriter line under a name outside a Listing row (Jouni\'s decision "Meta line")' }],
        example: { rows: [['aimeat-writing', 'How prose is written', 'sandbox']] },
        note: 'Built on 2026-09-25 with the look six Settings tabs draw as identical copies; the Settings listings moved onto it the same day, each with a cut named by its columns.',
    },
    {
        id: 'search-line', name: 'Search line', kind: 'component', status: 'active',
        summary: 'The field that searches a list, across the row, and how many it found in small grey typewriter letters at its end.',
        module: null, sheet: '/css/components/search-line.css', classes: ['search-line'],
        data: { shape: '<div class="search-line"><input class="og-input"><small>12 of 40</small></div>', fields: { input: 'what to look for', small: 'how many it found' } },
        useFor: ['Above a list a person can search.'],
        variants: [], example: { found: '12 of 40' },
        note: 'Built on 2026-09-25 with the look six Settings tabs drew as identical copies; since then the Settings tabs\' search fields over a list sit in it, with a button or a count beside the field where the place has one.',
    },
    {
        id: 'code-block', name: 'Code block', kind: 'component', status: 'active',
        summary: 'Code, a prompt or a path in the typewriter face on the grey ground: a block that wraps its long lines, or a small patch inside a sentence.',
        module: null, sheet: '/css/components/code-block.css', classes: ['code-block', 'code-inline'],
        data: { shape: '<pre class="code-block">…</pre> · <code class="code-inline">…</code>', fields: { children: 'the code' } },
        useFor: ['Something a person reads exactly or copies: an address, a command, a prompt.'],
        variants: [{ name: 'inline', class: 'code-inline', when: 'inside a sentence' }], example: { children: 'aimeat_skill_get aimeat-writing' },
    },
    {
        id: 'form-message', name: 'Form message', kind: 'component', status: 'active',
        summary: 'The line a form says after it acted: done in green, refused in coral.',
        module: null, sheet: '/css/components/form-message.css', classes: ['form-message'],
        data: { shape: '<span class="form-message">Saved.</span>', fields: { children: 'what happened' } },
        useFor: ['Under a form\'s actions, after Save or Send.'],
        variants: [{ name: 'error', class: 'form-message--error', when: 'the form was refused' }], example: { children: 'Saved.' },
    },
    {
        id: 'switch', name: 'Switch', kind: 'component', status: 'active',
        summary: 'A setting that is on or off: its word on the left and a small framed box on the right, the box on the sun when it is on.',
        module: '/components/Switch.js', sheet: '/css/components/switch.css',
        data: {
            shape: 'Switch({ on, label, disabled, locked, onToggle, ariaLabel })',
            fields: {
                on: 'the setting is on', label: 'its word, or the sentence that says what on means', disabled: 'it cannot change now',
                locked: 'on, and it cannot be switched off', onToggle: 'flip', ariaLabel: 'the name of a switch that shows no word',
            },
        },
        useFor: ['One on-or-off setting on a Settings tab, in a row or beside the words that explain it.'],
        variants: [
            { name: 'on', class: 'switch--on', prop: 'on', when: 'the setting is on' },
            { name: 'locked', class: 'switch--locked', prop: 'locked', when: 'on for good: a mail that is always sent' },
        ],
        example: { on: true, label: 'push' },
    },
    {
        id: 'select-field', name: 'Select field', kind: 'component', status: 'active',
        summary: 'A drop-down: the browser\'s select in an ink frame on the page ground, its words in the showroom face, as wide as its place; the frame turns coral while it has the focus.',
        module: null, sheet: '/css/components/select-field.css', classes: ['select-field'],
        data: { shape: '<select class="select-field"><option>…</option></select>', fields: { option: 'one choice each' } },
        useFor: ['One choice out of a short fixed list: a role, an order, a provider, how often.'],
        variants: [], example: { options: ['Member', 'Editor', 'Owner'] },
        note: 'Built on 2026-09-25 with the look most Settings tabs drew for a drop-down (the og-input selects of twelve tabs); every Settings select wears it.',
    },
    {
        id: 'page-row', name: 'Page row', kind: 'component', status: 'active',
        summary: 'One published page as a row: a small drawn thumbnail of a page, its title in bold with a typewriter line under it, its doors at the right end, a rule under the row.',
        module: null, sheet: '/css/components/page-row.css', classes: ['pf-pg', 'pf-thumb', 'pf-pg-words', 'pf-pg-go'],
        data: { shape: '<div class="pf-pg"><div class="pf-thumb"><i></i><i></i></div><div class="pf-pg-words"><b>…</b><small>…</small></div><div class="pf-pg-go">…</div></div>', fields: { b: 'the page\'s title', small: 'when it was published, its size, its choices', go: 'the doors: preview, open' } },
        useFor: ['A page a person published, shown as one row with a way to preview it.'],
        variants: [], example: { title: 'Sandbox', line: 'published 9/25/2026 · 1 kB' },
        note: 'Moved on 2026-09-25 out of the Portfolio sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'proof-ledger', name: 'Proof ledger', kind: 'component', status: 'active',
        summary: 'Which model proved a thing, whether it passed, what it cost, when and the evidence: one line per proof in five typewriter columns, the verdict green when it passed and coral when it failed; on a phone the model and the verdict.',
        module: null, sheet: '/css/components/proof-ledger.css', classes: ['lb-proof'],
        data: { shape: '<div class="lb-proof"><div>model</div><div class="ok">pass</div><div>tokens</div><div>date</div><div>evidence</div>…</div>', fields: { ok: 'the verdict when it passed', no: 'the verdict when it failed' } },
        useFor: ['The record of the tests a library passed with named models, inside its opened panel.'],
        variants: [{ name: 'passed', class: 'ok', when: 'the proof passed' }, { name: 'failed', class: 'no', when: 'the proof failed' }],
        example: { model: 'claude-haiku-4-5', verdict: 'pass', tokens: '12,400 tok', date: '2026-09-20' },
        note: 'Moved on 2026-09-25 out of the Libraries sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'changelog', name: 'Changelog', kind: 'component', status: 'active',
        summary: 'One version per line: its number and date in grey typewriter letters and what changed in body words, a rule under each; on a phone the three stack.',
        module: null, sheet: '/css/components/changelog.css', classes: ['lb-cl'],
        data: { shape: '<div class="lb-cl"><div class="m">1.1.0</div><div class="m">2026-09-20</div><div>what changed</div>…</div>', fields: { m: 'the version and the date', div: 'what changed, a breaking change in coral bold' } },
        useFor: ['The versions of a thing a person can install, newest first, inside its opened panel.'],
        variants: [], example: { version: '1.1.3', date: '2026-09-20', summary: 'The legend wraps on a phone.' },
        note: 'Moved on 2026-09-25 out of the Libraries sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'tier-list', name: 'Tier list', kind: 'component', status: 'active',
        summary: 'A short key of levels: each a coral typewriter mark (T1, T2, T3) in a narrow column and what the level means beside it.',
        module: null, sheet: '/css/components/tier-list.css', classes: ['ad-tier'],
        data: { shape: '<div class="ad-tier"><b>T1</b><span>…</span><b>T2</b><span>…</span></div>', fields: { b: 'the level\'s mark', span: 'what the level means' } },
        useFor: ['The few levels a thing can be at, explained once where a person meets them.'],
        variants: [], example: { levels: [['T1', 'one file'], ['T2', 'with memory'], ['T3', 'with agents']] },
        note: 'Moved on 2026-09-25 out of the AppDev sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'uses-list', name: 'Uses list', kind: 'component', status: 'active',
        summary: 'What a thing is used for, in two columns: a mark (a green tick when the use works now, a grey dot when it does not), the use in bold and a grey line that explains it; a rule under each; one column on a phone.',
        module: null, sheet: '/css/components/uses-list.css', classes: ['em-uses'],
        data: { shape: '<div class="em-uses"><div><i>✓</i><span><b>…</b><small>…</small></span></div><div><i class="no">·</i><span>…</span></div></div>', fields: { i: 'the mark', b: 'the use', small: 'what it means' } },
        useFor: ['The few things an address, a key or a setting is used for, and which of them work now.'],
        variants: [{ name: 'not now', class: 'no', when: 'the use does not work now (the grey dot)' }],
        example: { uses: [['✓', 'Sign in', 'A code to this address signs you in.']] },
        note: 'Moved on 2026-09-25 out of the Email sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'sent-log', name: 'Sent log', kind: 'component', status: 'active',
        summary: 'What left, one message per line under a heading row: when (a day over a clock), the subject in bold with a grey line of who, kind and state, where it went, and a door; on a phone the heading row goes and the cells stack beside the door.',
        module: null, sheet: '/css/components/sent-log.css', classes: ['em-log', 'em-m', 'em-what'],
        data: { shape: '<div class="em-log em-log--head">…</div><div class="em-log"><div class="em-m poster-time"><b>day</b>clock</div><div class="em-what"><b>subject</b><small>…</small></div><div class="em-m">channel</div><div class="og-tbl-door">…</div></div>', fields: { when: 'when it left', what: 'the subject, and who, kind and state under it', where: 'the channel it went by', door: 'the way to the contact' } },
        useFor: ['A log of messages a person or their agent sent, newest first.'],
        variants: [{ name: 'head', class: 'em-log--head', when: 'the heading row' }],
        example: { rows: [['2 hours ago', 'Your invoice', 'by email']] },
        note: 'Moved on 2026-09-25 out of the Email sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'delegation-lines', name: 'Delegation lines', kind: 'component', status: 'active',
        summary: 'The apps a connection lends itself to, one line each under the connection\'s row: the app in bold, what it may do in grey typewriter letters, and a door.',
        module: null, sheet: '/css/components/delegation-lines.css', classes: ['em-deleg'],
        data: { shape: '<div class="em-deleg"><div><b>app</b><small>what it may do</small><button class="poster-action poster-action--quiet">Stop</button></div></div>', fields: { b: 'the app', small: 'what it may do, and whether it was stopped', door: 'stop it' } },
        useFor: ['Under a connected account, the apps allowed to act through it.'],
        variants: [], example: { lines: [['notes.html', 'read-mail']] },
        note: 'Moved on 2026-09-25 out of the Email sheet, the one place it is drawn (a move; nothing changed on screen). Where it sits in a row stays with the page.',
    },
    {
        id: 'app-picker', name: 'App picker', kind: 'component', status: 'active',
        summary: 'The owner\'s apps as a capped, scrolling list in a thin grey frame: a check box, the app\'s name over its file name, and what it loads beside it in grey; on a phone what it loads stacks under the name.',
        module: null, sheet: '/css/components/app-picker.css', classes: ['pk-compose-list', 'pk-compose-app', 'pk-compose-app-nm', 'pk-compose-app-needs'],
        data: { shape: '<div class="pk-compose-list"><label class="pk-compose-app"><input type="checkbox"><span class="pk-compose-app-nm">name<small>file</small></span><small class="pk-compose-app-needs">…</small></label></div>', fields: { name: 'the app', file: 'its file name', needs: 'what it loads' } },
        useFor: ['Picking several of the owner\'s apps at once, where each one\'s needs matter to the choice.'],
        variants: [], example: { apps: [['Notes', 'notes.html', 'nothing to load']] },
        note: 'Moved on 2026-09-25 out of the Packages sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'item-grid', name: 'Item grid', kind: 'component', status: 'active',
        summary: 'A few things side by side in three columns: each its name in bold over a grey typewriter line, a rule under each; one column on a phone.',
        module: null, sheet: '/css/components/item-grid.css', classes: ['item-grid'],
        data: { shape: '<div class="item-grid"><div><b>…</b><small>…</small></div>…</div>', fields: { b: 'the thing', small: 'how many, or what it is' } },
        useFor: ['What a bundle, an export or a plan holds, when each part needs only a name and a line.'],
        variants: [], example: { items: [['Memory', '128 keys'], ['Files', '4 files · 1 MB']] },
        note: 'Moved on 2026-09-25 out of the Data wallet sheet (.dw-contents), the one place it was drawn (a move; nothing changed on screen).',
    },
    {
        id: 'access-log', name: 'Access log', kind: 'component', status: 'active',
        summary: 'The reads of one group in time order under small heading cells: when, which key, the outcome, a rule under each; on a phone the headings go and the three stack.',
        module: null, sheet: '/css/components/access-log.css', classes: ['dw-grants', 'dw-grants--rows', 'dw-gh'],
        data: { shape: '<div class="dw-grants dw-grants--rows"><div class="dw-gh poster-label">When</div>…<div class="poster-time">…</div><div><code class="code-inline">key</code></div><div>outcome</div></div>', fields: { when: 'when it was read', key: 'the memory key', outcome: 'allowed or refused' } },
        useFor: ['The single reads behind one line of a trail, shown when a person opens it.'],
        variants: [], example: { rows: [['9/22 10:00', 'notes/today', 'refused']] },
        note: 'Moved on 2026-09-25 out of the Data wallet sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'address-preview', name: 'Address preview', kind: 'component', status: 'active',
        summary: 'One grey typewriter line under a name field: the address the name will get, in coral, as it is typed, and whether it is free; a taken one in the danger colour.',
        module: null, sheet: '/css/components/address-preview.css', classes: ['co-preview'],
        data: { shape: '<p class="co-preview">Address: <b>acme</b> · free</p>', fields: { b: 'the address', taken: 'why it cannot be had' } },
        useFor: ['Under a field whose words become an address, while the person types.'],
        variants: [{ name: 'taken', class: 'taken', when: 'the address is taken or not allowed' }],
        example: { address: 'acme-widgets', state: 'free' },
        note: 'Moved on 2026-09-25 out of the Companies sheet, the one place it is drawn (a move; nothing changed on screen).',
    },
    {
        id: 'loading-mark', name: 'Loading mark', kind: 'component', status: 'active',
        summary: 'A small coral square that blinks before the quiet sentence that says something is loading.',
        module: null, sheet: '/css/components/loading-mark.css', classes: ['loading-mark', 'ct-loading'],
        data: { shape: '<p class="poster-quiet loading-mark">Loading…</p>', fields: { children: 'the loading words' } },
        useFor: ['While a list, a page or a part of a Settings tab loads: the one loading line of Settings & Controls.'],
        variants: [], example: { children: 'Loading…' },
        note: 'Moved on 2026-09-25 out of the Contacts sheet (ct-loading, its rules keep the page\'s scope .og-ct) and out of five identical copies in Discover, Knowledge, Boards, Workflows and Notifications, under one name (.og .loading-mark); nothing changed on screen. Contacts still writes ct-loading, the same values. On 2026-09-26 every loading line of Settings & Controls took it (the quiet sentence with the mark, the look most tabs used; the Spinner and the plain grey lines went), so it also applies inside the classic tabs (.pf) and a dialog (.dlg); in the profile views it is LoadingLine in views/profile/shared.js.',
    },
    {
        id: 'more-line', name: 'More line', kind: 'component', status: 'active',
        summary: 'The line under a list: the way to show more, and how many are shown in small grey typewriter letters beside it.',
        module: null, sheet: '/css/components/more-line.css', classes: ['more-line'],
        data: { shape: '<div class="more-line"><button class="poster-action poster-action--more">Show 20 more</button><small>20 of 55</small></div>', fields: { button: 'show more', small: 'how many are shown of how many' } },
        useFor: ['Under a list that shows a page at a time.'],
        variants: [], example: { shown: '20 of 55' },
        note: 'Moved on 2026-09-25 out of six identical copies in the Skills, Packages, Capabilities, Libraries, Extensions and AppDev sheets, under one name (a move; nothing changed on screen).',
    },
    {
        id: 'heatmap', name: 'Heatmap', kind: 'component', status: 'active',
        summary: 'A year of activity as a calendar: week columns under the month names, each day a small square split in four quarters, each quarter shaded by how much happened, with a key to the quarters and a less-to-more ramp under it.',
        module: null, sheet: '/css/components/heatmap.css', classes: ['pj-hm', 'pj-hm-cell', 'q', 'lvl0', 'lvl1', 'lvl2', 'lvl3', 'lvl4', 'pj-hm-legend'],
        data: { shape: '<div class="pj-hm"><div class="pj-hm-monthrow"><span class="pj-hm-month">Sep</span></div><div class="pj-hm-body"><div class="pj-hm-daycol">…</div><div class="pj-hm-cols"><div class="pj-hm-col"><span class="pj-hm-cell"><i class="q lvl0"></i>…</span></div></div></div></div><div class="pj-hm-legend">…</div>', fields: { month: 'the month a week column starts', cell: 'one day, four quarters', lvl: 'how much happened, 0 to 4', legend: 'the key to the quarters and the ramp' } },
        useFor: ['How much happened on each day of a year, when the days are what a person compares.'],
        variants: [{ name: 'future', class: 'future', when: 'a day that has not come yet' }],
        example: { weeks: 53, quarters: ['documents draft', 'documents published', 'records draft', 'records published'] },
        note: 'Moved unchanged out of views/profile.css on 2026-09-25; one page draws it, the workspace activity page.',
    },
    {
        id: 'colour-tag', name: 'Colour tag', kind: 'component', status: 'active',
        summary: 'A colour a person gives a section, a document or a record: a small dot that opens a row of seven theme colours and "no colour", and the coloured rail the chosen colour draws on the left of the thing.',
        module: '/views/profile/organisms/workspace/color-picker.js', sheet: '/css/components/colour-tag.css', classes: ['pj-cp', 'pj-cp-dot', 'pj-cp-pop', 'pj-cp-sw', 'pj-colored', 'pj-tag-red'],
        data: { shape: 'ColorPicker({ value, onPick, title }) · <div class="pj-colored pj-tag-blue">…</div>', fields: { value: 'the chosen colour, or none', onPick: 'called with a colour name or null', title: 'the tooltip of the dot' } },
        useFor: ['Marking one thing in a list with a colour the person chose.'],
        variants: [{ name: 'empty', class: 'pj-cp-empty', when: 'no colour is chosen yet' }, { name: 'rail', class: 'pj-colored', when: 'the chosen colour on the thing it marks' }],
        example: { value: 'blue' },
        note: 'Moved unchanged out of views/profile.css on 2026-09-25; the workspace document and record spaces draw it.',
    },
    {
        id: 'doc-tree', name: 'Document tree', kind: 'component', status: 'active',
        summary: 'The documents of a space as a tree beside the open one: sections that nest under their names, each document a row with a drag grip, a series of parts folded under one row, the open document on the sun with an ink rail.',
        module: null, sheet: '/css/components/doc-tree.css', classes: ['pj-docspace', 'pj-doc-index', 'pj-doc-main', 'pj-sec', 'pj-sec-head', 'pj-sec-name', 'pj-doc-item', 'pj-doc-link', 'pj-doc-series-head', 'pj-ov-chevron', 'pj-doc-series-parts'],
        data: { shape: '<div class="pj-docspace"><div class="pj-doc-index"><div class="pj-sec"><div class="pj-sec-head"><span class="pj-sec-name">…</span></div><div class="pj-doc-item active"><span class="pj-grip">⠿</span><button class="pj-doc-link">…</button></div></div></div><div class="pj-doc-main">…</div></div>', fields: { index: 'the tree', sec: 'a section and what is under it', item: 'one document', series: 'the parts of one document, folded', main: 'the open document' } },
        useFor: ['Many documents in sections, when a person reads one and moves between them.'],
        variants: [{ name: 'open', class: 'active', when: 'the document that is open beside the tree' }, { name: 'muted', class: 'pj-muted', when: 'the section of documents in no section' }],
        example: { sections: ['Research', 'Unsorted'], open: 'Seat map study' },
        note: 'Moved unchanged out of views/profile.css and views/organism.css on 2026-09-25 (a series\' arrow, .pj-ov-chevron, on 2026-09-26); one page draws it, the document space of a workspace.',
    },
    {
        id: 'file-preview', name: 'File preview', kind: 'component', status: 'active',
        summary: 'A stored file shown in a dialog: on a grey ground in a thin frame, an image, a PDF, a video or a sound as the browser plays it, or text in the typewriter face; a line when it is loading or cannot be shown.',
        module: null, sheet: '/css/components/file-preview.css', classes: ['pf-file-preview-modal', 'pf-file-preview-body', 'pf-file-preview-img', 'pf-file-preview-frame', 'pf-file-preview-media', 'pf-file-preview-text', 'pf-file-preview-status'],
        data: { shape: '<div class="pf-file-preview-body"><img class="pf-file-preview-img"> | <iframe class="pf-file-preview-frame"> | <video class="pf-file-preview-media"> | <pre class="pf-file-preview-text">…</pre> | <div class="pf-file-preview-status">…</div></div>', fields: { img: 'an image', frame: 'a PDF', media: 'a video or a sound', text: 'a text file', status: 'loading, or why it cannot be shown' } },
        useFor: ['Looking at a stored file without downloading it.'],
        variants: [{ name: 'text', class: 'pf-file-preview-text', when: 'a text file' }, { name: 'status', class: 'pf-file-preview-status', when: 'loading, or a kind the browser cannot show' }],
        example: { file: 'docs/file-1.txt' },
        note: 'Moved unchanged out of views/profile.css on 2026-09-25; the memory tab draws it (FilePreviewModal).',
    },
    {
        id: 'file-drop', name: 'File drop', kind: 'component', status: 'active',
        summary: 'Choosing files to upload: a dashed area to drop them on or click, coral while a file is over it or chosen, and under it one row per chosen file with its mark, the key it is stored under, its size and the mark that takes it off.',
        module: null, sheet: '/css/components/file-drop.css', classes: ['file-dropzone', 'file-dropzone-empty', 'file-upload-list', 'file-upload-item', 'pf-upload-icon', 'pf-file-icon'],
        data: { shape: '<div class="file-dropzone"><input type="file"><div class="file-dropzone-empty"><span class="pf-upload-icon">⬆</span><span>…</span></div></div><div class="file-upload-list"><div class="file-upload-item"><span class="pf-file-icon">…</span><input class="og-input">…</div></div>', fields: { dropzone: 'where files are dropped or picked', item: 'one chosen file and the key it gets' } },
        useFor: ['Before an upload, when a person picks one file or several and names where each is stored.'],
        variants: [{ name: 'dragover', class: 'dragover', when: 'a file is dragged over the area' }, { name: 'has-file', class: 'has-file', when: 'at least one file is chosen' }],
        example: { files: ['notes.txt', 'plan.md'] },
        note: 'Moved unchanged out of views/profile.css on 2026-09-25; the memory tab draws it (FileUploadForm).',
    },
    {
        id: 'tag-input', name: 'Tag input', kind: 'component', status: 'active',
        summary: 'A field that holds a list of words as tags: the tags so far, each a Tag with its remove mark (.poster-chip-x), and a bare text field after them in one control frame; Enter or a comma adds the word, Backspace in an empty field takes the last one off.',
        module: '/views/profile/shared.js', sheet: '/css/components/tag-input.css', classes: ['pj-taginput', 'pj-tag', 'pj-taginput-field'],
        data: { shape: 'TagInput({ tags, onChange, placeholder })', fields: { tags: 'the words so far', onChange: 'called with the new list', placeholder: 'the empty field\u2019s words' } },
        useFor: ['A short list of free words a person types, such as an organism\u2019s interests.'], variants: [], example: { tags: ['design', 'ferries'] },
        note: 'Moved unchanged out of views/profile.css on 2026-09-25; the organism settings page draws it.',
    },
    // Parts drawn one way only, moved out of a tab's sheet unchanged (wave 3, the agent pages).
    {
        id: 'todo-list', name: 'To-do list', kind: 'component', status: 'active',
        summary: 'A task\'s steps, one per row under a hairline: a small framed tick box in front (a green tick when done, a coral cross when it failed, a coral mark while it runs), the step in bold with its tag, grey lines under it, and on the right its estimate and when it finished.',
        module: null, sheet: '/css/components/todo-list.css', classes: ['agt-todo', 'agt-tick', 'agt-todo-b', 'agt-sub', 'agt-todo-r'],
        data: { shape: '<div class="agt-todo"><span class="agt-tick agt-tick--done">✓</span><div class="agt-todo-b"><b>…</b><div class="agt-sub">…</div></div><div class="agt-todo-r">…</div></div>', fields: { tick: 'the step\'s state', b: 'the step', sub: 'a line about it', r: 'its estimate and when it finished' } },
        useFor: ['The steps an agent plans for one task, and how far it got.'],
        variants: [
            { name: 'done', class: 'agt-tick--done', when: 'the step is done' },
            { name: 'failed', class: 'agt-tick--failed', when: 'the step failed' },
            { name: 'active', class: 'agt-tick--active', when: 'the agent works on it now' },
            { name: 'pending', class: 'agt-tick--pending', when: 'it waits its turn' },
            { name: 'old', class: 'agt-todo--old', when: 'a step of an earlier plan' },
        ],
        example: { steps: [['done', 'Read the question'], ['active', 'Draft the answer'], ['pending', 'Send it']] },
        note: 'Moved on 2026-09-25 out of the agent Tasks tab\'s sheet, unchanged; the only place that draws a to-do list.',
    },
    {
        id: 'crew-dag', name: 'TaskDag', kind: 'component', status: 'active',
        summary: 'The task-order picture of a crew: each task a grey box with its id in bold typewriter and its agent under it, a coral arrow from a task to each task that reads it, a coral frame on a task with a problem.',
        module: '/views/profile/agents/crew-dag.js', sheet: '/css/components/crew-dag.css', classes: ['pf-agd-crew-dag', 'pf-agd-crew-dag-node', 'pf-agd-crew-dag-edge'],
        data: { shape: 'TaskDag({ tasks, problemIds })', fields: { tasks: 'the crew\'s tasks, each with its id, agent and the ids it reads (context)', problemIds: 'the tasks the validator named' } },
        useFor: ['How the tasks of a crew follow one another, under the form that edits them.'],
        variants: [{ name: 'problem', class: 'pf-agd-crew-dag-node--problem', when: 'the validator found a problem in this task' }],
        example: { tasks: [{ id: 'research', agent: 'scout' }, { id: 'write', agent: 'writer', context: ['research'] }] },
        note: 'Moved on 2026-09-25 out of the agent Crew tab\'s sheet, unchanged; the only place that draws it.',
    },
    {
        id: 'drag-grip', name: 'Drag grip', kind: 'component', status: 'active',
        summary: 'A row a person drags to put in another order: the grip (⠿) in the gutter at its left, grey and hidden until the pointer is on the row, the grab hand on it, the row dimmed while dragged; a drop near the grip still lands on the row.',
        module: null, sheet: '/css/components/drag-grip.css', classes: ['pf-agd-dnd-row', 'pf-agd-dnd-grip', 'pf-agd-dnd-dragging'],
        data: { shape: '<div class="pf-agd-dnd-row" draggable="true"><span class="pf-agd-dnd-grip">⠿</span>…</div>', fields: { row: 'the thing that moves, and where a drop lands', grip: 'the mark a person takes it by' } },
        useFor: ['A list whose order the person sets by hand.'],
        variants: [{ name: 'dragging', class: 'pf-agd-dnd-dragging', when: 'the row while it is dragged' }],
        example: { rows: ['bot', 'claude-code'] },
        note: 'Moved on 2026-09-26 out of the agent page\'s sheet, unchanged; the Agents table is the only place that draws it.',
    },
    {
        id: 'gaii-chip', name: 'GaiiChip', kind: 'component', status: 'active',
        summary: 'An agent\'s GAII as a control: the full identifier in small grey typewriter letters with a copy mark, no chrome until the pointer is on it (then the sun), green for a moment once copied; it ellipsizes rather than wraps.',
        module: '/views/profile/agents/gaii-chip.js', sheet: '/css/components/gaii-chip.css', classes: ['pf-agd-gaii', 'pf-agd-gaii-value', 'pf-agd-gaii-mark'],
        data: { shape: 'GaiiChip({ agent, className })', fields: { agent: 'the agent whose GAII it shows and copies', className: 'a place\'s own class' } },
        useFor: ['The identifier a person hands to a chat, a config file or another agent, beside the agent\'s name.'],
        variants: [{ name: 'copied', class: 'pf-agd-gaii--copied', when: 'for two seconds after a press' }],
        example: { gaii: 'bot#sandbox@aimeat-local-001-dev' },
        note: 'Moved on 2026-09-25 out of the agent page\'s sheet and the poster skin, unchanged; the agent page is the only place that draws it.',
    },
    {
        id: 'model-picker', name: 'Model picker', kind: 'component', status: 'active',
        summary: 'A framed catalogue of AI models under a row: a search field across the top, the recommended group, one row per model (name and id, a trait or a note, the price, the context), the chosen one on the sun, a taken one dimmed, and a line with "show all".',
        module: null, sheet: '/css/components/model-picker.css', classes: ['model-picker', 'model-picker-group', 'model-picker-list', 'model-picker-row', 'model-picker-trait', 'model-picker-note', 'model-picker-price', 'model-picker-ctx', 'model-picker-more', 'model-picker-empty'],
        data: { shape: '<div class="model-picker"><input class="og-input" type="search"><div class="model-picker-group poster-day-title">…</div><ul class="model-picker-list"><li class="model-picker-row is-on"><button><span><b>…</b><code>…</code></span><span class="model-picker-trait">…</span><span class="model-picker-price">…</span><span class="model-picker-ctx">…</span></button></li></ul><div class="model-picker-more">…</div></div>', fields: { name: 'the model', id: 'its id', trait: 'what sets it apart, in words', note: 'a note in typewriter', price: 'what it costs', ctx: 'how much it reads' } },
        useFor: ['Choosing the AI model for a role or a test, under the row that names it.'],
        variants: [{ name: 'on', class: 'is-on', when: 'the chosen model' }, { name: 'taken', class: 'is-taken', when: 'a model that is already in the list' }],
        example: { rows: [['Claude Sonnet 4.5', 'anthropic/claude-sonnet-4.5', '$3 / $15 per M', '200k']] },
        note: 'Moved on 2026-09-25 from the AI page (ai-pick) and the calibrator (cal-pick), which drew it one way. On 2026-09-26 the classic AI settings\' ModelPicker (views/profile/openrouter/model-picker.js) took it too; its chosen-value line, a link column and the own-id row stay its own layout.',
    },
    {
        id: 'calibration-run', name: 'Calibration run', kind: 'component', status: 'active',
        summary: 'What opens under a calibration\'s run: the four steps as folds, each model\'s block on the grey ground with a heavy ink edge, the checkpoint table, the two proposal lists, the numbered proposals with the chosen ones on coral, the paste box.',
        module: null, sheet: '/css/components/calibration-run.css', classes: ['cal-steps', 'cal-step', 'cal-step-body', 'cal-step-doors', 'cal-m', 'cal-m-h', 'cal-dims', 'cal-cols', 'cal-ol', 'cal-props', 'cal-prop', 'cal-prop-n', 'cal-apply', 'cal-paste'],
        data: { shape: '<div class="cal-m"><div class="cal-m-h"><b>…</b><small>…</small></div><div class="cal-dims">…</div></div> · <div class="cal-props"><div class="cal-prop"><span class="cal-prop-n is-on">1</span><span class="cal-prop-t">…</span><span class="cal-prop-tag">…</span></div></div>', fields: { model: 'a model under test', dims: 'its checkpoints: pass, name, expected, got, weight', prop: 'one proposal, numbered, chosen or not' } },
        useFor: ['Reading one run of a calibration step by step.'],
        variants: [{ name: 'chosen', class: 'is-on', when: 'a proposal the chosen option takes' }],
        example: { model: 'Mistral Small 3.2', score: '82 %' },
        note: 'Moved on 2026-09-25 from calibrator-poster.css with its class names; only the calibrator draws it.',
    },
    {
        id: 'prompt-versions', name: 'Prompt versions', kind: 'component', status: 'active',
        summary: 'A prompt\'s versions as rows (the number as a small figure, its date in typewriter, what changed, a door), the one shown on the grey ground; the two editors side by side with a count beside each label; the line that saves the next version.',
        module: null, sheet: '/css/components/prompt-versions.css', classes: ['cal-vers', 'cal-ver', 'cal-ver-n', 'cal-ver-w', 'cal-ver-go', 'cal-editors', 'cal-field', 'cal-save'],
        data: { shape: '<div class="cal-vers"><div class="cal-ver is-on"><div class="cal-ver-n poster-stat-number poster-stat-number--small">v2<small>…</small></div><div class="cal-ver-w">…</div><div class="cal-ver-go">…</div></div></div>', fields: { n: 'the version and its date', w: 'what changed', go: 'show it' } },
        useFor: ['The versions of a text a person improves step by step, and its editors.'],
        variants: [{ name: 'shown', class: 'is-on', when: 'the version the editors show' }],
        example: { versions: [['v2', 'The price comes first'], ['v1', 'First version']] },
        note: 'Moved on 2026-09-25 from calibrator-poster.css with its class names; only the calibrator draws it.',
    },
    {
        id: 'score-chart', name: 'Score chart', kind: 'component', status: 'active',
        summary: 'Scores over time: the plot on the left, the legend beside it with a square in each line\'s colour, the name and the last score; the legend goes under the plot on a phone.',
        module: '/views/profile/calibrator/chart.js', sheet: '/css/components/score-chart.css', classes: ['cal-chart', 'cal-legend'],
        data: { shape: 'ScoreChart({ runs })', fields: { runs: 'the scored runs in order, each with a score per model' } },
        useFor: ['How the scores of a few models moved over a series of runs.'],
        variants: [], example: { lines: [['Mistral Small 3.2', '82 %'], ['Gemini 2.5 Flash', '77 %']] },
        note: 'Moved on 2026-09-25 from calibrator-poster.css with its class names; only the calibrator draws it.',
    },
    {
        id: 'offer-lines', name: 'Offer lines', kind: 'component', status: 'active',
        summary: 'Production lines: a line\'s head (name, a typewriter line, a door), then its steps as framed boxes joined by arrows; each step names the offer and, in typewriter, its agent and last state; a finished step is framed green, a failed one coral on a coral tint.',
        module: null, sheet: '/css/components/offer-lines.css', classes: ['op-line', 'op-line-h', 'op-steps', 'op-step', 'op-step--done', 'op-step--fail', 'op-arrow'],
        data: { shape: '<div class="op-line"><div class="op-line-h"><b>…</b><small>…</small><div class="og-doors">…</div></div><div class="op-steps"><button class="op-step op-step--done">…<small>…</small></button><span class="op-arrow">→</span>…</div></div>', fields: { head: 'the line\'s name and what it did last', step: 'one offer in the chain, its agent and state' } },
        useFor: ['A chain of agent jobs that run one after another, and how each went last.'],
        variants: [{ name: 'done', class: 'op-step--done', when: 'the step\'s last run finished' }, { name: 'failed', class: 'op-step--fail', when: 'the step\'s last run failed or stalled' }, { name: 'last', class: 'op-line--last', when: 'the last line, with no rule under it' }],
        example: { steps: ["Collect the hours", "Draft the invoice", "Send it"] },
        note: 'Moved on 2026-09-25 from offers-poster.css with its class names; only the Offers page draws it.',
    },
    {
        id: 'offer-map', name: 'Offer map', kind: 'component', status: 'active',
        summary: 'Offers laid out by need: as columns, as a grid of agents by needs, or as blocks that grow with what they hold; each offer a framed tile that links to its page, coral under the pointer.',
        module: null, sheet: '/css/components/offer-map.css', classes: ['op-map', 'op-tile', 'op-tile--line', 'op-tile--compact', 'op-col-h', 'op-cols', 'op-col', 'op-matrix', 'op-mx-head', 'op-mx-agent', 'op-mx-cell', 'op-blocks', 'op-block', 'op-block-tiles'],
        data: { shape: '<div class="op-cols"><div class="op-col"><div class="op-col-h poster-day-title"><span>…</span><em>2</em></div><a class="op-tile"><span class="op-tile-t"><span>…</span>↗</span>…</a></div></div>', fields: { head: 'a need and how many offers it has', tile: 'one offer: its title and its agent' } },
        useFor: ['Seeing every offer at once, grouped by what it is for.'],
        variants: [{ name: 'line', class: 'op-tile--line', when: 'a tile in the grid, whose row already names the agent' }, { name: 'compact', class: 'op-tile--compact', when: 'a tile in a block' }, { name: 'away', class: 'op-mx-agent--off', when: 'an agent that is not present' }],
        example: { columns: [["Write", "Draft an invoice"], ["Find", "Search the web"]] },
        note: 'Moved on 2026-09-25 from offers-poster.css with its class names; only the Offers page draws it.',
    },
    {
        id: 'offer-request', name: 'Offer request', kind: 'component', status: 'active',
        summary: 'Asking an offer: what it does in a reading size, the request field, the row with the button and its coral-framed warnings, and what came of it beside a sun edge with the provenance in typewriter.',
        module: null, sheet: '/css/components/offer-request.css', classes: ['op-ask', 'op-request', 'op-ask-row', 'op-warn', 'op-result'],
        data: { shape: '<p class="op-ask">…</p><textarea class="og-textarea op-request"></textarea><div class="op-ask-row"><button class="poster-slab">Ask</button><span class="op-warn">…</span></div><div class="op-result">…<small>…</small></div>', fields: { ask: 'what the offer does', warn: 'what to know before asking', result: 'what happened, and who did it' } },
        useFor: ['Asking one agent\'s offer from its page.'],
        variants: [],
        example: { ask: 'Draft an invoice from the hours logged this month.' },
        note: 'Moved on 2026-09-25 from offers-poster.css with its class names; only the Offers page draws it.',
    },
    {
        id: 'rating-stars', name: 'Rating stars', kind: 'component', status: 'active',
        summary: 'Five stars, the given ones dark and the others grey. To give a rating they are buttons, and the stars up to the one under the pointer turn dark; the rating row around them has a label, a note field that takes the rest of the row, and the send door. A rating read in a line is the smaller shown tone.',
        module: null, sheet: '/css/components/rating-stars.css', classes: ['op-rate', 'op-stars', 'op-stars--shown', 'op-stars--row', 'op-star', 'op-rate-note'],
        data: { shape: '<div class="op-rate"><span class="poster-label">…</span><span class="op-stars"><button class="op-star on">★</button>…</span><input class="og-input op-rate-note"><button class="poster-action">…</button></div> · <span class="op-stars op-stars--shown" role="img" aria-label="4/5"><span class="op-star on" aria-hidden="true">★</span>…</span>', fields: { stars: 'one to five', note: 'a word about it' } },
        useFor: ['Rating a delivery an agent made.', 'A rating read in a line: a review, a rated task.', 'A rating in a narrow table column beside a status: the row cut.'],
        variants: [{ name: 'given', class: 'on', when: 'a star up to the rating' }, { name: 'shown', class: 'op-stars--shown', when: 'a rating you read in a line, not pressable' }, { name: 'row', class: 'op-stars--row', when: 'the shown tone cut small (.7rem) for a narrow column beside a status, as in a delivery row' }], example: { stars: 3 },
        note: 'Moved on 2026-09-25 from offers-poster.css with its class names. On 2026-09-26 every star rating in Settings & Controls took it (Jouni\'s decision "Rating stars"): the Offers, an agent\'s Quality and Tasks, the rate dialog, the Work tab.',
    },
    {
        id: 'offer-hits', name: 'Offer hits', kind: 'component', status: 'active',
        summary: 'What the AI found for a need: a head with its label and a way to clear it, the hits as the Listing (name, agent, what it does in grey, why it fits in coral typewriter, a door), and what the page shows when nothing fits.',
        module: null, sheet: '/css/components/offer-hits.css', classes: ['op-ai-head', 'op-hit', 'op-why', 'op-noneed'],
        data: { shape: '<div class="op-ai-head">…</div><div class="listing listing--cols listing--hit-doors"><div class="listing-row op-hit"><div class="listing-name"><button class="og-tbl-name">…</button><p>…</p><div class="op-why">…</div></div><div class="listing-doors"><button class="poster-action">Ask</button></div></div></div>', fields: { hit: 'one offer that fits', why: 'why it fits' } },
        useFor: ['The offers an AI search found for what a person needs.'],
        variants: [],
        example: { hits: [["Draft an invoice", "It reads your hours."]] },
        note: 'Moved on 2026-09-25 from offers-poster.css with its class names; only the Offers page draws it.',
    },
    {
        id: 'week-rhythm', name: 'Week rhythm', kind: 'component', status: 'active',
        summary: 'A week at a glance: one row per schedule with its time, its name and a mark on each day it fires; today\'s column on a pale sun under a sun head; an agent\'s job marked in coral.',
        module: null, sheet: '/css/components/week-rhythm.css', classes: ['sc-rhythm', 'sc-hd', 'sc-hd--day', 'sc-today', 'sc-t', 'sc-nm', 'sc-d', 'sc-d--no', 'sc-d--agent', 'sc-last'],
        data: { shape: '<div class="sc-rhythm"><div class="sc-hd">…</div><div class="sc-hd sc-hd--day sc-today">Fri<small>25</small></div>…<div class="sc-t">06:00</div><div class="sc-nm">…<i>…</i></div><div class="sc-d sc-d--agent">●</div>…<div class="sc-last">…</div></div>', fields: { t: 'when it fires', nm: 'the schedule', d: 'one day: fires or not', last: 'its last run' } },
        useFor: ['Which schedules fire on which days of this week.'],
        variants: [{ name: 'today', class: 'sc-today', when: 'today\'s column' }, { name: 'agent', class: 'sc-d--agent', when: 'an agent does the job' }, { name: 'no', class: 'sc-d--no', when: 'it does not fire that day' }],
        example: { rows: [["06:00", "Morning digest", "every day"]] },
        note: 'Moved on 2026-09-25 from scheduler-poster.css with its class names; only the Scheduler page draws it.',
    },
    {
        id: 'job-chips', name: 'Job chips', kind: 'component', status: 'active',
        summary: 'Jobs that run all the time, as a wrapping row of framed buttons: the name in bold, how often in typewriter; coral under the pointer, a coral frame when the last run failed.',
        module: null, sheet: '/css/components/job-chips.css', classes: ['sc-cont', 'sc-job', 'sc-job--warn'],
        data: { shape: '<div class="sc-cont"><button class="sc-job">…<i>every 30 min</i></button></div>', fields: { name: 'the job', i: 'how often it runs' } },
        useFor: ['Jobs that run all the time, each one opens its page.'],
        variants: [{ name: 'warn', class: 'sc-job--warn', when: 'its last run failed' }],
        example: { jobs: [["Check the mailbox", "every 30 min"]] },
        note: 'Moved on 2026-09-25 from scheduler-poster.css with its class names; only the Scheduler page draws it.',
    },
    {
        id: 'workflow-steps', name: 'Workflow steps', kind: 'component', status: 'active',
        summary: 'A workflow\'s steps, one per row: the number in coral typewriter, the name in bold with its agent under it, what it takes and gives in grey, and its state and what was seen on the right; the state goes under the words on a narrow screen.',
        module: null, sheet: '/css/components/workflow-steps.css', classes: ['wp-step', 'wp-step-n', 'wp-step-body', 'wp-sig', 'wp-sig--key', 'wp-step-st'],
        data: { shape: '<div class="wp-step"><div class="wp-step-n">01</div><div class="wp-step-body"><b>…<small>…</small></b><div class="wp-sig">…</div></div><div class="wp-step-st"><b class="poster-status">…</b><span>…</span></div></div>', fields: { n: 'the step\'s number', body: 'its name, agent, and what it takes and gives', st: 'its state and what was seen' } },
        useFor: ['The steps of a chain of agent jobs, and how each went in a run.'],
        variants: [{ name: 'key', class: 'wp-sig--key', when: 'the memory key a step writes, in typewriter' }],
        example: { steps: [["01", "Collect the hours", "produced"]] },
        note: 'Moved on 2026-09-25 from workflows-poster.css with its class names; only the Workflows page draws it.',
    },
    {
        id: 'board-notices', name: 'Board notices', kind: 'component', status: 'active',
        summary: 'A board\'s notices, one per row: the category as a Tag, the title as a button, the words, who posted it and where in typewriter, the replies and the time on the right; a notice\'s page shows its text in a reading size and each reply beside a grey edge.',
        module: null, sheet: '/css/components/board-notices.css', classes: ['bp-notice', 'bp-cat', 'bp-cat--q', 'bp-notice-body', 'bp-notice-title', 'bp-who', 'bp-who-board', 'bp-r', 'bp-notice-text', 'bp-reply'],
        data: { shape: '<div class="bp-notice"><div class="bp-cat">…</div><div class="bp-notice-body"><button class="bp-notice-title">…</button><p>…</p><div class="bp-who">…</div></div><div class="bp-r"><b>…</b>…</div></div>', fields: { cat: 'the notice\'s category', body: 'title, words, who and where', r: 'replies and when' } },
        useFor: ['The notices of a board, and one notice with its replies.'],
        variants: [{ name: 'no category', class: 'bp-cat--q', when: 'a notice with no category: a grey dot' }],
        example: { notices: [["News", "The ferry timetable changes on Monday"]] },
        note: 'Moved on 2026-09-25 from boards-poster.css with its class names; only the Boards page draws it.',
    },
    {
        id: 'knowledge-entry', name: 'Knowledge entry', kind: 'component', status: 'active',
        summary: 'A knowledge package\'s reading: what it is about; its entries one per row (a title button, marks on the right, the opened text in a reading size), each entry\'s sources verified or not, and its relations as small framed buttons.',
        module: null, sheet: '/css/components/knowledge-entry.css', classes: ['kp-about', 'kp-entry', 'kp-entry-h', 'kp-entry-title', 'kp-entry-r', 'kp-entry-text', 'kp-refs', 'kp-ref', 'kp-ref--no', 'kp-rels', 'kp-rel'],
        data: { shape: '<div class="kp-entry is-open"><div class="kp-entry-h"><button class="kp-entry-title">…</button><div class="kp-entry-r">…</div></div><p class="kp-entry-text">…</p><div class="kp-refs"><div class="kp-ref"><i>verified</i><a>…</a></div></div><div class="kp-rels"><button class="kp-rel"><b>extends</b>…</button></div></div>', fields: { title: 'the entry', text: 'what it says', ref: 'a source, verified or not', rel: 'a relation to another entry' } },
        useFor: ['Reading the entries of a knowledge package with their sources.'],
        variants: [{ name: 'unverified', class: 'kp-ref--no', when: 'a source nobody has verified' }],
        example: { entries: [["Who may write", "Only approved agents write."]] },
        note: 'Moved on 2026-09-25 from knowledge-poster.css with its class names; only the Knowledge page draws it.',
    },
    {
        id: 'package-preview', name: 'Package preview', kind: 'component', status: 'active',
        summary: 'A pasted knowledge package before it is imported: its name and tags, its entries as the Listing (visibility, title, the start of the text under it), the import row.',
        module: null, sheet: '/css/components/package-preview.css', classes: ['kp-preview', 'kp-preview-h', 'kp-preview-entries', 'kp-preview-actions'],
        data: { shape: '<div class="kp-preview poster-box"><div class="kp-preview-h"><b>…</b><span class="poster-chip">…</span></div><div class="listing listing--cols listing--tag-name kp-preview-entries"><div class="listing-row"><div><span class="poster-chip">…</span></div><div class="listing-name">…<small class="listing-meta">…</small></div></div></div><div class="kp-preview-actions">…</div></div>', fields: { h: 'the package\'s name and tags', entry: 'one entry: visibility, title, the start of its text' } },
        useFor: ['Checking a package a chat produced before it is saved.'],
        variants: [],
        example: { entries: [["public", "Who may write"]] },
        note: 'Moved on 2026-09-25 from knowledge-poster.css with its class names; only the Knowledge page draws it.',
    },
    {
        id: 'morsel-flow', name: 'Morsel flow', kind: 'component', status: 'active',
        summary: 'Where morsels came from and went: two columns headed by their totals, their sources one per row with a sum; the pace beside its meter (what morsels buy is the Item grid).',
        module: null, sheet: '/css/components/morsel-flow.css', classes: ['wal-flow', 'wal-col', 'wal-col-h', 'wal-src', 'wal-pace', 'wal-bar'],
        data: { shape: '<div class="wal-flow"><div class="wal-col poster-box"><div class="wal-col-h"><b>+120</b> In<small>…</small></div><div class="wal-src"><span>…<small>…</small></span><b>…</b></div></div></div><div class="wal-pace poster-box">…<div class="wal-bar poster-box poster-box--meter"><svg>…</svg><span class="poster-meter-figure">…</span></div></div>', fields: { col: 'what came in, or what went out', src: 'one source and its sum', pace: 'how fast the balance fills' } },
        useFor: ['The morsel balance\'s flow on the Wallet page.'],
        variants: [],
        example: { in: '+120', out: '-40' },
        note: 'Moved on 2026-09-25 from wallet-poster.css with its class names; only the Wallet page draws it.',
    },
    {
        id: 'notification-feed', name: 'Notification feed', kind: 'component', status: 'active',
        summary: 'Notices one per row: when, who sent it and its kind, what it says (an unread one marked with a coral square, the first line in grey, what came of an action in green or coral), the doors; the sender goes on a phone.',
        module: null, sheet: '/css/components/notification-feed.css', classes: ['nt-rows', 'nt-rows--head', 'nt-when', 'nt-src', 'nt-what', 'nt-doors'],
        data: { shape: '<div class="nt-rows"><div class="nt-when poster-time"><b>2 h ago</b>09:12</div><div class="nt-src">…<small>…</small></div><div class="nt-what unread"><b>…</b><small>…</small><em class="ok">…</em></div><div class="og-tbl-door nt-doors">…</div></div>', fields: { when: 'how long ago, and the clock', src: 'who sent it, and its kind', what: 'the title, the first line, what came of it' } },
        useFor: ['The notices a person received, newest first.'],
        variants: [{ name: 'unread', class: 'unread', when: 'a notice not read yet' }, { name: 'head', class: 'nt-rows--head', when: 'the heading row' }],
        example: { rows: [["2 h ago", "second", "Asked you a question"]] },
        note: 'Moved on 2026-09-25 from notifications-poster.css with its class names; only the Notifications page draws it.',
    },
    {
        id: 'how-roads', name: 'How roads', kind: 'component', status: 'active',
        summary: 'Three ways to do one thing side by side in Object boxes: a coral typewriter key, a bold name, a grey sentence, and what starts it at the bottom; one column on a phone.',
        module: null, sheet: '/css/components/how-roads.css', classes: ['nt-roads', 'nt-road', 'nt-road-k'],
        data: { shape: '<div class="nt-roads"><div class="nt-road poster-box"><span class="nt-road-k">…</span><b>…</b><p>…</p><code class="code-inline">…</code></div></div>', fields: { k: 'which way', b: 'its name', p: 'what it does', code: 'what starts it' } },
        useFor: ['Showing the ways a person or their AI can do one thing.'],
        variants: [],
        example: { roads: [["MCP", "Your AI does it"], ["Chat", "Paste a prompt"], ["Here", "Use the form"]] },
        note: 'Moved on 2026-09-25 from notifications-poster.css with its class names; Notifications, Companies and Email draw it.',
    },
    {
        id: 'question-desk', name: 'Question desk', kind: 'component', status: 'active',
        summary: 'The page\'s one question field: a large field on a heavy ink underline, coral with the focus, its scope tabs beside it with counts, a hint under both, a heavy rule under the desk.',
        module: null, sheet: '/css/components/question-desk.css', classes: ['dv-desk', 'dv-field', 'dv-scope'],
        data: { shape: '<div class="dv-desk"><input class="dv-field"><div class="dv-scope"><button class="poster-tab is-on">Mine<i>120</i></button>…</div><p class="poster-hint">…</p></div>', fields: { field: 'what to find', scope: 'where to look, with how many', hint: 'what the search covers' } },
        useFor: ['One question over everything a person can reach.'],
        variants: [],
        example: { scopes: [["Mine", 120], ["Shared", 40], ["Public", 900]] },
        note: 'Moved on 2026-09-25 from discover-poster.css with its class names; only Discover draws it.',
    },
    {
        id: 'device-list', name: 'Device list', kind: 'component', status: 'active',
        summary: 'The devices signed in to an account: the device in bold with a typewriter line, its kind, when it was last seen; a rule under each row, indented under its sign-in row.',
        module: null, sheet: '/css/components/device-list.css', classes: ['ac-devices', 'ac-dh', 'ac-dn'],
        data: { shape: '<div class="ac-devices"><div class="ac-dh poster-label">…</div>…<div><b>…</b><small>…</small></div><div>…</div><div class="ac-dn">…</div></div>', fields: { device: 'the device and where', kind: 'what it is', seen: 'when it was last seen' } },
        useFor: ['Which devices hold a sign-in to the account.'],
        variants: [{ name: 'head', class: 'ac-dh', when: 'the column heads' }],
        example: { devices: [["Firefox on Windows", "browser", "today"]] },
        note: 'Moved on 2026-09-25 from access-poster.css with its class names; only the Access page draws it.',
    },
    {
        id: 'agent-chip', name: 'Agent chip', kind: 'component', status: 'active',
        summary: 'One agent under the person it works for: a small framed chip with its mark, its name and its count; your own agent in a green frame, another owner\'s agent grey, dashed and faded.',
        module: null, sheet: '/css/components/agent-chip.css', classes: ['pj-part-agent', 'own', 'ghost'],
        data: { shape: '<span class="pj-part-agent own">🤖 …<span class="poster-count poster-count--tally">…</span></span>', fields: { name: 'the agent\'s name (none for another owner\'s agent)', count: 'how many records it wrote here' } },
        useFor: ['Which agents have worked in a workspace, under the person each works for.'],
        variants: [{ name: 'own', class: 'own', when: 'your own agent: a green frame' }, { name: 'ghost', class: 'ghost', when: 'another owner\'s agent, whose name you are not shown: grey, dashed, faded' }],
        example: { agents: [["bot", 3, "own"], [null, 2, "ghost"]] },
        note: 'Moved on 2026-09-25 from profile.css with its class names; only the organism pages\' People panel draws it.',
    },
    {
        id: 'search-hits', name: 'Search hits', kind: 'component', status: 'active',
        summary: 'One hit in an organism\'s content search: a row button with the title in bold (its workspace or space small beside it) and a grey snippet under it; a rule under each row, the words coral under the pointer.',
        module: null, sheet: '/css/components/search-hits.css', classes: ['pj-search-hit', 'pj-search-hit-title', 'pj-search-hit-snippet'],
        data: { shape: '<button class="pj-search-hit"><span class="pj-search-hit-title">… <span class="pj-mini">· …</span></span><span class="pj-search-hit-snippet">…</span></button>', fields: { title: 'the record or document found', where: 'its workspace or space', snippet: 'the words around the match' } },
        useFor: ['The hits of a search across organisms, inside one organism, or inside one workspace.'],
        variants: [],
        example: { hits: [["Nordic Ferries: new booking flow", "ws-mugj7kkg749", "The booking flow loses a third of people at the seat map."]] },
        note: 'Moved on 2026-09-25 from profile.css and profile-poster.css with its class names; only the organism pages draw it.',
    },
    {
        id: 'schedule-calendar', name: 'Schedule calendar', kind: 'component', status: 'active',
        summary: 'The runs of scheduled jobs on a month, week or day: each run a chip striped in its kind\'s colour, today framed in coral, a legend of the kinds, and the jobs that run too often for the grid in a "continuously running" strip above it.',
        module: null, sheet: '/css/components/schedule-calendar.css', classes: ['sch-cal', 'sch-cal-head', 'sch-cal-month', 'sch-cal-week', 'sch-cal-day', 'sch-cal-ev', 'sch-cal-freq'],
        data: { shape: '<div class="sch-cal"><div class="sch-cal-head">…</div><div class="sch-cal-freq">…</div><div class="sch-cal-week"><div class="sch-cal-weekcol"><div class="sch-cal-weekcol-head">…</div><div class="sch-cal-weekcol-evs"><button class="sch-cal-ev sch-cal-ev--agent">…</button></div></div>…</div></div>', fields: { head: 'the mode tabs, the way back and on, the range, the legend', freq: 'the jobs that run too often to draw', ev: 'one run, striped in its kind\'s colour (--k)' } },
        useFor: ['When scheduled things will run, when the time is what a person reads.'],
        variants: [
            { name: 'today', class: 'sch-cal-cell--today', when: 'the day that is today (sch-cal-weekcol--today in a week)' },
            { name: 'past', class: 'sch-cal-ev--past', when: 'a run that has already happened' },
        ],
        example: { mode: 'week', kinds: ['ai', 'agent', 'ext', 'eco', 'sec', 'core'] },
        note: 'Moved unchanged out of views/scheduler.css on 2026-09-25; the scheduler\'s Calendar page draws it.',
    },
    {
        id: 'eco-automation', name: 'Ecosystem automation', kind: 'component', status: 'active',
        summary: 'An ecosystem app\'s automation: its one flow as numbered steps in a card (a coral number and title per step, the controls under it, a save row), the latest run as a status timeline (a dot per stage on a line, in its state\'s colour), and a job\'s facts, doors and run log.',
        module: null, sheet: '/css/components/eco-automation.css', classes: ['pf-eco-auto-flow-card', 'pf-eco-auto-flow-step', 'pf-eco-recipe-head', 'pf-eco-auto-status-timeline', 'pf-eco-auto-status-step', 'pf-eco-auto-status-dot', 'pf-eco-auto-log'],
        data: { shape: '<div class="pf-eco-auto-flow-card"><div class="pf-eco-auto-flow-step"><span class="pf-eco-recipe-head"><span class="pf-eco-auto-flow-num">①</span> …</span>…</div>…<div class="pf-eco-auto-flow-save">…</div></div><div class="pf-eco-auto-status-timeline"><div class="pf-eco-auto-status-step"><div class="pf-eco-auto-status-head"><span class="pf-eco-auto-status-dot pf-eco-auto-status-dot-ok"></span><strong class="pf-eco-auto-status-label">…</strong></div><div class="pf-eco-auto-status-body">…</div></div>…</div>', fields: { step: 'one step of the flow', num: 'its number', status: 'one stage of the latest run', dot: 'the stage\'s state: ok, wait, off, error' } },
        useFor: ['Setting up what an outside app\'s data goes through, and seeing where its latest run is.'],
        variants: [
            { name: 'ok', class: 'pf-eco-auto-status-dot-ok', when: 'a stage that is done' },
            { name: 'wait', class: 'pf-eco-auto-status-dot-wait', when: 'a stage waiting for something' },
            { name: 'error', class: 'pf-eco-auto-status-dot-error', when: 'a stage that failed' },
            { name: 'disabled step', class: 'pf-eco-auto-flow-step-disabled', when: 'a step that cannot be set yet' },
        ],
        example: { steps: 5, stages: ['published', 'processed', 'delivered'] },
        note: 'Moved unchanged out of views/profile.css on 2026-09-25; the ecosystem tab draws it for each connected app.',
    },
    {
        id: 'signed-out-door', name: 'Signed-out door', kind: 'component', status: 'active',
        summary: 'What a visitor who is not signed in sees at a Settings address: the address in a mono frame with a coral word, a two-line headline with the sun\'s shadow, where the address leads under a heavy rule, a lead, Sign in and Create an account, and a dashed aside that says what this place is.',
        module: '/views/profile/door.js', sheet: '/css/components/signed-out-door.css', classes: ['pf-door', 'pf-door-address', 'pf-door-label', 'pf-door-title', 'pf-door-target', 'pf-door-crumb', 'pf-door-lead', 'pf-door-what'],
        data: { shape: 'SignedOutDoor({ navigate, tabLabel })', fields: { tabLabel: 'the tab the address names, shown as where it leads; without it the profile alone' } },
        useFor: ['The one page a signed-out visitor meets at an address inside Settings & Controls.'],
        variants: [{ name: 'with a tab', class: 'pf-door-crumb', when: 'the address names a tab: "Settings & Controls → the tab"' }],
        example: { tabLabel: 'Security' },
        note: 'Moved unchanged on 2026-09-25: the sheet was views/profile-door.css; views/profile/door.js draws it.',
    },
    {
        id: 'figure-door', name: 'Figure door', kind: 'component', status: 'active',
        summary: 'A figure that opens its tab: a number in the poster face and a small grey capital word beside it, in a square frame of the text colour; one that opens nothing is not pressable.',
        module: null, sheet: '/css/components/figure-door.css', classes: ['pf-usage-chips', 'pf-usage-chip', 'pf-usage-chip-val', 'pf-usage-chip-label'],
        data: { shape: '<div class="pf-usage-chips"><button class="pf-usage-chip"><span class="pf-usage-chip-val poster-stat-number poster-stat-number--small">14</span><span class="pf-usage-chip-label">Agents</span></button></div>', fields: { value: 'the count', label: 'what it counts' } },
        useFor: ['Counts under a card that each open the tab holding what they count.'],
        variants: [], example: { value: '14', label: 'Agents' },
        note: 'Moved unchanged on 2026-09-26 out of views/profile.css and the skin\'s chip group (profile-poster.css); the overview\'s Usage & quotas card draws it.',
    },
    {
        id: 'requirement-list', name: 'Requirement list', kind: 'component', status: 'active',
        summary: 'What a value must meet, one requirement per line with ○ while unmet and ✓ once met; small grey words, a met line in the success colour.',
        module: null, sheet: '/css/components/requirement-list.css', classes: ['pf-pw-rules'],
        data: { shape: '<ul class="pf-pw-rules"><li class="ok">✓ At least 12 characters</li><li>○ A number</li></ul>', fields: { children: 'the requirements; li.ok when met' } },
        useFor: ['Showing, while a person types, which requirements a value already meets.'],
        variants: [], example: { children: 'At least 12 characters' },
        note: 'Moved unchanged on 2026-09-26 out of views/profile.css; the change-password dialog draws it.',
    },
];
