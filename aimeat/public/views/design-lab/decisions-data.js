/**
 * @file public/views/design-lab/decisions-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's decisions, as data: every kind of thing the pages draw in more than
 *   one way, each variant with where it is drawn and how to crop it from its real page, the AI's
 *   proposal for the one look, and what would change on which page. The chip first (Jouni,
 *   2026-09-23): "Collect every way the pages draw a small tag, badge, count or status word today
 *   ... show them side by side with .poster-chip as one candidate, and I choose the one chip."
 *
 *   PLAIN DATA, NO IMPORTS. The lab reads it in the browser, and scripts/design-lab-crops.mjs reads
 *   the same file in Node to shoot each variant's crop from its page. A variant's live sample is in
 *   decision-samples.js under the same id; `pnpm check:ui-library` holds the two together and
 *   refuses a crop the data promises and the folder does not have.
 *
 *   `files` is how many JS files draw a variant; it is shown only where `counted` says a search
 *   measured it (the chip and the label, from the 2026-09-23 inventory).
 *
 *   A decision belongs to the project, not to a node (Jouni, 2026-09-23): the choice is made once
 *   and shipped in the code. `choice` is filled here when Jouni has chosen; until then the lab
 *   shows the proposal and his pick, which the lab stores as his record on the node he looked at.
 * @structure DECISIONS — [{ id, counted, title, question, variants: [{ id, name, look, where, files, crop }],
 *   proposal: { variant, text }, changes: [{ page, what }], choice }]
 * @usage import { DECISIONS } from './decisions-data.js';
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */

/** Crop specs: the page, what to press first, and the element. Coordinates come from the element. */
const home = (selector, extra = {}) => ({ url: '/v1/home', selector, ...extra });
const chatThread = (n, selector) => ({ url: '/v1/chat', eval: `document.querySelectorAll('.poster-thread-open')[${n}].click();`, selector });

export const DECISIONS = [
  {
    id: 'chip',
    counted: true,
    title: 'The chip: a small tag, badge, count or status word',
    question: 'The pages draw a small inline label in about twenty ways. Which one look should every tag, kind, status word and count wear?',
    variants: [
      { id: 'poster-chip', name: '.poster-chip (the design language\'s chip)', look: 'mono .68rem 500, 1px ink frame, square, no fill', where: 'no page yet; the shape poster.css keeps for this role', files: 0, crop: null },
      { id: 'og-chip', name: 'Organism chip (.og-chip)', look: 'mono .68rem 500, 2px ink frame, square; --sun fills it, --dim greys it', where: 'almost every profile tab cover and record (Inbox, Scheduler, Agents, Access), admin Compliance, the public knowledge viewer', files: 63, crop: { url: '/v1/profile?tab=messages', selector: '.og-chip' } },
      { id: 'pf-badge', name: 'Profile badge (.pf .badge)', look: 'mono .66rem 500, 2px frame, square; tone by frame colour, warn on the sun', where: 'profile Access tokens, Organisms, Nodes, Living, the agent consent card', files: 32, crop: { url: '/v1/profile?tab=organisms', selector: '.pf .badge' } },
      { id: 'adm-badge', name: 'Admin badge (.adm-badge)', look: 'mono .66rem 500 caps, no frame, a tinted fill per tone', where: 'every admin roster: Agents, Apps, Actions, Hooks, SSO', files: 51, crop: { url: '/v1/admin?tab=agents', selector: '.adm-badge' } },
      { id: 'theme-badge', name: 'Rounded badge (.badge outside the profile)', look: 'Archivo .66rem 600 caps, a pill radius, tinted fill', where: 'admin Chat instances, KeyValueRow', files: 2, crop: { url: '/v1/admin?tab=chatInstances', selector: '.badge' } },
      { id: 'pf-mono-chip', name: 'Profile mono chip (.sch-badge and kin)', look: 'mono .68rem 500, 2px frame in the text colour, square', where: 'profile Scheduler, Offers, Memory files, Organisms interests, Access apps', files: 10, crop: { url: '/v1/profile?tab=scheduler', selector: '.sch-badge' } },
      { id: 'row-tag', name: 'Row tag (.sk-tag and kin)', look: 'mono .66rem 500, 1px grey frame, dim text', where: 'profile Skills, Libraries, Packages, Extensions, Capabilities rows', files: 5, crop: { url: '/v1/profile?tab=skills', selector: '.sk-tag' } },
      { id: 'adm-state-chip', name: 'Admin grey chip (.adm-own-chip and kin)', look: 'mono .66-.68rem 500, 2px grey frame, dim text', where: 'admin Owners, Organism ownership, Realtime, CSM, Memory, Boards; the fleet page', files: 8, crop: { url: '/v1/admin?tab=owners', selector: '.adm-own-chip' } },
      { id: 'adm-grey-tag', name: 'Admin filled tag (.adm-st-chip and kin)', look: 'mono .66rem, grey fill, no frame, some in caps', where: 'admin SSO, Knowledge, Subdomains, Statistics, Portal', files: 5, crop: { url: '/v1/admin?tab=stats', selector: '.adm-st-chip' } },
      { id: 'adm-filter-chip', name: 'Admin filter chip (a toggle)', look: 'mono .72rem 500, 2px grey frame; the chosen one on the sun', where: 'about 25 admin pages, each with its own copy of the rule (Hooks, Discovery, Compliance, Scheduler)', files: 25, crop: { url: '/v1/admin?tab=hooks', selector: '.adm-hook-fchip' } },
      { id: 'ct-tag', name: 'Contact tag (.ct-tag)', look: 'Archivo .68rem 700, 1px ink frame; the relation in an ink fill', where: 'profile Contacts', files: 3, crop: { url: '/v1/profile?tab=contacts', selector: '.ct-tag' } },
      { id: 'tag-pill', name: 'Tag pill (.tag-pill)', look: 'mono .72rem, 2px ink frame, square; the active one on the sun', where: 'profile Memory tags, the portfolio builder', files: 3, crop: { url: '/v1/profile?tab=memory', selector: '.tag-pill' } },
      { id: 'count-coral', name: 'Count on coral (.pf-side-badge, .open-items-count)', look: 'mono .7-.8rem, coral fill, paper text', where: 'the profile side menu, the open items button', files: 3, crop: { url: '/v1/profile', selector: '.pf-side-badge' } },
      { id: 'count-bell', name: 'Bell count (.notif-badge)', look: 'mono .6rem 700, coral fill, white text, 15px high', where: 'the header bell on every signed-in page', files: 1, crop: home('.notif-badge') },
      { id: 'count-morsels', name: 'Morsel count (.brand-morsels)', look: 'mono .76rem, sun fill, a coral heart before it', where: 'the header on every signed-in page', files: 1, crop: home('.brand-morsels') },
      { id: 'count-admin-nav', name: 'Admin menu count (.adm-nav-item .cnt)', look: 'mono .66rem 500, no fill, dim', where: 'the admin side menu', files: 1, crop: { url: '/v1/admin', selector: '.adm-nav-item .cnt' } },
      { id: 'home-count', name: 'Home count (.poster-thing-n)', look: 'Fjalla 1.05rem, coral, no box', where: 'the home: "What you have made"', files: 1, crop: home('.poster-thing-n') },
      { id: 'chat-status-word', name: 'Work log status word (.poster-worklog-status)', look: 'mono .74rem, dim; green when done, red when failed', where: 'the chat: the work log under each answer', files: 1, crop: chatThread(1, '.poster-worklog-status') },
      { id: 'chat-kind', name: 'Result kind (.poster-result-kind)', look: 'Archivo .65rem 800 caps; a colour per kind', where: 'the chat: the result cards', files: 1, crop: chatThread(3, '.poster-result-kind') },
    ],
    proposal: {
      variant: 'poster-chip',
      text: 'The chip the design language already names: .poster-chip, square and mono at .68rem 500, for every tag, kind and status word. Three role cuts, all already drawn somewhere today: on the sun for the chosen or active one (the organism chip\'s --sun), grey for the quiet one (--dim), coral for the one that needs a look. A count is the same chip with a coral fill and paper words, as the profile menu draws it. One question is open in the pictures: the frame. The design language says 1px; the organism chip and the profile badge, together on about 95 files, draw 2px. The proposal keeps 1px, as the design language says; choose the organism chip if you prefer the 2px frame the profile already wears.',
    },
    changes: [
      { page: 'Profile (all tabs)', what: 'the 2px frames of .og-chip, .pf .badge and the mono chips become 1px; sizes .66/.68 become .68' },
      { page: 'Admin (all rosters)', what: 'the tinted fills of .adm-badge become the framed chip; tone moves from the fill to the frame (grey, sun, coral)' },
      { page: 'Admin (25 filter rows)', what: 'the filter toggles become the chip, the chosen one on the sun, as they are now' },
      { page: 'Chat', what: 'the result kind becomes a chip instead of coloured caps; the work log status word becomes a chip (done grey, failed coral)' },
      { page: 'Home', what: 'no chip today; the count beside a thing stays a big coral numeral unless you choose otherwise' },
      { page: 'Header (every page)', what: 'the bell count and the morsel count take the count cut (square, mono, coral or sun fill); they are already close' },
      { page: 'Contacts, Memory tags, rounded badges', what: 'the Archivo tag and the pill radius go' },
    ],
    choice: null,
  },
  {
    id: 'label',
    counted: true,
    title: 'The small label above a thing',
    question: 'The home and the chat name a row, a prompt, a day and a rail in four cuts of the small coral caps label, and two more in grey. Which one?',
    variants: [
      { id: 'poster-label', name: 'Coral label (.poster-label)', look: 'Archivo .72rem 800 caps, .1em, coral', where: 'home: the named rows ("Assets", "Tried so far")', files: 4, crop: home('.poster-named-label, .poster-label') },
      { id: 'prompt-label', name: 'Prompt label (.poster-prompt-label)', look: 'the same values, in its own rule', where: 'home: the prompt card', files: 3, crop: home('.poster-prompt-label') },
      { id: 'day-title', name: 'Day title (.poster-day-title)', look: 'the same values with a 3px ink underline', where: 'the history page: one per day', files: 1, crop: { url: '/v1/home?history=1', selector: '.poster-day-title' } },
      { id: 'conversation-label', name: 'Rail label (.poster-conversation-label)', look: '.64rem, .12em, coral, a 2px underline', where: 'chat: "This conversation" in the rail', files: 1, crop: { url: '/v1/chat', selector: '.poster-conversation-label' } },
      { id: 'worklog-head', name: 'Grey caps (.poster-worklog-head)', look: '.68rem 800 caps, .1em, grey', where: 'chat: "What was done" over the work log', files: 1, crop: chatThread(1, '.poster-worklog-head') },
      { id: 'og-label', name: 'Profile label (.og-label)', look: '.68rem 800 caps, .12em, coral', where: 'every profile poster tab (for comparison)', files: 57, crop: { url: '/v1/profile?tab=skills', selector: '.og-label' } },
    ],
    proposal: {
      variant: 'poster-label',
      text: '.poster-label is the design language\'s small coral label, and the prompt label is already the same values in a copy: one label, one rule. The proposal draws the plain label everywhere; the day title and the rail label lose their underline and read as labels over their rows. The grey caps over the work log become the same label in grey (a --dim cut), because a label inside a finished answer should not call for attention.',
    },
    changes: [
      { page: 'Home', what: 'none: the prompt card\'s label loses its own rule, the look stays' },
      { page: 'History', what: 'the day titles lose the 3px underline' },
      { page: 'Chat', what: 'the rail label grows from .64 to .72rem and loses its underline; the work log head stays grey but takes the label\'s .72rem' },
      { page: 'Profile', what: '.og-label (.68rem, .12em) becomes .72rem, .1em on 57 files' },
    ],
    choice: null,
  },
  {
    id: 'meta',
    title: 'The quiet mono line: a time, a model, a count of messages',
    question: 'Small grey mono text sits under turns, in the rail and on the home timeline in three sizes. Which one?',
    variants: [
      { id: 'turn-meta', name: 'Turn meta (.poster-turn-meta)', look: 'mono .68rem, grey', where: 'chat: the time and model under each turn', files: 1, crop: { url: '/v1/chat', selector: '.poster-turn-meta' } },
      { id: 'agent-status', name: 'Agent status (.poster-agent-status)', look: 'mono .68rem, grey; "Your agent" in coral', where: 'chat: the rail', files: 1, crop: { url: '/v1/chat', selector: '.poster-agent-status' } },
      { id: 'thread-sub', name: 'Thread count (.poster-thread-sub)', look: 'mono .68rem, grey', where: 'chat: under each conversation in the list', files: 1, crop: { url: '/v1/chat', selector: '.poster-thread-sub' } },
      { id: 'live-status', name: 'Live status (.poster-live-status)', look: 'mono .72rem, grey, a pulsing coral dot', where: 'chat: under an answer being written', files: 1, crop: null },
      { id: 'timeline-when', name: 'Timeline time (.poster-timeline-when)', look: 'mono .76rem, grey', where: 'home and history: the time of each event', files: 1, crop: home('.poster-timeline-when') },
    ],
    proposal: {
      variant: 'turn-meta',
      text: 'Three of five already draw mono .68rem grey. The proposal makes it the one quiet line; the live status keeps its dot, at .68rem. The home timeline is the question: its .76rem reads beside a sentence of body text, and .68rem there is small. If the timeline should stay larger, choose it, and the chat grows to .76rem instead.',
    },
    changes: [
      { page: 'Chat', what: 'the live status shrinks from .72 to .68rem' },
      { page: 'Home, history', what: 'the event times shrink from .76 to .68rem' },
    ],
    choice: null,
  },
  {
    id: 'box',
    title: 'The framed box around one thing',
    question: 'The home and the chat frame a thing in six ways: grey, ink, ink with a sun shadow, and tinted. Which frame means "this is one object"?',
    variants: [
      { id: 'step-open', name: 'Open step (.poster-step--open)', look: '3px ink frame, 8px sun shadow, card ground', where: 'home: the connection steps in the journey folds', files: 2, crop: home('.poster-step', { click: '.poster-chooser-status button' }) },
      { id: 'prompt-card', name: 'Prompt card (.poster-prompt)', look: '2px ink frame, a tinted head, the prompt in a scroll box', where: 'home: every prompt to copy', files: 3, crop: home('.poster-prompt') },
      { id: 'record', name: 'Opened record (.poster-record)', look: '3px ink frame, 8px sun shadow', where: 'home: an opened playbook; the demo card', files: 2, crop: home('.poster-index-open', { click: '.poster-index .poster-fold' }) },
      { id: 'chooser-box', name: 'Box (.poster-box)', look: '2px ink frame, card ground', where: 'home: the journey\'s result', files: 1, crop: home('.poster-chooser-result') },
      { id: 'result-card', name: 'Result card (.poster-result)', look: '2px ink frame with a coloured left edge per kind', where: 'chat: what a turn produced', files: 1, crop: chatThread(3, '.poster-result') },
      { id: 'composer', name: 'Composer (.poster-composer)', look: 'a 3px ink rule on top, no frame', where: 'chat: the box a person types into', files: 1, crop: { url: '/v1/chat', selector: '.poster-composer' } },
    ],
    proposal: {
      variant: 'chooser-box',
      text: 'Two frames, each with one meaning, as the design language already states: the 2px ink box on the card ground for a thing that must read as one object (the prompt, a result, the journey\'s answer), and the 3px ink frame with the sun shadow only for the one opened thing (the open step, an opened record). The result card drops its coloured edge; the kind is its chip. The composer keeps its rule: it is a field, not an object.',
    },
    changes: [
      { page: 'Chat', what: 'the result cards lose the coloured left edge' },
      { page: 'Home', what: 'the prompt card\'s tinted head goes; the frame stays 2px ink' },
    ],
    choice: null,
  },
  {
    id: 'note',
    title: 'The note that asks for attention',
    question: 'A note that says "look here" is drawn dashed in two ways and plain in a third. Which one?',
    variants: [
      { id: 'waiting-note', name: 'Waiting note (.poster-waiting)', look: 'a dashed frame, a pulsing coral dot, a bold line', where: 'home: the agent step while it waits for the agent', files: 1, crop: null },
      { id: 'nudge', name: 'Nudge (.poster-nudge)', look: 'a dashed frame, one line, the way out on the same line', where: 'chat: "Put this on your phone"', files: 1, crop: null },
      { id: 'ai-notice', name: 'AI notice (.poster-ai-notice)', look: 'no frame, one line and a button', where: 'chat: "You are talking to an AI"', files: 1, crop: { url: '/v1/chat', selector: '.poster-ai-notice' } },
      { id: 'aside', name: 'Aside (.poster-aside)', look: '3px dashed coral frame, card ground', where: 'the design language\'s aside; organism settings and admin pages', files: null, crop: null },
    ],
    proposal: {
      variant: 'aside',
      text: 'The design language has one note that says a thing out loud: the 3px dashed coral aside. The waiting note and the nudge become asides (the waiting note keeps its pulsing dot inside). The AI notice stays unframed: it is always there, and a frame would make a permanent notice shout.',
    },
    changes: [
      { page: 'Home', what: 'the waiting note\'s thin dashed frame becomes the 3px dashed coral aside' },
      { page: 'Chat', what: 'the phone nudge becomes the aside' },
    ],
    choice: null,
  },
  {
    id: 'quiet-action',
    title: 'The quiet action: every way on that is not the one loud button',
    question: 'The home and the chat draw a quiet action in seven ways: ink underline, coral mono underline, a thin frame, a rounded outline, and plain words. Which one?',
    variants: [
      { id: 'poster-action', name: 'Underlined action (.poster-action)', look: 'Archivo .9rem 800 caps, 3px ink underline; coral on hover', where: 'home: the masthead doors, the settings account actions', files: 4, crop: home('.poster-masthead-actions .poster-action') },
      { id: 'fold', name: 'Fold button (.poster-fold)', look: 'mono coral underline; the chosen one on the sun', where: 'home: "Show all", the apps switch, the playbook index', files: 3, crop: home('.poster-fold') },
      { id: 'rail-action', name: 'Rail action (.poster-rail-action)', look: 'a small ink underline, grey words', where: 'chat: Copy conversation, Reset session', files: 2, crop: { url: '/v1/chat', selector: '.poster-rail-action' } },
      { id: 'suggestion', name: 'Suggestion (.poster-suggestion)', look: 'underlined words on a thin outline', where: 'chat: the agent\'s choices and the starters', files: 2, crop: chatThread(2, '.poster-suggestion') },
      { id: 'back', name: 'Back link (.poster-back)', look: 'mono coral words with ↩', where: 'history: back to the home', files: 1, crop: { url: '/v1/home?history=1', selector: '.poster-back' } },
      { id: 'btn-outline', name: 'Outline button (.btn-outline)', look: 'a rounded thin frame from the classic buttons', where: 'chat: Open on a result card; home: the mode tabs', files: 6, crop: chatThread(3, '.poster-result-open') },
      { id: 'btn-ghost', name: 'Ghost button (.btn-ghost)', look: 'plain words from the classic buttons', where: 'chat: Listen and Copy under a turn', files: 4, crop: { url: '/v1/chat', selector: '.poster-turn-listen' } },
    ],
    proposal: {
      variant: 'poster-action',
      text: 'The design language says: one loud action, and underlined words for the rest, 3px ink under a poster action. So the proposal is .poster-action for every quiet way on. The fold button keeps its sun cut for the chosen one in a switch (it is a tab, and the tab shares the action\'s underline). The classic outline and ghost buttons leave the poster pages.',
    },
    changes: [
      { page: 'Chat', what: 'Open, Listen, Copy, the rail actions and the suggestions become underlined caps' },
      { page: 'Home', what: 'the fold buttons move from coral mono to ink caps; the mode tabs become tabs' },
      { page: 'History', what: 'the back link becomes an underlined action' },
    ],
    choice: null,
  },
  {
    id: 'loud-action',
    title: 'The loud action',
    question: 'The one button that says "do this now" is a coral rounded button on the home and an ink slab in the chat. Which one?',
    variants: [
      { id: 'btn-primary', name: 'Primary button (.btn-primary)', look: 'coral fill, rounded, white words (the classic button)', where: 'home: Copy the prompt, the step buttons', files: 5, crop: home('.poster-prompt .btn-primary') },
      { id: 'slab-control', name: 'Control slab (.poster-slab--control)', look: 'ink slab, paper words, 4px sun shadow, 44px high', where: 'chat: Send, New conversation', files: 2, crop: { url: '/v1/chat', selector: '.poster-composer-send' } },
      { id: 'slab', name: 'Slab (.poster-slab)', look: 'ink slab, paper words, 4px sun shadow', where: 'the design language\'s loud action; the demo card on the home', files: 2, crop: null },
    ],
    proposal: {
      variant: 'slab',
      text: 'The design language\'s loud action inside is the ink slab with the sun shadow; the coral rounded button is the classic shell. The proposal: .poster-slab for the one loud action on every poster page, the control cut where it sits in a row of controls.',
    },
    changes: [
      { page: 'Home', what: 'Copy the prompt and the step buttons become ink slabs with the sun shadow' },
    ],
    choice: null,
  },
  {
    id: 'empty',
    title: 'The line that says a list is empty',
    question: 'An empty list is said in four ways. Which one?',
    variants: [
      { id: 'quiet-note', name: 'Quiet note (.poster-quiet)', look: 'Archivo .9rem 600, grey', where: 'home: no apps opened yet', files: 1, crop: null },
      { id: 'day-empty', name: 'Day empty (.poster-day-empty)', look: 'Archivo .95rem 400, grey', where: 'history: nothing has happened yet', files: 1, crop: null },
      { id: 'conversation-empty', name: 'Conversation list empty (.poster-conversation-empty)', look: 'grey body text', where: 'chat: no conversations yet', files: 1, crop: null },
      { id: 'timeline-quiet', name: 'Timeline quiet (.poster-timeline-quiet)', look: 'a link in the timeline', where: 'home: a quiet period in the timeline', files: 1, crop: null },
    ],
    proposal: {
      variant: 'quiet-note',
      text: 'QuietNote is already the library\'s part for this. The proposal draws every empty list with it; the timeline\'s quiet period stays a link because it leads somewhere.',
    },
    changes: [
      { page: 'History', what: 'the empty record line becomes the quiet note (600 instead of 400)' },
      { page: 'Chat', what: 'the empty conversation list becomes the quiet note' },
    ],
    choice: null,
  },
];
