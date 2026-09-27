/**
 * @file public/views/design-lab/demos-list.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the list of Settings & Controls (List), each drawn by calling the real component with sample data, in
 *   the page's scope root (.pf) as Settings & Controls draws it.
 * @structure LIST_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { LIST_DEMOS } from './demos-list.js';
 * @version-history
 *   v1.3.0 — 2026-09-27 — What appcat added, in the app catalogue's frame (IndexFrame dense): List index with Row
 *     order, SearchLine big, the nine List tones, and the catalogue's listing cuts.
 *   v1.2.0 — 2026-09-27 — What the admin pages added, in the operator's frame: labels, a sorted head, Name
 *     marks, the menu's divider, quietDoors on a list that stacks wide, the notice rail, a followed link, SearchLine find.
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
import { Action, Loud, Actions, Icon } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Figure, Tinted } from '/components/Figure.js';
import { BoxList, BoxLine } from '/components/Box.js';
import { OperatorFrame } from '/components/OperatorFrame.js';
import { Note } from '/components/Note.js';
import { Tabs } from '/components/Tabs.js';
import { IndexFrame } from '/components/IndexFrame.js';

const html = htm.bind(h);
const noop = () => {};
const MENU = [{ label: 'Rename', onClick: noop }, { label: 'Delete', onClick: noop, danger: true }];
const APP_MENU = [{ label: 'Open', onClick: noop }, { label: 'Scan', onClick: noop }, { divider: true }, { label: 'Delete', onClick: noop, danger: true }];
/** A part of an admin page, in the operator's frame as the page draws it. */
const op = (title, part) => html`<${OperatorFrame} title=${title}>${part}<//>`;
/** A part of the app catalogue (appcat), in its frame's reading as the page draws it. */
const cat = (part) => html`<${IndexFrame} dense>${part}<//>`;

/** Three apps of the catalogue's index; the first opened with its line of doors. */
const APPS = [
  { name: 'Lumo Bakery', icon: 'LB', meta: 'by sandbox · Sep 20', desc: 'Orders for the morning bake, and what is left at noon.', state: 'published', opens: '1,204' },
  { name: 'Nordic Ferries timetable', icon: 'NF', meta: 'by second · Sep 12', desc: 'The winter timetable with every change to the morning and evening boats.', state: 'published', opens: '88' },
  { name: 'Harbour Studio portfolio', icon: 'HS', meta: 'v2 · unlisted', desc: 'The studio\'s work, one page per client.', state: 'unlisted', opens: '12', parked: true },
];
const appIndex = () => html`<${List} cols="n-mark-name-desc-state-n-arrow" index>
  ${APPS.map((a, i) => html`<${Row} key=${a.name} order=${i} open=${i === 0} onToggle=${noop} faded=${!!a.parked}>
    <${Cell} sign>${String(i + 1).padStart(2, '0')}<//>
    <${Lead} text=${a.icon} />
    <${Name} meta=${a.meta}>${a.name}<//>
    <${Desc} clip>${a.desc}<//>
    <${Cell}>${a.state}<//>
    <${Num}>${a.opens}<//>
    <${Cell}>${i === 0 ? '↓' : '→'}<//>
    ${i === 0 ? html`<${Panel}><${Actions}><${Loud} onClick=${noop}>Open<//><${Action} onClick=${noop}>Details<//><//><${Note} kind="hint">Published v4 on Sep 20, 2026<//><//>` : null}
  <//>`)}
<//>`;
/** The catalogue's one search, its order row at its foot. */
const bigSearch = () => html`<${SearchLine} big text id="design-lab-cat-search" value="" onInput=${noop} placeholder="Search the apps" label="Search the apps">
  <${Tabs} tone="line" caption="Order" label="Order" value="newest" onSelect=${noop} items=${[
    { value: 'newest', label: 'Newest' }, { value: 'opens', label: 'Most opened' }, { value: 'name', label: 'Name' },
  ]} />
<//>`;
const current = () => html`<${Mark} tone="sun">current<//>`;

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
    // What the admin pages added (2026-09-27), drawn in the operator's frame as those pages draw it.
    { name: 'an operator table: labels, a sorted head, marks, a menu with a divider', render: () => op('Applications', html`<${List} cols="name-who-n-n-n-when-doors" labels
        head=${[{ label: 'Application', onSort: noop, sorted: true }, { label: 'Owner', onSort: noop }, { label: 'Visits', num: true, onSort: noop },
          { label: 'Visitors', num: true }, { label: 'Size', num: true }, 'Published', '']}>
      <${Row}><${Name} meta="lumo-bakery.apps.aimeat.io" marks=${['app', 'public']}>Lumo Bakery<//><${Who}>sandbox<//>
        <${Num}>1,204<//><${Num}>310<//><${Num} dim>48 KB<//><${When} at="09:14">today<//><${Doors} menu=${APP_MENU} menuLabel="More for Lumo Bakery" /><//>
      <${Row}><${Name} meta="nordic-ferries.apps.aimeat.io" marks=${['app']}>Nordic Ferries timetable<//><${Who}>second<//>
        <${Num}>88<//><${Num}>40<//><${Num} dim>12 KB<//><${When}>Sep 20<//><${Doors} menu=${APP_MENU} menuLabel="More for Nordic Ferries timetable" /><//>
    <//>`) },
    { name: 'quiet doors on a list that stacks wide', render: () => op('Owners', html`<${List} cols="n-name-n-when-doors" labels stackWide
        head=${['#', 'Owner', { label: 'Records', num: true }, 'Last seen', '']}>
      <${Row} quietDoors><${Num} dim>01<//><${Name} meta="sandbox@aimeat-local-001-dev">sandbox<//><${Num}>1,204<//><${When}>today<//>
        <${Doors}><${Action} small row onClick=${noop}>Open<//><${Action} small row tone="danger" onClick=${noop}>Disable<//><//><//>
      <${Row} quietDoors selected><${Num} dim>02<//><${Name} meta="second@aimeat-local-001-dev">second<//><${Num}>312<//><${When}>yesterday<//>
        <${Doors}><${Action} small row onClick=${noop}>Open<//><${Action} small row tone="danger" onClick=${noop}>Disable<//><//><//>
    <//>`) },
    { name: 'a notice rail and a name that opens in place', render: () => op('Work', html`<${List} cols="name-desc-doors">
      <${Row} rail="notice"><${Name} meta="past its deadline by 2 days" warn>Draft the Lumo Bakery invoice<//><${Desc}>invoice-drafter · due Sep 25<//><${Doors} /><//>
      <${Row} hover><${Name} href="#" onFollow=${(e) => e.preventDefault()} meta="bot#sandbox@aimeat-local-001-dev">bot<//><${Desc}>Opens here; the address stays for a new tab.<//><${Doors} /><//>
    <//>`) },
    // What appcat added (2026-09-27), drawn in the app catalogue's frame as its page draws it.
    { name: 'index: the app catalogue\'s rows, coming in by their order, the first opened', render: () => cat(appIndex()) },
    { name: 'big search with its order row (SearchLine big, id)', render: () => cat(bigSearch()) },
    { name: 'tone history: the versions of an app', render: () => cat(html`<${List} tone="history">
      <${Row}><${Name} meta="48.2 KB · Sep 20, 2026 09:14" tag=${current()}>v4 <//><${Doors}><${Action} small row onClick=${noop}>View<//><${Action} small row onClick=${noop}>Fork<//><//><//>
      <${Row}><${Name} meta="47.9 KB · Sep 12, 2026 16:40 · 8 days before">v3<//><${Doors}><${Action} small row onClick=${noop}>View<//><${Action} small row onClick=${noop}>Restore<//><${Action} small row onClick=${noop}>Fork<//><//><//>
    <//>`) },
    { name: 'tone switches: a setting per row', render: () => cat(html`<${List} tone="switches" cols="name-meaning-doors">
      <${Row}><${Name}>Badge<//><${Desc}>The page shows that Lumo Bakery was made on this node.<//><${Doors}><${Action} small onClick=${noop}>Turn off<//><//><//>
      <${Row}><${Name}>Install button<//><${Desc}>Nobody can install the app from its page.<//><${Doors}><${Loud} control onClick=${noop}>Turn on<//><//><//>
    <//>`) },
    { name: 'tone counts: a small table of counts', render: () => cat(html`<${List} tone="counts" head=${['AI', { label: 'Asked', num: true }, { label: 'Crawled', num: true }]}>
      <${Row}><${Name}>ChatGPT<//><${Num}>12<//><${Num}>3<//><//>
      <${Row}><${Name}>Claude<//><${Num}>8<//><${Num}>0<//><//>
      <${Row}><${Name}>Perplexity<//><${Num}>2<//><${Num}>5<//><//>
    <//>`) },
    { name: 'tone entries: the skills of an app', render: () => cat(html`<${List} tone="entries">
      <${Row}><${Name} code desc="How prose is written on this project: the tells that give a text away and how to remove them." after=${html` <${Mark}>v1.4.0<//>`}>sandbox/aimeat-writing<//><//>
      <${Row}><${Name} code desc="Short meeting notes, decisions first." after=${html` <${Mark}>v0.2.0<//> <${Icon} label="Detach meeting-notes" onClick=${noop}>×<//>`}>sandbox/meeting-notes<//><//>
    <//>`) },
    { name: 'tone log: what was done, newest first', render: () => cat(html`<${List} tone="log" cols="when-name-who">
      <${Row}><${When}>Sep 20, 2026<//><${Name}>Published v4<//><${Who}>sandbox<//><//>
      <${Row}><${When}>Sep 12, 2026<//><${Name}>Turned the badge on for the Lumo Bakery page, which every visitor now sees<//><${Who}>sandbox<//><//>
    <//>`) },
    { name: 'tone pages: the legal pages, one editor open', render: () => cat(html`<${List} tone="pages" cols="name-doors">
      <${Row}><${Name} tag=${html`<${Mark} tone="heavy">recommended<//>`} after=${html` <${Mark} kind="word" tone="ink">Markdown · Sep 20, 2026<//>`}
          desc="Tells visitors what the app does with what they type.">Privacy policy<//>
        <${Doors}><${Action} small onClick=${noop}>Edit<//><${Action} small onClick=${noop}>Remove<//><//><//>
      <${Row} below=${html`<${Note} kind="hint">The editor of the terms opens here, under the row.<//>`}>
        <${Name} after=${html` <${Mark} kind="word" tone="notice">missing<//>`} desc="The rules a person agrees to by using the app.">Terms of use<//><${Doors} /><//>
    <//>`) },
    { name: 'tone releases: every version kept, in a dialog', render: () => cat(html`<${List} tone="releases">
      <${Row}><${Name} meta="1.4.0 · 48.2 KB · Sep 20, 2026 09:14" tag=${current()}>v4<//><${Doors}><${Action} small row onClick=${noop}>View<//><${Action} small row onClick=${noop}>Fork<//><//><//>
      <${Row}><${Name} meta="1.3.2 · 47.9 KB · Sep 12, 2026 16:40">v3<//><${Doors}><${Action} small row onClick=${noop}>View<//><${Action} small row onClick=${noop}>Restore<//><${Action} small row onClick=${noop}>Fork<//><//><//>
    <//>`) },
    { name: 'tone tree: the forks of an app', render: () => cat(html`<${List} tone="tree">
      <${Row} below=${html`<${List} tone="tree">
          <${Row}><${Name} attention tag=${html`<${Mark} kind="status" tone="fine">public<//>`} after=${html` <${Note} kind="meta" inline>Sep 14, 2026<//>`}>↳ second/lumo-bakery.html ●<//><//>
          <${Row}><${Name} tag=${html`<${Mark} kind="status" tone="off">parked<//>`} after=${html` <${Note} kind="meta" inline>Sep 18, 2026<//>`}>↳ bot/lumo-bakery-test.html<//><//>
        <//>`}>
        <${Name} tag=${html`<${Mark} kind="status" tone="fine">public<//>`}>sandbox/lumo-bakery.html<//>
      <//>
    <//>`) },
    { name: 'tone checkpoints: the saves of a working copy', render: () => cat(html`<${List} tone="checkpoints">
      <${Row}><${Name} meta="Before: the new price list · 48.2 KB">Sep 26, 2026 14:02<//>
        <${Doors}><${Action} small row onClick=${noop}>Preview<//><${Loud} control onClick=${noop}>Restore<//><${Action} small row onClick=${noop}>Delete<//><//><//>
      <${Row}><${Name} meta="Before an unnamed change · 47.1 KB">Sep 25, 2026 17:48<//>
        <${Doors}><${Action} small row onClick=${noop}>Preview<//><${Loud} control onClick=${noop}>Restore<//><${Action} small row onClick=${noop}>Delete<//><//><//>
    <//>`) },
  ] },
  listing: { variants: [
    { name: 'head, rows, one open (the List draws it)', render: () => html`<${SettingsRoot}>${skills(true)}<//>` },
    { name: 'who, words and doors, keeping columns', render: () => html`<${SettingsRoot}><${List} cols="name-who-desc-doors" keepCols head=${['Package', 'Whose', 'What it holds', '']}>
      <${Row}><${Name} meta="v2">Harbour brand kit<//><${Who} sub="shared">sandbox<//><${Desc} sub="3 parts">Colours, fonts and the logo.<//><${Doors}><${Action} small onClick=${noop}>Install<//><//><//>
    <//><//>` },
    { name: 'meta, outside a row', render: () => html`<${SettingsRoot}><${BoxList}><${BoxLine} name="Harbour Studio" meta="an organism's board · 12 notices" /><//><//>` },
    { name: 'an operator cut (n-name-state, keeping columns)', render: () => op('Organisation sign-in', html`<${List} cols="n-name-state" keepCols head=${['#', 'Step', 'State']}>
      <${Row}><${Num} dim>1<//><${Name} desc="The tenant id of Harbour Studio's Entra directory.">Name the tenant<//><${Cell}><${Mark} kind="status" tone="fine">done<//><//><//>
      <${Row}><${Num} dim>2<//><${Name} desc="Who may register: the tenant's people, or also the partners you approve.">Choose who may register<//><${Cell}><${Mark} kind="status" tone="attention">open<//><//><//>
    <//>`) },
    // The app catalogue's cuts (appcat, 2026-09-27), each drawn plainly by its cut, in the catalogue's frame.
    { name: 'app index (n-mark-name-desc-state-n-arrow, List index)', render: () => cat(appIndex()) },
    { name: 'switch rows (name-meaning-doors)', render: () => cat(html`<${List} cols="name-meaning-doors">
      <${Row}><${Name}>Badge<//><${Desc}>The page shows that Lumo Bakery was made on this node.<//><${Doors}><${Action} small onClick=${noop}>Turn off<//><//><//>
      <${Row}><${Name}>Install button<//><${Desc}>Nobody can install the app from its page.<//><${Doors}><${Action} small onClick=${noop}>Turn on<//><//><//>
    <//>`) },
    { name: 'data map keys (key-desc-who)', render: () => cat(html`<${List} cols="key-desc-who" head=${['Key', 'What it holds', 'Where']}>
      <${Row}><${Name} asKey>lumo/orders/today<//><${Desc}>The orders for the morning bake.<//><${Who}>your memory<//><//>
      <${Row}><${Name} asKey>lumo/prices<//><${Desc}>The price list the page shows.<//><${Who}>public<//><//>
    <//>`) },
    { name: 'count per place (name-n)', render: () => cat(html`<${List} cols="name-n" head=${['Country', { label: 'People', num: true }]}>
      <${Row}><${Name}>Finland<//><${Num}>120<//><//>
      <${Row}><${Name}>Sweden<//><${Num}>44<//><//>
    <//>`) },
    { name: 'audit log (when-name-who)', render: () => cat(html`<${List} cols="when-name-who">
      <${Row}><${When}>Sep 20, 2026<//><${Name}>Published v4<//><${Who}>sandbox<//><//>
      <${Row}><${When}>Sep 12, 2026<//><${Name}>Turned the badge on<//><${Who}>sandbox<//><//>
    <//>`) },
    { name: 'declarations log (when-kind-name-who)', render: () => cat(html`<${List} cols="when-kind-name-who">
      <${Row}><${When}>Sep 21, 2026<//><${Cell} sign>declared<//><${Name}>Harbour Studio<//><${Who}>by sandbox<//><//>
      <${Row}><${When}>Sep 02, 2026<//><${Cell} sign>cleared<//><${Name}>sandbox<//><${Who}>by sandbox<//><//>
    <//>`) },
    { name: 'tool for sale (name-price-delivery-doors), one not listed', render: () => cat(html`<${Note} kind="lead" chapter>Tools other apps and agents can buy from this app.<//>
      <${List} cols="name-price-delivery-doors">
        <${Row}><${Name} desc="Drafts an invoice from the hours logged this month.">draft_invoice<//>
          <${Cell}><${Label} block>Price<//>12 morsels a call <${Tinted} tone="fine">in EXCHANGE<//><//>
          <${Cell}><${Label} block>Called at once<//><${Note} kind="meta" inline mono>invoice.draft<//><//>
          <${Doors}><${Action} small onClick=${noop}>Edit details<//><${Action} small tone="danger" title="Delete the tool" onClick=${noop}>✕<//><//><//>
        <${Row} below="⚠ It needs a description before it can be listed.">
          <${Name}>check_timetable<//>
          <${Cell}><${Label} block>Price<//>free<//>
          <${Cell}><${Label} block>A task for the owner<//><${Note} kind="meta" inline mono>→ invoice-drafter<//><//>
          <${Doors}><${Action} small onClick=${noop}>Edit details<//><//><//>
      <//>`) },
    { name: 'contract (name-price-rake-budget-state)', render: () => cat(html`<${List} cols="name-price-rake-budget-state">
      <${Row}><${Name} meta="Provider: harbour">image.resize<//>
        <${Cell}><${Label} block>Price<//>3 morsels<//><${Cell}><${Label} block>Rake<//>0.3 (10%)<//>
        <${Cell}><${Label} block>Budget<//>42 / 100 <${Label}>(58 left)<//><//>
        <${Cell}><${Note} kind="state" size="small" mono tone="fine">active<//><//><//>
      <${Row}><${Name} meta="Provider: nordic">timetable.lookup<//>
        <${Cell}><${Label} block>Price<//>1 morsel<//><${Cell}><${Label} block>Rake<//>0.1 (10%)<//>
        <${Cell}><${Label} block>Budget<//>uncapped<//>
        <${Cell}><${Note} kind="state" size="small" mono tone="attention">paused<//><//><//>
    <//>`) },
  ] },
  'search-line': { variants: [
    { name: 'with a count (the List\'s SearchLine)', render: () => html`<${SettingsRoot}><${SearchLine} value="" onInput=${noop} placeholder="Find a skill" note="12 of 40" /><//>` },
    { name: 'with text, the clear mark and a button', render: () => html`<${SettingsRoot}><${SearchLine} text value="ferries" onInput=${noop} onEnter=${noop} onClear=${noop} clearLabel="Clear" placeholder="Ask about the offers">
      <${Action} small onClick=${noop}>Search<//><//><//>` },
    { name: 'two side by side', render: () => html`<${SettingsRoot}><${Actions}><${SearchLine} beside value="" onInput=${noop} placeholder="Find a key" /><${SearchLine} beside value="" onInput=${noop} placeholder="Filter by prefix" /><//><//>` },
    { name: 'find: the magnifier (an operator page)', render: () => op('Cortex', html`<${SearchLine} find text value="ferries" onInput=${noop} placeholder="Find a cortex" note="2 of 14" />`) },
    { name: 'big: the page\'s one search with its order row (the app catalogue)', render: () => cat(bigSearch()) },
    { name: 'big, with words typed', render: () => cat(html`<${SearchLine} big text value="ferries timetable winter" onInput=${noop} placeholder="Search the apps" />`) },
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
