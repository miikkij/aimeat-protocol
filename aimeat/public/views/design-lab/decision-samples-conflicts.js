/**
 * @file public/views/design-lab/decision-samples-conflicts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live samples and proposal pictures of the conflicts round of Settings &
 *   Controls (decisions-conflicts.js), in the shape decision-samples.js describes: per sample
 *   `measure`, `solo` and `after`. decision-samples.js spreads these into SAMPLES and PROPOSALS, so
 *   every reader still takes one list from it. The few shared helpers (html, row, after, tone and
 *   kin) are copied here rather than imported, because that file imports this one and uses them at
 *   load time.
 *
 *   What a Settings page draws today (the chosen look, or the after picture of an accepted
 *   proposal) is drawn by calling the component the page calls, with the same data. An option Jouni
 *   did not choose keeps the markup it was chosen against: its page classes, or the lab's own.
 * @structure CONFLICT_SAMPLES — { [decisionId]: [{ id, measure, solo?, render(), after }] } · CONFLICT_PROPOSALS — { [decisionId]: { measure, render() } }
 * @usage import { CONFLICT_SAMPLES, CONFLICT_PROPOSALS } from './decision-samples-conflicts.js';
 * @version-history
 *   v1.4.1 — 2026-09-27 — The Nodes head's picture finds the Tabs bar by its own name (.tab-row--bar);
 *     the old row (.sub-tabs) keeps its rule in design-lab-proposals.css. The MCP guide's pictures
 *     wear the guide's and the block's own names (.setup-guide-*, .instruction-block-*), the same rules.
 *   v1.4.0 — 2026-09-27 — What the Settings pages draw today is drawn by their components (the
 *     catalogue pass): the overview's head (ProfileCard), the numbered rows (IndexList, IndexItem,
 *     IndexStep), Messages' list, message and typing box (ListPanel, MessageBubble, Composer's
 *     message tone), the code block (Code), the roads and boxes (Road, Box), the sub-heading
 *     (SubHeading), the Settings head (SettingsPage, Tabs), the check line (Check), the meta line and
 *     the file list (List), the stars (Stars), the small reader (Markdown small), the dashed field
 *     box (Box field, TextField box), the question box (Box, Tabs) and the remove mark (TagInput,
 *     Mark). The options Jouni did not choose keep their markup.
 *   v1.3.0 — 2026-09-26 — Wave 4: a chip's remove mark (an agent's tag, a board's members) and the
 *     eight other lists of Settings for the numbered list, each drawn again as the home's rows.
 *   v1.2.0 — 2026-09-26 — The small readers drawn inside the Settings frame's body and the dashed
 *     boxes inside an opened row, as their pages draw them (found by the real-page crops).
 *   v1.1.0 — 2026-09-25 — Wave 3: rating stars, activity log, small reader, MCP guide, file pick
 *     list, dashed field box and question box, drawn from their pages' markup with fixed words.
 *   v1.0.0 — 2026-09-25 — Moved out of decision-samples.js unchanged (the file neared the 800-line
 *     limit; a move).
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect } from 'preact/hooks';
import { Turn } from '/components/Turn.js';
import { ThreadList } from '/components/ThreadList.js';
import { ConversationScroll } from '/components/ConversationFrame.js';
import { Masthead, MastheadButton, MastheadCog } from '/components/Masthead.js';
import { NumberedIndex, IndexItem, IndexList, IndexStep } from '/components/NumberedIndex.js';
import { Composer } from '/components/Composer.js';
import { Markdown } from '/components/Markdown.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import { TimelineRow, TimelineList } from '/components/Timeline.js';
import { SwatchPicker } from '/components/SwatchPicker.js';
import { Thread } from '/components/Message.js';
import { Box } from '/components/Box.js';
import { Road } from '/components/Roads.js';
import { Mark, Marks, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { SubHeading } from '/components/SubHeading.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Tabs } from '/components/Tabs.js';
import { Check } from '/components/Check.js';
import { List, Row, Name, Desc, Doors, Panel } from '/components/List.js';
import { Stars } from '/components/Stars.js';
import { TagInput } from '/components/TagInput.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
// The shared helpers of decision-samples.js, the same lines.
const noop = () => {};
const row = (children) => html`<div class="poster-specimen-row">${children}</div>`;
const AT = '2026-09-23T10:42:00Z';
/** An element as the proposal draws it, alone: the `after` of a sample. `measure` defaults to `solo`. */
const after = (solo, render, measure) => ({ solo, render, measure });
/** Admin parts read their colours from the admin page's own variables, set on `.adm`. */
const adm = (children) => html`<div class="adm">${children}</div>`;
const action = (text) => html`<a class="poster-action" href="#">${text}</a>`;
/** A tone of a proposal, captioned with its name under the example word. */
const tone = (name, children) => html`<span class="poster-specimen-tone">${children}<small>${name}</small></span>`;

/**
 * A part of a Settings page, imported only in the frame that draws it: every lab frame loads this
 * file, and a static import would make each of them load the Settings modules too (about 180 more
 * requests a frame). The frame measures again when the part arrives, because its size changes.
 * Relative paths: the importmap names none of these /views/profile/ modules.
 */
function Late({ from, draw }) {
  const [mod, setMod] = useState(null);
  useEffect(() => {
    let alive = true;
    from().then((m) => { if (alive) setMod(m); });
    return () => { alive = false; };
  }, [from]);
  return mod ? draw(mod) : null;
}
const overviewCards = () => import('../profile/landing-page.cards.js');
const inboxParts = () => import('../profile/inbox-tab/components.js');
const inboxListPanel = () => import('../profile/inbox-tab/list-panel.js');
// ── The conflicts round of Settings & Controls: one person's data, as the pages give it ──
/** Settings parts are drawn inside the Settings scope root; Messages parts inside its page, too. */
const pf = (children) => html`<div class="pf">${children}</div>`;
const messages = (children) => pf(html`<div class="og og-ib">${children}</div>`);
/** A list as wide as its page's column: the chat's side column and Messages' list are narrow. */
const column = (children) => html`<div class="dl-column">${children}</div>`;
const ME = { owner: 'aino', displayName: 'Aino', ghii: 'aino@example-node' };
const PEER = 'mika@example-node';
const face = minidenticon(ME.owner);
const homeHead = () => html`<${Masthead} avatarSvg=${face} name=${ME.displayName} identity=${ME.ghii}>
  <a class="poster-action" href="#">All settings and controls →</a>
  <${MastheadButton} onClick=${noop}>${MastheadCog}<span>Home settings</span><//><//>`;
/** The overview's head as the page draws it today (ProfileCard: the home's Masthead, its own lines and doors kept). */
const overviewHead = () => pf(html`<${Late} from=${overviewCards} draw=${({ ProfileCard }) => html`<${ProfileCard} tier="regular" stats=${{}} session=${ME} onEditProfile=${noop} switchTab=${noop} />`} />`);
const PLAYBOOKS = ['A shop that is open by this afternoon', 'A company that remembers', 'Your own page'];
const STEPS = [
  ['Write self-organizing notes', 'Just write things down. The AI sorts each note into the right workspace for you.'],
  ['Create your portfolio', 'A polished page that tells others who you are and what you do.'],
  ['Use agents others shared', 'Browse ready agents people published and put them to work for you.'],
];
/** One row of the home's list (IndexItem): `line` is the line under the name, `first` the yellow
    first step and `open` the home's opened row.
    @param {any} name
    @param {{ line?: any, first?: boolean, open?: boolean }} [opts] */
const indexRow = (name, { line, first = false, open = false } = {}) => html`
  <${IndexItem} key=${typeof name === 'string' ? name : undefined} first=${first} on=${open} expanded=${open || undefined} line=${line || undefined} onClick=${noop}>${name}<//>`;
const indexList = (rows) => html`<${IndexList}>${rows}<//>`;
/** The overview's next steps as NextSteps (landing-page.cards.js) draws them; the component reads which steps to show from the network. */
const stepsAsIndex = () => pf(indexList(STEPS.map(([title, desc], i) => indexRow(title, { line: desc, first: i === 0 }))));
const THREADS = [{ id: 't1', title: 'List all my apps.', turns: 2 }, { id: 't2', title: 'Put up my welcome page', turns: 2 }, { id: 't3', title: 'Make me a pong game', turns: 4 }];
/** Messages' conversations with one person, as the server lists them; the times are today's, as on a fresh inbox. */
const conversations = () => {
  const now = new Date().toISOString();
  const c = (id, subject, lastMessage, lastDirection, unread) => ({ conversationId: id, peerGhii: PEER, subject, lastMessage, lastDirection, updatedAt: now, unread, section: 'people' });
  return [c('c1', 'Re: Brand colours', 'Yes, within the palette. I will send two options.', 'outbound', 0),
    c('c2', 'Brand colours', 'The client wants the coral a little warmer.', 'inbound', 1),
    c('c3', 'Studio lunch', 'Lunch on Friday at noon, the usual place.', 'inbound', 1)];
};
const ORG = { selecting: false, selected: new Set(), isCollapsed: () => false, toggleCollapsed: noop, archive: noop, startSelecting: noop, endSelecting: noop, toggleSelected: noop };
/** Messages' list as the page draws it (ListPanel: ConversationList, the chat's rows under each person's heading); `open` is the conversation you are reading. */
const inboxList = (open = null) => messages(html`<div class="dl-column"><${Late} from=${inboxListPanel} draw=${({ ListPanel }) => html`<${ListPanel} requests=${[]} conversations=${conversations()} activeConv=${open ? { conversationId: open } : null}
  peerDisplay=${(g) => String(g).split('@')[0]} accept=${noop} block=${noop} openConversation=${noop} org=${ORG} />`} /></div>`);
const THEIRS = { id: 'm1', senderGhii: PEER, body: 'The client wants the coral a little warmer. Is that possible within the palette?', createdAt: AT, attachments: [] };
const MINE = { id: 'm2', senderGhii: ME.ghii, body: 'Yes, within the palette. I will send two options.', createdAt: AT, status: 'read', attachments: [] };
const bubble = (MessageBubble, msg, mine) => html`<${MessageBubble} msg=${msg} mine=${mine} who=${mine ? 'You' : 'mika'} urlMap=${{}} starred=${false}
  onStar=${noop} onTrack=${noop} onPark=${noop} onReplyAi=${noop} onQuote=${noop} onDelete=${noop} onJumpTo=${noop} />`;
/** Two Messages messages as the page draws them (MessageBubble: the Message, the chat's turn). */
const bubbles = () => messages(html`<${Thread}><${Late} from=${inboxParts}
  draw=${({ MessageBubble }) => html`${bubble(MessageBubble, THEIRS, false)}${bubble(MessageBubble, MINE, true)}`} /><//>`);
/** Messages' typing box as the page draws it (Composer, its message tone), with something typed. */
const inboxComposer = () => messages(html`<${Composer} tone="message" recipient=${PEER} sendLabel="Reply" sending=${false} onSend=${noop} initialText="I will send two options." />`);
/** The action link's small tone, which keeps the Settings door's look (lab classes; `more` adds the row or lower-case tone). */
const small = (text, more = '') => html`<button type="button" class=${'poster-action dl-action--small' + more}>${text}</button>`;
/** A ready-made request as the pages show one; long enough to wrap in a lab frame. */
const CODE = 'Which apps and tokens act in my name in AIMEAT, what may each one do, and which have not been used in a month? Tell me whether two-step sign-in is on.';
const codeBlock = () => pf(html`<${Code} block>${CODE}<//>`);
// The five more of the round: the words their pages show.
const ROAD_NAME = 'Ask your AI';
const ROAD_TEXT = 'Copy this into your conversation and replace the bracketed parts with your own.';
const RULE = html`<span class="poster-label">The rule your AI needs</span><p>Before running an app, list its bound skills and read them.</p>`;
/** The rule box as Skills draws it today (Box with its row label and lead). */
const ruleBox = () => pf(html`<${Box}><${Label} block>The rule your AI needs<//><${Note} kind="lead">Before running an app, list its bound skills and read them.<//><//>`);
const README = 'An organism\'s readme: what this shared space is for and who looks after it.';
const SCOPE = html`Effective data scope for this agent: agents.shared.index<div class="poster-hint pf-agd-scope-footer">This summary is included in the agent's skill bundle so it knows its data boundaries.</div>`;
/** The agent's data scope as its Memory tab draws it today (tab-data-access.js: Box, Code block, Note). */
const scopeBox = () => pf(html`<${Box}><${Code} block>${'Effective data scope:\nagents.shared.index'}<//><${Note}>This summary is included in the agent's skill bundle so it knows its data boundaries.<//><//>`);
/** A sub-heading as the pages draw one today (the proposal's look). */
const subHead = (text) => pf(html`<${SubHeading} level=${4}>${text}<//>`);
/** The Settings head (SettingsPage without a rail: the crumb, the title and its line), with what stands under it. */
const kitHead = (crumbs, title, line, below = null) => pf(html`<${SettingsPage} page crumb=${crumbs} title=${title} desc=${line}>${below}<//>`);
/** The Nodes page's two tabs as they were, a row without a head (the option). */
const NODE_TABS = html`<div class="sub-tabs poster-row--thing"><button type="button" class="poster-tab is-on">Nodes</button><button type="button" class="poster-tab">Node Stats</button></div>`;
/** The Nodes page with the Settings head, its tabs under the line (Tabs bar); the line is the page's own (profile.nodes.desc). */
const nodesHead = () => kitHead(['Settings & Controls', 'Infrastructure', 'Nodes'], 'Nodes',
  'Your own server is a machine you run your own AIMEAT on: a laptop, a NAS, or a computer at home.',
  html`<${Tabs} bar kind="view" value="nodes" onSelect=${noop} items=${[{ value: 'nodes', label: 'Nodes' }, { value: 'stats', label: 'Node Stats' }]} />`);
/** One List row with its name and the grey line under it. */
const listing = (meta, name = 'aimeat-writing') => pf(html`<${List} cols="name-desc-doors"><${Row}>
  <${Name} meta=${meta}>${name}<//><${Desc}>How prose is written on this project.<//><${Doors} /><//><//>`);
/** Check lines as the pages draw them today (Check). */
const checks = (a, b) => pf(html`<${Check} checked=${true} onChange=${noop}>${a}<//><${Check} checked=${false} onChange=${noop}>${b}<//>`);

// ── Wave 3: the words their pages show. ──
/** The library's Rating stars (Stars): read in a line, or to give. */
const starsShown = (n, bare = false) => { const s = html`<${Stars} value=${n} />`; return bare ? s : pf(s); };
const starsGive = (n) => pf(html`<${Stars} value=${n} onPick=${noop} label="Rate this" />`);
const EVENTS = [{ what: 'started', said: 'Task started' }, { what: 'todo_completed', said: 'TODO "Open the map" done' }, { what: 'rating', said: 'Rated 4★ (creative)' }];
/** The home's Timeline with the agent's events; `kind` keeps the Activity tag before the line. */
const timeline = (kind) => html`<${TimelineList}>${EVENTS.map((e) => html`<${TimelineRow} key=${e.what} category="agent" when="07:53" href="#"
  text=${kind ? html`<${Mark}>Tasks<//> ${e.what}: ${e.said}` : `${e.what}: ${e.said}`} />`)}<//>`;
const README_MD = '## What it does\n\nAnswers mail and checks `seat maps`. Quiet by default.\n\n- Answers mail\n- Checks seat maps\n\n```\nnpx aimeat connect\n```';
/** A Settings tab's body (settings-frame.css), whose own rules reach what is drawn in it. */
const inFrame = (children) => pf(html`<div class="settings-frame-body">${children}</div>`);
/** An opened Listing row's panel (listing.css), as a row that opens drew it when the options were chosen. */
const inOpenRow = (children) => pf(html`<div class="listing"><div class="listing-row is-open"><div class="listing-open poster-frame">${children}</div></div></div>`);
/** An opened row's panel as the pages draw it today (List, Row open, Panel). */
const inPanel = (children) => pf(html`<${List} cols="name"><${Row} open><${Panel}>${children}<//><//><//>`);
/** The Markdown reader's small cut (Markdown small), the proposal the pages draw today. */
const smallReader = () => html`<${Markdown} text=${README_MD} small />`;
/** The MCP guide's command and instruction block (setup-guide.css, instruction-block.css), bare or dressed as the MCP page dressed it. */
const guide = (scope) => pf(html`<div class=${scope}><div class="setup-guide-cmd"><pre class="setup-guide-cmd-text">claude mcp add --transport http aimeat https://example-node/mcp</pre></div>
  <div class="instruction-block"><pre class="instruction-block-text">AIMEAT: my own server\n\nI work on the AIMEAT node at https://example-node. Read aimeat_handbook_get first.</pre></div></div>`);
const FILES = [{ name: 'agent.md', desc: 'Updated: 9/25/2026' }, { name: 'skills.yaml', desc: 'Updated: 9/24/2026' }, { name: 'policy.json', desc: 'Updated: 9/20/2026' }];
/** The file picked in every picture: the second, so the first row reads as an ordinary row. */
const PICKED = 1;
/** The file list as an agent's Agent Config draws it (List rows that open; the picked one's file in its panel). */
const fileListing = (open) => pf(html`<${List} cols="name-doors">${FILES.map((f, i) => {
  const on = open && i === PICKED;
  return html`<${Row} key=${f.name} open=${on} onToggle=${noop} panel=${on ? html`
    <${SubHeading} inline>Viewing: ${f.name}<//>
    <${Actions}><${Action} small onClick=${noop}>Edit<//><${Action} small onClick=${noop}>Copy<//><${Action} small onClick=${noop}>Download<//><//>` : null}>
    <${Name} dot="active" meta=${f.desc}>${f.name}<//><${Doors}><${Mark}>claude-code<//><//><//>`;
})}<//>`);
const ASK = { q: 'Seat map review: which layout do we send?', sub: 'Asked today. It waits until Friday.', answers: ['Layout A', 'Layout B', 'Both'] };
/** A workflow's waiting question as it was chosen from (cover.js markup): `og` as it was, `ink` the sun box with dark tabs (lab class). */
const ask = (kind) => pf(html`<div class="wp-ask"><b>${ASK.q}</b><p>${ASK.sub}</p>
  ${kind === 'og'
    ? html`<div class="og-choice wp-ask-choice">${ASK.answers.map((a, i) => html`<button type="button" key=${a} class=${'og-choice-btn' + (i === 1 ? ' on' : '')}>${a}</button>`)}</div>`
    : html`<div class="poster-specimen-row">${ASK.answers.map((a, i) => html`<button type="button" key=${a} class=${'poster-tab' + (i === 1 ? ' is-on' : '') + ' dl-tab-ink'}>${a}</button>`)}</div>`}
  <div class="og-doors"><button type="button" class="poster-slab poster-slab--control">Answer and go</button><button type="button" class="poster-action">Open the run</button></div></div>`);
/** The question as Workflows draws it today (cover.js questionBlock: Box, the answers as Tabs, Loud and Action). */
const askNow = () => pf(html`<${Box} name=${ASK.q} doors=${html`<${Loud} control onClick=${noop}>Answer and go<//><${Action} small onClick=${noop}>Open the run<//>`}>
  <${Stack}><${Note}>${ASK.sub}<//><${Tabs} kind="toggle" label=${ASK.q} value=${['Layout B']} onSelect=${noop} items=${ASK.answers.map((a) => ({ value: a, label: a, key: a }))} /><//><//>`);

// ── Wave 4: the eight other lists of Settings and a chip's remove mark, with the words their pages show. ──
const WALLET_STEPS = [['Create a Stripe account and activate payments:', 'dashboard.stripe.com/register'], ['In the Stripe Dashboard, open Developers → API keys:', 'dashboard.stripe.com/apikeys'],
  ['Reveal and copy the Secret key, which starts with sk_live_. To try things out first, use the test mode key, sk_test_.'], ['Paste the key into the field above and save.']];
const CAL_PROPOSALS = ['Ask for the answer in one sentence first, then the reasons.', 'Name the reader the answer is for.', 'Drop the example that shows a list: the target output has none.'];
const MCP_STEPS = ['Open claude.ai and go to Settings, then Connectors. On Pro and Max the path is Customize > Connectors.', 'Click + and then Add custom connector.',
  'Fill the fields with the values below and click Add.', 'Sign in to this node in the tab that opens, with your own account.', 'Start a NEW conversation.'];
const BASIC_AGENTS = [['Concierge', 'Always on', 'The front door. Takes what arrives, works out what it is about, answers what it can, and hands the rest to whoever should have it.'],
  ['Workflow manager', 'On demand', 'Orders work from your other agents and keeps track of what came back.']];
/** The words of a server's setup steps carry their own number (profile.nodes.setupStep1-4). */
const NODE_STEPS = ['1. Open a WebSocket tunnel to the address above, sending your token in the Authorization header.', '2. Send a heartbeat message every 30 seconds. Without it the server is marked offline.',
  '3. When the server reconnects, whatever was waiting in its mailbox is delivered to it.', '4. Confirm each message you receive with a mailbox_ack message.'];
const ECO_STEPS = ['The app publishes fresh data on a schedule.', 'AIMEAT spots that data and hands it to your agent.', 'Your agent does the work and writes its insights back.',
  'You get the finished insights. Delivered to the app and reachable everywhere.'];
const DECIDE_ORDER = ['Choose a decision provider above. A local decision model on this machine needs no key. For TypeSafe, set a key: your own above, or one for a single agent on that agent\'s page.',
  'Test it, if it takes a key.', 'Write a decision rule and try it on its sample.', 'Give the rule to an agent in the agent\'s Crew tab.',
  'Decide about the gate on the agent\'s page. It is off until you turn it on.', 'Read the decisions and tune the thresholds.'];
const LIMITS = ['Only what you did here. Anything you published elsewhere, on another installation or on your own personal one, is outside these numbers.',
  'Only yours. Nothing on this page describes anybody else\'s activity, and nobody else sees yours here.', 'Text is not watermarked here. The tokens are not sampled, and that layer belongs to whoever runs the model.'];
/** A list of steps as the pages draw it today: each step one row of the home's list (IndexList steps, IndexStep). */
const asSteps = (items) => pf(html`<${IndexList} steps>${items.map((s, i) => html`<${IndexStep} key=${i}>${s}<//>`)}<//>`);
const toRows = (items) => after('.poster-index-list', () => asSteps(items), '.poster-index-item');
const items = (list) => list.map((s) => html`<li key=${s}>${s}</li>`);
/** An agent's tags as the page draws them today (TagInput: Mark tags with the remove mark). */
const agentTags = () => pf(html`<${TagInput} tags=${['ferry']} addLabel="Add tag" onAdd=${noop} onRemove=${noop} removeLabel="Remove the tag" />`);
const MEMBERS = ['mika', 'research-bot'];
/** A board's member chips as board.js drew them when the option was chosen (always coral). */
const boardMembers = () => pf(html`<div class="og-split bp-members"><span class="poster-label">Members</span>
  <div class="bp-member-list">${MEMBERS.map((m) => html`<span class="poster-chip" key=${m}>${m} <button type="button" class="bp-member-x" aria-label="Remove">✗</button></span>`)}</div></div>`);
/** A board's members as the page draws them today (Marks of Mark tags with the remove mark). */
const boardMembersNow = () => pf(html`<${Marks}>${MEMBERS.map((m) => html`<${Mark} key=${m} removeLabel="Remove" onRemove=${noop}>${m}<//>`)}<//>`);

export const CONFLICT_SAMPLES = {
  // The conflicts round of Settings & Controls.
  'person-head': [
    // The whole head, so the lines and buttons that stay are seen.
    { id: 'masthead', measure: '.poster-masthead-name', solo: '.poster-masthead', render: homeHead, after: 'same' },
    // The overview draws the home's head today (ProfileCard), so the option and the proposal are one picture.
    { id: 'overview-head', measure: '.poster-masthead-name', solo: '.poster-masthead', render: overviewHead, after: 'same' },
  ],
  'numbered-list': [
    // The third row opened, as a row is when you press it: the proposal changes its marks on the sun.
    { id: 'numbered-index', measure: '.poster-index-item', solo: '.poster-index .poster-named-row-body',
      render: () => html`<${NumberedIndex} lead="Each one is a real thing you can do here, with the steps and the prompt that gets it done." label="To set up">
        ${PLAYBOOKS.map((p, i) => html`<${IndexItem} key=${p} on=${i === 2} expanded=${i === 2} onClick=${noop}>${p}<//>`)}<//>`,
      after: after('.poster-index-list', () => indexList(PLAYBOOKS.map((p, i) => indexRow(p, { open: i === 2 }))), '.poster-index-item') },
    // The words of a row that is not the first, so the sun of the first step is not read as a change.
    // The overview draws the home's rows today (NextSteps), so the option and the proposal are one picture.
    { id: 'next-steps', measure: '.poster-index-item:not(.poster-index-item--first) .poster-index-name', solo: '.poster-index-list', render: stepsAsIndex, after: 'same' },
    // The eight other lists of Settings, each in its page's markup as it was chosen from, measured on a step.
    { id: 'wallet-steps', measure: '.wal-steps li', solo: '.wal-steps', render: () => inOpenRow(html`<span class="poster-label wal-label">How do I get a Stripe key?</span>
      <ol class="wal-steps">${WALLET_STEPS.map(([text, link]) => html`<li key=${text}>${text}${link ? html` <a href="#">${link}</a>` : ''}</li>`)}</ol>`),
      after: toRows(WALLET_STEPS.map(([text, link]) => (link ? html`${text} <${Action} tone="link" href="#">${link}<//>` : text))) },
    { id: 'calibrator-proposals', measure: '.cal-ol li', solo: '.cal-ol', render: () => pf(html`<div class="cal-col"><span class="poster-label">The judge proposes</span><ol class="cal-ol">${items(CAL_PROPOSALS)}</ol></div>`),
      after: toRows(CAL_PROPOSALS) },
    { id: 'mcp-steps', measure: '.og-mcp .setup-guide-steps li', solo: '.setup-guide-steps', render: () => pf(html`<div class="og og-mcp"><ol class="setup-guide-steps">${items(MCP_STEPS)}</ol></div>`),
      after: toRows(MCP_STEPS) },
    // The name measured: the number is the only other mark, and the list draws it as the row's ::before.
    { id: 'agents-counter', measure: '.agp-basic-list .listing-name', solo: '.agp-basic-list', render: () => pf(html`<div class="og og-agp">
      <ul class="listing listing--n-name-desc-state listing--cols agp-basic-list">${BASIC_AGENTS.map(([name, mode, desc], i) => html`<li class="listing-row" key=${name}>
        <div><i>${String(i + 1).padStart(2, '0')}</i></div><div class="listing-name">${name}<span class="poster-chips"><span class="poster-chip">${mode}</span></span></div>
        <div class="listing-desc">${desc}</div><div><span class="og-fold-r"></span></div></li>`)}</ul></div>`),
      after: after('.poster-index-list', () => pf(html`<${IndexList} steps>${BASIC_AGENTS.map(([name, mode, desc]) => html`<${IndexStep} key=${name} line=${desc}>
        ${name}<${Marks}><${Mark} tone="dim">${mode}<//><//><//>`)}<//>`), '.poster-index-name') },
    { id: 'nodes-setup', measure: '.pn-setup li', solo: '.pn-setup', render: () => pf(html`<div class="pn-setup open poster-row--thing"><ol>${items(NODE_STEPS)}</ol></div>`),
      after: toRows(NODE_STEPS.map((s) => s.replace(/^\d+\.\s*/, ''))) },
    { id: 'ecosystem-how', measure: '.pf-eco-auto-how-steps li', solo: '.pf-eco-auto-how', render: () => pf(html`<div class="pf-eco-auto-how">
      <p class="poster-hint">The app and your agents never talk directly. AIMEAT sits in between. It runs top to bottom:</p>
      <ol class="pf-eco-auto-how-steps">${items(ECO_STEPS)}</ol><p class="poster-hint pf-eco-auto-how-doc">Full walkthrough: docs/ecosystem-app-automation-howto.md.</p></div>`),
      after: toRows(ECO_STEPS) },
    { id: 'ai-decide-order', measure: '.pf-dr-order li', solo: '.pf-dr-order', render: () => pf(html`<div class="pf-dr"><ol class="pf-dr-order">${items(DECIDE_ORDER)}</ol></div>`),
      after: toRows(DECIDE_ORDER) },
    { id: 'ai-compliance', measure: '.pf-cmp-limits li', solo: '.pf-cmp-limits', render: () => pf(html`<ul class="pf-cmp-limits">${items(LIMITS)}</ul>`),
      after: toRows(LIMITS) },
  ],
  'conversation-list': [
    // Inside the list's phone state, where the side column shows itself at a lab frame's width. The
    // chat opens on the newest conversation, so the first row is the open one, as on the page.
    { id: 'thread-list', measure: '.poster-thread-title', solo: '.poster-thread-list',
      render: () => column(html`<div class="poster-conversation--list"><${ThreadList} threads=${THREADS} activeId="t1" onOpen=${noop} onNew=${noop} onDelete=${noop} onClose=${noop} /></div>`),
      after: after('.poster-thread-list', () => column(html`<div class="poster-conversation--list dl-readable"><${ThreadList} threads=${THREADS} activeId="t1" onOpen=${noop} onNew=${noop} onDelete=${noop} onClose=${noop} /></div>`), '.poster-thread-title') },
    // Messages draws the chat's rows under each person's heading today (ListPanel), with the first conversation open in the proposal.
    { id: 'inbox-list', measure: '.conversation-row-name', solo: '.conversation-section', render: () => inboxList(),
      after: after('.conversation-list', () => inboxList('c1'), '.conversation-row-name') },
  ],
  message: [
    { id: 'turn', measure: '.poster-turn--user .poster-turn-body', solo: '.poster-turn',
      render: () => html`<${ConversationScroll} onScroll=${noop}>
        <${Turn} id="dl-t1" turn=${{ role: 'user', text: 'List all my apps.', at: AT }} />
        <${Turn} id="dl-t2" turn=${{ role: 'agent', text: 'Here are your apps, grouped by kind. You have four games and three tools.', at: AT, model: 'claude-sonnet-5' }} /><//>`,
      after: 'same' },
    // Messages draws the chat's turn today (MessageBubble is the Message), so the option and the proposal are one picture.
    { id: 'bubble', measure: '.poster-turn--user .poster-turn-body', solo: '.message', render: bubbles, after: 'same' },
  ],
  'typing-box': [
    // Something typed in every field, so Send is the dark block and no placeholder overflows.
    // Measured on a tool: the field's own change is told in words on the page.
    { id: 'chat-composer', measure: '.poster-composer-tool', solo: '.poster-composer',
      render: () => html`<${Composer} value="Make me a pong game" onInput=${noop} onSend=${noop} onAttach=${noop} onSpeak=${noop} />`, after: 'same' },
    // Messages draws the Composer's message tone today, so the option and the proposal are one picture.
    { id: 'inbox-composer', measure: '.poster-composer-tool', solo: '.poster-composer--message', render: inboxComposer, after: 'same' },
  ],
  'settings-door': [
    { id: 'home-action', measure: '.poster-action', render: () => row(action('All settings and controls →')), after: 'same' },
    { id: 'settings-door', measure: '.og-door', solo: '.og-door',
      render: () => pf(html`<div class="og-doors"><button type="button" class="og-door">New skill</button><button type="button" class="og-door">Copy the request</button></div>`),
      after: after('.poster-action', () => pf(html`<div class="og-doors">${small('New skill')}${small('Copy the request')}</div>`)) },
    // In an admin Agents row, whose sheet sets the row size (.adm-ag-go .og-door): the rows that still
    // draw the door on this branch; main's Settings rows drew it in capitals at the same size.
    { id: 'row-door', measure: '.adm-ag-go .og-door', solo: '.adm-ag-go .og-door',
      render: () => adm(html`<div class="adm-ag-go"><button type="button" class="og-door og-door--quiet">Open</button></div>`),
      after: after('.poster-action', () => adm(html`<div class="adm-ag-go">${small('Open', ' dl-action--lower dl-action--row')}</div>`)) },
    { id: 'quiet-door', measure: '.og-door--quiet', solo: '.og-door--quiet',
      render: () => adm(html`<div class="og-doors"><button type="button" class="og-door og-door--quiet">To the owners</button></div>`),
      after: after('.poster-action', () => adm(html`<div class="og-doors">${small('To the owners', ' dl-action--lower')}</div>`)) },
  ],
  // Each look with the class its page gave it; the after is the library's code block (Code block).
  'code-block': [
    { id: 'framed', measure: '.mc-code', render: () => pf(html`<pre class="mc-code">${CODE}</pre>`), after: after('.code-block', codeBlock) },
    { id: 'grey', measure: '.code-block', render: codeBlock, after: 'same' },
    { id: 'grey-rule', measure: '.ac-road pre', render: () => pf(html`<div class="ac-road"><pre>${CODE}</pre></div>`), after: after('.code-block', codeBlock) },
    { id: 'light-frame', measure: '.bp-code', render: () => pf(html`<pre class="bp-code">${CODE}</pre>`), after: after('.code-block', codeBlock) },
  ],
  // ── Five more of the round, drawn as this branch's pages draw them now. ──
  box: [
    { id: 'object-box', measure: '.poster-box', render: () => pf(html`<${Road} name=${ROAD_NAME} text=${ROAD_TEXT} />`), after: 'same' },
    { id: 'frame', measure: '.poster-frame', render: () => pf(html`<div class="sk-rule poster-frame">${RULE}</div>`),
      after: after('.poster-box', ruleBox) },
    { id: 'raised', measure: '.poster-box--raised', render: () => pf(html`<${Road} lead name=${ROAD_NAME} text=${ROAD_TEXT} />`), after: 'same' },
    // An agent's data scope (its Memory tab), one of the thin grey boxes the page drew.
    { id: 'thin-grey', measure: '.pf-agd-scope-summary', render: () => pf(html`<div class="pf-agd-card-grid"><div class="pf-agd-scope-summary pf-agd-card--full">${SCOPE}</div></div>`),
      after: after('.poster-box', scopeBox) },
  ],
  'sub-heading': [
    { id: 'coral-caps', measure: '.card-h3', render: () => pf(html`<h3 class="card-h3 poster-label">My CORS origins</h3>`), after: after('.sub-heading', () => subHead('My CORS origins')) },
    { id: 'ink-bold', measure: '.pf-bold', render: () => pf(html`<div class="card"><div class="flex-between mb-half"><span class="pf-bold">Allowed origins</span></div></div>`),
      after: after('.sub-heading', () => subHead('Allowed origins')) },
    { id: 'poster-ink', measure: '.sub-heading', render: () => subHead('Your own TypeSafe key'), after: 'same' },
    { id: 'poster-coral', measure: '.stat-panel-h4', render: () => pf(html`<div class="card p-1"><h4 class="stat-panel-h4">Requests by method</h4></div>`),
      after: after('.sub-heading', () => subHead('Requests by method')) },
  ],
  'nodes-head': [
    { id: 'kit-head', measure: '.og-title', solo: '.og-crumb, .og-mast', render: () => kitHead(['Settings & Controls', 'Build & share', 'Skills'], 'Skills', 'What your agent knows how to do here, by reference.'), after: 'same' },
    { id: 'tabs-only', measure: '.sub-tabs', solo: '.settings-frame-head, .sub-tabs', render: () => pf(html`<div class="settings-frame-head"><span class="poster-crumb">Nodes</span></div>${NODE_TABS}`),
      after: after('.og-crumb, .og-mast, .tab-row--bar', nodesHead, '.og-title') },
  ],
  'check-line': [
    // The check line as the pages draw it today (Check), at the body's size.
    { id: 'body', measure: '.check-line', render: () => checks('Notes', 'Signal Room'), after: 'same' },
    { id: 'small', measure: '.pf-nb-toggle', render: () => pf(html`<div class="og"><div class="pf-nb-settings"><label class="pf-nb-toggle"><input type="checkbox" checked /> Detect on capture</label> <label class="pf-nb-toggle"><input type="checkbox" /> Run plan automatically</label></div></div>`),
      after: after('.check-line', () => checks('Detect on capture', 'Run plan automatically')) },
  ],
  'meta-line': [
    // Shown with the name above it, so the two lines can be told apart.
    { id: 'mono', measure: '.listing-name small', solo: '.listing-name', render: () => listing('public · 4.6 kB · 9/25/2026'), after: 'same' },
    { id: 'body', measure: '.dv-nm small', solo: '.dv-nm', render: () => pf(html`<div class="og"><section class="og-sec"><div class="dv-kinds"><div class="dv-n">1</div><div class="dv-nm"><button type="button" class="og-tbl-name">Memory</button><small>your own records</small></div></div></section></div>`),
      after: after('.listing-name', () => listing('your own records', 'Memory'), '.listing-name small') },
  ],
  // ── Wave 3: drawn from the markup of each page with fixed words; the agent pages scope under .pf. ──
  'rating-stars': [
    { id: 'review-coral', measure: '.pf-agd-quality-stars', render: () => pf(html`<div class="pf-agd-quality-review-row"><div class="pf-agd-quality-review-head">
      <span class="pf-agd-quality-ctx">Creative</span><span class="pf-agd-quality-stars">★★★★☆</span><span class="pf-agd-quality-avg">4.0</span><span class="pf-agd-quality-n">1 ratings</span></div></div>`),
      after: after('.stars', () => starsShown(4)) },
    { id: 'overall-grey', measure: '.pf-agd-quality-overall', render: () => pf(html`<div class="pf-agd-quality-overall">Overall: ★★★★☆ 4.0 (1 ratings)</div>`),
      after: after('.poster-hint', () => pf(html`<${Note}>Overall: ${starsShown(4, true)} 4.0 (1 ratings)<//>`)) },
    { id: 'task-dark', measure: '.agt-stars', render: () => pf(html`<div class="agt-rating"><span class="agt-stars">★★★★<span class="agt-stars-off">★</span></span><span class="agt-m">Creative</span><span class="agt-rating-note">Good catch.</span></div>`),
      after: after('.stars', () => starsShown(4)) },
    // Three stars under the pointer, as the picker drew them while it was pointed at.
    { id: 'picker-amber', measure: '.pf-agd-inline-star--hot', solo: '.pf-agd-inline-stars', render: () => pf(html`<span class="pf-agd-inline-stars" role="radiogroup">
      ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" key=${n} class=${'pf-agd-inline-star' + (n <= 3 ? ' pf-agd-inline-star--hot' : '')} aria-label=${String(n)}>★</button>`)}</span>`),
      after: after('.stars', () => starsGive(3), '.stars-star.on') },
    // The library's stars to give draw the proposal's dark tone today (Stars), so the option and the proposal are one picture.
    { id: 'library', measure: '.stars-star.on', solo: '.stars', render: () => starsGive(3), after: 'same' },
  ],
  'activity-log': [
    { id: 'kind-rows', measure: '.pf-agd-log-type', solo: '.pf-agd-log-entry', render: () => pf(html`<div class="pf-agd-event-log-scroll">${EVENTS.map((e) => html`
      <div class="pf-agd-log-entry pf-agd-log-entry--two-line" key=${e.what}><div class="pf-agd-log-entry-primary"><span class="pf-agd-log-time poster-time">07:53 AM</span>
        <span class="poster-chip">Tasks</span><span class="pf-agd-log-type">${e.what}</span></div><div class="pf-agd-log-entry-detail">${e.said}</div></div>`)}</div>`),
      after: after('.poster-timeline-list', () => timeline(true), '.poster-timeline-line') },
    { id: 'ruled-table', measure: '.agt-w', solo: '.agt-log', render: () => pf(html`<div class="agt-log">${EVENTS.map((e) => html`
      <div class="agt-m poster-time" key=${e.what + 'm'}>in 3 days</div><div class="agt-w" key=${e.what + 'w'}>${e.what}</div><div class="agt-msg" key=${e.what + 's'}>${e.said}</div>`)}</div>`),
      after: after('.poster-timeline-list', () => timeline(false), '.poster-timeline-line') },
    { id: 'timeline', measure: '.poster-timeline-line', solo: '.poster-timeline-list', render: () => timeline(false), after: 'same' },
  ],
  // Measured on the heading: the words are the reader's own size in every place.
  'markdown-small': [
    // Inside the Settings frame's body, as the pages drew them: its rule for a tab's own headings
    // (.settings-frame-body h2:not([class])) reached the reader's headings too.
    { id: 'agent-readme', measure: '.md-body h2', solo: '.pf-agd-readme', render: () => inFrame(html`<div class="pf-agd-readme"><${Markdown} text=${README_MD} /></div>`),
      after: after('.md-body--small', smallReader, '.md-body h2') },
    { id: 'task-memory', measure: '.md-body h2', solo: '.pf-agd-task-memory-md', render: () => inFrame(html`<div class="pf-agd-task-memory-md"><${Markdown} text=${README_MD} /></div>`),
      after: after('.md-body--small', smallReader, '.md-body h2') },
    { id: 'eco-guide', measure: '.md-body h2', solo: '.pf-eco-setup-guide-md', render: () => inFrame(html`<div class="pf-eco-setup-guide-md"><${Markdown} text=${README_MD} /></div>`),
      after: after('.md-body--small', smallReader, '.md-body h2') },
    { id: 'full', measure: '.md-body h2', solo: '.md-body', render: () => html`<${Markdown} text=${README_MD} />`,
      after: after('.md-body--small', smallReader, '.md-body h2') },
  ],
  'mcp-guide': [
    { id: 'classic', measure: '.instruction-block-text', solo: '.instruction-block-text, .setup-guide-cmd-text', render: () => guide(''),
      after: after('.instruction-block-text, .setup-guide-cmd-text', () => guide('og og-mcp'), '.instruction-block-text') },
    { id: 'poster', measure: '.instruction-block-text', solo: '.instruction-block-text, .setup-guide-cmd-text', render: () => guide('og og-mcp'), after: 'same' },
  ],
  'file-pick-list': [
    { id: 'config-list', measure: '.pf-agd-config-item--active', solo: '.pf-agd-config-list', render: () => pf(html`<div class="pf-agd-config-list">${FILES.map((f, i) => html`
      <div key=${f.name} class=${'pf-agd-config-item' + (i === PICKED ? ' pf-agd-config-item--active' : '')}><span class="status-dot pf-agd-status-dot status-dot--active"></span>
        <span class="pf-agd-config-name">${f.name}</span><span class="pf-agd-config-desc">${f.desc}</span></div>`)}</div>`),
      after: after('.listing', () => fileListing(true), '.listing-name') },
    { id: 'listing', measure: '.listing-name', solo: '.listing', render: () => fileListing(true), after: 'same' },
    { id: 'tile', measure: '.poster-tab--tile.is-on', solo: '.poster-tab--tile', render: () => html`<${SwatchPicker} title="Files"
      choices=${FILES.map((f, i) => ({ value: f.name, label: f.name, active: i === PICKED }))} onChoose=${noop} />`, after: 'same' },
  ],
  'dashed-field-box': [
    // Inside an opened row, as both pages draw them (its panel sets the words' size). Packages today
    // is the TextField's box (.field-row); Extensions' test is the Box's field tone.
    { id: 'grey', measure: '.pk-inst', render: () => inOpenRow(html`<div class="pk-inst"><input class="og-input" type="text" placeholder="A name for your copy" /><button type="button" class="poster-action">Install</button></div>`),
      after: after('.field-row', () => inPanel(html`<${TextField} box placeholder="A name for your copy" ariaLabel="Install under a name" onInput=${noop}
        actions=${html`<${Action} small onClick=${noop}>Install<//>`} />`)) },
    { id: 'page', measure: '.box--field', render: () => inPanel(html`<${Box} tone="field"><${Label} block>Try: echo<//><${TextArea} code rows=${2} placeholder=${'{ "name": "Aino" }'} onInput=${noop} />
      <${Actions}><${Action} small onClick=${noop}>Run<//><//><//>`), after: 'same' },
  ],
  'question-box': [
    { id: 'sun-box', measure: '.wp-ask', render: () => ask('og'), after: after('.poster-box', askNow) },
    // The question as Workflows draws it today (Box and Tabs).
    { id: 'plain-box', measure: '.poster-box', render: askNow, after: 'same' },
    { id: 'ink-tabs', measure: '.wp-ask', render: () => ask('ink'), after: after('.poster-box', askNow) },
  ],
  // ── Wave 4. ──
  'tag-remove': [
    // An agent's tags as the page draws them today (TagInput).
    { id: 'grey-to-coral', measure: '.poster-chip-x', solo: '.tag-input', render: agentTags, after: 'same' },
    { id: 'always-coral', measure: '.bp-member-x', solo: '.bp-member-list', render: boardMembers,
      after: after('.poster-chips', boardMembersNow, '.poster-chip-x') },
  ],
};

export const CONFLICT_PROPOSALS = {
  'rating-stars': {
    measure: '.stars-star.on',
    render: () => html`<div class="dl-stack">${tone('shown: a rating you read in a line', pf(html`${starsShown(4, true)} <${Note} kind="meta" inline>Creative<//>`))}
      ${tone('to give: the stars up to the one under the pointer turn dark', starsGive(3))}</div>`,
  },
  'activity-log': {
    measure: '.poster-timeline-line',
    render: () => html`<div class="dl-stack">${tone('plain', timeline(false))}${tone('with a kind, where the page filters by kind', timeline(true))}</div>`,
  },
  'markdown-small': {
    measure: '.md-body h2',
    render: smallReader,
  },
  'conversation-list': {
    measure: '.conversation-row-name',
    render: () => inboxList('c1'),
  },
  message: {
    measure: '.poster-turn-body',
    render: bubbles,
  },
  'typing-box': {
    measure: '.poster-composer-tool',
    render: () => html`<div class="dl-stack">
      ${tone('in the chat', html`<${Composer} value="Make me a pong game" onInput=${noop} onSend=${noop} onAttach=${noop} onSpeak=${noop} />`)}
      ${tone('in Messages: one more square, the bigger editor; on a phone the field keeps the whole width', inboxComposer())}</div>`,
  },
  'person-head': {
    measure: '.poster-masthead-name',
    render: () => html`<div class="dl-stack">${tone('on the home, as today', homeHead())}
      ${tone('on the overview: the home\'s sizes, its own lines and buttons kept', overviewHead())}</div>`,
  },
  'numbered-list': {
    measure: '.poster-index-item',
    render: () => html`<div class="dl-stack">
      ${tone('plain: one thing to do', pf(indexList(indexRow('A company that remembers'))))}
      ${tone('with a line: says what it gives you', pf(indexList(indexRow(STEPS[1][0], { line: STEPS[1][1] }))))}
      ${tone('first: the one to do first, every mark dark on yellow', pf(indexList(indexRow(STEPS[0][0], { line: STEPS[0][1], first: true }))))}</div>`,
  },
  'settings-door': {
    measure: '.poster-action',
    render: () => pf(row(html`${tone('full', action('All settings and controls →'))} ${tone('small', small('New skill'))}
      ${tone('small, in a row', small('Open', ' dl-action--row'))} ${tone('lower-case', small('To the owners', ' dl-action--lower'))}`)),
  },
  box: {
    measure: '.poster-box',
    render: () => html`<div class="dl-stack">${tone('plain: one thing', pf(html`<${Box}>${README}<//>`))}
      ${tone('raised: the row you opened, or the way to take first', pf(html`<${Road} lead name=${ROAD_NAME} text=${ROAD_TEXT} />`))}</div>`,
  },
  'nodes-head': {
    measure: '.og-title',
    render: nodesHead,
  },
};
