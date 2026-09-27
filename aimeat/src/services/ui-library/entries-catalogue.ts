/**
 * @file src/services/ui-library/entries-catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the parts the app catalogue brought when it was rebuilt on
 *   components (appcat, /v1/appcat): the page with its own index, the page laid over the page, the
 *   stops of a piece of work, the day bars, the world map and its arithmetic, the data map, the window
 *   of days, and the two sheets that hold other parts' new options (the List's tones and the dialog's
 *   options). The purpose half only; facts.generated.ts carries what the files say.
 * @structure CATALOGUE_ENTRIES
 * @usage import { CATALOGUE_ENTRIES } from './entries-catalogue.js';
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: index-frame, overlay, stops, slot-bars, world-map, world-map-model,
 *     data-map, day-window, list-tones and modal (the catalogue pass, appcat).
 */
import type { UiEntryWritten } from './types.js';

export const CATALOGUE_ENTRIES: UiEntryWritten[] = [
    {
        id: 'index-frame', name: 'IndexFrame', kind: 'component', status: 'active',
        summary: 'A page with its own index beside it: the index column at the start, 250px wide, and the main column beside it at a reading width of 1180px with the poster page\'s air. Under 900px the page is one column and the index stands on top. A foot on ink as the main column\'s last part reaches to the column\'s edges.',
        module: '/components/IndexFrame.js', sheet: '/css/components/index-frame.css',
        data: {
            shape: 'IndexFrame({ index, label, dense, children })',
            fields: {
                index: 'the index column\'s content: the views, the states and the tags a person filters by (a SideMenu with `index`)',
                label: 'the index column\'s name for a screen reader',
                dense: 'the catalogue\'s reading on the whole frame: the browser\'s own line height, and the dim words in the lightest grey of the theme',
                children: 'the main column: the page itself; an InkFoot as its last part reaches to the column\'s edges',
            },
        },
        useFor: ['A page that lists many things and lets a person narrow them from an index at its side: the app catalogue.'],
        variants: [
            { name: 'with index', prop: 'index', class: 'index-frame-index', when: 'the page has its own index at the start' },
            { name: 'dense', prop: 'dense', class: 'index-frame--dense', when: 'the page reads as the old app catalogue did: normal line height, the lighter grey for dim words' },
        ],
        example: { dense: true, label: 'App catalogue', index: 'SideMenu index', children: 'the list of apps' },
        note: 'Came with appcat: the old /app-catalog.html frame (.cat-body, .cat-rail, .cat-main and its footer) as a component. `dense` sets --text-dim to --text-muted on the frame, because the old page\'s own --text-dim was the theme\'s lightest grey.',
    },
    {
        id: 'overlay', name: 'Overlay', kind: 'component', status: 'active',
        summary: 'A page laid over the page: the whole window on the page\'s ground, a bar across the top with a thin framed close square, the title cut to one line and the bar\'s tools at its right end, and under the bar the body, which alone scrolls. With a rail the body is two columns, the page and its contents rail, which stays in view and goes under 1100px. With `fill` the body is one framed app edge to edge under a thinner glass bar with a larger close square.',
        module: '/components/Overlay.js', sheet: '/css/components/overlay.css',
        data: {
            shape: 'Overlay({ label, title, glyph, onEdit, editLabel, back, link, tools, onClose, closeLabel, fill, rail, bodyRef, normalLeading, smallWords, children })',
            fields: {
                label: 'the layer\'s name for a screen reader (the title\'s words when the title is plain text)',
                title: 'the words in the bar, cut to one line',
                glyph: 'the thing\'s own sign before the title, a step larger (an app\'s icon)',
                onEdit: 'a quiet pencil after the title that opens the thing\'s editor; leave it out while the editor is open',
                editLabel: 'the pencil\'s name',
                back: '{ label, onClick }: the way back at the top of the body, a coral typewriter line under a heavy rule',
                link: '{ href, label, mark, title }: a pill link at the bar\'s right end that opens in a new tab',
                tools: 'what stands at the bar\'s right end',
                onClose: 'the close square was pressed', closeLabel: 'the close square\'s name (Close by default)',
                fill: 'the body is one thing edge to edge that does not scroll (a framed app), under the viewer\'s glass bar',
                rail: 'the contents rail beside the page (a Rail); it stays in view while the page scrolls',
                bodyRef: 'a ref to the element that scrolls, so the page can bring a part to the top',
                normalLeading: 'everything inside reads at the browser\'s own line height, as the app catalogue did',
                smallWords: 'the small action links inside read a step smaller (.78rem) in the body face',
                children: 'the page',
            },
        },
        useFor: ['One thing\'s whole page opened over a list without leaving it (an app\'s detail), or a framed app shown over the page.'],
        variants: [
            { name: 'page', prop: 'children', class: 'overlay-body', when: 'a reading page of its own over the list' },
            { name: 'with rail', prop: 'rail', class: 'overlay-page', when: 'a long page with its contents rail beside it' },
            { name: 'fill', prop: 'fill', class: 'overlay--fill', when: 'a framed app edge to edge, under the glass bar' },
            { name: 'glyph', prop: 'glyph', class: 'overlay-glyph', when: 'the thing has a sign of its own before its title' },
            { name: 'edit', prop: 'onEdit', class: 'overlay-edit', when: 'the owner may open the thing\'s editor from the title' },
            { name: 'back', prop: 'back', class: 'overlay-back', when: 'the way back to the list at the top of the body' },
            { name: 'link', prop: 'link', class: 'overlay-link', when: 'a pill link out of the layer, into a new tab' },
            { name: 'normal leading', prop: 'normalLeading', class: 'overlay--normal-leading', when: 'the layer reads at the browser\'s own line height' },
            { name: 'small words', prop: 'smallWords', class: 'overlay--small-words', when: 'the small action links read at .78rem in the body face' },
        ],
        example: { title: 'Harbour Studio planner', glyph: '🗓', back: { label: '← Your apps' }, closeLabel: 'Close', children: 'the page' },
        note: 'Came with appcat: the old app catalogue\'s two full-window layers, the detail view (#detail-view, .dtl-toolbar, .dtl-body, .dtl-page and its rail) and the app viewer (#iframe-view, .iframe-toolbar). It holds no state and moves no focus: the page draws it while it is open.',
    },
    {
        id: 'stops', name: 'Stops', kind: 'component', status: 'active',
        summary: 'Where a piece of work stands, as the stops it passes: one row per stop under the heavy rule, its name in the coral label, where it stands now in the poster figures (on the sun for the stop that holds the work), and one bold line of what that means. The rows are as wide as the widest stop. Under them a picture of the thing in the heavy frame, the sentence of what to do next, the doors, and a small typewriter line.',
        module: '/components/Stops.js', sheet: '/css/components/stops.css',
        data: {
            shape: 'Stops({ items, picture, lead, foot, children })',
            fields: {
                items: '[{ key, label, value, note, on }]: a stop\'s name, where it stands, what that means, and `on` for the stop that holds the work now; a falsy item is left out',
                picture: '{ src, alt }: the thing\'s picture, cut from its top, at most 260×160; it goes when it does not load',
                lead: 'the sentence of what to do next, set in under the figures',
                children: 'the doors, at the column\'s start',
                foot: 'a small grey typewriter line set in under the figures (a size)',
            },
        },
        useFor: ['Say where one piece of work is on its way from a private copy to a published one, and what to do next.'],
        variants: [
            { name: 'on', prop: 'items[].on', class: 'stops-row--on', when: 'the stop that holds the work now: its figure on the sun' },
            { name: 'picture', prop: 'picture', class: 'stops-picture', when: 'the thing has a picture' },
            { name: 'lead', prop: 'lead', class: 'stops-lead', when: 'a sentence says what to do next' },
            { name: 'foot', prop: 'foot', class: 'stops-foot', when: 'a small fact under the doors' },
        ],
        example: { items: [{ key: 'wc', label: 'Working copy', value: 'Saved 2 min ago', note: 'Only you see it.', on: true }, { key: 'pub', label: 'Published', value: 'v4', note: 'Others see this one.' }], lead: 'Publish when the copy is ready.', foot: 'Size: 24 KB' },
        note: 'Came with appcat: the old app catalogue\'s "Where your work is" band (detail.js statusHtml: .wc-row, .wc-band, .wc-stop, .wc-explain, .wc-size). appcat draws it in views/appcat/sections/work.js.',
    },
    {
        id: 'slot-bars', name: 'SlotBars', kind: 'component', status: 'active',
        summary: 'Counts over a window of days as one row of bars, one slot per day (per week past 120 days), each bar stacked from up to three parts in ink, grey and coral. The bars are 2 to 28px wide whatever the window, never stretched. Over them the title in coral capitals and the peak in grey typewriter; under them the first and the last date and a key.',
        module: '/components/SlotBars.js', sheet: '/css/components/slot-bars.css',
        data: {
            shape: 'SlotBars({ title, peak, bars, parts, from, to, label, keyed, tip, summary, caveat, fitAxis }) · slotsFromSeries(series, from, to, keys)',
            fields: {
                title: 'the chart\'s name over its left end, in coral capitals',
                peak: 'the words over its right end ("most in a day: 12")',
                bars: '[{ from, to, total, <part key>: n }], from slotsFromSeries',
                parts: '[{ key, label, tone }] drawn bottom up; tone ink | dim | coral (coral by default)',
                from: 'the first date under the bars', to: 'the last date',
                label: 'the chart\'s name for a screen reader (the title by default)',
                keyed: 'draw the key of the parts under the chart',
                tip: 'tip(bar): one bar\'s tooltip; by default its dates and its parts',
                summary: 'one grey typewriter line over the chart that says what the bars add up to',
                caveat: 'the small grey line under the chart that says how to read it',
                fitAxis: 'the dates stand under the bars only; a chart too short for two dates says the span in one',
                slotsFromSeries: 'folds a sparse day series into even slots over [from, to]: { bars, max, grain }',
            },
        },
        useFor: ['How much happened on each day of a window: visits to an app, versions published.'],
        variants: [
            { name: 'coral', prop: 'parts[].tone="coral"', class: 'slot-bars-mark--coral', when: 'one part: the bars in coral' },
            { name: 'ink', prop: 'parts[].tone="ink"', class: 'slot-bars-mark--ink', when: 'the strongest part of a stacked bar' },
            { name: 'dim', prop: 'parts[].tone="dim"', class: 'slot-bars-mark--dim', when: 'the quieter part of a stacked bar' },
            { name: 'keyed', prop: 'keyed', class: 'slot-bars-keys', when: 'more than one part: the key under the chart' },
            { name: 'summed', prop: 'summary, caveat', class: 'slot-bars-summed', when: 'a line over the chart and a caveat under it' },
            { name: 'fit axis', prop: 'fitAxis', when: 'a short window: the dates under the bars, not under the whole width' },
        ],
        example: { title: 'Opens', peak: 'most in a day: 12', from: '9/1/2026', to: '9/27/2026', parts: [{ key: 'signed_in', label: 'Signed in', tone: 'ink' }, { key: 'anonymous', label: 'Anonymous', tone: 'dim' }], keyed: true },
        note: 'Came with appcat: the old app catalogue\'s version chart (.version-chart, .version-span, .version-span-hint) and its stacked visitor charts (.vis-bar-mark, .vis-keys), one component.',
    },
    {
        id: 'world-map', name: 'WorldMap', kind: 'component', status: 'active',
        summary: 'Counts per country on a world map in the heavy ink frame at 2:1, with the list that says the same numbers beside it. Countries are shaded in five strengths of coral, land with nothing in a faint ink, a city a sun dot. A press on a counted country zooms to it and lists its regions and cities; "+" and "−" zoom and "Whole world" goes back; a Fewer…More legend under the map. The list drops under the map on a narrow screen.',
        module: '/components/WorldMap.js', sheet: '/css/components/world-map.css',
        data: {
            shape: 'WorldMap({ countries, places, unknownCode, lang, words, atlasUrl }) · loadAtlas(url) · countryName(code, lang, atlas, unknownCode, unknownWords)',
            fields: {
                countries: '[{ code, count }], ISO alpha-2; an empty list draws the empty line only',
                places: '[{ country, region, city, lat, lon, count }]: the regions and cities, a dot where lat and lon are known',
                unknownCode: 'the code that means "place unknown" (the node\'s ZZ)',
                lang: 'the page language, for the country names',
                words: '{ map, loading, failed, empty, zoomIn, zoomOut, zoomInTitle, zoomOutTitle, whole, few, many, country, count, notDrawn, unknownPlace, noPlaces, counted(n) }',
                atlasUrl: 'the node\'s own shapes (/lib/aimeat-atlas@1.json), fetched same-origin once per page',
            },
        },
        useFor: ['Where the visitors of a thing came from, when the list of countries is the answer and the map its picture.'],
        variants: [
            { name: 'shades', prop: 'countries', class: 'world-map-shade-5', when: 'five strengths of coral on a square-root scale, the most counted the full colour' },
            { name: 'focus', prop: 'a press on a country', class: 'is-focus', when: 'one country chosen: zoomed, outlined, its places listed' },
            { name: 'dots', prop: 'places with lat, lon', class: 'world-map-dot', when: 'cities where coordinates are known' },
            { name: 'loading', class: 'world-map-wait', when: 'the atlas is on its way' },
            { name: 'empty', prop: 'countries=[]', when: 'nothing counted: the empty line in grey' },
        ],
        example: { countries: [{ code: 'FI', count: 42 }, { code: 'SE', count: 12 }, { code: 'ZZ', count: 3 }], unknownCode: 'ZZ', lang: 'en' },
        note: 'Came with appcat: the old app catalogue\'s visitors map (js/visitors-map.js: .vis-geo, .vis-map*, .vis-land, .vis-shade-*, .vis-dot, .vis-legend). Nothing leaves the node to draw it. Its arithmetic is world-map-model.',
    },
    {
        id: 'world-map-model', name: 'World map model', kind: 'component', status: 'active',
        summary: 'The arithmetic behind the world map, with no markup: the table that joins a country\'s two codes (ISO alpha-2 from the proxy, ISO numeric in the atlas), a country\'s shade from its count on a square-root scale, a coordinate as a point on the atlas, the view box that shows one country, and one country\'s places, most first.',
        module: '/components/world-map/model.js', sheet: '/css/components/world-map.css',
        data: {
            shape: 'ISO_NUMERIC · numericOf(alpha2) · alpha2Of(numeric) · shadeStep(count, max) · projectPoint(lat, lon, w, h) · zoomBox(bbox, w, h, minSpan) · placesOfCountry(places, alpha2)',
            fields: {
                ISO_NUMERIC: 'alpha-2 to numeric, as the atlas spells it (leading zeros kept)',
                shadeStep: '1 (fewest) to 5 (most), 0 for none',
                projectPoint: 'equirectangular, the projection the atlas was built in',
                zoomBox: 'a 2:1 view box around a country with air, never tighter than minSpan',
                placesOfCountry: 'the places of one country, most counted first',
            },
        },
        useFor: ['Read by WorldMap only; a page never imports it.'],
        variants: [],
        example: { count: 12, max: 42 },
        note: 'Moved from the old app catalogue (js/visitors-model.js), the map\'s half unchanged. It draws nothing; its look is WorldMap\'s sheet. The data map\'s model (components/data-map/model.js) is named in NOT_PARTS in scripts/build-ui-library.ts; this one has an entry because that list is not the catalogue writers\' to change.',
    },
    {
        id: 'data-map', name: 'DataMap', kind: 'component', status: 'active',
        summary: 'An app\'s data map read in full: what the app is, its facts as named rows, the parts under coral capitals over the ink rule, and one row per thing it holds (the key in the typewriter face, what it holds, where at the right, the facts and the why under them). A row nobody explained carries the coral bar at its left and its missing why in coral; a map that contradicts itself opens with the contradiction in a heavy coral frame.',
        module: '/components/DataMap.js', sheet: '/css/components/data-map.css',
        data: {
            shape: 'DataMap({ map, findings, say, loading }) · dataMapState(map)',
            fields: {
                map: 'the data map (spec aimeat.datamap/2) of GET /v1/datamap/apps/{owner}/{file}, or null',
                findings: '[{ code, message }]: what is still missing from the map',
                say: 'say(key): the words for a dataMap.* key; the node\'s own words by default',
                loading: 'the map has not answered yet',
                dataMapState: 'missing | unfinished | stated | contradicted',
            },
        },
        useFor: ['Show what an app keeps, where, and why, so the person who owns the data can judge it.'],
        variants: [
            { name: 'stated', prop: 'map', class: 'data-map-row', when: 'every row says why it is there' },
            { name: 'unexplained', prop: 'a row without why', class: 'data-map-row--unexplained', when: 'a row nobody explained: the coral bar and the missing why in coral' },
            { name: 'contradicted', prop: 'a map that contradicts itself', class: 'data-map-contradiction', when: 'the contradiction opens the map in a heavy coral frame' },
            { name: 'personal', prop: 'row.personalData="yes"', class: 'data-map-personal', when: 'a row holds something about a person' },
            { name: 'no recall', prop: 'leaves[].recallable=false', class: 'data-map-norecall', when: 'something that leaves the house and cannot be taken back' },
            { name: 'missing', prop: 'map=null', when: 'the app has no map yet' },
            { name: 'loading', prop: 'loading', when: 'the map is on its way' },
        ],
        example: { map: { spec: 'aimeat.datamap/2', what: 'A planner for Harbour Studio\'s bookings.', form: 'one-person', held: [{ what: 'bookings', holds: 'the bookings', where: 'owner-memory-private', why: 'The planner shows them.' }] } },
        note: 'Came with appcat: the old app catalogue\'s data map (js/data-map.js panelHtml, .dtl-dm-*). Its vocabulary is components/data-map/model.js; a word it does not know is printed as written. appcat draws it in views/appcat/sections/datamap.js.',
    },
    {
        id: 'day-window', name: 'DayWindow', kind: 'component', status: 'active',
        summary: 'The window of days a count is read over, on one line that wraps: the ready windows as action words ("Today", "7 days", "30 days"), the chosen one the loud slab, a coral capital label, an underlined number field 92px wide for a typed number of days, and "Show".',
        module: '/components/DayWindow.js', sheet: '/css/components/day-window.css',
        data: {
            shape: 'DayWindow({ days, presets, max, busy, id, words, onDays })',
            fields: {
                days: 'the window shown now; its word is the loud slab',
                presets: 'the ready windows in days, 0 for today (0, 7, 30, 90, 360 by default)',
                max: 'the largest number the field takes',
                busy: 'the doors wait at half strength while a count is read',
                id: 'the number field\'s id, which its label points at',
                words: '{ today, days(n), label, show }',
                onDays: 'onDays(n): a ready window was pressed, or a typed one was asked for with Enter or Show (as typed; the page decides)',
            },
        },
        useFor: ['Choose how many days back a count reads: an app\'s visitors.'],
        variants: [
            { name: 'chosen', prop: 'days', when: 'the window in force: the loud slab among the words' },
            { name: 'typed', prop: 'id, max', class: 'day-window-days', when: 'a number of days the ready windows do not offer' },
            { name: 'busy', prop: 'busy', when: 'a count is being read: the doors at half strength' },
        ],
        example: { days: 30, presets: [0, 7, 30, 90, 360], max: 360, id: 'vis-days', words: { label: 'Days', show: 'Show' } },
        note: 'Came with appcat: the old app catalogue\'s visitor window (js/visitors.js windowHtml, .vis-window, .vis-days-input).',
    },
    {
        id: 'list-tones', name: 'List tones', kind: 'component', status: 'active',
        summary: 'The List\'s tones for the lists of one thing\'s long page, each with its own shape over the Listing\'s grid: a history of versions with coral typewriter doors, a setting per row with its meaning and its door, a small table of counts, named entries each with a paragraph under its name, a log of what was done on wrapping lines, the pages a thing ought to have with their doors and editor, and a tree of forks on plain indented lines.',
        module: '/components/List.js', sheet: '/css/components/list-tones.css',
        data: {
            shape: 'List({ tone, cols, rows, render, children }) with Row, Name, Desc, When, Who, Num, Cell and Doors',
            fields: {
                tone: 'history | releases | checkpoints | switches | counts | entries | log | pages | tree: which list of one thing\'s page it is',
                children: 'the rows (Row with its cells), or `rows` with `render(item, i)`',
            },
        },
        useFor: ['A list on one thing\'s long page that must read as that list reads: its versions, its settings, its counts, its skills, its log, its legal pages, its forks.'],
        variants: [
            { name: 'history', prop: 'tone="history"', class: 'list--history', when: 'the states a thing had, newest first: the version in the poster face, the current one tagged on the sun, the facts under it, the doors coral typewriter words' },
            { name: 'releases', prop: 'tone="releases"', class: 'list--releases', when: 'the history in a dialog: the facts a step smaller, the doors plain typewriter words 6px apart' },
            { name: 'checkpoints', prop: 'tone="checkpoints"', class: 'list--checkpoints', when: 'the saves a working copy passed: the time bold, the note under it in full, a loud door among them' },
            { name: 'switches', prop: 'tone="switches"', class: 'list--switches', when: 'a setting per row: its name bold, what its state means in grey, its door at the right' },
            { name: 'counts', prop: 'tone="counts"', class: 'list--counts', when: 'a small table of counts: coral capital heads over the rule, the counts in typewriter, a name that turns coral under the pointer' },
            { name: 'entries', prop: 'tone="entries"', class: 'list--entries', when: 'named entries under a heavy rule: the name, its version and a faint ×, and its words under them' },
            { name: 'log', prop: 'tone="log"', class: 'list--log', when: 'what was done, newest first: the date in grey typewriter, the act in coral capitals, the name bold, who in grey' },
            { name: 'pages', prop: 'tone="pages"', class: 'list--pages', when: 'a page a thing ought to have per row: its name with its marks, why under it, its doors beside, its editor below' },
            { name: 'tree', prop: 'tone="tree"', class: 'list--tree', when: 'the forks of a thing: plain lines, each level 16px further in, its state a small coloured word' },
        ],
        example: { tone: 'history', rows: [{ name: 'v4', meta: '24 KB · 27 Sep 2026' }, { name: 'v3', meta: '23 KB · 20 Sep 2026' }] },
        note: 'Came with appcat: the old app catalogue\'s detail lists (.dtl-version-row, .version-row, .wc-ckpt-*, .mk-row, .vis-table, .dtl-skill, .mk-log, .lg-row, .lineage-node), in list-tones.css after list.css. The module is List.js, which the list entry shares; its `tone` prop selects these.',
    },
    {
        id: 'modal', name: 'Modal options', kind: 'component', status: 'active',
        summary: 'The dialog\'s options that only the SPA draws, kept out of the shared dialog sheet: the dialog at the browser\'s own line spacing (a question at .95rem, a shorter slab title on a phone), and the thing the dialog is about after its title in the typewriter face.',
        module: '/components/Modal.js', sheet: '/css/components/modal.css',
        data: {
            shape: 'Modal({ leading, titleRef, … }) · ConfirmDialog({ leading, … })',
            fields: {
                leading: '"normal": the dialog reads at the browser\'s own line spacing, every part inherits it, the footer keeps the site\'s',
                titleRef: 'the thing the dialog is about (a filename), after its title in the typewriter face, as it is written',
            },
        },
        useFor: ['A dialog that must read as the app catalogue\'s dialogs read, or that names the file it is about beside its title.'],
        variants: [
            { name: 'normal leading', prop: 'leading="normal"', class: 'dlg--leading-normal', when: 'the dialog at the browser\'s own line spacing' },
            { name: 'title reference', prop: 'titleRef', class: 'dlg-title-ref', when: 'a filename after the title' },
        ],
        example: { title: 'Versions', titleRef: 'planner.html', leading: 'normal' },
        note: 'Came with appcat. The dialog\'s look is the dialog entry (dialog.css); dialog.css is also copied into the old app catalogue\'s page at build time, so an option only the SPA draws lives in modal.css and that build stays as it is.',
    },
];
