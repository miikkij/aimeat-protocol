/**
 * @file public/views/design-lab/built-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What was built, for the lab's "Built" parts: per decision (BUILT) and for built work no
 *   decision holds (BUILT_WITHOUT_DECISION). Moved unchanged out of decisions-data.js, which was near
 *   the 800-line limit; the lab reads it beside the decisions. Plain data, no imports.
 * @structure BUILT — { [decisionId]: { commit, onMain, date, what, sets: [{ name, total, changed, noise }], note? } }
 *   BUILT_WITHOUT_DECISION — { [id]: the same, with a title }
 * @usage import { BUILT, BUILT_WITHOUT_DECISION } from '/views/design-lab/built-data.js';
 * @version-history
 *   v1.0.0 — 2026-09-25 — Moved out of decisions-data.js unchanged (a move).
 */

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
  'settings-moves': { title: 'Settings & Controls: the parts that stay as they are', commit: 'bed7026a7, bc8526ba7 and 3bc1ad4b3', onMain: false, date: '2026-09-25',
    what: 'Three moves, nothing changes on screen (Jouni, 2026-09-25: "Moves first: everything drawn one way becomes a library component, 0.00 %"). The rules that drew nothing went from the Settings sheets (1,138 of them). The frame of Settings & Controls is two library parts: the frame (the side column, the content, the phone menu) and the side menu. The page kit that 26 tabs, the organism pages and the admin draw is eleven library parts: the page, the crumb trail, the page head, the figure strip, the section, the folded rows, the setting box, the fields and the table of spaces. Measured against the old code (origin/main) on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 0),
      set('Admin, all 49 tabs, and an organism\'s home, which draw the same kit', 300, 6, 54),
    ],
    note: 'The 6 changed admin pictures are this lab, whose library now shows the new parts. The 54 others that moved are live numbers that change between any two runs (the restart time, request counts, an edition number, next-run times). Found on the way and kept as they were, because a move changes nothing: two rules the browser never used, because a comment closed early (a quota line on the overview, the frame of an agent\'s activity chart), and one value no theme value holds yet (the contents rail\'s smaller shadow on a phone). Fixed on the way: the cut of the page kit first put the kit\'s door rule after the fold row\'s, and the file rows\' links grew; the proof caught it and the order is back.' },
  'settings-unifications': { title: 'Settings & Controls: the looks you already decided', commit: 'e491f99f9, cf8e576a7, 3224d5d2c and 3ca55b926', onMain: false, date: '2026-09-25',
    what: 'Your decisions of 2026-09-23 said "everywhere", and Settings & Controls now wears them. Every tab, filter and choice is the Tab (decisions "Tabs and filters" and "Choice"): the chosen one on sun, the others underlined, a filter smaller; a choice that cannot be used now is dimmed. Every empty line is the quiet sentence ("Empty line"): the dashed boxes and the italic lines went. Every row of a "…" menu is the menu row ("Menu row"), and Delete keeps its coral as the menu row\'s danger tone. Measured against the state after the moves, on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 204, 6),
    ],
    note: 'The 204 changed pictures are 34 tabs, and each one changed where it has tabs, filters, an empty line or a menu: skills, usage and nodes were checked side by side. A row of filters that was one line can now take two, because a filter takes more room than the old small box. The 6 in noise are the Edit profile dialog: the two runs opened it over different tabs, and the dialog did not open, so these pictures prove nothing; the capture is fixed for the next runs. Two things lost a look that meant something, and are back as tones: Delete in a "…" menu keeps its coral, and a choice that cannot be used is dimmed. Two things lost a look that meant something and are not back yet: the Access filter "unused" was coral, and the Data wallet\'s filters were dimmed when empty.' },
  'settings-actions': { title: 'Settings & Controls: the buttons, by the looks you already decided', commit: '3af1a7964, cec21156c, 8e002e4af and aff7a68e5', onMain: false, date: '2026-09-25',
    what: 'Every loud action is the dark block with the sun shadow ("Loud action"). Every quiet way on is the underlined action link ("Action link", "Panel action", "Dismiss", "Small link", "Step button"), and a delete or revoke link keeps its coral as the action link\'s danger tone. Every mark button (✗, the dots, a close) is the framed square ("Icon button"). Measured against the step before (the tabs, empty lines and menu rows), on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 216, 6),
    ],
    note: 'Built at the action link\'s full size, which is the one question for you here (the decision "Settings door"): Settings drew its small links (Open, Edit, All as keys) smaller than the action link, in about 900 places, so rows are taller now and a page head with several links can wrap (Messages: the count of conversations moved under the title). If you choose the small size, it becomes a tone of the action link and these rows go back to their old height. The 6 in noise are the Edit profile dialog, which the step before did not open (see the entry above).' },
  'settings-labels': { title: 'Settings & Controls: labels, headings over lists and times, by the looks you already decided', commit: 'db085982a, 25b5f261d and a5388deee', onMain: false, date: '2026-09-25',
    what: 'Every row label and column head is the Row label, about 690 places ("Row label"). Every heading over a list is the Group heading, 44 places ("Group heading"); the four over a record of what was done ("Recent runs", "Retired", "Recent decisions", "Dispatches") are its grey tone. Every time a thing happened is the Timestamp, 49 places ("Timestamp"). Measured against the step before (the buttons), on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 176),
    ],
    note: 'Most pictures move by a few pixels: a label now has the library\'s line height, so the rows under it sit a little higher (Libraries, the largest, 6 %). Kept because they mean something: an expiring key\'s coral time, the time on a chosen row, the green "seen today", a dimmed key. Left as they were: big "time ago" figures and dates shown as figures, the day divider in Messages, dates inside sentences, and the grey capital labels of the agent and memory pages, which the decision did not name.' },
  'settings-text': { title: 'Settings & Controls: hints, leads, inline code and a form\'s answer, by the look most tabs use', commit: '1d4c007dc, c37fa201a, 6ab16d1f3, 53ab54db6, d7522535f and 4b0b67999', onMain: false, date: '2026-09-25',
    what: 'No decision holds these; each takes the look most tabs already draw (your words of 2026-09-25: "when a kind of thing has a look that most pages already use, take that look yourself"). A hint is one Hint, about 260 places: small grey words, the look of 21 tabs; the hints on the home and in Themes & Styles are that look too. The paragraph that opens a section is one lead, about 60 places. Code inside a sentence is one inline code, about 40. The line a form says after it acted is one form message, green, or coral for a refusal. Measured against the step before (the labels), on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 172),
    ],
    note: 'Most pictures change in the size of the grey help lines. Access and Data wallet changed most in this step because their section openings were first made hints; they are leads again (4b0b67999), and the next entry\'s numbers carry that correction. A block of code is not built: its three looks are used about equally, so it is a question in this round ("Code block").' },
  'settings-tags': { title: 'Settings & Controls: tags, states and counts, by the looks you already decided', commit: '4cf8231ff, 935b16293 and 3ea2b7178', onMain: false, date: '2026-09-25',
    what: 'Every tag is the Tag, about 160 places, in the tone its meaning asks: sun for "you" and "public", coral for "guest", "anyone" and a broken rule, plain for a kind, a role or a version ("Tag"). Every word that says a state is the Status: green is fine, sun is attention, coral is danger, grey is off ("Status"). Every small number is the Count: waiting for the unread and the requests, tally for the rest; the side menu\'s counts are waiting ("Count"). Measured against the step before, on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 204),
    ],
    note: 'Access and Data wallet changed most because this step also puts their section openings back to the lead (see the entry above). Tones chosen by meaning that you may want to see: a running task, a draft and a basic readiness are attention; an offline federation server is danger; a waiting delivery is off. A tag on the sun in Messages keeps dark words, because in dark mode the words would be near white on yellow.' },
  'settings-heads': { title: 'Settings & Controls: the older tabs\' heads and section openings, by the look most tabs use', commit: '2178bd94e, 55350b175 and 958229512', onMain: false, date: '2026-09-25',
    what: '27 tabs draw the kit\'s head: the crumb trail over the title and its line. The 12 older tabs (your agents, ecosystem apps, chat sessions, usage, P&L, organisms, notebook, living docs, work, services, federation, security) now draw it too, with the full trail ("Settings & Controls / Information / Notebook"). Their sections open with the kit\'s section title and its lead, as 28 tabs do. Measured against the step before (the tags), on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 72),
    ],
    note: 'Every changed picture is one of the 12 older tabs. A section title in those tabs is now the kit\'s title, as wide as its words, where it was a bar across the page. Two things are questions in this round: the Nodes page (its crumb sits over a row of tabs, and the kit\'s head has no place for that row) and the small heading inside a section ("Sub-heading": no look holds most tabs).' },
  'settings-parts': { title: 'Settings & Controls: boxes, notes, switches, figures and pictures', commit: 'f76e9a355, 68e380d5c, ad0cbab9f, b261b9441 and ceddb72b1', onMain: false, date: '2026-09-25',
    what: 'A framed box around one thing is the Object box, in the tone its look already was; nothing changes on screen ("Object box"). A note that asks you to look or act is the Attention note: the dashed coral note, solid where an act cannot be undone ("Attention note"). An on/off switch is one Switch, the look of Notifications, Email and Messages; Knowledge and MCP change. A row of big numbers is the figure strip (Usage, Node stats, the agent pages). A picture of a person or a thing is the framed square (Organisms, Messages). Measured against the step before, on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 88),
    ],
    note: 'Most of the 88 are the older tabs\' longer crumb trail from the step before; the rest are Node stats and Usage (the figure strip), Organisms (the pictures) and MCP (the switch). In dark mode the switch\'s knob on the sun is now dark, as a word on the sun is. A question in this round: "Box", because two box looks are used about equally.' },
  'settings-fields': { title: 'Settings & Controls: fields, drop-downs and the search line, by the look most tabs use', commit: '46c91bed6, 7d6bfcf87, 53bca2386 and 26d0c4c15', onMain: false, date: '2026-09-25',
    what: 'A one-line field is the underlined field (24 tabs drew it), 132 places. A many-line field is the framed area (21 tabs), 57 places. A drop-down is one framed Select field (all 23 tabs framed it; a new library part), 95 places. A search over a list is the Search line, 22 places. Measured against the step before, on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 43),
    ],
    note: 'Most fields sit inside forms that the pictures do not open, so few pictures change: P&L\'s month fields are now underlined, Notebook\'s writing box now stays inside the page column (it ran past its right edge). A drop-down\'s whole frame turns coral when you are in it. A question in this round: the check box line ("Check box"), whose words are body size in about 8 tabs and small in about 8.' },
  'settings-lists': { title: 'Settings & Controls: lists, rows that open, and named values, by the look most tabs use', commit: 'f539254b5, 20618fe33, cff87ed37, 509bf0394, b12475e6f and f304a5d69', onMain: false, date: '2026-09-25',
    what: 'A list of things, one per row with a rule between rows, is one Listing, about 60 lists in 26 tabs (29 tabs drew ruled cells). A row that opens in place is one folded row (27 tabs). Named values, a label on the left and its value on the right, are one Facts, about 30 places (21 tabs). Two small ones on the way: the figures of AI transparency, compliance and the wallet\'s shares are the figure strip, a figure that warns or says "Verified" keeps its colour; the organism source search is the Search line. Measured against the step before (the fields), on the same data.',
    sets: [
      set('Settings & Controls: 41 tabs, the overview, the phone menu open and the Edit profile dialog, three widths, both modes', 264, 109),
    ],
    note: 'Every list keeps the phone view it had: a list that kept two columns on a phone keeps them (23 tabs did that). What changes on a phone is the gap between the parts of a row, which is the Listing\'s smaller gap, so pages are shorter (Access by 341 pixels, Agents by 404). In a row, the name now stands in the middle of the row\'s height, and the rule under each cell is the Listing\'s. Tiles and ruled pairs of values lose their tiles and rules. Found and fixed: a key space\'s page drew each key in the narrow number column, one letter a line. Found and left (already so on main): on a phone the Sessions head "SESSIONS" in Access is cut at the right edge, and a workflow\'s "Test run" button runs past its panel. A question in this round: the grey line under a name ("Meta line"), typewriter in 23 tabs and the body face in 22.' },
  'settings-own-parts': { title: 'Settings & Controls: the parts each page drew alone', commit: 'the 118 commits from e2e7fed33 to e778160a9, each named move or unification', onMain: false, date: '2026-09-25',
    what: 'What was left after the common kinds: the parts only one page draws. Each became a library part by a move, unchanged on screen: about 60 of them (a calendar of activity, the document tree, file previews, the offer map and lines, the workflow steps, the score chart, the model picker, the prompt versions, the week rhythm, the JSON view, the to-do list, the crew\'s task order, the device list, and more). Where a part was a copy of a common kind, it took that kind\'s library look: hints, empty lines, tags, states, counts, the choice tile, the "show more" link, the meter, the pressed toggles as tabs. Measured step by step against the step before, on the same data.',
    sets: [
      set('The second kit tabs (contacts to companies): moves and unifications', 264, 46, 6),
      set('Organisms, memory, notebook, living docs', 264, 12),
      set('The agent pages', 264, 12),
      set('The first kit tabs (calibrator to access)', 264, 42),
      set('Five small ones: the AI budget meter, the pressed toggles, the pressed icon button, the count in a chosen tab, two moves', 264, 54),
    ],
    note: 'Each move was compared before and after on its own tabs and is 0.00 %, apart from the top bar\'s live name and counts. The pictures that changed are the unifications: the ways to choose in Knowledge, Workflows and the calibrator are the choice tile; a pressed toggle is a tab, dark on the sun; the AI budget bar is the meter, coral from 90 %; a count in a filter is the Count (the filter row is 5 pixels taller, so Libraries\' long page shifts). In the second kit set, 6 of the 46 are a morning digest the sandbox\'s own agent delivered at 06:00, which is data. The moves carried 15 rounded corners and 1 shadow into library sheets, where the shape check now counts them: a question in this round. Found and left (already so on main): a long action link runs past its choice tile in Knowledge ("Copy the prompt for an agent").' },
  'settings-last-parts': { title: 'Settings & Controls: the last parts, and every loading line', commit: 'the 75 commits from the wave 4 branches, up to d55323c1f, each named move or unification', onMain: false, date: '2026-09-26',
    what: 'The places the earlier waves did not reach. Every "loading" line carries the blinking mark, as most tabs drew it (25 tabs against 16 with the spinner). The ecosystem apps, an agent\'s schedules, the key rules, pending invitations, notebook hits and living templates are Listings; the classic model picker is the Model picker; the overview\'s usage rows are folded rows; the scope dialog\'s parts, the calibrator\'s and the workflow form\'s last own looks took their library parts; an agent\'s mark in a list is the avatar\'s agent tone; an identifier in a list is one Key part. About 20 more parts only one page draws became library parts by moves (the organism row, the record row, comments, the timeline, app cards, the people list, the requirement list, the figure door, the drag grip, and more). Measured step by step, on the same data.',
    sets: [
      set('The agent pages and the kit tabs\' last parts, with the classic tabs of wave 3', 264, 84),
      set('The classic tabs\' last parts and the loading lines', 264, 12),
      set('Organisms, memory, notebook, living docs', 264, 12),
    ],
    note: 'Of the rules in the Settings sheets that still draw their own look, 994 are left (2,075 before wave 3). Most wait for this round\'s answers (box, meta line, sub-heading, code block, check line and the others) or for Messages; 73 serve only code no page loads (a question for you: may that code go). Found and fixed on the way: a rule for the ecosystem card\'s title never applied, because a comment closed early. The overview\'s head and next steps did not change (their question is in this round).' },
  'settings-answers': { title: 'Settings & Controls: your answers to the round', commit: 'de1407f0c, then d9755010f, 9ad87fcfd, a3b2c3fc8 and 94f7a7b23 (24 commits, one per answer)', onMain: false, date: '2026-09-26',
    what: 'Your twenty answers of 2026-09-25 and 2026-09-26, built. The overview\'s head is the home\'s Masthead and its next steps the home\'s numbered list, as are the eight lists of steps in Settings. Messages draws the chat\'s conversation list, message and typing box (the read marks stay). A small way on in a Settings row or head is the action link\'s small, lower-case or row tone. Every box is the Object box, with a raised tone for the thing that stands out. Small headings, the Nodes head, a check box\'s words, the grey line under a name, code, the small reader, stars, logs, the remove mark and the question box take the looks you chose; the MCP guide keeps its own classic look. The corners and shadows the moves carried into the library read the shape values, square and flat like everywhere else. The code no page loaded is gone. Measured step by step, on the same data.',
    sets: [
      set('The removal of the code no page loaded (8 files, 2 functions, 87 rules)', 264, 0),
      set('Messages, the overview\'s head, the numbered lists', 264, 30),
      set('Box, small links, sub-heading, Nodes head, question box, dashed field box', 264, 198),
      set('Stars, activity log, remove mark, the square corners, the JSON view, the meter figure', 264, 6),
      set('Code block, meta line, check line, small reader, MCP guide, file pick list', 264, 84),
    ],
    note: 'The removal changed nothing on screen, as it should. The small links made rows lower again, so long pages are shorter (Libraries by 1,349 pixels). Many answers change places the pictures do not open (a folded section, an opened row, a dialog, Messages\' conversation); each builder pictured those on its own sandbox, and the commit bodies list them. The first next step on the overview\'s sun is readable now in dark mode. Three small places were left for you (they need a look nobody decided): a suggested reply waiting for your approval in Messages (on your own message\'s sun it would read as sent), the Notifications action row\'s coral main button, and the stars in an Offers delivery row (the library\'s stars do not fit its narrow column).' },
  'settings-pebble': { title: 'Settings & Controls in Pebble', commit: 'ef8536526 (the last lists), then 34306480f to 1edc2b375 (19 commits)', onMain: false, date: '2026-09-26',
    what: 'Your order: first all of Settings & Controls on components, then Pebble once, and a list of what does not follow it. Pebble was loaded into the sandbox once, and all 44 Settings routes were pictured in it (264 pictures). About 25 things did not follow. Most were a frame drawn in the text colour where a shape colour exists, the old Settings field rules that beat the library fields, and a corner on a row that has only a line under it. Each is fixed by reading the shape value whose AIMEAT value is the same, so AIMEAT does not change. The last lists that waited for the meta line answer are Listings, and a schedule\'s runs are the Timeline (your "Activity log" answer).',
    sets: [
      set('The last lists (Discover, Boards, Knowledge, Offers, Scheduler, Workflows, Contacts, Capabilities)', 264, 30),
      set('The Pebble fixes, in AIMEAT: nothing may change', 264, 6),
    ],
    note: 'The 6 in the second set are the Edit profile dialog: the pictures now open it (the Masthead changed the button that opens it), and before they did not; the other 258 are 0.00 %. In Pebble, each fix was pictured before and after on the same data. Left, because it would change AIMEAT or needs your word: the figure strip\'s 800 weight, the contents rail\'s 6 px phone shadow, the classic cards that Settings flattens into sections, the dark ground of the contents rail and the portfolio thumbnail, the phone Menu button, the top bar\'s small rounded corners, whether a theme may reach the MCP guide, and Pebble\'s own band on the overview, where three figures are the band\'s blue.',
    reach: [
      { page: 'Every page', reached: 'The faces, the colours in light and dark, the section titles, the loud action, the lists, the boxes, the counts, the meters, the dialog frame, the side menu, the top bar\'s pill, the tags, the action links.', not: 'The top bar\'s language switch and menu button keep small rounded corners (Pebble has no CSS for them). On a phone, the Menu button and the contents rail\'s shadow keep AIMEAT\'s look.' },
      { page: 'The kit tabs', reached: 'The page head, the crumb, the figure strip, the sections, the fields, the facts, the lists.', not: 'The contents rail keeps its dark ground (a colour value would let a theme change it); the figure strip\'s words stay at weight 800.' },
      { page: 'The older tabs', reached: 'The heads, the sections, the lists, the boxes.', not: 'The classic cards stay flat sections: Settings\' own rule beats a theme\'s card.' },
      { page: 'Overview', reached: 'The Masthead, the next steps, the usage rows.', not: 'Pebble\'s band draws three of its four figures in the band\'s own blue, so they cannot be seen (Pebble\'s own CSS).' },
      { page: 'Agents, MCP', reached: 'Everything but the MCP guide.', not: 'The MCP guide keeps its classic look, as you chose; whether a theme may reach it is your call.' },
    ] },
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
  'themes-shapes': { title: 'Themes & Styles, shape values', commit: '82af1acc4 (and the two states shown in Pebble)', onMain: true, date: '2026-09-24',
    what: 'A theme\'s corners, frames, shadows and letter case are now its shape values (theme.css --shape-*), and the component sheets read them instead of writing their own. A theme sets them once, in the Shapes tab or with aimeat_theme_save, and a component added later follows them. Pebble was remade on them from chat with the MCP tools only. Jouni: "katsoo että pebble syntyy myös niille uusille tehdyille komponenteille mitä tullaan tekemään kun tehdään settings & controls kirjastoon."',
    sets: [
      set('The move, AIMEAT: the home and the chat, every state, three widths, both modes', 150, 0),
      set('The move in the six built-in styles (A3): the home, the account record, the chat', 108, 0),
      set('The move on Settings & Controls and admin, AIMEAT', 42, 0),
      set('Pebble remade on the shape values, against the Pebble of 131096f2a: the home and the chat', 150, 0),
      set('Pebble remade, Settings & Controls and admin', 42, 0, 6),
    ],
    note: 'Of Pebble\'s 39 entries of component CSS, 36 are left, and they are smaller: 222 declarations became 151, and 23 shape values carry the rest. Three went whole (the rule over a row, the text field, the open items). Seven of the 36 are the classic shell\'s older parts (button, card, badge, form field, tags, the card menu, the install card), which read no shape value yet; the rest keep only what is one component\'s own: the fill of the main button and its danger tone, the action link\'s underline, the tabs\' pill ground, a section title\'s side bar, the panels\' ground, a few corners that differ (a record 20px, a step 18px, a choice 14px). Theme CSS went from 6 declarations to 3 (the selection and the focus ring). The shape literals still written in the component sheets fell from 181 to 117; check:shape-tokens holds that number and lets it only fall. The 6 not at 0.00 % on admin are its uptime line, which changes between any two runs. The old Pebble hid two states by accident, the card menu\'s state frame (open, working) and a result card\'s coloured kind edge. On Jouni\'s word ("they are information, and hiding them changes what the page does") the remade Pebble shows them: those are the only pictures that differ from the old Pebble (the home\'s "…" buttons, 0.01-0.02 %; the chat\'s result card, 0.09-0.32 %), and the numbers above were measured before that.',
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
