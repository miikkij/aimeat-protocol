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
 * @structure CONFLICT_SAMPLES — { [decisionId]: [{ id, measure, solo?, render(), after }] } · CONFLICT_PROPOSALS — { [decisionId]: { measure, render() } }
 * @usage import { CONFLICT_SAMPLES, CONFLICT_PROPOSALS } from './decision-samples-conflicts.js';
 * @version-history
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
import { NumberedIndex, IndexItem } from '/components/NumberedIndex.js';
import { Composer } from '/components/Composer.js';
import { Markdown } from '/components/Markdown.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import { time as fmtTime } from '/js/format.js';
import { TimelineRow, TimelineList } from '/components/Timeline.js';
import { SwatchPicker } from '/components/SwatchPicker.js';

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
const inbox = (children) => pf(html`<div class="inbox og og-ib">${children}</div>`);
/** A list as wide as its page's column: the chat's side column and Messages' list are narrow. */
const column = (children) => html`<div class="dl-column">${children}</div>`;
const ME = { owner: 'aino', displayName: 'Aino', ghii: 'aino@example-node' };
const PEER = 'mika@example-node';
const face = minidenticon(ME.owner);
/** hh:mm as the chat's turn and Messages' box write a time. */
const clock = (iso) => fmtTime(iso, { hour: '2-digit', minute: '2-digit' });
const homeHead = () => html`<${Masthead} avatarSvg=${face} name=${ME.displayName} identity=${ME.ghii}>
  <a class="poster-action" href="#">All settings and controls →</a>
  <${MastheadButton} onClick=${noop}>${MastheadCog}<span>Home settings</span><//><//>`;
/** The overview's head drawn as the home's: its own lines kept in the plate, its buttons on the right. */
const overviewAsHome = () => pf(html`<div class="poster-masthead">
  <span class="poster-masthead-avatar poster-frame" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: face }}></span>
  <span class="poster-masthead-plate">
    <span class="poster-masthead-name">${ME.displayName}</span>
    <span class="poster-masthead-identity">${ME.ghii}</span>
    <div class="pf-lp-node">Node: https://example-node</div>
    <div><div class="pf-federation-badge pf-mcp-badge"><span class="pf-fed-dot"></span>MCP connected</div><div class="pf-federation-badge pf-federation-standalone">Standalone</div></div>
  </span>
  <span class="poster-masthead-actions"><div class="pf-lp-actions">
    <button type="button" class="pf-presence-pill-btn"><${PresenceDot} status="available" size="sm" label=${true} /></button>
    <button type="button" class="poster-action">AI chat instructions</button>
    <button type="button" class="poster-action">Profile</button></div></span></div>`);
const PLAYBOOKS = ['A shop that is open by this afternoon', 'A company that remembers', 'Your own page'];
const STEPS = [
  ['Write self-organizing notes', 'Just write things down. The AI sorts each note into the right workspace for you.'],
  ['Create your portfolio', 'A polished page that tells others who you are and what you do.'],
  ['Use agents others shared', 'Browse ready agents people published and put them to work for you.'],
];
/** NextSteps (landing-page.cards.js) with its words given: the component reads which steps to show from the network. */
const nextSteps = () => pf(html`<div class="pf-next"><div class="poster-section-title pf-next-title">Suggested next steps</div>
  <div class="pf-next-grid poster-row--thing">${STEPS.map(([title, desc], i) => html`
    <button type="button" class=${'pf-next-card' + (i === 0 ? ' pf-next-card--primary' : '')}>
      <span class="pf-next-ico">·</span>
      <span class="pf-next-body"><span class="pf-next-card-title">${title}</span><span class="pf-next-card-desc">${desc}</span></span>
      <span class="pf-next-arrow" aria-hidden="true">→</span></button>`)}</div></div>`);
/** One row of the home's list in the proposal: `line` is the line under the name, `first` the yellow
    first step and `open` the home's opened row, both with every mark in the words-on-sun colour (lab classes). */
const indexRow = (name, { line = '', first = false, open = false } = {}) => html`
  <button type="button" class=${'poster-index-item' + (first ? ' dl-index-item--first' : '') + (open ? ' poster-index-item--on dl-index-item--readable' : '')}>
    <span class="dl-index-body"><span class="dl-index-name">${name}</span>${line && html`<span class="dl-index-desc">${line}</span>`}</span></button>`;
const indexList = (rows) => html`<div class="poster-index"><div class="poster-named-row-body">${rows}</div></div>`;
/** The overview's steps as the home's rows, with the two tones the proposal adds. */
const stepsAsIndex = () => indexList(STEPS.map(([title, desc], i) => indexRow(title, { line: desc, first: i === 0 })));
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
const inboxList = () => inbox(html`<div class="dl-column"><${Late} from=${inboxListPanel} draw=${({ ListPanel }) => html`<${ListPanel} requests=${[]} conversations=${conversations()} activeConv=${null}
  peerDisplay=${(g) => String(g).split('@')[0]} accept=${noop} block=${noop} openConversation=${noop} org=${ORG} />`} /></div>`);
/** list-panel.js BoxIcon, the archive box, drawn in the small icon square of the proposal. */
const BOX = html`<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">
  <rect x="1.8" y="2.2" width="12.4" height="3.4" /><path d="M3 5.6v8.2h10V5.6" /><path d="M6.2 8.4h3.6" /></svg>`;
/** list-panel.js Chevron, turned down: the person's group is open. */
const CHEVRON_OPEN = html`<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.6 3.2 5 6.6 8.4 3.2" fill="none" stroke="currentColor" stroke-width="1.8" /></svg>`;
/**
 * The proposal's list in Messages: the section heading as the decided group heading, a person's
 * heading that still opens and closes (arrow, picture, name, the presence word, the two numbers
 * named), and the chat's rows under it. `dl-readable` keeps the line under the name dark on the sun.
 */
const groupedList = (openId) => {
  const rows = conversations();
  const unread = rows.reduce((n, r) => n + r.unread, 0);
  return column(html`<div class="dl-readable">
    <div class="poster-day-title">People</div>
    <button type="button" class="dl-thread-person" aria-expanded="true">${CHEVRON_OPEN}
      <span class="dl-thread-face poster-frame" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: minidenticon(PEER) }}></span>
      <span class="dl-thread-name">mika</span><${PresenceDot} status="offline" label=${true} />
      <span class="poster-count poster-count--tally">${rows.length} conversations</span>
      <span class="poster-count poster-count--waiting">${unread} unread</span></button>
    <ul class="poster-thread-list">${rows.map((r) => html`<li key=${r.conversationId} class=${'poster-thread' + (r.conversationId === openId ? ' poster-thread--active' : '')}>
      <button type="button" class="poster-thread-open"><span class="poster-thread-title">${r.subject}</span>
        <span class="poster-thread-sub dl-thread-sub">${clock(r.updatedAt)} · ${r.lastDirection === 'outbound' ? 'You: ' : ''}${r.lastMessage}</span></button>
      ${r.unread ? html`<span class="poster-count poster-count--waiting" title=${`${r.unread} unread`}>${r.unread}</span>` : ''}
      <button type="button" class="poster-icon poster-icon--small poster-thread-del" aria-label="Archive this conversation">${BOX}</button></li>`)}
    </ul></div>`);
};
const THEIRS = { id: 'm1', senderGhii: PEER, body: 'The client wants the coral a little warmer. Is that possible within the palette?', createdAt: AT, attachments: [] };
const MINE = { id: 'm2', senderGhii: ME.ghii, body: 'Yes, within the palette. I will send two options.', createdAt: AT, status: 'read', attachments: [] };
const bubble = (MessageBubble, msg, mine) => html`<${MessageBubble} msg=${msg} mine=${mine} who=${mine ? 'You' : 'mika'} urlMap=${{}} starred=${false}
  onStar=${noop} onTrack=${noop} onPark=${noop} onReplyAi=${noop} onQuote=${noop} onDelete=${noop} onJumpTo=${noop} />`;
const bubbles = () => inbox(html`<div class="inbox-panel"><div class="inbox-msgs"><${Late} from=${inboxParts}
  draw=${({ MessageBubble }) => html`${bubble(MessageBubble, THEIRS, false)}${bubble(MessageBubble, MINE, true)}`} /></div></div>`);
/** The six Messages actions the proposal puts behind one square; Copy and Listen stay in the line, as in the chat. */
const MORE_ACTIONS = 'More: reply, mark important, track a response, add to notebook, reply with AI, delete';
/**
 * A Messages message as the chat's turn. The sender's name stays above the words in its small
 * capitals; the line under it has the time, the read marks on yours, Copy and Listen, and one ⋯
 * square for the other six actions, and it wraps on a narrow screen (lab classes).
 */
const messageTurn = (msg, mine) => html`<div class=${`poster-turn poster-turn--${mine ? 'user' : 'agent'}`}>
  <span class="dl-turn-who">${mine ? 'You' : 'mika'}</span>
  <div class="poster-turn-body">${mine ? html`<p class="poster-turn-said">${msg.body}</p>` : html`<${Markdown} text=${msg.body} />`}</div>
  <div class="poster-time poster-turn-meta dl-turn-meta"><span>${clock(msg.createdAt)}</span>${mine ? html`<span class="dl-turn-read" title="Read">✓✓</span>` : ''}
    <button type="button" class="poster-action poster-action--text" aria-label="Copy this message">⧉</button>
    <button type="button" class="poster-action poster-action--text">Listen</button>
    <button type="button" class="poster-icon poster-icon--small" title=${MORE_ACTIONS} aria-label=${MORE_ACTIONS}>⋯</button></div></div>`;
const messageTurns = () => html`<${ConversationScroll} onScroll=${noop}>${messageTurn(THEIRS, false)}${messageTurn(MINE, true)}<//>`;
/** The chat's one row, with the tools and the button word a page gives it; `text` is what is typed. */
const oneRow = (tools, label, placeholder, text = '') => html`<div class="poster-composer poster-row--thing"><div class="poster-composer-row">
  <textarea class="poster-composer-input" rows="1" placeholder=${placeholder}>${text}</textarea>
  ${tools.map(([title, mark]) => html`<button type="button" class="poster-icon poster-composer-tool" title=${title}>${mark}</button>`)}
  <button type="button" class="poster-slab poster-slab--control poster-composer-send" disabled=${!text}>${label}</button></div></div>`;
/** Messages' row in the proposal: on a phone the field keeps the whole width and the tools and the button go under it (lab class). */
const inboxRow = (text) => html`<div class="dl-row--stack">${oneRow(INBOX_TOOLS, 'Reply', 'Write a message…', text)}</div>`;
/** The action link's small tone, which keeps the Settings door's look (lab classes; `more` adds the row or lower-case tone). */
const small = (text, more = '') => html`<button type="button" class=${'poster-action dl-action--small' + more}>${text}</button>`;
/** A ready-made request as the pages show one; long enough to wrap in a lab frame. */
const CODE = 'Which apps and tokens act in my name in AIMEAT, what may each one do, and which have not been used in a month? Tell me whether two-step sign-in is on.';
const codeBlock = () => pf(html`<pre class="code-block">${CODE}</pre>`);
// The five more of the round: the words their pages show.
const ROAD = html`<span class="sk-road-t">Ask your AI</span><p class="og-lead">Copy this into your conversation and replace the bracketed parts with your own.</p>`;
const RULE = html`<span class="poster-label">The rule your AI needs</span><p>Before running an app, list its bound skills and read them.</p>`;
const README = 'An organism\'s readme: what this shared space is for and who looks after it.';
const SCOPE = html`Effective data scope for this agent: agents.shared.index<div class="poster-hint pf-agd-scope-footer">This summary is included in the agent's skill bundle so it knows its data boundaries.</div>`;
/** A sub-heading as the AI page draws one (the proposal's look). */
const subHead = (text) => pf(html`<div class="pf-card pf-aitr"><div class="pf-aitr-body"><h4 class="pf-aitr-sub">${text}</h4></div></div>`);
/** The page kit's head: the crumb, the title and its line (page-head.css, crumb-trail.css). */
const kitHead = (crumbs, title, line, below = null) => pf(html`<div class="og og-page">
  <div class="og-crumb">${crumbs.map((c, i) => html`${i ? html`<span>/</span>` : ''}<span class=${i === crumbs.length - 1 ? 'og-crumb-here' : ''}>${c}</span>`)}</div>
  <div class="og-mast og-mast--page"><div class="og-mast-words"><h1 class="og-title poster-page-title">${title}</h1><p class="og-desc og-desc--page">${line}</p></div></div>${below}</div>`);
const NODE_TABS = html`<div class="sub-tabs poster-row--thing"><button type="button" class="poster-tab is-on">Nodes</button><button type="button" class="poster-tab">Node Stats</button></div>`;
/** The Nodes page with the kit's head, its tabs under the line; the line is the page's own (profile.nodes.desc). */
const nodesHead = () => kitHead(['Settings & Controls', 'Infrastructure', 'Nodes'], 'Nodes',
  'Your own server is a machine you run your own AIMEAT on: a laptop, a NAS, or a computer at home.', NODE_TABS);
/** One Listing row with its name and the grey line under it. */
const listing = (meta, name = 'aimeat-writing') => pf(html`<div class="listing listing--name-desc-doors"><div class="listing-row">
  <div class="listing-name">${name}<small>${meta}</small></div><div class="listing-desc">How prose is written on this project.</div><div class="listing-doors"></div></div></div>`);
const CHAT_TOOLS = [['Attach a file', '📎'], ['Record a voice message', '🎤']];
const INBOX_TOOLS = [...CHAT_TOOLS, ['The bigger editor', '⤢']];

// ── Wave 3: the words their pages show. ──
/** The library's Rating stars (rating-stars.css) in the proposal's dark tone: `shown` small, not pressable. */
const stars = (n) => [1, 2, 3, 4, 5].map((i) => html`<span key=${i} class=${'op-star' + (i <= n ? ' on' : '')} aria-hidden="true">★</span>`);
const starsShown = (n, bare = false) => { const s = html`<span class="op-stars dl-stars dl-stars--shown" aria-label=${`${n} of 5`}>${stars(n)}</span>`; return bare ? s : pf(s); };
const starsGive = (n) => pf(html`<div class="op-rate"><span class="op-stars dl-stars">${[1, 2, 3, 4, 5].map((i) => html`<button type="button" key=${i} class=${'op-star' + (i <= n ? ' on' : '')} aria-label=${String(i)}>★</button>`)}</span></div>`);
const EVENTS = [{ what: 'started', said: 'Task started' }, { what: 'todo_completed', said: 'TODO "Open the map" done' }, { what: 'rating', said: 'Rated 4★ (creative)' }];
/** The home's Timeline with the agent's events; `kind` keeps the Activity tag before the line. */
const timeline = (kind) => html`<${TimelineList}>${EVENTS.map((e) => html`<${TimelineRow} key=${e.what} category="agent" when="07:53" href="#"
  text=${kind ? html`<span class="poster-chip">Tasks</span> ${e.what}: ${e.said}` : `${e.what}: ${e.said}`} />`)}<//>`;
const README_MD = '## What it does\n\nAnswers mail and checks `seat maps`. Quiet by default.\n\n- Answers mail\n- Checks seat maps\n\n```\nnpx aimeat connect\n```';
/** A Settings tab's body (settings-frame.css), whose own rules reach what is drawn in it. */
const inFrame = (children) => pf(html`<div class="settings-frame-body">${children}</div>`);
/** An opened Listing row's panel (listing.css), as a row that opens draws it. */
const inOpenRow = (children) => pf(html`<div class="listing"><div class="listing-row is-open"><div class="listing-open poster-frame">${children}</div></div></div>`);
const smallReader = () => html`<div class="dl-md-small"><${Markdown} text=${README_MD} /></div>`;
/** The MCP guide's command and instruction block (hello-mcp.css), bare or dressed as the MCP page dresses it. */
const guide = (scope) => pf(html`<div class=${scope}><div class="ast-cmd"><pre class="ast-cmd-text">claude mcp add --transport http aimeat https://example-node/mcp</pre></div>
  <div class="ib"><pre class="ib-block">AIMEAT: my own server\n\nI work on the AIMEAT node at https://example-node. Read aimeat_handbook_get first.</pre></div></div>`);
const FILES = [{ name: 'agent.md', desc: 'Updated: 9/25/2026' }, { name: 'skills.yaml', desc: 'Updated: 9/24/2026' }, { name: 'policy.json', desc: 'Updated: 9/20/2026' }];
/** The Listing with the files; the picked one's row opens with the file under it. */
/** The file picked in every picture: the second, so the first row reads as an ordinary row. */
const PICKED = 1;
const fileListing = (open) => pf(html`<div class="listing listing--name-desc-doors">${FILES.map((f, i) => html`
  <div class=${'listing-row' + (open && i === PICKED ? ' is-open' : '')} key=${f.name}><div class="listing-name">${f.name}<small>${f.desc}</small></div>
    <div class="listing-desc">The agent's own configuration.</div><div class="listing-doors"><button type="button" class="poster-action">${open && i === PICKED ? 'Close' : 'Open'}</button></div>
    ${open && i === PICKED ? html`<div class="listing-open poster-frame">Viewing ${f.name}: the agent reads this file when it starts.</div>` : null}</div>`)}</div>`);
const ASK = { q: 'Seat map review: which layout do we send?', sub: 'Asked today. It waits until Friday.', answers: ['Layout A', 'Layout B', 'Both'] };
/** A workflow's waiting question (cover.js markup): `og` as today, `plain` on the page's ground with tabs, `ink` the sun box with dark tabs. */
const ask = (kind) => pf(html`<div class=${kind === 'plain' ? 'dl-ask-plain' : 'wp-ask'}><b>${ASK.q}</b><p>${ASK.sub}</p>
  ${kind === 'og'
    ? html`<div class="og-choice wp-ask-choice">${ASK.answers.map((a, i) => html`<button type="button" key=${a} class=${'og-choice-btn' + (i === 1 ? ' on' : '')}>${a}</button>`)}</div>`
    : html`<div class="poster-specimen-row">${ASK.answers.map((a, i) => html`<button type="button" key=${a} class=${'poster-tab' + (i === 1 ? ' is-on' : '') + (kind === 'ink' ? ' dl-tab-ink' : '')}>${a}</button>`)}</div>`}
  <div class="og-doors"><button type="button" class="poster-slab poster-slab--control">Answer and go</button><button type="button" class="poster-action">Open the run</button></div></div>`);

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
/** A list as the proposal draws it: each step one row of the home's list, in the plain tone. */
const asRows = (items) => indexList(items.map((s) => indexRow(s)));
const toRows = (items) => after('.poster-index .poster-named-row-body', () => asRows(items), '.poster-index-item');
const items = (list) => list.map((s) => html`<li key=${s}>${s}</li>`);
/** An agent's tag chip (TagStrip, agent-card.js) and a board's member chips (board.js); `rest` greys the board's ✗ (lab class). */
const agentTags = () => pf(html`<div class="agp-chips"><div class="pf-agd-tag-strip pf-agd-tag-strip--editable">
  <span class="poster-chip">ferry <button type="button" class="pf-agd-tag-chip-remove" title="Remove the tag">✗</button></span>
  <button type="button" class="poster-action poster-action--quiet">+ Add tag</button></div></div>`);
const MEMBERS = ['mika', 'research-bot'];
const boardMembers = (rest = false) => pf(html`<div class="og-split bp-members"><span class="poster-label">Members</span>
  <div class="bp-member-list">${MEMBERS.map((m) => html`<span class="poster-chip" key=${m}>${m} <button type="button" class=${'bp-member-x' + (rest ? ' dl-x-rest' : '')} aria-label="Remove">✗</button></span>`)}</div></div>`);

export const CONFLICT_SAMPLES = {
  // The conflicts round of Settings & Controls.
  'person-head': [
    // The whole head, so the lines and buttons that stay are seen.
    { id: 'masthead', measure: '.poster-masthead-name', solo: '.poster-masthead', render: homeHead, after: 'same' },
    { id: 'overview-head', measure: '.pf-lp-name', solo: '.pf-lp-card-header',
      render: () => pf(html`<${Late} from=${overviewCards} draw=${({ ProfileCard }) => html`<${ProfileCard} tier="regular" stats=${{}} session=${ME} onEditProfile=${noop} switchTab=${noop} />`} />`),
      after: after('.poster-masthead', overviewAsHome, '.poster-masthead-name') },
  ],
  'numbered-list': [
    // The third row opened, as a row is when you press it: the proposal changes its marks on the sun.
    { id: 'numbered-index', measure: '.poster-index-item', solo: '.poster-index .poster-named-row-body',
      render: () => html`<${NumberedIndex} lead="Each one is a real thing you can do here, with the steps and the prompt that gets it done." label="To set up">
        ${PLAYBOOKS.map((p, i) => html`<${IndexItem} key=${p} on=${i === 2} expanded=${i === 2} onClick=${noop}>${p}<//>`)}<//>`,
      after: after('.poster-index .poster-named-row-body', () => indexList(PLAYBOOKS.map((p, i) => indexRow(p, { open: i === 2 }))), '.poster-index-item') },
    // The words of a row that is not the first, so the sun of the first step is not read as a change.
    { id: 'next-steps', measure: '.pf-next-card:not(.pf-next-card--primary) .pf-next-card-title', solo: '.pf-next-grid', render: nextSteps,
      after: after('.poster-index .poster-named-row-body', stepsAsIndex, '.poster-index-item:not(.dl-index-item--first) .dl-index-name') },
    // The eight other lists of Settings, each in its page's markup, measured on a step.
    { id: 'wallet-steps', measure: '.wal-steps li', solo: '.wal-steps', render: () => inOpenRow(html`<span class="poster-label wal-label">How do I get a Stripe key?</span>
      <ol class="wal-steps">${WALLET_STEPS.map(([text, link]) => html`<li key=${text}>${text}${link ? html` <a href="#">${link}</a>` : ''}</li>`)}</ol>`),
      after: toRows(WALLET_STEPS.map(([text, link]) => (link ? `${text} ${link}` : text))) },
    { id: 'calibrator-proposals', measure: '.cal-ol li', solo: '.cal-ol', render: () => pf(html`<div class="cal-col"><span class="poster-label">The judge proposes</span><ol class="cal-ol">${items(CAL_PROPOSALS)}</ol></div>`),
      after: toRows(CAL_PROPOSALS) },
    { id: 'mcp-steps', measure: '.og-mcp .ast-steps li', solo: '.ast-steps', render: () => pf(html`<div class="og og-mcp"><ol class="ast-steps">${items(MCP_STEPS)}</ol></div>`),
      after: toRows(MCP_STEPS) },
    // The name measured: the number is the only other mark, and the proposal draws it as the row's ::before.
    { id: 'agents-counter', measure: '.agp-basic-list .listing-name', solo: '.agp-basic-list', render: () => pf(html`<div class="og og-agp">
      <ul class="listing listing--n-name-desc-state listing--cols agp-basic-list">${BASIC_AGENTS.map(([name, mode, desc], i) => html`<li class="listing-row" key=${name}>
        <div><i>${String(i + 1).padStart(2, '0')}</i></div><div class="listing-name">${name}<span class="poster-chips"><span class="poster-chip">${mode}</span></span></div>
        <div class="listing-desc">${desc}</div><div><span class="og-fold-r"></span></div></li>`)}</ul></div>`),
      after: after('.poster-index .poster-named-row-body', () => indexList(BASIC_AGENTS.map(([name, mode, desc]) => indexRow(html`${name} <span class="poster-chip">${mode}</span>`, { line: desc }))), '.dl-index-name') },
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
    { id: 'inbox-list', measure: '.inbox-conv .inbox-name', solo: '.inbox-sec', render: inboxList,
      after: after('.dl-readable', () => groupedList('c1'), '.poster-thread-title') },
  ],
  message: [
    { id: 'turn', measure: '.poster-turn--user .poster-turn-body', solo: '.poster-turn',
      render: () => html`<${ConversationScroll} onScroll=${noop}>
        <${Turn} id="dl-t1" turn=${{ role: 'user', text: 'List all my apps.', at: AT }} />
        <${Turn} id="dl-t2" turn=${{ role: 'agent', text: 'Here are your apps, grouped by kind. You have four games and three tools.', at: AT, model: 'claude-sonnet-5' }} /><//>`,
      after: 'same' },
    { id: 'bubble', measure: '.inbox-bubble--mine', solo: '.inbox-row', render: bubbles,
      after: after('.poster-turn', messageTurns, '.poster-turn--user .poster-turn-body') },
  ],
  'typing-box': [
    // Something typed in every field, so Send is the dark block and no placeholder overflows.
    // Measured on a tool: the field's own change is told in words on the page.
    { id: 'chat-composer', measure: '.poster-composer-tool', solo: '.poster-composer',
      render: () => html`<${Composer} value="Make me a pong game" onInput=${noop} onSend=${noop} onAttach=${noop} onSpeak=${noop} />`, after: 'same' },
    { id: 'inbox-composer', measure: '.inbox-attach-btn', solo: '.inbox-composer',
      render: () => inbox(html`<div class="inbox-panel"><${Late} from=${inboxParts} draw=${({ Composer: InboxComposer }) => html`<${InboxComposer} recipient=${PEER} sendLabel="Reply" sending=${false} onSend=${noop} initialText="I will send two options." />`} /></div>`),
      after: after('.poster-composer', () => inboxRow('I will send two options.'), '.poster-composer-tool') },
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
  // Each look with the class its page gives it; the after is the library's code block.
  'code-block': [
    { id: 'framed', measure: '.mc-code', render: () => pf(html`<pre class="mc-code">${CODE}</pre>`), after: after('.code-block', codeBlock) },
    { id: 'grey', measure: '.sk-pre', render: () => pf(html`<pre class="sk-pre">${CODE}</pre>`), after: after('.code-block', codeBlock) },
    { id: 'grey-rule', measure: '.ac-road pre', render: () => pf(html`<div class="ac-road"><pre>${CODE}</pre></div>`), after: after('.code-block', codeBlock) },
    { id: 'light-frame', measure: '.bp-code', render: () => pf(html`<pre class="bp-code">${CODE}</pre>`), after: after('.code-block', codeBlock) },
  ],
  // ── Five more of the round, drawn as this branch's pages draw them now. ──
  box: [
    { id: 'object-box', measure: '.poster-box', render: () => pf(html`<div class="sk-road poster-box">${ROAD}</div>`), after: 'same' },
    { id: 'frame', measure: '.poster-frame', render: () => pf(html`<div class="sk-rule poster-frame">${RULE}</div>`),
      after: after('.poster-box', () => pf(html`<div class="sk-rule poster-box">${RULE}</div>`)) },
    { id: 'raised', measure: '.ac-road.is-lead', render: () => pf(html`<div class="ac-road is-lead">${ROAD}</div>`), after: 'same' },
    // An agent's data scope (its Memory tab), one of the thin grey boxes a page still draws.
    { id: 'thin-grey', measure: '.pf-agd-scope-summary', render: () => pf(html`<div class="pf-agd-card-grid"><div class="pf-agd-scope-summary pf-agd-card--full">${SCOPE}</div></div>`),
      after: after('.poster-box', () => pf(html`<div class="poster-box">${SCOPE}</div>`)) },
  ],
  'sub-heading': [
    { id: 'coral-caps', measure: '.card-h3', render: () => pf(html`<h3 class="card-h3 poster-label">My CORS origins</h3>`), after: after('.pf-aitr-sub', () => subHead('My CORS origins')) },
    { id: 'ink-bold', measure: '.pf-bold', render: () => pf(html`<div class="card"><div class="flex-between mb-half"><span class="pf-bold">Allowed origins</span></div></div>`),
      after: after('.pf-aitr-sub', () => subHead('Allowed origins')) },
    { id: 'poster-ink', measure: '.pf-aitr-sub', render: () => subHead('Your own TypeSafe key'), after: 'same' },
    { id: 'poster-coral', measure: '.stat-panel-h4', render: () => pf(html`<div class="card p-1"><h4 class="stat-panel-h4">Requests by method</h4></div>`),
      after: after('.pf-aitr-sub', () => subHead('Requests by method')) },
  ],
  'nodes-head': [
    { id: 'kit-head', measure: '.og-title', solo: '.og-crumb, .og-mast', render: () => kitHead(['Settings & Controls', 'Build & share', 'Skills'], 'Skills', 'What your agent knows how to do here, by reference.'), after: 'same' },
    { id: 'tabs-only', measure: '.sub-tabs', solo: '.settings-frame-head, .sub-tabs', render: () => pf(html`<div class="settings-frame-head"><span class="poster-crumb">Nodes</span></div>${NODE_TABS}`),
      after: after('.og-crumb, .og-mast, .sub-tabs', nodesHead, '.og-title') },
  ],
  'check-line': [
    { id: 'body', measure: '.pk-compose-app', render: () => pf(html`<div class="pk-compose-list">
      <label class="pk-compose-app"><input type="checkbox" checked /><span class="pk-compose-app-nm">Notes<small>notes.html</small></span><span class="pk-compose-app-needs">loads nothing of its own</span></label>
      <label class="pk-compose-app"><input type="checkbox" /><span class="pk-compose-app-nm">Signal Room<small>signal-room.html</small></span><span class="pk-compose-app-needs">loads nothing of its own</span></label></div>`), after: 'same' },
    { id: 'small', measure: '.pf-nb-toggle', render: () => pf(html`<div class="og"><div class="pf-nb-settings"><label class="pf-nb-toggle"><input type="checkbox" checked /> Detect on capture</label> <label class="pf-nb-toggle"><input type="checkbox" /> Run plan automatically</label></div></div>`),
      after: after('.dl-check-line', () => pf(html`<div class="og"><label class="dl-check-line"><input type="checkbox" checked /> Detect on capture</label> <label class="dl-check-line"><input type="checkbox" /> Run plan automatically</label></div>`)) },
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
      after: after('.op-stars', () => starsShown(4)) },
    { id: 'overall-grey', measure: '.pf-agd-quality-overall', render: () => pf(html`<div class="pf-agd-quality-overall">Overall: ★★★★☆ 4.0 (1 ratings)</div>`),
      after: after('.pf-agd-quality-overall', () => pf(html`<div class="pf-agd-quality-overall">Overall: ${starsShown(4, true)} 4.0 (1 ratings)</div>`)) },
    { id: 'task-dark', measure: '.agt-stars', render: () => pf(html`<div class="agt-rating"><span class="agt-stars">★★★★<span class="agt-stars-off">★</span></span><span class="agt-m">Creative</span><span class="agt-rating-note">Good catch.</span></div>`),
      after: after('.op-stars', () => pf(html`<div class="agt-rating">${starsShown(4, true)}<span class="agt-m">Creative</span><span class="agt-rating-note">Good catch.</span></div>`)) },
    // Three stars under the pointer, as the picker draws them while it is pointed at.
    { id: 'picker-amber', measure: '.pf-agd-inline-star--hot', solo: '.pf-agd-inline-stars', render: () => pf(html`<span class="pf-agd-inline-stars" role="radiogroup">
      ${[1, 2, 3, 4, 5].map((n) => html`<button type="button" key=${n} class=${'pf-agd-inline-star' + (n <= 3 ? ' pf-agd-inline-star--hot' : '')} aria-label=${String(n)}>★</button>`)}</span>`),
      after: after('.op-stars', () => starsGive(3), '.op-star.on') },
    { id: 'library', measure: '.op-star.on', solo: '.op-stars', render: () => pf(html`<div class="op-rate"><span class="op-stars">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" key=${n} class=${'op-star' + (n <= 3 ? ' on' : '')} aria-label=${String(n)}>★</button>`)}</span></div>`),
      after: after('.op-stars', () => starsGive(3), '.op-star.on') },
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
    // Inside the Settings frame's body, as the pages draw them: its rule for a tab's own headings
    // (.settings-frame-body h2:not([class])) reaches the reader's headings too.
    { id: 'agent-readme', measure: '.md-body h2', solo: '.pf-agd-readme', render: () => inFrame(html`<div class="pf-agd-readme"><${Markdown} text=${README_MD} /></div>`),
      after: after('.dl-md-small', smallReader, '.md-body h2') },
    { id: 'task-memory', measure: '.md-body h2', solo: '.pf-agd-task-memory-md', render: () => inFrame(html`<div class="pf-agd-task-memory-md"><${Markdown} text=${README_MD} /></div>`),
      after: after('.dl-md-small', smallReader, '.md-body h2') },
    { id: 'eco-guide', measure: '.md-body h2', solo: '.pf-eco-setup-guide-md', render: () => inFrame(html`<div class="pf-eco-setup-guide-md"><${Markdown} text=${README_MD} /></div>`),
      after: after('.dl-md-small', smallReader, '.md-body h2') },
    { id: 'full', measure: '.md-body h2', solo: '.md-body', render: () => html`<${Markdown} text=${README_MD} />`,
      after: after('.dl-md-small', smallReader, '.md-body h2') },
  ],
  'mcp-guide': [
    { id: 'classic', measure: '.ib-block', solo: '.ib-block, .ast-cmd-text', render: () => guide(''),
      after: after('.ib-block, .ast-cmd-text', () => guide('og og-mcp'), '.ib-block') },
    { id: 'poster', measure: '.ib-block', solo: '.ib-block, .ast-cmd-text', render: () => guide('og og-mcp'), after: 'same' },
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
    // Inside an opened Listing row, as both pages draw them (its panel sets the words' size).
    { id: 'grey', measure: '.pk-inst', render: () => inOpenRow(html`<div class="pk-inst"><input class="og-input" type="text" placeholder="A name for your copy" /><button type="button" class="poster-action">Install</button></div>`),
      after: after('.ex-test', () => inOpenRow(html`<div class="ex-test"><input class="og-input" type="text" placeholder="A name for your copy" /> <button type="button" class="poster-action">Install</button></div>`)) },
    { id: 'page', measure: '.ex-test', render: () => inOpenRow(html`<div class="ex-test"><span class="poster-label">Try: echo</span><textarea class="og-textarea ex-test-in" rows="2" placeholder="{ &quot;name&quot;: &quot;Aino&quot; }"></textarea>
      <div class="og-doors"><button type="button" class="poster-action">Run</button></div></div>`), after: 'same' },
  ],
  'question-box': [
    { id: 'sun-box', measure: '.wp-ask', render: () => ask('og'), after: after('.dl-ask-plain', () => ask('plain'), '.dl-ask-plain') },
    { id: 'plain-box', measure: '.dl-ask-plain', render: () => ask('plain'), after: 'same' },
    { id: 'ink-tabs', measure: '.wp-ask', render: () => ask('ink'), after: after('.dl-ask-plain', () => ask('plain'), '.dl-ask-plain') },
  ],
  // ── Wave 4. ──
  'tag-remove': [
    { id: 'grey-to-coral', measure: '.pf-agd-tag-chip-remove', solo: '.agp-chips', render: agentTags, after: 'same' },
    { id: 'always-coral', measure: '.bp-member-x', solo: '.bp-member-list', render: () => boardMembers(),
      after: after('.bp-member-list', () => boardMembers(true), '.bp-member-x') },
  ],
};

export const CONFLICT_PROPOSALS = {
  'rating-stars': {
    measure: '.op-star.on',
    render: () => html`<div class="dl-stack">${tone('shown: a rating you read in a line', pf(html`<div class="agt-rating">${starsShown(4, true)}<span class="agt-m">Creative</span></div>`))}
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
    measure: '.poster-thread-title',
    render: () => groupedList('c1'),
  },
  message: {
    measure: '.poster-turn-body',
    render: messageTurns,
  },
  'typing-box': {
    measure: '.poster-composer-tool',
    render: () => html`<div class="dl-stack">
      ${tone('in the chat', oneRow(CHAT_TOOLS, 'Send', 'Ask for something', 'Make me a pong game'))}
      ${tone('in Messages: one more square, the bigger editor; on a phone the field keeps the whole width', inboxRow('I will send two options.'))}</div>`,
  },
  'person-head': {
    measure: '.poster-masthead-name',
    render: () => html`<div class="dl-stack">${tone('on the home, as today', homeHead())}
      ${tone('on the overview: the home\'s sizes, its own lines and buttons kept', overviewAsHome())}</div>`,
  },
  'numbered-list': {
    measure: '.poster-index-item',
    render: () => html`<div class="dl-stack">
      ${tone('plain: one thing to do', indexList(indexRow('A company that remembers')))}
      ${tone('with a line: says what it gives you', indexList(indexRow(STEPS[1][0], { line: STEPS[1][1] })))}
      ${tone('first: the one to do first, every mark dark on yellow', indexList(indexRow(STEPS[0][0], { line: STEPS[0][1], first: true })))}</div>`,
  },
  'settings-door': {
    measure: '.poster-action',
    render: () => pf(row(html`${tone('full', action('All settings and controls →'))} ${tone('small', small('New skill'))}
      ${tone('small, in a row', small('Open', ' dl-action--row'))} ${tone('lower-case', small('To the owners', ' dl-action--lower'))}`)),
  },
  box: {
    measure: '.poster-box',
    render: () => html`<div class="dl-stack">${tone('plain: one thing', pf(html`<div class="poster-box">${README}</div>`))}
      ${tone('raised: the row you opened, or the way to take first', pf(html`<div class="poster-record">${ROAD}</div>`))}</div>`,
  },
  'nodes-head': {
    measure: '.og-title',
    render: nodesHead,
  },
};
