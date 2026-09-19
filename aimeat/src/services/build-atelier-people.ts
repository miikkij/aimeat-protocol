/**
 * @file src/services/build-atelier-people.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two sections of the Atelier build specification that are about the PERSON and not
 *   about the page: what is proposed to the owner before any code, and how a forked genre signs
 *   people in and speaks two languages. Their own file because build-atelier-prompt.ts is near the
 *   800-line limit, and because both came out of one afternoon.
 *
 *   WHY. 2026-09-19, three builds in a row handed to the developer and rejected:
 *     - A genre is a finished STATIC page. It has no sign-in, no language switch and one language
 *       (22 of the 23 declare `aimeat-locales` "en"; none declares scopes). The specification said
 *       "fork a genre, swap the words, keep the physics" and nothing about how the fork gets a
 *       sign-in bar or a second language, so every builder invented it: one wrote the header by
 *       hand and shipped it broken, one declared `content="fi"` and wrote every string in Finnish
 *       straight into the markup, which removes the language switch from the sign-in bar.
 *     - Nobody proposed anything. The interview asks five questions and its third one says "map
 *       the answer to a LOOK", which is the road to the default look with components stacked in
 *       it. The owner was never shown a genre to choose, and found out what had been chosen by
 *       looking at the result.
 *   THE PATTERN BELOW WAS RUN BEFORE IT WAS WRITTEN DOWN: published to a sandbox node and driven in
 *   a browser at 390 px. The bar mounted, the switch moved `<html lang>`, the page's own strings
 *   and the bar's own label from English to Finnish and back, with no horizontal overflow.
 * @structure ATELIER_PROPOSAL_SECTION · ATELIER_FORK_PEOPLE_SECTION
 * @usage import { ATELIER_PROPOSAL_SECTION, ATELIER_FORK_PEOPLE_SECTION } from './build-atelier-people.js';
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */

/** After the interview, before the body. Not part of the spec token: it is about the conversation. */
export const ATELIER_PROPOSAL_SECTION = '## Then propose, and wait for the answer\n\n'
  + 'Before any code, show the owner what you are about to build, in their words, and wait. They decide from this; they must not find out what you chose by looking at the result.\n\n'
  + '- **Two or three genres, named, each with one sentence on why it fits THIS app** and what the first screen would look like in it. Get them from the genre list (part `genre`, or `aimeat_designbook_search { kind: "genre" }`), and look at the owner\'s own apps first (`aimeat_app_list`): the ones already on Atelier show what they like. Say which one you would take. A look preset with components stacked in it is not on this list: that is the default page every app looks like, and it is what gets sent back.\n'
  + '- **Fixed colours or following their theme?** Ask it, or recommend one and say why. A fixed genre keeps its own colours in light and dark; a following page changes with the person\'s theme and palette. Part `genre` says which each genre is and gives an address for each (`See it`), and the whole shelf is one link: send the owner the links so they choose by looking. If they want a genre that is fixed and want it to follow the theme, say that it means moving its colours to the theme\'s tokens, and that you will show it in both modes before they decide.\n'
  + '- **What you take from the Design Book.** Look before you make (`aimeat_designbook_search`, part `libraries`): layouts, fills, looks, motion, ambients and effects that each passed their own bench, adopted in one call. Name the parts you will use. What you have to make because the book lacks it goes INTO the book after the publish (`aimeat_designbook_propose`), so the next app starts from it.\n'
  + '- **The languages: English and Finnish, unless they say otherwise.** Two languages is the default on this node. The language you are talking in is not the app\'s language list. Building for one language is the owner\'s decision, so ask it as a question if you think one is right, and do not decide it.\n'
  + '- **Who signs in**, and what is kept for them. An app nobody signs in to says so here.\n'
  + '- **The first screen in one or two sentences**: what the person sees and does first. If that sentence is "a header and some cards", you have not designed it yet.\n\n'
  + 'Offer it as choices the owner can answer with a word. If they said "just build it", still say in one line which genre and which languages you are taking, so they can stop you. Then build on the Atelier track:\n\n';

/** In the body, right after the genre section, so it travels in part `genre`. */
export const ATELIER_FORK_PEOPLE_SECTION = '## A fork people sign in to, in two languages\n\n'
  + 'A genre is a finished page with no sign-in, no language switch and its words in one language. Your fork adds all three, the same way every time. Do not write a header or a sign-in control of your own: the bar below is the node\'s, it carries the language switch and the light and dark control, and a hand-made one is the first thing a review sends back.\n\n'
  + '**Two languages is the default: `en fi`.** Keep both unless the owner asked for one. Every word the page shows goes through a dictionary; a string typed into the markup is a string that cannot change language, and a page where the bar is Finnish and the content English is refused at review.\n\n'
  + '```html\n'
  + '<!-- head: the languages you ACTUALLY carry, and every scope the app uses -->\n'
  + '<meta name="aimeat-locales" content="en fi" />\n'
  + '<meta name="aimeat-scopes" content="memory:read memory:write" />\n\n'
  + '<!-- body: a place for the bar inside the genre\'s own top line, and text by key -->\n'
  + '<div id="pill"></div>\n'
  + '<h1 data-t="title"></h1>\n\n'
  + '<script src="/v1/libs/aimeat-auth.js"></script>\n'
  + '<script src="/v1/libs/aimeat-atelier.js"></script>\n'
  + '<script>\n'
  + '  var i18n = AIMEAT.atelier.i18n;\n'
  + '  i18n.use({\n'
  + '    en: { title: \'Tip calculator\' },\n'
  + '    fi: { title: \'Tippilaskuri\' },   // written in Finnish, not translated word for word\n'
  + '  });\n'
  + '  function paint() {\n'
  + '    document.documentElement.lang = i18n.lang();\n'
  + '    document.querySelectorAll(\'[data-t]\').forEach(function (el) { el.textContent = i18n.t(el.getAttribute(\'data-t\')); });\n'
  + '    // …and re-render anything you built in code, reading i18n.t() again.\n'
  + '  }\n'
  + '  i18n.onChange(paint);   // the bar\'s switch fires this; never build a switch of your own\n'
  + '  paint();\n'
  + '  AIMEAT.auth.mountLoginButton(\'#pill\', { onLogin: start, onLogout: paint });\n'
  + '</script>\n'
  + '```\n\n'
  + 'The switch must keep what the person was doing: a conversation, a half-filled form and the settings survive it, because `paint()` changes words and nothing else. Numbers, dates and money follow the language too (`toLocaleString(i18n.lang())`). Languages of speech recognition or of an AI answer are separate settings; do not tie them to this switch unless the owner asks.\n\n'
  + 'An app nobody signs in to still mounts the bar when it has two languages, because the switch lives there. Before you call it done, press the switch: English to Finnish and back, in the middle of using the app, and read every screen in both.\n\n';
