/**
 * @file public/views/design-lab/decisions-conflicts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The conflicts round of Settings & Controls, as decision data: each a kind of thing
 *   drawn in two or more ways that no majority decides (Jouni, 2026-09-25: "Bring to the lab only
 *   real conflicts (two looks used about equally, or a look that exists nowhere), all of them in one
 *   round."). The fields and the two registers are the ones decisions-data.js describes; that file
 *   spreads this list into DECISIONS, so every reader still takes the one list from it.
 * @structure CONFLICT_DECISIONS — [the DECISIONS shape] · CONFLICT_NOTES — [{ title, text }]
 * @usage import { CONFLICT_DECISIONS, CONFLICT_NOTES } from './decisions-conflicts.js';
 * @version-history
 *   v1.4.0 — 2026-09-26 — Jouni's answers to the round (design-lab.choice.<id> on the sandbox) as
 *     each decision's `choice`: every proposal accepted, except the MCP guide (the part's own look);
 *     the round's note says what he chose.
 *   v1.3.0 — 2026-09-26 — Wave 4: the remove mark of a chip (tag-remove); the numbered list gets the
 *     eight other lists of Settings as options, with a second question.
 *   v1.2.0 — 2026-09-26 — Real-page crops for the wave 3 options on the seeded sandbox (an agent's
 *     Quality, Tasks, README, Memory, Agent Config; Workflows; Packages; Extensions); the small
 *     reader rewritten after the crops showed the Settings frame's heading rule reaching it.
 *   v1.1.0 — 2026-09-25 — Wave 3: rating stars, activity log, small reader, MCP guide, file pick list,
 *     dashed field box, question box; CONFLICT_NOTES, the round's notes shown under the list.
 *   v1.0.0 — 2026-09-25 — Moved out of decisions-data.js unchanged (the file neared the 800-line
 *     limit; a move).
 */

// The crop helpers of decisions-data.js, the same two lines (that file imports this one).
const home = (selector, extra = {}) => ({ url: '/v1/home', selector, ...extra });
const chatThread = (n, selector) => ({ url: '/v1/chat', eval: `document.querySelectorAll('.poster-thread-open')[${n}].click();`, selector });
/** An agent's page on the sandbox (its agent is "bot"): the tab, then any further presses. */
const agentTab = (tab, selector, more = []) => ({ url: '/v1/profile?tab=agents&agent=bot', click: [`.agp-tabs .poster-tab:has-text("${tab}")`, ...more], selector });

export const CONFLICT_DECISIONS = [
  // ── The conflicts round of Settings & Controls (Jouni, 2026-09-25: "Bring to the lab only real
  //    conflicts (two looks used about equally, or a look that exists nowhere), all of them in one
  //    round."). In each, one kind of thing is drawn two ways, each on one page. Measured on the
  //    sandbox at 1280px wide, light mode.
  {
    id: 'person-head',
    title: 'Person head: the top of a page that belongs to one person',
    question: 'The home and the Settings overview both open with your picture in a frame and your name as a big headline, but in two sizes. Should the overview use the home\'s sizes?',
    proposal: {
      variant: 'proposal', name: 'The home\'s head, on both pages',
      summary: 'Your picture and your name at the home\'s sizes on the home and on the overview. The overview keeps its own lines under your name and its buttons. The pictures on this page are drawn at a phone\'s width; the pictures from the real pages are from a computer.',
      text: 'Masthead (.poster-masthead, masthead.css): picture 96px in a 3px ink frame (102px with the frame), name Fjalla 5.2rem (83px), caps, the picture centred on the name block (align-items: center). The overview (ProfileCard, .pf-lp-card-header, profile.css): picture 88px (94px with the frame), name 4.4rem (70px), the picture level with the foot of the name block (align-items: flex-end). On a phone the home is 64px and 2.6rem below 560px, the overview 56px and 2.2rem below 760px, both aligned to the top; the lab frames are 480px wide, so they show the phone sizes. The overview keeps .pf-lp-node, the MCP and Standalone badges, the presence pill, "AI chat instructions" and "Profile". The overview\'s card clips its own overflow (.pf-lp-card overflow: hidden), so its crop outlines the name only.',
    },
    variants: [
      { id: 'masthead', name: 'The home\'s head', code: '.poster-masthead (Masthead.js, masthead.css)', becomes: 'stays as it is. Accepting it means the overview takes these sizes', look: 'picture 96px, 3px ink frame; name Fjalla 5.2rem (83px) caps; the address mono .8rem grey; the picture centred on the name block', where: 'the home', crop: home('.poster-masthead-name') },
      { id: 'overview-head', name: 'The Settings overview\'s head', code: '.pf-lp-card-header, .pf-lp-avatar, .pf-lp-name (ProfileCard in landing-page.cards.js, profile.css)', becomes: 'the home\'s sizes; the address of this AIMEAT, the "MCP connected" and "Standalone" marks, your availability, AI chat instructions and Profile stay', look: 'picture 88px, 3px ink frame; name Fjalla 4.4rem (70px) caps; the picture level with the foot of the name block', where: 'Settings & Controls: the overview', crop: { url: '/v1/profile', selector: '.pf-lp-name' } },
    ],
    changes: [
      { page: 'Settings & Controls, overview, on a computer', what: 'Your picture grows from 88 to 96 pixels and your name gets about a fifth larger. The picture sits beside the middle of your name and the lines under it, as on the home, instead of level with their foot. The lines under your name and the buttons on the right stay.' },
      { page: 'Settings & Controls, overview, on a phone (the pictures on this page)', what: 'Your picture grows from 56 to 64 pixels and your name gets about a fifth larger. On both pages the picture sits beside the top of your name, and the buttons sit under it, as today.' },
      { page: 'Home', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the home's head on both pages, at the home's sizes.","decidedBy":"Jouni","decidedAt":"2026-09-25"},
  },
  {
    id: 'numbered-list',
    title: 'Numbered list: things to do, one row each',
    question: 'The home\'s list of things to set up and the overview\'s suggested next steps are both numbered rows with an arrow, drawn in two ways. Should the overview use the home\'s rows? Settings also draws a list of steps, or of short notes, in eight more ways (the last eight looks below), and no way is used most. Should a list of steps in Settings take the proposal\'s look too?',
    proposal: {
      variant: 'proposal', name: 'The home\'s numbered rows, with two more tones',
      summary: 'One numbered list: a number, the name, an arrow and a line under each row. The overview keeps the line under each name and its first step on the yellow ground, as two more tones of the list. On the yellow ground every mark is dark, so it can be read. If you also say yes to the second question, each of the eight other lists becomes these rows too: each step or note is one row, in the plain tone, and a list of notes gets numbers.',
      tones: [
        { name: 'plain', meaning: 'one thing to do', from: 'the home (.poster-index-item): Archivo 1.3rem 600, -.01em; the number mono .8rem coral in a 2.2rem column; the arrow Fjalla 1.1rem; a 2px ink rule under each row and 3px over the list' },
        { name: 'with a line', meaning: 'a line under the name says what it gives you', from: 'the overview (.pf-next-card-desc): .92rem 600, grey, line height 1.45, 3px under the name' },
        { name: 'first', meaning: 'the one to do first', from: 'the overview (.pf-next-card--primary): the row on the sun, the arrow kept as →; the line, the number and the arrow in --on-sun (lab: .dl-index-item--first)' },
      ],
      text: 'NumberedIndex (.poster-index-item, numbered-index.css). The overview\'s steps (NextSteps, .pf-next-card, profile.css) are the same shape written again: the name 1.25rem 800 against 1.3rem 600, padding 14px against .9rem (14.4px), gap 20px against 1.4rem (22.4px), the number at 400 against 600. Both lists have a 2px ink rule under each row and a 3px rule over the list. Below 560px the home\'s rows are 1.05rem (--text-md-plus) and the overview\'s names stay 1.25rem; the lab frames are 480px wide, so they show the phone sizes. Contrast on the sun today: the grey line 2.74:1 (1.33:1 dark), the coral number about 2.0:1 (1.5:1 dark), the arrow 1.52:1 in dark mode; the home\'s opened row (--on) has the same coral number. In the proposal all of them take --on-sun. The eight other lists, measured at 1280px on the sandbox where a page shows them: Wallet (.wal-steps, wallet-poster.css; a way to get paid, opened): an ol, .86rem (13.76px) 400 ink, line height 1.55, the browser\'s numbers, coral links. Calibrator (.cal-ol, calibration-run.css; a run\'s proposals): an ol, .86rem, line height 1.5, ink. MCP (.og-mcp .ast-steps, mcp-poster.css; the guide, tool by tool): an ol, .92rem (14.72px) 400 ink, line height 1.6; the part\'s own .ast-steps is .875rem grey. Agents (.agp-basic-list i, agents-poster.css; the basic agents): a Listing with a number column, "01" in mono .78rem (12.48px) coral, the name .95rem (15.2px) 800; the same page\'s Connect steps (.agp-connect .ast-steps) count the same way beside 1rem 600 grey rows with a 1px grey rule. Nodes (.pn-setup, profile.css; a server\'s setup steps): an ol, .85rem, line height 1.7, each step grey, and each step\'s words begin with their own number ("1. Open…"), so the browser\'s number comes before it. Ecosystem (.pf-eco-auto-how-steps, profile.css; How this works): an ol, .85rem ink, .25rem apart, in a grey box with a 1px grey frame and 8px corners. AI (.pf-dr-order, profile.css; Decision rules): an ol, .8rem (12.8px) 400 grey (--muted). AI (.pf-cmp-models, .pf-cmp-limits, profile.css; your own AI use): bullets, .82rem (13.12px) 400 grey. The proposal draws each as NumberedIndex rows in the plain tone (1.3rem 600, the number mono coral, 2px ink rules); the links, the grey box and the Listing\'s tags are not in the pictures. No page on the sandbox shows the calibrator\'s proposals (they need a calibration run), a server\'s setup steps (the Nodes page lists no server on the sandbox, although one is registered) or the ecosystem steps (they need an ecosystem app), so those three have no context picture.',
    },
    variants: [
      { id: 'numbered-index', name: 'The home\'s numbered list', code: '.poster-index-item (NumberedIndex.js, numbered-index.css)', becomes: 'the plain tone. Accepting it means the overview takes these rows; an opened row\'s number turns dark', look: 'Archivo 1.3rem 600; the number mono coral; a 2px rule under each row', where: 'the home: What would you like to set up?', crop: home('.poster-index-item') },
      { id: 'next-steps', name: 'The overview\'s suggested next steps', code: '.pf-next-card, --primary (NextSteps in landing-page.cards.js, profile.css)', becomes: 'the home\'s rows; each step keeps the line under its name, and the first step stays on the yellow ground with every mark dark', look: 'the name Archivo 1.25rem 800 with a grey line under it; the first row on the sun', where: 'Settings & Controls: the overview', crop: { url: '/v1/profile', selector: '.pf-next-card' } },
      // The eight other lists of Settings (wave 4): none used most.
      { id: 'wallet-steps', name: 'Wallet: the steps to get a key', code: '.wal-steps (wallet/rows.js, wallet-poster.css)', becomes: 'the home\'s rows, one step a row', look: 'a numbered list .86rem, ink', where: 'Settings & Controls: Wallet, a way to get paid, opened', crop: { url: '/v1/profile?tab=wallet', click: "button:has-text('Add key')", selector: '.wal-steps li', around: '.wal-steps' } },
      { id: 'calibrator-proposals', name: 'Calibrator: the proposals of a run', code: '.cal-ol (calibrator/run.js, calibration-run.css)', becomes: 'the home\'s rows, one proposal a row', look: 'a numbered list .86rem, ink', where: 'Settings & Controls: Calibrator, a run\'s proposals', crop: null },
      { id: 'mcp-steps', name: 'MCP: the steps for one AI tool', code: '.og-mcp .ast-steps (ai-setup-guide.js, mcp-poster.css)', becomes: 'the home\'s rows, one step a row', look: 'a numbered list .92rem, ink', where: 'Settings & Controls: MCP, the guide, tool by tool', crop: { url: '/v1/profile?tab=mcp', click: '.og-fold--toggle:has-text("The guide")', selector: '.og-mcp .ast-steps li', around: '.og-mcp .ast-steps' } },
      { id: 'agents-counter', name: 'Agents: rows with a counted number', code: '.agp-basic-list i (basic-agents-panel.js, agents-poster.css); also .agp-connect .ast-steps', becomes: 'the home\'s rows, each agent\'s line under its name', look: 'a list row with "01" in small coral typewriter letters, the name bold', where: 'Settings & Controls: Agents, the basic agents and the steps to connect', crop: { url: '/v1/profile?tab=agents', selector: '.agp-basic-list .listing-name', around: '.agp-basic-list' } },
      { id: 'nodes-setup', name: 'Nodes: the setup steps of a server', code: '.pn-setup ol (nodes-tab.js, profile.css)', becomes: 'the home\'s rows, one step a row, the number once', look: 'a numbered list .85rem, grey, each step with a second number in its words', where: 'Settings & Controls: Nodes, a server\'s setup steps', crop: null },
      { id: 'ecosystem-how', name: 'Ecosystem apps: how the automation runs', code: '.pf-eco-auto-how-steps (ecosystem-tab.automation.js, profile.css)', becomes: 'the home\'s rows, one step a row', look: 'a numbered list .85rem, ink, in a grey box with round corners', where: 'Settings & Controls: Ecosystem apps, an app\'s automation, How this works', crop: null },
      { id: 'ai-decide-order', name: 'AI: the order of the decision rules', code: '.pf-dr-order (decide-rules.js, profile.css)', becomes: 'the home\'s rows, one step a row', look: 'a numbered list .8rem, grey', where: 'Settings & Controls: AI, Decision model', crop: { url: '/v1/profile?tab=ai', click: "button:has-text('Decision model')", selector: '.pf-dr-order li', around: '.pf-dr-order' } },
      { id: 'ai-compliance', name: 'AI: what the counts do not cover', code: '.pf-cmp-limits, .pf-cmp-models (compliance-card.js, profile.css)', becomes: 'the home\'s rows, one note a row, with numbers', look: 'a bulleted list .82rem, grey', where: 'Settings & Controls: AI, your own AI use', crop: { url: '/v1/profile?tab=ai', click: "button:has-text('Your own AI use')", selector: '.pf-cmp-limits li', around: '.pf-cmp-limits' } },
    ],
    changes: [
      { page: 'Settings & Controls, overview', what: 'The step names get less bold. On a computer they also get a little larger and the rows get a little more room. On a phone, as in the pictures on this page, they get smaller, because the home\'s rows are smaller on a phone. The line under each name and the yellow first step stay. On the yellow step, the grey line, the coral number and the arrow turn dark like the name: today the line and the number are hard to read on the yellow ground, and in dark mode the arrow is too.' },
      { page: 'Home', what: 'When you open one of the things to set up, its number turns dark on the yellow ground instead of coral. Nothing else changes.' },
      { page: 'Wallet, Calibrator, MCP, Nodes, Ecosystem apps, AI: if you also say yes to the second question', what: 'Each list of steps becomes the home\'s rows: every step is a row with its number, its words in the home\'s larger, bolder letters, and a thick line under it. Each row also gets the home\'s arrow, which says the row opens something, although a step opens nothing. The small grey lists of AI and Nodes get much larger and turn from grey to ink. On Nodes each step shows its number once. The ecosystem steps leave their grey box. The notes of your own AI use get numbers instead of bullets. The links in the Wallet steps stay.' },
      { page: 'Agents: if you also say yes to the second question', what: 'The basic agents and the steps to connect an AI get the home\'s rows. The number stays in small coral typewriter letters; the arrow and the thick line under each row are new. Each agent keeps the line under its name and its tags. The word at the end of the row that says you have the agent is not in the picture; it would stay, before the arrow.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal, and it covers the eight other lists of steps in Settings too: \"numeroidun listan kohdalla hyväksytty ehdotus\" (Jouni).","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'conversation-list',
    title: 'Conversation list: your conversations',
    question: 'The chat lists your conversations with your AI, and Messages lists your conversations with people, grouped by person. The two lists are drawn in two ways. Should Messages use the chat\'s list?',
    proposal: {
      variant: 'proposal', name: 'The chat\'s list, grouped by person',
      summary: 'One list of conversations: the name in bold, a quiet line under it, the one you are reading on the yellow ground. In Messages, each person\'s conversations stay under that person\'s heading, which still opens and closes, and the unread numbers stay.',
      tones: [
        { name: 'open', meaning: 'the conversation you are reading', from: 'the chat (.poster-thread--active): the sun with a 2px ink rule under it; the line under the name in --on-sun (lab: .dl-readable), where it is grey today at 2.74:1 (1.33:1 dark)' },
        { name: 'unread', meaning: 'how many messages you have not read', from: 'the decided Count, waiting tone (.poster-count--waiting): mono .7rem on coral; in the person\'s heading with the word "unread"' },
        { name: 'person', meaning: 'a heading over one person\'s conversations that opens and closes them', from: 'lab .dl-thread-person: the arrow (list-panel.js Chevron), a 24px framed picture, the name .92rem heavy, the presence word (PresenceDot with its label), "3 conversations" in the Count\'s tally tone and "2 unread" in its waiting tone' },
      ],
      text: 'ThreadList (.poster-thread-list, thread-list.css): the name Archivo .86rem 800 on one line, cut with …; the line under it mono .68rem grey; rows 1px --border apart; delete is the small icon button. Messages (ListPanel, .inbox-conv, inbox.css and inbox-poster.css): the row is a button that does not take the page\'s face, so its name reads Arial 14px 400, black on a closed row, and its last message Arial 13px; a 40px picture for a person with one conversation; a mark before a row inside a group (# subject, ag agent, · direct); the time on the right; the unread count on coral (.inbox-conv-badge, mono .69rem 700); the archive box a framed 30px square beside the row. The section heading (People, Your agents, Archive: .inbox-sec-head, Fjalla .78rem coral) takes the decided Group heading (.poster-day-title). In the proposal the row is .poster-thread; the line under the name carries the time and the last message on one line cut with … (the chat\'s line does not cut today); the archive box is .poster-icon--small in the delete\'s place and still archives.',
    },
    variants: [
      { id: 'thread-list', name: 'The chat\'s conversation list', code: '.poster-thread (ThreadList.js, thread-list.css)', becomes: 'stays as it is, except that the line under the open conversation\'s name turns dark. Accepting it means Messages takes this list', look: 'the name bold .86rem, a mono line under it; the open one on the sun', where: 'the chat: the side column', crop: { url: '/v1/chat', selector: '.poster-thread', around: '.poster-thread-list' } },
      { id: 'inbox-list', name: 'Messages\' conversation list', code: '.inbox-conv, .inbox-conv-group (ListPanel in list-panel.js, inbox.css, inbox-poster.css)', becomes: 'the chat\'s rows under each person\'s heading; the unread numbers stay, on coral', look: 'the name in plain system letters, a picture per person, the time on the right, the unread count on coral', where: 'Settings & Controls: Messages', crop: { url: '/v1/profile?tab=messages', selector: '.inbox-conv .inbox-name' } },
    ],
    changes: [
      { page: 'Settings & Controls, Messages: the rows', what: 'Each conversation reads as the chat\'s: its name in bold in the page\'s own letters (today plain system letters, black), and under it one quiet line with the time and the last message, cut short as now. The time moves there from the right end of the row. The conversation you are reading is on the yellow ground, and the line under its name is dark there so it can be read. The unread number on a row stays. The archive box stays and still archives the conversation; it is drawn as the small framed square the chat uses, and shows on the open row and under the pointer, as today.' },
      { page: 'Settings & Controls, Messages: the headings', what: 'The section heading (People, Your agents, Archive) becomes small coral capitals over a thick line, the group heading you chose. Under it, each person\'s heading keeps its arrow that opens and closes the group, their small picture and their name. It says in a word whether they are online, and its two numbers get words: "3 conversations" and "2 unread".' },
      { page: 'Settings & Controls, Messages: what goes', what: 'The small mark before a row inside a group (# for a conversation with a subject, ag for one with an agent): the row\'s name already says which it is. The big picture on the row of a person with only one conversation: the name says who.' },
      { page: 'Chat', what: 'On the open conversation\'s yellow row, the grey line under the name turns dark so it can be read. Nothing else.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the chat's list, grouped by person in Messages.","decidedBy":"Jouni","decidedAt":"2026-09-25"},
  },
  {
    id: 'message',
    title: 'Message: one thing somebody said',
    question: 'The chat draws a message as a turn: your words on the yellow ground, the other side\'s beside a pale coral line, the time under it. Messages draws it as a framed box: yours on the yellow ground, theirs in a dark frame. Should Messages use the chat\'s turn?',
    proposal: {
      variant: 'proposal', name: 'The chat\'s turn',
      summary: 'Every message as the chat\'s turn: your words bold on the yellow ground, the other side\'s beside a pale coral line, the time under the message. In Messages, the sender\'s name stays above the words, the read marks stay after the time, and all eight actions stay: Copy and Listen in the line under the message, as in the chat, and the other six behind one ⋯ square beside them, so the line fits a phone.',
      tones: [
        { name: 'yours', meaning: 'what you said', from: 'the chat (.poster-turn--user .poster-turn-body): Archivo 1.1rem 800, -.01em, on the sun, 10px 16px' },
        { name: 'theirs', meaning: 'what the other side said: your AI, a person or their agent', from: 'the chat (.poster-turn--agent .poster-turn-body): a 6px spine in --accent-border (coral at about a fifth, so it reads pale), 18px in, .95rem 600' },
      ],
      text: 'Turn (.poster-turn, turn.css). The line under it is .poster-turn-meta, mono .68rem grey, where the chat already keeps Copy and Listen as the text action (.poster-action--text). MessageBubble (.inbox-bubble, inbox.css and inbox-poster.css): a 2px frame, 8px 12px; yours on the sun in a sun frame, theirs on the card ground in an ink frame beside a 28px picture; the sender\'s name above the words (.inbox-bubble-who, .64rem 700, .08em, capitals, coral for theirs, ink for yours); the words .95rem 400; the time .625rem and the read marks (.inbox-tick--read, coral); eight actions over the top edge, shown when the pointer is on the message (.inbox-bubble-actions, opacity 0 until then; always on a touch screen). In the proposal (lab classes): the name keeps its look above the words (.dl-turn-who), the line under the message wraps (.dl-turn-meta), and the six other actions are one .poster-icon--small ⋯ (a menu, as the card menu is).',
    },
    variants: [
      { id: 'turn', name: 'The chat\'s turn', code: '.poster-turn, --user, --agent (Turn.js, turn.css)', becomes: 'stays as it is. Accepting it means Messages takes this turn', look: 'yours bold 1.1rem on the sun; the other side\'s beside a 6px pale coral spine; the time mono under it', where: 'the chat', keptAsIs: true, crop: chatThread(0, '.poster-turn--user .poster-turn-body') },
      { id: 'bubble', name: 'Messages\' framed box', code: '.inbox-bubble, --mine, --theirs (MessageBubble in inbox-tab/components.js)', becomes: 'the chat\'s turn; the name, the read marks and all eight actions stay', look: 'a 2px frame; yours on the sun, theirs in ink beside a picture; the name above the words', where: 'Settings & Controls: Messages, an open conversation', crop: { url: '/v1/profile?tab=messages', click: '.inbox-conv', selector: '.inbox-bubble--mine' } },
    ],
    changes: [
      { page: 'Settings & Controls, Messages: what goes', what: 'The frame around each message, and the picture beside the other side\'s messages.' },
      { page: 'Settings & Controls, Messages: what changes', what: 'Your words get bold and a little larger, on the yellow ground as now. The other side\'s words get a little bolder and sit beside a pale coral line down the left. The actions: today all eight show over the top of a message when the pointer is on it. In the proposal, Copy and Listen show under every message, and the other six (reply, mark important, track a response, add to notebook, reply with AI, delete) open from one ⋯ square beside them. On a narrow screen the line wraps, so nothing falls off the edge.' },
      { page: 'Settings & Controls, Messages: what stays', what: 'The sender\'s name above each message, in its small capitals. The time under the message, and the read marks (✓✓) after the time on yours.' },
      { page: 'Chat', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the chat's turn in Messages too.","decidedBy":"Jouni","decidedAt":"2026-09-25"},
  },
  {
    id: 'typing-box',
    title: 'Typing box: where you write',
    question: 'The chat\'s typing box is one row: the field, the tool buttons and Send. Messages puts a framed field above a row of tools and the Reply button. Should Messages use the chat\'s row?',
    proposal: {
      variant: 'proposal', name: 'The chat\'s one row',
      summary: 'One row: the field with a thick line under it, the tools as framed squares, and the dark block that sends. In Messages, the third tool, the bigger editor, stays as one more square in the row, and the button keeps its own word. On a phone, Messages\' field keeps the whole width and the tools and the button sit under it, so there is room to write.',
      text: 'Composer (.poster-composer, composer.css): the field .poster-composer-input, 1.05rem 700, a 3px underline, no fill; the tools .poster-icon (44px, a 2px ink frame); Send .poster-slab--control (44px high). The inbox Composer (.inbox-composer, inbox.css and inbox-poster.css): a 3px ink frame on the card ground, 10px 12px; the field .inbox-textarea, 1rem 600, a 2px ink frame, 9px 12px; the tools .inbox-attach-btn, 38px, a 1px --border frame, round corners; Reply was .btn-primary.btn-sm (26px high) on main and is already the dark block on this branch (3af1a7964, decision "Loud action"). The row holds three tools: attach, voice and the bigger editor. A poll is written in the Broadcast form, which uses the same box; scheduling an agent is in the conversation\'s "…" menu; an agent\'s commands are chips above the field. Those stay where they are. On a phone (below 760px, the composer\'s own phone width) the proposal wraps Messages\' row: the field takes the first line (lab .dl-row--stack); with three squares and the button in one line the field was about 70px wide at 390px. The lab frames are 480px wide, so they show that. The option\'s "What changes" line is measured on a tool (the attach square); the field\'s change is said in words. The chat\'s crop hides the note that says no chat agent is set up on the sandbox (.poster-composer-note, removed before the picture).',
    },
    variants: [
      { id: 'chat-composer', name: 'The chat\'s typing box', code: '.poster-composer (Composer.js, composer.css)', becomes: 'stays as it is. Accepting it means Messages takes this row', look: 'one row: the field with a 3px underline, 44px framed squares, the dark block Send', where: 'the chat', keptAsIs: true, crop: { url: '/v1/chat', selector: '.poster-composer-row', eval: "document.querySelector('.poster-composer-note')?.remove();" } },
      { id: 'inbox-composer', name: 'Messages\' typing box', code: '.inbox-composer (Composer in inbox-tab/components.js, inbox.css, inbox-poster.css)', becomes: 'the chat\'s row; attach, voice and the bigger editor are three squares in it; the button keeps its word', look: 'a framed field above a row of three 38px round-cornered tools and the Reply button', where: 'Settings & Controls: Messages, an open conversation and the Broadcast form', crop: { url: '/v1/profile?tab=messages', click: '.inbox-conv', selector: '.inbox-composer' } },
    ],
    changes: [
      { page: 'Settings & Controls, Messages, on a computer', what: 'The field loses its frame and gets a thick line under it, as in the chat. The tools move from the row under the field to the right of it, and their thin grey round frames become square dark frames. The Reply button stays the dark block with the yellow shadow (on main it is still a small button, and becomes that block). The bigger editor still opens from its square.' },
      { page: 'Settings & Controls, Messages, on a phone (the pictures on this page)', what: 'The field gets the thick line under it and keeps the whole width. The tools, now square dark frames, and the dark Reply block sit in the row under it, as the tools do today.' },
      { page: 'Settings & Controls, Messages: Broadcast', what: 'No picture of its own: the Broadcast form uses the same box, so it changes in the same way. Only the button\'s words differ: Send to all, or Send poll.' },
      { page: 'Chat', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the chat's one row in Messages too.","decidedBy":"Jouni","decidedAt":"2026-09-25"},
  },
  {
    id: 'settings-door',
    title: 'Action link in Settings: the quiet way on of a Settings page',
    question: 'Your decision "Action link" made the home\'s underlined capitals the one quiet way on, chosen from six looks on the home and in the chat. On main, Settings and the admin pages draw their own, smaller one about 800 times, and it was not among the six. Should Settings take the home\'s action link at its full size everywhere, or keep its smaller size as a small tone of the action link?',
    proposal: {
      variant: 'proposal', name: 'One action link, with a small tone for Settings',
      summary: 'The home\'s action link stays as it is. In the head of a Settings page, in its sections and at the end of a list row, a small tone keeps the size and the thinner line these pages have today, and a lower-case tone keeps the softer ones. Settings looks as it does now.',
      tones: [
        { name: 'full', meaning: 'a way on where there is room: the home, the chat, a dialog', from: 'the home (.poster-action): Archivo .9rem 800 caps, .04em, a 3px ink line, 2px under the words' },
        { name: 'small', meaning: 'a way on in a Settings page head or section, and smaller still at the end of a dense row', from: 'the Settings door (.og-door, organism-controls.css): .8rem 800 caps, .04em, a 2px line, 1px under the words; .72rem in a row (.sk-go, .og-tbl-door, .ac-row and their admin kin)' },
        { name: 'lower-case', meaning: 'a softer way on: "Show 13 more", "Copy ref"', from: 'the quiet door (.og-door--quiet): no capitals, no letter spacing, .88rem; .72rem in a row' },
      ],
      text: 'Lab-only classes draw the tones (.dl-action--small, --row, --lower in design-lab-proposals.css). The Settings door is .og-door in css/views/organism-controls.css, which the admin also loads: 835 uses in 155 files (72 of them in admin views), 526 of them with --quiet; it also has a --danger tone (62 uses, coral words and line) and --up, --off, --on and --coral (9 uses together), which the small tone keeps. The row size is written again in each row\'s own sheet (.sk-go .og-door, .og-tbl-door .og-door, .ac-row > .ac-r .og-door and about ten more, from .7rem to .82rem). The action link already has a quiet tone (.poster-action--quiet: .78rem caps, a 2px line; the chat\'s side column actions), .02rem from the door: the small tone can be that tone at .8rem. Measured on Skills at 1280px before cec21156c: page head and section .8rem (12.8px), a row .72rem (11.52px), "Show 13 more" .88rem (14.08px); the home\'s link .9rem (14.4px). This branch (cec21156c, "every quiet way on is the action link") already drew the Settings pages\' ways on as .poster-action: on Skills now the head, sections and rows are .9rem with a 3px line, and the lower-case ones .poster-action--quiet (.78rem caps). The counts above are main\'s; on this branch 87 files still carry .og-door, nearly all admin, where it is lower-case (--quiet: .88rem in a section head, .72rem in a row) or --danger, and no page draws the capital door any more, so its crop has no picture. The admin crops are from Agents.',
    },
    variants: [
      { id: 'home-action', name: 'The home\'s action link', code: '.poster-action (poster.css)', becomes: 'stays as it is. Accepting it on its own means it is the one look, larger in Settings', look: 'Archivo .9rem 800 caps, a 3px ink line', where: 'the home, the chat, every dialog', keptAsIs: true, crop: { url: '/v1/home', selector: '.poster-masthead-actions .poster-action', around: '.poster-masthead-actions' } },
      { id: 'settings-door', name: 'Settings\' way on in a page head or a section', code: '.og-door (organism-controls.css)', becomes: 'the small tone (no visible change)', look: '.8rem 800 caps, a 2px ink line', where: 'on main, Settings & Controls: the head of a page and its sections. This branch already draws the home\'s link there', crop: null },
      { id: 'row-door', name: 'Settings\' way on at the end of a list row', code: '.adm-ag-go .og-door and its kin in each row\'s sheet (.og-tbl-door, .ac-row, .adm-ex-go; .sk-go on main)', becomes: 'the small tone in a row (no visible change)', look: '.72rem 800, a 2px ink line; lower-case in the admin rows, capitals in main\'s Settings rows', where: 'the admin rosters (Agents, Extensions, GHII users); on main also the Settings lists (Skills, Libraries, Packages, Access)', crop: { url: '/v1/admin?tab=agents', selector: '.adm-ag-go .og-door' } },
      { id: 'quiet-door', name: 'Settings\' lower-case way on', code: '.og-door--quiet (organism-controls.css)', becomes: 'the lower-case tone (no visible change)', look: '.88rem 800, no capitals, a 2px ink line; .72rem in a row', where: 'the admin: section heads and rows; on main also Settings & Controls, under a list and beside a row\'s main way on', crop: { url: '/v1/admin?tab=agents', selector: '.og-sec-h .og-door--quiet' } },
    ],
    changes: [
      { page: 'Admin, and Settings & Controls on main, if you accept the proposal', what: 'Nothing you can see. The pages draw their ways on with the action link\'s small and lower-case tones instead of a look of their own.' },
      { page: 'Settings & Controls on this branch, if you accept the proposal', what: 'This branch already draws the home\'s full-size link in Settings. Its ways on go back to the smaller size and the thinner line they have on main.' },
      { page: 'Admin, and Settings & Controls on main, if you accept the home\'s link on its own', what: 'Every quiet way on gets larger and gets a thicker line under it: a little larger in page heads and sections, about a quarter larger at the end of a list row. The lower-case ones are set in capitals. The ways on at the end of a row take more of the row\'s width. The Settings pages on this branch already look like this.' },
      { page: 'Home, chat and dialogs', what: 'Nothing, in either case.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: one action link, with a small and a lower-case tone for Settings.","decidedBy":"Jouni","decidedAt":"2026-09-25"},
  },
  {
    id: 'code-block',
    title: 'Code block: a block of code or a prompt to copy',
    question: 'Settings tabs show a block of code, a command or a prompt to copy in four ways: in a dark frame, on a grey patch, on a grey patch with a dark line on the left, and in a thin light frame. No way is used by most tabs. Which one should every code block use?',
    proposal: {
      variant: 'grey', name: 'The grey patch',
      summary: 'Every code block on a grey patch without a frame, in the typewriter letters, with long lines wrapped. It is the look Skills and Portfolio have today and the look of the library\'s code block.',
      text: 'The library\'s .code-block (css/components/code-block.css, linked in spa.html, not yet used by a page) has the values of .sk-pre: mono .74rem, line height 1.5, --bg-dim ground, no frame, .6rem .8rem, pre-wrap. It takes the look chosen here. Today: framed (.mc-code .76rem, .ex-out, .lb-out, .ap-code .72rem on --bg-dim; .cp-out, .mp-raw .8rem on the card ground; .ex-api on the page ground; all a 2px ink frame, most with a max height and their own scroll): Extensions, Capabilities, Libraries, MCP, Memory, Apps (6 tabs). Grey (.sk-pre, .pf-req .72rem): Skills, Portfolio (2). Grey with a 3px ink rule on the left (.ac-road pre, .cal-road pre, .dw-road pre, .wal-road pre, all .74rem): Access, Calibrator, Data wallet, Wallet (4). Light frame (.bp-code .72rem, .wp-code .7rem: 1px --border, card ground, white-space: pre, so long lines scroll sideways): Boards, Workflows, and the organism records (3). Measured at 1280px on Skills (.sk-pre: 11.84px, padding 9.6px 12.8px) and Access (.ac-road pre: the same with the 3px rule, padding 9.6px 11.2px).',
    },
    variants: [
      { id: 'framed', name: 'Code in a dark frame', code: '.mc-code and kin (.ex-out, .lb-out, .cp-out, .mp-raw, .ap-code, .ex-api)', becomes: 'the grey patch: the dark frame goes', look: 'mono .72-.8rem, a 2px ink frame, grey or card ground', where: 'Settings & Controls: Extensions, Capabilities, Libraries, MCP, Memory, Apps', crop: { url: '/v1/profile?tab=mcp', click: '#mcp-proof .og-fold--toggle', selector: '.mc-code' } },
      { id: 'grey', name: 'Code on a grey patch', code: '.sk-pre, .pf-req; the library\'s .code-block', becomes: 'stays as it is. Accepting it means every code block takes this look', look: 'mono .74rem, grey ground, no frame', where: 'Settings & Controls: Skills, Portfolio', crop: { url: '/v1/profile?tab=skills', selector: '.sk-pre' } },
      { id: 'grey-rule', name: 'Code on a grey patch with a dark line on the left', code: '.ac-road pre, .cal-road pre, .dw-road pre, .wal-road pre', becomes: 'the grey patch: the dark line on the left goes', look: 'mono .74rem, grey ground, a 3px ink rule on the left', where: 'Settings & Controls: the ready-made requests of Access, Calibrator, Data wallet, Wallet', crop: { url: '/v1/profile?tab=access', selector: '.ac-road pre' } },
      { id: 'light-frame', name: 'Code in a thin light frame', code: '.bp-code, .wp-code', becomes: 'the grey patch: the light frame goes, and long lines wrap', look: 'mono .7-.72rem, a 1px light grey frame, card ground; long lines scroll sideways', where: 'Settings & Controls: Boards, Workflows, the organism records', crop: { url: '/v1/profile?tab=boards', click: '#bp-app .og-fold--toggle', selector: '.bp-code' } },
    ],
    changes: [
      { page: 'Extensions, Capabilities, Libraries, MCP, Memory, Apps', what: 'The dark frame around the code goes. The code sits on the grey patch; in Capabilities and Memory the ground turns from white to grey.' },
      { page: 'Access, Calibrator, Data wallet, Wallet', what: 'The dark line on the left of a ready-made request goes. The grey patch stays.' },
      { page: 'Boards, Workflows, organism records', what: 'The thin light frame goes and the ground turns grey. Long lines wrap onto the next line instead of scrolling sideways.' },
      { page: 'Skills, Portfolio', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: every code block on the grey patch.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  // ── Five more, found by the wave 2 builders (2026-09-25). The pictures are drawn after this
  //    branch's changes, since that is what the pages draw now.
  {
    id: 'box',
    title: 'Box: the frame around one thing in Settings',
    question: 'Settings draws a frame around one thing in four ways: a dark frame, a thicker dark frame, the thicker frame with a yellow shadow, and a thin grey frame with round corners. Should they become one box, with the yellow shadow kept for the one thing that stands out?',
    proposal: {
      variant: 'proposal', name: 'The Object box, with a raised tone',
      summary: 'Every framed thing in the dark frame of the Object box, the box you chose for the home and the chat. The thing that stands out, an opened row or the way to take first, keeps the thicker frame with the yellow shadow.',
      tones: [
        { name: 'plain', meaning: 'one thing', from: 'the Object box (.poster-box, poster.css): a 2px ink frame (--shape-frame), the card ground, padding 1rem, no shadow' },
        { name: 'raised', meaning: 'the thing that stands out: a row you opened, or the way to take first', from: 'the opened record (.poster-record, .listing-open) and the lead roads: a 3px ink frame (--shape-frame-heavy) with --shape-shadow-raised, 8px 8px 0 sun' },
      ],
      text: 'Measured at 1280px on this branch: .poster-box (Skills, the roads that are not the lead: 2px ink, white, no shadow; 14 tabs by the builders\' count). .poster-frame (Skills "The rule your AI needs" .sk-rule, Wallet ".wal-pace"): a 3px ink frame, white, and no shadow, because --shape-shadow is none (11 tabs). Raised: the opened records (.listing-open and the *-open panels, .pf-agd-idcard, .pj-doc-view, .pf-prev, .wp-confirm; 13 tabs) with the 8px sun shadow; the lead roads with 8px (.ac-road.is-lead, .wal-road.is-lead, .dw-road.is-lead, .cal-road.is-lead; 4 tabs) or 6px (.sk-road--lead, .pk-road--lead, .pf-road--lead; 3 tabs). Thin grey: 1px --border, 6-16px round corners (for example an agent\'s data scope .pf-agd-scope-summary: 1px --border, 6px corners, --bg-dim ground, mono .72rem grey words; .pf-agd-crew-card, .pf-agd-crew-llm; 7 tabs, most on Organisms). The picture and the crop are the agent\'s data scope (an agent\'s Memory tab).',
    },
    variants: [
      { id: 'object-box', name: 'The dark frame (the Object box)', code: '.poster-box (poster.css)', becomes: 'the plain tone (no visible change)', look: 'a 2px ink frame on the card ground', where: 'Settings & Controls: 14 tabs, for example Skills, Packages, Wallet', crop: { url: '/v1/profile?tab=skills', selector: '.sk-road.poster-box' } },
      { id: 'frame', name: 'The thicker dark frame', code: '.poster-frame (poster.css)', becomes: 'the plain tone: its frame gets thinner', look: 'a 3px ink frame on the card ground, no shadow', where: 'Settings & Controls: 11 tabs, for example Skills, Wallet', crop: { url: '/v1/profile?tab=skills', selector: '.sk-rule' } },
      { id: 'raised', name: 'The thicker frame with a yellow shadow', code: '.poster-record, .listing-open, the *-open panels; the lead roads (.ac-road.is-lead, .sk-road--lead and kin)', becomes: 'the raised tone; the smaller yellow shadow of three tabs\' first way grows to the others\' size', look: 'a 3px ink frame, an 8px (or 6px) yellow shadow', where: 'Settings & Controls: an opened row in 13 tabs; the way to take first in 7 tabs', crop: { url: '/v1/profile?tab=access', selector: '.ac-road.is-lead' } },
      { id: 'thin-grey', name: 'The thin grey frame with round corners', code: '1px --border, 6-16px corners (.pf-agd-scope-summary, .pf-agd-crew-card and kin)', becomes: 'the plain tone: a dark square frame', look: 'a 1px light grey frame, round corners', where: 'Settings & Controls: 7 tabs, most on Organisms; an agent\'s Memory and Crew', crop: agentTab('Memory', '.pf-agd-scope-summary') },
    ],
    changes: [
      { page: 'The 11 tabs with the thicker frame (for example Skills, Wallet)', what: 'The frame gets a little thinner, as the Object box\'s.' },
      { page: 'Skills, Packages, Portfolio', what: 'The yellow shadow of the first way grows a little, to the size the other pages use.' },
      { page: 'The 7 tabs with thin grey boxes (most on Organisms)', what: 'The thin grey frame with round corners becomes the dark square frame.' },
      { page: 'An opened row, and the way to take first, on every tab', what: 'Nothing: they keep the thicker frame with the yellow shadow.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the Object box, with the raised tone.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'sub-heading',
    title: 'Sub-heading: a small heading over a group of fields or a card',
    question: 'Inside a section, a small heading names a group of fields or a card. It is drawn in four ways, each on a few tabs: small coral capitals, ink bold words, small ink headline letters, and small coral headline letters. Which one should every sub-heading use?',
    proposal: {
      variant: 'poster-ink', name: 'Small ink headline letters',
      summary: 'Every sub-heading in small headline letters in ink. The coral small capitals stay for a field\'s label and for the heading over a list, so the three do not look alike.',
      text: 'Measured at 1280px on this branch. Coral small capitals: .card-h3 (Security "My CORS origins": Fjalla .72rem 800 caps, .1em, coral; also .pf-agd-section-title, .pj-section-title; about 5 tabs). Ink bold: .card-title (profile-poster.css: 1.05rem, 16.8px, 600) and .pf-bold (Security "Allowed Origins": Archivo 16px 600; about 3 tabs). Small ink headline: .pf-aitr-sub, .pf-cmp-sub (AI "Your own TypeSafe key": Fjalla .9rem, 14.4px, 600, -.01em, ink). Small coral headline: .stat-panel-h4 (Node stats "Requests by method": Fjalla .9rem 700, coral). The Row label (.poster-label: Archivo .72rem 800 caps coral) names one field; the Group heading (.poster-day-title, the same with a 3px line) heads a list. A sub-heading in coral capitals reads as either of them.',
    },
    variants: [
      { id: 'coral-caps', name: 'Small coral capitals', code: '.card-h3, .pf-agd-section-title, .pj-section-title', becomes: 'small ink headline letters', look: 'Fjalla .72rem 800, capitals, coral', where: 'Settings & Controls: Security, Agents, Access and 2 more', crop: { url: '/v1/profile?tab=security', selector: '.card-h3' } },
      { id: 'ink-bold', name: 'Ink bold words', code: '.card-title, .pf-bold', becomes: 'small ink headline letters', look: 'Archivo 16-16.8px 600, ink', where: 'Settings & Controls: Security, Chat sessions and 1 more', crop: { url: '/v1/profile?tab=security', selector: '.card .pf-bold' } },
      { id: 'poster-ink', name: 'Small ink headline letters', code: '.pf-aitr-sub, .pf-cmp-sub', becomes: 'stays as it is. Accepting it means every sub-heading takes this look', look: 'Fjalla .9rem 600, ink', where: 'Settings & Controls: AI', crop: { url: '/v1/profile?tab=ai', click: "button:has-text('Decision model')", selector: '.pf-aitr-sub' } },
      { id: 'poster-coral', name: 'Small coral headline letters', code: '.stat-panel-h4', becomes: 'small ink headline letters: the coral goes', look: 'Fjalla .9rem 700, coral', where: 'Settings & Controls: Node stats', crop: { url: '/v1/profile?tab=nodes', click: '.sub-tabs .poster-tab:nth-child(2)', selector: '.stat-panel-h4' } },
    ],
    changes: [
      { page: 'Security, Agents, Access and 2 more', what: 'The small coral capitals over a card become small ink headline letters, as on the AI page.' },
      { page: 'Security, Chat sessions and 1 more', what: 'The bold card titles become small ink headline letters.' },
      { page: 'Node stats', what: 'The coral panel headings turn ink.' },
      { page: 'AI', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: small ink headline letters for every sub-heading.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'nodes-head',
    title: 'Nodes page head: where the page\'s name goes when it has tabs',
    question: 'Every other Settings page opens with a crumb, its name as a big title and one line saying what it is for. The Nodes page opens with the crumb and a row of two tabs (Nodes, Node stats), and has no title. Should it take the same head, with its tabs under it?',
    proposal: {
      variant: 'proposal', name: 'The Settings head, with the tabs under it',
      summary: 'The Nodes page opens as the other Settings pages do: the crumb, the name as a big title and one line. Its two tabs sit under that line.',
      text: 'The kit head: .og-crumb (mono .8rem grey), .og-mast--page with h1.og-title.poster-page-title (Fjalla 2.8rem, 44.8px, caps) and p.og-desc (Archivo .95rem 600 grey). The Nodes page (nodes-tab.js): the frame\'s crumb (.poster-crumb, mono .8rem coral), then .sub-tabs.poster-row--thing (a 3px ink line over two .poster-tab), then the band title of the list (.poster-section-title "Your own servers"). The line in the picture is the page\'s own words (profile.nodes.desc, already in en, fi and es; today under the band title), so no new words are needed on screen.',
    },
    variants: [
      { id: 'kit-head', name: 'The head of the other Settings pages', code: '.og-crumb, .og-mast--page, .og-title, .og-desc (page-head.css, crumb-trail.css)', becomes: 'the head of the Nodes page too, with its tabs under it', look: 'the crumb, a big title, one grey line', where: 'Settings & Controls: every page drawn with the page kit, for example Skills', crop: { url: '/v1/profile?tab=skills', selector: '.og-title' } },
      { id: 'tabs-only', name: 'The Nodes page\'s tab row, without a title', code: '.sub-tabs.poster-row--thing (nodes-tab.js)', becomes: 'the tab row under the Settings head', look: 'a thick line, two tabs, no title', where: 'Settings & Controls: Nodes and Node stats', crop: { url: '/v1/profile?tab=nodes', selector: '.sub-tabs' } },
    ],
    changes: [
      { page: 'Nodes, Node stats', what: 'The page gets the title NODES in big letters under the crumb. The grey line that says what the page is for, which today sits under the list\'s heading, moves up under the title. The two tabs move under that line. The heading of the list, "Your own servers", stays.' },
      { page: 'Every other Settings page', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the Settings head on the Nodes page, with its tabs under it.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'check-line',
    title: 'Check line: the words beside a check box or a radio dot',
    question: 'The box and the dot look the same everywhere, but the words beside them are at the body\'s size on about 8 tabs and smaller and grey on 8 others. Which size should they have?',
    proposal: {
      variant: 'body', name: 'The body\'s size, in ink',
      summary: 'The words beside every check box and radio dot at the size and colour of the page\'s own text, so a choice reads as easily as the sentence around it.',
      text: 'Measured at 1280px on this branch. Body size: .pk-compose-app (Packages, "Signal Room": Archivo 16px 400, ink); also .co-check, .pf-edit-check, the account dialog, access tokens and sharing groups (about 8 tabs). Small: .pf-nb-toggle (Notebook, "Detect on capture": Archivo .85em, 13.6px, 400, --text-dim); also .sk-check, .pf-dr-check, .ap-hint (13.12px) and kin (8 tabs). In between: .ai-radio (AI provider, 14.4px 600) and .cp-check (.9rem). The library\'s own switch (SettingsSwitch, .poster-settings-switch: .88rem, --muted) is used on the home\'s settings dialog and in admin, not on a Settings tab.',
    },
    variants: [
      { id: 'body', name: 'Words at the body\'s size', code: '.pk-compose-app, .co-check, .pf-edit-check and kin', becomes: 'stays as it is. Accepting it means every check line takes this size', look: 'Archivo 16px 400, ink', where: 'Settings & Controls: Access, Agents, Companies, Ecosystem, Notebook, Organisms, Packages, the account dialog', crop: { url: '/v1/profile?tab=packages', click: '.pk-road--lead .og-doors .poster-action', selector: '.pk-compose-app' } },
      { id: 'small', name: 'Smaller grey words', code: '.pf-nb-toggle, .sk-check, .pf-dr-check, .ap-hint and kin', becomes: 'the body\'s size, in ink', look: 'Archivo 13-13.6px 400, grey', where: 'Settings & Controls: Agents, AI, Ecosystem, Memory, Notebook, Organisms, Skills, Workflows', crop: { url: '/v1/profile?tab=notebook', selector: '.pf-nb-toggle' } },
    ],
    changes: [
      { page: 'Agents, AI, Ecosystem, Memory, Notebook, Organisms, Skills, Workflows', what: 'The words beside a check box or a radio dot get larger and turn from grey to ink. The box and the dot stay as they are.' },
      { page: 'Access, Companies, Packages, the account dialog', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the words beside a check box or a radio dot at the body's size, in ink.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'meta-line',
    title: 'Meta line: the small grey line under a name in a list',
    question: 'Under a name in a list, a small grey line says its size, owner, kind or date. It is in typewriter letters on 23 tabs, and in the body\'s letters, a little larger, on 22. The Listing, the list you chose for Settings, uses the typewriter letters. Should every such line?',
    proposal: {
      variant: 'mono', name: 'Small grey typewriter letters',
      summary: 'Every line under a name in small grey typewriter letters, as the Listing already draws it. The name above stays in the body\'s letters, so the two are easy to tell apart.',
      text: 'Measured at 1280px on this branch. Typewriter: .listing-name small and .listing-who small (listing.css: JetBrains Mono .7rem, 11.2px, 400, --text-dim), for example Access "in use · change it from the overview", Skills "public · 4.6 kB"; 23 tabs by the builders\' count. Body letters: Discover .dv-nm small ("your own records": Archivo .8rem, 12.8px, 400, --text-dim), Security .text-caption (Archivo .85rem, 13.6px); .78-.8rem on most of the 22 tabs.',
    },
    variants: [
      { id: 'mono', name: 'Small grey typewriter letters', code: '.listing-name small, .listing-who small (listing.css) and kin', becomes: 'stays as it is. Accepting it means every such line takes this look', look: 'JetBrains Mono .7rem, grey', where: 'Settings & Controls: 23 tabs, for example Access, Skills, and every list drawn as the Listing', crop: { url: '/v1/profile?tab=skills', selector: '.listing-name small' } },
      { id: 'body', name: 'Small grey body letters', code: '.dv-nm small, .text-caption and kin', becomes: 'small grey typewriter letters', look: 'Archivo .78-.85rem, grey', where: 'Settings & Controls: 22 tabs, for example Discover, Security, Apps', crop: { url: '/v1/profile?tab=discover', selector: '.dv-nm small' } },
    ],
    changes: [
      { page: 'Discover, Security, Apps and 19 more', what: 'The small grey line under a name changes to typewriter letters and gets a little smaller.' },
      { page: 'Access, Skills and the other 21 tabs', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: small grey typewriter letters under every name in a list.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  // ── Seven more, found by the wave 3 builders (2026-09-25), drawn as this branch's pages draw
  //    them now. Most sit on an agent's own pages, which the sandbox fills with too little data for a
  //    context picture; the lab says so under each such option.
  {
    id: 'rating-stars',
    title: 'Rating stars: how good a delivered piece of work was',
    question: 'Stars that show or give a rating are drawn in five ways: coral in the reviews, grey in the overall line, dark with grey empty stars in an opened task, grey stars that turn amber under the pointer when you rate, and the Offers\' yellow stars, which are now a library part. Should they all be the library\'s stars, dark on any ground?',
    proposal: {
      variant: 'proposal', name: 'The library\'s stars, dark and grey',
      summary: 'Every star rating is the library\'s Rating stars: the stars given are dark, the stars not given are grey. They are small in a line you read, and larger where you give a rating, where the stars up to the one under the pointer turn dark.',
      tones: [
        { name: 'shown', meaning: 'a rating you read in a line', from: 'the opened task (.agt-stars): 1rem; filled --text; empty --text-dim (the library\'s empty colour; the task\'s own --border reads about 1.2:1)' },
        { name: 'to give', meaning: 'the stars you press to rate', from: 'the library (.op-star, rating-stars.css): 1.4rem buttons; filled and under the pointer --text instead of --sun' },
      ],
      text: 'Today: the reviews (.pf-agd-quality-stars: --accent, 1px spacing, the line\'s size); the overall line (.pf-agd-quality-overall: .85rem, --text-dim, the stars written as ★☆ in the words); the rated row of Rate deliverables (.pf-agd-quality-pending-rated, coral); an opened task (.agt-stars 1rem --text, .agt-stars-off --border); the inline picker (.pf-agd-inline-star 1rem --border, --hot and :hover --warn); the rate dialog (.pf-agd-rate-star 1.6rem); the Offers (.op-star 1.4rem --text-dim, .on --sun). Against the page ground the sun reads about 1.7:1, --warn about 2.1:1, coral about 3.7:1 and ink about 16:1; a star is a shape that must be seen, so the proposal takes ink. The Offers\' filled stars change with it. All but the Offers sit on an agent\'s pages (Quality, Tasks); the sandbox has no rated task, so the options have no context picture.',
    },
    variants: [
      { id: 'review-coral', name: 'Coral stars in the reviews', code: '.pf-agd-quality-stars, .pf-agd-quality-pending-rated (tab-quality.js, agents-detail.css)', becomes: 'the shown tone: dark and grey', look: 'coral stars at the line\'s size', where: 'an agent\'s Quality: the reviews and the rated rows', crop: agentTab('Quality', '.pf-agd-quality-stars') },
      { id: 'overall-grey', name: 'Grey stars in the overall line', code: '.pf-agd-quality-overall', becomes: 'the shown tone: the stars given turn dark', look: 'grey stars in a .85rem grey line', where: 'an agent\'s Quality: under the reviews', crop: agentTab('Quality', '.pf-agd-quality-overall') },
      { id: 'task-dark', name: 'Dark stars with grey empty ones', code: '.agt-stars, .agt-stars-off (task-item.js, agent-tasks-poster.css)', becomes: 'the shown tone: the empty stars get a little darker', look: 'dark filled stars, pale grey empty ones, 1rem', where: 'an agent\'s Tasks: an opened task that was rated', crop: agentTab('Tasks', '.agt-stars', ['.agt-row:has-text("seat map")']) },
      { id: 'picker-amber', name: 'Stars that turn amber when you rate', code: '.pf-agd-inline-star, --hot (tab-quality.js); .pf-agd-rate-star (rate-modal.js)', becomes: 'the tone to give: dark under the pointer instead of amber', look: 'pale grey stars, amber up to the one under the pointer', where: 'an agent\'s Quality: rating a finished task, and the rate dialog', crop: { ...agentTab('Quality', '.pf-agd-inline-star--hot'), eval: "document.querySelectorAll('.pf-agd-inline-star')[2].dispatchEvent(new MouseEvent('mouseenter'));" } },
      { id: 'library', name: 'The library\'s yellow stars', code: '.op-stars, .op-star, .on (rating-stars.css)', becomes: 'the tone to give: the stars given turn from yellow to dark', look: 'grey stars, the given ones yellow, 1.4rem', where: 'Offers: rating an offer you used', crop: null },
    ],
    changes: [
      { page: 'An agent\'s Quality', what: 'The coral stars in the reviews and the rated rows turn dark, with the stars not given in grey. The stars in the overall line turn dark. When you rate, the stars up to the one under the pointer turn dark instead of amber.' },
      { page: 'An agent\'s Tasks', what: 'In a rated task, the stars not given get a little darker, so they can be seen.' },
      { page: 'Offers', what: 'The stars you give turn from yellow to dark.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the library's stars, dark and grey.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'activity-log',
    title: 'Activity log: a list of what happened',
    question: 'A list of what happened, one line per event, is drawn in three ways: rows with a kind tag in an agent\'s Activity, a ruled table in an opened task, and the home\'s timeline. Should every such list be the timeline?',
    proposal: {
      variant: 'proposal', name: 'The home\'s timeline, with the kind kept',
      summary: 'Every list of what happened is the home\'s timeline: the time, a coloured dot for the kind, and one line that says what happened. In an agent\'s Activity the kind tag stays beside the line, so the filters above still read.',
      tones: [
        { name: 'plain', meaning: 'one event', from: 'the Timeline (Timeline.js, timeline.css): .poster-timeline-item with its dot, line and time' },
        { name: 'with a kind', meaning: 'the event\'s kind named, where the page filters by kind', from: 'the Activity tag (.poster-chip) before the line' },
      ],
      text: 'Today: agent Activity (.pf-agd-log-entry--two-line: the time mono .68rem, a .poster-chip kind tag, the event word Archivo .8rem 600, a detail line .75rem --text-muted 88px in, a rule under each row); an opened task\'s "What happened" (.agt-log: a grid of time, event word and message, .9rem, a 1px --border rule under each cell; two columns below 560px); the home and history (the Timeline library part). Activity is on the sandbox; the task table needs a task with events, which the sandbox has not.',
    },
    variants: [
      { id: 'kind-rows', name: 'Rows with a kind tag', code: '.pf-agd-log-entry (tab-activity.js, agents-detail.css)', becomes: 'the timeline, with the kind tag kept', look: 'time, a framed kind tag, the event word, a grey line under it, a rule under each row', where: 'an agent\'s Activity', crop: { url: '/v1/profile?tab=agents&agent=bot', click: '.agp-tabs .poster-tab:has-text("Activity")', selector: '.pf-agd-log-type' } },
      { id: 'ruled-table', name: 'A ruled table', code: '.agt-log (task-item.js, agent-tasks-poster.css)', becomes: 'the timeline', look: 'three columns (when, what, the message), a thin rule under each', where: 'an agent\'s Tasks: an opened task\'s "What happened"', crop: agentTab('Tasks', '.agt-w', ['.agt-row:has-text("seat map")']) },
      { id: 'timeline', name: 'The home\'s timeline', code: '.poster-timeline-* (Timeline.js, timeline.css)', becomes: 'stays as it is. Accepting it means both lists take this look', look: 'a coloured dot, one line, the time', where: 'the home, the history page', crop: home('.poster-timeline-line') },
    ],
    changes: [
      { page: 'An agent\'s Activity', what: 'Each event reads as a timeline line: a coloured dot for its kind, what happened, and the time. The kind tag stays before the line. The grey second line joins the first.' },
      { page: 'An agent\'s Tasks: an opened task', what: 'The three-column table of what happened becomes timeline lines.' },
      { page: 'Home, history', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the home's timeline, with the kind kept where a page filters by it.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'markdown-small',
    title: 'Small reader: formatted text shown in a small place',
    question: 'Formatted text (headings, lists, code) is shown in small places in Settings: an agent\'s README, a task\'s memory value, an organism\'s README, a record field and its structure map, and the ecosystem setup guide. Each place tries to make it smaller in its own way, but in every one of them a second and third level heading is drawn as a heading of the Settings page itself: big capitals. Should there be one small cut of the text for all these places, or should they show it as the chat does?',
    proposal: {
      variant: 'proposal', name: 'One small cut',
      summary: 'One small cut of the reader for every small place in Settings: the words at the reader\'s own size, the headings only a step larger than the words, never in the page\'s big capitals, and less room between paragraphs.',
      text: 'Lab-only .dl-md-small, from the agent README\'s own values (h1 1.4rem, h2 1.2rem, h3 1.05rem, paragraphs .5rem apart). Measured on the sandbox\'s pages (seeded: an agent README, a task memory value): every h2 and h3 of the reader in a Settings tab is Archivo 1.7rem 400 capitals, .01em, because .pf .settings-frame-body h2:not([class]), h3:not([class]) (settings-frame.css, meant for a tab\'s own headings) reaches the reader and wins over .pf-agd-readme h2 (1.2rem) and .pf-agd-task-memory-md .md-body h2 (.85rem) by coming later at the same or higher weight. The words are .95rem, line height 1.7, in every place: the reader (.md-body, markdown.css) sets them itself, so the wrappers\' font-size (.pf-agd-readme .9rem, .pf-eco-setup-guide-md .88rem) never reaches them. Other differences: the task memory\'s paragraphs .3rem apart and a 340px max height; the organism README in a 1px frame with 10px corners (.pj-readme); the record field and map (.pj-rec-md); the setup guide 74ch wide. The chat\'s reader (outside the Settings frame) draws h2 in the headline face at 1.32rem. The proposal\'s rule needs to be as strong as the frame\'s, or the frame\'s rule needs to leave .md-body alone.',
    },
    variants: [
      { id: 'agent-readme', name: 'An agent\'s README', code: '.pf-agd-readme (tab-readme.js, agents-detail.css)', becomes: 'the one small cut: the headings get smaller and lose the capitals', look: 'the reader\'s words; headings as the Settings page\'s big capitals', where: 'an agent\'s README', crop: agentTab('README', '.pf-agd-readme .md-body h2') },
      { id: 'task-memory', name: 'A task\'s memory value', code: '.pf-agd-task-memory-md (task-item-parts.js)', becomes: 'the one small cut: the headings get smaller and lose the capitals, the paragraphs get more room', look: 'headings as the Settings page\'s big capitals, tight paragraphs', where: 'an agent\'s Tasks: a task\'s memory entries', crop: agentTab('Tasks', '.pf-agd-task-memory-md .md-body h2', ['.agt-row:has-text("ferry")', '.agt-actions .poster-action:has-text("Memory")', '.og-fold--event >> nth=0']) },
      { id: 'eco-guide', name: 'The ecosystem setup guide', code: '.pf-eco-setup-guide-md (ecosystem-tab.cards.js)', becomes: 'the one small cut: the headings get smaller and lose the capitals', look: 'the reader in a 74-letter column; headings as the Settings page\'s big capitals', where: 'Ecosystem apps: an app\'s setup guide', crop: null },
      { id: 'full', name: 'The reader as the chat shows it', code: '.md-body (Markdown.js, markdown.css), outside the Settings frame', becomes: 'stays as it is in the chat. Accepting it means the small places in Settings show it this way too', look: '.95rem words, headings in the headline face, a step larger', where: 'the chat', crop: chatThread(0, '.poster-turn--agent .md-body h2') },
    ],
    changes: [
      { page: 'An agent\'s README, a task\'s memory value, an organism\'s README, a record field and its map, the ecosystem setup guide', what: 'The second and third level headings stop looking like the headings of the Settings page: they get much smaller and lose the capitals. The words stay the same size. In a task\'s memory value the paragraphs also get a little more room.' },
      { page: 'If you accept the chat\'s look instead', what: 'The same headings become the chat\'s: the headline face, a step larger than the words.' },
      { page: 'The chat', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: one small cut of the reader for the small places in Settings.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'mcp-guide',
    title: 'MCP guide: the steps to connect an AI, and the block to paste',
    question: 'The part that shows how to connect an AI tool and the instruction block to paste has its own look, with thin grey frames and round corners (Agents, Organisms, the home\'s first steps). The MCP page and an agent\'s Integration dress it in the Settings look, with dark square frames, by the same rules written twice. Which look should the part have as its own?',
    proposal: {
      variant: 'poster', name: 'The Settings look, as the part\'s own',
      summary: 'The part takes the look the MCP page gives it: the block to paste and the command in a dark square frame, the words in ink. The two pages stop writing it again, and Agents, Organisms and the home\'s first steps get the same look.',
      text: 'The part is hello-mcp.css (.ast-* the setup guide, .ib-* the instruction block). Its own look: .ib-block and .ast-cmd-text on --bg-dim, a 1px --border frame, --radius-xs corners, the block\'s words --text-dim; .ast-params framed in grey. The MCP page (.og-mcp in mcp-poster.css) and an agent\'s Integration rewrite about 14 rules the same way: a 2px ink frame, square corners, ink words, the params unframed, the params heading in coral capitals. Measured on the MCP page: .ib-block JetBrains Mono .76rem, 2px ink, --bg-dim, padding .75rem 1rem.',
    },
    variants: [
      { id: 'classic', name: 'The part\'s own look', code: '.ib-block, .ast-cmd-text, .ast-params (hello-mcp.css)', becomes: 'the Settings look: a dark square frame', look: 'a thin grey frame, round corners, grey words', where: 'Agents (Connect the AI you already use), an organism\'s instructions, the home\'s first steps', crop: { url: '/v1/profile?tab=agents', click: '.agp-connect .poster-tab:has-text("Claude Code")', selector: '.ast-cmd-text' } },
      { id: 'poster', name: 'The Settings look', code: '.og-mcp .ib-block and kin (mcp-poster.css; agents-integration rules)', becomes: 'stays as it is. Accepting it means it becomes the part\'s own look', look: 'a 2px dark square frame, ink words', where: 'MCP, an agent\'s Integration', crop: { url: '/v1/profile?tab=mcp', selector: '.og-mcp .ib-block' } },
    ],
    changes: [
      { page: 'Agents, an organism\'s instructions, the home\'s first steps', what: 'The block to paste and the command lose their thin grey frame and round corners and get a dark square frame; their words turn from grey to ink.' },
      { page: 'MCP, an agent\'s Integration', what: 'Nothing you can see. The rules move into the part.' },
    ],
    choice: {"proposal":null,"options":{"classic":"accepted"},"note":"Accepted the part's own look (a thin grey frame, round corners), not the proposal; the proposal was left unanswered.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'file-pick-list',
    title: 'File pick list: pick one file to see it',
    question: 'An agent\'s configuration files are listed in thin grey boxes with round corners; you pick one, it gets a coral frame, and its text opens under the list. The look is neither a choice tile nor a list row. Which should it be?',
    proposal: {
      variant: 'listing', name: 'A list row that opens',
      summary: 'Each file is a row of the Listing, the list you chose for Settings: its name, its date, and the row you pick opens with the file under it, as an opened row does on other pages.',
      text: 'Today (.pf-agd-config-list, tab-agent-config.js, agents-detail.css): each file a flex row, 1px --border frame, 6px corners, .82rem; a green dot for an active file, the name 600, a grey description or date .78rem, a platform chip; the picked one (--active) a coral frame on --card-bg-alt; the file opens below in a preview with Edit, Copy and Download. The Listing (listing.css): name .95rem 800 with a mono .7rem line under it, a rule under each row; an opened row (.listing-open) is framed with the raised shadow. The Choice tile (the home\'s background patterns, .poster-tab--tile) picks one of a few settings, not one of many files. The sandbox\'s agent has no configuration file, so the list has no context picture.',
    },
    variants: [
      { id: 'config-list', name: 'The file list as it is', code: '.pf-agd-config-item, --active (tab-agent-config.js)', becomes: 'the Listing: the picked file\'s row opens with the file under it', look: 'thin grey boxes, round corners; the picked one in a coral frame', where: 'an agent\'s Agent Config', crop: agentTab('Agent Config', '.pf-agd-config-item--active') },
      { id: 'listing', name: 'A Listing row that opens', code: '.listing, .listing-row.is-open, .listing-open (listing.css)', becomes: 'stays as it is. Accepting it means the file list takes it', look: 'a bold name, a mono line under it, a rule; the opened row framed with the yellow shadow', where: 'Settings & Controls: Skills, Libraries, Packages and every list drawn as the Listing', crop: { url: '/v1/profile?tab=skills', selector: '.listing-name' } },
      { id: 'tile', name: 'The Choice tile', code: '.poster-tab--tile, .is-on (SwatchPicker.js)', becomes: 'stays as it is on the home. Accepting it means the file list takes it', look: 'framed tiles side by side, the chosen one on the yellow ground', where: 'the home: the settings dialog\'s background patterns', crop: { url: '/v1/home', click: '.poster-masthead-button', selector: '.poster-tab--tile.is-on' } },
    ],
    changes: [
      { page: 'An agent\'s Agent Config', what: 'The files read as the rows of a list: the name in bold, the date or the description on a grey line under it, a rule under each row. The file you pick opens under its own row in a framed panel with the yellow shadow, where it opens today under the whole list. The green dot of an active file stays beside the name.' },
      { page: 'Every other page', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the file list as Listing rows that open.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'dashed-field-box',
    title: 'Dashed field box: a field to fill in for one action',
    question: 'A thin dashed frame around a field and its button is drawn on a grey ground in Packages and on the page\'s ground in Extensions. Which ground should it have?',
    proposal: {
      variant: 'page', name: 'The page\'s ground',
      summary: 'The dashed box on the page\'s own ground, as in Extensions, so the field inside reads as every other field does.',
      text: 'Packages .pk-inst (packages-poster.css): a 1px dashed --text frame, --bg-dim ground, padding .5rem .7rem, the field and Install in one row (wrapped below 560px). Extensions .ex-test (extensions-poster.css): the same frame on --bg, padding .8rem 1rem, the field above its doors. One tab each; both show only after a press (install a package, test an extension), which the lab does not make, so there is no context picture.',
    },
    variants: [
      { id: 'grey', name: 'On a grey ground', code: '.pk-inst (packages-poster.css)', becomes: 'the page\'s ground', look: 'a thin dashed dark frame on grey, the field and the button in one row', where: 'Packages: installing a package under a name', crop: { url: '/v1/profile?tab=packages', click: '.listing-row .listing-doors .poster-action >> nth=0', selector: '.pk-inst' } },
      { id: 'page', name: 'On the page\'s ground', code: '.ex-test (extensions-poster.css)', becomes: 'stays as it is. Accepting it means Packages takes it', look: 'a thin dashed dark frame on the page\'s ground', where: 'Extensions: testing an extension', crop: { url: '/v1/profile?tab=extensions', click: ['.listing-row:has-text("lab-echo") .listing-doors .poster-action', '.ex-act .poster-action:has-text("Try it")'], selector: '.ex-test' } },
    ],
    changes: [
      { page: 'Packages', what: 'The grey ground inside the dashed box goes; the box shows the page\'s ground.' },
      { page: 'Extensions', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the dashed box on the page's ground.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  {
    id: 'question-box',
    title: 'Question box: a workflow\'s question waiting for your answer',
    question: 'A workflow that waits for your answer shows its question in a box on the yellow ground. You pick an answer from framed choices, and the chosen one turns dark. If the choices became tabs, as your decision "Choice" says, the chosen tab (also on the yellow ground) would not show. Should the box move to the page\'s ground, or should the tabs get a dark tone on the yellow?',
    proposal: {
      variant: 'plain-box', name: 'The box on the page\'s ground, with tabs',
      summary: 'The question sits in a dark frame on the page\'s ground, and its answers are tabs: the chosen answer on the yellow ground, as every other chosen tab.',
      text: 'Today (.wp-ask, workflows-poster.css; cover.js): a 3px ink frame on --sun, --on-sun words, the question 1rem 800, the answers an .og-choice row (a 2px frame split by rules, .8rem 700) with the chosen one in --on-sun on the sun; Answer and go the dark block. Plain box (lab): the same frame on --card-bg with .poster-tab answers and .is-on on the sun. Ink tabs (lab): the sun box kept, the tabs\' underline and words --on-sun, the chosen one an --on-sun ground with sun words. The sandbox has no waiting question, so there is no context picture; the pictures are drawn from cover.js\'s markup with fixed words.',
    },
    variants: [
      { id: 'sun-box', name: 'The box on the yellow ground, as it is', code: '.wp-ask, .og-choice (cover.js, workflows-poster.css)', becomes: 'the box on the page\'s ground, the answers as tabs', look: 'a dark frame on yellow, framed answer choices, the chosen one dark', where: 'Workflows: a question waiting for you', crop: { url: '/v1/profile?tab=workflows', selector: '.wp-ask' } },
      { id: 'plain-box', name: 'On the page\'s ground, with tabs', code: 'lab: .dl-ask-plain with .poster-tab', becomes: 'this is the proposal', look: 'a dark frame on the page\'s ground, the answers as tabs, the chosen one yellow', where: 'Workflows: a question waiting for you', crop: null },
      { id: 'ink-tabs', name: 'On the yellow ground, with dark tabs', code: 'lab: .wp-ask with .poster-tab.dl-tab-ink', becomes: 'the box on the page\'s ground, the answers as tabs', look: 'the yellow box kept, the answers as tabs in dark, the chosen one a dark block with yellow words', where: 'Workflows: a question waiting for you', crop: null },
    ],
    changes: [
      { page: 'Workflows: a question waiting for you', what: 'The box loses its yellow ground and keeps its dark frame. The answers become tabs, and the one you choose turns yellow. The words of the question and the Answer and go button stay.' },
      { page: 'If you accept the dark tabs instead', what: 'The box stays yellow. The answers become tabs drawn in dark, and the one you choose becomes a dark block with yellow words.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the box on the page's ground, the answers as tabs. \"työnkulun kysymyslaatikko hyväksytty ja vastattu\" (Jouni).","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
  // ── Wave 4 (2026-09-26). ──
  {
    id: 'tag-remove',
    title: 'Remove mark: the ✗ that takes a tag or a member off',
    question: 'A tag or a member is a small framed chip with a ✗ after its name. Pressing the ✗ takes it off. The ✗ is drawn in two ways, about equally used: grey that turns coral under the pointer (an agent\'s tags), and always coral (a board\'s members). Which one should every such ✗ use?',
    proposal: {
      variant: 'grey-to-coral', name: 'Grey, coral under the pointer',
      summary: 'Every ✗ in a chip is grey until the pointer is on it, and then it turns coral. The name in the chip stays the strongest thing in it, and a row of chips does not read as a row of warnings. On a touch screen, where there is no pointer, the ✗ stays grey and can still be read.',
      text: 'An agent\'s tags (TagStrip in agent-card.js): .pf-agd-tag-chip-remove in a .poster-chip; agents-poster.css (.agp-chips) no ground, no frame, padding 0 0 0 .3rem, font inherited, --text-dim, :hover --accent. agents-detail.css has an older rule for the same class (--text-muted, .9rem, :hover --danger), which the page\'s rule overrides. A board\'s members (board.js): .bp-member-x in a .poster-chip; boards-poster.css the same padding and font, --accent always, no :hover. Two more marks of this kind are grey at rest: the tag editor of Memory (.tag-removable .tag-x, css/components/tags.css: --muted, and --text when the pointer is on the tag), and the tag input of an organism\'s home settings (.pj-tag-x, css/components/tag-input.css: --muted, .85rem, :hover --danger, a red that is not the coral). Against the page\'s ground --text-dim reads about 4.8:1 and --accent about 3.7:1. The board look is drawn from board.js\'s markup with fixed names; the sandbox has no board with members.',
    },
    variants: [
      { id: 'grey-to-coral', name: 'Grey, coral under the pointer', code: '.agp-chips .pf-agd-tag-chip-remove (agent-card.js, agents-poster.css)', becomes: 'stays as it is. Accepting it means every such ✗ takes this look', look: 'the ✗ in --text-dim, --accent under the pointer', where: 'Settings & Controls: Agents, an agent\'s tags', crop: { url: '/v1/profile?tab=agents&agent=bot', selector: '.pf-agd-tag-chip-remove', around: '.agp-chips' } },
      { id: 'always-coral', name: 'Always coral', code: '.bp-member-x (board.js, boards-poster.css)', becomes: 'grey, coral under the pointer', look: 'the ✗ in --accent at all times', where: 'Settings & Controls: Boards, the members of your own board', crop: null },
    ],
    changes: [
      { page: 'Boards: the members of your own board', what: 'The ✗ after a member\'s name turns from coral to grey. It turns coral when the pointer is on it.' },
      { page: 'Memory: the tags of a record; an organism\'s home settings: its interests', what: 'The ✗ turns coral under the pointer, where today it turns dark (Memory) or red (the interests). At rest it stays grey.' },
      { page: 'Agents: an agent\'s tags', what: 'Nothing.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: every ✗ in a chip grey, coral under the pointer.","decidedBy":"Jouni","decidedAt":"2026-09-26"},
  },
];

/**
 * Notes of the round that are not a decision page: a finding with a choice, shown under the list
 * of decisions. Plain words, as the visible part of a decision.
 */
export const CONFLICT_NOTES = [
  {
    title: 'Round corners that came with the moves',
    text: 'When page parts moved into the library (the colour tag, the document tree, the file drop, the file preview, the activity calendar, two chips that name an agent, the search hits, the comments, the ecosystem automation, the organism row, the record row, the schedule calendar), 28 round corners and 3 shadows came with them. The check that holds every corner and shadow to the shape values did not read those page sheets, and it reads the library sheets, so it now counts 14 files that went up. Decided (Jouni, 2026-09-26): "tee samankaltaiseksi tyyli kuin muuallakin". Those corners and shadows take the shape values, as everywhere else, so they become square and flat like the rest; the check does not accept them as they are.',
  },
];
