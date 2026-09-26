/**
 * @file public/views/design-lab/demos-views-knowledge.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the special views of Settings & Controls about knowledge, organisms, documents and the account, each drawn by calling the real component with sample data, in
 *   the page's scope root (.pf) as Settings & Controls draws it.
 *   Three parts read from the node and show what it answers: the setup guide (the table of tools,
 *   GET /v1/ai-tools), the instructions dialog (the viewer's organisms) and the instruction block
 *   (the block of the viewer's first organism). The file preview is the site's dialog, so it opens
 *   over its own frame.
 * @structure KNOWLEDGE_VIEW_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { KNOWLEDGE_VIEW_DEMOS } from './demos-views-knowledge.js';
 * @version-history
 *   v1.1.1 — 2026-09-27 — The instruction block's demos are keyed by its entry id instruction-block
 *     (formerly hello-mcp).
 *   v1.1.0 — 2026-09-27 — The demos of the organism pages' views, the Memory and Access pages' views, the
 *     overview's band, Portfolio's preview, the opened agent, the platform how-to and the setup guide; the
 *     demos of the colour tag, document tree, file preview, signed-out door, address preview, proof ledger,
 *     changelog, question desk and GAII chip moved here from demos-settings.js and the instruction block's
 *     from demos-shared.js, each now calling its component.
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { SettingsRoot } from '/components/SettingsFrame.js';
import { Mark } from '/components/Mark.js';
import { Action } from '/components/Action.js';
import { Markdown } from '/components/Markdown.js';
import { Mermaid } from '/components/Mermaid.js';
import { ActivityCalendar } from '/components/ActivityCalendar.js';
import { People, Person, AgentChips, AgentChip } from '/components/People.js';
import { SnapshotTimeline } from '/components/SnapshotTimeline.js';
import { MindMap } from '/components/MindMap.js';
import { DocView, DocSplit } from '/components/DocView.js';
import { QrCode } from '/components/QrCode.js';
import { CodeGrid } from '/components/CodeGrid.js';
import { StoredValue } from '/components/StoredValue.js';
import { PagePreview } from '/components/PagePreview.js';
import { NumberBand } from '/components/NumberBand.js';
import { OpenCard, CardLine, TabGroups, CardPanel } from '/components/OpenCard.js';
import { HowTo } from '/components/HowTo.js';
import { SetupGuide, InstructionsDialog } from '/components/SetupGuide.js';
import { InstructionBlock } from '/components/InstructionBlock.js';
import { ColorPicker } from '/components/ColorPicker.js';
import { DocTree } from '/components/DocTree.js';
import { FilePreview } from '/components/FilePreview.js';
import { SignedOutDoor } from '/components/SignedOutDoor.js';
import { AddressPreview } from '/components/AddressPreview.js';
import { ProofLedger } from '/components/ProofLedger.js';
import { ChangeLog } from '/components/ChangeLog.js';
import { QuestionDesk } from '/components/QuestionDesk.js';
import { GaiiChip } from '/components/GaiiChip.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const noop = () => {};
const svgUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

// ── Sample data ──

/** Sixteen weeks of a workspace's activity: quiet at first, busier towards now, the last days to come. */
const WEEKS = Array.from({ length: 16 }, (_, w) => Array.from({ length: 7 }, (_, d) => {
  if (w === 15 && d > 3) return null;
  const busy = (w * 7 + d * 3) % 5;
  const levels = [busy, Math.max(0, busy - 1), (busy + d) % 5, w > 10 ? 4 - busy % 3 : 0];
  return { title: `Week ${w + 1}, day ${d + 1}: ${busy * 2} documents, ${levels[2]} records`, levels };
}));
const MONTHS = WEEKS.map((_, i) => ({ 0: 'Jun', 4: 'Jul', 9: 'Aug', 13: 'Sep' })[i] || '');
const DAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const QUARTERS = ['↖ Docs draft', '↗ Docs published', '↙ Records draft', '↘ Records published'];

/** A stand-in for the server's QR picture: the three finder squares and a scatter of modules. */
const QR = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" shape-rendering="crispEdges"><rect width="21" height="21" fill="#fff"/>${
  [[0, 0], [14, 0], [0, 14]].map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`).join('')}${
  Array.from({ length: 60 }, (_, i) => `<rect x="${8 + (i * 7) % 13}" y="${(i * 5) % 21}" width="1" height="1"/>`).join('')}</svg>`);

const PICTURE = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#0e5a8a"/><path d="M0 140 Q80 110 160 140 T320 140 V180 H0Z" fill="#1d8fcf"/><rect x="110" y="90" width="100" height="36" fill="#f4f1ea"/><rect x="150" y="70" width="14" height="22" fill="#e8543b"/></svg>');

const ORG_MAP = 'mindmap\n  root((Harbour Studio))\n    Client briefs:::heat3\n      Nordic Ferries\n      Lumo Bakery\n    Price list:::heat1\n    Research:::heat2\n      Seat map study';
const TIMELINE = 'timeline\n  title Harbour Studio\n  2026-08-20 : Organism created\n  2026-08-28 : Workspace Research\n  2026-09-02 : Workspace Client briefs';
const snapshot = (n) => `flowchart LR\n  O[Harbour Studio] --> R[Research]${n > 1 ? '\n  O --> C[Client briefs]' : ''}`;

const DOC_WORDS = {
  drag: 'Drag to a section', draft: 'draft', archive: 'Archive', unarchive: 'Unarchive', remove: 'Remove the section',
  delete: 'Delete', rename: 'Rename', newDocHere: 'A new document here', addSub: 'A sub-section', sectionName: 'Section name',
  unnamed: 'Unnamed', unsorted: 'Unsorted', colour: 'Colour', noColour: 'No colour',
};
const doc = (id, title, more = {}) => ({ kind: 'doc', id, title, ...more });
const TREE = [
  { id: 's1', name: 'Research', colour: 'blue', items: [doc('d1', 'Seat map study', { active: true }), doc('d2', 'Twelve bookings', { draft: true })],
    children: [{ id: 's2', name: 'Interviews', items: [doc('d3', 'Captain on the night route', { colour: 'red' })] }] },
];
const UNSORTED = [
  doc('d4', 'Lumo Bakery: seasonal menu site'),
  { kind: 'series', key: 'style', name: 'Style guide', open: false, parts: [doc('d5', 'Style guide, part 1'), doc('d6', 'Style guide, part 2')] },
];
const docTree = (props) => html`<${SettingsRoot}><${DocTree} words=${DOC_WORDS} onOpen=${noop} onDocColour=${noop} onArchive=${noop} onDelete=${noop}
  onSeries=${noop} onSectionColour=${noop} onRename=${noop} onName=${noop} onNameDone=${noop} onNewDoc=${noop} onAddSub=${noop}
  onRemoveSection=${noop} onMove=${noop} ...${props}><p>The open document.</p><//><//>`;

const DOOR = {
  kicker: 'This address leads inside', title: 'You are at the right door.', titleAccent: 'Sign in, and it opens.',
  targetLabel: 'Where this address leads', tag: 'owner only',
  lead: 'The address you opened leads to a page inside your Settings & Controls, and that page opens only for you.',
  action: { label: 'Sign in', onClick: noop }, second: { label: 'Create an account', onClick: noop },
  after: 'Signing in takes a moment, and then you continue straight to where the address points.',
  aside: { label: 'What this is', title: 'New here?', text: 'AIMEAT is a place where what you know stays yours, and the AI you already use works with it. Making an account is free.', link: { label: 'How it works →', href: '#', onClick: (e) => e.preventDefault() } },
};

const HOW_TO = '<h4>Windows</h4><ol><li>Install Node.js 24 from <a href="https://nodejs.org" target="_blank" rel="noopener">nodejs.org</a>.</li><li>Open PowerShell and run <code>npx aimeat connect</code>.</li><li>Approve the agent on the page that opens.</li></ol>';

const DESK_SCOPES = [{ value: 'own', label: 'Mine', count: '120' }, { value: 'shared', label: 'Shared', count: '40' }, { value: 'public', label: 'Public', count: '900' }];

/** The instruction block of the viewer's first organism, read the way the instructions dialog reads it. */
function FirstOrganismBlock() {
  const [orgId, setOrgId] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getOrganismsTab()
      .then((tab) => { if (!cancelled) setOrgId(((tab && tab.mine) || [])[0]?.id || ''); })
      .catch((err) => { swallowed('design-lab: organisms', err); if (!cancelled) setOrgId(''); });
    return () => { cancelled = true; };
  }, []);
  if (orgId === '') return html`<p>You have no organism, so there is no block to show.</p>`;
  return html`<${InstructionBlock} orgId=${orgId || ''} />`;
}

const agentCard = (more = {}) => html`<${SettingsRoot}><${OpenCard} title="invoice-drafter" onClose=${noop}
    id=${html`<${GaiiChip} gaii="invoice-drafter#sandbox@aimeat-local-001-dev" label="Copy GAII" copiedLabel="Copied" />`}
    marks=${html`<${Mark} kind="status" tone="fine">online<//> <${Mark}>crewai<//> <${Mark} tone="sun">yours<//>`}
    side=${html`<${Action} href="https://agents.example.com/invoice-drafter" newTab>agents.example.com<//>`} ...${more}>
    <${CardLine} label="Runs">When you ask it. <${Action} small onClick=${noop}>Change<//><//>
    <${TabGroups} value="tasks" onSelect=${noop} groups=${[
      { key: 'work', label: 'Work', items: [{ value: 'tasks', label: 'Tasks', dot: 'new' }, { value: 'offers', label: 'Offers' }] },
      { key: 'health', label: 'Health', items: [{ value: 'quality', label: 'Quality' }, { value: 'errors', label: 'Errors', dot: 'failed' }] },
      { key: 'empty', label: 'Nothing here', items: [] },
    ]} />
    <${CardPanel}><p>Draft the invoice for Nordic Ferries from the hours logged in September.</p><//>
  <//><//>`;

export const KNOWLEDGE_VIEW_DEMOS = {
  // ── The organism pages ──
  'activity-calendar': { variants: [
    { name: 'sixteen weeks', render: () => html`<${SettingsRoot}><${ActivityCalendar} weeks=${WEEKS} months=${MONTHS} days=${DAYS} quarters=${QUARTERS} less="Less" more="More" /><//>` },
    { name: 'empty', render: () => html`<${SettingsRoot}><${ActivityCalendar} weeks=${[Array.from({ length: 7 }, () => ({ title: 'Nothing', levels: [0, 0, 0, 0] }))]} months=${['Sep']} days=${DAYS} quarters=${QUARTERS} less="Less" more="More" /><//>` },
  ] },
  people: { variants: [
    { name: 'own and other agents', render: () => html`<${SettingsRoot}><${People}>
      <${Person} name="sandbox" count=${14} countTitle="contributions" marks=${html`<${Mark} tone="sun">you<//><${Mark} tone="fine">creator<//>`}>
        <${AgentChip} own title="bot#sandbox@aimeat-local-001-dev" count=${9} countTitle="contributions">🤖 bot<//>
        <${AgentChip} own title="invoice-drafter#sandbox@aimeat-local-001-dev" count=${0} countTitle="contributions">🤖 invoice-drafter<//>
      <//>
      <${Person} name="harbour-ops" node="nordic-ferries.aimeat.io" count=${3} countTitle="contributions" marks=${html`<${Mark} tone="coral">guest<//>`}>
        <${AgentChip} ghost title="Another owner’s agent: you see what it has done here, not its live status" count=${2}>🤖 timetable-reader<//>
      <//>
    <//><//>` },
    { name: 'no agents', render: () => html`<${SettingsRoot}><${People}><${Person} name="lumo-bakery" marks=${html`<${Mark} tone="fine">creator<//>`} /><//><//>` },
    { name: 'agent chips alone', render: () => html`<${SettingsRoot}><${AgentChips}><${AgentChip} own>📜 invoice-drafter<//><${AgentChip} own>📜 a contract agent with a name long enough to wrap on a phone<//><//><//>` },
  ] },
  'snapshot-timeline': { variants: [
    { name: 'a point chosen', render: () => html`<${SettingsRoot}><${SnapshotTimeline} diagram=${html`<${Mermaid} chart=${TIMELINE} />`}
      points=${[
        { key: 'c', date: '2026-09-02', event: 'Workspace Client briefs added', counts: '2 ws · 12 docs', on: true, onPick: noop },
        { key: 'b', date: '2026-08-28', event: 'Workspace Research added', counts: '1 ws · 4 docs', onPick: noop },
        { key: 'a', date: '2026-08-20', event: 'Organism created', onPick: noop },
      ]} picture=${html`<${Mermaid} chart=${snapshot(2)} />`} /><//>` },
    { name: 'no points yet', render: () => html`<${SettingsRoot}><${SnapshotTimeline} points=${[]} picture=${html`<p>No history yet.</p>`} /><//>` },
  ] },
  'mind-map': { variants: [
    { name: 'with options and heat', render: () => html`<${SettingsRoot}><${MindMap} chart=${ORG_MAP} onNode=${noop} hint="Press a node to open it."
      options=${[
        { kind: 'select', key: 'ws', label: 'Workspace', value: 'all', options: [['all', 'All workspaces'], ['briefs', 'Client briefs']], onChange: noop },
        { kind: 'check', key: 'heat', label: 'Show activity', checked: true, onChange: noop },
      ]} /><//>` },
    { name: 'the map alone', render: () => html`<${SettingsRoot}><${MindMap} chart=${'mindmap\n  root((Lumo Bakery))\n    Recipes\n    Suppliers'} onNode=${noop} /><//>` },
  ] },
  'doc-view': { variants: [
    { name: 'on a workspace page', render: () => html`<${SettingsRoot}><${DocView} title="Seat map study"
      tools=${html`<${Action} small onClick=${noop}>Edit<//> <${Action} small onClick=${noop}>Open in its own window<//>`}
      facts=${html`<${Mark} kind="time">Created 2 Sep<//> <${Mark} kind="status" tone="fine">published<//>`}>
      <${Markdown} text=${'## Findings\n\nTwelve bookings on the night route asked for a **window seat**. The seat map should show them first.\n\n- Deck 5: 40 window seats\n- Deck 6: 24 window seats'} /><//><//>` },
    { name: 'framed, its own window', render: () => html`<${SettingsRoot}><${DocView} framed title="Lumo Bakery: seasonal menu site"><${Markdown} text=${'The autumn menu goes live on 1 October. Rye and cardamom buns stay all year.'} /><//><//>` },
    { name: 'split editor', render: () => html`<${SettingsRoot}><${DocSplit}><textarea aria-label="Markdown" rows="6">## Findings${'\n'}Twelve bookings asked for a window seat.</textarea><${Markdown} text=${'## Findings\nTwelve bookings asked for a window seat.'} /><//><//>` },
  ] },
  // ── The Access and Memory pages ──
  'qr-code': { variants: [
    { name: 'default', render: () => html`<${SettingsRoot}><${QrCode} src=${QR} alt="QR code for your authenticator app" /><//>` },
    { name: 'small', render: () => html`<${SettingsRoot}><${QrCode} src=${QR} size=${120} alt="QR code for your authenticator app" /><//>` },
  ] },
  'code-grid': { variants: [
    { name: 'ten codes', render: () => html`<${SettingsRoot}><${CodeGrid} codes=${['4f7k-29qm', 'b8rt-11xz', 'p0wd-73hc', 'm2zs-48ka', 'q9ve-05lt', 'x3nu-62bf', 'c7jr-90wy', 'h1gd-37pe', 'k5oa-84si', 'r6tc-19mv']} /><//>` },
    { name: 'empty', render: () => html`<${SettingsRoot}><${CodeGrid} codes=${[]} /><//>` },
  ] },
  'stored-value': { variants: [
    { name: 'a text', render: () => html`<${SettingsRoot}><${StoredValue} name="studio/notes/ferry" value=${'The ferry timetable changes on Monday.\nThe night route leaves at 22:30.'} /><//>` },
    { name: 'Markdown', render: () => html`<${SettingsRoot}><${StoredValue} name="studio/briefs/lumo" value=${'## Lumo Bakery\n\n- Autumn menu from 1 October\n- **Rye and cardamom** all year'} /><//>` },
    { name: 'a flat object', render: () => html`<${SettingsRoot}><${StoredValue} name="studio/prices/day-rate" value=${{ currency: 'EUR', day: 640, half_day: 360, note: 'Travel is billed apart.\nWeekends double.' }} /><//>` },
    { name: 'as written', render: () => html`<${SettingsRoot}><${StoredValue} raw name="studio/prices/day-rate" value=${{ currency: 'EUR', day: 640 }} /><//>` },
    { name: 'nested', render: () => html`<${SettingsRoot}><${StoredValue} name="studio/clients" value=${{ nordic_ferries: { contact: 'harbour-ops', open: 2 }, lumo_bakery: { contact: 'lumo', open: 0 } }} /><//>` },
    { name: 'loading', render: () => html`<${SettingsRoot}><${StoredValue} value=${undefined} loadingLabel="Loading the value…" /><//>` },
  ] },
  // ── The overview, Portfolio and the Agents page ──
  'page-preview': { variants: [
    { name: 'a page', render: () => html`<${SettingsRoot}><${PagePreview} title="Lumo Bakery portfolio" srcdoc=${'<h1>Lumo Bakery</h1><p>Seasonal bread, baked at five. The autumn menu starts on 1 October.</p>'} /><//>` },
    { name: 'loading', render: () => html`<${SettingsRoot}><${PagePreview} title="Lumo Bakery portfolio" loading loadingLabel="Loading the page…" /><//>` },
  ] },
  'number-band': { variants: [
    { name: 'four numbers', render: () => html`<${SettingsRoot}><${NumberBand} items=${[
      { key: 'memory', n: 128, label: 'Memories', onOpen: noop }, { key: 'agents', n: 3, label: 'Agents', onOpen: noop },
      { key: 'apps', n: 2, label: 'Apps', onOpen: noop }, { key: 'morsels', n: 420, label: 'Morsels', fine: true, onOpen: noop },
    ]} /><//>` },
    { name: 'no numbers', render: () => html`<${SettingsRoot}><${NumberBand} items=${[]} /><//>` },
  ] },
  'open-card': { variants: [
    { name: 'an opened agent', render: () => agentCard() },
    { name: 'with what a mark opened', render: () => agentCard({ more: html`<${Mark}>memory:read<//><${Mark}>memory:write<//><${Mark}>tasks:write<//>` }) },
    { name: 'the whole window', render: () => html`<${SettingsRoot}><${OpenCard} title="research-assistant-with-a-long-name-for-a-phone"
      marks=${html`<${Mark} kind="status" tone="off">away<//>`}><${CardLine} label="Runs" below=${html`<p>It runs every morning at 06:00.</p>`}>On a schedule.<//><//><//>` },
  ] },
  'how-to': { variants: [
    { name: 'default', render: () => html`<${SettingsRoot}><${HowTo} html=${HOW_TO} /><//>` },
  ] },
  'setup-guide': { variants: [
    { name: 'classic', render: () => html`<${SettingsRoot}><${SetupGuide} /><//>` },
    { name: 'poster, facts, step rows', render: () => html`<${SettingsRoot}><${SetupGuide} poster facts stepRows /><//>` },
    { name: 'install aside', render: () => html`<${SettingsRoot}><${SetupGuide} poster asideInstall /><//>` },
    // The dialog stands over the guide, which gives its frame the height a dialog needs.
    { name: 'instructions dialog', render: () => html`<${SettingsRoot}><${SetupGuide} poster /><${InstructionsDialog} open onClose=${noop} /><//>` },
  ] },
  'instruction-block': { variants: [
    { name: 'your first organism', render: () => html`<${SettingsRoot}><${FirstOrganismBlock} /><//>` },
    { name: 'loading', render: () => html`<${SettingsRoot}><${InstructionBlock} orgId="" /><//>` },
    { name: 'cannot read', render: () => html`<${SettingsRoot}><${InstructionBlock} orgId="no-such-organism" /><//>` },
  ] },
  // ── Moved from demos-settings.js ──
  'colour-tag': { height: 160, variants: [
    { name: 'set and empty', render: () => html`<${SettingsRoot}>
      <p>A record marked blue <${ColorPicker} value="blue" title="Colour" noneLabel="No colour" onPick=${noop} /></p>
      <p>A document marked red <${ColorPicker} value="red" title="Colour" noneLabel="No colour" onPick=${noop} /></p>
      <p>No colour yet <${ColorPicker} value=${null} title="Colour" noneLabel="No colour" onPick=${noop} /></p><//>` },
  ] },
  'doc-tree': { variants: [
    { name: 'sections, one open', render: () => docTree({ sections: TREE, unsorted: UNSORTED }) },
    { name: 'a series open', render: () => docTree({ sections: [], unsorted: [{ ...UNSORTED[1], open: true }] }) },
    { name: 'renaming', render: () => docTree({ sections: TREE, editing: 's1' }) },
    { name: 'archived', render: () => docTree({ sections: [], unsorted: [doc('d7', 'Old price list')], archived: true }) },
    { name: 'empty', render: () => docTree({ sections: [], unsorted: null, empty: 'No documents yet. Write the first one.' }) },
  ] },
  'file-preview': { height: 420, variants: [
    { name: 'text', render: () => html`<${SettingsRoot}><${FilePreview} title="docs/notes.txt" kind="text" text=${'Ferry timetable changes on Monday.\nThe night route leaves at 22:30.'} onClose=${noop}
      doors=${html`<${Action} onClick=${noop}>Download<//>`} /><//>` },
    { name: 'image', render: () => html`<${SettingsRoot}><${FilePreview} title="photos/harbour.svg" kind="image" src=${PICTURE} onClose=${noop} /><//>` },
    { name: 'loading', render: () => html`<${SettingsRoot}><${FilePreview} title="docs/plan.md" kind="text" loading loadingLabel="Loading the preview…" onClose=${noop} /><//>` },
    { name: 'cannot read', render: () => html`<${SettingsRoot}><${FilePreview} title="docs/plan.md" kind="text" error errorLabel="The file could not be read." onClose=${noop} /><//>` },
    { name: 'no preview', render: () => html`<${SettingsRoot}><${FilePreview} title="exports/nordic-ferries-bookings-september-2026-final.xlsx" kind="other" noneLabel="This kind of file has no preview. Download it to open it." onClose=${noop} /><//>` },
  ] },
  'signed-out-door': { variants: [
    { name: 'with a tab', render: () => html`<${SignedOutDoor} address="aimeat.io/v1/profile?tab=security" path=${['Settings & Controls', 'Security']} ...${DOOR} />` },
    { name: 'the profile alone', render: () => html`<${SignedOutDoor} address="aimeat.io/v1/profile" path=${['Settings & Controls']} ...${DOOR} />` },
  ] },
  'address-preview': { variants: [
    { name: 'free', render: () => html`<${SettingsRoot}><${AddressPreview} label="Address" address="acme-widgets" state="free" free="free" /><//>` },
    { name: 'taken', render: () => html`<${SettingsRoot}><${AddressPreview} label="Address" address="acme" state="taken" taken="already taken" /><//>` },
    { name: 'checking', render: () => html`<${SettingsRoot}><${AddressPreview} label="Address" address="nordic-ferries-harbour-operations-and-timetables" state="checking" /><//>` },
  ] },
  'proof-ledger': { variants: [
    { name: 'passed and failed', render: () => html`<${SettingsRoot}><${ProofLedger} rows=${[
      { key: 'a', model: 'claude-haiku-4-5', pass: true, verdict: 'pass', tokens: '12,400 tok', date: '2026-09-20', evidence: 'proof-file-storage.json', evidenceTitle: 'libs/file-storage/proofs/proof-file-storage.json' },
      { key: 'b', model: 'gpt-4o-mini', pass: false, verdict: 'fail', tokens: '9,100 tok', date: '2026-09-18', evidence: 'proof-file-storage-2.json · self-reported', evidenceTitle: 'libs/file-storage/proofs/proof-file-storage-2.json' },
    ]} /><//>` },
    { name: 'empty', render: () => html`<${SettingsRoot}><${ProofLedger} rows=${[]} /><//>` },
  ] },
  changelog: { variants: [
    { name: 'with a breaking change', render: () => html`<${SettingsRoot}><${ChangeLog} entries=${[
      { key: 1, version: '1.1.3', date: '2026-09-20', summary: 'The legend wraps on a phone.' },
      { key: 2, version: '1.1.0', date: '2026-08-02', summary: 'Stacked bars.', breaking: 'Breaking: the colours option is a list' },
    ]} /><//>` },
    { name: 'long', render: () => html`<${SettingsRoot}><${ChangeLog} entries=${[
      { key: 1, version: '2.0.0-beta.12', date: '2026-09-26', summary: 'Charts read their colours from the theme, so a chart on a dark page stays readable, and the legend takes the series\' own names.' },
    ]} /><//>` },
  ] },
  'question-desk': { variants: [
    { name: 'with scopes', render: () => html`<${SettingsRoot}><${QuestionDesk} value="" placeholder="What are you looking for?" onInput=${noop} onEnter=${noop}
      scopes=${DESK_SCOPES} scope="own" onScope=${noop} scopeLabel="Where to look" hint="Searches your records, files and apps." /><//>` },
    { name: 'typed', render: () => html`<${SettingsRoot}><${QuestionDesk} value="ferry timetable" placeholder="What are you looking for?" onInput=${noop} onEnter=${noop}
      scopes=${DESK_SCOPES} scope="public" onScope=${noop} scopeLabel="Where to look" /><//>` },
    { name: 'no scopes', render: () => html`<${SettingsRoot}><${QuestionDesk} value="" placeholder="Ask anything" onInput=${noop} onEnter=${noop} /><//>` },
  ] },
  'gaii-chip': { variants: [
    { name: 'default', render: () => html`<${SettingsRoot}><${GaiiChip} gaii="bot#sandbox@aimeat-local-001-dev" label="Copy GAII" copiedLabel="Copied" /><//>` },
    { name: 'beside the name, long', render: () => html`<${SettingsRoot}><${Action} tone="quiet" onClick=${noop}>research-assistant<//> <${GaiiChip} gaii="research-assistant-for-nordic-ferries#sandbox@aimeat-local-001-dev" label="Copy GAII" copiedLabel="Copied" /><//>` },
  ] },
};
