/**
 * @file public/views/design-lab/demos-page-kit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the page parts of Settings & Controls: the page (SettingsPage), the section (Section), the fold rows (Folds), the tabs (Tabs), the layout (Layout) and the contents tree (ContentsTree), each drawn by calling the real component with sample data, in
 *   the page's scope root (.pf) as Settings & Controls draws it. The kit's older parts are here too:
 *   the rail (tab-page), the crumb, the page head, PageSection, FoldSection and the sub-heading.
 *   A part whose look keys on the page root (.og) is drawn inside a SettingsPage.
 * @structure PAGE_KIT_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { PAGE_KIT_DEMOS } from './demos-page-kit.js';
 * @version-history
 *   v1.1.0 — 2026-09-27 — The demos of settings-page, section-component, folds, tab-row, layout and
 *     contents-tree; tab-page, crumb-trail, page-head, page-section, fold-row and sub-heading moved
 *     here from demos-settings.js, each drawn by its component (the catalogue pass).
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import { h } from 'preact';
import htm from 'htm';
import { SettingsRoot } from '/components/SettingsFrame.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { Folds, FoldRow } from '/components/Folds.js';
import { Tabs, Tab } from '/components/Tabs.js';
import { Row, Stack, Split, Space, Beside, Touch } from '/components/Layout.js';
import { ContentsTree } from '/components/ContentsTree.js';
import { Rail } from '/components/Rail.js';
import { Crumb } from '/components/Crumb.js';
import { PageHead } from '/components/PageHead.js';
import { SubHeading, HeadDesc } from '/components/SubHeading.js';
import { Action, Actions, Loud, Icon } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { TextField } from '/components/TextField.js';

const html = htm.bind(h);
const noop = () => {};

// Sample data: the sandbox's world (Harbour Studio, Nordic Ferries, Lumo Bakery; agents bot and invoice-drafter).
const SECTIONS = [
  { id: 'dl-pk-files', num: '01', label: 'Files', count: 12 },
  { id: 'dl-pk-people', num: '02', label: 'People', count: 4 },
  { id: 'dl-pk-settings', num: '03', label: 'Settings', count: '' },
];
const PAGES = [{ onClick: noop, label: 'Agents' }, { onClick: noop, label: 'Boards' }];
const LONG = 'Nordic Ferries: the seasonal timetable, the harbour contracts and every note the crew wrote about them';

/** A part whose rules key on the page root (.og) stands inside a page with a short head. */
const inPage = (body) => html`<${SettingsRoot}><${SettingsPage} crumb=${['Organisms', 'Harbour Studio']} title="Harbour Studio">${body}<//><//>`;

const files = html`<${PageSection} id="dl-pk-files" num="01" title="Files" first>
  <${Note} kind="lead">Client briefs, notes and drafts, newest first.<//><//>`;
const people = html`<${PageSection} id="dl-pk-people" num="02" title="People" doors=${html`<${Action} onClick=${noop}>Invite<//>`}>
  <${Note} kind="lead">Everyone in this space and what they may do.<//><//>`;

const rail = (items) => html`<${SettingsRoot}><${Rail} title="On this page" groups=${[{ label: 'On this page', items }]} /><//>`;

const events = [
  { num: '09:12', who: 'bot', verb: 'wrote', name: 'studio/clients/nordic-ferries', isKey: true },
  { num: '08:40', who: 'invoice-drafter', verb: 'sent', name: 'Invoice 2026-09 for Lumo Bakery' },
];

const tree = (on) => [
  { key: 'docs', label: 'Documents', count: 3, items: [
    { key: 'briefs', label: 'Client briefs', count: 12, fresh: 2, on: on === 'briefs', onClick: noop, children: [
      { key: 'seat', label: 'Seat map study', on: on === 'seat', onClick: noop },
      { key: 'menu', label: 'Lumo Bakery: seasonal menu site', draft: true, onClick: noop },
    ], more: { label: '… 10 more', onClick: noop } },
    { key: 'notes', label: 'Notes', count: 3, onClick: noop },
  ] },
  { key: 'records', label: 'Records', count: 1, items: [{ key: 'contacts', label: 'Contacts', count: 40, onClick: noop }] },
];

export const PAGE_KIT_DEMOS = {
  'settings-page': { variants: [
    { name: 'with a rail', render: () => html`<${SettingsRoot}><${SettingsPage} name="dl-demo"
        crumb=${['Settings', 'Information', 'Organisms']} title="Harbour Studio" sub="3 spaces"
        marks=${[{ label: 'owner', tone: 'ink' }, { label: 'shared with 4', tone: 'sun' }]}
        desc="A small design studio's shared knowledge: client briefs, notes and the people who keep them."
        actions=${html`<${Loud} onClick=${noop}>Invite someone<//><${Actions}><${Action} small onClick=${noop}>Export<//><//>`}
        strip=${html`<${FigureStrip} items=${[{ n: 12, label: 'files', sub: '3 new' }, { n: 4, of: '/6', label: 'people', sub: '2 admins' }, { n: 'today', tone: 'coral', label: 'last change', sub: 'by bot' }]} />`}
        railTitle="On this page" sections=${SECTIONS} pagesLabel="Pages" pages=${PAGES}>
        ${files}${people}<//><//>` },
    { name: 'without a rail (the classic page)', render: () => html`<${SettingsRoot}><${SettingsPage}
        crumb=${['Settings', 'Infrastructure', 'Security']} title="Security"
        desc="How this node keeps apps apart, and who may sign in.">
        <${PageSection} id="dl-pk-sec" num="01" title="Sign-in" first><${Note} kind="lead">Passwords and passkeys for every owner.<//><//><//><//>` },
    { name: 'page (a page inside a page)', render: () => html`<${SettingsRoot}><${SettingsPage} page label="Person"
        crumb=${['Settings', { label: 'Contacts', onClick: noop }, { label: 'Aino Laine', here: true }]}
        title="Aino Laine" sub="Nordic Ferries" marks=${[{ label: 'contact', tone: 'sun' }]}
        back=${{ label: 'Back to contacts', onClick: noop }} railTitle="Person" sections=${SECTIONS.slice(0, 2)}
        pagesLabel="Pages" pages=${PAGES}>${files}<//><//>` },
    { name: 'two rails and an aside', render: () => html`<${SettingsRoot}><${SettingsPage} page asKey
        crumb=${['Settings', { label: 'Memory', onClick: noop }, { label: 'studio/clients/nordic-ferries', here: true }]}
        title="studio/clients/nordic-ferries"
        aside=${html`<${Note} kind="hint">Only you can read this record.<//>`}
        rail=${[{ title: 'Key space', groups: [{ label: 'studio/clients', items: [{ mark: '·', label: 'nordic-ferries', code: true, on: true, onClick: noop }, { mark: '·', label: 'lumo-bakery', code: true, onClick: noop }] }] },
          { title: 'This record', groups: [{ label: 'This record', items: [{ mark: '·', label: 'Copy the key', count: '…', onClick: noop }] }] }]}>
        <${PageSection} id="dl-pk-value" num="01" title="Value" first><${Note} kind="lead">The ferry company's contract terms, renewed each spring.<//><//><//><//>` },
    { name: 'loading', render: () => html`<${SettingsRoot}><${SettingsPage} crumb=${['Settings', 'Build and share', 'Skills']}
        title="Skills" marks=${[]} strip=${html`<${FigureStrip} loading=${3} />`} railTitle="On this page" sections=${SECTIONS}>
        <${Note} kind="loading">Loading…<//><//><//>` },
    { name: 'long', render: () => html`<${SettingsRoot}><${SettingsPage}
        crumb=${['Settings', 'Information', 'Organisms', 'Harbour Studio', LONG]} title=${LONG} sub="12 documents"
        desc="A title and a crumb long enough to wrap on a phone, as a workspace's long names do.">${files}<//><//>` },
  ] },
  'section-component': { variants: [
    { name: 'open, with actions', render: () => inPage(html`<${Section} id="dl-pk-s1" num="01" title="People" count=${4}
        doors=${html`<${Action} onClick=${noop}>Invite<//>`}><${Note} kind="lead">Everyone in this space.<//><//>`) },
    { name: 'first and plain', render: () => inPage(html`<${Section} id="dl-pk-s2" num="01" title="Files" first><${Note} kind="lead">The first section has no rule on top.<//><//>
        <${Section} plain><${Note} kind="lead">A section with no head: only its rule and its body.<//><//>`) },
    { name: 'fold, shut and open', render: () => inPage(html`<${Section} fold id="dl-pk-s3" num="02" title="Map" sub="12 spaces" open=${false} onToggle=${noop}>…<//>
        <${Section} fold id="dl-pk-s4" num="03" title="History" sub="40 changes" lead="Who changed what, newest first." open=${true} onToggle=${noop}><${Note} kind="lead">The body of an opened section.<//><//>`) },
    { name: 'fold inner', render: () => inPage(html`<${Section} id="dl-pk-s5" num="04" title="Connect">
        <${Section} fold inner title="Claude Code" open=${false} onToggle=${noop}>…<//>
        <${Section} fold inner title="Codex" open=${false} onToggle=${noop}>…<//><//>`) },
  ] },
  folds: { variants: [
    { name: 'events', render: () => html`<${SettingsRoot}><${Folds}>${events.map((e) => html`<${FoldRow} key=${e.num} ...${e} onClick=${noop} />`)}<//><//>` },
    { name: 'toggle steps, one done', render: () => html`<${SettingsRoot}><${Folds}>
        <${FoldRow} kind="toggle" num="1" name="Generate" right="done" done open=${false} onClick=${noop} />
        <${FoldRow} kind="toggle" num="2" name="Analyze" right="waiting" open=${false} onClick=${noop} /><//><//>` },
    { name: 'rows (a history)', render: () => html`<${SettingsRoot}><${Folds}>
        <${FoldRow} num="2026-09-20" name="The space was shared with Nordic Ferries" right="sandbox" />
        <${FoldRow} num="2026-09-12" name="Harbour Studio was made" right="sandbox" /><//><//>` },
    { name: 'open, with its body', render: () => html`<${SettingsRoot}><${Folds}>
        <${FoldRow} name="studio/clients" defaultOpen body=${html`<${Note} kind="lead">Twelve records under this key.<//>`}><${Mark} kind="count" tone="tally">12<//><//><//><//>` },
    { name: 'doors', render: () => html`<${SettingsRoot}><${Folds}>
        <${FoldRow} name="studio/prices" isKey open=${false} onClick=${noop}
          doors=${html`<${Icon} small label="Search in this group" onClick=${noop}>🔍<//><${Icon} small label="Delete group" onClick=${noop}>🗑️<//>`} /><//><//>` },
    { name: 'long', render: () => html`<${SettingsRoot}><${Folds}><${FoldRow} num="09:12" who="invoice-drafter" verb="wrote" name=${LONG} onClick=${noop} /><//><//>` },
  ] },
  'tab-row': { variants: [
    { name: 'plain', render: () => html`<${SettingsRoot}><${Tabs} label="Who may see" value="members" onSelect=${noop}
        items=${[{ value: 'private', label: 'Private' }, { value: 'members', label: 'Members' }, { value: 'public', label: 'Public' }]} /><//>` },
    { name: 'filter', render: () => html`<${SettingsRoot}><${Tabs} tone="filter" kind="toggle" label="Filter" value=${['bound']} onSelect=${noop}
        items=${[{ value: '', label: 'All', count: 12, on: false }, { value: 'bound', label: 'Bound to an app', count: 3 }, { value: 'unused', label: 'Unused', count: 2, attention: true }]} /><//>` },
    { name: 'bar', render: () => html`<${SettingsRoot}><${Tabs} bar kind="view" label="Nodes" value="nodes" onSelect=${noop}
        items=${[{ value: 'nodes', label: 'Nodes' }, { value: 'stats', label: 'Statistics' }]} /><//>` },
    { name: 'fold', render: () => html`<${SettingsRoot}><${Tab} tone="fold" on pressed onClick=${noop}>3 waiting<//><//>` },
    { name: 'tile', render: () => html`<${SettingsRoot}><${Tabs} tone="tile" value="week" onSelect=${noop}
        items=${[{ value: 'day', label: 'Every day' }, { value: 'week', label: 'Every week' }, { value: 'month', label: 'Every month' }]} /><//>` },
    { name: 'disabled', render: () => html`<${SettingsRoot}><${Tabs} disabled value="members" onSelect=${noop}
        items=${[{ value: 'private', label: 'Private' }, { value: 'members', label: 'Members' }]} /><//>` },
    { name: 'long', render: () => html`<${SettingsRoot}><${Tabs} tone="filter" kind="toggle" value=${[]} onSelect=${noop}
        items=${[{ value: 'a', label: 'Harbour Studio and Nordic Ferries together', count: 40 }, { value: 'b', label: 'Lumo Bakery', count: 7 }, { value: 'c', label: 'Everything the agents wrote this month', count: 118 }]} /><//>` },
  ] },
  layout: { variants: [
    { name: 'row, wraps', render: () => html`<${SettingsRoot}><${Row} wrap>
        ${['design', 'ferries', 'invoices', 'bakery', 'timetable', 'contracts'].map((w) => html`<${Mark} key=${w}>${w}<//>`)}<//><//>` },
    { name: 'row, ends apart', render: () => html`<${SettingsRoot}><${Row} gap="none" justify="between"><b>Harbour Studio</b><${Action} small onClick=${noop}>Open<//><//><//>` },
    { name: 'stack', render: () => html`<${SettingsRoot}><${Stack} gap="large"><${Note} kind="lead">One part.<//><${Note} kind="lead">The next, 1rem under it.<//><//><//>` },
    { name: 'stack as a list', render: () => html`<${SettingsRoot}><${Stack} list gap="small"><span>+90 daily accrual</span><span>+30 a vouch</span><span>-40 memory writes</span><//><//>` },
    { name: 'split', render: () => html`<${SettingsRoot}><${Note} kind="lead">The board's rules are saved.<//><${Split}><${Actions}><${Action} tone="danger" onClick=${noop}>Delete board<//><//><//><//>` },
    { name: 'split heavy and side', render: () => html`<${SettingsRoot}><${Split} heavy><${Note} kind="lead">A new thing starts under the heavy rule.<//><//>
        <${Space} above="large"><${Split} side pad="none"><${Note} kind="hint">Use your own Google app instead.<//><//><//><//>` },
    { name: 'beside', render: () => html`<${SettingsRoot}><${Beside} narrow side=${html`<${Note} kind="hint">Visible to members of Harbour Studio.<//>`}>
        <${TextField} label="Notice" value="The ferry timetable changes on Monday." onInput=${noop} /><//><//>` },
    { name: 'beside, wide', render: () => html`<${SettingsRoot}><${Beside} wide side=${html`<${Note} kind="lead">bot answers here.<//>`}><${Note} kind="lead">The notice and its replies.<//><//><//>` },
    { name: 'touch', render: () => html`<${SettingsRoot}><${Touch}><${Row} wrap><${Loud} control onClick=${noop}>Allow<//><${Action} onClick=${noop}>Ask me each time<//><//><//><//>` },
  ] },
  'contents-tree': { variants: [
    { name: 'one space open', render: () => html`<${SettingsRoot}><${ContentsTree} title="Harbour Studio" groups=${tree('seat')} draftLabel="draft"
        foot=${{ mark: '↩', label: 'Show the contents', onClick: noop }} /><//>` },
    { name: 'long', render: () => html`<${SettingsRoot}><${ContentsTree} title="Harbour Studio"
        groups=${[{ key: 'g', label: 'Documents', count: 1, items: [{ key: 'l', label: LONG, count: 3, fresh: 1, on: true, onClick: noop }] }]} /><//>` },
    { name: 'empty', render: () => html`<${SettingsRoot}><${ContentsTree} title="Harbour Studio"
        groups=${[{ key: 'g', label: 'Documents', count: 0, items: [] }]} foot=${{ mark: '↩', label: 'Show the contents', onClick: noop }} /><//>` },
  ] },
  // The kit's older parts (moved here from demos-settings.js), drawn by their components.
  'tab-page': { variants: [
    { name: 'the page beside its rail', render: () => html`<${SettingsRoot}><${SettingsPage} title="Harbour Studio" railTitle="On this page"
        sections=${SECTIONS} pagesLabel="Pages" pages=${PAGES}>${files}<//><//>` },
    { name: 'the current item, the way back, a mode', render: () => rail([
      { back: true, label: 'Back to organisms', onClick: noop },
      { section: 'dl-pk-files', mark: '01', label: 'Files', count: 12, on: true },
      { mark: '·', label: 'As a tree', count: '→', onClick: noop },
      { mark: '·', label: 'Busy', count: '…', onClick: noop, disabled: true },
    ]) },
    { name: 'still, plain, code, notice, note', render: () => rail([
      { still: true, mark: '·', label: 'Most delivered', count: 18 },
      { plain: true, mark: '·', label: '5 more' },
      { mark: '·', label: 'wf/invoice/hours', code: true, onClick: noop },
      { mark: '·', label: 'The key is missing', notice: true, onClick: noop },
      { mark: '·', label: 'bot', onClick: noop }, { note: true, label: 'poster since 2026-09-12' },
    ]) },
  ] },
  'crumb-trail': { variants: [
    { name: 'the page you are on', render: () => html`<${SettingsRoot}><${Crumb} steps=${['Settings', 'Build and share', 'Skills']} /><//>` },
    { name: 'a link back, and here', render: () => html`<${SettingsRoot}><${Crumb} steps=${['Settings', { label: 'Contacts', onClick: noop }, { label: 'Aino Laine', here: true }]} /><//>` },
    { name: 'long', render: () => html`<${SettingsRoot}><${Crumb} steps=${['Settings', { label: 'Organisms', onClick: noop }, { label: 'Harbour Studio', onClick: noop }, LONG]} /><//>` },
  ] },
  'page-head': { variants: [
    { name: 'title, tags, sentence, actions', render: () => html`<${SettingsRoot}><${PageHead} title="Access" sub="who may do what"
        marks=${[{ label: '3 apps', tone: 'sun' }, { label: '2 sessions', tone: 'dim' }]}
        desc="Every app, token and session that can act in your name, and a way to stop each one."
        actions=${html`<${Loud} onClick=${noop}>New token<//><${Actions}><${Action} small onClick=${noop}>For your AI<//><//>`} /><//>` },
    { name: 'page, with a label', render: () => html`<${SettingsRoot}><${PageHead} page label="Board" title="Harbour" sub="12 notices" desc="The studio's own notices." /><//>` },
    { name: 'key title', render: () => html`<${SettingsRoot}><${PageHead} page asKey title="studio/clients/nordic-ferries" /><//>` },
    { name: 'renaming', render: () => html`<${SettingsRoot}><${PageHead} title="Invoice check"
        edit=${html`<${TextField} ariaLabel="Name" value="Invoice check" onInput=${noop} actions=${html`<${Action} small onClick=${noop}>Save<//>`} />`} /><//>` },
    { name: 'tags loading', render: () => html`<${SettingsRoot}><${PageHead} title="Skills" marks=${[]} desc="What your agents know how to do." /><//>` },
    { name: 'long', render: () => html`<${SettingsRoot}><${PageHead} title=${LONG} sub="40 documents" desc=${LONG} /><//>` },
  ] },
  'page-section': { variants: [
    { name: 'a number and actions', render: () => inPage(html`<${PageSection} id="dl-pk-p1" num="02" title="People" doors=${html`<${Action} onClick=${noop}>Invite<//>`}>
        <${Note} kind="lead">Everyone in this space and what they may do.<//><${Note} kind="hint">Admins can invite and remove people.<//><//>`) },
    { name: 'a count, first', render: () => inPage(html`<${PageSection} id="dl-pk-p2" title="Files" count=${12} first><${Note} kind="lead">Newest first.<//><//>`) },
    { name: 'plain', render: () => inPage(html`<${PageSection} plain><${Note} kind="lead">You can come back when someone invites you.<//><//>`) },
    { name: 'split', render: () => inPage(html`<${PageSection} id="dl-pk-p3" num="03" title="Rules"><${Note} kind="lead">The board's rules are saved.<//>
        <${Split}><${Actions}><${Action} tone="danger" onClick=${noop}>Delete board<//><//><//><//>`) },
    { name: 'long', render: () => inPage(html`<${PageSection} id="dl-pk-p4" num="04" title=${LONG}><${Note} kind="lead">A title long enough to wrap.<//><//>`) },
  ] },
  'fold-row': { variants: [
    { name: 'shut', render: () => inPage(html`<${FoldSection} id="dl-pk-f1" num="03" title="Map" sub="12 spaces" open=${false} onToggle=${noop}>…<//>`) },
    { name: 'open, with a lead', render: () => inPage(html`<${FoldSection} id="dl-pk-f2" num="03" title="Map" sub="12 spaces" lead="Every space and how they link." open=${true} onToggle=${noop}>
        <${Note} kind="lead">The body of an opened section.<//><//>`) },
    { name: 'clip', render: () => inPage(html`<${FoldSection} id="dl-pk-f3" num="04" title="Proof" clip sub=${LONG} open=${false} onToggle=${noop}>…<//>`) },
    { name: 'wrap', render: () => inPage(html`<${FoldSection} id="dl-pk-f4" num="05" title="Same need" wrap sub="Draft an invoice from the hours logged this month" open=${false} onToggle=${noop}>…<//>`) },
    { name: 'inner', render: () => inPage(html`<${FoldSection} inner title="Claude Code" open=${true} onToggle=${noop}><${Note} kind="lead">Paste the line into your terminal.<//><//>
        <${FoldSection} inner title="Codex" open=${false} onToggle=${noop}>…<//>`) },
  ] },
  'sub-heading': { variants: [
    { name: 'a block', render: () => html`<${SettingsRoot}><${SubHeading}>Your own TypeSafe key<//><${Note} kind="hint">A key of your own is used before the node's.<//><//>` },
    { name: 'a heading with its line', render: () => html`<${SettingsRoot}><${SubHeading} level=${3} id="dl-pk-sh" desc="Groups you share records with.">Sharing groups<//><//>` },
    { name: 'in a line', render: () => html`<${SettingsRoot}><p><${SubHeading} inline>Model<//> Claude Sonnet 4.5</p><//>` },
    { name: 'the line alone', render: () => html`<${SettingsRoot}><${HeadDesc}>Every device that is signed in to your account.<//><//>` },
  ] },
};
