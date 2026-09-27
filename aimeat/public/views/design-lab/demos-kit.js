/**
 * @file public/views/design-lab/demos-kit.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the kit's core parts of Settings & Controls: the action link and its slab (Action), the tag and the row label (Mark), the note (Note), the object box (Box), the avatar (Avatar), the roads (Roads) and the figure (Figure), each drawn by calling the real component with sample data, in
 *   the page's scope root (.pf) as Settings & Controls draws it. Also the parts these calls draw
 *   under older entries: the Card and its grid, the Facts, the Figure strip, the Code block, the
 *   Form message, the Setting box and the Loading mark.
 * @structure KIT_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { KIT_DEMOS } from './demos-kit.js';
 * @version-history
 *   v1.2.0 — 2026-09-27 — What the admin pages added: Loud quiet, SettingBox pre, Meter's tones, Result and a
 *     FigureStrip of buttons; the operator pages' parts in the operator's frame.
 *   v1.1.0 — 2026-09-27 — The kit's demos: action-component, mark, note, box, avatar, roads, figure; card moved in
 *     from demos-shell.js, facts, figure-strip, code-block, form-message, setting-box and loading-mark from
 *     demos-settings.js, each rewritten to call its component.
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import { h } from 'preact';
import htm from 'htm';
import { SettingsRoot } from '/components/SettingsFrame.js';
import { Action, Loud, Icon, Actions } from '/components/Action.js';
import { Mark, Marks, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box, SettingBox, SettingRow, SettingConfirm, BoxList, BoxLine } from '/components/Box.js';
import { Avatar } from '/components/Avatar.js';
import { Roads, Road } from '/components/Roads.js';
import { Figure, Result, Sticker, Meter, Tinted } from '/components/Figure.js';
import { Card, CardGrid } from '/components/Card.js';
import { Facts, FactLine } from '/components/Facts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { TextField } from '/components/TextField.js';
import { OperatorFrame } from '/components/OperatorFrame.js';

const html = htm.bind(h);
const noop = () => {};
const root = (children) => html`<${SettingsRoot}>${children}<//>`;
/** A part of an admin page, in the operator's frame as the page draws it. */
const op = (title, part) => html`<${OperatorFrame} title=${title}>${part}<//>`;
const PASTE = 'I run an AIMEAT node and I am its operator.\nRead its usage for the last 30 days.\nTell me which agent costs the most, and why.';
const LONG = 'A name long enough to wrap onto a second line on a narrow phone screen, as Nordic Ferries\' names do';
const REQUEST = 'Read the skill aimeat-writing with aimeat_skill_get, then rewrite the About text of Lumo Bakery in plain words.';

export const KIT_DEMOS = {
  'action-component': { variants: [
    { name: 'action, small, soft, row', render: () => root(html`<${Actions}>
      <${Action} onClick=${noop}>Open<//><${Action} small onClick=${noop}>Invite<//>
      <${Action} small soft onClick=${noop}>Show 13 more<//><${Action} small row onClick=${noop}>Edit<//><//>`) },
    { name: 'tones', render: () => root(html`<${Actions}>
      <${Action} small tone="danger" onClick=${noop}>Revoke<//><${Action} tone="more" onClick=${noop}>Show all<//>
      <${Action} tone="text" onClick=${noop}>Not now<//><${Action} tone="quiet" onClick=${noop}>Reset session<//>
      <${Action} tone="back" onClick=${noop}>Back<//><${Action} tone="notice" onClick=${noop}>What does that mean?<//>
      <${Action} tone="jump" onClick=${noop}>Latest<//><//>`) },
    { name: 'link in a sentence', render: () => root(html`<p>The key is kept by <${Action} tone="link" onClick=${noop}>Harbour Studio<//> until you take it back.</p>`) },
    { name: 'copy', render: () => root(html`<${Actions}><${Action} small soft copy=${REQUEST} copiedLabel="Copied">Copy the request<//><//>`) },
    { name: 'pressed and disabled', render: () => root(html`<${Actions}><${Action} small pressed onClick=${noop}>Listen<//><${Action} small disabled>Publish<//><//>`) },
    { name: 'link to a page', render: () => root(html`<${Actions}><${Action} small href="#" newTab>Open the app<//><${Action} small href="#" download="lumo-bakery.zip">Download<//><//>`) },
    { name: 'loud', render: () => root(html`<${Actions}><${Loud} onClick=${noop}>Connect an agent<//><${Loud} control onClick=${noop}>Save<//><${Loud} control danger onClick=${noop}>Delete<//><//>`) },
    { name: 'loud large', render: () => root(html`<${Loud} large onClick=${noop}>Start here<//>`) },
    { name: 'loud quiet: before its turn, and when it can act', render: () => root(html`<${Actions}><${Loud} quiet control disabled>Save the name<//><${Loud} control onClick=${noop}>Save the name<//><//>`) },
    { name: 'icon', render: () => root(html`<${Actions}><${Icon} label="Remove" onClick=${noop}>✗<//><${Icon} small label="More" onClick=${noop}>⋯<//><${Icon} small pressed label="In the collection" onClick=${noop}>✓<//><//>`) },
    { name: 'row at the end, under a panel', render: () => root(html`<${Actions} end><${Action} small onClick=${noop}>Cancel<//><${Loud} control onClick=${noop}>Send<//><//>
      <${Actions} under><${Action} small onClick=${noop}>Close<//><//>`) },
    { name: 'long', render: () => root(html`<${Actions}><${Action} small onClick=${noop}>${LONG}<//><//>`) },
  ] },
  mark: { variants: [
    { name: 'tags', render: () => root(html`<${Marks}><${Mark}>v1.4.0<//><${Mark} tone="sun">default<//><${Mark} tone="coral">new<//>
      <${Mark} tone="ink">yours<//><${Mark} tone="dim">not used yet<//><${Mark} tone="fine">knowledge hit<//><//>`) },
    { name: 'status', render: () => root(html`<${Marks}><${Mark} kind="status" tone="fine">running<//><${Mark} kind="status" tone="attention">waiting<//>
      <${Mark} kind="status" tone="danger">failed<//><${Mark} kind="status" tone="off">off<//><//>`) },
    { name: 'count and time', render: () => root(html`<p>Messages <${Mark} kind="count" tone="waiting">7<//> · agents <${Mark} kind="count" tone="tally">3<//>
      · <${Mark} kind="count" tone="waiting" small>2<//> · <${Mark} kind="time" title="2026-09-27 09:14">today 09:14<//></p>`) },
    { name: 'removable', render: () => root(html`<${Marks}><${Mark} onRemove=${noop} removeLabel="Remove bakery">bakery<//><${Mark} onRemove=${noop} whole>ferries<//><//>`) },
    { name: 'button, presence, explains, live', render: () => root(html`<${Marks}>
      <${Mark} tone="sun" onClick=${noop} title="Who may see this">public<//><${Mark} presence="online">invoice-drafter<//>
      <${Mark} presence="idle" away="away">bot<//><${Mark} kind="status" tone="attention" explains title="The manifest has no name">2 checks failed<//>
      <${Mark} live>MCP connected<//><//>`) },
    { name: 'label', render: () => root(html`<p><${Label}>Owner<//> sandbox</p><${Label} block>What your AI reads<//><p>The whole file, once a session.</p>`) },
    { name: 'code', render: () => root(html`<p>Ask your AI to run <${Code}>aimeat_skill_list<//> first.</p><${Code} block>${REQUEST}<//>`) },
    { name: 'empty', render: () => root(html`<${Marks}><//>`) },
    { name: 'long', render: () => root(html`<${Marks}><${Mark}>${LONG}<//><${Mark} tone="coral">short<//><//>`) },
  ] },
  note: { variants: [
    { name: 'hint', render: () => root(html`<${Note}>Your agents read this once a session.<//>`) },
    { name: 'slab hint', render: () => root(html`<${Actions}><${Loud} control disabled>Publish<//><${Note} inline slab>Pick an app first<//><//>`) },
    { name: 'lead', render: () => root(html`<div class="og"><${Note} kind="lead">Everyone in this space and what they may do.<//></div>`) },
    { name: 'quiet', render: () => root(html`<${Note} kind="quiet">No agents yet.<//><p>Status: <${Note} kind="quiet" inline>none<//></p>`) },
    { name: 'loading', render: () => root(html`<${Note} kind="loading" />`) },
    { name: 'message', render: () => root(html`<p><${Note} kind="message">Saved.<//></p><p><${Note} kind="message" error>The name is taken.<//></p>`) },
    { name: 'meta', render: () => root(html`<${Note} kind="meta">12 records · changed today<//><${Note} kind="meta" mono>created 2026-09-02 · v3 · 4 KB<//>`) },
    { name: 'aside', render: () => root(html`<${Note} kind="aside" size="small">Invited people see the space at once.<//>
      <${Note} kind="aside" tone="irreversible">Deleting the board removes its 57 notices. This cannot be undone.<//>
      <${Note} kind="aside" tone="waiting">Finish the sign-in in the other window.<//>
      <${Note} kind="aside" tone="suggestion">Connect your phone to hear new messages.<//>`) },
    { name: 'long', render: () => root(html`<${Note}>${LONG}. The hint wraps under itself and keeps its grey.<//>`) },
  ] },
  box: { variants: [
    { name: 'default', render: () => root(html`<${Box}><b>Recovery key</b> Keep it where you keep passwords.<//>`) },
    { name: 'head and doors', render: () => root(html`<${Box} name="Lumo Bakery package" marks=${html`<${Mark}>v1.2.0<//><${Mark} tone="sun">3 apps<//>`}
      end=${html`<${Icon} small label="Hide" onClick=${noop}>✗<//>`} doors=${html`<${Action} small onClick=${noop}>Install<//><${Action} small soft onClick=${noop}>Read the manifest<//>`}>
      Three apps and their records, ready to install.<//>`) },
    { name: 'raised', render: () => root(html`<${Box} tone="raised">The way to take first: ask your own AI.<//>`) },
    { name: 'copy', render: () => root(html`<${Box} tone="copy"><${Code} block>${REQUEST}<//><//>`) },
    { name: 'row', render: () => root(html`<${Box} tone="row">whisper-large-v3 · 2.1 s · "Order forty rolls for Friday."<//>`) },
    { name: 'attention, waiting, current, off', render: () => root(html`<${Box} tone="attention">The nightly run failed at step 2.<//>
      <${Box} tone="waiting">The run waits for your answer.<//><${Box} tone="current">Firefox on this laptop<//><${Box} tone="off">The weekly digest is off.<//>`) },
    { name: 'edge, field, dim', render: () => root(html`<${Box} tone="edge"><${Label} block>This node must already have<//><${Note} kind="lead">The invoice-drafter agent.<//><//>
      <${Box} tone="field"><${TextField} label="Request" value='{ "city": "Turku" }' onInput=${noop} /><//>
      <${Box} tone="dim">Manifest hash 9f2c… · signed by Harbour Studio<//>`) },
    { name: 'scroll, document, folded', render: () => root(html`<${Box} tone="copy" scroll document><p>${LONG}.</p><p>${REQUEST}</p><//>
      <${Box} folded unfoldLabel="Show all" onUnfold=${noop}><p>${REQUEST}</p><p>${LONG}.</p><//>`) },
    { name: 'beside', render: () => root(html`<${Box} beside doors=${html`<${Action} small onClick=${noop}>Run again<//>`}><b>Passed</b> 4 of 4 checks.<//>`) },
    { name: 'flush and packed', render: () => root(html`<${Box} flush><${Meter} pct=${40} /><//><${Box} packed>A box in a grid that spaces it.<//>`) },
    { name: 'box list', render: () => root(html`<${BoxList} apart>
      <${BoxLine} name="Order forty rolls" meta=${['invoice-drafter', { text: 'orders@lumo.example', keep: true }]} time="09:14" doors=${html`<${Action} small row onClick=${noop}>Open<//>`} />
      <${BoxLine} name="Chatbot for customers" end="limited risk" column meta="Tells a visitor they talk to an AI." /><//>`) },
    { name: 'setting box', render: () => root(html`<${SettingBox} irreversible label="Delete this agent">
      <${SettingRow}><${Note} inline>Removes the agent, its credentials and its task history.<//><${Action} small tone="danger" onClick=${noop}>Delete…<//><//>
      <${SettingConfirm}><${TextField} label="Type the agent's name to confirm: bot" value="" onInput=${noop} /><${Loud} control danger disabled>Delete<//><//><//>`) },
    { name: 'empty', render: () => root(html`<${Box} />`) },
    { name: 'long', render: () => root(html`<${Box} name=${LONG} marks=${html`<${Mark}>shared<//>`}>${LONG}.<//>`) },
    { name: 'setting box pre (an operator page)', render: () => op('Usage', html`<${SettingBox} pre label="For your own AI">${PASTE}<//>`) },
  ] },
  avatar: { variants: [
    { name: 'initials and one letter', render: () => root(html`<p><${Avatar} text="HS" /> <${Avatar} text="L" /> <${Avatar} text="NF" /></p>`) },
    { name: 'agent', render: () => root(html`<p><${Avatar} text="B" agent /> <${Avatar} text="?" agent /></p>`) },
    { name: 'identicon', render: () => root(html`<p><${Avatar} seed="sandbox@aimeat-local-001-dev" /> <${Avatar} seed="bot#sandbox@aimeat-local-001-dev" size="small" /></p>`) },
    { name: 'sizes', render: () => root(html`<p><${Avatar} text="HS" size="small" /> <${Avatar} text="HS" /> <${Avatar} text="PDF" size="large" label="PDF" /></p>`) },
    { name: 'empty', render: () => root(html`<p><${Avatar} text="" /></p>`) },
  ] },
  roads: { variants: [
    { name: 'two, wide, lead', render: () => root(html`<${Roads} wide>
      <${Road} lead name="Ask your AI" text="Copy the request into your own chat." code=${REQUEST} doors=${html`<${Action} small soft copy=${REQUEST}>Copy the request<//>`} />
      <${Road} name="Your agent does it" text="An agent with the skill scope calls the tools itself." meta="aimeat_skill_publish · aimeat_skill_link" /><//>`) },
    { name: 'three, chosen', render: () => root(html`<${Roads} cols="three">
      <${Road} chosen=${true} onPick=${noop} kicker="01 · chat" name="In your AI" text="Your AI writes the contact for you." doors=${html`<${Action} small onClick=${noop}>Copy prompt<//>`} />
      <${Road} chosen=${false} onPick=${noop} kicker="02 · form" name="Here" text="Type the name and the address." />
      <${Road} chosen=${false} kicker="03 · file" name="From a file" sub="a .vcf file" text="Bring the cards your phone exported." doors=${html`<${Action} small onClick=${noop}>Choose<//>`} /><//>`) },
    { name: 'code line', render: () => root(html`<${Roads} cols="three"><${Road} kicker="MCP" name="Claude Code" text="Adds the node as a server." codeLine="claude mcp add aimeat" /><${Road} kicker="REST" name="Any client" text="Reads the inbox with a token." codeLine="GET /v1/inbox" /><//>`) },
    { name: 'long', render: () => root(html`<${Roads}><${Road} name=${LONG} text=${LONG} /><${Road} name="Short" text="One line." /><//>`) },
  ] },
  figure: { variants: [
    { name: 'figures', render: () => root(html`<p><${Figure} small n="120" sub="morsels" /> <${Figure} n="57" /> <${Figure} large n="3" /> <${Figure} step n="2" /></p>`) },
    { name: 'tones and end', render: () => root(html`<p><${Figure} small end tone="fine" n="+120" sub="morsels" /> <${Figure} small end tone="notice" n="-40" sub="morsels" /> <${Figure} small tone="dim" n="·" /></p>`) },
    { name: 'band', render: () => root(html`<${Figure} band n="12" />`) },
    { name: 'sticker', render: () => root(html`<${Sticker} figure="L3"><${Action} small onClick=${noop}>Scopes<//><//>`) },
    { name: 'meter', render: () => root(html`<${Meter} pct=${40} /><${Meter} quota pct=${72} early figure="7.20 € / 10 € · 72 %" /><${Meter} quota pct=${95} figure="95 %" /><${Meter} thin pct=${60} />`) },
    { name: 'meter beside and fill', render: () => root(html`<p>Pace <${Meter} beside pct=${30} figure="30 / 100" /></p><div><${Meter} quota fill pct=${50} figure="5 € / 10 €" /></div>`) },
    { name: 'tinted', render: () => root(html`<p><${Tinted} strong tone="fine">On<//> for the web, <${Tinted} tone="notice">off<//> for mail, <${Tinted} tone="warn">slow<//>,
      <${Tinted} tone="danger">down<//>, <${Tinted} tone="dim">unknown<//>, <${Tinted} tone="faint">never<//>, <${Tinted} whole>harbour-studio.apps.aimeat.io<//>.</p>`) },
    { name: 'empty meter', render: () => root(html`<${Meter} pct=${0} quota />`) },
    { name: 'meter tones (an operator page)', render: () => op('Agent integration', html`<${Meter} tone="notice" pct=${25} figure="1 of 4 agents ready" />
      <${Meter} tone="ink" pct=${60} figure="bot · 60 % of the calls" /><${Meter} tone="dim" pct=${15} figure="invoice-drafter · 15 %" />`) },
    { name: 'result', render: () => root(html`<${Result} label="Result before taxes" n="+1,240 €" sub="September, Harbour Studio" tone="fine" />
      <${Result} label="Result before taxes" n="-310 €" sub="August, Lumo Bakery" tone="danger" /><${Result} label="Result before taxes" n="0 €" />`) },
  ] },
  card: { variants: [
    { name: 'ruled tiles', render: () => root(html`<${CardGrid}>
      <${Card} name="Memory" meta="1,204 records" /><${Card} name="Files" text="Pictures and documents your agents saved." meta="38 files · 12 MB" />
      <${Card} name="Boards" meta="3 boards" lines=${[{ key: 'a', label: 'Harbour Studio', count: 12 }, { key: 'b', label: 'Lumo Bakery', count: 4 }, { key: 'c', label: '2 more', dim: true }]} /><//>`) },
    { name: 'framed tiles', render: () => root(html`<${CardGrid}>
      <${Card} tone="framed" state="current" name="Firefox on this laptop" meta="push · since 2026-09-02" doors=${html`<${Action} small onClick=${noop}>Send a test<//>`} />
      <${Card} tone="framed" state="off" name="Weekly digest" meta="off" />
      <${Card} tone="framed" state="raised" kicker="new" name="Nordic Ferries" text="Timetables your agents can read." codeLine="aimeat_app_get nordic-ferries" /><//>`) },
    { name: 'door tiles', render: () => root(html`<${CardGrid} cols="fill">
      <${Card} name="Lumo Bakery" mark=${html`<${Avatar} text="LB" />`} text=${LONG} clamp meta="sandbox" onOpen=${noop} openLabel="Open" />
      <${Card} name="Invoice drafts" meta=${html`<${Mark} kind="status" tone="attention">Not in the catalog<//>`} onOpen=${noop} openLabel="Open" /><//>`) },
    { name: 'sections', render: () => root(html`<${CardGrid} cols="sections">
      <${Card} tone="section" title="Passkeys" aside=${html`<${Mark}>2<//>`}><p>Sign in without a password.</p><//>
      <${Card} tone="section" title="Two-step sign-in"><${Note}>On since 2026-09-02.<//><//>
      <${Card} tone="section" wide><p>A section across the whole grid.</p><//><//>
      <${Card} tone="section" inRow><p>A section inside a list row.</p><//>`) },
    { name: 'panels', render: () => root(html`<${CardGrid} cols="panels">
      <${Card} tone="panel" title="Agents" note="3 connected" onOpen=${noop} openLabel="Open Agents" />
      <${Card} tone="panel" title="Usage & quotas" rule><${Meter} quota pct=${40} /><//>
      <${Card} tone="panel" wide title="AI spend"><p>1.20 € this month.</p><//><//>`) },
    { name: 'figures', render: () => root(html`<${CardGrid} cols="figures"><${Card} tone="figure" figure="12" name="apps" onOpen=${noop} openLabel="Open Apps" /><${Card} tone="figure" figure="0" name="boards" /><//>`) },
    { name: 'two and one column', render: () => root(html`<${CardGrid} cols="two"><${Card} name="Last letter" meta="today" /><${Card} name=${LONG} meta="yesterday" /><//>
      <${CardGrid} cols="one"><${Card} tone="framed" mark="#" name="Charts" text="Draw your records as charts." onOpen=${noop} /><//>`) },
    { name: 'classic', render: () => html`<${Card} title="Storage" subtitle="What this node keeps"><p>Two files.</p><//>` },
    { name: 'classic glass', render: () => html`<${Card} variant="glass" title="Storage" subtitle="What this node keeps"><p>Two files.</p><//>` },
    { name: 'empty grid', render: () => root(html`<${CardGrid} />`) },
  ] },
  facts: { variants: [
    { name: 'default', render: () => root(html`<${Facts} rows=${[
      { k: 'Version', v: '1.4.0', sub: 'published today' },
      { k: 'Used by', v: 'claude-code, codex and a name long enough to wrap onto a second line on a phone' },
      { k: 'Owner', v: 'sandbox@aimeat-local-001-dev', mono: true, action: html`<${Action} small copy="sandbox@aimeat-local-001-dev">Copy<//>` },
    ]} />`) },
    { name: 'wide and flush', render: () => root(html`<${Box}><${Facts} wide flush rows=${[{ k: 'What your AI reads', v: 'The whole file, once a session.' }]} /><//>`) },
    { name: 'warn, missing, pre', render: () => root(html`<${Facts} rows=${[
      { k: 'Policy issues', v: 2, warn: true }, { k: 'Model', v: 'model default', missing: true }, { k: 'Value', v: '{\n  "city": "Turku"\n}', pre: true },
    ]} />`) },
    { name: 'state names', render: () => root(html`<${Facts} rows=${[{ k: '200', state: 'fine', v: '1,204' }, { k: '429', state: 'attention', v: 12 }, { k: '500', state: 'danger', v: 1 }]} />`) },
    { name: 'lines, marks, actions', render: () => root(html`<${Facts} rows=${[
      { k: 'Schedules', v: [html`<${FactLine} key="a" sub="ran 09:00">Morning digest<//>`, html`<${FactLine} key="b" sub="not in the scheduler" subTone="notice">Night sync<//>`] },
      { k: 'Tags', v: html`<${Marks}><${Mark}>bakery<//><${Mark}>orders<//><//>`, actions: html`<${Action} small onClick=${noop}>Edit tags<//>` },
      { k: 'Budget', v: html`<${Meter} quota pct=${40} figure="4 € / 10 €" />` },
    ]} />`) },
    { name: 'empty', render: () => root(html`<${Facts} rows=${[]} />`) },
  ] },
  'figure-strip': { variants: [
    { name: 'four figures, one a word', render: () => root(html`<${FigureStrip} items=${[
      { n: 12, label: 'spaces', sub: '3 shared with you' }, { n: 4, of: '/6', label: 'people', sub: '2 admins' },
      { n: 'today', tone: 'coral', label: 'last change', sub: 'by second' }, { n: 190, label: 'records', sub: '27 KB' },
    ]} />`) },
    { name: 'tones', render: () => root(html`<${FigureStrip} items=${[
      { n: 'ok', tone: 'word fine', label: 'last run' }, { n: 3, tone: 'notice', label: 'waiting' }, { n: 1, tone: 'warn', label: 'slow' },
      { n: 1, tone: 'danger', label: 'failed' }, { n: '·', tone: 'dim', label: 'none yet', sub: '' },
    ]} />`) },
    { name: 'long, wrap', render: () => root(html`<${FigureStrip} wrap items=${[
      { n: 'orders@lumo-bakery.example', tone: 'long', label: 'address', sub: 'every letter to this address reaches your inbox and your agents' }, { n: 2, label: 'aliases', sub: '' },
    ]} />`) },
    { name: 'lead and flush', render: () => root(html`<${FigureStrip} lead items=${[{ n: 57, label: 'boards' }, { n: 3, label: 'yours' }]} /><${Box}><${FigureStrip} flush items=${[{ n: 4, label: 'rules' }]} /><//>`) },
    { name: 'loading', render: () => root(html`<${FigureStrip} loading=${4} />`) },
    { name: 'figures that are buttons (an operator page)', render: () => op('Owners', html`<${FigureStrip} items=${[
      { n: 3, label: 'owners', sub: 'show all', onClick: noop, title: 'Show every owner' },
      { n: 1, tone: 'notice', label: 'disabled', sub: 'show them', onClick: noop, title: 'Show the disabled owners' },
      { n: 12, label: 'agents', sub: 'on this node' },
    ]} />`) },
  ] },
  'code-block': { variants: [
    { name: 'block', render: () => root(html`<${Code} block>aimeat_skill_get aimeat-writing\n# a second line long enough to wrap on a narrow screen, as the pages wrap it<//>`) },
    { name: 'inline', render: () => root(html`<p>Ask your AI to run <${Code}>aimeat_skill_list<//> first.</p>`) },
    { name: 'scroll and tall', render: () => root(html`<${Code} block scroll>${Array.from({ length: 20 }, (_, i) => `"field${i}": { "type": "string" },`).join('\n')}<//><${Code} block tall>${REQUEST}<//>`) },
    { name: 'added and removed', render: () => root(html`<${Code} block change="added">${'+ <h1>Lumo Bakery</h1>'}<//><${Code} block change="removed">${'- <h1>Bakery</h1>'}<//>`) },
    { name: 'blurred', render: () => root(html`<p>Recovery key: <${Code} blurred>RK-4F2C-9A1B-77D0<//></p>`) },
  ] },
  'form-message': { variants: [
    { name: 'done', render: () => root(html`<${Note} kind="message">Saved. Your agents see it at once.<//>`) },
    { name: 'refused', render: () => root(html`<${Note} kind="message" error>The name is taken.<//>`) },
    { name: 'several problems', render: () => root(html`<${Note} kind="message" error pre>${'The rule has no name.\nThe provider "acme" is not known.'}<//>`) },
  ] },
  'setting-box': { variants: [
    { name: 'a row and its confirmation', render: () => root(html`<${SettingBox} label="Leave">
      <${SettingRow}><${Note} inline>You can come back when someone invites you.<//><${Action} small onClick=${noop}>Leave<//><//>
      <${SettingConfirm}><${TextField} label="Type the name" value="Harbour" onInput=${noop} /><${Loud} control onClick=${noop}>Confirm<//><//><//>`) },
    { name: 'irreversible', render: () => root(html`<${SettingBox} irreversible label="Delete this board">
      <${SettingRow}><${Note} inline>Removes the board and its 57 notices. This cannot be undone.<//><${Action} small tone="danger" onClick=${noop}>Delete…<//><//><//>`) },
    { name: 'pre: a prompt to paste (an operator page)', render: () => op('Statistics', html`<${SettingBox} pre label="For your own AI">${PASTE}<//>`) },
  ] },
  'loading-mark': { variants: [
    { name: 'default', render: () => root(html`<${Note} kind="loading" />`) },
    { name: 'with words, inline', render: () => root(html`<${Note} kind="loading">Loading the boards…<//><p>Agents: <${Note} kind="loading" inline /></p>`) },
  ] },
};
