/**
 * @file public/views/design-lab/demos-operator.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the parts the admin pages and the small inner pages brought when they
 *   moved onto components, each drawn by calling the real component with sample data. A part of an
 *   admin page stands in the operator frame's page (OperatorFrame, no menu), as the admin draws it;
 *   a part of the inner pages stands bare, as its page draws it.
 * @structure OPERATOR_DEMOS — { [id]: { variants: [{ name, render() }] } } · admin(title, part) · menu(active)
 * @usage import { OPERATOR_DEMOS } from './demos-operator.js';
 * @version-history
 *   v1.1.0 — 2026-09-27 — The demos of the operator family: readings, operator-menu, operator-frame,
 *     ask-page, solo-window, quick-find, pick-field, status-page-preview, search-preview, save-bar,
 *     move-buttons, day-chart, trend-line, count-bars, print-page, settings-index and shots; own-aimeat
 *     moved here from demos-shared.js, drawn by calling OwnAimeat (the catalogue pass).
 *   v1.0.0 — 2026-09-27 — Initial (the admin dashboard on components, the catalogue pass).
 */
import { h } from 'preact';
import htm from 'htm';
import { Reading, Readings, Verdict } from '/components/Readings.js';
import { OperatorMenu } from '/components/OperatorMenu.js';
import { OperatorFrame } from '/components/OperatorFrame.js';
import { AskPage } from '/components/AskPage.js';
import { SoloWindow } from '/components/SoloWindow.js';
import { QuickFind } from '/components/QuickFind.js';
import { OwnAimeat } from '/components/OwnAimeat.js';
import { PickField } from '/components/PickField.js';
import { StatusPagePreview } from '/components/StatusPagePreview.js';
import { SearchResult, ShareCard, SearchCard } from '/components/SearchPreview.js';
import { SaveBar } from '/components/SaveBar.js';
import { MoveButtons } from '/components/MoveButtons.js';
import { DayChart, DaySpark } from '/components/DayChart.js';
import { TrendLine } from '/components/TrendLine.js';
import { CountBars, CountBarsSet } from '/components/CountBars.js';
import { PrintPage, ScreenOnly, PrintOnly, PrintHead, PrintHeading, PrintEntry, PrintList } from '/components/PrintPage.js';
import { SettingsIndex, SettingLine, ChangeList } from '/components/SettingsIndex.js';
import { Shots } from '/components/Shots.js';
import { Mark } from '/components/Mark.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { Section } from '/components/Section.js';
import { TextField } from '/components/TextField.js';
import { Tinted } from '/components/Figure.js';

const html = htm.bind(h);
const noop = () => {};

/** A part of an admin page, in the operator frame's page as the admin draws it. */
const admin = (title, part) => html`<${OperatorFrame} title=${title}>${part}<//>`;

const LONG = 'A name long enough to wrap on a phone, because the operator named this measured thing in full';

const status = (tone, word) => html`<${Mark} kind="status" tone=${tone}>${word}<//>`;

const READINGS = [
  { key: 'burn', name: 'Burn to mint ratio', why: 'How many morsels are used for each one made.', mark: status('fine', 'healthy'), value: '0.42 · under 1.5' },
  { key: 'churn', name: 'Agent churn, 30 days', why: 'Agents that stopped coming back.', mark: status('attention', 'watch'), value: '18% · under 15%' },
  { key: 'expiry', name: 'Work that expired, 30 days', why: 'Offers nobody took before their deadline.', mark: status('danger', 'danger'), value: '31% · under 20%', last: true },
];

/** The operator menu with the groups of main's admin, cut short. */
const menu = (active) => html`<${OperatorMenu} title="Operator menu" nodeId="aimeat-local-001-dev" active=${active} onPick=${noop}
  groups=${[
    { key: 'node', title: 'Node', items: [{ id: 'overview', label: 'Overview' }, { id: 'config', label: 'Configuration' }, { id: 'security', label: 'Security' }] },
    { key: 'identity', title: 'Identity', items: [{ id: 'owners', label: 'Owners', count: 3 }, { id: 'agents', label: 'Agents', count: 12 }, { id: 'ghii', label: 'Identities', count: 0 }] },
    { key: 'data', title: 'Data', items: [{ id: 'boards', label: 'Boards', count: 57 }, { id: 'apps', label: 'Applications' }] },
  ]} />`;

const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
const READS = [310, 412, 280, 390, 455, 120, 364];
const WRITES = [40, 55, 38, 61, 47, 12, 50];

const PLACES = [
  { key: 'orgs', label: 'Organisms', items: [
    { key: 'nf', mark: '🏢', label: 'Nordic Ferries', sub: 'organism · 4 members' },
    { key: 'hs', mark: '🏢', label: 'Harbour Studio', sub: 'organism · 2 members' },
  ] },
  { key: 'docs', label: 'Documents', items: [
    { key: 'sm', mark: '📄', label:'Seat map for the new ferry', sub: 'Nordic Ferries · Planning', snippet: '…the new seat map goes out on Friday…' },
  ] },
];

const AGENTS = [
  { id: 'bot', name: 'bot', sub: 'sandbox · last seen today' },
  { id: 'invoice-drafter', name: 'invoice-drafter', sub: 'sandbox · last seen yesterday' },
  { id: 'lumo-orders', name: 'lumo-orders', sub: 'Lumo Bakery', disabled: true },
];

const INDEX = [
  { key: 'ai', label: 'AI', items: [{ key: 'ai-models', label: 'Models', count: 4, onClick: noop }, { key: 'ai-limits', label: 'Limits', count: 3, onClick: noop }] },
  { key: 'mail', label: 'Email', items: [{ key: 'mail-out', label: 'Sending', count: 5, onClick: noop }] },
];

const settingsBody = (edited) => html`
  <${Section} id="cfg-ai-models" title="Models" count="4 settings">
    <${SettingLine} name="Default model" code="ai.model" desc="The model a request uses when it names none."
      flag=${edited ? '●' : null} flagTitle="Edited, not saved" source=${status('fine', 'env')}
      editor=${html`<${TextField} value=${edited ? 'claude-opus-5-5' : 'claude-sonnet-5'} onInput=${noop} ariaLabel="Default model" />`}
      end=${html`<${Action} small onClick=${noop}>Reset<//>`} />
    <${SettingLine} name="Monthly spend cap" code="ai.spendCapUsd" desc="The node stops paid requests when the month reaches it."
      source=${status('off', 'default')} editor=${html`<${TextField} value="50" onInput=${noop} ariaLabel="Monthly spend cap" />`} />
  <//>`;

const COMPLIANCE_ENTRY = {
  title: 'Customer accounts', tag: 'personal data',
  desc: 'The accounts of the people who order from Lumo Bakery.',
  fields: [{ key: 'basis', label: 'Legal basis:', value: 'contract' }, { key: 'kept', label: 'Kept:', value: ['name', 'email', 'orders'] }, { key: 'none', label: 'Shared with:', value: '' }],
  answers: [
    { key: 'q1', question: 'Is the data kept inside the EU?', answer: 'Yes', source: 'hosting contract' },
    { key: 'q2', question: 'Who can read it?', answer: '' },
  ],
  reasons: ['Orders cannot be delivered without an address.', 'Invoices are kept for six years by law.'],
  reasonsLabel: 'Why it is kept',
  emptyAnswer: 'not answered',
};

export const OPERATOR_DEMOS = {
  readings: { variants: [
    { name: 'verdict with readings', render: () => admin('Overview', html`
      <${Verdict} word="watch" tone="watch" line="1 alert needs a look." stamp="Uptime: 4d 2h · Storage: postgres-kysely"
        doors=${html`<${Action} small onClick=${noop}>Open the alerts<//>`}>
        <${Readings} rows=${READINGS} />
      <//>`) },
    { name: 'danger', render: () => admin('Overview', html`<${Verdict} word="danger" tone="danger" line="3 alerts need a look." stamp="Uptime: 12m"><${Readings} rows=${READINGS.slice(2)} /><//>`) },
    { name: 'quiet, with a label', render: () => admin('Boards', html`<${Verdict} label="Boards" word="57" tone="quiet" line="No board waits for a look."><${Readings} rows=${[{ key: 'posts', name: 'Posts this week', value: '214', last: true }]} /><//>`) },
    { name: 'two columns, controls at the end', render: () => admin('Configuration', html`
      <${Reading} name="Registration" why="Who may make an account on this node." end=${html`<${Action} small onClick=${noop}>Change<//>`} />
      <${Reading} name="Storage" value="postgres-kysely" last />`) },
    { name: 'long', render: () => admin('Overview', html`<${Readings} rows=${[{ key: 'l', name: LONG, why: 'A why line that is also long enough to wrap onto a second line on a narrow screen.', mark: status('attention', 'watch'), value: 'aimeat-local-001-dev:a-very-long-machine-reading-that-breaks-anywhere', last: true }]} />`) },
  ] },

  'operator-menu': { height: 560, variants: [
    { name: 'the frame with its menu', render: () => html`<${OperatorFrame} menu=${menu('overview')} title="Overview" onRefresh=${noop} refreshLabel="Refresh" time=${Date.now()}>
      <${Readings} rows=${READINGS} /><//>` },
    { name: 'an item with a count chosen', render: () => html`<${OperatorFrame} menu=${menu('agents')} title="Agents"><${Note} kind="quiet">12 agents.<//><//>` },
  ] },

  'operator-frame': { height: 560, variants: [
    { name: 'open', render: () => html`<${OperatorFrame} menu=${menu('overview')} title="Overview" onRefresh=${noop}
      refreshLabel="Refresh" busyLabel="Loading…" time=${Date.now()}><${Readings} rows=${READINGS} /><//>` },
    { name: 'reading again', render: () => html`<${OperatorFrame} menu=${menu('overview')} title="Overview" onRefresh=${noop} refreshing
      refreshLabel="Refresh" busyLabel="Loading…" time=${Date.now()}><${Note} kind="loading">Loading…<//><//>` },
    { name: 'not signed in', render: () => html`<${OperatorFrame} shut=${{ title: 'AIMEAT Dashboard', text: 'Login to access the admin dashboard', note: 'Sign in with an operator account to access the dashboard.' }} />` },
    { name: 'not an operator', render: () => html`<${OperatorFrame} shut=${{ title: 'Access Denied', text: 'You need the operator role to access the admin dashboard.' }} />` },
    { name: 'long title', render: () => html`<${OperatorFrame} menu=${menu('config')} title=${LONG} onRefresh=${noop} refreshLabel="Refresh" time=${Date.now()}><${Note} kind="quiet">The page.<//><//>` },
  ] },

  'ask-page': { variants: [
    { name: 'asking', render: () => html`<${AskPage} title="Lumo Bakery wants to read your recipes"
      who=${{ name: 'Lumo Bakery', meta: 'lumo-bakery.apps.aimeat.io', text: 'L', mark: status('fine', 'verified') }}
      tag=${html`<${Mark} tone="sun">app<//>`}
      doors=${html`<${Action} onClick=${noop}>Not now<//><${Loud} onClick=${noop}>Allow<//>`}>
      <${Note} kind="lead">It may read the documents in your Recipes workspace. It cannot change them.<//>
    <//>` },
    { name: 'with other ways in', render: () => html`<${AskPage} title="Join Nordic Ferries"
      who=${{ name: 'sandbox', meta: 'sandbox@aimeat-local-001-dev', text: 'S' }}
      doors=${html`<${Action} onClick=${noop}>Decline<//><${Loud} onClick=${noop}>Join<//>`}
      or="or" ways=${html`<${Action} small onClick=${noop}>Sign in with another account<//>`}>
      <${Note} kind="lead">You are invited as a member. You see the shared workspaces.<//>
    <//>` },
    { name: 'waiting', render: () => html`<${AskPage} message="Loading…" />` },
    { name: 'long', render: () => html`<${AskPage} title=${LONG}
      who=${{ name: 'Harbour Studio sound design for ferries and harbours', meta: 'harbour-studio-sound-design.apps.aimeat.io', text: 'H' }}
      doors=${html`<${Action} onClick=${noop}>Not now<//><${Loud} onClick=${noop}>Allow<//>`} />` },
  ] },

  'solo-window': { variants: [
    { name: 'showing', render: () => html`<${SoloWindow}><${Box} name="invoice-drafter">Drafts the invoices of Lumo Bakery from the orders of the week.<//><//>` },
    { name: 'waiting', render: () => html`<${SoloWindow} message="Loading…" />` },
    { name: 'not found', render: () => html`<${SoloWindow} message="This document was not found, or you cannot open it." />` },
  ] },

  'quick-find': { variants: [
    { name: 'found', render: () => html`<${QuickFind} value="ferr" onInput=${noop} placeholder="Find a page, an organism, a document…"
      hint="↑ ↓ to move, Enter to open, Esc to close" groups=${PLACES} onPick=${noop} />` },
    { name: 'searching', render: () => html`<${QuickFind} value="seat" onInput=${noop} placeholder="Find…" busy busyLabel="Searching…" groups=${[]} onPick=${noop} />` },
    { name: 'nothing found', render: () => html`<${QuickFind} value="zzz" onInput=${noop} placeholder="Find…" emptyLabel="No matches." groups=${[]} onPick=${noop} />` },
    { name: 'long', render: () => html`<${QuickFind} value="a" onInput=${noop} groups=${[{ key: 'l', label: 'Documents', items: [{ key: 'x', label: LONG, sub: 'Harbour Studio · a workspace with a long name', snippet: '…a snippet of the text that is long enough to be cut at the end of the row on a narrow screen…' }] }]} onPick=${noop} />` },
  ] },

  'own-aimeat': { variants: [
    { name: 'on a demo node', render: () => html`<${OwnAimeat} href="https://store.example.com" label="Demo"
      title="This is a demo. Get your own AIMEAT."
      text="Many people share this site to try things out. Your own AIMEAT is the same whole system, at an address with your name on it. We keep it running and up to date for a monthly fee, and everything in it belongs to you."
      cta="Go to the store →" />` },
  ] },

  'pick-field': { variants: [
    { name: 'pick and keep', render: () => admin('CORS', html`<${PickField} keep items=${AGENTS} placeholder="Pick an agent" ariaLabel="Pick an agent"
      emptyLabel="Every agent is listed already." noMatchLabel="No agent matches." onPick=${noop} onType=${noop} />`) },
    { name: 'search', render: () => admin('Front page', html`<${PickField} search items=${[{ id: 'hero', name: 'Hero', sub: 'the big headline' }, { id: 'boards', name: 'Boards', sub: 'the latest notices' }]}
      placeholder="Add a part" ariaLabel="Add a part" emptyLabel="No part to add." noMatchLabel="No part to add." onPick=${noop} />`) },
    { name: 'empty', render: () => admin('CORS', html`<${PickField} items=${[]} placeholder="Pick a person" emptyLabel="Every person is listed already." onPick=${noop} />`) },
  ] },

  'status-page-preview': { variants: [
    { name: 'preview', render: () => admin('Maintenance', html`<${StatusPagePreview} status="503 Service Unavailable" type="text/html"
      node="aimeat-local-001-dev" head="Down for work" message="Back at 14:00 UTC." sub="Your data is untouched and you are still signed in."
      label="What they see" hint="The same line goes in the response body, so an agent reads it too." />`) },
    { name: 'live', render: () => admin('Maintenance', html`<${StatusPagePreview} live status="503 Service Unavailable" type="text/html"
      node="aimeat-local-001-dev" head="Down for work" message="Back at 14:00 UTC." label="Live" />`) },
    { name: 'long', render: () => admin('Maintenance', html`<${StatusPagePreview} status="503 Service Unavailable" type="text/html; charset=utf-8"
      node="aimeat-local-001-dev" head="Down for work" message=${`${LONG}. We move the database to a larger machine and come back as soon as it answers.`} label="What they see" />`) },
  ] },

  'search-preview': { variants: [
    { name: 'search result', render: () => admin('Discovery', html`<${SearchResult} label="In a search" url="https://harbour.studio"
      title="Harbour Studio" desc="Sound design for ferries and harbours, recorded on the water." />`) },
    { name: 'share card', render: () => admin('Discovery', html`<${ShareCard} label="As a shared link" image="/img/business-hero.png" noImage="No share picture"
      title="Harbour Studio" desc="Sound design for ferries and harbours." host="harbour.studio" />`) },
    { name: 'no picture', render: () => admin('Discovery', html`<${ShareCard} label="As a shared link" noImage="No share picture"
      title="Lumo Bakery" desc="Bread from the harbour oven." host="lumo.bakery" />`) },
    { name: 'long', render: () => admin('Discovery', html`<${SearchResult} label="In a search" url="https://harbour-studio-sound-design-for-ferries.example.com/about/the-team"
      title=${LONG} desc="A site description long enough that a search engine cuts it after two lines, and here it wraps on a phone as well." />`) },
    // SearchCard lives in the app catalogue's opened app, not on an admin page, so it stands bare.
    { name: 'search card', render: () => html`<${SearchCard} image="/img/business-hero.png" noImage="No screenshot yet"
      title="Lumo Bakery orders" desc="Take the day's bread orders and print the baking list at five." />` },
    { name: 'search card, no picture yet', render: () => html`<${SearchCard} noImage="No screenshot yet. Publish the app once to make one."
      title="Nordic Ferries timetables" desc="Every crossing of the week in one table your agents can read." />` },
  ] },

  'save-bar': { variants: [
    { name: 'unsaved', render: () => admin('Front page', html`<${SaveBar} label="Save the layout">
      <${Loud} control onClick=${noop}>Save the layout<//>
      <${Tinted} strong tone="notice">3 unsaved changes<//>
      <${Action} small soft onClick=${noop}>See what<//>
      <${Action} small soft onClick=${noop}>Undo<//>
      <${Note} kind="hint" inline>Visitors see the old layout until you save.<//>
    <//>`) },
    { name: 'nothing unsaved', render: () => admin('Front page', html`<${SaveBar} label="Save the layout">
      <${Loud} control disabled onClick=${noop}>Save the layout<//>
      <${Note} kind="hint" inline>Nothing unsaved.<//>
    <//>`) },
  ] },

  'move-buttons': { variants: [
    { name: 'stacked, the first', render: () => admin('Front page', html`<${MoveButtons} first onUp=${noop} onDown=${noop} upLabel="Move up" downLabel="Move down" />`) },
    { name: 'stacked, in the middle', render: () => admin('Front page', html`<${MoveButtons} onUp=${noop} onDown=${noop} upLabel="Move up" downLabel="Move down" />`) },
    { name: 'across, the last', render: () => admin('Front page', html`<${MoveButtons} across last onUp=${noop} onDown=${noop} upLabel="Move up" downLabel="Move down" />`) },
  ] },

  'day-chart': { variants: [
    { name: 'two series', render: () => admin('Statistics', html`<${DayChart} title="Memory" days=${DAYS} axis="tallest bar: 455"
      series=${[{ label: 'reads', tone: 'first', values: READS }, { label: 'writes', tone: 'second', values: WRITES }]}
      note="Reads and writes by owners and their agents." />`) },
    { name: 'critical', render: () => admin('Security', html`<${DayChart} title="Refusals" days=${DAYS} axis="tallest bar: 21 400"
      series=${[{ label: 'refused', tone: 'critical', values: [12000, 21400, 9800, 15000, 17200, 4000, 8800] }]} />`) },
    { name: 'plain, money', render: () => admin('Usage', html`<${DayChart} title="Spend" days=${DAYS} axis="tallest bar: $4.10"
      format=${(v) => `$${(v / 100).toFixed(2)}`} series=${[{ label: 'spend', tone: 'plain', values: [120, 410, 90, 300, 260, 0, 180] }]} />`) },
    { name: 'spark', render: () => admin('Statistics', html`<${DaySpark} values=${READS} days=${DAYS} tone="first" />`) },
    { name: 'empty', render: () => admin('Statistics', html`<${DayChart} title="Memory" days=${DAYS} axis="No reads this week."
      series=${[{ label: 'reads', tone: 'first', values: [0, 0, 0, 0, 0, 0, 0] }]} />`) },
  ] },

  'trend-line': { variants: [
    { name: 'line', render: () => admin('Database', html`<${TrendLine} label="Database size" note="seven days"
      points=${[120, 124, 123, 131, 138, 140, 146]} readAt=${(i) => `${DAYS[i]} · ${[120, 124, 123, 131, 138, 140, 146][i]} MB`}
      ends=${['120 MB · oldest', '146 MB · now']} />`) },
    { name: 'midline and ground', render: () => admin('Metrics', html`<${TrendLine} label="Sessions" note="24 hours" area mid="41"
      points=${[38, 40, 41, 43, 42, 44, 41, 39, 40, 42]} ends=${['38', '42 · now']} />`) },
    { name: 'one reading', render: () => admin('Database', html`<${TrendLine} label="Database size" points=${[146]} ends=${['146 MB', '146 MB · now']} />`) },
  ] },

  'count-bars': { variants: [
    { name: 'set, with hot keys', render: () => admin('Security', html`<${CountBarsSet}>
      <${CountBars} label="By door" rows=${[{ key: '/v1/memory', count: 412 }, { key: '/v1/auth/login', count: 96 }, { key: '/v1/apps', count: 12 }]} />
      <${CountBars} label="By source" hot=${['203.0.113.7']} more=${{ name: '12 more sources', count: 40 }}
        rows=${[{ key: '203.0.113.7', count: 380 }, { key: '198.51.100.23', count: 88 }, { key: '192.0.2.14', count: 12 }]} />
      <${CountBars} label="By credential" words rows=${[{ key: 'agent token', count: 301 }, { key: 'no credential', count: 219 }]} />
    <//>`) },
    { name: 'wide, pressable', render: () => admin('Knowledge', html`
      <${CountBars} wide title="By author" why="Who wrote the packages on this node."
        rows=${[{ key: 'sandbox', name: 'sandbox', count: 14, onPick: noop, title: 'Show only sandbox' }, { key: 'bot', name: 'bot', count: 6, onPick: noop }, { key: 'x', name: 'unknown author', count: 2, tone: 'warn', note: 'unverified' }]} />
      <${CountBars} wide last title="By kind" rows=${[{ key: 'skill', count: 18 }, { key: 'cortex', count: 4 }]} />`) },
    { name: 'long keys', render: () => admin('Security', html`<${CountBars} label="By door"
      rows=${[{ key: '/v1/organisms/fbb51de5-0000-4000-8000-000000000000/workspaces/ws-mslunjvcgxj/documents', count: 44 }, { key: '/v1/memory', count: 12 }]} />`) },
    { name: 'empty', render: () => admin('Security', html`<${CountBars} label="By door" rows=${[]} />`) },
  ] },

  'print-page': { variants: [
    { name: 'on screen', render: () => admin('Compliance', html`<${PrintPage}>
      <${ScreenOnly}><${Note} kind="lead">The register as you edit it. The document below it prints on paper only.<//><//>
      <${PrintOnly}><${PrintHead} title="Processing register" line="aimeat-local-001-dev · 2026-09-27" /><//>
    <//>`) },
    { name: 'the document', render: () => admin('Compliance', html`
      <${PrintHead} title="Processing register" line="aimeat-local-001-dev · 2026-09-27 · version 3" />
      <${PrintHeading}>Processing<//>
      <${PrintEntry} ...${COMPLIANCE_ENTRY} />
      <${PrintHeading}>Next steps<//>
      <${PrintList} items=${[{ key: 'a', text: 'Name a contact for data requests.', help: 'A person or an address that answers within a month.' }, { key: 'b', text: 'Review the register once a year.' }]} />`) },
  ] },

  'settings-index': { variants: [
    { name: 'settings', render: () => admin('Configuration', html`<${SettingsIndex}
      search=${{ value: '', onInput: noop, placeholder: 'Search settings…' }}
      filters=${html`<${Tabs} value=${false} onSelect=${noop} items=${[{ value: true, label: 'Only changed (0)' }, { value: false, label: 'All' }]} />`}
      index=${INDEX} indexLabel="Sections" empty="No setting matches.">${settingsBody(false)}<//>`) },
    { name: 'unsaved', render: () => admin('Configuration', html`<${SettingsIndex}
      search=${{ value: 'model', onInput: noop, placeholder: 'Search settings…' }}
      status=${html`<${Tinted} strong tone="notice">1 unsaved<//> <${Loud} control onClick=${noop}>Save<//> <${Action} small onClick=${noop}>Cancel<//>`}
      before=${html`<${ChangeList} items=${[{ key: 'ai.model', code: 'ai.model', was: 'claude-sonnet-5', now: 'claude-opus-5-5' }]} />`}
      index=${INDEX} indexLabel="Sections" empty="No setting matches.">${settingsBody(true)}<//>`) },
    { name: 'nothing matches', render: () => admin('Configuration', html`<${SettingsIndex}
      search=${{ value: 'zzz', onInput: noop, placeholder: 'Search settings…' }} index=${[]} indexLabel="Sections" empty="No setting matches." />`) },
  ] },

  shots: { variants: [
    { name: 'pictures', render: () => admin('Applications', html`<${Shots} items=${[
      { key: 'a', src: '/img/business-hero.png', alt: 'The original app', caption: 'The original', sub: 'charts · sandbox' },
      { key: 'b', src: '/img/business-hero.png', alt: 'The suspected copy', caption: 'The suspected copy', sub: 'charts-2 · bot' },
    ]} />`) },
    { name: 'no picture', render: () => admin('Applications', html`<${Shots} items=${[
      { key: 'a', src: '/img/business-hero.png', alt: 'The original app', caption: 'The original', sub: 'charts · sandbox' },
      { key: 'b', none: 'No picture yet', caption: 'The suspected copy', sub: 'charts-2 · bot' },
    ]} />`) },
    { name: 'long', render: () => admin('Applications', html`<${Shots} items=${[
      { key: 'a', none: 'No picture yet', caption: LONG, sub: 'harbour-studio-sound-design-for-ferries · sandbox' },
    ]} />`) },
  ] },
};
