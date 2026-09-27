/**
 * @file src/services/ui-library/entries-page-kit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the page parts of Settings & Controls: the page (SettingsPage), the section (Section), the fold rows (Folds), the tabs (Tabs), the layout (Layout) and the contents tree (ContentsTree). The purpose half only; facts.generated.ts carries what the
 *   files say. The kit's older parts (the rail, the crumb, the page head, PageSection, FoldSection)
 *   keep their entries in entries-settings.ts, and SubHeading in entries-settings-org.ts.
 * @structure PAGE_KIT_ENTRIES
 * @usage import { PAGE_KIT_ENTRIES } from './entries-page-kit.js';
 * @version-history
 *   v1.4.0 — 2026-09-27 — What appcat added: Tabs' line, glyph, caption and fill; Layout's step 'part'
 *     and Space inset.
 *   v1.3.0 — 2026-09-27 — Section's group (the admin Config domains' band).
 *   v1.2.0 — 2026-09-27 — What the admin pages added: Layout's Columns, Beside start and stick; Tabs'
 *     TabPanel; Section's band.
 *   v1.1.0 — 2026-09-27 — settings-page, section-component, folds, tab-row, layout and contents-tree
 *     (the catalogue pass).
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import type { UiEntryWritten } from './types.js';

export const PAGE_KIT_ENTRIES: UiEntryWritten[] = [
    {
        id: 'settings-page', name: 'SettingsPage', kind: 'component', status: 'active',
        summary: 'A whole Settings & Controls page from data: the crumb, the head, the figure strip, and under them the page\'s sections beside the dark contents rail, which stands under the page on a phone. Without a rail the head stands in its own block over the content; a page inside a page has the smaller head and a heavy rule over its column.',
        module: '/components/SettingsPage.js', sheet: '/css/components/settings-page.css',
        data: {
            shape: 'SettingsPage({ name, page, crumb, label, title, sub, marks, desc, actions, edit, asKey, strip, railTitle, back, sections, railItems, pagesLabel, pages, rail, side, aside, after, children }) · settingsRail({ railTitle, sections, back, pages, pagesLabel, railItems })',
            fields: {
                name: 'the page\'s short name: the root gets .og-<name>, which the page\'s own sheet keys its rules on until that sheet goes',
                page: 'a page inside a page (a record, a board, a person): the smaller head, and a heavy rule over the page column',
                crumb: 'the steps of the crumb over the title (see Crumb)',
                'label, title, sub, marks, desc, actions, edit, asKey': 'the head (see PageHead)',
                strip: 'the figure strip under the head (a FigureStrip)',
                railTitle: 'names the rail for a screen reader, and its first group',
                back: '{ label, onClick }: the way back, first in the rail with the ← mark',
                sections: '[{ id, num, label, count, open, href }]: the page\'s sections as rail links that scroll to them; open() first opens a folded one',
                railItems: 'more items of the first group after the sections: a mode of the page, an act (see Rail)',
                'pagesLabel, pages': 'the sibling pages under their label, [{ tab, label } | { href, newTab, label } | { onClick, label, count }], each marked → on both sides',
                rail: 'the whole rail as data ({ title, groups }) when the short form cannot say it, or a list of rails stacked in the side column',
                side: 'a thing of the page\'s own in the rail\'s place (a workspace\'s ContentsTree)',
                aside: 'what stands in the side column over the rails (a record\'s visibility, tags and shares)',
                after: 'what the page draws last inside its root: a confirm dialog, a dialog, a hidden file field',
                children: 'the page\'s sections',
                settingsRail: 'builds the rail from the short form, for a page that wants the rail alone',
            },
        },
        useFor: ['The outermost part of every Settings & Controls page inside the Settings frame, and of an organism\'s pages. A page passes data and its sections, and never writes the frame\'s classes.'],
        variants: [
            { name: 'with a rail', prop: 'sections | pages | back | railItems | rail | side', when: 'a page with sections to jump between or sibling pages: the sections beside the rail' },
            { name: 'without a rail', class: 'settings-page-head', prop: 'crumb, title and children only', when: 'a classic page (Security, Services, Nodes, Fleet, Usage, Work, Chat sessions): the head in its own block, 1rem over the content' },
            { name: 'page', prop: 'page', when: 'a page inside a page: the smaller head and a heavy rule over the page column' },
            { name: 'two rails', class: 'settings-page-side', prop: 'rail (a list of two) | aside', when: 'a side column that stacks two rails, or a record\'s own settings over the rail (Memory); the rails do not stick' },
        ],
        example: {
            name: 'skills', crumb: ['Settings', 'Build and share', 'Skills'], title: 'Skills', sub: '12 own', desc: 'What your agents know how to do.',
            railTitle: 'On this page', sections: [{ id: 'sk-own', num: '01', label: 'Your skills', count: 12 }], pagesLabel: 'Pages', pages: [{ tab: 'agents', label: 'Agents' }],
        },
        note: 'It also wears the page kit\'s sheets: tab-page.css (the root .og, the columns .og-grid and .og-main, and the rail), page-head.css (the head) and crumb-trail.css (the crumb). It replaced the frame each Settings page wrote by hand (<div class="og og-<page>">, a crumb() and a pageLinks() helper per page, og-mast, og-grid, og-main, og-rail) and the side columns .mp-side, .op-side and .sc-side.',
    },
    {
        id: 'section-component', name: 'Section', kind: 'component', status: 'active',
        summary: 'One door to a section of a page, open or folded. Open, it is PageSection: the heavy rule on top, the ink section title with a small coral number or count, the actions at the right, the body; as a chapter of a long page of one thing, a coral "03 / 19" over a slab across the column with the actions on it; as a part of a dialog\'s body, the slab a size smaller. With fold, it is FoldSection: one row that opens in place.',
        module: '/components/Section.js', sheet: '/css/components/page-section.css', classes: ['og-sec', 'og-sec--first', 'og-sec-h'],
        data: {
            shape: 'Section({ id, num, title, count, doors, first, plain, band, group, chapter, part, fold, sub, lead, open, onToggle, clip, wrap, inner, children }) · PageSection · FoldSection (both re-exported)',
            fields: {
                id: 'the section\'s anchor, which the rail scrolls to', num: 'the small number beside the title', title: 'the section\'s name',
                count: 'an open section: a count instead of the number', doors: 'an open section: its actions at the right of the head; in a chapter, on the slab in the slab\'s own colour',
                first: 'an open section: the first under the page head, no rule on top; a chapter: the one right after the page\'s head, with less air above it', plain: 'an open section with no head: the rule on top and the body',
                band: 'an open section: the title\'s dark band spans the whole column (the classic pages\' look)',
                group: 'an open section that holds a group of sections: its band smaller, across the column',
                chapter: 'the words of the chapter\'s number ("03 / 19"): a chapter of a long page of one thing, the number in coral typewriter letters over the slab, far more air above than under it',
                part: 'a part of a dialog\'s body: the slab title a size smaller, 1rem under it and 2rem between parts (dialog.css sizes it); only id, title and children apply',
                fold: 'the section is one row until it is opened (FoldSection)', sub: 'a folded section: the mono word at the right of its row',
                lead: 'a folded section: a line under its row, shown open or shut', open: 'a folded section: its body is shown', onToggle: 'a folded section: its row was pressed',
                clip: 'a folded section: a long sub cut with … on its line', wrap: 'a folded section: under 1100px the sub goes under the title',
                inner: 'a folded section inside a part: no rule and no number, a hairline under its row', children: 'the body',
            },
        },
        useFor: ['Each part of a Settings page, when the page chooses per section whether it is open or folded. PageSection and FoldSection stay importable by their own names.'],
        variants: [
            { name: 'open', prop: '(no fold)', when: 'a section that is always shown (PageSection)' },
            { name: 'first', class: 'og-sec--first', prop: 'first', when: 'the first section under the page head' },
            { name: 'plain', prop: 'plain', when: 'a box that stands as a section of its own without a title' },
            { name: 'band', prop: 'band', when: 'the title\'s band across the column, as the classic pages drew it (PageSection band)' },
            { name: 'group', prop: 'group', when: 'a section holding a group of sections: a smaller band across the column (PageSection group)' },
            { name: 'chapter', prop: 'chapter="03 / 19"', class: 'og-sec--chapter', when: 'a chapter of a long page of one thing (an app\'s detail): its number over the slab, the doors on the slab, 112px of air above' },
            { name: 'part', prop: 'part', when: 'a part of a dialog\'s body (Settings, Help): the slab title a size smaller, the parts 2rem apart' },
            { name: 'fold', prop: 'fold', when: 'a section closed by default, one row until opened (FoldSection)' },
            { name: 'fold inner', prop: 'fold inner', when: 'one of several folds under one rule inside a part' },
        ],
        example: { id: 'og-files', num: '01', title: 'Files', count: 12, children: '…' },
        note: 'The shape named `section` is poster.css\'s section title; this entry is the component. Its open look is page-section.css (the page-section entry), its folded look fold-row.css (the fold-row entry). chapter and part came with appcat on 2026-09-27 and pass to PageSection: chapter replaced the old app catalogue\'s .dtl-section with its counter line (::before, --dtl-chapters), part its dialogs\' section.poster-section, whose size and spacing dialog.css gives.',
    },
    {
        id: 'folds', name: 'Folds', kind: 'component', status: 'active',
        summary: 'Rows under each other with a hairline between them: a coral mono number or time on the left, the name, a mono word at the right, and the arrow that says whether the row is open. A row tells what happened, opens a part of the page, or only says something.',
        module: '/components/Folds.js', sheet: '/css/components/fold-row.css',
        classes: ['og-folds', 'og-fold', 'og-fold--event', 'og-fold--toggle', 'og-fold--done', 'og-fold-who', 'og-fold-r', 'og-fold-arrow', 'fold-row-line', 'fold-row-doors'],
        data: {
            shape: 'Folds({ children }) · FoldRow({ kind, num, who, verb, name, isKey, right, open, done, body, defaultOpen, onToggle, onClick, title, doors, children })',
            fields: {
                kind: '\'event\' (the default with onClick, body or onToggle) | \'toggle\' | \'row\' (the default without a handler)',
                num: 'the coral mono word on the left: a time, a number', who: 'an event: who did it, in grey', verb: 'an event: what they did',
                name: 'the thing, in bold on an event row', isKey: 'the name is a memory key, in the typewriter face', right: 'the mono word at the right',
                open: 'true or false: the row says aria-expanded and shows ↓ (open) or → (shut)', done: 'a finished step: its number in green',
                body: 'what the row shows under itself while open; without open the row keeps its own state', defaultOpen: 'the row starts open (with body and no open)',
                onToggle: 'hears every open and close, with the new state', onClick: 'the press', title: 'the tooltip',
                doors: 'the row\'s own icon actions beside it, shown while the pointer or the keyboard is on the row', children: 'stand after the name (tags, a time)',
            },
        },
        useFor: ['A list of events or records that each open or lead somewhere, the steps of a job that open in place, and lines of a history.'],
        variants: [
            { name: 'event', class: 'og-fold--event', prop: 'kind="event" (or onClick)', when: 'a thing that happened or a record to open: when, who, what, the name in bold' },
            { name: 'toggle', class: 'og-fold--toggle', prop: 'kind="toggle"', when: 'a larger row that opens a part of the page (a calibration step, "Add by hand")' },
            { name: 'row', prop: 'kind="row" (no handler)', when: 'a line that only says something, such as a history line' },
            { name: 'done', class: 'og-fold--done', prop: 'done', when: 'a finished step: its number in green' },
            { name: 'open', class: 'og-fold-arrow', prop: 'open | body', when: 'a row that opens: the arrow says open or shut' },
            { name: 'doors', class: 'fold-row-doors', prop: 'doors', when: 'a row with its own actions (search in it, delete it), shown on hover and focus' },
        ],
        example: { rows: [{ num: '09:12', who: 'bot', verb: 'wrote', name: 'studio/clients/nordic-ferries', isKey: true }] },
        note: 'It replaced the og-fold rows the pages wrote by hand: the event rows of the agents, messages and task memory, the calibrator\'s steps, the timeline lines, and Memory\'s key groups with their .mem-group-actions. Its sheet is fold-row.css, which it shares with FoldSection (the fold-row entry).',
    },
    {
        id: 'tab-row', name: 'Tabs', kind: 'component', status: 'active',
        summary: 'What chooses what a page, a list or a field shows: a row of tabs, the chosen one on the sun. Plain tabs are underlined capitals, a filter row has small framed words with a tally, and the row right under a page head stands on the heavy rule. A row can carry its own coral word before the tabs, or share its whole width among them; a line tab is grey capitals with a coral line under the chosen one, and a glyph tab is a small square holding one mark. The arrow keys move along the row.',
        module: '/components/Tabs.js', sheet: '/css/components/tab-row.css',
        data: {
            shape: 'Tabs({ items, value, onSelect, tone, kind, label, labelledBy, bar, disabled, caption, fill, children }) · Tab({ on, tone, count, attention, disabled, title, ariaLabel, pressed, expanded, onClick, children }) · TabPanel({ value, id, label, children })',
            fields: {
                items: '[{ value, label, count, title, disabled, attention, on, key }]: one tab each; count is the small tally inside it; attention marks a filter whose items need the person (coral until it is chosen); on says it is chosen where value cannot (a facet "All")',
                value: 'the chosen value, or the list of chosen values with kind="toggle"', onSelect: '(value, item): a tab was pressed',
                tone: 'none (underlined capitals) | \'filter\' (small framed words, the facet row\'s spacing) | \'fold\' (coral typewriter words) | \'tile\' (framed tiles) | \'line\' (small grey capitals with no ground, the chosen one ink over a coral line) | \'glyph\' (a square holding one mark, the chosen one on the sun)',
                kind: '\'choice\' (the default: one of these, a radio group) | \'view\' (switches what the page shows, a tab list) | \'toggle\' (each on or off, pressed)',
                'label, labelledBy': 'the row\'s name for a screen reader', bar: 'the row right under a page head, on the heavy rule',
                caption: 'the row\'s own word, a small coral label before the tabs (an order row\'s "Order"); the row then keeps one line and scrolls sideways on a phone',
                fill: 'the tabs share the row\'s whole width in equal parts, each word centred (the tabs over a dialog\'s body)',
                disabled: 'every tab is off (a person who may not change it)', children: 'stand after the tabs in the row (a field for a number of your own)',
                'Tab pressed, expanded': 'one tab alone that opens a panel: it says aria-pressed and aria-expanded',
                TabPanel: 'what a row of view tabs shows for the chosen value: it fades in over about 180ms when the value changes, and stands still for a person who asks for reduced motion; id and label name it for a screen reader',
            },
        },
        useFor: ['Choosing one of a few views or values, filtering a list by its facets, and the row of sub-pages under a page head.'],
        variants: [
            { name: 'plain', class: 'tab-row', prop: '(no tone)', when: 'one of a few choices: underlined capitals' },
            { name: 'filter', class: 'tab-row--filter', prop: 'tone="filter"', when: 'the facets over a list, each with its tally' },
            { name: 'bar', class: 'tab-row--bar', prop: 'bar', when: 'the sub-pages right under a page head (Nodes, Services, Work, Notebook)' },
            { name: 'fold', prop: 'tone="fold"', when: 'a lone tab that opens a panel, in coral typewriter words' },
            { name: 'tile', prop: 'tone="tile"', when: 'a few larger choices as framed tiles' },
            { name: 'attention', prop: 'items[].attention', when: 'a filter whose items need the person (unused keys on Access)' },
            { name: 'view', prop: 'kind="view"', when: 'the tabs switch what the page shows' },
            { name: 'toggle', prop: 'kind="toggle"', when: 'several can be on at once (facets, days)' },
            { name: 'panel', class: 'tab-panel', prop: 'TabPanel value', when: 'the part a view tab shows, fading in when the chosen tab changes' },
            { name: 'line', class: 'poster-tab--line', prop: 'tone="line"', when: 'a quiet row of choices over a list or a dialog\'s body: grey capitals, the chosen one ink over a coral line (the app catalogue\'s order row and its Paste / File tabs)' },
            { name: 'glyph', class: 'poster-tab--glyph', prop: 'tone="glyph"', when: 'a row of ready marks to pick one from: small squares on the card ground, the chosen one on the sun (the app catalogue\'s icons in its Add dialog)' },
            { name: 'caption', class: 'tab-row--caption', prop: 'caption', when: 'a row that names itself with a small coral word before its tabs, one line that scrolls sideways on a phone (the app catalogue\'s "Order")' },
            { name: 'fill', class: 'tab-row--fill', prop: 'fill', when: 'two or three tabs that share the row\'s whole width, each word centred, over what they switch (a dialog\'s Paste / File)' },
        ],
        example: { tone: 'filter', kind: 'toggle', value: ['bound'], items: [{ value: '', label: 'All', count: 12 }, { value: 'bound', label: 'Bound to an app', count: 3 }] },
        note: 'The tabs wear poster.css (.poster-tab and its tones, shared with the admin and the home); this sheet lays out the row only. It replaced .pf-tabs, .sub-tabs, .platform-tabs and the facet rows (.sk-facets, .ad-facets, .cp-facets, .ex-facets, .lb-facets, .pk-facets, .ac-filters, .dw-filters, .wal-filters). On 2026-09-27 appcat, the app catalogue rebuilt on components, added the line and glyph tones (the old catalogue\'s .modal-tab and .icon-pick), caption (its order row, .cat-sort and .cat-sort-label) and fill (its dialog tabs, .modal-tabs).',
    },
    {
        id: 'layout', name: 'Layout', kind: 'component', status: 'active',
        summary: 'How the parts of a page stand beside and under each other, so a page writes no utility class: a row, a stack, a part under a hairline, plain space, a main part with a side part, parts of the same weight in columns, and a part whose every control is a thumb\'s size. Every space is a named step of one scale: none 0, tight .25rem, small .5rem, medium .75rem, large 1rem, section 1.5rem, and part 1.875rem above or below only.',
        module: '/components/Layout.js', sheet: '/css/components/layout.css',
        data: {
            shape: 'Row({ gap, wrap, align, justify, above, below, children }) · Stack({ gap, above, below, list, narrow, children }) · Split({ above, pad, gap, below, heavy, side, children }) · Space({ above, below, inset, children }) · Beside({ side, narrow, wide, start, stick, align, rule, above, pad, below, id, children }) · Columns({ children }) · Touch({ id, tabs, children })',
            fields: {
                'gap, above, below, pad': 'a step of the scale: \'none\' | \'tight\' | \'small\' | \'medium\' | \'large\' | \'section\'; the space between the parts, above, below, and inside under a split\'s rule',
                'above, below \'part\'': 'the step \'part\', 1.875rem, for above and below only: the air between the parts of one section\'s readout (a chart, then a table, then a list)',
                inset: 'Space: the same step at both sides, \'small\' | \'medium\' | \'large\' | \'section\' (a strip held in from the column\'s edges)',
                wrap: 'Row: the parts wrap onto more lines', align: 'Row: \'center\' (the default) | \'start\' | \'end\' | \'baseline\' | \'stretch\'; Beside: \'end\' lines the two parts up at their foot',
                justify: 'Row: \'between\' | \'end\'', list: 'Stack: the parts are the items of a list (no bullets), which a screen reader hears as a list',
                narrow: 'Stack: kept to 60rem, for a page of settings forms; Beside: the side part is 18rem',
                heavy: 'Split: the part starts a new thing, under the poster face\'s heavy rule instead of the hairline',
                side: 'Split: the line at the part\'s start and the part indented, a quieter side door; Beside: the side part',
                wide: 'Beside: the side part takes two fifths', rule: 'Beside: the heavy rule over it', id: 'the anchor a page scrolls to',
                start: 'Beside: the side part stands before the main part (a headline figure with its chart beside it); on a phone over it',
                stick: 'Beside: the side part stays in sight under the top bar while the main part scrolls, and stands over the main part when the two no longer fit side by side',
                Columns: 'parts of the same weight side by side, as many as fit at 340px each, one column on a narrow page',
                tabs: 'Touch: the tabs inside are thumb targets too',
            },
        },
        useFor: ['Placing the parts of a page and the space between them. A page names a step and never a length.'],
        variants: [
            { name: 'row wraps', class: 'layout-row--wrap', prop: 'Row wrap', when: 'a row of tags or actions that may not fit one line' },
            { name: 'row ends apart', class: 'layout-row--justify-between', prop: 'Row justify="between"', when: 'a name at one end and its actions at the other' },
            { name: 'list', class: 'layout-list', prop: 'Stack list', when: 'a stack that is a list to a screen reader (a ledger)' },
            { name: 'narrow', class: 'layout-stack--narrow', prop: 'Stack narrow', when: 'a page of settings forms kept to a reading width' },
            { name: 'split', prop: 'Split', when: 'a part set off by a hairline from what is above it (a panel\'s last actions)' },
            { name: 'beside, narrow side', class: 'layout-beside--narrow', prop: 'Beside narrow', when: 'a form\'s settings beside its words' },
            { name: 'beside, wide side', class: 'layout-beside--wide', prop: 'Beside wide', when: 'a second column of about the same weight' },
            { name: 'beside, side first', class: 'layout-beside--start', prop: 'Beside start', when: 'a headline figure with its line beside it (the operator\'s Database and Metrics pages)' },
            { name: 'beside, side sticks', class: 'layout-beside--stick', prop: 'Beside stick', when: 'a preview that stays in sight while the parts it shows are arranged (the operator\'s Portal page)' },
            { name: 'columns', class: 'layout-columns', prop: 'Columns', when: 'two or more sections or lists of the same weight side by side' },
            { name: 'touch', class: 'layout-touch', prop: 'Touch', when: 'a part a person works on with a thumb: every control 44px at every width' },
            { name: 'touch tabs', class: 'layout-touch--tabs', prop: 'Touch tabs', when: 'the same, and its tabs too' },
            { name: 'part apart', class: 'layout-above--part', prop: 'Space above="part" (or below="part"; also on Row, Stack, Split, Beside)', when: 'the parts of one section\'s readout, 1.875rem apart (the app catalogue\'s visitor readout)' },
            { name: 'inset', class: 'layout-inset--large', prop: 'Space inset="large" (or small, medium, section)', when: 'a strip held in from the column\'s edges by the same step at both sides (the app catalogue\'s Active Extensions strip)' },
        ],
        example: { Row: { wrap: true, gap: 'small' }, Stack: { gap: 'large' }, Split: { above: 'medium' } },
        note: 'It replaced the profile utilities (.flex-row, .flex-row-wrap, .flex-col, .flex-between, .flex-actions, .mt-xs, .mb-half, .mb-1, .mt-1, .mt-section), the pages\' own split rules and the Boards page\'s .bp-composer and .bp-app; on 2026-09-27 the admin\'s .adm-two (Columns), .adm-db-top and .adm-mx-top (Beside start) and .adm-pt-bench (Beside stick). The same day appcat, the app catalogue rebuilt on components, added the step \'part\' (the old catalogue\'s .vis-block air) and Space inset (the margins of its Active Extensions strip). The split\'s lines are .og-split and .og-split--side in page-section.css.',
    },
    {
        id: 'contents-tree', name: 'ContentsTree', kind: 'component', status: 'active',
        summary: 'The whole structure of a place as one tree in the contents rail\'s place: each group in poster capitals with its count, each space under it as a hairline row with its count and the new things for you in coral (+N), a space\'s first documents nested under it with a line for the rest, and at its foot the way back to the rail. The line you are on stands on the sun.',
        module: '/components/ContentsTree.js', sheet: '/css/components/tab-page.css',
        classes: ['og-tree', 'og-tree-group', 'og-tree-label', 'og-tree-space', 'og-tree-link', 'og-tree-doc', 'og-tree-more', 'og-rail-toggle'],
        data: {
            shape: 'ContentsTree({ title, groups, foot, draftLabel })',
            fields: {
                title: 'the tree\'s name for a screen reader',
                groups: '[{ key, label, count, items }]: a group and its lines; a count of \'\' keeps its place',
                line: '{ key, label, count, fresh, on, onClick, children, more }: a space; fresh is the coral +N after its count',
                'line.children': '[{ key, label, draft, on, onClick }]: the documents nested under it', 'line.more': '{ label, onClick }: the line for the rest of them',
                draftLabel: 'the word of the mark before a document that is a draft', foot: '{ mark, label, onClick }: the way back to the rail, under a rule',
            },
        },
        useFor: ['Beside a place with many spaces and documents, when a person wants to see and open all of it at once (an organism workspace shown as a tree).'],
        variants: [
            { name: 'on', class: 'on', prop: 'line.on | child.on', when: 'the space or the document open now: on the sun, aria-current' },
            { name: 'more', class: 'og-tree-more', prop: 'line.more', when: 'the line that opens the rest of a space\'s documents' },
            { name: 'draft', prop: 'draftLabel + child.draft', when: 'a document that is a draft: a status mark before its name' },
            { name: 'foot', class: 'og-rail-toggle', prop: 'foot', when: 'the way back to the rail' },
        ],
        example: { title: 'Harbour Studio', groups: [{ key: 'docs', label: 'Documents', count: 3, items: [{ key: 'briefs', label: 'Client briefs', count: 12, fresh: 2, on: true }] }], foot: { mark: '↩', label: 'Show the contents' } },
        note: 'Its look is the tree rules of the page kit (.og-tree* in tab-page.css), a sheet it shares with the rail (the tab-page entry). It stands in SettingsPage\'s side slot. Built on 2026-09-26 from the organism workspace\'s renderTree (views/profile/organisms/workspace/cover.js), its markup and look unchanged.',
    },
];
