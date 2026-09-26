/**
 * @file public/views/design-lab/demos-list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the list of Settings & Controls (List), each drawn by calling the real component with sample data, in
 *   the page's scope root (.pf) as Settings & Controls draws it.
 * @structure LIST_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { LIST_DEMOS } from './demos-list.js';
 * @version-history
 *   v1.1.0 — 2026-09-27 — The List's demos: its cuts, tones, row states, marks, groups and what stands around it; the
 *     Listing, Search line, More line and Key demos moved here from demos-settings.js, drawn by calling the List.
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import { h } from 'preact';
import htm from 'htm';
import { SettingsRoot } from '/components/SettingsFrame.js';
import {
  List, Row, Name, Desc, Who, Num, When, Cell, Doors, Panel, Lead, Tick, Thumb, Found,
  Stats, Stat, Group, Filters, Filter, SearchLine, More,
} from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Figure } from '/components/Figure.js';
import { BoxList, BoxLine } from '/components/Box.js';

const html = htm.bind(h);
const noop = () => {};
const MENU = [{ label: 'Rename', onClick: noop }, { label: 'Delete', onClick: noop, danger: true }];

/** Two skills, one opened with its panel: the cut most Settings lists draw. */
const skills = (openFirst) => html`<${List} cols="name-desc-doors" head=${['Skill', 'What it teaches', '']}>
  <${Row} open=${openFirst} panel=${html`<p>The panel a row opens, in the raised box: what the skill says, its files, its versions.</p>`}
    panelDoors=${html`<${Action} small onClick=${noop}>Publish a new version<//>`}>
    <${Name} meta="v1.4.0 · sandbox" tag="public">aimeat-writing<//>
    <${Desc}>How prose is written on this project.<//>
    <${Doors} menu=${MENU} menuLabel="More for aimeat-writing"><${Action} small row onClick=${noop}>${openFirst ? 'Close' : 'Open'}<//><//>
  <//>
  <${Row}>
    <${Name} meta="v0.2.0 · bot">meeting-notes<//>
    <${Desc}>Short meeting notes, decisions first.<//>
    <${Doors}><${Action} small row onClick=${noop}>Open<//><//>
  <//>
<//>`;

export const LIST_DEMOS = {
  list: { variants: [
    { name: 'head, rows, one open with its panel', render: () => html`<${SettingsRoot}>${skills(true)}<//>` },
    { name: 'rows that open on a press; selected, faded, hover', render: () => html`<${SettingsRoot}><${List} cols="name-desc-doors">
      <${Row} onToggle=${noop} selected><${Name} meta="the one shown now">Harbour Studio<//><${Desc}>A design studio's shared memory.<//><${Doors}><${Action} small onClick=${noop}>Open<//><//><//>
      <${Row} onToggle=${noop} faded><${Name} meta="archived 2026-08-02">Old invoices<//><${Desc}>Last year's billing, kept for the record.<//><${Doors} /><//>
      <${Row} hover><${Name} meta="a row that opens nothing">claude-code<//><${Desc}>Connected over MCP.<//><${Doors} /><//>
    <//><//>` },
    { name: 'an opened record: its title, status, text and doors (Panel)', render: () => html`<${SettingsRoot}><${List} cols="name-doors" keepCols>
      <${Row} open onToggle=${noop}><${Name} meta="bot · today 06:00">Morning digest<//><${Doors}><${Action} small onClick=${noop}>Close<//><//>
        <${Panel} title="Morning digest" mark=${html`<${Mark} kind="status" tone="fine">done<//>`} text=${'Read every workspace I belong to.\nList the open questions first.'}
          doors=${html`<${Action} small onClick=${noop}>Run again<//>`} />
      <//>
    <//><//>` },
    { name: 'empty', render: () => html`<${SettingsRoot}><${List} cols="name-desc-doors" empty="No skills yet. Ask your AI to write one." rows=${[]} /><//>` },
    { name: 'loading', render: () => html`<${SettingsRoot}><${List} cols="name-desc-doors" loading /><//>` },
    { name: 'figures and times, with a head (keep columns)', render: () => html`<${SettingsRoot}><${List} cols="name-n-when" keepCols
        head=${['Device', { label: 'Sessions', num: true, title: 'Sessions signed in' }, 'Last used']}>
      <${Row}><${Name} meta="this device">Firefox on Windows<//><${Num}><${Figure} small n="3" /><//><${When} at="14.02">today<//><//>
      <${Row}><${Name}>Safari on iPhone<//><${Num} dim>1<//><${When} warn at="09.10">31 days ago<//><//>
    <//><//>` },
    { name: 'dense, under a row', render: () => html`<${SettingsRoot}><${List} cols="name-doors" keepCols>
      <${Row} below=${html`<${List} cols="name-desc-doors" dense under>
          <${Row}><${Name}>invoice-drafter<//><${Desc} sub="may read and write">studio/invoices<//><${Doors}><${Action} small onClick=${noop}>Revoke<//><//><//>
          <${Row}><${Name}>bot<//><${Desc} faint>·<//><${Doors} /><//>
        <//>`}>
        <${Name} meta="2 delegations">office@harbour.studio<//><${Doors}><${Action} small onClick=${noop}>Add<//><//>
      <//>
    <//><//>` },
    { name: 'small checklist (fine)', render: () => html`<${SettingsRoot}><${List} cols="mark-name" keepCols small>
      ${[['At least 12 characters', true], ['A number', true], ['A symbol', false]].map(([label, ok]) => html`<${Row} key=${label} fine=${ok}>
        <${Tick} bare state=${ok ? 'done' : 'off'} glyph=${ok ? '✓' : '○'} /><${Cell}>${label}<//><//>`)}
    <//><//>` },
    { name: 'scroll pick list (picked, pick off)', render: () => html`<${SettingsRoot}><${List} cols="check-name-desc" keepCols scroll>
      <${Row} picked onPick=${noop} pickLabel="Pick Lumo Bakery"><${Name} meta="lumo-bakery.html">Lumo Bakery<//><${Desc}>needs memory, files<//><//>
      <${Row} picked=${false} onPick=${noop} pickLabel="Pick Nordic Ferries"><${Name} meta="nordic-ferries.html">Nordic Ferries timetable<//><${Desc}>needs nothing<//><//>
      <${Row} picked onPick=${noop} pickOff pickLabel="Always on"><${Name} meta="always on">Read your profile<//><${Desc}>cannot be turned off<//><//>
    <//><//>` },
    { name: 'rails and colours', render: () => html`<${SettingsRoot}><${List} cols="mark-name-doors" keepCols>
      <${Row} rail="warn"><${Lead} text="HS" /><${Name} tag="draft">Seat map study<//><${Doors} /><//>
      <${Row} colour="blue"><${Lead} text="NF" /><${Name}>Nordic Ferries brief<//><${Doors} /><//>
      <${Row} colour="red" rail="warn"><${Lead} text="LB" /><${Name} tag="draft">Lumo Bakery menu<//><${Doors} /><//>
      <${Row}><${Lead} text="bot" agent /><${Name} meta="an agent">bot<//><${Doors} menu=${MENU} menuLabel="More for bot" /><//>
    <//><//>` },
    { name: 'drag to reorder (grip, dragging, drag over)', render: () => html`<${SettingsRoot}><${List} cols="name-doors" keepCols>
      <${Row} draggable grip="Drag to reorder" onDragStart=${noop} onDragOver=${noop} onDrop=${noop} onDragEnd=${noop}><${Name}>invoice-drafter<//><${Doors} /><//>
      <${Row} draggable grip="Drag to reorder" dragging onDragEnd=${noop}><${Name}>bot<//><${Doors} /><//>
      <${Row} draggable grip="Drag to reorder" dragOver onDrop=${noop}><${Name}>research-assistant<//><${Doors} /><//>
    <//><//>` },
    { name: 'the name: dot, unread, attention, key, code, desc, note, found', render: () => html`<${SettingsRoot}><${List} cols="name">
      <${Row}><${Name} dot="active" dotTitle="Active" after=${html` <${Mark} kind="status" tone="fine">running<//>`}>Morning digest<//><//>
      <${Row}><${Name} unread meta="bot · 10:42" note="Approved" noteTone="fine">The invoice for Nordic Ferries is ready<//><//>
      <${Row}><${Name} attention meta="last run failed" warn>Watch the feed<//><//>
      <${Row}><${Name} asKey onOpen=${noop} openLabel="Open the key">studio/clients/nordic-ferries<//><//>
      <${Row}><${Name} code meta="the id your AI calls it by">aimeat_skill_get<//><//>
      <${Row}><${Name} onOpen=${noop} desc="Drafts an invoice from the hours logged this month." note="Why it fits: you asked for billing.">Draft an <${Found}>invoice<//><//><//>
    <//><//>` },
    { name: 'ticks', render: () => html`<${SettingsRoot}><${List} cols="mark-name-meta" keepCols>
      ${['done', 'failed', 'active', 'pending', 'off', 'none'].map((s) => html`<${Row} key=${s} faded=${s === 'none'}><${Tick} state=${s} /><${Name} desc="The step's words.">A step that is ${s}<//><${Doors} /><//>`)}
    <//><//>` },
    { name: 'thumbnail, counts and a tag line', render: () => html`<${SettingsRoot}>
      <${List} cols="mark-name-doors"><${Row}><${Thumb} /><${Name} meta="published · 3 visits">Harbour Studio portfolio<//><${Doors}><${Action} small onClick=${noop}>Open<//><//><//><//>
      <${List} cols="mark-name-tags-stats-doors" keepCols><${Row}>
        <${Lead} text="HS" /><${Name} onOpen=${noop} meta="A small design studio.">Harbour Studio<//>
        <${Cell} line><${Mark} title="Organism">Organism<//><span title="Only members see it">private</span><//>
        <${Stats}><${Stat} icon="📁" title="Spaces">12<//><${Stat} icon="👥" title="People">4<//><${Stat} /><${Stat} date title="Created">2026-03-14<//><//>
        <${Doors} menu=${MENU} menuLabel="More for Harbour Studio"><${Action} small onClick=${noop}>Open<//><//>
      <//><//><//>` },
    { name: 'a group with a count and a fold', render: () => html`<${SettingsRoot}><${List} cols="name-desc-doors">
      <${Group} title="Writing" count=${2} onFold=${noop} folded=${false} foldLabel="Fold the group" doors=${html`<${Action} small soft onClick=${noop}>Clear<//>`}>
        <${Row}><${Name}>aimeat-writing<//><${Desc}>How prose is written.<//><${Doors} /><//>
        <${Row}><${Name}>meeting-notes<//><${Desc}>Decisions first.<//><${Doors} /><//>
      <//>
      <${Group} title="Folded" count=${5} onFold=${noop} folded wholeHead foldLabel="Open the group" />
      <${Group} quiet title="A quiet heading" />
    <//><//>` },
    { name: 'filters, search line and more around a list', render: () => html`<${SettingsRoot}>
      <${Filters} label="Show">
        <${Filter} on count=${12} onClick=${noop}>All<//><${Filter} count=${3} onClick=${noop}>Mine<//>
        <${Filter} attention count=${1} onClick=${noop}>Needs a look<//><${Filter} end onClick=${noop}>Events only<//>
      <//>
      <${SearchLine} value="invoice" onInput=${noop} onEnter=${noop} onClear=${noop} clearLabel="Clear" placeholder="Find a skill" note="2 of 12" />
      ${skills(false)}
      <${More} label="Show 10 more" onMore=${noop} note="2 of 12" wrap><${Action} small onClick=${noop}>Copy the list<//><//>
    <//>` },
    { name: 'a long name that wraps', render: () => html`<${SettingsRoot}><${List} cols="name-desc-doors">
      <${Row}><${Name} meta="studio/clients/nordic-ferries/2026/timetable-changes-for-the-winter-season" clip>The Nordic Ferries winter timetable, with every change to the morning and evening boats<//>
        <${Desc} lines=${2}>A long description that runs on and on, so that on a narrow screen it keeps only its first two lines in the row and the opened panel shows the rest of it.<//>
        <${Doors}><${Loud} control onClick=${noop}>Open<//><//><//>
    <//><//>` },
  ] },
  listing: { variants: [
    { name: 'head, rows, one open (the List draws it)', render: () => html`<${SettingsRoot}>${skills(true)}<//>` },
    { name: 'who, words and doors, keeping columns', render: () => html`<${SettingsRoot}><${List} cols="name-who-desc-doors" keepCols head=${['Package', 'Whose', 'What it holds', '']}>
      <${Row}><${Name} meta="v2">Harbour brand kit<//><${Who} sub="shared">sandbox<//><${Desc} sub="3 parts">Colours, fonts and the logo.<//><${Doors}><${Action} small onClick=${noop}>Install<//><//><//>
    <//><//>` },
    { name: 'meta, outside a row', render: () => html`<${SettingsRoot}><${BoxList}><${BoxLine} name="Harbour Studio" meta="an organism's board · 12 notices" /><//><//>` },
  ] },
  'search-line': { variants: [
    { name: 'with a count (the List\'s SearchLine)', render: () => html`<${SettingsRoot}><${SearchLine} value="" onInput=${noop} placeholder="Find a skill" note="12 of 40" /><//>` },
    { name: 'with text, the clear mark and a button', render: () => html`<${SettingsRoot}><${SearchLine} text value="ferries" onInput=${noop} onEnter=${noop} onClear=${noop} clearLabel="Clear" placeholder="Ask about the offers">
      <${Action} small onClick=${noop}>Search<//><//><//>` },
    { name: 'two side by side', render: () => html`<${SettingsRoot}><${Actions}><${SearchLine} beside value="" onInput=${noop} placeholder="Find a key" /><${SearchLine} beside value="" onInput=${noop} placeholder="Filter by prefix" /><//><//>` },
  ] },
  'more-line': { variants: [
    { name: 'default (the List\'s More)', render: () => html`<${SettingsRoot}><${More} label="Show 20 more" onMore=${noop} note="20 of 55" /><//>` },
    { name: 'all shown', render: () => html`<${SettingsRoot}><${More} note="5 of 5" /><//>` },
    { name: 'with more doors, wrapping', render: () => html`<${SettingsRoot}><${More} label="Show 20 more" onMore=${noop} note="20 of 55" wrap><${Action} small onClick=${noop}>Copy the list<//><${Action} small onClick=${noop}>Download as CSV<//><//><//>` },
  ] },
  'key-name': { variants: [
    { name: 'a key as a row\'s name (Name asKey)', render: () => html`<${SettingsRoot}><${List} cols="key-doors" keepCols>
      <${Row}><${Name} asKey>studio/clients/nordic-ferries<//><${Doors}><${Action} small tone="quiet" onClick=${noop}>Stop sharing<//><//><//>
      <${Row}><${Name} asKey onOpen=${noop} openLabel="Open studio/prices/day-rate">studio/prices/day-rate<//><${Doors} /><//>
    <//><//>` },
  ] },
};
