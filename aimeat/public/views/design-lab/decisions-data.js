/**
 * @file public/views/design-lab/decisions-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's decisions, as data: every kind of thing the pages draw in more than
 *   one way, one decision per JOB (Jouni, 2026-09-23: "if a decision mixes things that do different
 *   jobs, split it by job first"). Each variant says where it is drawn and how to crop it from its
 *   real page; the proposal is ONE component, with tones named by meaning where the variants it
 *   replaces carry meaning, and says which variant each tone's values come from; `changes` says what
 *   would change on which page.
 *
 *   PLAIN DATA, NO IMPORTS. The lab reads it in the browser, and scripts/design-lab-crops.ts reads
 *   the same file in Node to shoot each variant's crop. A variant's live sample is in
 *   decision-samples.js under the same id, and a proposal that is a new composition (`variant:
 *   'proposal'`) has its picture there too; `pnpm check:ui-library` holds the files together.
 *
 *   `keptAsIs` marks a variant the proposal shows beside the others but does not replace.
 *
 *   `files` is how many JS files draw a variant; it is shown only where `counted` says a search
 *   measured it (the 2026-09-23 inventory).
 *
 *   A decision belongs to the project, not to a node (Jouni, 2026-09-23): the choice is made once
 *   and shipped in the code. `choice` is filled here when Jouni has chosen; until then the lab
 *   shows the proposal and his pick, which it keeps as his record on the node he looked at.
 * @structure DECISIONS — [{ id, counted, title, question, variants: [{ id, name, look, where, files, keptAsIs, crop }],
 *   proposal: { variant, name, tones?: [{ name, from }], text }, changes: [{ page, what }], choice }]
 * @usage import { DECISIONS } from './decisions-data.js';
 * @version-history
 *   v2.0.0 — 2026-09-23 — Split by job, as Jouni asked: the chip becomes tag, status and count; the
 *     filter joins tabs and filters; the home count, the work log status word and the result kind
 *     leave the decisions and stay as they are; the label, the quiet line, the box, the note and the
 *     quiet action are split by job, and pairs that already agree are dropped. Proposals are one
 *     component with named tones. The agent step's wrapper is a decided decision.
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */

const home = (selector, extra = {}) => ({ url: '/v1/home', selector, ...extra });
const chatThread = (n, selector) => ({ url: '/v1/chat', eval: `document.querySelectorAll('.poster-thread-open')[${n}].click();`, selector });

export const DECISIONS = [
  {
    id: 'tag',
    counted: true,
    title: 'Tag: a small word that names a thing',
    question: 'Tags name a kind, a version, a role or a relation. Seven looks do this today; you accepted six of them. One Tag component, with tones that keep what those six say?',
    variants: [
      { id: 'poster-chip', name: '1. .poster-chip', look: 'mono .68rem 500, 1px ink frame, square, no fill', where: 'no page yet; the shape poster.css keeps for this role', files: 0, crop: null },
      { id: 'og-chip', name: '2. Organism chip (.og-chip)', look: 'mono .68rem 500, 2px ink frame, lowercase; "7 unread" on the sun', where: 'almost every profile tab cover and record, admin Compliance, the public knowledge viewer', files: 63, crop: { url: '/v1/profile?tab=messages', selector: '.og-chip' } },
      { id: 'pf-mono-chip', name: '6. Schedule kind (.sch-badge)', look: 'mono .68rem 500, 2px frame in blue or orange by kind', where: 'profile Scheduler, Offers, Memory files, Organisms interests, Access apps', files: 10, crop: { url: '/v1/profile?tab=scheduler', selector: '.sch-badge' } },
      { id: 'row-tag', name: '7. Row tag (.sk-tag)', look: 'mono .66rem 500, 1px grey frame, grey words', where: 'profile Skills, Libraries, Packages, Extensions, Capabilities', files: 5, crop: { url: '/v1/profile?tab=skills', selector: '.sk-tag' } },
      { id: 'adm-state-chip', name: '8. Admin role chip (.adm-own-chip)', look: 'mono .66rem 500, 2px grey frame; "operator" in coral, "you" on the sun', where: 'admin Owners, Organism ownership, Realtime, CSM, Memory, Boards; the fleet page', files: 8, crop: { url: '/v1/admin?tab=owners', selector: '.adm-own-chip' } },
      { id: 'ct-tag', name: '11. Contact tag (.ct-tag)', look: 'Archivo .68rem 700, 1px ink frame; the relation ("colleague") filled in ink', where: 'profile Contacts', files: 3, crop: { url: '/v1/profile?tab=contacts', selector: '.ct-tag' } },
      { id: 'tag-pill', name: '12. Tag pill (.tag-pill)', look: 'mono .72rem, 2px ink frame, square; the chosen one ("music") on the sun', where: 'profile Memory tags, the portfolio builder', files: 3, crop: { url: '/v1/profile?tab=memory', selector: '.tag-pill' } },
    ],
    proposal: {
      variant: 'proposal',
      name: 'Tag, with four tones',
      tones: [
        { name: 'plain', from: '1 (.poster-chip): mono .68rem 500, 1px ink frame, .04em, no fill' },
        { name: 'sun', from: '2 ("7 unread") and 12 ("music"): the sun fill with ink words' },
        { name: 'coral', from: '8 ("operator"): the coral frame with coral words' },
        { name: 'ink', from: '11 ("colleague"): the ink fill with card-coloured words' },
      ],
      text: 'One Tag, on the design language\'s chip (1). Four tones, each taken from a variant you accepted: plain names a thing; sun is the one that is chosen or counts now; coral is the one to notice; ink is the one that belongs to you (a relation, your role). The schedule kind (6) becomes the plain tone: its blue and orange frames say nothing the word does not.',
    },
    changes: [
      { page: 'Profile (all tabs)', what: 'the organism chip and the tag pill go from a 2px to a 1px frame; the organism chip keeps its sun tone; lowercase stays only where the word is written so' },
      { page: 'Profile Scheduler, Offers, Memory files', what: 'the blue and orange kind frames become the plain tag' },
      { page: 'Profile Skills and kin', what: 'the grey row tag becomes the plain tag (ink frame, ink words, .68rem)' },
      { page: 'Admin Owners and kin', what: 'the grey role chip becomes the plain tag; "operator" keeps coral, "you" keeps the sun' },
      { page: 'Profile Contacts', what: 'the tag moves from Archivo 700 to mono 500; the relation keeps its ink fill' },
    ],
    choice: null,
  },
  {
    id: 'status',
    counted: true,
    title: 'Status: a word that says a state by its colour',
    question: 'A status word says whether something is fine, needs a look, is broken or is off. Four looks do this; you accepted two. One Status component with four tones?',
    variants: [
      { id: 'pf-badge', name: '3. Profile badge (.pf .badge)', look: 'mono .66rem 500, 2px frame; the tone in the frame colour, "paused" on the sun', where: 'profile Access tokens, Organisms, Nodes, Living, the agent consent card', files: 32, crop: { url: '/v1/profile?tab=organisms', selector: '.pf .badge' } },
      { id: 'adm-badge', name: '4. Admin badge (.adm-badge)', look: 'mono .66rem 500 caps, no frame, a tinted fill per tone', where: 'every admin roster: Agents, Apps, Actions, Hooks, SSO', files: 51, crop: { url: '/v1/admin?tab=agents', selector: '.adm-badge' } },
      { id: 'theme-badge', name: '5. Rounded badge (.badge outside the profile)', look: 'Archivo .66rem 600 caps, a pill radius, tinted fill', where: 'admin Chat instances, KeyValueRow', files: 2, crop: { url: '/v1/admin?tab=chatInstances', selector: '.badge' } },
      { id: 'adm-grey-tag', name: '9. Admin filled tag (.adm-st-chip)', look: 'mono .66rem, grey fill, no frame, some in caps', where: 'admin SSO, Knowledge, Subdomains, Statistics, Portal', files: 5, crop: { url: '/v1/admin?tab=stats', selector: '.adm-st-chip' } },
    ],
    proposal: {
      variant: 'proposal',
      name: 'Status, with four tones',
      tones: [
        { name: 'fine', from: '4: the success tint (--success-bg, --success-fg)' },
        { name: 'attention', from: '4: the warning tint (--warn-bg, --warn-fg)' },
        { name: 'danger', from: '4: the danger tint (--danger-bg, --danger-fg)' },
        { name: 'off', from: '4: the muted tint (--bg-surface, --text-dim)' },
      ],
      text: 'One Status, on the admin badge (4): mono .66rem 500 in capitals, no frame, the state in a tinted fill. A frame (3) reads as a tag; a fill reads as a state, which is this part\'s whole job, and it keeps a status apart from a tag in the same row. The rounded badge (5) and the grey filled tag (9) move onto it.',
    },
    changes: [
      { page: 'Profile (Access, Organisms, Nodes, Living)', what: 'the framed badges become tinted fills in capitals; "paused" moves from the sun to the attention tint' },
      { page: 'Admin Chat instances', what: 'the rounded pill goes' },
      { page: 'Admin SSO, Knowledge, Subdomains, Statistics, Portal', what: 'the grey filled tags become the off or fine tone' },
    ],
    choice: null,
  },
  {
    id: 'count',
    counted: true,
    title: 'Count: a small number',
    question: 'A small number sits in the side menu, on the bell, in the admin menu and in the top bar\'s morsel badge. You accepted the coral counts and the admin menu count. One Count component?',
    variants: [
      { id: 'count-coral', name: '13. Coral count (.pf-side-badge, .open-items-count)', look: 'mono .7rem, coral fill, paper words', where: 'the profile side menu, the open items button', files: 3, crop: { url: '/v1/profile', selector: '.pf-side-badge' } },
      { id: 'count-bell', name: '14. Bell count (.notif-badge)', look: 'mono .6rem 700, coral fill, white words, 15px high', where: 'the header bell on every signed-in page', files: 1, crop: home('.notif-badge') },
      { id: 'count-morsels', name: '15. Morsel count (.brand-morsels)', look: 'mono .76rem 500, sun fill, a coral heart before it', where: 'the top bar on every signed-in page (hidden below 1180px)', files: 1, keptAsIs: true, crop: home('.brand-morsels') },
      { id: 'count-admin-nav', name: '16. Admin menu count (.adm-nav-item .cnt)', look: 'mono .66rem 500, no fill, the menu\'s dim colour', where: 'the admin side menu', files: 1, crop: { url: '/v1/admin', selector: '.adm-nav-item .cnt' } },
    ],
    proposal: {
      variant: 'proposal',
      name: 'Count, with two tones, and the morsel balance kept as it is',
      tones: [
        { name: 'waiting', from: '13: mono .7rem, the coral fill with paper words; the bell (14) takes it at its own size' },
        { name: 'tally', from: '16: mono .7rem 500, no fill, dim words' },
      ],
      text: 'Yes, one Count, two tones: waiting (coral fill) says something waits for you, and tally (no fill) only says how many. The bell count (14) is the waiting tone, smaller because it sits on an icon. The morsel count (15) is not a count of things: it is a balance with its heart, the product\'s own mark in the top bar, so the proposal keeps it as it is and names it here only so it is seen beside the others.',
    },
    changes: [
      { page: 'Every signed-in page (the bell)', what: 'the bell count takes the waiting tone: mono, coral, paper words; its 700 weight goes' },
      { page: 'Profile side menu, open items', what: 'none: they are the waiting tone already' },
      { page: 'Admin side menu', what: 'the count takes the tally tone at .7rem (from .66rem)' },
    ],
    choice: null,
  },
  {
    id: 'row-label',
    counted: true,
    title: 'Row label: the small coral word that names what follows',
    question: 'A small coral caps word names a row, a prompt or a field in three cuts. Which one?',
    variants: [
      { id: 'poster-label', name: 'Coral label (.poster-label)', look: 'Archivo .72rem 800 caps, .1em, coral', where: 'home: the named rows ("Assets", "Tried so far")', files: 4, crop: home('.poster-label') },
      { id: 'prompt-label', name: 'Prompt label (.poster-prompt-label)', look: 'the same values, in its own rule', where: 'home: the prompt card', files: 3, crop: home('.poster-prompt-label') },
      { id: 'og-label', name: 'Profile label (.og-label)', look: '.68rem 800 caps, .12em, coral', where: 'every profile poster tab', files: 57, crop: { url: '/v1/profile?tab=skills', selector: '.og-label' } },
    ],
    proposal: { variant: 'poster-label', name: '.poster-label', text: 'The design language\'s small coral label. The prompt label is already its values in a copy; the profile label is a hair smaller and wider. One label, one rule.' },
    changes: [
      { page: 'Home', what: 'none: the prompt card\'s label loses its own rule, the look stays' },
      { page: 'Profile (57 files)', what: 'the label grows from .68 to .72rem and tightens from .12em to .1em' },
    ],
    choice: null,
  },
  {
    id: 'group-heading',
    title: 'Group heading: the small heading over a list of rows',
    question: 'A day in the history, the work log and the chat rail each head their rows in a different small cut. Which one?',
    variants: [
      { id: 'day-title', name: 'Day title (.poster-day-title)', look: 'Archivo .72rem 800 caps, .1em, coral, a 3px ink underline', where: 'the history page: one per day', crop: { url: '/v1/home?history=1', selector: '.poster-day-title' } },
      { id: 'worklog-head', name: 'Work log head (.poster-worklog-head)', look: '.68rem 800 caps, .1em, grey', where: 'chat: "What was done" over the work log', crop: chatThread(1, '.poster-worklog-head') },
      { id: 'conversation-label', name: 'Rail heading (.poster-conversation-label)', look: '.64rem, .12em, coral, a 2px underline', where: 'chat: "This conversation" in the rail', crop: { url: '/v1/chat', selector: '.poster-conversation-label' } },
    ],
    proposal: { variant: 'day-title', name: 'Day title', text: 'A heading over rows is more than a label: the underline says the rows below belong to it. The day title does that at the label\'s size. The rail heading takes it (from .64rem and a 2px line); the work log head takes it in grey, because a finished answer\'s log should not call for attention.' },
    changes: [
      { page: 'Chat', what: 'the rail heading grows to .72rem with the 3px underline; the work log head gains the underline and .72rem, and stays grey' },
    ],
    choice: null,
  },
  {
    id: 'timestamp',
    title: 'Timestamp: when a thing happened',
    question: 'A time is set in grey mono at .68rem under a chat turn and at .76rem on the home timeline. Which size?',
    variants: [
      { id: 'turn-meta', name: 'Turn time (.poster-turn-meta)', look: 'mono .68rem, grey', where: 'chat: the time and model under each turn', crop: { url: '/v1/chat', selector: '.poster-turn-meta' } },
      { id: 'timeline-when', name: 'Timeline time (.poster-timeline-when)', look: 'mono .76rem, grey', where: 'home and history: the time of each event', crop: home('.poster-timeline-when') },
    ],
    proposal: { variant: 'turn-meta', name: 'Turn time', text: 'The chat\'s .68rem is also what the rail\'s facts use, so it is the quiet mono size already. The home timeline shrinks to it. If the timeline reads too small at .68rem beside its sentences, choose it, and the chat grows instead.' },
    changes: [
      { page: 'Home, history', what: 'the event times shrink from .76 to .68rem' },
    ],
    choice: null,
  },
  {
    id: 'object-box',
    title: 'Object box: the frame that makes one thing read as one object',
    question: 'A prompt, the journey\'s answer and a chat result are framed in three ways. Which one?',
    variants: [
      { id: 'prompt-card', name: 'Prompt card (.poster-prompt)', look: '2px ink frame, a tinted head, the prompt in a scroll box', where: 'home: every prompt to copy', crop: home('.poster-prompt') },
      { id: 'chooser-box', name: 'Box (.poster-box)', look: '2px ink frame, card ground', where: 'home: the journey\'s answer', crop: home('.poster-chooser-result') },
      { id: 'result-card', name: 'Result card (.poster-result)', look: '2px ink frame with a coloured left edge per kind', where: 'chat: what a turn produced', crop: chatThread(3, '.poster-result') },
    ],
    proposal: { variant: 'chooser-box', name: '.poster-box', text: 'The design language\'s box: a 2px ink frame on the card ground. The prompt card keeps the frame and loses its tinted head; the result card loses its coloured edge (the kind is its own part and stays).' },
    changes: [
      { page: 'Home', what: 'the prompt card\'s tinted head goes' },
      { page: 'Chat', what: 'the result cards lose the coloured left edge' },
    ],
    choice: null,
  },
  {
    id: 'attention-note',
    title: 'Attention note: a note that says "look here"',
    question: 'A note that asks for attention is drawn in three ways: two thin dashed frames and the design language\'s coral aside. Which one?',
    variants: [
      { id: 'waiting-note', name: 'Waiting note (.poster-waiting)', look: 'a thin dashed frame, a pulsing coral dot, a bold line', where: 'home: the agent step while it waits for the agent', crop: null },
      { id: 'nudge', name: 'Nudge (.poster-nudge)', look: 'a thin dashed frame, one line, the way out on the same line', where: 'chat: "Put this on your phone"', crop: null },
      { id: 'aside', name: 'Aside (.poster-aside)', look: '3px dashed coral frame, card ground', where: 'the design language\'s aside; organism settings and admin pages', crop: null },
    ],
    proposal: { variant: 'aside', name: '.poster-aside', text: 'The design language has one note that says a thing out loud: the 3px dashed coral aside. The waiting note keeps its pulsing dot inside it; the nudge keeps its way out on the same line.' },
    changes: [
      { page: 'Home', what: 'the waiting note\'s thin dashed frame becomes the 3px dashed coral aside' },
      { page: 'Chat', what: 'the phone nudge becomes the aside' },
    ],
    choice: null,
  },
  {
    id: 'action-link',
    title: 'Action link: a way on that is not the one loud button',
    question: 'The home and the chat draw a quiet way on in six ways. Which one?',
    variants: [
      { id: 'poster-action', name: 'Underlined action (.poster-action)', look: 'Archivo .9rem 800 caps, 3px ink underline; coral on hover', where: 'home: the masthead doors, the settings account actions', crop: home('.poster-masthead-actions .poster-action') },
      { id: 'fold', name: 'Show more (.poster-fold)', look: 'mono coral words with an underline', where: 'home: "Show all" under a folded list', crop: home('.poster-fold') },
      { id: 'rail-action', name: 'Rail action (.poster-rail-action)', look: 'a small ink underline, grey words', where: 'chat: Copy conversation, Reset session', crop: { url: '/v1/chat', selector: '.poster-rail-action' } },
      { id: 'back', name: 'Back link (.poster-back)', look: 'mono coral words with ↩', where: 'history: back to the home', crop: { url: '/v1/home?history=1', selector: '.poster-back' } },
      { id: 'btn-outline', name: 'Outline button (.btn-outline)', look: 'a rounded thin frame from the classic buttons', where: 'chat: Open on a result card', crop: chatThread(3, '.poster-result-open') },
      { id: 'btn-ghost', name: 'Ghost button (.btn-ghost)', look: 'plain words from the classic buttons', where: 'chat: Listen and Copy under a turn', crop: { url: '/v1/chat', selector: '.poster-turn-listen' } },
    ],
    proposal: { variant: 'poster-action', name: '.poster-action', text: 'The design language: one loud action, and underlined words for the rest, a 3px ink underline under a poster action. Every quiet way on takes it; the classic outline and ghost buttons leave the poster pages.' },
    changes: [
      { page: 'Chat', what: 'Open, Listen, Copy and the rail actions become underlined caps' },
      { page: 'Home', what: '"Show all" moves from coral mono to ink caps' },
      { page: 'History', what: 'the back link becomes an underlined action' },
    ],
    choice: null,
  },
  {
    id: 'tabs-filters',
    counted: true,
    title: 'Tabs and filters: choosing what a list or a panel shows',
    question: 'Choosing one of a few views is drawn as a sun switch, outlined buttons, poster tabs and 25 copies of an admin filter chip. Which one?',
    variants: [
      { id: 'fold-switch', name: 'Home switch (.poster-fold, the chosen one on the sun)', look: 'mono coral underlined words; the chosen one on the sun', where: 'home: the apps switch, the journey\'s task choice', files: 2, crop: home('.poster-fold--on') },
      { id: 'mode-tabs', name: 'Mode tabs (.poster-mode--on)', look: 'outlined classic buttons; the chosen one in a coral outline', where: 'home: the agent step\'s two ways', files: 1, crop: null },
      { id: 'poster-tab', name: 'Poster tab (.poster-tab)', look: 'Archivo caps with the 3px ink underline; the chosen one on the sun', where: 'the design language\'s tab; profile Agents, the agent card, Inbox, the setup guide', files: 4, crop: { url: '/v1/profile?tab=agents', selector: '.poster-tab' } },
      { id: 'adm-filter-chip', name: '10. Admin filter chip (.adm-hook-fchip and 24 copies)', look: 'mono .72rem 500, 2px grey frame; the chosen one on the sun', where: 'about 25 admin pages, each with its own copy of the rule', files: 25, crop: { url: '/v1/admin?tab=hooks', selector: '.adm-hook-fchip' } },
    ],
    proposal: { variant: 'poster-tab', name: '.poster-tab', text: 'The design language names this control: the tab, words with the action\'s 3px underline, the chosen one on the sun with ink words. The home switch already chooses on the sun; the mode tabs and the admin filters become tabs, and the 25 filter rules become one.' },
    changes: [
      { page: 'Home', what: 'the switch words move from coral mono to ink caps; the agent step\'s outlined mode buttons become tabs' },
      { page: 'Admin (about 25 pages)', what: 'the framed filter chips become tabs; the chosen one stays on the sun' },
    ],
    choice: null,
  },
  {
    id: 'loud-action',
    title: 'Loud action: the one button that says "do this now"',
    question: 'The loud button is a coral rounded button on the home and an ink slab in the chat. Which one?',
    variants: [
      { id: 'btn-primary', name: 'Primary button (.btn-primary)', look: 'coral fill, rounded, white words (the classic button)', where: 'home: Copy the prompt, the step buttons', crop: home('.poster-prompt .btn-primary') },
      { id: 'slab-control', name: 'Control slab (.poster-slab--control)', look: 'ink slab, paper words, 4px sun shadow, 44px high', where: 'chat: Send, New conversation', crop: { url: '/v1/chat', selector: '.poster-composer-send' } },
      { id: 'slab', name: 'Slab (.poster-slab)', look: 'ink slab, paper words, 4px sun shadow', where: 'the design language\'s loud action; the demo card on the home', crop: null },
    ],
    proposal: { variant: 'slab', name: '.poster-slab', text: 'The design language\'s loud action inside is the ink slab with the sun shadow; the coral rounded button is the classic shell. .poster-slab on every poster page, the control cut where it sits in a row of controls.' },
    changes: [
      { page: 'Home', what: 'Copy the prompt and the step buttons become ink slabs with the sun shadow' },
    ],
    choice: null,
  },
  {
    id: 'empty',
    title: 'Empty line: the sentence that says a list is empty',
    question: 'An empty list is said in three ways. Which one?',
    variants: [
      { id: 'quiet-note', name: 'Quiet note (.poster-quiet)', look: 'Archivo .9rem 600, grey', where: 'home: no apps opened yet', crop: null },
      { id: 'day-empty', name: 'Day empty (.poster-day-empty)', look: 'Archivo .95rem 400, grey', where: 'history: nothing has happened yet', crop: null },
      { id: 'conversation-empty', name: 'Conversation list empty (.poster-conversation-empty)', look: 'grey body text', where: 'chat: no conversations yet', crop: null },
    ],
    proposal: { variant: 'quiet-note', name: 'QuietNote', text: 'QuietNote is already the library\'s part for this; every empty list says so with it.' },
    changes: [
      { page: 'History', what: 'the empty record line becomes the quiet note (600 instead of 400)' },
      { page: 'Chat', what: 'the empty conversation list becomes the quiet note' },
    ],
    choice: null,
  },
  {
    id: 'agent-step-wrapper',
    title: 'The agent step\'s name form: the stray masthead class',
    question: 'The name form of the agent step sits in a wrapper that wears the masthead name class, which sets its label and hint in the headline face. Keep it, or remove the class?',
    variants: [
      { id: 'as-is', name: 'As it is', look: 'the label and hint in Fjalla caps, from the masthead\'s name rule', where: 'home: the agent step\'s first screen', crop: null },
      { id: 'without', name: 'Without the class', look: 'the label and hint in the body face, as the paste box\'s label is', where: 'home: the agent step\'s first screen', crop: null },
    ],
    proposal: { variant: 'without', name: 'Without the class', text: 'The class reached the wrapper by accident: it was given to the wrapper on 2026-08-07 and, three hours later, to the header nameplate, whose rule cuts text to one line.' },
    changes: [
      { page: 'Home', what: 'the agent step\'s name label and hint move from the headline face to the body face' },
    ],
    choice: { variant: 'without', decidedBy: 'Jouni', decidedAt: '2026-09-23', note: 'Remove the class (the right-hand version), as a unification step of phase 3 with a before/after picture, not now.' },
  },
];
