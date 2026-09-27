/**
 * @file public/views/design-lab/demos-catalogue.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the parts the app catalogue brought when it was rebuilt on components
 *   (appcat, /v1/appcat), each drawn by calling the real component with sample data. appcat draws
 *   its parts without the Settings root, so these stand bare, as the page draws them.
 * @structure CATALOGUE_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { CATALOGUE_DEMOS } from './demos-catalogue.js';
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: index-frame, overlay, stops, slot-bars, world-map, world-map-model,
 *     data-map, day-window, list-tones and modal (the catalogue pass, appcat).
 */
import { h } from 'preact';
import htm from 'htm';
import { IndexFrame } from '/components/IndexFrame.js';
import { SideMenu, SideMenuTitle, SideMenuHome, SideMenuItem, SideMenuGroup } from '/components/SideMenu.js';
import { InkFoot } from '/components/InkFoot.js';
import { Overlay } from '/components/Overlay.js';
import { Rail } from '/components/Rail.js';
import { Stops } from '/components/Stops.js';
import { SlotBars, slotsFromSeries } from '/components/SlotBars.js';
import { WorldMap } from '/components/WorldMap.js';
import { shadeStep } from '/components/world-map/model.js';
import { DataMap } from '/components/DataMap.js';
import { DayWindow } from '/components/DayWindow.js';
import { List, Row, Name, Desc, When, Who, Num, Cell, Doors } from '/components/List.js';
import { Modal, ConfirmDialog } from '/components/Modal.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const noop = () => {};

const LONG = 'Nordic Ferries seat map for the summer timetable, with every route between the islands';

/* ── IndexFrame ── */

const index = html`<${SideMenu} index label="App catalogue">
  <${SideMenuHome} href="/v1/home">← Home<//>
  <${SideMenuTitle} mark="📚">My Apps<//>
  <${SideMenuGroup} role="tablist" label="Views">
    <${SideMenuItem} tab tally active count=${12} onClick=${noop}>Your apps<//>
    <${SideMenuItem} tab tally count=${48} onClick=${noop}>Community<//>
    <${SideMenuItem} tab tally count=${0} onClick=${noop}>Favourites<//>
  <//>
  <${SideMenuGroup} title="Tags">
    <${SideMenuItem} tally small active count=${12} onClick=${noop}>All<//>
    <${SideMenuItem} tally small count=${4} onClick=${noop}>planner<//>
  <//>
<//>`;
const page = html`<${Note} kind="lead">Harbour Studio planner, Lumo Bakery orders and ten more apps of yours.<//>`;

/* ── Overlay ── */

const railOf = html`<${Rail} title="On this page" tone="ink" groups=${[{ label: 'On this page', items: [
  { section: 'work', mark: '01', label: 'Where your work is', on: true },
  { section: 'about', mark: '02', label: 'About' },
  { section: 'versions', mark: '03', label: 'Versions', count: 4 },
] }]} />`;
const overlayPage = html`<${Note} kind="lead">The planner keeps Harbour Studio's bookings for the week.<//>
  <${Note} kind="hint">Everything under the bar scrolls; the bar stays.<//>`;

/* ── SlotBars ── */

const FROM = '2026-08-29';
const TO = '2026-09-27';
const SERIES = [
  { day: '2026-09-02', signed_in: 3, anonymous: 1 }, { day: '2026-09-09', signed_in: 1, anonymous: 4 },
  { day: '2026-09-15', signed_in: 6, anonymous: 2 }, { day: '2026-09-21', signed_in: 2, anonymous: 0 },
  { day: '2026-09-26', signed_in: 8, anonymous: 4 },
];
const two = slotsFromSeries(SERIES, FROM, TO, ['signed_in', 'anonymous']);
const one = slotsFromSeries(SERIES.map((r) => ({ day: r.day, n: r.signed_in })), FROM, TO, ['n']);
const short = slotsFromSeries([{ day: '2026-09-25', n: 1 }, { day: '2026-09-27', n: 2 }], '2026-09-25', '2026-09-27', ['n']);
const PARTS = [{ key: 'signed_in', label: 'Signed in', tone: 'ink' }, { key: 'anonymous', label: 'Anonymous', tone: 'dim' }];

/* ── WorldMap ── */

const MAP_WORDS = {
  map: 'Where the visitors came from', loading: 'Loading the map…', failed: 'The map could not be loaded.',
  empty: 'Nobody has visited in this window.', zoomIn: '+', zoomOut: '−', zoomInTitle: 'Zoom in', zoomOutTitle: 'Zoom out',
  whole: 'Whole world', few: 'Fewer', many: 'More', country: 'Country', count: 'Visits', notDrawn: 'too small for the map',
  unknownPlace: 'Place unknown', noPlaces: 'No regions or cities are known.', counted: (n) => `visits: ${n}`,
};
const COUNTRIES = [{ code: 'FI', count: 42 }, { code: 'SE', count: 12 }, { code: 'NO', count: 7 }, { code: 'SG', count: 2 }, { code: 'ZZ', count: 3 }];
const PLACES = [
  { country: 'FI', region: 'Uusimaa', city: 'Helsinki', lat: 60.17, lon: 24.94, count: 30 },
  { country: 'FI', region: 'Pirkanmaa', city: 'Tampere', lat: 61.5, lon: 23.76, count: 12 },
  { country: 'SE', region: 'Stockholm', city: 'Stockholm', lat: 59.33, lon: 18.07, count: 12 },
];
const SHADED = [{ code: 'FI', count: 100 }, { code: 'SE', count: 50 }, { code: 'NO', count: 20 }, { code: 'DK', count: 6 }, { code: 'EE', count: 1 }];

/* ── DataMap ── */

const HELD = [
  { what: 'planner:bookings', holds: 'Every booking of the week', where: 'owner-memory-private', kind: 'user-written', usedFor: 'user-returns-to-read', readers: 'owner-only', lossRisk: 'only-copy', keptFor: 'until-deleted', personalData: 'yes', why: 'The planner shows the week from these.' },
  { what: 'planner:settings', holds: 'The opening hours', where: 'owner-memory-private', kind: 'settings', usedFor: 'app-cannot-run-without', readers: 'owner-only', lossRisk: 'user-can-rewrite', keptFor: 'until-deleted', why: 'The planner cannot draw a day without them.' },
];
const MAP = {
  spec: 'aimeat.datamap/2', source: 'declared', form: 'one-person',
  what: 'A planner for Harbour Studio\'s bookings, kept by one person.', usedFor: 'Seeing the week\'s bookings at a glance.',
  arrangement: 'One record per kind of thing, all in the owner\'s private memory.', held: HELD,
  leaves: [{ what: 'A booking confirmation', to: 'the customer\'s email', recallable: false }],
};
const UNEXPLAINED = { ...MAP, held: [...HELD, { what: 'planner:cache', holds: 'Last week, drawn', where: 'browser-only', kind: 'computed-or-cache', why: '' }] };
const CONTRADICTED = { ...MAP, held: [{ ...HELD[0], where: 'organism-workspace' }] };
const FINDINGS = [{ code: 'no-why', message: 'planner:cache does not say why it is kept.' }];

/* ── DayWindow ── */

const DAY_WORDS = { today: 'Today', days: (n) => `${n} days`, label: 'Days', show: 'Show' };

/* ── List tones ── */

const versions = (tone) => html`<${List} tone=${tone}>
  <${Row}><${Name} meta="24 KB · 27 Sep 2026 14:02" tag=${html`<${Mark} tone="sun">current<//>`}>v4<//>
    <${Doors}><${Action} small row onClick=${noop}>View<//><${Action} small row onClick=${noop}>Fork<//><//><//>
  <${Row}><${Name} meta="23 KB · 20 Sep 2026 09:40 · 7 days before">v3<//>
    <${Doors}><${Action} small row onClick=${noop}>View<//><${Action} small row onClick=${noop}>Restore<//><${Action} small row onClick=${noop}>Fork<//><//><//>
<//>`;

export const CATALOGUE_DEMOS = {
  'index-frame': { height: 420, flush: true, variants: [
    { name: 'dense, with its index', render: () => html`<${IndexFrame} dense index=${index} label="App catalogue">${page}<${InkFoot} brand="AIMEAT">12 apps · 3 drafts<//><//>` },
    { name: 'site reading', render: () => html`<${IndexFrame} index=${index} label="App catalogue">${page}<//>` },
    { name: 'no index', render: () => html`<${IndexFrame}>${page}<//>` },
  ] },
  overlay: { height: 480, flush: true, variants: [
    { name: 'page', render: () => html`<${Overlay} title="Harbour Studio planner" onClose=${noop} closeLabel="Close">${overlayPage}<//>` },
    { name: 'glyph, edit, back and rail', render: () => html`<${Overlay} normalLeading smallWords label="Harbour Studio planner" glyph="🗓"
      title="Harbour Studio planner" onEdit=${noop} editLabel="Edit the name" back=${{ label: '← Your apps', onClick: noop }}
      onClose=${noop} closeLabel="Close" rail=${railOf}>${overlayPage}<${Actions} chapter><${Action} small onClick=${noop}>Open<//><${Action} small onClick=${noop}>Fork<//><//><//>` },
    { name: 'fill with link', render: () => html`<${Overlay} fill title="Harbour Studio planner" onClose=${noop} closeLabel="Close"
      link=${{ href: '/', label: 'Publish your own app', mark: '⚡' }}><iframe title="Harbour Studio planner" srcdoc="<h1>Harbour Studio planner</h1><p>Monday: 4 bookings</p>"></iframe><//>` },
    { name: 'tools', render: () => html`<${Overlay} title="Lumo Bakery orders" onClose=${noop} closeLabel="Close"
      tools=${html`<${Action} small onClick=${noop}>Share<//>`}>${overlayPage}<//>` },
    { name: 'long', render: () => html`<${Overlay} glyph="⛴" title=${LONG} onClose=${noop} closeLabel="Close">${overlayPage}<//>` },
  ] },
  stops: { variants: [
    { name: 'working copy on', render: () => html`<${Stops} items=${[
      { key: 'wc', label: 'Working copy', value: 'Saved 2 min ago', note: 'Only you see it.', on: true },
      { key: 'pub', label: 'Published', value: 'v4', note: 'Others see this one.' }]}
      picture=${{ src: '/img/business-hero.png', alt: 'The planner' }} lead="Your changes are saved. Publish them when they are ready."
      foot="Size: 24 KB"><${Actions}><${Loud} control onClick=${noop}>Publish<//><${Action} small onClick=${noop}>Discard<//><//><//>` },
    { name: 'published on', render: () => html`<${Stops} items=${[
      { key: 'wc', label: 'Working copy', value: 'None', note: 'Nothing waits.' },
      { key: 'pub', label: 'Published', value: 'v4', note: 'Others see this one.', on: true }]} lead="Edit the app to start a working copy." />` },
    { name: 'long', render: () => html`<${Stops} items=${[{ key: 'pub', label: 'Published', value: 'v12', note: LONG, on: true }]} foot="Size: 1.2 MB" />` },
  ] },
  'slot-bars': { variants: [
    { name: 'coral, one part', render: () => html`<${SlotBars} title="Versions" peak=${`most in a day: ${one.max}`} bars=${one.bars}
      parts=${[{ key: 'n', label: 'Versions' }]} from="8/29/2026" to="9/27/2026" />` },
    { name: 'ink and dim, keyed', render: () => html`<${SlotBars} title="Opens" peak=${`most in a day: ${two.max}`} bars=${two.bars}
      parts=${PARTS} from="8/29/2026" to="9/27/2026" keyed />` },
    { name: 'summed', render: () => html`<${SlotBars} summary="4 versions stored · the first 29 days ago" caveat="A bar is a day; a taller bar had more versions."
      title="Versions" peak=${`most in a day: ${one.max}`} bars=${one.bars} parts=${[{ key: 'n', label: 'Versions' }]} from="8/29/2026" to="9/27/2026" />` },
    { name: 'fit axis, short', render: () => html`<${SlotBars} fitAxis title="Versions" peak=${`most in a day: ${short.max}`} bars=${short.bars}
      parts=${[{ key: 'n', label: 'Versions' }]} from="9/25/2026" to="9/27/2026" />` },
    { name: 'empty', render: () => html`<${SlotBars} title="Opens" bars=${[]} parts=${PARTS} />` },
  ] },
  'world-map': { height: 460, variants: [
    { name: 'shades, dots and the list', render: () => html`<${WorldMap} countries=${COUNTRIES} places=${PLACES} unknownCode="ZZ" lang="en" words=${MAP_WORDS} />` },
    { name: 'empty', render: () => html`<${WorldMap} countries=${[]} unknownCode="ZZ" lang="en" words=${MAP_WORDS} />` },
    { name: 'map not loaded', render: () => html`<${WorldMap} countries=${COUNTRIES} unknownCode="ZZ" lang="en" words=${MAP_WORDS} atlasUrl="/lib/no-such-atlas.json" />` },
  ] },
  'world-map-model': { height: 460, variants: [
    { name: 'five shades', render: () => html`<${Note} kind="meta">${SHADED.map((c) => `${c.code} ${c.count} → shade ${shadeStep(c.count, 100)}`).join(' · ')}<//>
      <${WorldMap} countries=${SHADED} unknownCode="ZZ" lang="en" words=${MAP_WORDS} />` },
  ] },
  'data-map': { variants: [
    { name: 'stated', render: () => html`<${DataMap} map=${MAP} />` },
    { name: 'unexplained, with findings', render: () => html`<${DataMap} map=${UNEXPLAINED} findings=${FINDINGS} />` },
    { name: 'contradicted', render: () => html`<${DataMap} map=${CONTRADICTED} />` },
    { name: 'missing', render: () => html`<${DataMap} map=${null} findings=${FINDINGS} />` },
    { name: 'loading', render: () => html`<${DataMap} loading />` },
  ] },
  'day-window': { variants: [
    { name: '30 days chosen', render: () => html`<${DayWindow} days=${30} max=${360} id="demo-days" words=${DAY_WORDS} onDays=${noop} />` },
    { name: 'today chosen', render: () => html`<${DayWindow} days=${0} max=${360} id="demo-days-0" words=${DAY_WORDS} onDays=${noop} />` },
    { name: 'typed window', render: () => html`<${DayWindow} days=${45} max=${360} id="demo-days-45" words=${DAY_WORDS} onDays=${noop} />` },
    { name: 'busy', render: () => html`<${DayWindow} days=${7} max=${360} busy id="demo-days-busy" words=${DAY_WORDS} onDays=${noop} />` },
  ] },
  'list-tones': { variants: [
    { name: 'history', render: () => versions('history') },
    { name: 'releases', render: () => versions('releases') },
    { name: 'checkpoints', render: () => html`<${List} tone="checkpoints">
      <${Row}><${Name} meta="Before: the new opening hours · 24 KB">27 Sep 2026 14:02<//>
        <${Doors}><${Action} small row onClick=${noop}>Preview<//><${Loud} control onClick=${noop}>Restore<//><${Action} small row onClick=${noop}>Delete<//><//><//>
      <${Row}><${Name} meta="Before an unnamed change · 23 KB">26 Sep 2026 17:45<//>
        <${Doors}><${Action} small row onClick=${noop}>Preview<//><${Loud} control disabled onClick=${noop}>Restore<//><${Action} small row disabled onClick=${noop}>Delete<//><//><//>
    <//>` },
    { name: 'switches', render: () => html`<${List} tone="switches">
      <${Row}><${Name}>Measure visitors<//><${Desc}>On: the app counts who opens it, without cookies.<//>
        <${Doors}><${Action} small onClick=${noop}>Turn off<//><//><//>
      <${Row}><${Name}>Show the badge<//><${Desc}>Off: the app shows no badge.<//>
        <${Doors}><${Loud} control onClick=${noop}>Turn on<//><//><//>
    <//>` },
    { name: 'counts', render: () => html`<${List} tone="counts" head=${['Country', { label: 'Visits', num: true }]}>
      <${Row} selected><${Name} onOpen=${noop}>Finland<//><${Num}>42<//><//>
      <${Row}><${Name} onOpen=${noop} after=${html` <${Note} kind="meta" inline>too small for the map<//>`}>Singapore<//><${Num}>2<//><//>
      <${Row}><${Name}><b>Place unknown</b><//><${Num}>3<//><//>
    <//>` },
    { name: 'entries', render: () => html`<${List} tone="entries">
      <${Row}><${Name} code desc="How to book a room in the Harbour Studio planner, and how to move a booking." after=${html` <${Mark}>v1.2.0<//>`}>sandbox/planner-guide<//><//>
      <${Row}><${Name} code desc=${LONG} after=${html` <${Mark}>v0.3.0<//>`}>sandbox/ferry-seats<//><//>
    <//>` },
    { name: 'log', render: () => html`<${List} tone="log" cols="when-kind-name-who">
      <${Row}><${When}>27 Sep 2026<//><${Cell} sign>declared<//><${Name}>Harbour Studio<//><${Who}>by sandbox<//><//>
      <${Row}><${When}>20 Sep 2026<//><${Cell} sign>cleared<//><${Name}>Lumo Bakery<//><${Who}>by invoice-drafter<//><//>
    <//>` },
    { name: 'pages', render: () => html`<${List} tone="pages" cols="name-doors">
      <${Row}><${Name} tag=${html`<${Mark} tone="heavy">Recommended<//>`} after=${html` <${Mark} kind="word" tone="ink">Markdown · 27 Sep 2026<//>`}
        desc="Say what the app keeps about the people who use it.">Privacy notice<//>
        <${Doors}><${Action} small onClick=${noop}>Edit<//><${Action} small onClick=${noop}>Remove<//><//><//>
      <${Row}><${Name} after=${html` <${Mark} kind="word">None<//>`} desc="The rules a person agrees to by using the app.">Terms of use<//>
        <${Doors}><${Action} small onClick=${noop}>Write<//><//><//>
    <//>` },
    { name: 'tree', render: () => html`<${List} tone="tree">
      <${Row} below=${html`<${List} tone="tree">
        <${Row}><${Name} attention tag=${html`<${Mark} kind="status" tone="fine">public<//>`} after=${html` <${Note} kind="meta" inline>20 Sep 2026<//>`}>↳ sandbox/planner.html ●<//><//>
        <${Row}><${Name} tag=${html`<${Mark} kind="status" tone="danger">deleted<//>`}>↳ bot/planner-copy.html<//><//>
      <//>`}><${Name} tag=${html`<${Mark} kind="status" tone="off">parked<//>`}>harbour/planner.html<//><//>
    <//>` },
    { name: 'empty', render: () => html`<${List} tone="history" empty="No versions yet.">${[]}<//>` },
  ] },
  modal: { height: 360, variants: [
    { name: 'normal leading, title reference', render: () => html`<${Modal} open onClose=${noop} leading="normal" title="Versions" titleRef="planner.html"
      footer=${html`<${Action} onClick=${noop}>Close<//>`}><${Note} kind="hint">Every version kept of the Harbour Studio planner.<//><//>` },
    { name: 'question at normal leading', render: () => html`<${ConfirmDialog} open onClose=${noop} onConfirm=${noop} leading="normal"
      title="Restore v3?" message="The working copy becomes v3. The versions after it stay." confirmLabel="Restore" cancelLabel="Cancel" />` },
    { name: 'long reference', render: () => html`<${Modal} open onClose=${noop} leading="normal" title="Source" titleRef="nordic-ferries-summer-timetable-seat-map.html">
      <${Note} kind="hint">${LONG}<//><//>` },
  ] },
};
