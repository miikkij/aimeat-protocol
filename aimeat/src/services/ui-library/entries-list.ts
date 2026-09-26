/**
 * @file src/services/ui-library/entries-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the list of Settings & Controls (List). The purpose half only; facts.generated.ts carries what the
 *   files say.
 * @structure LIST_ENTRIES
 * @usage import { LIST_ENTRIES } from './entries-list.js';
 * @version-history
 *   v1.1.0 — 2026-09-27 — The List (components/List.js, css/components/list.css): every export and every prop, its
 *     tones and its row states (the catalogue pass, list and conversation family).
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import type { UiEntryWritten } from './types.js';

export const LIST_ENTRIES: UiEntryWritten[] = [
    {
        id: 'list', name: 'List', kind: 'component', status: 'active',
        summary: 'Things in rows of columns, one thing per row, between hairlines: a mark at the start (a picture, a tick, a thumbnail or a check box), the name in bold with a small grey typewriter line under it, what it is in grey, who has it, its figures at the right, its dates, and the doors at the end with the ⋯ menu. A row can open a raised panel under it, be picked, be selected, be dragged or carry a heavy rail in a warn or a chosen colour. The list says when it is loading or empty and groups rows under headings that fold; around it stand the filters with their counts, the search line and the line that shows more.',
        module: '/components/List.js', sheet: '/css/components/list.css',
        data: {
            shape: 'List({ cols, keepCols, head, empty, loading, dense, under, small, scroll, apart, id, rows, render, children }) · '
                + 'Row({ open, onToggle, selected, faded, fine, rail, colour, picked, onPick, pickLabel, pickOff, draggable, dragOver, dragging, grip, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, hover, below, panel, panelDoors, id, children }) · '
                + 'Name({ onOpen, href, newTab, openLabel, meta, warn, clip, desc, note, noteTone, tag, after, dot, dotTitle, asKey, code, unread, attention, end, before, blurred, title, id, nameRef, children }) · '
                + 'Desc({ sub, clip, faint, lines, marks, pre, title, children }) · Who({ sub, clip, warn, title, children }) · '
                + 'Num({ dim, strong, quiet, sign, title, children }) · When({ at, clip, warn, title, children }) · '
                + 'Cell({ meta, sign, dim, faint, clip, line, code, sub, subQuiet, head, headDim, title, children }) · '
                + 'Doors({ menu, menuLabel, title, children }) · Panel({ doors, text, id, title, mark, children }) · '
                + 'Lead({ text, seed, agent, size, label, picture, title, children }) · Tick({ state, bare, glyph, title }) · Thumb({ title }) · Found({ children }) · '
                + 'Stats({ title, children }) · Stat({ icon, date, title, children }) · '
                + 'Group({ title, count, folded, onFold, foldLabel, wholeHead, doors, quiet, onDragOver, onDrop, children }) · '
                + 'Filters({ label, children }) · Filter({ on, count, onClick, attention, end, disabled, title, children }) · '
                + 'SearchLine({ value, onInput, onEnter, onClear, clearLabel, placeholder, label, note, text, autofocus, beside, children }) · '
                + 'More({ label, onMore, disabled, note, wrap, children })',
            fields: {
                'List.cols': 'the cut, named by the columns it holds ("name-desc-doors" draws .listing--name-desc-doors); every cut is in listing.css, a new set of columns is a new cut there',
                'List.keepCols': 'the columns stay on a phone (the cut\'s own narrow rules); without it the cells of a row stand under each other',
                'List.head': 'the heading row: a string or a node per column, or { label, num: true, title } for a label over a figure column (at the right)',
                'List.empty': 'what stands in the list\'s place when there are no rows: a string (the quiet line) or a node (words and a button)',
                'List.loading': 'true (the loading line) or the words to say, in the list\'s place',
                'List.dense': 'a list inside a panel or under a row: less air, smaller words',
                'List.under': 'it belongs to the row above it: it stands indented (not on a phone)',
                'List.small': 'a checklist under a field: small grey words, no rules',
                'List.scroll': 'a long pick list, capped at 17rem in a thin frame that scrolls; "medium" caps it at 300px',
                'List.apart': 'a little space above it, under a label or a line',
                'List.id': 'the list\'s own id',
                'List.rows': 'the rows as data, each drawn by `render`',
                'List.render': '(item, i) → a Row, for `rows`',
                'List.children': 'the rows (Row, Group), when `rows` is not given',
                'Row.open': 'the row is opened; with `panel` it draws the panel under it',
                'Row.onToggle': 'the whole row opens and closes it (a press anywhere but inside the panel, the pick box or what stands below); the name becomes a button with aria-expanded and turns coral under the pointer',
                'Row.selected': 'the row the page is showing now: the grey ground',
                'Row.faded': 'a thing that is past (retired, archived, outdated, revoked): its cells at .6',
                'Row.fine': 'a condition that is met: its words turn green (the password rules)',
                'Row.rail': '"warn": the heavy warn line at the row\'s start, a draft or a request that waits',
                'Row.colour': 'red | orange | yellow | green | blue | purple | gray: the colour a person gave the thing, as the heavy line at the start (with rail="warn", the colour outside and the warn inside)',
                'Row.picked': 'the pick box is ticked',
                'Row.onPick': 'makes it a pick row: a check box first and the whole row its label, grey under the pointer; with onToggle the box is its own cell',
                'Row.pickLabel': 'the pick box\'s name for a screen reader',
                'Row.pickOff': 'the pick box cannot change now: dimmed, the pointer says not allowed',
                'Row.draggable': 'the row can be dragged to reorder (with the drag handlers)',
                'Row.dragOver': 'a drag is over this row: the coral rule under it',
                'Row.dragging': 'the row being dragged: dimmed to .45',
                'Row.grip': 'the words of the drag handle ⠿ that hangs in the gutter before the name, shown while the pointer is on the row',
                'Row.onDragStart': 'the drag begins', 'Row.onDragOver': 'a drag moves over the row', 'Row.onDragLeave': 'a drag leaves the row',
                'Row.onDrop': 'a row is dropped here', 'Row.onDragEnd': 'the drag ends',
                'Row.hover': 'a row that opens nothing still answers the pointer: the name turns coral',
                'Row.below': 'what always shows under the row, across it, without a frame (the row\'s rule falls under it)',
                'Row.panel': 'what the opened row shows, drawn in a Panel', 'Row.panelDoors': 'the actions at the foot of that panel',
                'Row.id': 'the anchor a page scrolls to (the first cell carries it)',
                'Row.children': 'the cells, in the order the cut names them, and a Panel',
                'Name.onOpen': 'the name is a button into the thing', 'Name.href': 'the name is a link', 'Name.newTab': 'the link opens a new tab',
                'Name.openLabel': 'the name of that button or link for a screen reader',
                'Name.meta': 'the small grey typewriter line under the name (Jouni\'s decision "Meta line")', 'Name.warn': 'that line in coral',
                'Name.clip': 'the meta line cut to one line with …; 2 keeps two lines',
                'Name.desc': 'a sentence (or a list of them) under the name in the body\'s grey letters',
                'Name.note': 'a short coral typewriter line under that ("why it fits", what an answer did)', 'Name.noteTone': '"fine": that line in green',
                'Name.tag': 'a word, a Mark, or a list of them after the name', 'Name.after': 'nodes after the name (a presence dot, an AI label, a status)',
                'Name.dot': 'a status dot before the name (active, inactive, online…)', 'Name.dotTitle': 'the dot\'s tooltip',
                'Name.asKey': 'the name is a memory key: typewriter, breaks anywhere (.key-name)', 'Name.code': 'the name is an identifier, in the inline code patch',
                'Name.unread': 'the coral square before it', 'Name.attention': 'the name in coral: a thing with a problem',
                'Name.end': 'marks at the far end of the cell, lined up down the list', 'Name.before': 'a control before the name (the eye that blurs it)',
                'Name.blurred': 'the name blurred for privacy', 'Name.title': 'the cell\'s tooltip', 'Name.id': 'the cell\'s own id', 'Name.nameRef': 'a ref to the cell',
                'Name.children': 'the name',
                'Desc.sub': 'a grey typewriter line under the words', 'Desc.clip': 'one line, cut with …', 'Desc.faint': 'the "·" that says there is nothing, in the border grey',
                'Desc.lines': '2, 3 or 4: a long description keeps that many lines in the row', 'Desc.marks': 'tags in a wrapping line under the words',
                'Desc.pre': 'words a person wrote, their line breaks kept', 'Desc.title': 'the tooltip', 'Desc.children': 'what the thing is or does',
                'Who.sub': 'a grey line under it', 'Who.clip': 'one line, cut with …', 'Who.warn': 'that line in coral', 'Who.title': 'the tooltip', 'Who.children': 'who has it or where it is',
                'Num.dim': 'the figure in grey', 'Num.strong': 'a total, at the name\'s weight', 'Num.quiet': 'in the words\' grey ("3 lines")',
                'Num.sign': 'how soon, in coral typewriter', 'Num.title': 'the tooltip', 'Num.children': 'the figure (a numeral in the poster face is a Figure inside it)',
                'When.at': 'a second line, the clock; the first line then stands in bold ink', 'When.clip': 'one line, cut with …',
                'When.warn': 'the time in coral: a time that needs a look', 'When.title': 'the tooltip', 'When.children': 'the time',
                'Cell.meta': 'a small grey typewriter cell', 'Cell.sign': 'a short coral code that names the row (T1)', 'Cell.dim': 'grey words (and a grey row label)',
                'Cell.faint': 'in the border grey', 'Cell.clip': 'one line, cut with …', 'Cell.line': 'marks in one line that wraps; a plain titled span in it is a grey icon',
                'Cell.code': 'the name code calls a thing by, typewriter in ink', 'Cell.sub': 'a grey line under a meta or code cell', 'Cell.subQuiet': 'that line in italics (code)',
                'Cell.head': 'a bold word on its own line over a meta cell\'s words', 'Cell.headDim': 'that word in grey', 'Cell.title': 'the tooltip',
                'Cell.children': 'any other cell; <Cell /> is an empty placeholder',
                'Doors.menu': '[{ label, icon, onClick, danger }]: the ⋯ menu (CardMenu) at the end', 'Doors.menuLabel': 'the menu\'s name', 'Doors.title': 'the tooltip',
                'Doors.children': 'the actions at the end of the row (Action, Loud, Icon, Tab, Switch, Mark)',
                'Panel.doors': 'the row of actions at its foot', 'Panel.text': 'a long text shown as it was written (72 characters wide)', 'Panel.id': 'its id',
                'Panel.title': 'the opened record\'s title in the poster record face', 'Panel.mark': 'its status at the right of that title', 'Panel.children': 'what the opened row shows',
                'Lead.text': 'the letters of the one Avatar', 'Lead.seed': 'a seed that draws the Avatar\'s pattern', 'Lead.agent': 'the agent\'s Avatar',
                'Lead.size': 'the Avatar\'s size', 'Lead.label': 'its name for a screen reader', 'Lead.picture': 'a picture inside the Avatar', 'Lead.title': 'the tooltip',
                'Lead.children': 'any other mark at the start (a colour picker, a dot)',
                'Tick.state': 'done | failed | active | pending | off | none: ✓ ✗ → blank · blank in an 18px box', 'Tick.bare': 'the glyph without its box',
                'Tick.glyph': 'the state said in another mark (○)', 'Tick.title': 'the tooltip',
                'Thumb.title': 'the tooltip of a page\'s thumbnail',
                'Found.children': 'the words a search found, on the sun, inside a name or its line',
                'Stats.title': 'the tooltip', 'Stats.children': 'the Stat counts, each on its own fixed track',
                'Stat.icon': 'the mark before the number', 'Stat.date': 'a date that keeps the last track', 'Stat.title': 'what the count counts',
                'Stat.children': 'the number; an empty Stat holds its place',
                'Group.title': 'the heading\'s words (Jouni\'s decision "Group heading")', 'Group.count': 'the tally at its end',
                'Group.onFold': 'gives it the ↓/→ button that folds the rows after it', 'Group.folded': 'the rows are hidden', 'Group.foldLabel': 'that button\'s name',
                'Group.wholeHead': 'a press anywhere on the heading folds it', 'Group.doors': 'actions after the count', 'Group.quiet': 'the grey heading',
                'Group.onDragOver': 'a row is dragged over the heading', 'Group.onDrop': 'a row is dropped on the heading', 'Group.children': 'the rows under it',
                'Filters.label': 'the row\'s name for a screen reader', 'Filters.children': 'the Filter tabs, and an Action tone="more"',
                'Filter.on': 'the filter is on: on the sun', 'Filter.count': 'the tally in it', 'Filter.onClick': 'turns it on or off',
                'Filter.attention': 'a filter that points at something to look at', 'Filter.end': 'it stands apart at the row\'s end',
                'Filter.disabled': 'it cannot be pressed now', 'Filter.title': 'the tooltip', 'Filter.children': 'its word',
                'SearchLine.value': 'what is typed', 'SearchLine.onInput': 'called on each key', 'SearchLine.onEnter': 'runs on Enter',
                'SearchLine.onClear': 'adds the ✕ while there is text', 'SearchLine.clearLabel': 'the ✕\'s name', 'SearchLine.placeholder': 'the empty field\'s words',
                'SearchLine.label': 'the field\'s name (the placeholder when not given)', 'SearchLine.note': 'the small grey words after the field ("12 of 40")',
                'SearchLine.text': 'a plain text field, not a search field', 'SearchLine.autofocus': 'the cursor starts in it',
                'SearchLine.beside': 'one of several lines side by side, each up to 500px, under each other on a phone',
                'SearchLine.children': 'a button, a hint or a loading line after the field',
                'More.label': 'the words of "show N more"', 'More.onMore': 'shows more; the action stands only while it is given', 'More.disabled': 'the action cannot be pressed now',
                'More.note': 'how many are shown ("12 of 40")', 'More.wrap': 'the line wraps on a phone', 'More.children': 'the other doors of the list\'s foot',
            },
        },
        useFor: [
            'Any list of things in Settings & Controls: skills, packages, agents, keys, notifications, organisms, to-dos, devices, the mail sent.',
            'A list a person filters, searches, pages through, picks from or reorders: Filters, SearchLine and More stand around it.',
        ],
        variants: [
            { name: 'head', prop: 'List head', when: 'the column labels over the rows; a figure column\'s label at the right' },
            { name: 'keep columns', prop: 'List keepCols', when: 'the columns stay on a phone, as the cut says' },
            { name: 'empty', class: 'list-empty', prop: 'List empty', when: 'there are no rows: the quiet line in the list\'s place' },
            { name: 'loading', class: 'list-empty', prop: 'List loading', when: 'the rows are on the way: the loading line in the list\'s place' },
            { name: 'dense', class: 'list--dense', prop: 'List dense', when: 'a list inside a panel or under a row' },
            { name: 'under', class: 'list--under', prop: 'List under', when: 'a list that belongs to the row above it' },
            { name: 'small', class: 'list--small', prop: 'List small', when: 'a checklist under a field, small and without rules' },
            { name: 'scroll', class: 'list--scroll', prop: 'List scroll', when: 'a long pick list in a capped frame' },
            { name: 'scroll medium', class: 'list--scroll-medium', prop: 'List scroll="medium"', when: 'an agent\'s usage list, capped at 300px' },
            { name: 'apart', class: 'list--apart', prop: 'List apart', when: 'a list under a label or a line' },
            { name: 'opens', class: 'list-row--toggle', prop: 'Row onToggle', when: 'a row that opens on a press anywhere; its panel is the raised box' },
            { name: 'hover', class: 'list-row--hover', prop: 'Row hover', when: 'a row that opens nothing but answers the pointer' },
            { name: 'selected', class: 'is-selected', prop: 'Row selected', when: 'the row the page is showing' },
            { name: 'faded', class: 'is-faded', prop: 'Row faded', when: 'a thing that is past' },
            { name: 'fine', class: 'is-fine', prop: 'Row fine', when: 'a condition that is met' },
            { name: 'warn rail', class: 'list-row--warn', prop: 'Row rail="warn"', when: 'a draft or a request that waits' },
            { name: 'colour', class: 'list-row--colour', prop: 'Row colour', when: 'the colour a person gave the thing' },
            { name: 'pick', class: 'list-row--pick', prop: 'Row picked onPick', when: 'a row picked by its check box' },
            { name: 'pick off', class: 'list-row--pick-off', prop: 'Row pickOff', when: 'a pick box that cannot change now' },
            { name: 'drag', class: 'list-row--grip', prop: 'Row draggable grip', when: 'rows a person reorders; the handle shows under the pointer' },
            { name: 'dragging', class: 'is-dragging', prop: 'Row dragging', when: 'the row being dragged' },
            { name: 'drag over', class: 'is-drag-over', prop: 'Row dragOver', when: 'the row a drag is over' },
            { name: 'unread', class: 'is-unread', prop: 'Name unread', when: 'a thing not yet read' },
            { name: 'attention', class: 'is-attention', prop: 'Name attention', when: 'a thing with a problem' },
            { name: 'clip', class: 'list-clip', prop: 'Name clip', when: 'a meta line cut to one line' },
            { name: 'fine note', class: 'list-note--fine', prop: 'Name note noteTone="fine"', when: 'what an answer did, when it went well' },
            { name: 'tick', class: 'list-tick', prop: 'Tick state', when: 'a step\'s state at the row\'s start' },
            { name: 'bare tick', class: 'list-glyph', prop: 'Tick bare', when: 'a rule met or not, without the box' },
            { name: 'thumbnail', class: 'list-thumb', prop: 'Thumb', when: 'a page, at the row\'s start' },
            { name: 'counts', class: 'list-stats', prop: 'Stats + Stat', when: 'fixed small counts that line up down the list' },
            { name: 'group', class: 'list-group-head', prop: 'Group', when: 'a heading over the rows after it, with a count and a fold' },
            { name: 'group folds whole', class: 'list-group-head--folds', prop: 'Group wholeHead', when: 'a heading that folds from a press anywhere on it' },
            { name: 'filter at the end', class: 'list-filter--end', prop: 'Filter end', when: 'the filter that stands apart at the row\'s end' },
            { name: 'time warn', class: 'list-when--warn', prop: 'When warn', when: 'a time that needs a look' },
            { name: 'lines', class: 'list-lines--3', prop: 'Desc lines={3}', when: 'a long description kept to its first lines' },
            { name: 'more wraps', class: 'list-more--wrap', prop: 'More wrap', when: 'a list foot with several doors' },
        ],
        example: {
            cols: 'name-desc-doors', head: ['Skill', 'What it teaches', ''],
            rows: [{ name: 'aimeat-writing', meta: 'v1.4.0', desc: 'How prose is written on this project.' }, { name: 'meeting-notes', meta: 'v0.2.0', desc: 'Short meeting notes, decisions first.' }],
        },
        note: 'Built on 2026-09-26 as one component for the Listing (listing.css, whose class names the admin pages share) and the other list kinds of Settings: the organism, record, page, device, to-do, uses, tier, requirement, offer, search-hit, notification, sent-log, access-log and app-picker rows. It also wears listing.css (the cuts, the rows, the cells, the opened panel), search-line.css (SearchLine), more-line.css (More), key-name.css (Name asKey) and tab-row.css (Filters, the Tabs row\'s filter tone).',
    },
];
