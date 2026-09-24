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
 *   BUILT — { [decisionId]: { commit, onMain, date, what, sets: [{ name, total, changed, noise }], note? } }
 *   BUILT_WITHOUT_DECISION — { [id]: the same, with a title }: built work Jouni looks at that no decision holds
 * @usage import { DECISIONS, BUILT } from './decisions-data.js';
 * @version-history
 *   v3.6.0 — 2026-09-24 — Themes & Styles, shape values: the move and the remade Pebble, measured,
 *     with Pebble's values and how much of its component CSS was left.
 *   v3.5.0 — 2026-09-24 — Themes & Styles: the example theme Pebble, and `reach`, what it reached on
 *     each page and what it did not, with the reason.
 *   v3.4.0 — 2026-09-24 — BUILT_WITHOUT_DECISION: Themes & Styles, its numbers and its yes.
 *   v3.3.0 — 2026-09-24 — BUILT: what was built from decisions 13-22, for the lab's "Built" section.
 *   v3.2.0 — 2026-09-24 — Dialog actions answered (Jouni: the proposal, and Save is the loud action).
 *   v3.1.0 — 2026-09-24 — The home's and the chat's remaining own looks (decisions 14-21, answered
 *     and written here as the source) and the dialog's footer actions (waiting for Jouni).
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
      { id: 'og-chip', name: 'The profile chip ("7 unread", "2 requests")', code: '.og-chip, --sun, --dim (organism.css)', becomes: 'plain; "7 unread" becomes sun; "archived" becomes plain', look: 'mono .68rem 500, 2px ink frame, lowercase; --sun fills it; --dim greys it', where: 'almost every profile page, admin Compliance, the public knowledge page', files: 63, crop: { url: '/v1/profile?tab=messages', selector: '.og-chip.og-chip--sun' } },
      { id: 'pf-mono-chip', name: 'The schedule kind ("AI", "agent task")', code: '.sch-badge (scheduler.css, profile-poster.css)', becomes: 'plain; its blue and orange frames go', look: 'mono .68rem 500, 2px frame in blue or orange by kind', where: 'profile Scheduler, Offers, Memory files, Organisms, Access', files: 10, crop: { url: '/v1/profile?tab=scheduler', selector: '.sch-badge' } },
      { id: 'row-tag', name: 'The version tag in a list row ("v1.4.0")', code: '.sk-tag, .lb-tag, .pk-tag, .ex-tag, .cp-tag', becomes: 'plain, with dark words instead of grey', look: 'mono .66rem 500, 1px grey frame, grey words', where: 'profile Skills, Libraries, Packages, Extensions, Capabilities', files: 5, crop: { url: '/v1/profile?tab=skills', selector: '.sk-tag' } },
      { id: 'adm-state-chip', name: 'The admin role chip ("member", "operator", "you")', code: '.adm-own-chip and kin (admin-owners.css)', becomes: 'plain; "operator" becomes coral; "you" becomes sun', look: 'mono .66rem 500, 2px grey frame; --op coral; --you on the sun', where: 'admin Owners, Organism ownership, Realtime, CSM, Memory, Boards; the fleet page', files: 8, crop: { url: '/v1/admin?tab=owners', selector: '.adm-own-chip.adm-own-chip--you' } },
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
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: one Tag with four tones.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
      { id: 'pf-badge', name: 'The profile status ("active", "paused")', code: '.pf .badge, badge-success/warn/danger/muted (profile-poster.css)', becomes: 'active becomes fine; paused becomes attention; revoked becomes danger; archived becomes off', look: 'mono .66rem 500, 2px frame in the tone colour, warn on the sun', where: 'profile Access, Organisms, Nodes, Living, the agent approval card (on Organisms the same look also names a kind, such as "Community", which is a tag\'s job)', files: 32, crop: { url: '/v1/profile?tab=access', selector: '.pf .badge.badge-muted' } },
      { id: 'adm-badge', name: 'The admin status ("healthy", "critical")', code: '.adm-badge-* (admin.css)', becomes: 'healthy becomes fine; warning becomes attention; critical becomes danger; idle becomes off', look: 'mono .66rem 500 caps, no frame, a tinted fill per tone', where: 'every admin roster: Agents, Apps, Actions, Hooks, SSO', files: 51, crop: { url: '/v1/admin?tab=agents', selector: '.adm-badge' } },
      { id: 'theme-badge', name: 'The rounded grey word ("Active", "anon")', code: '.badge with bg-green or bg-dim (theme.css); no sheet styles bg-green or bg-dim, so both draw the same', becomes: '"Active" becomes fine; "anon" becomes off', where: 'admin Chat instances (today "Active" and "anon" look the same)', files: 1, crop: { url: '/v1/admin?tab=chatInstances', selector: '.badge' } },
      { id: 'adm-grey-tag', name: 'The admin filled word ("per day", "quiet")', code: '.adm-st-chip and kin', becomes: 'good becomes fine; bad becomes danger; quiet becomes off', look: 'mono .66rem, grey fill, no frame, some in caps', where: 'admin SSO, Knowledge, Subdomains, Statistics, Portal', files: 5, crop: { url: '/v1/admin?tab=stats', selector: '.adm-st-chip' } },
    ],
    changes: [
      { page: 'Profile Access, Organisms, Nodes, Living', what: 'The framed status words become capitals on a pale colour; "paused" moves from the sun to pale yellow.' },
      { page: 'Admin Chat instances', what: '"Active" turns green and "anon" grey, square instead of round. Today both are the same grey word.' },
      { page: 'Admin SSO, Knowledge, Subdomains, Statistics, Portal', what: 'The grey words take the green, red or grey status colour.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: one Status with four tones.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: one Count with two tones; the morsel badge stays.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the home's row label everywhere.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: the history's day heading over every list.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
      { id: 'turn-meta', name: 'The time under a chat message', code: '.poster-turn-meta (turn.css)', becomes: 'this is the proposal', look: 'mono .68rem, grey', where: 'the chat', crop: { url: '/v1/chat', selector: '.poster-turn--agent .poster-turn-meta' } },
      { id: 'timeline-when', name: 'The time of an event on the home', code: '.poster-timeline-when (timeline.css)', becomes: 'the chat\'s time, a little smaller', look: 'mono .76rem, grey', where: 'the home and the history page', crop: home('.poster-timeline-when') },
    ],
    changes: [
      { page: 'Home, history', what: 'The event times get a little smaller.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: every time in the chat's size.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
  },
  {
    id: 'object-box',
    title: 'Object box: the frame around one thing',
    question: 'A prompt, the home\'s answer box and a chat result all sit in a dark frame. The prompt card is on a grey ground, the other two on white. Should all three be on white?',
    proposal: {
      variant: 'chooser-box', name: 'The dark frame on white',
      summary: 'Every object box in the dark frame on a white ground, as the home\'s answer box is today.',
      text: '.poster-box: 2px ink frame, card ground. The prompt card moves from --bg-dim to the card ground; the result card has the frame and the ground already, and keeps its 6px edge in its kind\'s colour.',
    },
    variants: [
      { id: 'prompt-card', name: 'The prompt card', code: '.poster-prompt (prompt-card.css)', becomes: 'the white ground', where: 'the home: every prompt to copy', crop: home('.poster-prompt') },
      { id: 'chooser-box', name: 'The home\'s answer box', code: '.poster-box (poster.css)', becomes: 'this is the proposal', where: 'the home: the task answer', crop: home('.poster-chooser-result') },
      { id: 'result-card', name: 'The chat\'s result card', code: '.poster-result (result-card.css)', becomes: 'stays as it is', where: 'the chat: what an answer produced', crop: chatThread(3, '.poster-result') },
    ],
    changes: [
      { page: 'Home', what: 'The prompt cards turn from grey to white inside their frame.' },
      { page: 'Chat', what: 'Nothing: the result cards have the dark frame on white already, with a coloured edge on the left for their kind.' },
    ],
    choice: {"proposal":null,"options":{"prompt-card":"accepted","chooser-box":"accepted","result-card":"accepted"},"note":"Every look kept: one box component with the three looks as its tones, no visible change (Jouni, in chat).","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
      { id: 'nudge', name: 'The nudge ("Put this on your phone")', code: '.poster-nudge (nudge.css)', becomes: 'the dashed coral note', look: 'thin dashed frame, one line, the way out on the same line', where: 'the chat', crop: { url: '/v1/chat', selector: '.poster-nudge', user: 'second' } },
      { id: 'aside', name: 'The dashed coral note', code: '.poster-aside (poster.css)', becomes: 'this is the proposal', look: '3px dashed coral frame, card ground', where: 'organism settings and admin pages', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'The waiting note gets a thick dashed coral frame.' },
      { page: 'Chat', what: 'The phone suggestion gets a thick dashed coral frame.' },
    ],
    choice: {"proposal":null,"options":{"waiting-note":"accepted","nudge":"accepted","aside":"accepted"},"note":"Every look kept: one attention note with the three looks as its tones, no visible change (Jouni, in chat).","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
    choice: {"proposal":null,"options":{"poster-action":"accepted","fold":"accepted","rail-action":"accepted","back":"accepted"},"note":"The four accepted looks become tones of one action link; the rounded framed button becomes the underlined action link, the plain text button its text tone (Jouni, in chat).","decidedBy":"Jouni","decidedAt":"2026-09-23"},
  },
  {
    id: 'tabs-filters',
    counted: true,
    title: 'Tabs and filters: choosing what a list or a panel shows',
    question: 'Choosing one of a few views is drawn five ways: the home\'s task choice, the home\'s switch, outlined buttons, tabs and filter chips. Should they all be tabs?',
    proposal: {
      variant: 'poster-tab', name: 'Tabs, the chosen one on the sun',
      summary: 'Tabs everywhere: underlined words, the chosen one on the sun.',
      text: '.poster-tab with .is-on on the sun. The home switch already chooses on the sun; the mode tabs and the 25 admin filter rules become tabs.',
    },
    variants: [
      { id: 'chooser-choice', name: 'The home\'s task choice ("Remember something")', code: '.poster-action with .poster-fold--on (Chooser.js ChooserChoice)', becomes: 'tabs', where: 'the home: the task chooser', files: 1, crop: home('.poster-chooser-choices .poster-fold--on') },
      { id: 'fold-switch', name: 'The home\'s switch ("Recent", "Mine")', code: '.poster-fold, .poster-fold--on (fold-button.css)', becomes: 'tabs', where: 'the home: the apps switch', files: 2, crop: home('.poster-fold.poster-fold--on') },
      { id: 'mode-tabs', name: 'The agent step\'s two ways', code: '.poster-mode--on (mode-tabs.css)', becomes: 'tabs', look: 'outlined classic buttons; the chosen one in a coral outline', where: 'the home: the agent step', files: 1, crop: null },
      { id: 'poster-tab', name: 'Tabs ("Overview", "Tasks")', code: '.poster-tab, .is-on (poster.css)', becomes: 'this is the proposal', look: 'Archivo caps, 3px ink underline; .is-on on the sun', where: 'profile Agents, the agent card, Inbox, the setup guide', files: 4, crop: { url: '/v1/profile?tab=agents', selector: '.poster-tab' } },
      { id: 'adm-filter-chip', name: 'The admin filters ("all", "failed")', code: '.adm-hook-fchip and 24 copies', becomes: 'tabs; the chosen one stays on the sun', look: 'mono .72rem 500, 2px grey frame; the chosen one on the sun', where: 'about 25 admin pages', files: 25, crop: { url: '/v1/admin?tab=hooks', selector: '.adm-hook-fchip' } },
    ],
    changes: [
      { page: 'Home', what: 'The task choices, the apps switch and the agent step\'s two buttons become tabs.' },
      { page: 'Admin, about 25 pages', what: 'The framed filters become tabs; the chosen one stays on the sun.' },
    ],
    choice: {"proposal":null,"options":{"fold-switch":"accepted","poster-tab":"accepted","adm-filter-chip":"accepted"},"note":"The three accepted looks become one tab component; the agent step's two ways become the accepted tab (Jouni, in chat).","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
      { id: 'btn-primary', name: 'The coral rounded button ("Copy the prompt")', code: '.btn-primary (components.css)', becomes: 'the dark block', look: 'coral fill, rounded, white words', where: 'the home: Copy the prompt, the step buttons', crop: home('.poster-prompt .btn-primary', { user: 'second', eval: "document.querySelector('.poster-prompt .btn-primary').closest('details').open = true;" }) },
      { id: 'slab-control', name: 'The chat\'s dark block ("Send")', code: '.poster-slab--control (poster.css)', becomes: 'the dark block, in its control size', look: 'ink slab, paper words, 4px sun shadow, 44px high', where: 'the chat: Send, New conversation', crop: { url: '/v1/chat', selector: '.poster-composer-send' } },
      { id: 'slab', name: 'The dark block', code: '.poster-slab (poster.css)', becomes: 'this is the proposal', look: 'ink slab, paper words, 4px sun shadow', where: 'the demo card on the home', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'Copy the prompt and the step buttons become dark blocks with a sun-coloured shadow.' },
    ],
    choice: {"proposal":"accepted","options":{"btn-primary":"accepted","slab-control":"accepted","slab":"accepted"},"note":"Accepted the proposal and every option: the dark block everywhere.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
      { id: 'conversation-empty', name: 'The empty conversation list', code: '.poster-conversation-empty (conversation-frame.css)', becomes: 'the quiet sentence', look: 'grey body text', where: 'the chat', crop: { url: '/v1/chat', selector: '.poster-conversation-empty', user: 'second' } },
    ],
    changes: [
      { page: 'History', what: 'The "nothing here yet" sentence gets a little bolder.' },
      { page: 'Chat', what: 'The empty conversation list says so in the quiet sentence.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: one quiet grey sentence.","decidedBy":"Jouni","decidedAt":"2026-09-23"},
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
  // ── The home's and the chat's remaining own looks (Jouni, 2026-09-23: the next batch before Themes
  //    & Styles). Found by a scan of every captured state for buttons and links no library shape draws.
  {
    id: 'panel-action',
    title: 'Panel action: the button of a small panel',
    question: 'A small panel has its own button: "Take these into your AI chat", "Install", "Copy for my own AI", "Copy", "Try again", "It was right". They are drawn as the old rounded buttons, coral or framed. Should they become one?',
    proposal: {
      variant: 'proposal', name: 'The underlined action link',
      summary: 'Every panel button becomes the underlined action link in capitals; the dark block stays for the page\'s one big action.',
      text: '.poster-action. The classic .btn-primary / .btn-outline / .btn-ghost with .btn-sm go from these places.',
    },
    variants: [
      { id: 'open-items-copy', name: 'The open items\' button ("Take these into your AI chat")', code: '.btn-primary.btn-sm (CopyButton in OpenItemsList.js)', becomes: 'the underlined action link', where: 'the home: the open items panel', crop: home('.open-items-head .btn-primary') },
      { id: 'install', name: 'The install banner\'s button ("Install")', code: '.btn-primary.install-cta-install (InstallCta.js)', becomes: 'the underlined action link', where: 'the home and the chat, on a browser that offers to install the app', crop: null },
      { id: 'playbook-copy', name: 'The playbook\'s copy button ("Copy for my own AI")', code: '.btn-outline (status-parts.js)', becomes: 'the underlined action link', where: 'the home: an opened playbook', crop: home('.poster-index-actions .btn-outline', { click: '.poster-index-item' }) },
      { id: 'setup-copy', name: 'The setup guide\'s copy button ("Copy")', code: '.btn-ghost.btn-sm (CopyButton in McpInstall.js)', becomes: 'the underlined action link', where: 'the home: connecting your AI', crop: home('.btn-ghost.btn-sm', { click: '.poster-chooser-status button' }) },
      { id: 'retry', name: 'Try again, under a failed answer', code: '.btn-outline (Turn.js)', becomes: 'the underlined action link', where: 'the chat, when an answer failed', crop: null },
      { id: 'decide', name: 'The open items\' review buttons ("It was right", "It was wrong")', code: '.btn-outline.btn-sm (OpenItemsList.js)', becomes: 'the underlined action link', where: 'the home: an AI decision waiting for your review', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'The open items button, the review buttons, the playbook\'s copy button and the setup guide\'s copy button become underlined capitals instead of rounded buttons.' },
      { page: 'Chat', what: 'Try again becomes underlined capitals.' },
      { page: 'Home and chat', what: 'The install banner\'s Install becomes underlined capitals.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: every panel button becomes the underlined action link.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'step-state',
    title: 'Step button: before it is ready and after it is done',
    question: 'In the first steps, a button is the dark block while it is the next thing to do. Before that (nothing typed yet) and after it (already pressed) it turns into the old framed rounded button. Which look should those states have?',
    proposal: {
      variant: 'proposal', name: 'The underlined action link',
      summary: 'Before and after, the step\'s button is the underlined action link; only the next thing to do is the dark block.',
      text: '.poster-action for the waiting and done states (disabled keeps the browser\'s dimmed state); .poster-slab only when it is the next move. .btn-outline goes.',
    },
    variants: [
      { id: 'name-empty', name: '"That is its name" before a name is typed', code: '.btn-outline[disabled] (step-agent.js)', becomes: 'the underlined action link, dimmed', where: 'the home: the agent step, before an agent is connected', crop: home('button:has-text("That is its name")', { user: 'second', eval: "document.querySelectorAll('details').forEach(d => d.open = true);" }) },
      { id: 'mat-waiting', name: '"Here is my welcome mat" before anything is pasted', code: '.btn-outline[disabled] (step-mat.js)', becomes: 'the underlined action link, dimmed', where: 'the home: the welcome mat step', crop: home('button:has-text("Here is my welcome mat")', { user: 'second', eval: "document.querySelectorAll('details').forEach(d => d.open = true);" }) },
      { id: 'copy-done', name: '"Copy the prompt" after it was copied', code: '.btn-outline (PromptCard className, step-agent.js, step-mat.js)', becomes: 'the underlined action link', where: 'the home: the first steps, after copying', crop: null },
      { id: 'started-done', name: '"I have started it" after it was pressed', code: '.btn-outline (step-agent.js)', becomes: 'the underlined action link', where: 'the home: the agent step, step by step', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'In the first steps, a button that is not the next thing to do reads as underlined capitals instead of a framed rounded button.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: before and after, a step's button is the underlined action link, dimmed while it cannot be pressed.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'dismiss',
    title: 'Dismiss: waving a note away',
    question: '"Not now" on the phone suggestion and on the install banner is the old framed rounded button. Should it be one quiet word?',
    proposal: {
      variant: 'proposal', name: 'A plain grey word',
      summary: '"Not now" becomes a plain grey word, as Listen and Copy under a message are.',
      text: '.poster-action.poster-action--text. .btn-ghost goes from both.',
    },
    variants: [
      { id: 'nudge-dismiss', name: 'The phone suggestion\'s "Not now"', code: '.btn-ghost.poster-nudge-dismiss (Nudge.js)', becomes: 'a plain grey word', where: 'the chat', crop: { url: '/v1/chat', selector: '.poster-nudge-dismiss', user: 'second' } },
      { id: 'install-dismiss', name: 'The install banner\'s "Not now"', code: '.btn-ghost.install-cta-dismiss (InstallCta.js)', becomes: 'a plain grey word', where: 'the home and the chat, on a browser that offers to install the app', crop: null },
    ],
    changes: [
      { page: 'Chat', what: '"Not now" on the phone suggestion becomes a plain grey word without a frame.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: \"Not now\" becomes a plain grey word.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'icon-button',
    title: 'Icon button: a button that is a mark, not a word',
    question: 'Six buttons are a mark: the composer\'s attach and microphone, delete a conversation (✗), the dialog\'s close, the prompt card\'s more (⌄) and a card\'s menu (⋯). Each is drawn its own way. Should they share one?',
    proposal: {
      variant: 'proposal', name: 'A square in a thin dark frame',
      summary: 'One square in a thin dark frame that turns yellow under the pointer: large in the composer, small everywhere else. A card\'s menu keeps its coloured fill, which says that something is on it.',
      text: 'A new shape (lab-only .dl-icon now): 2px ink frame, square, the sun on hover; 44px (the composer\'s control size) and --small 28px. The card menu keeps its fill, which says a state.',
    },
    variants: [
      { id: 'composer-tool', name: 'The composer\'s attach and microphone', code: '.btn-outline.poster-composer-tool (Composer.js)', becomes: 'the large square', where: 'the chat: next to Send', crop: { url: '/v1/chat', selector: '.poster-composer-tool' } },
      { id: 'thread-del', name: 'Delete a conversation (✗)', code: '.btn-ghost.poster-thread-del (ThreadList.js)', becomes: 'the small square', where: 'the chat: the conversation list', crop: chatThread(0, '.poster-thread--active .poster-thread-del') },
      { id: 'dialog-close', name: 'The dialog\'s close', code: 'dialog.dlg .dlg-close (dialog.css, Modal.js)', becomes: 'stays as it is: it already is a framed square, drawn in the dark header\'s colour', where: 'the home: the settings dialog (and every dialog)', crop: home('dialog.dlg .dlg-close', { click: '.poster-masthead-button' }) },
      { id: 'prompt-more', name: 'The prompt card\'s more (⌄)', code: '.btn-ghost.poster-prompt-more (PromptCard.js)', becomes: 'the small square', where: 'the home: a prompt card with more ways to send it', crop: home('.poster-prompt-more') },
      { id: 'card-dots', name: 'A card\'s menu (⋯)', code: '.card-menu-dots (CardMenu.js)', becomes: 'the small square, keeping its coloured fill', where: 'the home: a card with actions', crop: home('.card-menu-dots') },
    ],
    changes: [
      { page: 'Chat', what: 'The attach and microphone buttons keep their square; delete becomes a small square.' },
      { page: 'Home', what: 'The prompt card\'s more and a card\'s menu become small squares in a thin dark frame. The dialog\'s close already is one and stays.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: one square in a thin dark frame, large in the composer, small elsewhere; the card menu keeps its fill.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'choice',
    title: 'Choice: picking one of a few settings',
    question: 'Picking one of a few is drawn three more ways: the setup guide\'s tools (rounded buttons), the settings dialog\'s background patterns (framed tiles) and its start page (a coral switch in plain system letters). Should they be tabs, as you decided for the rest?',
    proposal: {
      variant: 'proposal', name: 'Tabs, the chosen one on yellow',
      summary: 'Each of these becomes tabs: underlined capitals, the chosen one on a yellow ground.',
      text: '.poster-tab with .is-on. The setup guide already takes a tabClass (ai-setup-guide.js ToolPicker); the home passes nothing and gets .ast-tool.',
    },
    variants: [
      { id: 'setup-tools', name: 'The setup guide\'s tools ("Claude Desktop", "ChatGPT")', code: '.ast-tool, .ast-tool--active (hello-mcp.css, chooser.css)', becomes: 'tabs; "recommended" stays beside the name, in the tab\'s own text colour', where: 'the home: connecting your AI', crop: home('.ast-tool--active', { click: '.poster-chooser-status button' }) },
      { id: 'pattern-choice', name: 'The background pattern tiles ("Off", "Pixel grid")', code: '.poster-settings-pattern-choice, .active (SwatchPicker.js)', becomes: 'tabs', where: 'the home: the settings dialog', crop: home('.poster-settings-pattern-choice.active', { click: '.poster-masthead-button' }) },
      { id: 'start-page', name: 'The start page switch ("Home", "Settings & controls")', code: '.seg-btn, .active (StartPageSetting.js; the .pf rules do not reach the home)', becomes: 'tabs', where: 'the home: the settings dialog', crop: home('.seg-btn.active', { click: '.poster-masthead-button', around: '.start-page-seg' }) },
    ],
    changes: [
      { page: 'Home', what: 'The setup guide\'s tools, the pattern tiles and the start page switch become tabs.' },
    ],
    choice: {"proposal":"accepted","options":{"pattern-choice":"accepted"},"note":"Accepted the proposal (tabs), and accepted the background pattern tiles too: by Jouni's rule an accepted option keeps its look as a tone of the one component.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'suggestion',
    title: 'Suggestion: a message sent with one press',
    question: 'A suggestion is drawn in two ways: in capitals when the chat welcomes a new person, as a sentence when it follows an answer. Should they be one?',
    proposal: {
      variant: 'sentence', name: 'The sentence',
      summary: 'Every suggestion reads as a sentence, as the ones after an answer do.',
      text: '.poster-suggestion without --caps.',
    },
    variants: [
      { id: 'sentence', name: 'The suggestion after an answer ("A single column with your name large")', code: '.poster-suggestion (Suggestion.js Choices)', becomes: 'this is the proposal', where: 'the chat: under an answer that offers choices', crop: chatThread(2, '.poster-suggestion') },
      { id: 'caps', name: 'The welcome\'s suggestion ("Make my welcome page")', code: '.poster-suggestion--caps (Suggestion.js)', becomes: 'the sentence', where: 'the chat: the welcome for a new person', crop: { url: '/v1/chat', selector: '.poster-suggestion--caps', user: 'member' } },
    ],
    changes: [
      { page: 'Chat', what: 'The welcome\'s suggestions read as sentences instead of capitals.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: every suggestion reads as a sentence.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'menu-row',
    title: 'Menu row: one choice in an opened menu',
    question: 'An opened menu lists its choices in rows: the prompt card\'s other ways to send, a card\'s actions, a notification\'s actions. Each draws its rows its own way. Should they be one?',
    proposal: {
      variant: 'prompt-menu', name: 'The prompt card\'s menu row',
      summary: 'Every menu row as the prompt card\'s: plain words on a row with a thin line between rows.',
      text: '.poster-prompt-menu-item: left-aligned, .55rem .85rem, .85rem, a 1px --border line between rows. Moves to a shared part when accepted.',
    },
    variants: [
      { id: 'prompt-menu', name: 'The prompt card\'s menu rows ("Save as my own")', code: '.btn-ghost.poster-prompt-menu-item (PromptCard.js)', becomes: 'this is the proposal', where: 'the home: a prompt card\'s more menu', crop: home('.poster-prompt-menu-item', { click: '.poster-prompt-more' }) },
      { id: 'card-menu', name: 'A card\'s menu rows', code: '.card-menu-item (CardMenu.js)', becomes: 'the prompt card\'s row', where: 'the home: a card\'s menu', crop: home('.card-menu-item', { click: '.card-menu-dots', around: '.card-menu-list' }) },
      { id: 'notif-action', name: 'A notification\'s actions', code: '.notif-action-btn with .btn-primary/.btn-outline/.btn-ghost (NotificationBell.js)', becomes: 'the prompt card\'s row; "Approve" loses its coral, so every action reads the same', where: 'every signed-in page: the bell\'s list', crop: null },
    ],
    changes: [
      { page: 'Home', what: 'A card\'s menu rows read as the prompt card\'s menu rows.' },
      { page: 'Every page', what: 'A notification\'s actions read as menu rows instead of rounded buttons; "Approve" loses its coral.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: every menu row as the prompt card's.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'small-link',
    title: 'Small link: a quiet way on inside a part',
    question: 'Six small ways on are each drawn their own way: "What does that mean?", "Use your own key →", "Powered by goose", "Official instructions →", "Show older" and the jump to the latest message. Should they share one?',
    proposal: {
      variant: 'proposal', name: 'Small coral underlined words',
      summary: 'Each becomes small coral words in typewriter letters with an underline, as "Show all" under a list is.',
      text: '.poster-action.poster-action--more. The framed .btn-outline and .btn-ghost go from "Show older", the jump and "What does that mean?".',
    },
    variants: [
      { id: 'ai-more', name: '"What does that mean?" under the AI notice', code: '.btn-ghost.poster-ai-notice-more (AiNotice.js)', becomes: 'small coral underlined words', where: 'the chat: the side column', crop: { url: '/v1/chat', selector: '.poster-ai-notice-more' } },
      { id: 'status-link', name: '"Use your own key →"', code: '.poster-agent-status-link (AgentStatus.js)', becomes: 'small coral underlined words', where: 'the chat: the side column', crop: { url: '/v1/chat', selector: '.poster-agent-status-link' } },
      { id: 'credit-link', name: '"Powered by goose"', code: '.poster-credit-link (Credit.js)', becomes: 'small coral underlined words; the goose stays', where: 'the chat: the foot of the side column', crop: { url: '/v1/chat', selector: '.poster-credit-link' } },
      { id: 'setup-docs', name: '"Official instructions →"', code: '.ast-docs (ai-setup-guide.js)', becomes: 'small coral underlined words', where: 'the home: connecting your AI', crop: home('.ast-docs', { click: '.poster-chooser-status button' }) },
      { id: 'archive-more', name: '"Show older" under a record', code: '.btn-outline.poster-archive-more (ArchiveSection.js)', becomes: 'small coral underlined words', where: 'the history page', crop: null },
      { id: 'jump', name: 'The jump to the latest message', code: '.btn-outline.poster-conversation-jump (ConversationFrame.js)', becomes: 'small coral underlined words', where: 'the chat: when you have scrolled up', crop: null },
    ],
    changes: [
      { page: 'Chat', what: 'The side column\'s small links and the jump to the latest message read as small coral underlined words.' },
      { page: 'Home, history', what: '"Official instructions →" and "Show older" read the same way.' },
    ],
    choice: {"proposal":"accepted","options":{"ai-more":"accepted","jump":"accepted"},"note":"Accepted the proposal (small coral underlined words), and accepted \"What does that mean?\" and the jump too: by Jouni's rule those keep their looks as tones.","decidedAt":"2026-09-23","decidedBy":"Jouni"},
  },
  {
    id: 'dialog-actions',
    title: 'Dialog actions: the buttons in a dialog\'s footer',
    question: 'A dialog\'s footer takes the old button classes (Cancel, Save, Delete) and redraws them as underlined words and dark blocks with rules of its own. Should the footer use the library\'s action link and dark block instead, so each look is written once?',
    proposal: {
      variant: 'proposal', name: 'The library\'s own action link and dark block',
      summary: 'Cancel becomes the underlined action link, Save the dark block at its control size, and Delete a coral dark block; the footer stops redrawing the old classes.',
      text: 'Cancel: .poster-action (a 3px rule under the words instead of the footer\'s 2px text underline). Save: .poster-slab.poster-slab--control (the same look). Delete: a danger tone of the slab (coral with an ink shadow, as now). The dialog.css rules that restyle .btn-ghost, .btn-outline, .btn-secondary, .btn-primary and .btn-danger-solid go.',
    },
    variants: [
      { id: 'cancel', name: 'Cancel', code: '.btn-ghost in dialog.dlg .dlg-foot (dialog.css)', becomes: 'the underlined action link', where: 'every dialog: the home\'s settings, confirm questions, forms', crop: home('dialog.dlg .dlg-foot .btn-ghost', { click: '.poster-masthead-button' }) },
      { id: 'confirm', name: 'Save, the dialog\'s one big action', code: '.btn-primary in dialog.dlg .dlg-foot (dialog.css)', becomes: 'the dark block at its control size (no visible change)', where: 'every dialog with a form', crop: null },
      { id: 'danger', name: 'Delete, an action that cannot be undone', code: '.btn-danger-solid in dialog.dlg .dlg-foot (dialog.css)', becomes: 'a coral dark block (no visible change)', where: 'confirm questions that delete', crop: null },
    ],
    changes: [
      { page: 'Every dialog', what: 'Cancel gets the action link\'s thicker line under the words. Save and Delete look as they do now.' },
    ],
    choice: {"proposal":"accepted","options":{},"note":"Accepted the proposal: Cancel the underlined action link, Confirm the slab, Delete the slab's danger tone. \"I was thinking that hopefully the save button is the action button in general way that all the action buttons then looks like that.\" Save and Confirm are the loud action, the dark block.","decidedAt":"2026-09-24","decidedBy":"Jouni"},
  },
];

/**
 * What was built from each decision (the plan's 06-design-lab.md item 4, "The built results"): the
 * commit, whether it is on main, what changed in words, and every compared set of pictures: how many
 * were taken and how many changed. A set's other pictures are unchanged (0.00 %), and each changed
 * picture was checked to change only where the decided part is. `noise` counts the pictures of
 * Access, Statistics and Overview that move under 0.2 % between two runs of the same code (their
 * data is live). The before/after pictures themselves are files on the node that built them
 * (/img/design-lab/built.json, outside the repo like the crops).
 */
const set = (name, total, changed, noise = 0) => ({ name, total, changed, noise });
const HOME_CHAT = 'The home and the chat, every state, three widths, both modes';
const OTHER = 'Other pages: settings & controls, admin, catalog, help, legal, front';
const FORCED = 'Forced states: the install banner, a failed answer, a review waiting, menus opened, first steps';
const LAB = 'The lab\'s own pictures';
export const BUILT = {
  'agent-step-wrapper': { commit: 'bb57e3bc0', onMain: true, date: '2026-09-24',
    what: 'The agent step\'s name label and hint read in the body letters, and the name field is full width.',
    sets: [set(HOME_CHAT, 150, 0), set(FORCED, 72, 6), set(OTHER, 126, 0, 14), set(LAB, 68, 0)] },
  'panel-action': { commit: 'db8d69d95', onMain: true, date: '2026-09-24',
    what: 'Every panel button is the underlined action link: open items\' copy and review buttons, Install, the playbook\'s copy, the setup guide\'s copies, Try again.',
    sets: [set(HOME_CHAT, 150, 75), set(FORCED, 72, 54), set(OTHER, 126, 13, 18), set(LAB, 68, 2)] },
  'step-state': { commit: '43e5d7c60', onMain: true, date: '2026-09-24',
    what: 'In the first steps, a button that is not the next thing to do is the underlined action link, dimmed while it cannot be pressed.',
    sets: [set(HOME_CHAT, 150, 0), set(FORCED, 72, 30), set(OTHER, 126, 0, 18), set(LAB, 68, 0)] },
  dismiss: { commit: '69221fdf9', onMain: true, date: '2026-09-24',
    what: '"Not now" on the phone suggestion and the install banner is a plain grey word.',
    sets: [set(HOME_CHAT, 150, 64), set(FORCED, 72, 24), set(OTHER, 126, 0, 14), set(LAB, 68, 2)] },
  'icon-button': { commit: '5e9ae299a', onMain: true, date: '2026-09-24',
    what: 'Delete (✗), the card menu\'s dots and attach are the framed square; attach is dimmed while it cannot be used, as the microphone was.',
    sets: [set(HOME_CHAT, 150, 120), set(FORCED, 72, 42), set(OTHER, 126, 6, 14), set(LAB, 68, 8)] },
  choice: { commit: '66652c9bb', onMain: true, date: '2026-09-24',
    what: 'The setup guide\'s tools and the start page switch are tabs; the background pattern tiles keep their look as the tile tone.',
    sets: [set(HOME_CHAT, 150, 8), set(FORCED, 72, 24), set(OTHER, 126, 8, 14), set(LAB, 68, 4)] },
  suggestion: { commit: '0a800370d', onMain: true, date: '2026-09-24',
    what: 'The welcome\'s suggestions read as sentences, as the ones after an answer do.',
    sets: [set(HOME_CHAT, 150, 10), set(FORCED, 72, 6), set(OTHER, 126, 0, 16), set(LAB, 68, 2)] },
  'menu-row': { commit: 'b31c94c74', onMain: true, date: '2026-09-24',
    what: 'A card\'s menu rows and the bell\'s actions read as the prompt card\'s menu rows.',
    sets: [set(HOME_CHAT, 150, 0), set(FORCED, 72, 12), set(OTHER, 126, 0, 14), set(LAB, 68, 6)] },
  'small-link': { commit: '5a287a9a3', onMain: true, date: '2026-09-24',
    what: '"Use your own key", "Powered by goose", "Official instructions" and "Show older" are small coral underlined words; "What does that mean?" and the jump keep their looks as tones.',
    sets: [set(HOME_CHAT, 150, 42), set(FORCED, 72, 36), set(OTHER, 126, 6, 14), set(LAB, 68, 10)] },
  'dialog-actions': { commit: '350d5c91e and 203bd4ba9', onMain: true, date: '2026-09-24',
    what: 'In every dialog, the app catalog\'s too, a way out or a side door is the underlined action link, the one "do it" the dark block, and a delete the dark block\'s coral tone. The footers drew 10 different looks before and 3 after. "Change password…" at the start of the Edit profile footer became the action link too (your answer).',
    sets: [set('Ten dialogs opened on their pages, whole and footer, two widths, both modes', 88, 88),
      set('"Change password…": the Edit profile dialog, whole and footer, two widths, both modes', 8, 8),
      set(HOME_CHAT, 150, 0), set(FORCED, 72, 0), set(OTHER, 126, 1, 13)],
    note: 'Every dialog picture changed in its footer row only. On a phone the Edit profile dialog\'s dark block is a little narrower after the "Change password…" change, because the longer link takes more of the row. The one other page picture that changed is the settings landing on a phone, which differs by the same amount between two runs of the same code: it sometimes draws before its data arrives.' },
};

/**
 * Built work that no decision holds, shown under the decisions' summary with the same Built part.
 * Themes & Styles (07-themes-and-styles.md): what the move measured against the old code, what the
 * public pages did before and after, and the interactions with a theme's CSS worn.
 */
export const BUILT_WITHOUT_DECISION = {
  'themes-and-styles': { title: 'Themes & Styles', commit: 'f8ccbbab2, 75b6c808b, 10d4c2467 and edcd6f9da', onMain: true, date: '2026-09-24',
    what: 'The admin view Themes & Styles (Design group): a theme holds styles, component CSS and theme CSS; the look picker offers the themes and their styles; the six built-in looks are now the AIMEAT theme. Measured against the old code (origin/main) on the same data.',
    sets: [
      set('The move: the home, the account record and the chat in the six built-in styles, three widths, both modes', 108, 0),
      set('Public pages and the front page, signed out, with four looks kept in the browser', 96, 0),
      set('Public pages signed in (help, members, change log), with four looks kept in the browser', 72, 0),
      set('Signed in, "/" (it opens the home, which themes reach), with four looks kept in the browser', 24, 6),
    ],
    note: 'The 6 changed pictures are "/" with Harbour Day kept: the home wears the theme chosen, as intended; the old code does not know that style. With a theme\'s component CSS worn, the 21 driven steps of the home and the chat did the same as in the AIMEAT look (0 differences). The example theme Pebble was made from chat with the MCP tools only: one style for light and dark, the faces Fraunces and DM Sans, CSS for 39 components and a few lines of theme CSS. Its pictures come first below: AIMEAT on the left of the red line, Pebble on the right, same node, data and account.',
    // What the example theme reached on each page, and what it did not, with the reason.
    reach: [
      { page: 'Home', reached: 'All of it: the name and the picture, the section titles, the task tabs, the panels, the prompt card, the action links, the loud action, the notes, the settings dialog.', not: '' },
      { page: 'Chat', reached: 'All of it: the conversation list, the messages, the tool and result cards, the notes, the text field and Send, the side column.', not: '' },
      { page: 'Settings & Controls', reached: 'The top bar, the section titles, the labels, the loud actions, the action links, the open items, the boxes and notes drawn with the library.', not: 'The side menu, the step rows, the MCP and standalone badges and the avatar frame still use the page\'s own CSS (pf-*). Phases 5 to 7 move them to the library; then the theme reaches them.' },
      { page: 'Admin', reached: 'The top bar, the page and section titles, the labels, the buttons, the action links, the choices.', not: 'The dark side bar (only its chosen row follows the highlight colour), the metrics grid with its rules, the health table and the other tables still use admin\'s own CSS. Phases 5 to 7.' },
      { page: 'The app catalog', reached: 'Nothing yet.', not: 'Its screens are a separate build with their own CSS. Phase 9 (07, "Left").' },
    ] },
  'themes-shapes': { title: 'Themes & Styles, shape values', commit: 'not committed yet', onMain: false, date: '2026-09-24',
    what: 'A theme\'s corners, frames, shadows and letter case are now its shape values (theme.css --shape-*), and the component sheets read them instead of writing their own. A theme sets them once, in the Shapes tab or with aimeat_theme_save, and a component added later follows them. Pebble was remade on them from chat with the MCP tools only. Jouni: "katsoo että pebble syntyy myös niille uusille tehdyille komponenteille mitä tullaan tekemään kun tehdään settings & controls kirjastoon."',
    sets: [
      set('The move, AIMEAT: the home and the chat, every state, three widths, both modes', 150, 0),
      set('The move in the six built-in styles (A3): the home, the account record, the chat', 108, 0),
      set('The move on Settings & Controls and admin, AIMEAT', 42, 0),
      set('Pebble remade on the shape values, against the Pebble of 131096f2a: the home and the chat', 150, 0),
      set('Pebble remade, Settings & Controls and admin', 42, 0, 6),
    ],
    note: 'Of Pebble\'s 39 entries of component CSS, 36 are left, and they are smaller: 222 declarations became 153, and 23 shape values carry the rest. Three went whole (the rule over a row, the text field, the open items). Seven of the 36 are the classic shell\'s older parts (button, card, badge, form field, tags, the card menu, the install card), which read no shape value yet; the rest keep only what is one component\'s own: the fill of the main button and its danger tone, the action link\'s underline, the tabs\' pill ground, a section title\'s side bar, the panels\' ground, a few corners that differ (a record 20px, a step 18px, a choice 14px). Theme CSS went from 6 declarations to 3 (the selection and the focus ring). The shape literals still written in the component sheets fell from 181 to 117; check:shape-tokens holds that number and lets it only fall. The 6 not at 0.00 % on admin are its uptime line, which changes between any two runs. Found: the old Pebble hid two states by accident, the card menu\'s state frame (open, working) and a result card\'s coloured kind edge; the remade Pebble keeps them hidden so it stays the same, and one line each would show them.',
    values: { title: 'Pebble\'s shape values (the built-in value in the grey line)', rows: [
      ['Corner of a box, a panel or a card', '16px', 'built-in 0'], ['Corner of a field or a small control', '12px', 'built-in 0'],
      ['Corner of the main button, a tab and a count', '999px', 'built-in 0'], ['Corner of a dialog and an open menu', '22px', 'built-in 0'],
      ['Frame of a box or a control', '1px', 'built-in 2px'], ['Heavy frame and line', '1px', 'built-in 3px'],
      ['Colour of a box\'s frame', 'var(--card-border)', 'built-in var(--text)'], ['Colour of a line and a control\'s frame', 'var(--border)', 'built-in var(--text)'],
      ['Colour of a field\'s frame', 'var(--control-border)', 'built-in var(--text)'],
      ['Shadow of a box', 'two soft shadows in 6 % and 8 % of the text colour', 'built-in none'],
      ['Shadow of a record and an open menu', '0 12px 32px, 10 % of the text colour', 'built-in 8px 8px 0 sun'],
      ['Shadow of a dialog', '0 24px 64px, 28 % of the text colour', 'built-in 12px 12px 0 sun'],
      ['Shadow of the main button, and under the pointer', '0 6px 16px, 35 % and 45 % of the accent', 'built-in 4px 4px 0 and 2px 2px 0 sun'],
      ['Shadow of a chosen choice', '0 6px 16px, 30 % of the accent', 'built-in 4px 4px 0 ink'],
      ['Letter case of headings, actions and tabs, labels', 'none', 'built-in uppercase'],
      ['Weight, letter spacing and line height of headings', '600, -0.01em, 1.1', 'built-in 400, .01em, 1'],
      ['Letter spacing of actions and tabs, and of labels', '0 and 0', 'built-in .04em and .1em'],
    ] } },
};
