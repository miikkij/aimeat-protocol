/**
 * @file public/views/design-lab/decisions-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's decisions, as data: one decision per JOB the pages do in more than
 *   one way (Jouni, 2026-09-23). Each has a proposal (ONE component, with tones named by meaning
 *   where the looks it covers carry meaning) and its options, the looks the pages draw today.
 *
 *   TWO REGISTERS, KEPT APART. Everything a person reads at the top of a decision page is in plain
 *   words: `title`, `question`, `proposal.name`, `proposal.summary`, a tone's `meaning`, an option's
 *   `name`, `where` and `becomes`, and `changes`. No CSS value and no class name goes there (Jouni:
 *   "No CSS values in the visible part"). The technical half, shown only in the folded Details, is
 *   `proposal.text`, a tone's `from`, and an option's `code` and `look`.
 *
 *   PLAIN DATA, NO IMPORTS. The lab reads it in the browser, and scripts/design-lab-crops.ts reads
 *   it in Node to shoot each option's crop from its page. An option's live picture is in
 *   decision-samples.js under the same id, and a proposal that is a new composition (`variant:
 *   'proposal'`) has its picture there too; `pnpm check:ui-library` holds the files together.
 *
 *   `keptAsIs` marks an option the proposal shows but does not change. `files` is how many JS files
 *   draw an option, shown in Details only where `counted` says a search measured it.
 *
 *   A decision belongs to the project, not to a node. Jouni's answers are kept as his records on the
 *   node he looks at (`design-lab.choice.<id>`) and change freely; nothing is final until he says in
 *   chat to read the decisions, when they are written into `choice` here. The agent step's wrapper
 *   was decided in chat and carries its `choice` already.
 * @structure DECISIONS — [{ id, counted, title, question, proposal: { variant, name, summary, text,
 *   tones?: [{ name, meaning, from }] }, variants: [{ id, name, code, look, where, becomes, files,
 *   keptAsIs, crop }], changes: [{ page, what }], choice }]
 * @usage import { DECISIONS } from './decisions-data.js';
 * @version-history
 *   v3.0.0 — 2026-09-23 — Plain words for everything visible, the technical half kept for Details
 *     (Jouni's page layout); options named by what they are.
 *   v2.0.0 — 2026-09-23 — Split by job; proposals as one component with named tones.
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */

const home = (selector, extra = {}) => ({ url: '/v1/home', selector, ...extra });
const chatThread = (n, selector) => ({ url: '/v1/chat', eval: `document.querySelectorAll('.poster-thread-open')[${n}].click();`, selector });

export const DECISIONS = [
  {
    id: 'tag',
    counted: true,
    title: 'Tag: a small word that names a thing',
    question: 'Tags name a kind, a version, a role or a relation. Seven looks do this today. Should they become one Tag, with four tones that keep what they say?',
    proposal: {
      variant: 'proposal',
      name: 'One Tag, with four tones',
      summary: 'One small framed tag in the typewriter face, in four tones: plain, sun, coral and ink.',
      tones: [
        { name: 'plain', meaning: 'names a thing', from: '1 (.poster-chip): mono .68rem 500, 1px ink frame, .04em, no fill' },
        { name: 'sun', meaning: 'the chosen one, or the one that counts now', from: '2 ("7 unread") and 12 ("music"): the sun fill with ink words' },
        { name: 'coral', meaning: 'the one to notice', from: '8 ("operator"): the coral frame with coral words' },
        { name: 'ink', meaning: 'the one that belongs to you (a relation, your role)', from: '11 ("colleague"): the ink fill with card-coloured words' },
      ],
      text: 'One Tag on .poster-chip (1). The tones take their values from the variants Jouni accepted: plain from 1, sun from 2 and 12, coral from 8, ink from 11. The schedule kind (6) becomes plain: its blue and orange frames say nothing the word does not.',
    },
    variants: [
      { id: 'poster-chip', name: 'The design language\'s chip, not used by any page yet', code: '.poster-chip (poster.css)', becomes: 'plain', look: 'mono .68rem 500, 1px ink frame, square, no fill', where: 'no page yet', files: 0, crop: null },
      { id: 'og-chip', name: 'The profile chip ("7 unread", "2 requests")', code: '.og-chip, --sun, --dim (organism.css)', becomes: 'plain; "7 unread" becomes sun; "archived" becomes plain', look: 'mono .68rem 500, 2px ink frame, lowercase; --sun fills it; --dim greys it', where: 'almost every profile page, admin Compliance, the public knowledge page', files: 63, crop: { url: '/v1/profile?tab=messages', selector: '.og-chip' } },
      { id: 'pf-mono-chip', name: 'The schedule kind ("AI", "agent task")', code: '.sch-badge (scheduler.css, profile-poster.css)', becomes: 'plain; its blue and orange frames go', look: 'mono .68rem 500, 2px frame in blue or orange by kind', where: 'profile Scheduler, Offers, Memory files, Organisms, Access', files: 10, crop: { url: '/v1/profile?tab=scheduler', selector: '.sch-badge' } },
      { id: 'row-tag', name: 'The version tag in a list row ("v1.4.0")', code: '.sk-tag, .lb-tag, .pk-tag, .ex-tag, .cp-tag', becomes: 'plain, with dark words instead of grey', look: 'mono .66rem 500, 1px grey frame, grey words', where: 'profile Skills, Libraries, Packages, Extensions, Capabilities', files: 5, crop: { url: '/v1/profile?tab=skills', selector: '.sk-tag' } },
      { id: 'adm-state-chip', name: 'The admin role chip ("member", "operator", "you")', code: '.adm-own-chip and kin (admin-owners.css)', becomes: 'plain; "operator" becomes coral; "you" becomes sun', look: 'mono .66rem 500, 2px grey frame; --op coral; --you on the sun', where: 'admin Owners, Organism ownership, Realtime, CSM, Memory, Boards; the fleet page', files: 8, crop: { url: '/v1/admin?tab=owners', selector: '.adm-own-chip' } },
      { id: 'ct-tag', name: 'The contact tag ("colleague", "design")', code: '.ct-tag, --rel (contacts-poster.css)', becomes: 'plain, in the typewriter face; the relation becomes ink', look: 'Archivo .68rem 700, 1px ink frame; --rel ink fill', where: 'profile Contacts', files: 3, crop: { url: '/v1/profile?tab=contacts', selector: '.ct-tag' } },
      { id: 'tag-pill', name: 'The memory tag ("music", "notes")', code: '.tag-pill, .active (tags.css, profile-poster.css)', becomes: 'plain with a thinner frame; the chosen one becomes sun', look: 'mono .72rem, 2px ink frame, square; .active on the sun', where: 'profile Memory, the portfolio builder', files: 3, crop: { url: '/v1/profile?tab=memory', selector: '.tag-pill' } },
    ],
    changes: [
      { page: 'Profile, all pages', what: 'The tags get a thinner frame and all use the same size. The sun tags stay on the sun.' },
      { page: 'Profile Scheduler, Offers, Memory files', what: 'The coloured frames around the kind go; the kind is a plain tag.' },
      { page: 'Profile Skills and the other lists', what: 'The version tag turns from grey to dark words in a dark frame.' },
      { page: 'Admin Owners and the other rosters', what: 'The grey role tags become plain tags; "operator" stays coral and "you" stays on the sun.' },
      { page: 'Profile Contacts', what: 'The tags change to the typewriter face; the relation keeps its dark fill.' },
    ],
    choice: null,
  },
  {
    id: 'status',
    counted: true,
    title: 'Status: a word that says a state by its colour',
    question: 'A status word says whether something is fine, needs a look, is broken or is off. Four looks do this today. Should they become one Status with four tones?',
    proposal: {
      variant: 'proposal',
      name: 'One Status, with four tones',
      summary: 'One small status word in capitals on a pale colour: green for fine, yellow for attention, red for danger, grey for off.',
      tones: [
        { name: 'fine', meaning: 'all is well', from: '4: the success tint (--success-bg, --success-fg)' },
        { name: 'attention', meaning: 'needs a look', from: '4: the warning tint (--warn-bg, --warn-fg)' },
        { name: 'danger', meaning: 'broken or refused', from: '4: the danger tint (--danger-bg, --danger-fg)' },
        { name: 'off', meaning: 'not in use', from: '4: the muted tint (--bg-surface, --text-dim)' },
      ],
      text: 'One Status on .adm-badge (4): mono .66rem 500 caps, no frame, the state in a tinted fill. A frame (3) reads as a tag; a fill reads as a state, and it keeps a status apart from a tag in the same row. 5 and 9 move onto it.',
    },
    variants: [
      { id: 'pf-badge', name: 'The profile status ("active", "paused")', code: '.pf .badge, badge-success/warn/danger/muted (profile-poster.css)', becomes: 'active becomes fine; paused becomes attention; revoked becomes danger; archived becomes off', look: 'mono .66rem 500, 2px frame in the tone colour, warn on the sun', where: 'profile Access, Organisms, Nodes, Living, the agent approval card', files: 32, crop: { url: '/v1/profile?tab=organisms', selector: '.pf .badge' } },
      { id: 'adm-badge', name: 'The admin status ("healthy", "critical")', code: '.adm-badge-* (admin.css)', becomes: 'healthy becomes fine; warning becomes attention; critical becomes danger; idle becomes off', look: 'mono .66rem 500 caps, no frame, a tinted fill per tone', where: 'every admin roster: Agents, Apps, Actions, Hooks, SSO', files: 51, crop: { url: '/v1/admin?tab=agents', selector: '.adm-badge' } },
      { id: 'theme-badge', name: 'The rounded status ("anon", "blocked")', code: '.badge outside .pf (theme.css)', becomes: 'active becomes fine; paused becomes attention; blocked becomes danger; anon becomes off; the round ends go', look: 'Archivo .66rem 600 caps, a pill radius, tinted fill', where: 'admin Chat instances, the key and value rows', files: 2, crop: { url: '/v1/admin?tab=chatInstances', selector: '.badge' } },
      { id: 'adm-grey-tag', name: 'The admin filled word ("per day", "quiet")', code: '.adm-st-chip and kin', becomes: 'good becomes fine; bad becomes danger; quiet becomes off', look: 'mono .66rem, grey fill, no frame, some in caps', where: 'admin SSO, Knowledge, Subdomains, Statistics, Portal', files: 5, crop: { url: '/v1/admin?tab=stats', selector: '.adm-st-chip' } },
    ],
    changes: [
      { page: 'Profile Access, Organisms, Nodes, Living', what: 'The framed status words become capitals on a pale colour; "paused" moves from the sun to pale yellow.' },
      { page: 'Admin Chat instances', what: 'The rounded status words become square.' },
      { page: 'Admin SSO, Knowledge, Subdomains, Statistics, Portal', what: 'The grey words take the green, red or grey status colour.' },
    ],
    choice: null,
  },
  {
    id: 'count',
    counted: true,
    title: 'Count: a small number',
    question: 'A small number sits in the profile menu, on the bell, in the admin menu and in the top bar\'s morsel badge. Should they become one Count?',
    proposal: {
      variant: 'proposal',
      name: 'One Count, with two tones; the morsel badge stays',
      summary: 'One small number in the typewriter face: on coral when something waits for you, without a background when it only counts. The morsel badge stays as it is.',
      tones: [
        { name: 'waiting', meaning: 'something waits for you', from: '13: mono .7rem, the coral fill with paper words; the bell (14) takes it at .6rem' },
        { name: 'tally', meaning: 'only says how many', from: '16: mono .7rem 500, no fill, dim words' },
      ],
      text: 'One Count, two tones. The bell count (14) is waiting, smaller because it sits on an icon. The morsel count (15) is a balance with its heart, the product\'s own mark in the top bar, and stays as it is.',
    },
    variants: [
      { id: 'count-coral', name: 'The coral count in the profile menu and on open items', code: '.pf-side-badge, .open-items-count', becomes: 'waiting', look: 'mono .7rem, coral fill, paper words', where: 'the profile menu, the open items button', files: 3, crop: { url: '/v1/profile', selector: '.pf-side-badge' } },
      { id: 'count-bell', name: 'The count on the bell', code: '.notif-badge (theme.css)', becomes: 'waiting, at the bell\'s small size', look: 'mono .6rem 700, coral fill, white words, 15px high', where: 'the top bar on every signed-in page', files: 1, crop: home('.notif-badge') },
      { id: 'count-morsels', name: 'The morsel badge with its heart', code: '.brand-morsels (theme.css)', becomes: 'stays as it is', look: 'mono .76rem 500, sun fill, a coral heart before it; hidden below 1180px', where: 'the top bar on every signed-in page', files: 1, keptAsIs: true, crop: home('.brand-morsels') },
      { id: 'count-admin-nav', name: 'The count in the admin menu', code: '.adm-nav-item .cnt (admin.css)', becomes: 'tally, a little larger', look: 'mono .66rem 500, no fill, the menu\'s dim colour', where: 'the admin menu', files: 1, crop: { url: '/v1/admin', selector: '.adm-nav-item .cnt' } },
    ],
    changes: [
      { page: 'Every signed-in page', what: 'The number on the bell is set in the typewriter face, a little lighter.' },
      { page: 'Profile menu, open items', what: 'Nothing changes: they are the waiting count already.' },
      { page: 'Admin menu', what: 'The counts grow a little.' },
    ],
    choice: null,
  },
  {
    id: 'row-label',
    counted: true,
    title: 'Row label: the small coral word that names what follows',
    question: 'A small coral word in capitals names a row, a prompt or a field. Three versions of it exist. Should one be used everywhere?',
    proposal: {
      variant: 'poster-label', name: 'The home\'s row label',
      summary: 'The coral row label of the home, everywhere.',
      text: '.poster-label: Archivo .72rem 800 caps, .1em, coral. The prompt label is the same values in a copy; the profile label is .68rem at .12em.',
    },
    variants: [
      { id: 'poster-label', name: 'The home\'s row label ("Assets")', code: '.poster-label (poster.css)', becomes: 'this is the proposal', look: 'Archivo .72rem 800 caps, .1em, coral', where: 'the home: the named rows', files: 4, crop: home('.poster-label') },
      { id: 'prompt-label', name: 'The prompt card\'s label ("The prompt")', code: '.poster-prompt-label (prompt-card.css)', becomes: 'the same look; only its own copy of the rule goes', look: 'the same values, in its own rule', where: 'the home: the prompt card', files: 3, crop: home('.poster-prompt-label') },
      { id: 'og-label', name: 'The profile\'s label ("Visibility")', code: '.og-label (organism.css)', becomes: 'the proposal\'s look, a hair larger and tighter', look: '.68rem 800 caps, .12em, coral', where: 'every profile page', files: 57, crop: { url: '/v1/profile?tab=skills', selector: '.og-label' } },
    ],
    changes: [
      { page: 'Home', what: 'Nothing you can see.' },
      { page: 'Profile, all pages', what: 'The small coral labels grow a little and their letters sit a little closer.' },
    ],
    choice: null,
  },
  {
    id: 'group-heading',
    title: 'Group heading: the small heading over a list',
    question: 'A day in the history, the work log in the chat and the chat\'s side column each head their list in a different small way. Should one be used everywhere?',
    proposal: {
      variant: 'day-title', name: 'The history\'s day heading',
      summary: 'The history\'s day heading, a small coral word with a thick line under it, over every list; grey over the work log.',
      text: '.poster-day-title: the label values plus a 3px ink underline. The rail heading moves from .64rem and a 2px line; the work log head takes it in grey.',
    },
    variants: [
      { id: 'day-title', name: 'The history\'s day heading ("Today")', code: '.poster-day-title (day-group.css)', becomes: 'this is the proposal', look: 'Archivo .72rem 800 caps, .1em, coral, 3px ink underline', where: 'the history page', crop: { url: '/v1/home?history=1', selector: '.poster-day-title' } },
      { id: 'worklog-head', name: 'The work log heading ("What was done")', code: '.poster-worklog-head (work-log.css)', becomes: 'the day heading, kept grey', look: '.68rem 800 caps, .1em, grey', where: 'the chat: over the work log', crop: chatThread(1, '.poster-worklog-head') },
      { id: 'conversation-label', name: 'The chat column heading ("This conversation")', code: '.poster-conversation-label (conversation-frame.css)', becomes: 'the day heading', look: '.64rem, .12em, coral, 2px underline', where: 'the chat: the side column', crop: { url: '/v1/chat', selector: '.poster-conversation-label' } },
    ],
    changes: [
      { page: 'Chat', what: 'The side column\'s heading and the work log\'s heading grow a little and get a thicker line under them.' },
    ],
    choice: null,
  },
  {
    id: 'timestamp',
    title: 'Timestamp: when a thing happened',
    question: 'A time is shown in small grey typewriter letters under a chat message and a little larger on the home. Should it be one size?',
    proposal: {
      variant: 'turn-meta', name: 'The chat\'s time',
      summary: 'Every time in the chat\'s small grey typewriter letters.',
      text: '.poster-turn-meta: mono .68rem, grey. The home timeline\'s .76rem shrinks to it.',
    },
    variants: [
      { id: 'turn-meta', name: 'The time under a chat message', code: '.poster-turn-meta (turn.css)', becomes: 'this is the proposal', look: 'mono .68rem, grey', where: 'the chat', crop: { url: '/v1/chat', selector: '.poster-turn-meta' } },
      { id: 'timeline-when', name: 'The time of an event on the home', code: '.poster-timeline-when (timeline.css)', becomes: 'the chat\'s time, a little smaller', look: 'mono .76rem, grey', where: 'the home and the history page', crop: home('.poster-timeline-when') },
    ],
    changes: [
      { page: 'Home, history', what: 'The event times get a little smaller.' },
    ],
    choice: null,
  },
  {
    id: 'object-box',
    title: 'Object box: the frame around one thing',
    question: 'A prompt, the home\'s answer box and a chat result are framed in three ways. Should they share one frame?',
    proposal: {
      variant: 'chooser-box', name: 'The plain dark frame',
      summary: 'A plain dark frame on a white card for every object; no coloured top band, no coloured side edge.',
      text: '.poster-box: 2px ink frame, card ground. The prompt card loses its tinted head; the result card loses its coloured left edge.',
    },
    variants: [
      { id: 'prompt-card', name: 'The prompt card', code: '.poster-prompt (prompt-card.css)', becomes: 'the plain frame; its tinted top band goes', look: '2px ink frame, a tinted head, the prompt in a scroll box', where: 'the home: every prompt to copy', crop: home('.poster-prompt') },
      { id: 'chooser-box', name: 'The home\'s answer box', code: '.poster-box (poster.css)', becomes: 'this is the proposal', look: '2px ink frame, card ground', where: 'the home: the task answer', crop: home('.poster-chooser-result') },
      { id: 'result-card', name: 'The chat\'s result card', code: '.poster-result (result-card.css)', becomes: 'the plain frame; its coloured side edge goes', look: '2px ink frame, coloured left edge per kind', where: 'the chat: what an answer produced', crop: chatThread(3, '.poster-result') },
    ],
    changes: [
      { page: 'Home', what: 'The prompt card loses its tinted top band.' },
      { page: 'Chat', what: 'The result cards lose their coloured side edge.' },
    ],
    choice: null,
  },
  {
    id: 'attention-note',
    title: 'Attention note: a note that says "look here"',
    question: 'A note that asks for attention is drawn in three ways. Should they share one look?',
    proposal: {
      variant: 'aside', name: 'The dashed coral note',
      summary: 'The design language\'s note with a thick dashed coral frame, for every note that asks for attention.',
      text: '.poster-aside: 3px dashed coral frame, card ground. The waiting note keeps its pulsing dot; the nudge keeps its way out on the same line.',
    },
    variants: [
      { id: 'waiting-note', name: 'The waiting note ("Waiting for your agent")', code: '.poster-waiting (waiting-note.css)', becomes: 'the dashed coral note, with its pulsing dot', look: 'thin dashed frame, pulsing coral dot, bold line', where: 'the home: the agent step while it waits', crop: null },
      { id: 'nudge', name: 'The nudge ("Put this on your phone")', code: '.poster-nudge (nudge.css)', becomes: 'the dashed coral note', look: 'thin dashed frame, one line, the way out on the same line', where: 'the chat', crop: null },
      { id: 'aside', name: 'The dashed coral note', code: '.poster-aside (poster.css)', becomes: 'this is the proposal', look: '3px dashed coral frame, card ground', where: 'organism settings and admin pages', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'The waiting note gets a thick dashed coral frame.' },
      { page: 'Chat', what: 'The phone suggestion gets a thick dashed coral frame.' },
    ],
    choice: null,
  },
  {
    id: 'action-link',
    title: 'Action link: a way on that is not the one big button',
    question: 'The home and the chat draw a quiet way on in six ways. Should they share one?',
    proposal: {
      variant: 'poster-action', name: 'Underlined capitals',
      summary: 'Dark capitals with a thick line under them for every quiet way on; the old rounded and plain buttons go.',
      text: '.poster-action: Archivo .9rem 800 caps, 3px ink underline, coral on hover. The classic .btn-outline and .btn-ghost leave the poster pages.',
    },
    variants: [
      { id: 'poster-action', name: 'Underlined capitals ("Settings")', code: '.poster-action (poster.css)', becomes: 'this is the proposal', look: 'Archivo .9rem 800 caps, 3px ink underline', where: 'the home: the top doors, the settings dialog', crop: home('.poster-masthead-actions .poster-action') },
      { id: 'fold', name: '"Show all" under a list', code: '.poster-fold (fold-button.css)', becomes: 'underlined capitals', look: 'mono coral words with an underline', where: 'the home: under a shortened list', crop: home('.poster-fold') },
      { id: 'rail-action', name: 'The chat column actions ("Copy conversation")', code: '.poster-rail-action (rail-action.css)', becomes: 'underlined capitals', look: 'small ink underline, grey words', where: 'the chat: the side column', crop: { url: '/v1/chat', selector: '.poster-rail-action' } },
      { id: 'back', name: 'The back link ("Back to your home")', code: '.poster-back (back-link.css)', becomes: 'underlined capitals', look: 'mono coral words with ↩', where: 'the history page', crop: { url: '/v1/home?history=1', selector: '.poster-back' } },
      { id: 'btn-outline', name: 'The rounded frame button ("Open")', code: '.btn-outline (components.css)', becomes: 'underlined capitals', look: 'a rounded thin frame from the classic buttons', where: 'the chat: on a result card', crop: chatThread(3, '.poster-result-open') },
      { id: 'btn-ghost', name: 'The plain button ("Listen", "Copy")', code: '.btn-ghost (components.css)', becomes: 'underlined capitals', look: 'plain words from the classic buttons', where: 'the chat: under a message', crop: { url: '/v1/chat', selector: '.poster-turn-listen' } },
    ],
    changes: [
      { page: 'Chat', what: 'Open, Listen, Copy and the side column actions become dark underlined capitals.' },
      { page: 'Home', what: '"Show all" becomes dark underlined capitals instead of coral.' },
      { page: 'History', what: 'The back link becomes dark underlined capitals.' },
    ],
    choice: null,
  },
  {
    id: 'tabs-filters',
    counted: true,
    title: 'Tabs and filters: choosing what a list or a panel shows',
    question: 'Choosing one of a few views is drawn as a sun switch, outlined buttons, tabs and filter chips. Should they all be tabs?',
    proposal: {
      variant: 'poster-tab', name: 'Tabs, the chosen one on the sun',
      summary: 'Tabs everywhere: underlined words, the chosen one on the sun.',
      text: '.poster-tab with .is-on on the sun. The home switch already chooses on the sun; the mode tabs and the 25 admin filter rules become tabs.',
    },
    variants: [
      { id: 'fold-switch', name: 'The home\'s switch ("Recent", "Mine")', code: '.poster-fold, .poster-fold--on (fold-button.css)', becomes: 'tabs; the chosen one stays on the sun', look: 'mono coral underlined words; the chosen one on the sun', where: 'the home: the apps switch, the task choice', files: 2, crop: home('.poster-fold--on') },
      { id: 'mode-tabs', name: 'The agent step\'s two ways', code: '.poster-mode--on (mode-tabs.css)', becomes: 'tabs', look: 'outlined classic buttons; the chosen one in a coral outline', where: 'the home: the agent step', files: 1, crop: null },
      { id: 'poster-tab', name: 'Tabs ("Overview", "Tasks")', code: '.poster-tab, .is-on (poster.css)', becomes: 'this is the proposal', look: 'Archivo caps, 3px ink underline; .is-on on the sun', where: 'profile Agents, the agent card, Inbox, the setup guide', files: 4, crop: { url: '/v1/profile?tab=agents', selector: '.poster-tab' } },
      { id: 'adm-filter-chip', name: 'The admin filters ("all", "failed")', code: '.adm-hook-fchip and 24 copies', becomes: 'tabs; the chosen one stays on the sun', look: 'mono .72rem 500, 2px grey frame; the chosen one on the sun', where: 'about 25 admin pages', files: 25, crop: { url: '/v1/admin?tab=hooks', selector: '.adm-hook-fchip' } },
    ],
    changes: [
      { page: 'Home', what: 'The switch words become dark capitals; the agent step\'s two buttons become tabs.' },
      { page: 'Admin, about 25 pages', what: 'The framed filters become tabs; the chosen one stays on the sun.' },
    ],
    choice: null,
  },
  {
    id: 'loud-action',
    title: 'Loud action: the one button that says "do this now"',
    question: 'The big button is a coral rounded button on the home and a dark block in the chat. Which one?',
    proposal: {
      variant: 'slab', name: 'The dark block with the sun shadow',
      summary: 'A dark block with a sun-coloured shadow for the one big button on every page.',
      text: '.poster-slab: ink slab, paper words, 4px sun shadow; the control cut in a row of controls. The coral .btn-primary is the classic shell.',
    },
    variants: [
      { id: 'btn-primary', name: 'The coral rounded button ("Copy the prompt")', code: '.btn-primary (components.css)', becomes: 'the dark block', look: 'coral fill, rounded, white words', where: 'the home: Copy the prompt, the step buttons', crop: home('.poster-prompt .btn-primary') },
      { id: 'slab-control', name: 'The chat\'s dark block ("Send")', code: '.poster-slab--control (poster.css)', becomes: 'the dark block, in its control size', look: 'ink slab, paper words, 4px sun shadow, 44px high', where: 'the chat: Send, New conversation', crop: { url: '/v1/chat', selector: '.poster-composer-send' } },
      { id: 'slab', name: 'The dark block', code: '.poster-slab (poster.css)', becomes: 'this is the proposal', look: 'ink slab, paper words, 4px sun shadow', where: 'the demo card on the home', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'Copy the prompt and the step buttons become dark blocks with a sun-coloured shadow.' },
    ],
    choice: null,
  },
  {
    id: 'empty',
    title: 'Empty line: the sentence that says a list is empty',
    question: 'An empty list is said in three ways. Should they share one?',
    proposal: {
      variant: 'quiet-note', name: 'The quiet grey sentence',
      summary: 'One quiet grey sentence for every empty list.',
      text: 'QuietNote (.poster-quiet): Archivo .9rem 600, grey.',
    },
    variants: [
      { id: 'quiet-note', name: 'The home\'s empty sentence', code: '.poster-quiet (quiet-note.css)', becomes: 'this is the proposal', look: 'Archivo .9rem 600, grey', where: 'the home', crop: null },
      { id: 'day-empty', name: 'The history\'s empty sentence', code: '.poster-day-empty (day-group.css)', becomes: 'the quiet sentence, a little bolder', look: 'Archivo .95rem 400, grey', where: 'the history page', crop: null },
      { id: 'conversation-empty', name: 'The empty conversation list', code: '.poster-conversation-empty (conversation-frame.css)', becomes: 'the quiet sentence', look: 'grey body text', where: 'the chat', crop: null },
    ],
    changes: [
      { page: 'History', what: 'The "nothing here yet" sentence gets a little bolder.' },
      { page: 'Chat', what: 'The empty conversation list says so in the quiet sentence.' },
    ],
    choice: null,
  },
  {
    id: 'agent-step-wrapper',
    title: 'The agent step\'s name form',
    question: 'The name form of the agent step borrows the page header\'s name style, which sets its label and hint in the headline letters. Keep it, or remove it?',
    proposal: {
      variant: 'without', name: 'Without the borrowed style',
      summary: 'Remove the borrowed style, so the label and hint read in the body letters (in phase 3).',
      text: 'The wrapper wears .poster-masthead-name, given to it on 2026-08-07 and, three hours later, to the header nameplate, whose rule cuts text to one line.',
    },
    variants: [
      { id: 'as-is', name: 'As it is', code: '.poster-masthead-name on the wrapper', becomes: 'goes', look: 'label and hint in Fjalla caps from the masthead name rule', where: 'the home: the agent step', crop: null },
      { id: 'without', name: 'Without the borrowed style', code: 'no class on the wrapper', becomes: 'this is the proposal', look: 'label and hint in the body face', where: 'the home: the agent step', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'The agent step\'s name label and hint read in the body letters.' },
    ],
    choice: { variant: 'without', decidedBy: 'Jouni', decidedAt: '2026-09-23', note: 'Remove the class (the right-hand version), as a unification step of phase 3 with a before/after picture.' },
  },
];
