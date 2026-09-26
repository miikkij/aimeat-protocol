/**
 * @file src/services/ui-library/entries-shapes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the shapes of the design language: the classes in
 *   css/poster.css that a component or a view sheet composes and never writes again (the slab, the
 *   rule, the box, the section title and the rest). A shape has no module; it is put on markup as a
 *   class. The purpose half only; facts.generated.ts carries what the files say.
 * @structure SHAPE_ENTRIES
 * @usage import { SHAPE_ENTRIES } from './entries-shapes.js';
 * @version-history
 *   v1.17.0 — 2026-09-26 — The Meter's figure (.poster-meter-figure), the Wallet meter's look, taken by the AI budget bars (a unification).
 *   v1.16.0 — 2026-09-26 — The Tag's remove mark (.poster-chip-x), Jouni's decision "Remove mark".
 *   v1.15.0 — 2026-09-26 — The box's raised tone (.poster-box--raised), Jouni's decision "Box".
 *   v1.14.0 — 2026-09-26 — The action link's Settings tones small, lower and row (Jouni's decision "Action link in Settings").
 *   v1.13.0 — 2026-09-26 — The avatar's agent tone (.poster-box--agent), the dashed look Contacts, Notifications, Email and MCP drew alike.
 *   v1.12.0 — 2026-09-25 — The icon button's pressed tone (.poster-icon.is-on), first worn by Memory's collection button.
 *   v1.11.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.10.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.9.0 — 2026-09-25 — The action's danger tone, poster-action--danger (Jouni's decision "Action link").
 *   v1.8.0 — 2026-09-25 — The menu row's danger tone.
 *   v1.7.0 — 2026-09-25 — The tab's filter tone (Jouni's decision "Tabs and filters").
 *   v1.6.0 — 2026-09-25 — The chip is the Tag with its tones, and the Status is a shape (Jouni's decisions
 *     "Tag" and "Status"), both unused until the Settings pages move onto them.
 *   v1.5.0 — 2026-09-24 — The action link's notice and jump tones (Jouni's decision "Small link").
 *   v1.4.0 — 2026-09-24 — The menu row (Jouni's decision "Menu row").
 *   v1.3.0 — 2026-09-24 — The tab's tile tone (Jouni's decision "Choice").
 *   v1.2.0 — 2026-09-24 — The icon button (Jouni's decision "Icon button").
 *   v1.1.0 — 2026-09-23 — The dialog shape deleted (Jouni's decision: the site has its own dialog);
 *     the chip kept as a candidate for the design lab's first decision.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntryWritten, UiVariant } from './types.js';

/**
 * In poster.css, put on nothing by any page yet: built from Jouni's decisions for pages that have not
 * moved onto them. Empty since 2026-09-25: the Tag and the Status are on the Settings pages.
 */
const UNUSED_SHAPES = new Set<string>();
const UNUSED_NOTE = 'Built from a decision of Jouni\'s that no page has moved onto yet.';

/** Every shape has the same frame; only what it is and how it is cut differ. */
function shape(id: string, name: string, classes: string[], markup: string, summary: string, useFor: string, variants: UiVariant[] = []): UiEntryWritten {
    return {
        id, name, kind: 'shape', status: UNUSED_SHAPES.has(id) ? 'unused' : 'active', summary,
        module: null, sheet: '/css/poster.css', classes,
        data: { shape: markup, fields: { children: 'what the element holds' } },
        useFor: [useFor], variants, example: { markup },
        ...(UNUSED_SHAPES.has(id) ? { note: UNUSED_NOTE } : {}),
    };
}

export const SHAPE_ENTRIES: UiEntryWritten[] = [
    shape('page-title', 'Page title', ['poster-page-title'], '<h1 class="poster-page-title">…</h1>',
        'A page\'s own headline in the poster face, in capitals.', 'The one headline of a profile or admin page.'),
    shape('section', 'Section title', ['poster-section', 'poster-section-title', 'poster-section-title--large'],
        '<section class="poster-section"><h2 class="poster-section-title">…</h2>…</section>',
        'The ink slab that starts a section, with a sun edge under it.', 'The start of each section of a page.',
        [{ name: 'large', class: 'poster-section-title--large', when: 'the home\'s bands and the layout engine\'s blocks' }]),
    shape('panel', 'Panel', ['poster-panel'], '<div class="poster-panel">…</div>',
        'A sun edge on the left that bounds the selected tab\'s content.', 'Under a tab row, around what the chosen tab shows.'),
    shape('row', 'Row', ['poster-row', 'poster-row--thing'], '<div class="poster-row">…</div>',
        'A row between two thin rules; the thing cut has a 3px ink rule on top.', 'A line in a list of things or states.',
        [{ name: 'thing', class: 'poster-row--thing', when: 'a row that is one thing a person has or does' }]),
    shape('label', 'Label', ['poster-label'], '<span class="poster-label">…</span>',
        'A small coral word in capitals that names what follows.', 'Above a value, a prompt or a group of controls.'),
    shape('action', 'Action', ['poster-action', 'poster-tab', 'poster-action--small', 'poster-action--lower', 'poster-action--row', 'poster-action--more', 'poster-action--quiet', 'poster-action--back', 'poster-action--text', 'poster-action--danger', 'poster-action--notice', 'poster-action--jump', 'poster-tab--fold', 'poster-tab--tile', 'poster-tab--filter'], '<a class="poster-action" href="…">…</a>',
        'An ink-underlined action in capitals; the same cut is the unselected tab. Its tones are the quiet ways on Jouni kept.', 'A secondary action or a door in a masthead, or a tab.',
        [
            { name: 'tab', class: 'poster-tab', when: 'one tab in a row; is-on puts the chosen one on the sun' },
            { name: 'small', class: 'poster-action--small', when: 'a way on in a Settings page head or section: smaller, with a thinner line' },
            { name: 'lower', class: 'poster-action--lower', when: 'with small: a softer way on in Settings ("Show 13 more", "Copy ref"), no capitals' },
            { name: 'row', class: 'poster-action--row', when: 'with small: a way on at the end of a dense Settings row, smaller still' },
            { name: 'more', class: 'poster-action--more', when: 'more of a list: "Show all", in coral typewriter letters' },
            { name: 'quiet', class: 'poster-action--quiet', when: 'a small action in a side column (the chat\'s Reset session, Copy conversation)' },
            { name: 'back', class: 'poster-action--back', when: 'the way back to where a person came from' },
            { name: 'text', class: 'poster-action--text', when: 'a plain word under a message (Listen, Copy); "Not now"' },
            { name: 'danger', class: 'poster-action--danger', when: 'an act that removes or revokes: coral words and line' },
            { name: 'notice', class: 'poster-action--notice', when: '"What does that mean?" under the AI notice: small coral typewriter words' },
            { name: 'jump', class: 'poster-action--jump', when: 'the jump to the latest message: a small ink block with a sun shadow' },
            { name: 'fold tab', class: 'poster-tab--fold', when: 'a small switch in a row ("Recent", "Mine"): coral typewriter words, the chosen one on the sun' },
            { name: 'tile tab', class: 'poster-tab--tile', when: 'a choice among named looks (the background pattern): framed tiles, the chosen one on the sun' },
            { name: 'filter tab', class: 'poster-tab--filter', when: 'a filter over a list ("all", "failed", a kind with its count): small typewriter words in a grey frame, the chosen one on the sun' },
        ]),
    shape('slab', 'Slab', ['poster-slab', 'poster-slab--large', 'poster-slab--control', 'poster-slab--danger'], '<button class="btn-primary poster-slab">…</button>',
        'The loud action: a filled block that moves when pressed (in the built-in look, a dark block with a yellow shadow).', 'The one primary action of a place.',
        [
            { name: 'large', class: 'poster-slab--large', when: 'the home\'s large door' },
            { name: 'control', class: 'poster-slab--control', when: 'a 44px button in a row of controls (New conversation, Send, a dialog\'s Save)' },
            { name: 'danger', class: 'poster-slab--danger', when: 'an action that cannot be undone (a dialog\'s Delete): coral with an ink shadow' },
        ]),
    shape('icon', 'Icon button', ['poster-icon', 'poster-icon--small'], '<button class="poster-icon" aria-label="…">…</button>',
        'A button that is a mark, not a word: a square in a thin ink frame, the sun under the pointer, dimmed while disabled.', 'Attach, record, delete, more, a card\'s menu.',
        [
            { name: 'small', class: 'poster-icon--small', when: 'everywhere but the composer: 28px, the size of the dialog\'s close square' },
            { name: 'pressed', when: 'is-on: a button that stays pressed while what it adds is in (a key in Memory\'s collection): the ink ground, the mark in the page ground\'s colour' },
        ]),
    shape('menu-row', 'Menu row', ['poster-menu-row', 'poster-menu-row--danger'], '<div class="poster-prompt-menu"><button class="poster-menu-row">…</button>…</div>',
        'One choice in an opened menu: plain words on a quiet ground, a thin line between rows.', 'The prompt card\'s other ways to send, a card\'s actions, a notification\'s actions.',
        [{ name: 'danger', class: 'poster-menu-row--danger', when: 'a row that removes something: the danger colour' }]),
    shape('box', 'Box', ['poster-box', 'poster-box--raised', 'poster-box--avatar', 'poster-box--small', 'poster-box--agent', 'poster-box--meter', 'poster-box--quota', 'poster-box--copy', 'poster-box--row', 'poster-meter-figure'], '<div class="poster-box">…</div>',
        'A 2px ink frame that carries one object; its size and place belong to the view.', 'An initials box, a meter, or a framed result.',
        [
            { name: 'raised', class: 'poster-box--raised', when: 'the thing that stands out: a row you opened, or the way to take first; the heavier frame with the raised shadow' },
            { name: 'copy', class: 'poster-box--copy', when: 'a text a person copies, on the grey ground (the prompt card)' },
            { name: 'row', class: 'poster-box--row', when: 'one result in a list, with small padding (the chat\'s result card)' },
            { name: 'avatar', class: 'poster-box--avatar', when: 'initials in a square' },
            { name: 'small', class: 'poster-box--small', when: 'a smaller avatar box' },
            { name: 'agent', class: 'poster-box--agent', when: 'the avatar of a sender that is not a person (an agent, an app, a mail service not yet connected, a tool that is gone): a dashed frame and grey initials' },
            { name: 'meter', class: 'poster-box--meter', when: 'a bar of sun on paper' },
            { name: 'quota', class: 'poster-box--quota', when: 'a coral bar that turns danger when full' },
            { name: 'meter figure', class: 'poster-meter-figure', when: 'the figure written on a meter: small typewriter figures in ink at its left edge (the meter sets its line height)' },
        ]),
    shape('frame', 'Frame', ['poster-frame'], '<span class="poster-frame">…</span>',
        'A 3px ink frame on the card ground.', 'An avatar or a picture that needs an edge.'),
    shape('record', 'Record', ['poster-record', 'poster-record-title', 'poster-record-title--small'], '<div class="poster-record"><h3 class="poster-record-title">…</h3>…</div>',
        'A card in an ink frame with a sun shadow, and its headline.', 'One thing opened up: an index entry, a record, a detail.',
        [{ name: 'small title', class: 'poster-record-title--small', when: 'a record inside a narrow column' }]),
    shape('choice', 'Choice tile', ['poster-choice'], '<button class="poster-choice"><b>…</b>…</button>',
        'One of a few boxed answers, the chosen one on the sun with an ink shadow.', 'A choice where each answer needs a line of explanation.'),
    shape('sticker', 'Sticker', ['poster-sticker'], '<div class="poster-sticker">…</div>',
        'A small sun-ground box with a short headline and one door.', 'The one fact about a thing that must be seen before its name.'),
    shape('aside', 'Aside', ['poster-aside', 'poster-aside--small', 'poster-aside--large', 'poster-aside--irreversible', 'poster-aside--waiting', 'poster-aside--suggestion'], '<aside class="poster-aside">…</aside>',
        'A dashed coral frame for a note beside the main flow.', 'A caution, a tip or a consequence the person should read.',
        [
            { name: 'waiting', class: 'poster-aside--waiting', when: 'the next move is in another window: a thin dashed ink frame on grey (the waiting note)' },
            { name: 'suggestion', class: 'poster-aside--suggestion', when: 'a line the person can wave away: a thin dashed ink frame, small bold words (the phone nudge)' },
            { name: 'small', class: 'poster-aside--small', when: 'a short note' },
            { name: 'large', class: 'poster-aside--large', when: 'a note with more room' },
            { name: 'irreversible', class: 'poster-aside--irreversible', when: 'a solid frame: this cannot be undone' },
        ]),
    shape('chip', 'Tag', ['poster-chip', 'poster-chip--sun', 'poster-chip--coral', 'poster-chip--ink', 'poster-chips', 'poster-chip-x'], '<span class="poster-chip">…</span> · <span class="poster-chip">… <button class="poster-chip-x">✗</button></span>',
        'A small word in a thin ink frame in the typewriter face that names a kind, a version, a role or a relation (Jouni\x27s decision "Tag").', 'A tag beside a name; a row of them in .poster-chips.',
        [
            { name: 'sun', class: 'poster-chip--sun', when: 'the chosen one, or the one that counts now' },
            { name: 'coral', class: 'poster-chip--coral', when: 'the one to notice' },
            { name: 'ink', class: 'poster-chip--ink', when: 'the one that belongs to you: a relation, your role' },
            { name: 'remove mark', class: 'poster-chip-x', when: 'the ✗ after the name that takes a tag or a member off: grey, coral under the pointer (Jouni\x27s decision "Remove mark")' },
        ]),
    shape('status', 'Status', ['poster-status', 'poster-status--fine', 'poster-status--attention', 'poster-status--danger', 'poster-status--off'], '<span class="poster-status poster-status--fine">active</span>',
        'A small word in capitals on a pale colour that says a state (Jouni\x27s decision "Status").', 'The state of a thing in a row: a fill, never a frame, so it stays apart from a tag.',
        [
            { name: 'fine', class: 'poster-status--fine', when: 'all is well' },
            { name: 'attention', class: 'poster-status--attention', when: 'needs a look' },
            { name: 'danger', class: 'poster-status--danger', when: 'broken or refused' },
            { name: 'off', class: 'poster-status--off', when: 'not in use' },
        ]),
    shape('crumb', 'Crumb', ['poster-crumb'], '<span class="poster-crumb">…</span>',
        'A mono coral path step followed by a slash.', 'Where a page sits, above its headline.'),
    shape('count', 'Count', ['poster-count', 'poster-count--waiting', 'poster-count--tally', 'poster-count--small'], '<span class="poster-count poster-count--waiting">3</span>',
        'A small number in the typewriter face.', 'How many things wait for the person, or how many there are.',
        [
            { name: 'waiting', class: 'poster-count--waiting', when: 'something waits for the person: on coral' },
            { name: 'tally', class: 'poster-count--tally', when: 'it only says how many: no ground' },
            { name: 'small', class: 'poster-count--small', when: 'a count on an icon, such as the bell' },
        ]),
    shape('time', 'Time', ['poster-time'], '<span class="poster-time">10:42</span>',
        'When a thing happened, in small grey typewriter letters.', 'The time under a chat message and beside an event on the home.'),
    shape('stat', 'Stat', ['poster-stat', 'poster-stat-number', 'poster-stat-number--small', 'poster-stat-number--large', 'poster-stat-number--step', 'poster-stat-number--band'],
        '<a class="poster-stat" href="…"><span class="poster-stat-number">3</span>…</a>',
        'A line over a 3px ink rule with its number set big in the poster face.', 'A count a person reads at a glance.',
        [
            { name: 'small', class: 'poster-stat-number--small', when: 'a number inside running text' },
            { name: 'large', class: 'poster-stat-number--large', when: 'the one number of a page' },
            { name: 'step', class: 'poster-stat-number--step', when: 'a coral step numeral' },
            { name: 'band', class: 'poster-stat-number--band', when: 'a numeral on an ink band' },
        ]),
    shape('showroom-band', 'Showroom band', ['showroom-band', 'showroom-band--sun'], '<section class="showroom-band">…</section>',
        'A full-width ink band, or a sun one, for the front page.', 'A band of the landing page.',
        [{ name: 'sun', class: 'showroom-band--sun', when: 'the sun band' }]),
    shape('showroom-section', 'Showroom section', ['showroom-section', 'showroom-section--coral'], '<div class="showroom-section">…</div>',
        'A framed room on the front page with a sun shadow.', 'One room of the landing page.',
        [{ name: 'coral', class: 'showroom-section--coral', when: 'a coral shadow instead of the sun' }]),
    shape('showroom-door', 'Showroom door', ['showroom-door'], '<a class="showroom-door" href="…">…</a>',
        'Bold words over a 3px coral underline.', 'A door out of a landing room.'),
    shape('showroom-slab', 'Showroom slab', ['showroom-slab', 'showroom-slab--hot', 'showroom-slab--sun', 'showroom-slab--ink'], '<a class="showroom-slab showroom-slab--hot" href="…">…</a>',
        'The front page\'s big button: a framed block with a hard shadow.', 'The landing page\'s main doors.',
        [
            { name: 'hot', class: 'showroom-slab--hot', when: 'coral' },
            { name: 'sun', class: 'showroom-slab--sun', when: 'sun' },
            { name: 'ink', class: 'showroom-slab--ink', when: 'ink with a coral shadow' },
        ]),
];
