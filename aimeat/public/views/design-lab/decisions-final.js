/**
 * @file public/views/design-lab/decisions-final.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The last round of Settings & Controls, as decision data: what the builders left for
 *   Jouni's word, and what the Pebble check (the Built entry 'settings-pebble') found that would
 *   change AIMEAT or needs his call. The fields and the two registers are the ones decisions-data.js
 *   describes; that file spreads this list into DECISIONS after the conflicts round. Two fields are
 *   new here: `look` ({ theme, style, name }) also draws the proposal and each option in that theme,
 *   and `textOnly` makes a page of words without pictures (a check's numbers, a rule).
 * @structure FINAL_DECISIONS — [the DECISIONS shape, plus look? and textOnly?]
 * @usage import { FINAL_DECISIONS } from './decisions-final.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: twelve questions (Jouni: everything he looks at is in the admin).
 */

/** The example theme of Themes & Styles, as it is loaded and offered on the sandbox. */
const PEBBLE = { theme: 'pebble', style: 'pebble-aimeat', name: 'Pebble' };

export const FINAL_DECISIONS = [
  // ── The last round of Settings & Controls (2026-09-26). The pictures are drawn as this branch's
  //    pages draw them now; the Pebble questions are drawn in AIMEAT and in Pebble.
  {
    id: 'poster-shapes-baseline',
    textOnly: true,
    title: 'Copied shapes: the check that counts shapes written outside the library',
    question: 'A check counts the places where a sheet writes one of the design language\'s shapes itself (the yellow ground, the headline letters, the dark frame, the yellow shadow) instead of taking it from the library. The moves of this round cut those places from 558 to 343. But they carried old copies into 15 library sheets that are new, so the check now fails on 19 counts that went up. Should the check take the new, smaller numbers as its starting point, or should the 19 places be rewritten first?',
    proposal: {
      variant: 'record', name: 'Take the new numbers as the starting point',
      summary: 'The check records today\'s numbers: 343 copies in 79 files instead of 558 in 99. From then on a number can only go down, as before. The 19 places stay as they are and are cleaned up with the others.',
      text: 'pnpm check:poster-shapes (scripts/check-poster-shapes.ts; the baseline security/poster-shapes-baseline.json, measured 2026-09-13: 558 declarations, 99 files in its map). Measured now: 343 declarations in 79 files, and 19 file and pattern counts that rose, all in library sheets the moves made: organism-controls.css (sun 0→2, box2 0→2, slab 0→2), doc-tree.css (headline 0→1, sun 0→1), figure-strip.css (headline 0→1), fold-row.css (headline 0→1), gaii-chip.css (sun 0→1), model-picker.css (sun 0→1), morsel-flow.css (headline 0→2), numbered-index.css (sun 1→2), offer-lines.css (headline 0→1), page-row.css (sun 0→1), setting-box.css (headline 0→1), side-menu.css (sun 0→1), switch.css (sun 0→1), tab-page.css (headline 0→2, sun 0→2), week-rhythm.css (sun 0→1). By pattern: sun (background: var(--sun)) 12 more, headline (font-family: var(--font-poster)) 9, box2 (border: 2px solid var(--text)) 2, slab (box-shadow: 4px 4px 0 var(--sun)) 2. Recording is pnpm check:poster-shapes --record, which the baseline\'s own note allows only on an explicit decision.',
    },
    variants: [
      { id: 'record', name: 'Take the new numbers as the starting point', code: 'pnpm check:poster-shapes --record', becomes: 'this is the proposal', look: 'The check records 343 copies in 79 files. Nothing in a sheet changes.', where: 'the check, in pnpm gate and CI', crop: null },
      { id: 'rewrite', name: 'Rewrite the 19 places first', code: 'the 15 library sheets named in the Details', becomes: 'the new numbers as the starting point; the 19 places wait for the next clean-up', look: 'The 15 sheets take the yellow ground, the headline letters, the dark frame and the yellow shadow from the library instead of writing them. The pages look the same; the check passes on its old numbers.', where: '15 library sheets', crop: null },
    ],
    changes: [
      { page: 'If you accept', what: 'The check passes again with the new numbers. Nothing on a page changes.' },
      { page: 'If you choose the rewrite', what: 'Nothing on a page changes either: the 15 sheets take the same shapes from the library. It is more work before the round can be closed.' },
    ],
  },
  {
    id: 'draft-reply',
    title: 'Suggested reply: a reply your AI wrote, waiting for your yes',
    question: 'In Messages, when a tracked response is ready, your AI\'s suggested reply waits on your side of the conversation for your yes, in a pale coral box with a dashed frame. Since your decision "Message", your own messages are on the yellow ground. Should the suggested reply keep its dashed box, or look like your own message with a dashed frame?',
    proposal: {
      variant: 'proposal', name: 'Keep the dashed box',
      summary: 'The suggested reply keeps its pale coral ground and its dashed frame. You have not said it yet, so it does not look like a message you sent. One thing must be fixed with it: in dark mode its words are dark on a dark ground today, and cannot be read (see the dark pictures). They get the text colour.',
      text: '.inbox-bubble--draft (inbox-tab/panels.js, inbox.css): a 1px dashed --accent-border frame on --accent-subtle, both !important, over the yellow of .og-ib .inbox-bubble--mine. The rules that keep your own words dark on the yellow (inbox-poster.css, .og-ib .inbox-bubble--mine and its .md-body, --on-sun) reach the draft too, so in dark mode its words are --on-sun on the dark page seen through 10 % coral; the label .inbox-draft-label 11px 600 coral; three buttons: Open the record and Reject as action links, Approve as the dark block. The proposal (lab .dl-draft-readable) gives the draft\'s words --text. The option (lab .dl-draft-sun): your own message\'s --sun ground and --on-sun words, its frame dashed in --on-sun, the label in --on-sun. The proposal is drawn as built (panels.js since c8cb2ee15): the words in the text colour, no emoji, Reject in the danger tone, the actions on one line with one gap. The sandbox has no tracked response that is ready, so there is no page picture; both are drawn from panels.js\'s markup with fixed words.',
    },
    variants: [
      { id: 'dashed-box', name: 'The dashed box', code: '.inbox-bubble--draft (panels.js, inbox.css)', becomes: 'stays, with its words in the text colour so they can be read in dark mode', look: 'a pale coral ground, a thin dashed coral frame', where: 'Settings & Controls: Messages, a conversation with a suggested reply ready', crop: null },
      { id: 'sun-dashed', name: 'Your own message\'s yellow, with a dashed frame', code: 'lab: .inbox-bubble--mine.dl-draft-sun', becomes: 'the dashed box (no page draws this look today)', look: 'the yellow ground of your own messages, a dashed dark frame', where: 'Settings & Controls: Messages, a conversation with a suggested reply ready', crop: null },
    ],
    changes: [
      { page: 'Messages, if you accept', what: 'In light mode nothing. In dark mode the suggested reply\'s words turn from dark to the text colour, so they can be read.' },
      { page: 'If you choose your own message\'s yellow', what: 'The suggested reply gets the yellow ground of your own messages and a dashed dark frame, instead of the pale coral box, in both modes; its words are dark on the yellow and can be read. Its label and its three buttons stay.' },
    ],
  },
  {
    id: 'notifications-primary',
    title: 'Main answer in a notification: approve or accept',
    question: 'On Notifications, a notification that asks for a yes shows its answers at the end of the row. Today the yes (Approve, Accept) and the no (Deny, Decline) are both coral underlined capitals, so they look the same. Everywhere else in Settings the main action is the loud action, the dark block. Should the yes be the dark block?',
    proposal: {
      variant: 'proposal', name: 'The loud action',
      summary: 'The yes becomes the dark block with the yellow shadow, as the main action is everywhere else. The no stays coral underlined capitals, and Open stays an action link.',
      text: 'notifications/frame.js inboxRows: an api action with style primary is .og-door.og-door--coral (notifications-poster.css: .og-nt .og-door--coral, coral words and line), danger .og-door--danger (coral too), any other .og-door--quiet; in a row .og-tbl-door .og-door is .72rem 800 caps with a 2px line. The loud action is .poster-slab (poster.css: --text ground, --bg words, the pill corner, 4px 4px 0 --sun, .8rem). The lab frames are 480px wide, where the row stacks (notification-feed.css). No notification on the sandbox asks for an api answer, so there is no page picture; drawn from frame.js\'s markup with fixed words.',
    },
    variants: [
      { id: 'coral-door', name: 'The yes in coral underlined capitals', code: '.og-door.og-door--coral (notifications/frame.js, notifications-poster.css)', becomes: 'the dark block with the yellow shadow', look: '.72rem 800 caps, coral, a 2px coral line; the same as the no', where: 'Settings & Controls: Notifications, a notification that asks for a yes', crop: null },
    ],
    changes: [
      { page: 'Notifications', what: 'The yes (Approve, Accept) becomes the dark block with the yellow shadow, larger than today and different from the no. The no (Deny, Decline) stays coral underlined capitals, and Open stays an action link.' },
    ],
  },
  {
    id: 'offer-row-stars',
    title: 'Stars in a delivery row: a rating in a narrow column',
    question: 'In Offers, the list of what came back has a narrow column (7rem, 112 pixels) for how a delivery went: its status and, when you rated it, its stars. The stars are plain ★ letters after the status, one per star given, and the column cuts them with "…" when they do not fit. The library\'s stars, which you chose in "Rating stars", also show the stars not given, and at their size five do not fit beside the status. Should the column use a smaller cut of the library\'s stars?',
    proposal: {
      variant: 'proposal', name: 'A small cut of the library\'s stars',
      summary: 'The status, then the library\'s five stars at a smaller size: the stars given dark, the others grey, so a 4 reads as 4 of 5. Both fit in the column.',
      text: 'offers/frame.js deliveryRows: .listing-desc.op-st holds the Status and " · " with "★".repeat(stars); .op-st (offers-poster.css) does not wrap and cuts with an ellipsis; the column is minmax(0, 7rem) (listing.css .listing--when-name-who-state-doors), measured 112px at 1280. The library\'s shown tone (.op-stars--shown .op-star, rating-stars.css) is 1rem with .05rem on each side. Measured in the lab: the status "done" 39px, five library stars 75px, together 117px in the 112px cell, so the last star is cut; a longer status (queued, stalled) cuts more. The proposal (lab .dl-stars--row): .7rem, no side room, the given stars --text, the others --text-dim, after the status: the stars 47px, all of it 112px. Measured on the sandbox\'s one rated delivery ("done · ★★★★").',
    },
    variants: [
      { id: 'row-stars', name: 'The row\'s own stars', code: '.op-st (offers/frame.js deliveryRows, offers-poster.css)', becomes: 'the library\'s five stars, cut small', look: 'the status, " · " and one ★ per star given, in the cell\'s letters; cut with … when too long', where: 'Settings & Controls: Offers, What came back', crop: { url: '/v1/profile?tab=offers', selector: '.op-st:has-text("★")' } },
    ],
    changes: [
      { page: 'Offers: What came back, and the list on an offer\'s page', what: 'A rated delivery shows five small stars after its status: the stars given dark, the others grey. Today it shows only the stars given, grey, as letters after a dot, and a long status can cut them off.' },
    ],
  },
  // ── Found by the Pebble check (the Built entry "Settings & Controls in Pebble"): each would change
  //    AIMEAT or needs your word. Each is drawn in AIMEAT and in Pebble. ──
  {
    id: 'figure-weight',
    look: PEBBLE,
    title: 'Figure strip words: how heavy the word under a figure is',
    question: 'The figure strip at the top of many Settings pages puts a word under each big figure ("morsels", "came and went"). The words are at weight 800 in every theme. In Pebble, whose figures and headings are lighter (600), the 800 words look heavier than the figure they name. Should AIMEAT keep 800 and Pebble get a weight of its own, or should the words take the strong weight, 600, in every theme?',
    proposal: {
      variant: 'proposal', name: 'AIMEAT keeps 800; Pebble gets its own entry',
      summary: 'The words stay at 800 in AIMEAT. Pebble gets an entry of its own for the figure strip that sets them at 600, the weight of its headings.',
      text: 'figure-strip.css: .og-strip span { font-weight: 800; font-size: .9rem } (measured 14.4px, 800 on Wallet, Portfolio, Offers, Notifications and the overview). Pebble\'s --font-poster-weight is 600; it has no figure strip entry. The proposal adds one to Pebble\'s data (lab: [data-aimeat-theme="pebble"] .dl-pebble-strip). The option is .og-strip span at --font-poster-strong-weight (600 in AIMEAT; Pebble does not set it, so 600 there too).',
    },
    variants: [
      { id: 'words-800', name: 'Words at 800 in every theme', code: '.og-strip span (figure-strip.css)', becomes: 'AIMEAT: stays; Pebble: 600, from an entry of its own', look: '.9rem 800', where: 'Settings & Controls: the figure strip of the kit pages, for example Wallet, Offers, Notifications, Portfolio', crop: { url: '/v1/profile?tab=wallet', selector: '.og-strip span' } },
      { id: 'strong-600', name: 'The strong weight, 600, in every theme', code: 'lab: .dl-strip-strong (.og-strip span at --font-poster-strong-weight)', becomes: 'AIMEAT keeps 800; Pebble gets its own entry', look: '.9rem 600', where: 'Settings & Controls: the figure strip of the kit pages', crop: null },
    ],
    changes: [
      { page: 'AIMEAT', what: 'Nothing, if you accept.' },
      { page: 'Pebble', what: 'The words under the figures get less bold (600), as Pebble\'s headings are.' },
      { page: 'If you choose 600 in every theme', what: 'In AIMEAT too the words under the figures get less bold, from 800 to 600.' },
    ],
  },
  {
    id: 'rail-phone-shadow',
    look: PEBBLE,
    title: 'Contents rail on a phone: its yellow shadow',
    question: 'The contents rail ("On this page") has the raised shadow of a thing that stands out: 8 pixels of yellow in AIMEAT, a soft grey shadow in Pebble. Below 1100 pixels wide, a rule of its own sets 6 pixels of yellow instead, in every theme, so on a phone Pebble shows AIMEAT\'s shadow. Should the rail keep the raised shadow on a phone too, or get a shape value of its own?',
    proposal: {
      variant: 'proposal', name: 'The raised shadow on a phone too',
      summary: 'The phone rule goes, and the rail has the raised shadow at every width. In AIMEAT its yellow shadow grows from 6 to 8 pixels on a phone; in Pebble it becomes Pebble\'s soft shadow.',
      text: 'tab-page.css .og-rail: box-shadow var(--shape-shadow-raised) (AIMEAT 8px 8px 0 --sun; Pebble 0 12px 32px, the text colour at 10 %). organism.css, max-width 1100px: .og-rail { box-shadow: 6px 6px 0 var(--sun) }, kept there as a value no shape value equals. The proposal removes that rule (lab .dl-rail-raised). The option is a new shape value (for example --shape-shadow-rail, AIMEAT 6px 6px 0 --sun) that a theme sets; Pebble does not set it yet, so it keeps the yellow 6 px until it does (lab .dl-rail-value). The lab frames are 480px wide, below 1100px, so they show the phone rule; the lab frame lets the rail show whole (no max height). The page pictures are taken 1280px wide, where the phone rule does not apply, so the options have no page picture.',
    },
    variants: [
      { id: 'phone-6px', name: '6 pixels of yellow on a phone, in every theme', code: '.og-rail at max-width 1100px (organism.css)', becomes: 'the raised shadow: 8 pixels of yellow in AIMEAT, the soft shadow in Pebble', look: '6px 6px 0 --sun', where: 'Settings & Controls: every kit page with a contents rail, below 1100 pixels wide', crop: null },
      { id: 'rail-value', name: 'A shape value of its own', code: 'lab: .dl-rail-value (a new --shape-shadow-rail, AIMEAT 6px 6px 0 --sun)', becomes: 'the raised shadow', look: '6px of yellow until a theme sets its own', where: 'Settings & Controls: every kit page with a contents rail, below 1100 pixels wide', crop: null },
    ],
    changes: [
      { page: 'AIMEAT, on a phone', what: 'The rail\'s yellow shadow grows from 6 to 8 pixels, as on a computer.' },
      { page: 'Pebble, on a phone', what: 'The rail gets Pebble\'s soft shadow instead of AIMEAT\'s yellow one.' },
      { page: 'If you choose a shape value of its own', what: 'Nothing changes in AIMEAT. Pebble keeps the yellow shadow on a phone until its data sets the new value.' },
    ],
  },
  {
    id: 'classic-cards',
    look: PEBBLE,
    title: 'Classic cards: the older boxes that Settings draws as sections',
    question: 'Six older Settings pages (Fleet, Chat sessions, P&L, Access, Node stats, Security) are made of classic cards. Settings draws each card as a section: no frame at the sides, no ground, a thick line on top. A theme that draws its own cards, as Pebble does (a thin frame, round corners, a soft shadow), cannot reach them, because the Settings rule is stronger. Should they stay sections in every theme, or should a theme\'s card win?',
    proposal: {
      variant: 'section', name: 'They stay sections',
      summary: 'The classic cards stay sections in every theme, like the sections of the other Settings pages. In Pebble they look as they do today.',
      text: 'profile-poster.css: .pf .card, .pf .card.card-glass, .pf .pf-agd-card and .pj-section: no ground, no corners, no shadow, padding 1.1rem 0 1.5rem, no side or bottom frame; the top line measured 3px ink on Security. components/card.css .card: --bg-card, 1px --border, --radius, 2rem, --shadow-sm. Pebble\'s "card" entry: 1px --card-border, 18px corners, --shape-shadow; .pf .card is stronger, so it does not show. The option (lab .dl-card-theme) draws Pebble\'s entry winning in Pebble; AIMEAT has no card entry, so there the card stays a section.',
    },
    variants: [
      { id: 'section', name: 'A section', code: '.pf .card (profile-poster.css)', becomes: 'stays as it is', look: 'a thick line on top, no other frame, no ground', where: 'Settings & Controls: Fleet, Chat sessions, P&L, Access, Node stats, Security', crop: { url: '/v1/profile?tab=security', selector: '.pf .card' } },
      { id: 'theme-card', name: 'A theme\'s card wins', code: 'lab: .dl-card-theme (Pebble\'s card entry)', becomes: 'a section', look: 'in Pebble a thin frame, round corners and a soft shadow; in AIMEAT a section', where: 'Settings & Controls: Fleet, Chat sessions, P&L, Access, Node stats, Security', crop: null },
    ],
    changes: [
      { page: 'AIMEAT and Pebble', what: 'Nothing, if you accept.' },
      { page: 'If you choose a theme\'s card', what: 'In Pebble the six pages draw their cards as Pebble\'s cards: a thin frame, round corners and a soft shadow. In AIMEAT nothing changes.' },
    ],
  },
  {
    id: 'dark-ground',
    look: PEBBLE,
    title: 'Dark ground: the contents rail and the page thumbnail',
    question: 'The contents rail ("On this page") and the thumbnail of your portfolio page have the text colour as their ground: dark in light mode, light in dark mode. A theme cannot give them a ground of its own without changing the text colour of the whole page. Should they take their ground from a new colour value, whose AIMEAT value is the text colour?',
    proposal: {
      variant: 'proposal', name: 'A colour value of their own',
      summary: 'The two grounds take a new colour value. In AIMEAT its value is the text colour, so nothing changes. A theme can set it, so Pebble can give the rail a ground of its own later.',
      text: '.og-rail (tab-page.css) and .pf-thumb (page-row.css): background var(--text), words var(--bg). The new value (for example --ground-ink) is set in theme.css to var(--text). Pebble does not set it, so Pebble does not change either. Other things on the text colour (the loud action, the phone Menu button, the switch) are not part of this question.',
    },
    variants: [
      { id: 'rail', name: 'The contents rail', code: '.og-rail (tab-page.css)', becomes: 'the new colour value (no visible change)', look: 'the text colour as ground, words in the page colour', where: 'Settings & Controls: every kit page with a contents rail', crop: { url: '/v1/profile?tab=wallet', selector: '.og-rail' } },
      { id: 'thumb', name: 'The page thumbnail', code: '.pf-thumb (page-row.css)', becomes: 'the new colour value (no visible change)', look: 'the text colour as ground, a coral and a yellow bar', where: 'Settings & Controls: Portfolio, your pages', crop: { url: '/v1/profile?tab=portfolio', selector: '.pf-thumb' } },
    ],
    changes: [
      { page: 'AIMEAT and Pebble', what: 'Nothing you can see. A theme can now give the rail and the thumbnail a ground of its own.' },
    ],
  },
  {
    id: 'phone-menu-button',
    look: PEBBLE,
    title: 'Menu button on a phone: the button that opens the Settings menu',
    question: 'On a phone, Settings has a "☰ Menu" button that opens the menu. It is drawn with a copy of the loud action\'s rules, not with the loud action itself, so a theme that draws the loud action its own way does not reach it: in Pebble the loud actions are blue, and the Menu button stays dark. Should the Menu button be the library\'s loud action?',
    proposal: {
      variant: 'proposal', name: 'The library\'s loud action',
      summary: 'The Menu button becomes the loud action. In AIMEAT it looks the same as today. In Pebble it turns blue, like Pebble\'s other loud actions.',
      text: 'settings-frame.css .settings-frame-toggle (below 900px): --text ground, --bg words, border 0, --shape-corner-pill, --shape-shadow-action, 10px 16px, the body face at --font-poster-strong-weight .8rem, --shape-case-action and --shape-tracking-action: the values of .poster-slab (poster.css), written again. Pebble\'s "slab" entry sets .poster-slab to --accent with 10px 22px and 700, which the copy does not get. The proposal draws the button as .poster-slab. It shows only below 900px, and the page pictures are 1280px wide, so it has no page picture.',
    },
    variants: [
      { id: 'toggle', name: 'The Menu button as it is', code: '.settings-frame-toggle (SettingsFrame.js, settings-frame.css)', becomes: 'the loud action', look: 'a copy of the loud action: dark ground, pill corners, a 4px yellow shadow', where: 'Settings & Controls: every page, below 900 pixels wide', crop: null },
    ],
    changes: [
      { page: 'AIMEAT, on a phone', what: 'Nothing you can see.' },
      { page: 'Pebble, on a phone', what: 'The Menu button turns from dark to Pebble\'s blue, its words get a little bolder and it gets a little more room at its sides, like Pebble\'s other loud actions. Its round shape and soft shadow are Pebble\'s already.' },
    ],
  },
  {
    id: 'top-bar-corners',
    look: PEBBLE,
    title: 'Top bar corners: the language switch and the menu button',
    question: 'In the top bar, the language switch (EN FI ES) and the phone\'s menu button (☰) have small round corners, 6 pixels, in every theme. The rest of AIMEAT is square, and Pebble has no rule for these two. Should Pebble get an entry of its own for them, with AIMEAT as it is, or should both take a shape value, so that AIMEAT\'s corners become square?',
    proposal: {
      variant: 'proposal', name: 'Pebble gets its own entry',
      summary: 'AIMEAT keeps its small round corners. Pebble\'s top bar entry gives the two the rounder corners of its other controls.',
      text: 'top-bar.css: .topnav-center, a 1px --border frame with --radius-xs (6px); .topnav-burger (below 1180px, or in the compact bar), 38×34px, a 1px --border frame, --radius-xs. Pebble\'s "top-bar" entry sets only the bar\'s shadow and the pill\'s radius. In the proposal Pebble\'s entry gives both --shape-corner-control (12px in Pebble; lab .dl-pebble-entry). The option: both take --shape-corner-control in every theme, 0 in AIMEAT (square) and 12px in Pebble (lab .dl-corner-control). The menu button shows only below 1180px, and the page pictures are 1280px wide, so it has no page picture.',
    },
    variants: [
      { id: 'lang-switch', name: 'The language switch', code: '.topnav-center (top-bar.css)', becomes: 'AIMEAT: stays; Pebble: the corners of its controls', look: 'a thin light grey frame, 6px corners', where: 'the top bar, on a computer (inside the menu on a phone)', crop: { url: '/v1/profile?tab=wallet', selector: '.topnav-center' } },
      { id: 'menu-button', name: 'The menu button', code: '.topnav-burger (top-bar.css)', becomes: 'AIMEAT: stays; Pebble: the corners of its controls', look: 'a 38 by 34 pixel square, a thin light grey frame, 6px corners', where: 'the top bar, below 1180 pixels wide', crop: null },
      { id: 'shape-value', name: 'A shape value for both, in every theme', code: 'lab: .dl-corner-control (--shape-corner-control)', becomes: 'Pebble gets its own entry', look: 'square in AIMEAT, 12px corners in Pebble', where: 'the top bar', crop: null },
    ],
    changes: [
      { page: 'AIMEAT', what: 'Nothing, if you accept.' },
      { page: 'Pebble', what: 'The language switch and the menu button get the rounder corners of Pebble\'s other controls.' },
      { page: 'If you choose the shape value', what: 'In AIMEAT the two lose their small round corners and become square, like the rest of AIMEAT. In Pebble they get the rounder corners, as in the proposal.' },
    ],
  },
  {
    id: 'mcp-guide-theme',
    textOnly: true,
    title: 'MCP guide in a theme: may a theme change it?',
    question: 'You kept the MCP guide\'s own look in your decision "MCP guide": the thin grey frames and round corners of the part. Its sheet writes those corners and frames itself, so no theme reaches it: in Pebble the guide looks as in AIMEAT. Should a theme be able to change it?',
    proposal: {
      variant: 'no-theme', name: 'No: it looks the same in every theme',
      summary: 'The MCP guide keeps the look you chose in every theme. It holds the steps and the block you paste into another AI\'s settings, and it stays as you chose it.',
      text: 'hello-mcp.css: .ib-block, .ast-cmd-text, .ast-params and .ast-code have --radius-xs (6px) corners and 1px --border frames (measured on Agents and MCP in the Pebble check); Jouni\'s answer of 2026-09-26: options.classic accepted. For a theme to reach it, the four rules would take shape values (--shape-corner-control, --shape-frame, --shape-field-colour), and AIMEAT\'s corners would become square unless a new value keeps 6px.',
    },
    variants: [
      { id: 'no-theme', name: 'No: the same look in every theme', code: 'hello-mcp.css as it is', becomes: 'this is the proposal', look: 'The guide keeps its thin grey frames and 6 pixel corners in AIMEAT, in Pebble and in any theme made later.', where: 'Agents, MCP, an organism\'s instructions, the home\'s first steps', crop: null },
      { id: 'theme-reaches', name: 'Yes: a theme may change it', code: 'hello-mcp.css taking the shape values', becomes: 'the same look in every theme', look: 'The guide takes a theme\'s corners and frames. In AIMEAT its small round corners become square, unless a value of its own keeps them.', where: 'Agents, MCP, an organism\'s instructions, the home\'s first steps', crop: null },
    ],
    changes: [
      { page: 'If you accept', what: 'Nothing changes.' },
      { page: 'If you choose that a theme may change it', what: 'In Pebble the guide takes Pebble\'s corners and frames. In AIMEAT its small round corners become square, unless a value of its own keeps them.' },
    ],
  },
  {
    id: 'pebble-band',
    look: PEBBLE,
    title: 'Pebble\'s overview band: figures in the band\'s own colour',
    question: 'On the Settings overview, the slanted band with your figures (apps, memories, morsels, agents) has the accent colour as its ground. Pebble\'s own data colours the figures with the accent colour too, so in Pebble three of the four cannot be seen; only morsels, which has a colour of its own, shows. This is in Pebble\'s data, not in the platform. Should it be fixed in Pebble\'s data on the sandbox, or only reported?',
    proposal: {
      variant: 'proposal', name: 'Fix it in Pebble\'s data',
      summary: 'The line in Pebble\'s data that colours the band\'s figures goes, so the figures take the page colour, as in AIMEAT. Only Pebble on this sandbox changes; AIMEAT does not.',
      text: 'Pebble\'s componentCss "stat": ".poster-stat-number { font-weight: 600; } .poster-stat-number--band { color: var(--accent); }". poster.css: .poster-stat-number--band { color: var(--bg) }; the band is .pf .pf-lp-stats::before on --accent (profile.css). Morsels carries .pf-lp-stat-green (color var(--bg)), which Pebble does not touch. The fix is one theme save (the Themes & Styles editor or aimeat_theme_save) that removes the second rule; Pebble lives in the sandbox\'s data, not in the repository (lab .dl-pebble-fix draws it).',
    },
    variants: [
      { id: 'band-figures', name: 'The band\'s figures in Pebble', code: 'Pebble componentCss "stat": .poster-stat-number--band { color: var(--accent) }', becomes: 'in Pebble the page colour, as in AIMEAT', look: 'in Pebble: blue figures on the blue band; in AIMEAT the page colour on coral', where: 'Settings & Controls: the overview', crop: { url: '/v1/profile', eval: 'return new Promise((r) => setTimeout(r, 3000));', selector: '.poster-stat-number--band', around: '.pf-lp-stats' } },
    ],
    changes: [
      { page: 'Pebble: the overview', what: 'The figures for apps, memories and agents can be seen again, in the page colour on the blue band.' },
      { page: 'AIMEAT', what: 'Nothing.' },
      { page: 'If you say no thanks', what: 'Nothing changes; the fault stays in the report for whoever looks after Pebble.' },
    ],
  },
];
