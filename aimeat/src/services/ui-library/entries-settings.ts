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
 *   v1.88.0 — 2026-09-27 — The Rail's light tone and PageSection group (the admin Config page as main drew it).
 *   v1.87.0 — 2026-09-27 — What the admin pages added: PageSection band; the Listing's operator cuts; the Search
 *     line's find; a Board notice's title without onOpen. The Listing and the Search line no longer speak of admin
 *     markup (the admin pages draw the List now).
 *   v1.86.1 — 2026-09-27 — SignedOutDoor draws its own names (.signed-out-door-*, formerly .pf-door-*).
 *   v1.86.0 — 2026-09-27 — The Score chart, Offer map, Offer request, Rating stars, Week rhythm, Job chips, Workflow
 *     steps, Morsel flow, Schedule calendar and Ecosystem automation move to entries-views-work.ts (this file had
 *     passed its length limit; catalogue pass, work views family).
 *   v1.85.1 — 2026-09-27 — Board notices is components/BoardNotice.js (its bp- classes became board-notice*); the
 *     Listing, Search line and More line say the List draws them; the Knowledge entry says only the public knowledge
 *     viewer writes its classes now (catalogue pass, list and conversation family).
 *   v1.85.0 — 2026-09-27 — figure-strip, facts, setting-box, code-block, form-message and loading-mark move
 *     unchanged to entries-kit.ts (the kit draws them now; this file had passed its 800-line limit).
 *   v1.84.0 — 2026-09-27 — The page kit's parts name their modules (catalogue pass): tab-page is Rail.js,
 *     crumb-trail Crumb.js, page-head PageHead.js; page-section and fold-row say what PageSection and
 *     FoldSection take now (plain, clip, wrap, inner); the fold rows are the folds entry.
 *   v1.83.0 — 2026-09-27 — The kit family's parts (catalogue pass): facts is Facts.js, figure-strip FigureStrip.js;
 *     code-block, form-message, setting-box and loading-mark say which kit call draws them now (Code, Note
 *     kind="message", SettingBox, Note kind="loading") and keep module null (their classes are the admin's too).
 *   v1.82.0 — 2026-09-27 — The field family's parts name their modules (catalogue pass): select-field is Select.js,
 *     tag-input TagInput.js (its old .pj-taginput classes dropped), model-picker ModelPicker.js, file-drop
 *     FileDrop.js; form-fields says which calls draw its classes now. The five then move unchanged to
 *     entries-fields.ts, with their ids (this file had passed its 800-line limit).
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
        id: 'tab-page', name: 'Rail', kind: 'component', status: 'active',
        summary: 'The dark contents rail beside a Settings page, with its sun shadow: coral group labels, the page\'s sections as numbered links that bring a section to the top, the way back, the page\'s modes and acts, and the sibling pages marked →; a rule between groups, the current item at full strength. On a phone it stands under the page. Its sheet also holds the page\'s root and columns (.og, .og-grid, .og-main), which SettingsPage draws.',
        module: '/components/Rail.js', sheet: '/css/components/tab-page.css',
        data: {
            shape: 'Rail({ title, groups, tone }) · scrollToSection(id) · openTab(tabId) · railSection({ id, num, label, count, open, href })',
            fields: {
                title: 'the rail\'s name for a screen reader',
                tone: 'light: the index on the page\'s own ground under a heavy ink rule (the admin Config page\'s index)',
                groups: '[{ label, rule, items }]: a coral label, then its items; a rule stands between two groups unless the later one says rule: false',
                'item.section': 'the id of a section to scroll to; open() first opens a folded one; with href (\'#id\') the item is an anchor',
                'item.tab': 'a Settings tab to open (mark and count default to →)', 'item.href, item.newTab': 'a link (mark and count default to →)',
                'item.onClick': 'anything else: a mode of the page, an act', 'item.back': 'the way back, with the ← mark',
                'item.mark, item.count': 'the small mono sign on the left and the mono word on the right; a count of \'\' draws nothing',
                'item.on, item.disabled, item.title, item.key': 'the current item (aria-current), off, the tooltip, the key',
                'item.still, item.plain': 'a line with no way on: at full strength, or at the rail\'s own strength without the pointer',
                'item.code, item.notice, item.note': 'the label as an identifier in typewriter letters; the label in coral; small grey words under the item above',
                scrollToSection: 'scrolls the content column to a section and moves nothing else', openTab: 'opens a Settings tab by its id (the aimeat-open-tab event)',
                railSection: 'a page\'s section as a rail item',
            },
        },
        useFor: ['Beside a Settings page, to move between its sections and to its sibling pages. A page usually gives SettingsPage the short form (sections, pages, back) and lets it build the rail.'],
        variants: [
            { name: 'current', class: 'on', prop: 'item.on', when: 'the item of what is shown now, at full strength' },
            { name: 'light', class: 'og-rail--light', prop: 'tone="light"', when: 'an index on the page\'s own ground: ink group words, grey items, grey counts (the admin Config page, as main drew it; the dark look is the operator menu\'s alone)' },
            { name: 'still', prop: 'item.still', when: 'a line that only says something, at full strength (a static count)' },
            { name: 'plain', class: 'og-rail-plain', prop: 'item.plain', when: 'a line that only says something at the rail\'s own strength (a workflow\'s agents, "5 more")' },
            { name: 'code', class: 'og-rail-code', prop: 'item.code', when: 'the label is an identifier (a memory key), as written' },
            { name: 'notice', class: 'og-rail-notice', prop: 'item.notice', when: 'a line that asks for a look (a check that fails), in coral' },
            { name: 'note', class: 'og-rail-note', prop: 'item.note', when: 'small grey words under the item above (a poster\'s standing and since when)' },
            { name: 'page', class: 'og-page', prop: 'SettingsPage page', when: 'a page inside a page: the page column sits a little lower' },
        ],
        example: { title: 'On this page', groups: [{ label: 'On this page', items: [{ section: 'og-files', mark: '01', label: 'Files', count: 12, on: true }, { section: 'og-people', mark: '02', label: 'People', count: 4 }] }, { label: 'Pages', items: [{ tab: 'agents', label: 'Agents' }] }] },
        note: 'It replaced the og-rail markup every Settings page wrote, the pageLinks() helper of each frame.js, the local openTab of each frame.js, and scrollTo in views/profile/organisms/poster-parts.js (which re-exports scrollToSection under the old name until nothing imports it). The tree that can take the rail\'s place is the contents-tree entry, on the same sheet.',
    },
    {
        id: 'crumb-trail', name: 'Crumb', kind: 'component', status: 'active',
        summary: 'The mono path over a page\'s title, from Settings down to the page you are on: a step you can go back to is a coral link, the page you are on is ink, a plain step is grey, and a slash stands between the steps.',
        module: '/components/Crumb.js', sheet: '/css/components/crumb-trail.css',
        data: {
            shape: 'Crumb({ steps })',
            fields: {
                steps: 'the path. A step is a string (a grey word; the last string is the page you are on), { label, onClick } or { label, href } (a coral link back), { label, here: true } (a page you are on, wherever it stands) or { label } (a plain word); null, false and \'\' are left out',
                'step.title': 'a tooltip on the step',
            },
        },
        useFor: ['Over the title of a page that sits inside another. SettingsPage draws it from its crumb.'],
        variants: [
            { name: 'link', class: 'og-crumb-link', prop: '{ label, onClick } | { label, href }', when: 'a step you can go back to' },
            { name: 'here', class: 'og-crumb-here', prop: 'the last string | { label, here: true }', when: 'the page you are on' },
        ],
        example: { steps: ['Settings', { label: 'Organisms', onClick: '…' }, 'Harbour Studio'] },
        note: 'It replaced the crumb() helper in each views/profile/<page>/frame.js and the og-crumb markup the pages wrote by hand.',
    },
    {
        id: 'page-head', name: 'PageHead', kind: 'component', status: 'active',
        summary: 'The head of a Settings page under its crumb: the big poster title with a small mono line beside it, a small label over it on a page inside a page, the tags under it, the grey sentence that says what the page is for, and at the right the column of what the page offers first (the loud action, a hint, a row of action links). On a phone the column stands under the words.',
        module: '/components/PageHead.js', sheet: '/css/components/page-head.css',
        data: {
            shape: 'PageHead({ label, title, sub, marks, desc, actions, page, asKey, edit })',
            fields: {
                label: 'a small label over the title (a page inside a page names its kind: Person, Board)', title: 'the page\'s name, always an h1',
                sub: 'the small mono line beside the title (a count, a subtitle)',
                marks: 'the tags under the title: Mark nodes or data { label, tone, kind, title }; an empty list keeps the empty row, so the head does not jump when the tags load',
                desc: 'one or two sentences on what the page is for', actions: 'the right column: a Loud, a Note kind="hint" slab, an Actions row',
                page: 'the head of a page inside a page', asKey: 'the title is a memory key, in the typewriter face as written',
                edit: 'what stands in the title\'s place while the title is renamed (the field with its save and cancel)',
            },
        },
        useFor: ['The first thing on a Settings page. SettingsPage draws it from its head props.'],
        variants: [
            { name: 'page', class: 'og-mast--page', prop: 'page', when: 'a page inside a page: the title sits on the column\'s foot, the sentence a little lower' },
            { name: 'key title', class: 'og-title--key', prop: 'asKey', when: 'the title is a memory key (a record\'s page)' },
            { name: 'actions', class: 'og-mast-actions', prop: 'actions', when: 'the page offers something first: the column at the right' },
            { name: 'renaming', prop: 'edit', when: 'while the title is renamed' },
        ],
        example: { title: 'Skills', sub: '12 own', marks: [{ label: '3 bound to an app', tone: 'sun' }], desc: 'What your agents know how to do.' },
        note: 'It replaced the og-mast markup every Settings page wrote by hand. The tags row is poster.css\'s .poster-chips; the old .og-chips rule stays for the public knowledge viewer, which still writes it.',
    },
    {
        id: 'page-section', name: 'PageSection', kind: 'component', status: 'active',
        summary: 'An open section of a Settings page: the heavy rule on top (or the section title\'s own), the ink section title with a small coral mono number or count beside it, the section\'s actions at the right, and the body. The plain cut has no head, only the rule and the body.',
        module: '/components/PageSection.js', sheet: '/css/components/page-section.css',
        data: {
            shape: 'PageSection({ id, num, title, count, doors, first, plain, band, group, children })',
            fields: {
                id: 'the section\'s anchor, which the rail scrolls to', num: 'the small number beside the title', title: 'the section\'s name',
                count: 'a count instead of the number', doors: 'the section\'s actions at the right of its head (Action links)',
                first: 'the first section under the page head: no rule on top', plain: 'no head at all: the rule on top (none with first) and the body',
                band: 'the title\'s dark band spans the whole column, as the classic pages drew it (P&L, Nodes, Organisms, Notebook, Federation, Chat sessions)', children: 'the body',
            },
        },
        useFor: ['Each open part of a Settings page. Section without fold is the same component; a lead inside it is Note kind="lead".'],
        variants: [
            { name: 'first', class: 'og-sec--first', prop: 'first', when: 'the first section under the page head' },
            { name: 'plain', prop: 'plain', when: 'a box that stands as a section of its own without a title (a member\'s "Leave" on an organism\'s settings)' },
            { name: 'band', class: 'og-sec-h--band', prop: 'band', when: 'the title\'s band across the whole column (the classic pages)' },
            { name: 'group', class: 'og-sec--group', prop: 'group', when: 'a section that holds a group of sections, its band smaller and across the column (the admin Config domains)' },
            { name: 'split', class: 'og-split', prop: 'Split (Layout.js)', when: 'a part of a section set off by a hairline: its last actions, a group inside it' },
            { name: 'side split', class: 'og-split--side', prop: 'Split side (Layout.js)', when: 'the line at the part\'s start and the part indented: a quieter side door' },
        ],
        example: { id: 'og-people', num: '02', title: 'People', doors: 'Invite', children: '…' },
        note: 'The sheet also holds the lead (.og-lead, drawn by Note kind="lead"), the hint (.og-hint) and its label cut (.og-hint--label), which no page writes now, and the split\'s lines that Layout\'s Split draws.',
    },
    {
        id: 'fold-row', name: 'FoldSection', kind: 'component', status: 'active',
        summary: 'A section of a Settings page that is one row until it is opened: a coral mono number, the title, a mono detail at the right and the arrow; the row opens the section in place and says aria-expanded. Open, the body stands under the row. A lead line can stand under the row open or shut.',
        module: '/components/FoldSection.js', sheet: '/css/components/fold-row.css',
        data: {
            shape: 'FoldSection({ id, num, title, sub, lead, open, onToggle, clip, wrap, inner, children })',
            fields: {
                id: 'the section\'s anchor, which the rail scrolls to', num: 'the row\'s number', title: 'the section\'s name', sub: 'the mono detail at the right of the row',
                lead: 'a line under the row, shown open or shut', open: 'the body is shown', onToggle: 'the row was pressed',
                clip: 'a long detail is cut with … on its one line', wrap: 'under 1100px the detail stands under the title, whole',
                inner: 'a fold inside a part, one of several under one rule: no rule and no number, a hairline under its row', children: 'the body',
            },
        },
        useFor: ['A part of a page that is closed by default and opens in place. Section with fold is the same component.'],
        variants: [
            { name: 'open', class: 'is-open', prop: 'open', when: 'the section is open: the arrow points down and the body shows' },
            { name: 'lead', prop: 'lead', when: 'a line that says what the section holds before it is opened' },
            { name: 'clip', class: 'og-fold-r--clip', prop: 'clip', when: 'a detail that is a whole phrase (the MCP page\'s folds)' },
            { name: 'wrap', class: 'og-fold-sec--wrap', prop: 'wrap', when: 'a detail that must be read whole on a narrower screen (the Offers pages\' folds)' },
            { name: 'inner', class: 'og-fold-sec--inner', prop: 'inner', when: 'several folds inside one part (the Agents page\'s three developer roads)' },
        ],
        example: { id: 'og-map', num: '04', title: 'Map', sub: '12 spaces', open: false },
        note: 'Its sheet also holds the rows of Folds (the folds entry): the event, toggle, done and plain rows, and a row\'s own actions.',
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
        id: 'listing', name: 'Listing', kind: 'component', status: 'active',
        summary: 'Things in rows of columns under a heading row: the name in bold with a small typewriter line, a grey description, who or where, the doors on the right; a row can open a framed panel under it. On a phone one column, or the narrow columns of its cut (listing--cols). The List component (components/List.js) draws it in Settings & Controls and on the operator pages: List with its cut and head, Row, and the Name, Desc, Who, Num, When, Cell, Doors and Panel cells; a page writes none of these classes.',
        module: null, sheet: '/css/components/listing.css', classes: ['listing', 'listing-row', 'listing-name', 'listing-desc', 'listing-who', 'listing-doors', 'listing-open', 'listing-meta'],
        data: { shape: 'List({ cols, keepCols, head }) › Row({ open }) › Name · Desc · Who · Num · When · Cell · Doors · Panel (components/List.js)', fields: { cols: 'the cut, named by its columns (List cols)', name: 'the thing (Name)', desc: 'what it is (Desc)', who: 'whose it is or where (Who)', doors: 'what a person can do with it (Doors)', open: 'the panel one row opens (Panel, Row open)' } },
        useFor: ['A list of things a person owns or can install, when each needs a few columns: in Settings and on the operator pages, through the List.'],
        variants: [{ name: 'head', class: 'listing-row--head', prop: 'List head', when: 'the heading row' }, { name: 'open', class: 'is-open', prop: 'Row open', when: 'the row whose panel is open' }, { name: 'cols', class: 'listing--cols', prop: 'List keepCols', when: 'the list keeps the columns of its cut on a narrow screen instead of stacking' }, { name: 'meta', class: 'listing-meta', when: 'the grey typewriter line under a name outside a Listing row (Jouni\'s decision "Meta line"; the Box\'s BoxLine meta draws it)' },
            { name: 'operator cuts', class: 'listing--n-name-n-when-doors', prop: 'List cols="<cut>"', when: 'the operator pages\' tables, each with main\'s column widths and narrow rules (2026-09-27): id-name-in-out-state-mark-n-n, id-name-state-n-when-when, id-name-who-state-n-tags, n-id-state-name-who-n-when, n-name-n-when-doors, n-name-state, n-name-tags-n-when-doors, n-name-who-count-when-doors, name-code-state-when-doors, name-code-when-when, name-desc-code-n, name-desc-n-n-n-n, name-desc-state-mark-when-when-doors, name-id-score-n-mark-doors, name-id-when, name-id-who-ver-n-when, name-id-who-when-mark, name-kind-id-when-state-doors, name-kind-state-when, name-kind-words, name-n-bar-desc, name-n-code-code-bar, name-n-desc, name-n-n-bar, name-n-n-bar-doors, name-n-n-n-bar, name-n-n-n-n-n-state, name-n-where-state-doors, name-state-kind-code-when-desc-edit-doors, name-state-meta-meta-doors, name-state-n-trend, name-state-words-when, name-tags-when-doors, name-ver-kind-n-state, name-ver-who-n-kinds-doors, name-when-who-state-when-doors, name-where-what-who-when-doors, name-who-code-desc-desc, name-who-doors, name-who-kind-n-seen-review-when-doors, name-who-n-n-n-when-doors, name-who-state-count-when-doors, name-who-tags-n-when-doors, name-words, name-words-when, state-name-code-desc, state-name-who-when-doors, tag-n-name-doors, tag-name-desc, tag-when-who-n, when-name-kind-state-n-desc, when-name-kind-who, when-state-path-where-kind-desc' }],
        example: { rows: [['aimeat-writing', 'How prose is written', 'sandbox']] },
        note: 'Built on 2026-09-25 with the look six Settings tabs draw as identical copies; the Settings listings moved onto it the same day, each with a cut named by its columns. On 2026-09-27 the operator pages\' tables moved onto the List too, each with its own cut here (the operator cuts variant). No module of its own: the List (entry list) draws these classes everywhere.',
    },
    {
        id: 'search-line', name: 'Search line', kind: 'component', status: 'active',
        summary: 'The field that searches a list, across the row, and how many it found in small grey typewriter letters at its end. The List\'s SearchLine (components/List.js) draws it, with the clear mark, a button or a hint after the field, and on the operator pages the magnifier before it.',
        module: null, sheet: '/css/components/search-line.css', classes: ['search-line'],
        data: { shape: 'SearchLine({ value, onInput, onEnter, onClear, placeholder, note, text, beside, find, children }) (components/List.js)', fields: { input: 'what to look for (value, onInput)', small: 'how many it found (note)', find: 'the magnifier before the field' } },
        useFor: ['Above a list a person can search.'],
        variants: [{ name: 'beside', class: 'search-line--beside', prop: 'SearchLine beside', when: 'one of several lines side by side in a row, under each other on a phone' },
            { name: 'find', class: 'search-line-glass', prop: 'SearchLine find', when: 'an operator page\'s search: the ink magnifier before the field (main\'s admin Cortex and Knowledge searches)' }], example: { found: '12 of 40' },
        note: 'Built on 2026-09-25 with the look six Settings tabs drew as identical copies; since then the Settings tabs\' search fields over a list sit in it, with a button or a count beside the field where the place has one, and since 2026-09-27 the operator pages\' searches too. No module of its own: the List\'s SearchLine draws it.',
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
        id: 'proof-ledger', name: 'ProofLedger', kind: 'component', status: 'active',
        summary: 'Which model proved a thing, whether it passed, what it cost, when and the evidence: one line per proof in five typewriter columns, the verdict green when it passed and coral when it failed, the evidence\'s full path as its tooltip; on a phone the model and the verdict.',
        module: '/components/ProofLedger.js', sheet: '/css/components/proof-ledger.css',
        data: {
            shape: 'ProofLedger({ rows })',
            fields: { rows: '[{ key, model, pass, verdict, tokens, date, evidence, evidenceTitle }]: the model, whether it passed and the verdict\'s word, the tokens, the date, the evidence\'s file and its full path' },
        },
        useFor: ['The record of the tests a library passed with named models, inside its opened panel.'],
        variants: [{ name: 'passed', class: 'ok', prop: 'rows[].pass', when: 'the proof passed: the verdict in green' }, { name: 'failed', class: 'no', prop: 'rows[].pass={false}', when: 'the proof failed: the verdict in coral' }],
        example: { rows: [{ key: 'a', model: 'claude-haiku-4-5', pass: true, verdict: 'pass', tokens: '12,400 tok', date: '2026-09-20', evidence: 'proof-file-storage.json' }] },
        note: 'Moved on 2026-09-25 out of the Libraries sheet (a move); since 2026-09-26 the component draws it, and since 2026-09-27 under its own name (.proof-ledger, formerly .lb-proof). The Libraries page draws it.',
    },
    {
        id: 'changelog', name: 'ChangeLog', kind: 'component', status: 'active',
        summary: 'One version per line: its number and date in grey typewriter letters and what changed in body words, a breaking change after it as the coral notice word, a rule under each; on a phone the three stack.',
        module: '/components/ChangeLog.js', sheet: '/css/components/changelog.css',
        data: {
            shape: 'ChangeLog({ entries })',
            fields: { entries: '[{ key, version, date, summary, breaking }], newest first: the version, its date, what changed, and the words of a breaking change (none when it breaks nothing)' },
        },
        useFor: ['The versions of a thing a person can install, newest first, inside its opened panel.'],
        variants: [{ name: 'breaking', prop: 'entries[].breaking', when: 'a version that breaks what used it: the words after the change, in coral bold' }],
        example: { entries: [{ version: '1.1.3', date: '2026-09-20', summary: 'The legend wraps on a phone.' }, { version: '1.1.0', date: '2026-08-02', summary: 'Stacked bars.', breaking: 'Breaking: the colours option is a list' }] },
        note: 'Moved on 2026-09-25 out of the Libraries sheet (a move); since 2026-09-26 the component draws it, and since 2026-09-27 under its own name (.changelog, formerly .lb-cl). The Libraries page draws it.',
    },
    {
        id: 'address-preview', name: 'AddressPreview', kind: 'component', status: 'active',
        summary: 'One grey typewriter line under a name field: the address the name will get, in coral, as it is typed, and whether it is free; a taken one says why in the danger colour; an ellipsis while the node checks.',
        module: '/components/AddressPreview.js', sheet: '/css/components/address-preview.css',
        data: {
            shape: 'AddressPreview({ label, address, state, free, taken })',
            fields: { label: 'the word before the address', address: 'the address the name will get', state: '\'checking\' | \'free\' | \'taken\'', free: 'the words when it is free', taken: 'why it cannot be had' },
        },
        useFor: ['Under a field whose words become an address, while the person types.'],
        variants: [
            { name: 'free', prop: 'state="free"', when: 'nobody has the address' },
            { name: 'taken', class: 'taken', prop: 'state="taken"', when: 'the address is taken or not allowed' },
            { name: 'checking', prop: 'state="checking"', when: 'the node has not answered yet: an ellipsis' },
        ],
        example: { label: 'Address', address: 'acme-widgets', state: 'free', free: 'free' },
        note: 'Moved on 2026-09-25 out of the Companies sheet (a move); since 2026-09-26 the component draws it, and since 2026-09-27 under its own name (.address-preview, formerly .co-preview). The Companies page draws it.',
    },
    {
        id: 'more-line', name: 'More line', kind: 'component', status: 'active',
        summary: 'The line under a list: the way to show more, and how many are shown in small grey typewriter letters beside it. In Settings & Controls the List\'s More (components/List.js) draws it, with the list\'s other doors after the count.',
        module: null, sheet: '/css/components/more-line.css', classes: ['more-line'],
        data: { shape: 'More({ label, onMore, disabled, note, wrap, children }) (components/List.js) · as markup in the admin: <div class="more-line"><button class="poster-action poster-action--more">Show 20 more</button><small>20 of 55</small></div>', fields: { button: 'show more (label, onMore)', small: 'how many are shown of how many (note)' } },
        useFor: ['Under a list that shows a page at a time.'],
        variants: [], example: { shown: '20 of 55' },
        note: 'Moved on 2026-09-25 out of six identical copies in the Skills, Packages, Capabilities, Libraries, Extensions and AppDev sheets, under one name (a move; nothing changed on screen). No module of its own: the class is shared with the admin pages, and in Settings the List\'s More draws it.',
    },
    {
        id: 'colour-tag', name: 'ColorPicker', kind: 'component', status: 'active',
        summary: 'A colour a person gives a section, a document or a record: a small round dot, filled with the chosen colour or an empty grey ring, that opens a small pop-up row of round swatches, seven theme colours and "no colour" (∅). The colours are theme tokens, so they follow the light and dark theme; the same token draws the coloured rail on the left of the thing it marks.',
        module: '/components/ColorPicker.js', sheet: '/css/components/colour-tag.css',
        data: {
            shape: 'ColorPicker({ value, onPick, title, noneLabel }) · COLOURS · colourClass(c)',
            fields: {
                value: 'the chosen colour (red, orange, yellow, green, blue, purple, gray), or none',
                onPick: 'called with a colour name, or null for no colour', title: 'the dot\'s tooltip and name', noneLabel: 'the words of the "no colour" swatch',
                COLOURS: 'the colours in the swatches\' order', colourClass: 'the class that sets a thing\'s colour token, for a part that draws the rail itself (the document tree)',
            },
        },
        useFor: ['Marking one thing in a list with a colour the person chose.'],
        variants: [
            { name: 'set', class: 'colour-tag-dot--set', prop: 'value="blue"', when: 'a colour is chosen: the dot in that colour' },
            { name: 'empty', class: 'colour-tag-dot--empty', prop: 'value={null}', when: 'no colour is chosen yet: an empty grey ring' },
            { name: 'colour', class: 'colour-tag--blue', prop: 'colourClass(c)', when: 'the token one colour sets, which the dot, a swatch and a rail read' },
        ],
        example: { value: 'blue', title: 'Colour', noneLabel: 'No colour' },
        note: 'Moved out of views/profile.css on 2026-09-25; on 2026-09-26 it became components/ColorPicker.js with its own names (.colour-tag*), and views/profile/organisms/workspace/color-picker.js only re-exports it. The workspace document space (through the Document tree) and record space draw it. The sheet\'s old .pj-tag-* and .pj-colored rules were kept for the design lab\'s demo, which calls the component since 2026-09-27, so nothing writes them now.',
    },
    {
        id: 'doc-tree', name: 'DocTree', kind: 'component', status: 'active',
        summary: 'The documents of a space as a tree beside the open one: sections that nest under a hairline, each with its colour dot, its name as the Sub-heading and small icon buttons (rename, a new document, a sub-section, remove); under a section its documents, each a row with a drag grip, its colour dot, its name, a draft mark and its icon buttons (archive, delete); a series of parts folded under one row with its count; the open document on the sun with an ink rail, a coloured one with its colour\'s rail. It stacks on a phone.',
        module: '/components/DocTree.js', sheet: '/css/components/doc-tree.css',
        data: {
            shape: 'DocTree({ sections, unsorted, empty, editing, archived, busy, words, onOpen, onDocColour, onArchive, onDelete, onSeries, onSectionColour, onRename, onName, onNameDone, onNewDoc, onAddSub, onRemoveSection, onMove, children })',
            fields: {
                sections: '[{ id, name, colour, items, children }]: the sections, and the sections under each',
                unsorted: 'the items no section holds, under "Unsorted", or null',
                items: 'a document { kind: \'doc\', id, title, draft, colour, active } or a series { kind: \'series\', key, name, draft, open, parts }',
                empty: 'the words when the space has no section and no document', editing: 'the id of the section whose name is being edited',
                archived: 'the space shows its archived documents: the door is "unarchive"', busy: 'the documents\' doors wait for an answer',
                words: '{ drag, draft, archive, unarchive, remove, delete, rename, newDocHere, addSub, sectionName, unnamed, unsorted, colour, noColour }',
                onMove: '(docId, sectionId or null): a document dropped on a section or on "Unsorted"',
                children: 'the open document, beside the tree',
            },
        },
        useFor: ['Many documents in sections, when a person reads one and moves between them.'],
        variants: [
            { name: 'open', class: 'is-active', prop: 'items[].active', when: 'the document that is open beside the tree: on the sun with an ink rail' },
            { name: 'coloured', class: 'doc-tree-rail', prop: 'colour', when: 'a section or a document a person gave a colour: that colour\'s rail on the left' },
            { name: 'unsorted', class: 'doc-tree-sec-name--quiet', prop: 'unsorted', when: 'the documents in no section, under a grey word' },
            { name: 'series', class: 'doc-tree-series-head', prop: 'kind: \'series\'', when: 'the parts of one document, folded under one row with the count' },
            { name: 'renaming', class: 'doc-tree-grow', prop: 'editing', when: 'a section\'s name in its field while it is renamed' },
        ],
        example: { sections: [{ id: 's1', name: 'Research', items: [{ kind: 'doc', id: 'd1', title: 'Seat map study', active: true }] }], unsorted: [{ kind: 'doc', id: 'd2', title: 'Lumo Bakery: seasonal menu site' }] },
        note: 'Moved out of views/profile.css and views/organism.css on 2026-09-25; on 2026-09-26 it became components/DocTree.js with its own names (.doc-tree*). The document space of a workspace draws it. The sheet\'s old .pj-* blocks were kept for the design lab\'s demo, which calls the component since 2026-09-27, so nothing writes them now.',
    },
    {
        id: 'file-preview', name: 'FilePreview', kind: 'component', status: 'active',
        summary: 'A stored file shown in the site\'s dialog, up to 920px wide: on a grey ground in a thin frame, a picture, a PDF in a frame, a video or a sound with its controls, or text in the typewriter face; one grey line when it is loading, cannot be read, or has no preview; its doors at the dialog\'s foot. Escape and a press outside close it.',
        module: '/components/FilePreview.js', sheet: '/css/components/file-preview.css',
        data: {
            shape: 'FilePreview({ title, kind, src, text, loading, error, loadingLabel, errorLabel, noneLabel, doors, onClose })',
            fields: {
                title: 'the dialog\'s title, the file\'s name (also the picture\'s words for a screen reader)',
                kind: '\'image\' | \'pdf\' | \'video\' | \'audio\' | \'text\' | \'other\': how the file is shown',
                src: 'the address of the file\'s bytes (an object URL) for a picture, a PDF, a video or a sound', text: 'the words of a text file',
                loading: 'the file is on its way', error: 'it could not be read',
                loadingLabel: 'the line while it loads', errorLabel: 'the line when it cannot be read', noneLabel: 'the line for a kind with no preview',
                doors: 'the actions at the dialog\'s foot (open in a new tab, download)', onClose: 'closes the dialog',
            },
        },
        useFor: ['Looking at a stored file without downloading it.'],
        variants: [
            { name: 'image', class: 'file-preview-img', prop: 'kind="image"', when: 'a picture, as large as the dialog allows' },
            { name: 'pdf', class: 'file-preview-frame', prop: 'kind="pdf"', when: 'a PDF in a frame' },
            { name: 'media', class: 'file-preview-media', prop: 'kind="video" | "audio"', when: 'a video or a sound with the browser\'s controls' },
            { name: 'text', class: 'file-preview-text', prop: 'kind="text"', when: 'a text file in the typewriter face' },
            { name: 'status', class: 'file-preview-status', prop: 'loading | error | kind="other"', when: 'loading, not readable, or a kind the browser cannot show' },
        ],
        example: { title: 'docs/notes.txt', kind: 'text', text: 'Ferry timetable changes on Monday.', loadingLabel: 'Loading…' },
        note: 'Moved out of views/profile.css on 2026-09-25; on 2026-09-26 it became components/FilePreview.js with its own names (.file-preview*, the old .pf-file-preview-* go). The Memory page draws it (views/profile/memory-tab/components.js).',
    },
    // Parts drawn one way only, moved out of a tab's sheet unchanged (wave 3, the agent pages).
    {
        id: 'gaii-chip', name: 'GaiiChip', kind: 'component', status: 'active',
        summary: 'An agent\'s GAII as a control: the full identifier in small grey typewriter letters with a drawn copy mark, no chrome until the pointer or the focus is on it (then the sun), green with a tick for two seconds once copied; it ellipsizes rather than wraps. A press copies and does nothing else, so it can sit in a row that opens.',
        module: '/components/GaiiChip.js', sheet: '/css/components/gaii-chip.css',
        data: {
            shape: 'GaiiChip({ gaii, label, copiedLabel })',
            fields: { gaii: 'the GAII it shows and copies', label: 'its tooltip and name (by default "Copy GAII")', copiedLabel: 'its tooltip once copied' },
        },
        useFor: ['The identifier a person hands to a chat, a config file or another agent, beside the agent\'s name.'],
        variants: [{ name: 'copied', class: 'gaii-chip--copied', prop: 'a press', when: 'for two seconds after a press: green, with a tick' }],
        example: { gaii: 'bot#sandbox@aimeat-local-001-dev' },
        note: 'Moved on 2026-09-25 out of the agent page\'s sheet and the poster skin; on 2026-09-26 it became components/GaiiChip.js with its own names (.gaii-chip*, the page prefix pf-agd-gaii goes), and views/profile/agents/gaii-chip.js only re-exports it. The Agents page draws it.',
    },
    // The Score chart, Offer map, Offer request, Rating stars, Week rhythm, Job chips and Workflow steps
    // moved to entries-views-work.ts on 2026-09-27 (this file had passed its length limit).
    {
        id: 'board-notices', name: 'Board notices', kind: 'component', status: 'active',
        summary: 'A notice on a board, as one row with a rule under it: its kind as a Tag on the left (a grey dot when it has none), the title as a button that turns coral under the pointer, the words, who posted it and on which board in typewriter, and on the right when it was posted, how long it has left and its replies and thanks. A notice\'s own page shows its text at a reading size. On a phone the columns stack. A reply under a notice is the Message\'s board tone.',
        module: '/components/BoardNotice.js', sheet: '/css/components/board-notices.css',
        data: {
            shape: 'BoardNotice({ kind, title, onOpen, words, who, whoNote, board, time, left, counts }) · BoardNoticeText({ children })',
            fields: {
                kind: 'the notice\'s category, as a Tag; none draws the grey dot', title: 'the notice\'s title: a button with onOpen, bold words without it', onOpen: 'opens the notice; without it the title opens nothing and is not a button',
                words: 'the first words of the notice', who: 'who posted it', whoNote: 'their standing, after the name',
                board: '{ name, onOpen }: the board it is on, a coral word that opens it', time: 'when it was posted', left: 'how long it has left',
                counts: 'its replies and thanks, on a line of their own', children: 'BoardNoticeText: the notice\'s own text on its page',
            },
        },
        useFor: ['The notices of a board, of an organism\'s board preview and of the operator\'s Boards page; BoardNoticeText for one notice\'s text on its page, with its replies as Message tone="board" under it.'],
        variants: [
            { name: 'no category', class: 'board-notice-kind--none', prop: 'kind omitted', when: 'a notice with no category: a grey dot' },
            { name: 'text', class: 'board-notice-text', prop: 'BoardNoticeText', when: 'a notice\'s own text on its page, at a reading size' },
            { name: 'title only', class: 'board-notice-title--still', prop: 'title without onOpen', when: 'a place with no notice page to open (the operator\'s Boards page): the title in bold, not a button' },
        ],
        example: { kind: 'News', title: 'The ferry timetable changes on Monday', words: 'The morning boat leaves at 07:10 from now on.', who: 'second', board: { name: 'Harbour' }, time: 'today 09:12', counts: '2 replies' },
        note: 'Moved on 2026-09-25 from boards-poster.css with its class names; on 2026-09-26 the Boards page\'s notice row and the organism\'s board preview became the BoardNotice component and the bp- names its own (board-notice*).',
    },
    {
        id: 'knowledge-entry', name: 'Knowledge entry', kind: 'component', status: 'active',
        summary: 'A knowledge package\'s reading: what it is about; its entries one per row (a title button, marks on the right, the opened text in a reading size), each entry\'s sources verified or not, and its relations as small framed buttons. The public knowledge viewer (views/public-knowledge-viewer.js) draws it by hand: what the package is about, the sources and the relations. Settings\' package page draws its entries with the List instead (cut name-doors, the text in the opened Panel, the sources as a dense List).',
        module: null, sheet: '/css/components/knowledge-entry.css', classes: ['kp-about', 'kp-entry', 'kp-entry-h', 'kp-entry-title', 'kp-entry-r', 'kp-entry-text', 'kp-refs', 'kp-ref', 'kp-ref--no', 'kp-rels', 'kp-rel'],
        data: { shape: '<div class="kp-entry is-open"><div class="kp-entry-h"><button class="kp-entry-title">…</button><div class="kp-entry-r">…</div></div><p class="kp-entry-text">…</p><div class="kp-refs"><div class="kp-ref"><i>verified</i><a>…</a></div></div><div class="kp-rels"><button class="kp-rel"><b>extends</b>…</button></div></div>', fields: { title: 'the entry', text: 'what it says', ref: 'a source, verified or not', rel: 'a relation to another entry' } },
        useFor: ['Reading the entries of a knowledge package with their sources.'],
        variants: [{ name: 'unverified', class: 'kp-ref--no', when: 'a source nobody has verified' }],
        example: { entries: [["Who may write", "Only approved agents write."]] },
        note: 'Moved on 2026-09-25 from knowledge-poster.css with its class names. Since 2026-09-26 Settings\' Knowledge package page (views/profile/knowledge/package.js) draws the List, so the only page that writes these classes is the public knowledge viewer (views/public-knowledge-viewer.js: kp-about, kp-refs, kp-ref, kp-ref--no, kp-rels, kp-rel); the entry row\'s own classes (kp-entry*) stay in the sheet for the design lab\'s demo.',
    },
    // The Morsel flow moved to entries-views-work.ts on 2026-09-27.
    {
        id: 'question-desk', name: 'QuestionDesk', kind: 'component', status: 'active',
        summary: 'The page\'s one question field: a large field on a heavy ink underline, coral with the focus, its scope beside it as the tab row with a count on each tab, a grey hint under both, the heavy rule over the desk. Enter asks.',
        module: '/components/QuestionDesk.js', sheet: '/css/components/question-desk.css',
        data: {
            shape: 'QuestionDesk({ value, placeholder, label, onInput, onEnter, scopes, scope, onScope, scopeLabel, hint })',
            fields: {
                value: 'what is typed', placeholder: 'the empty field\'s words', label: 'the field\'s name for a screen reader (the placeholder when none)',
                onInput: '(value, event) as the person types', onEnter: '(event) on Enter: ask',
                scopes: '[{ value, label, count }]: where to look, with how many; a count of \'\' draws none', scope: 'the chosen scope',
                onScope: 'called with a scope\'s value', scopeLabel: 'the tab row\'s name', hint: 'the grey line under the desk',
            },
        },
        useFor: ['One question over everything a person can reach.'],
        variants: [{ name: 'with scopes', prop: 'scopes', when: 'the question can be asked of different reaches: mine, shared, public' }],
        example: { placeholder: 'What are you looking for?', scopes: [{ value: 'own', label: 'Mine', count: '120' }, { value: 'shared', label: 'Shared', count: '40' }], scope: 'own', hint: 'Searches your records, files and apps.' },
        note: 'Moved on 2026-09-25 from discover-poster.css with its class names; since 2026-09-26 the component draws it, its scope row the Tabs, and since 2026-09-27 under its own names (.question-desk and .question-desk-field, formerly .dv-desk and .dv-field). Discover draws it.',
    },
    // The Schedule calendar and the Ecosystem automation moved to entries-views-work.ts on 2026-09-27.
    {
        id: 'signed-out-door', name: 'SignedOutDoor', kind: 'component', status: 'active',
        summary: 'What a visitor who is not signed in sees at an address that opens only for its owner: the address in a mono frame with a coral word, a two-line headline with the sun\'s shadow, where the address leads under a heavy rule with an "owner only" tag, a lead, the loud Sign in and the Create an account link, a line after them, and a dashed aside that says what this place is. The showroom face, since the visitor is outside.',
        module: '/components/SignedOutDoor.js', sheet: '/css/components/signed-out-door.css',
        data: {
            shape: 'SignedOutDoor({ address, kicker, title, titleAccent, targetLabel, path, tag, lead, action, second, after, aside })',
            fields: {
                address: 'the address the visitor arrived at', kicker: 'the coral word beside it', title: 'the headline', titleAccent: 'its second line',
                targetLabel: 'the word before where the address leads', path: 'the steps of where it leads: one draws it alone, two or more the first as the root with → between',
                tag: 'the tag after it ("owner only")', lead: 'the sentence under it', action: '{ label, onClick }: the loud action (sign in)',
                second: '{ label, onClick }: the action link beside it (create an account)', after: 'the line after them',
                aside: '{ label, title, text, link: { label, href, onClick } }: the aside that says what this place is',
            },
        },
        useFor: ['The one page a signed-out visitor meets at an address inside Settings & Controls.'],
        variants: [
            { name: 'with a tab', class: 'signed-out-door-crumb-arrow', prop: 'path={[profile, tab]}', when: 'the address names a tab: "Settings & Controls → the tab"' },
            { name: 'the profile alone', prop: 'path={[profile]}', when: 'the address names no tab' },
        ],
        example: { address: 'aimeat.io/v1/profile?tab=security', kicker: 'This address leads inside', title: 'You are at the right door.', titleAccent: 'Sign in, and it opens.', path: ['Settings & Controls', 'Security'], tag: 'owner only' },
        note: 'Moved unchanged on 2026-09-25 (the sheet was views/profile-door.css); on 2026-09-26 its markup became components/SignedOutDoor.js, and views/profile/door.js passes it the words. Since 2026-09-27 it draws its own names (.signed-out-door-*, formerly .pf-door-*).',
    },
];
