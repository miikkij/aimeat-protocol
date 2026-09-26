/**
 * @file public/views/design-lab/decision-samples-final.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live samples and proposal pictures of the last round of Settings & Controls
 *   (decisions-final.js), in the shape decision-samples.js describes: per sample `measure`, `solo`
 *   and `after`. decision-samples.js spreads these into SAMPLES and PROPOSALS. What a Settings page
 *   draws today is drawn by calling its component with fixed words; a look the page no longer draws
 *   keeps the markup it was asked about. The decisions that are also drawn in Pebble (their `look`)
 *   mark the part a Pebble entry of its own would change with a lab class that only Pebble's frames
 *   read (css/design-lab-proposals.css, `[data-aimeat-theme="pebble"]`). The text pages draw nothing.
 * @structure FINAL_SAMPLES — { [decisionId]: [{ id, measure, solo?, render(), after }] } · FINAL_PROPOSALS — { [decisionId]: { measure, render() } }
 * @usage import { FINAL_SAMPLES, FINAL_PROPOSALS } from './decision-samples-final.js';
 * @version-history
 *   v1.1.0 — 2026-09-27 — What the pages draw today is drawn by their components (the catalogue
 *     pass): the suggested reply (Message's draft tone), a notification's row and answers (List,
 *     Loud, Action), a delivery's stars (Stars' row cut in the List's cell), the figure strip
 *     (FigureStrip), the classic card (Card's section tone), the page thumbnail (List's Thumb) and
 *     the overview band (NumberBand). The looks the pages no longer draw keep their markup, and the
 *     notification's coral yes is drawn as the no is drawn today, the action link's danger tone.
 *   v1.0.0 — 2026-09-26 — Initial: the suggested reply, the notification's main answer, a delivery
 *     row's stars, and the Pebble questions (the figure strip's words, the contents rail's phone
 *     shadow, the classic cards, the dark ground, the phone Menu button, the top bar's corners, the
 *     overview band).
 */
import { h } from 'preact';
import htm from 'htm';
import { Markdown } from '/components/Markdown.js';
import { Message } from '/components/Message.js';
import { List, Row, Name, Desc, Who, When, Doors, Thumb } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Stars } from '/components/Stars.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Card } from '/components/Card.js';
import { NumberBand } from '/components/NumberBand.js';

const html = htm.bind(h);
const noop = () => {};
/** An element as the proposal draws it, alone: the `after` of a sample. `measure` defaults to `solo`. */
const after = (solo, render, measure) => ({ solo, render, measure });
/** A tone of a proposal, captioned with its name under the example word. */
const tone = (name, children) => html`<span class="poster-specimen-tone">${children}<small>${name}</small></span>`;
/** Settings parts are drawn inside the Settings scope root; a kit page's parts inside its `.og` root too. */
const pf = (children) => html`<div class="pf">${children}</div>`;
const og = (root, children) => pf(html`<div class=${`og ${root}`}>${children}</div>`);

// ── Messages: a suggested reply waiting for your yes (inbox-tab/panels.js) ──
const DRAFT = 'Yes, Friday works. I will bring the two seat maps.';
/** The reply as it was asked about (the markup the page drew then): `kind` 'box' the dashed box,
    'sun' the option, your own message's yellow with a dashed frame (lab classes). */
const DRAFT_CLASS = { box: 'inbox-bubble--draft', sun: 'dl-draft-sun' };
const draft = (kind = 'box') => pf(html`<div class="inbox og og-ib"><div class="inbox-panel"><div class="inbox-msgs">
  <div class="inbox-row inbox-row--mine"><div class=${'inbox-bubble inbox-bubble--mine ' + DRAFT_CLASS[kind]}>
    <div class="inbox-draft-label">🔗 A suggested reply is ready</div>
    <div class="inbox-bubble-body"><${Markdown} text=${DRAFT} /></div>
    <div class="inbox-draft-actions"><button type="button" class="poster-action">📄 Open the record</button>
      <button type="button" class="poster-action">Reject</button><button type="button" class="poster-slab poster-slab--control">Approve</button></div>
  </div></div></div></div></div>`);
/** The proposal as built and as the page draws it today (panels.js: Message's draft tone): the words
    in the text colour, no emoji, the actions on one line with one gap, Reject in the danger tone. */
const draftNow = () => pf(html`<div class="og og-ib"><${Message} tone="draft" label="A suggested reply is ready" body=${DRAFT}
  actions=${html`<${Action} small onClick=${noop}>Open the record<//><${Action} small tone="danger" onClick=${noop}>Reject<//><${Loud} control onClick=${noop}>Approve<//>`} /></div>`);

// ── Notifications: a notification that asks for a yes (notifications/frame.js inboxRows) ──
/** The row as the page draws it (List); `loud` draws the yes as the loud action (the proposal, as
    built), otherwise as the no is drawn, the action link's danger tone (the coral yes it was). */
const notice = (loud) => og('og-nt', html`<${List} cols="when-who-name-doors" keepCols><${Row}>
  <${When} at="09:12">2 h ago<//><${Who} sub="AIMEAT">Workflows<//>
  <${Name} unread meta="Send layout B to the ferry company?">Seat map review asks you<//>
  <${Doors}>${loud ? html`<${Loud} onClick=${noop}>Approve<//>` : html`<${Action} small tone="danger" onClick=${noop}>Approve<//>`}
    <${Action} small tone="danger" onClick=${noop}>Deny<//><${Action} small onClick=${noop}>Open<//><//><//><//>`);

// ── Offers: a delivery's status cell, 7rem wide as its column (offers/frame.js deliveryRows) ──
/** The cell as it was asked about: the status, " · " and one ★ letter per star given. */
const cell = (children) => pf(html`<div class="dl-cell-7"><div class="listing op-back"><div class="listing-row"><div class="listing-desc op-st">${children}</div></div></div></div>`);
const DONE = html`<span class="poster-status poster-status--fine">done</span>`;
const rowStars = () => cell(html`${DONE} · ${'★'.repeat(4)}`);
/** The cell as the page draws it today: the status Mark and the library's stars in their row cut (Stars row) in the List's cell. */
const libraryStars = () => pf(html`<div class="dl-cell-7"><${List} cols="name"><${Row}><${Desc} clip><${Mark} kind="status" tone="fine">done<//><${Stars} row value=${4} /><//><//><//></div>`);

// ── The kit's figure strip (FigureStrip) ──
/** `wrap` marks the proposal (Pebble's own entry) or the option (the strong weight everywhere). */
const strip = (wrap = '') => og('og-wal', html`<div class=${wrap}><${FigureStrip} items=${[
  { key: 'm', n: '928', label: 'morsels', sub: 'available 928 · held 0' },
  { key: 'c', n: '13', label: 'came and went', sub: 'rows: 13 · 9/25/2026' }]} /></div>`);

// ── The contents rail (tab-page.css), its phone shadow in organism.css ──
const RAIL = [['01', 'Morsels: from where, to where', '0 / −72'], ['02', 'Transactions', '13'], ['03', 'Money: shares and trades', ''], ['04', 'Ways to get paid', '1 / 3']];
/** `more` adds a lab class: the raised shadow at every width, or the rail's own shape value. */
const rail = (more = '') => og('og-wal dl-rail-stage', html`<nav class=${'og-rail' + more} aria-label="On this page"><span class="og-rail-label">On this page</span>
  ${RAIL.map(([n, name, em]) => html`<button type="button" key=${n} class="og-rail-link"><i>${n}</i>${name}<em>${em}</em></button>`)}</nav>`);

// ── The classic card, as Security draws it inside Settings (Card's section tone) ──
const ORIGINS = 'Effective origins: all origins (*)';
const card = () => pf(html`<${Card} tone="section" title="Allowed origins" aside=${html`<${Mark}>Inherited<//>`}>
  <${Note}>${ORIGINS}<//><${Action} small onClick=${noop}>Edit<//><//>`);
/** The option: the same card with Pebble's card entry winning (lab class on the card, which the component takes no class for). */
const themeCard = () => pf(html`<div class="card poster-row--thing card-section dl-card-theme"><div class="card-header"><h4 class="sub-heading">Allowed origins</h4><${Mark}>Inherited<//></div>
  <${Note}>${ORIGINS}<//><${Action} small onClick=${noop}>Edit<//></div>`);

// ── The dark grounds: the portfolio page's thumbnail (List's Thumb, portfolio/page.js) ──
const thumb = () => pf(html`<${List} cols="mark-name-doors"><${Row}><${Thumb} /><${Name} meta="published 9/25/2026 · 1 kB">Sandbox<//>
  <${Doors}><${Action} small row onClick=${noop}>Preview<//><//><//><//>`);

// ── The phone Menu button (SettingsFrame.js) ──
const toggle = () => html`<button type="button" class="settings-frame-toggle">☰ Menu</button>`;
const slab = () => html`<button type="button" class="poster-slab">☰ Menu</button>`;

// ── The top bar's language switch and menu button (top-bar.css) ──
/** `wrap` marks Pebble's own entry (the proposal) or the shape value in every theme (the option). */
const langSwitch = (wrap = '') => html`<div class=${wrap}><div class="topnav-center"><button type="button" class="lang-btn active">EN</button><button type="button" class="lang-btn">FI</button><button type="button" class="lang-btn">ES</button></div></div>`;
const burger = (wrap = '') => html`<div class=${wrap}><button type="button" class="topnav-burger" aria-label="Menu">☰</button></div>`;

// ── The overview's band (NumberBand, as landing-page.cards.js ProfileCard gives it the numbers) ──
const STATS = [['📱', '38', 'Apps', false], ['🧠', '52', 'Memories', false], ['💎', '928', 'Morsels', true], ['🤖', '12', 'Agents', false]];
/** `wrap` marks the fix in Pebble's data (lab class; AIMEAT is not touched by it). */
const band = (wrap = '') => pf(html`<div class=${wrap}><${NumberBand} items=${STATS.map(([icon, n, label, fine]) => ({ key: label, icon, n, label, fine, onOpen: noop }))} /></div>`);

export const FINAL_SAMPLES = {
  'draft-reply': [
    { id: 'dashed-box', measure: '.inbox-bubble--draft', render: () => draft(), after: after('.message-draft', draftNow) },
    { id: 'sun-dashed', measure: '.dl-draft-sun', render: () => draft('sun'), after: after('.message-draft', draftNow) },
  ],
  'notifications-primary': [
    { id: 'coral-door', measure: '.listing-doors > :first-child', solo: '.listing-doors', render: () => notice(false),
      after: after('.listing-doors', () => notice(true), '.poster-slab') },
  ],
  'offer-row-stars': [
    { id: 'row-stars', measure: '.op-st', solo: '.dl-cell-7', render: rowStars, after: after('.dl-cell-7', libraryStars, '.list-clip-cell') },
  ],
  // ── Drawn in AIMEAT and in Pebble (the decisions' `look`). ──
  'figure-weight': [
    { id: 'words-800', measure: '.og-strip span', solo: '.og-strip', render: () => strip(), after: after('.og-strip', () => strip('dl-pebble-strip'), '.og-strip span') },
    { id: 'strong-600', measure: '.og-strip span', solo: '.og-strip', render: () => strip('dl-strip-strong'), after: after('.og-strip', () => strip('dl-pebble-strip'), '.og-strip span') },
  ],
  'rail-phone-shadow': [
    { id: 'phone-6px', measure: '.og-rail', render: () => rail(), after: after('.og-rail', () => rail(' dl-rail-raised')) },
    { id: 'rail-value', measure: '.og-rail', render: () => rail(' dl-rail-value'), after: after('.og-rail', () => rail(' dl-rail-raised')) },
  ],
  'classic-cards': [
    { id: 'section', measure: '.card', render: card, after: 'same' },
    { id: 'theme-card', measure: '.card', render: themeCard, after: after('.card', card) },
  ],
  'dark-ground': [
    { id: 'rail', measure: '.og-rail', render: () => rail(), after: 'same' },
    { id: 'thumb', measure: '.list-thumb', solo: '.listing-row', render: thumb, after: 'same' },
  ],
  'phone-menu-button': [
    { id: 'toggle', measure: '.settings-frame-toggle', render: toggle, after: after('.poster-slab', slab) },
  ],
  'top-bar-corners': [
    { id: 'lang-switch', measure: '.topnav-center', render: () => langSwitch(), after: after('.topnav-center', () => langSwitch('dl-pebble-entry')) },
    { id: 'menu-button', measure: '.topnav-burger', render: () => burger(), after: after('.topnav-burger', () => burger('dl-pebble-entry')) },
    { id: 'shape-value', measure: '.topnav-center', render: () => langSwitch('dl-corner-control'), after: after('.topnav-center', () => langSwitch('dl-pebble-entry')) },
  ],
  'pebble-band': [
    { id: 'band-figures', measure: '.number-band-value', solo: '.number-band-row', render: () => band('dl-pebble-was'), after: after('.number-band-row', () => band(), '.number-band-value') },
  ],
};

export const FINAL_PROPOSALS = {
  'draft-reply': {
    measure: '.message-draft',
    render: draftNow,
  },
  'notifications-primary': {
    measure: '.poster-slab',
    render: () => notice(true),
  },
  'offer-row-stars': {
    measure: '.list-clip-cell',
    render: libraryStars,
  },
  'figure-weight': {
    measure: '.og-strip span',
    render: () => strip('dl-pebble-strip'),
  },
  'rail-phone-shadow': {
    measure: '.og-rail',
    render: () => rail(' dl-rail-raised'),
  },
  'dark-ground': {
    measure: '.og-rail',
    render: () => html`<div class="dl-stack">${tone('the contents rail', rail())}${tone('the page thumbnail', thumb())}</div>`,
  },
  'phone-menu-button': {
    measure: '.poster-slab',
    render: slab,
  },
  'top-bar-corners': {
    measure: '.topnav-center',
    render: () => html`<div class="dl-stack">${tone('the language switch', langSwitch('dl-pebble-entry'))}${tone('the menu button, on a phone', burger('dl-pebble-entry'))}</div>`,
  },
  'pebble-band': {
    measure: '.number-band-value',
    render: () => band(),
  },
};
