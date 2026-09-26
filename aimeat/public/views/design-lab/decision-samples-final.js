/**
 * @file public/views/design-lab/decision-samples-final.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live samples and proposal pictures of the last round of Settings & Controls
 *   (decisions-final.js), in the shape decision-samples.js describes: per sample `measure`, `solo`
 *   and `after`. decision-samples.js spreads these into SAMPLES and PROPOSALS. Each is drawn from its
 *   page's markup with fixed words. The decisions that are also drawn in Pebble (their `look`) mark
 *   the part a Pebble entry of its own would change with a lab class that only Pebble's frames read
 *   (css/design-lab-proposals.css, `[data-aimeat-theme="pebble"]`). The text pages draw nothing.
 * @structure FINAL_SAMPLES — { [decisionId]: [{ id, measure, solo?, render(), after }] } · FINAL_PROPOSALS — { [decisionId]: { measure, render() } }
 * @usage import { FINAL_SAMPLES, FINAL_PROPOSALS } from './decision-samples-final.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the suggested reply, the notification's main answer, a delivery
 *     row's stars, and the Pebble questions (the figure strip's words, the contents rail's phone
 *     shadow, the classic cards, the dark ground, the phone Menu button, the top bar's corners, the
 *     overview band).
 */
import { h } from 'preact';
import htm from 'htm';
import { Markdown } from '/components/Markdown.js';

const html = htm.bind(h);
/** An element as the proposal draws it, alone: the `after` of a sample. `measure` defaults to `solo`. */
const after = (solo, render, measure) => ({ solo, render, measure });
/** A tone of a proposal, captioned with its name under the example word. */
const tone = (name, children) => html`<span class="poster-specimen-tone">${children}<small>${name}</small></span>`;
/** Settings parts are drawn inside the Settings scope root; a kit page's parts inside its `.og` root too. */
const pf = (children) => html`<div class="pf">${children}</div>`;
const og = (root, children) => pf(html`<div class=${`og ${root}`}>${children}</div>`);

// ── Messages: a suggested reply waiting for your yes (inbox-tab/panels.js) ──
const DRAFT = 'Yes, Friday works. I will bring the two seat maps.';
/** `kind`: 'box' as today, 'readable' the box with its words in the text colour (the proposal),
    'sun' the option, your own message's yellow with a dashed frame (lab classes). */
const DRAFT_CLASS = { box: 'inbox-bubble--draft', readable: 'inbox-bubble--draft dl-draft-readable', sun: 'dl-draft-sun' };
const draft = (kind = 'box') => kind === 'readable' ? draftNow() : pf(html`<div class="inbox og og-ib"><div class="inbox-panel"><div class="inbox-msgs">
  <div class="inbox-row inbox-row--mine"><div class=${'inbox-bubble inbox-bubble--mine ' + DRAFT_CLASS[kind]}>
    <div class="inbox-draft-label">🔗 A suggested reply is ready</div>
    <div class="inbox-bubble-body"><${Markdown} text=${DRAFT} /></div>
    <div class="inbox-draft-actions"><button type="button" class="poster-action">📄 Open the record</button>
      <button type="button" class="poster-action">Reject</button><button type="button" class="poster-slab poster-slab--control">Approve</button></div>
  </div></div></div></div></div>`);
/** The proposal as built (panels.js since c8cb2ee15): the box with its words in the text colour, no
    emoji, the actions on one line with one gap, Reject in the danger tone. */
const draftNow = () => pf(html`<div class="inbox og og-ib"><div class="inbox-panel"><div class="inbox-msgs">
  <div class="inbox-row inbox-row--mine"><div class="inbox-bubble inbox-bubble--draft">
    <div class="inbox-draft-label">A suggested reply is ready</div>
    <div class="inbox-bubble-body"><${Markdown} text=${DRAFT} /></div>
    <div class="inbox-draft-actions"><button type="button" class="poster-action poster-action--small">Open the record</button>
      <button type="button" class="poster-action poster-action--small poster-action--danger">Reject</button><button type="button" class="poster-slab poster-slab--control">Approve</button></div>
  </div></div></div></div></div>`);

// ── Notifications: a notification that asks for a yes (notifications/frame.js inboxRows) ──
/** `main` is the class of the main answer: the coral door today, the loud action in the proposal. */
const notice = (main) => og('og-nt', html`<div class="nt-rows">
  <div class="nt-when poster-time"><b>2 h ago</b>09:12</div>
  <div class="nt-src">Workflows<small>AIMEAT</small></div>
  <div class="nt-what unread"><b>Seat map review asks you</b><small>Send layout B to the ferry company?</small></div>
  <div class="og-tbl-door nt-doors"><button type="button" class=${main}>Approve</button><button type="button" class="og-door og-door--danger">Deny</button>
    <button type="button" class="poster-action poster-action--small poster-action--row">Open</button></div></div>`);
/** The proposal as built (frame.js since c8cb2ee15): the library's row of actions, one gap, one line. */
const noticeNow = () => og('og-nt', html`<div class="nt-rows">
  <div class="nt-when poster-time"><b>2 h ago</b>09:12</div>
  <div class="nt-src">Workflows<small>AIMEAT</small></div>
  <div class="nt-what unread"><b>Seat map review asks you</b><small>Send layout B to the ferry company?</small></div>
  <div class="og-tbl-door nt-doors"><div class="og-doors"><button type="button" class="poster-slab">Approve</button>
    <button type="button" class="poster-action poster-action--small poster-action--danger">Deny</button>
    <button type="button" class="poster-action poster-action--small">Open</button></div></div></div>`);

// ── Offers: a delivery's status cell, 7rem wide as its column (offers/frame.js deliveryRows) ──
const cell = (children) => pf(html`<div class="dl-cell-7"><div class="listing op-back"><div class="listing-row"><div class="listing-desc op-st">${children}</div></div></div></div>`);
const DONE = html`<span class="poster-status poster-status--fine">done</span>`;
/** The library's stars (rating-stars.css) read in a line, cut small for the column (lab class). */
const smallStars = (n) => html`<span class="op-stars op-stars--shown dl-stars--row" aria-label=${`${n} of 5`}>${[1, 2, 3, 4, 5].map((i) => html`<span key=${i} class=${'op-star' + (i <= n ? ' on' : '')} aria-hidden="true">★</span>`)}</span>`;
const rowStars = () => cell(html`${DONE} · ${'★'.repeat(4)}`);
const libraryStars = () => cell(html`${DONE} ${smallStars(4)}`);

// ── The kit's figure strip (figure-strip.css) ──
/** `wrap` marks the proposal (Pebble's own entry) or the option (the strong weight everywhere). */
const strip = (wrap = '') => og('og-wal', html`<div class=${wrap}><div class="og-strip">
  <div><b>928</b><span>morsels</span><small>available 928 · held 0</small></div>
  <div><b>13</b><span>came and went</span><small>rows: 13 · 9/25/2026</small></div></div></div>`);

// ── The contents rail (tab-page.css), its phone shadow in organism.css ──
const RAIL = [['01', 'Morsels: from where, to where', '0 / −72'], ['02', 'Transactions', '13'], ['03', 'Money: shares and trades', ''], ['04', 'Ways to get paid', '1 / 3']];
/** `more` adds a lab class: the raised shadow at every width, or the rail's own shape value. */
const rail = (more = '') => og('og-wal dl-rail-stage', html`<nav class=${'og-rail' + more} aria-label="On this page"><span class="og-rail-label">On this page</span>
  ${RAIL.map(([n, name, em]) => html`<button type="button" key=${n} class="og-rail-link"><i>${n}</i>${name}<em>${em}</em></button>`)}</nav>`);

// ── The classic card (card.css), as Security draws it inside Settings ──
const card = (more = '') => pf(html`<div class=${'card poster-row--thing' + more}><div class="flex-between mb-half"><span class="sub-heading">Allowed origins</span><span class="poster-chip">Inherited</span></div>
  <div class="poster-hint mb-half">Effective origins: all origins (*)</div><button type="button" class="poster-action poster-action--small">Edit</button></div>`);

// ── The dark grounds: the portfolio page's thumbnail (page-row.css) ──
const thumb = () => pf(html`<div class="pf-pg"><div class="pf-thumb" aria-hidden="true"><i></i><i></i></div>
  <div class="pf-pg-words"><b>Sandbox</b><small>published 9/25/2026 · 1 kB</small></div></div>`);

// ── The phone Menu button (SettingsFrame.js) ──
const toggle = () => html`<button type="button" class="settings-frame-toggle">☰ Menu</button>`;
const slab = () => html`<button type="button" class="poster-slab">☰ Menu</button>`;

// ── The top bar's language switch and menu button (top-bar.css) ──
/** `wrap` marks Pebble's own entry (the proposal) or the shape value in every theme (the option). */
const langSwitch = (wrap = '') => html`<div class=${wrap}><div class="topnav-center"><button type="button" class="lang-btn active">EN</button><button type="button" class="lang-btn">FI</button><button type="button" class="lang-btn">ES</button></div></div>`;
const burger = (wrap = '') => html`<div class=${wrap}><button type="button" class="topnav-burger" aria-label="Menu">☰</button></div>`;

// ── The overview's band (landing-page.cards.js ProfileCard) ──
const STATS = [['38', 'Apps', false], ['52', 'Memories', false], ['928', 'Morsels', true], ['12', 'Agents', false]];
/** `wrap` marks the fix in Pebble's data (lab class; AIMEAT is not touched by it). */
const band = (wrap = '') => pf(html`<div class=${wrap}><div class="pf-lp-stats">${STATS.map(([val, label, green]) => html`
  <button type="button" key=${label} class="pf-lp-stat pf-lp-stat-link"><span class="pf-lp-stat-val poster-stat-number poster-stat-number--band${green ? ' pf-lp-stat-green' : ''}">${val}</span>
    <span class="pf-lp-stat-label">${label}</span></button>`)}</div></div>`);

export const FINAL_SAMPLES = {
  'draft-reply': [
    { id: 'dashed-box', measure: '.inbox-bubble--draft', render: () => draft(), after: after('.inbox-bubble--draft', () => draft('readable')) },
    { id: 'sun-dashed', measure: '.dl-draft-sun', render: () => draft('sun'), after: after('.inbox-bubble--draft', () => draft('readable')) },
  ],
  'notifications-primary': [
    { id: 'coral-door', measure: '.og-door--coral', solo: '.nt-doors', render: () => notice('og-door og-door--coral'),
      after: after('.nt-doors', noticeNow, '.poster-slab') },
  ],
  'offer-row-stars': [
    { id: 'row-stars', measure: '.op-st', solo: '.dl-cell-7', render: rowStars, after: after('.dl-cell-7', libraryStars, '.op-st') },
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
    { id: 'section', measure: '.card', render: () => card(), after: 'same' },
    { id: 'theme-card', measure: '.card', render: () => card(' dl-card-theme'), after: after('.card', () => card()) },
  ],
  'dark-ground': [
    { id: 'rail', measure: '.og-rail', render: () => rail(), after: 'same' },
    { id: 'thumb', measure: '.pf-thumb', solo: '.pf-pg', render: thumb, after: 'same' },
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
    { id: 'band-figures', measure: '.poster-stat-number--band', solo: '.pf-lp-stats', render: () => band(), after: after('.pf-lp-stats', () => band('dl-pebble-fix'), '.poster-stat-number--band') },
  ],
};

export const FINAL_PROPOSALS = {
  'draft-reply': {
    measure: '.inbox-bubble--draft',
    render: draftNow,
  },
  'notifications-primary': {
    measure: '.poster-slab',
    render: noticeNow,
  },
  'offer-row-stars': {
    measure: '.op-st',
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
    measure: '.poster-stat-number--band',
    render: () => band('dl-pebble-fix'),
  },
};
