/**
 * @file public/views/design-lab/demos-shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's live demos for the older shared components (the corner menu, the
 *   Markdown renderer, the AI label and the rest) and for the shapes of poster.css. A component is
 *   drawn by its real code; a shape is drawn as the markup the catalogue gives it, one render per
 *   cut.
 * @structure SHARED_DEMOS · SHAPE_DEMOS — { [id]: { variants: [{ name, render(ex) }], height?, emptyNote? } }
 * @usage import { SHARED_DEMOS, SHAPE_DEMOS } from './demos-shared.js';
 * @version-history
 *   v1.14.0 — 2026-09-27 — The own-aimeat demo moves to demos-operator.js, drawn by calling OwnAimeat;
 *     OwnAimeatDemo and its OwnAimeatBlock import go.
 *   v1.13.0 — 2026-09-27 — The box and choice tile shapes' demos are box-shape and choice-shape, as their entries.
 *   v1.12.0 — 2026-09-26 — The Markdown reader's small cut beside the full one (Jouni's decision "Small reader").
 *   v1.11.0 — 2026-09-26 — The box's raised tone.
 *   v1.10.0 — 2026-09-26 — The action link's Settings tones: small, lower and row.
 *   v1.9.0 — 2026-09-26 — A message is the chat's turn (components/Turn.js classes): your words bold on the sun, the other side's beside the pale coral spine, the name above the words, the time and the read marks under them with Copy and Listen, the other six actions behind one ⋯ (CardMenu inline); an agent's options are the chat's choices. The frame, the picture beside the other side, the action pill and the Chat tab's bubbles, pairing lines and small reader go; a suggested reply waiting for approval keeps its dashed box (a unification: Jouni's decision "Message").
 *   v1.8.0 — 2026-09-26 — The avatar's agent tone (.poster-box--agent) beside the plain and small avatars.
 *   v1.7.0 — 2026-09-25 — The icon button's pressed tone (.poster-icon.is-on), beside the unpressed one.
 *   v1.6.0 — 2026-09-25 — The Tag's four tones and the Status in the lab's library (Jouni's decisions "Tag" and "Status").
 *   v1.5.0 — 2026-09-24 — The action link's notice and jump tones.
 *   v1.4.0 — 2026-09-24 — The menu row's demo.
 *   v1.3.0 — 2026-09-24 — The tab's tile tone.
 *   v1.2.0 — 2026-09-24 — The icon button's demo.
 *   v1.1.0 — 2026-09-23 — The data map's and the dialog shape's demos go with them (Jouni's
 *     decision).
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import htm from 'htm';
import { CardMenu } from '/components/CardMenu.js';
import { Markdown } from '/components/Markdown.js';
import { AiLabel, AiInteractionNotice } from '/components/ai-label.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { ImageView } from '/components/ImageDeliverable.js';
import { InstallCta } from '/components/InstallCta.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { McpQuickConnect } from '/components/McpInstall.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { TagList } from '/components/TagList.js';
import { openAppSandboxed } from '/js/app-sandbox.js';

const html = htm.bind(h);
const noop = () => {};

const MARKDOWN = '## A heading\n\nA paragraph with **bold**, *italic*, `code` and [a link](https://aimeat.io).\n\n- one\n- two\n\n> A quote.\n\n| Name | Value |\n|---|---|\n| a | 1 |\n\n```\nconst x = 1;\n```';
const AI_RECORD = { level: 'ai-generated', disclosure: { required: true, strength: 'full' } };

/** The sandbox overlay opens itself when this demo is drawn, so its look can be seen. */
function SandboxOpen() {
  useEffect(() => { openAppSandboxed('/v1/portal', 'Front page'); }, []);
  return html`<p>The overlay covers this frame.</p>`;
}

export const SHARED_DEMOS = {
  'card-menu': { height: 260, variants: [
    { name: 'off', render: (ex) => html`<${CardMenu} state="off" label=${ex.label} actions=${[{ label: 'Take it off your open items', run: noop }]} />` },
    { name: 'open', render: (ex) => html`<${CardMenu} state="open" label=${ex.label} actions=${[{ label: 'Take it off your open items', run: noop }]} />` },
    { name: 'working', render: (ex) => html`<${CardMenu} state="working" label=${ex.label} actions=${[{ label: 'Take it off your open items', run: noop }]} />` },
    { name: 'inline, in a line of words', render: () => html`<div class="poster-time poster-turn-meta">10:42 <${CardMenu} inline="start" label="More" actions=${[{ label: 'Mark important', run: noop }, { label: 'Delete this message', run: noop, danger: true }]} /></div>` },
    { name: 'word: opens from words', render: () => html`<${CardMenu} word="Backups and imports" label="Back up your apps, or bring them back"
        actions=${[{ label: 'Export all apps as a zip', run: noop }, { label: 'Export the ones I pick', run: noop }, { divider: true }, { label: 'Import a zip', run: noop }]} />` },
    { name: 'word, framed', render: () => html`<${CardMenu} word="Backups and imports" framed
        actions=${[{ label: 'Export all apps as a zip', run: noop }, { label: 'Export the ones I pick', run: noop }, { divider: true }, { label: 'Import a zip', run: noop }]} />` },
    { name: 'word, disabled while it runs', render: () => html`<${CardMenu} word="Exporting Harbour Studio's twelve apps…" framed disabled
        actions=${[{ label: 'Export all apps as a zip', run: noop }]} />` },
  ] },
  'markdown': { variants: [{ name: 'every element', render: () => html`<${Markdown} text=${MARKDOWN} />` },
    { name: 'small', render: () => html`<${Markdown} text=${MARKDOWN} small />` }] },
  'ai-label': { variants: [
    { name: 'inline label', render: () => html`<${AiLabel} record=${AI_RECORD} recordUrl="#" variant="inline" />` },
    { name: 'block label', render: () => html`<${AiLabel} record=${AI_RECORD} recordUrl="#" variant="block" />` },
    { name: 'talking to an AI', render: () => html`<${AiInteractionNotice} recordUrl="#" />` },
  ] },
  'voice-recorder': { variants: [
    { name: 'default', render: (ex) => html`<${VoiceRecorder} maxSeconds=${ex.maxSeconds} className=${ex.className} onRecorded=${noop} />` },
    { name: 'disabled', render: (ex) => html`<${VoiceRecorder} maxSeconds=${ex.maxSeconds} className=${ex.className} disabled=${true} onRecorded=${noop} />` },
  ] },
  'image-deliverable': { variants: [
    { name: 'default', render: () => html`<${ImageView} desc=${{ url: '/og-image.png', alt: 'The node picture' }} />` },
    { name: 'broken address', render: () => html`<${ImageView} desc=${{ url: '/no-such-picture.png', alt: 'missing' }} />` },
  ] },
  'install-cta': { emptyNote: 'Draws nothing here unless this browser can install the site.', variants: [
    { name: 'full', render: () => html`<${InstallCta} />` },
    { name: 'compact', render: () => html`<${InstallCta} compact=${true} />` },
  ] },
  'managed-env': { variants: [
    { name: 'full', render: () => html`<${ManagedEnvNote} />` },
    { name: 'compact', render: () => html`<${ManagedEnvNote} compact=${true} />` },
  ] },
  'mcp-install': { variants: [
    { name: 'quick connect', render: (ex) => html`<${McpQuickConnect} serverName=${ex.serverName} title=${ex.title} lead="The shortest way in, for each tool." />` },
  ] },
  'contact-picker': { height: 320, variants: [
    { name: 'default', render: (ex) => html`<${ContactPicker} value=${ex.value} placeholder=${ex.placeholder} onChange=${noop} onSubmit=${noop} />` },
  ] },
  'tags': { variants: [{ name: 'default', render: (ex) => html`<${TagList} tags=${ex.tags} max=${ex.max} onTag=${noop} />` }] },
  'app-sandbox': { height: 420, variants: [{ name: 'open', render: () => html`<${SandboxOpen} />` }] },
};

/** One element with the shape's classes; `cls` is the base, `extra` the cut. */
const el = (tag, cls, children) => h(tag, { class: cls }, children);

export const SHAPE_DEMOS = {
  'page-title': { variants: [{ name: 'default', render: () => el('h1', 'poster-page-title', 'Your agents') }] },
  'section': { variants: [
    { name: 'default', render: () => html`<section class="poster-section"><h2 class="poster-section-title">What you have made</h2><p>Rows under it.</p></section>` },
    { name: 'large', render: () => html`<section class="poster-section"><h2 class="poster-section-title poster-section-title--large">What you have made</h2></section>` },
  ] },
  'panel': { variants: [{ name: 'default', render: () => el('div', 'poster-panel', 'What the chosen tab shows.') }] },
  'row': { variants: [
    { name: 'default', render: () => el('div', 'poster-row', 'A row between two thin rules.') },
    { name: 'thing', render: () => el('div', 'poster-row poster-row--thing', 'One thing a person has.') },
  ] },
  'label': { variants: [{ name: 'default', render: () => el('span', 'poster-label', 'The prompt') }] },
  'action': { variants: [
    { name: 'action', render: () => html`<a class="poster-action" href="#">Settings</a>` },
    { name: 'tab', render: () => html`<span><button type="button" class="poster-tab is-on">Chosen</button> <button type="button" class="poster-tab">Another</button></span>` },
    { name: 'small', render: () => html`<button type="button" class="poster-action poster-action--small">New skill</button>` },
    { name: 'lower', render: () => html`<button type="button" class="poster-action poster-action--small poster-action--lower">Show 13 more</button>` },
    { name: 'row', render: () => html`<span><button type="button" class="poster-action poster-action--small poster-action--row">Open</button> <button type="button" class="poster-action poster-action--small poster-action--lower poster-action--row">Copy ref</button></span>` },
    { name: 'more', render: () => html`<button type="button" class="poster-action poster-action--more">Show all (12)</button>` },
    { name: 'quiet', render: () => html`<button type="button" class="poster-action poster-action--quiet">Copy conversation</button>` },
    { name: 'back', render: () => html`<a class="poster-action poster-action--back" href="#">↩ Back to your home</a>` },
    { name: 'text', render: () => html`<button type="button" class="poster-action poster-action--text">Listen</button>` },
    { name: 'notice', render: () => html`<button type="button" class="poster-action poster-action--notice">What does that mean?</button>` },
    { name: 'jump', render: () => html`<button type="button" class="poster-action poster-action--jump">↓ Latest</button>` },
    { name: 'fold tab', render: () => html`<span><button type="button" class="poster-tab poster-tab--fold is-on">Recent</button> <button type="button" class="poster-tab poster-tab--fold">Mine</button></span>` },
    { name: 'tile tab', render: () => html`<span><button type="button" class="poster-tab poster-tab--tile">Off</button> <button type="button" class="poster-tab poster-tab--tile is-on">Pixel grid</button> <button type="button" class="poster-tab poster-tab--tile">Hearts</button></span>` },
  ] },
  'slab': { variants: [
    { name: 'default', render: () => html`<button type="button" class="btn-primary poster-slab">Do it</button>` },
    { name: 'large', render: () => html`<a class="btn-primary poster-slab poster-slab--large" href="#">Continue in the chat</a>` },
    { name: 'control', render: () => html`<button type="button" class="btn-primary poster-slab poster-slab--control">Send</button>` },
  ] },
  'menu-row': { variants: [
    { name: 'default', render: () => html`<div class="poster-prompt-menu"><button type="button" class="poster-menu-row">Save as my own</button><button type="button" class="poster-menu-row">Give it to my agent</button></div>` },
  ] },
  'icon': { variants: [
    { name: 'default', render: () => html`<button type="button" class="poster-icon" aria-label="Attach a file">📎</button>` },
    { name: 'small', render: () => html`<button type="button" class="poster-icon poster-icon--small" aria-label="Delete">✗</button>` },
    { name: 'disabled', render: () => html`<button type="button" class="poster-icon" aria-label="Attach a file" disabled>📎</button>` },
    { name: 'pressed', render: () => html`<button type="button" class="poster-icon poster-icon--small" aria-pressed="false" title="Add to collection">🛒</button> <button type="button" class="poster-icon poster-icon--small is-on" aria-pressed="true" title="Remove from collection">🛒</button>` },
  ] },
  'box-shape': { variants: [
    { name: 'default', render: () => el('div', 'poster-box', 'A framed object.') },
    { name: 'raised', render: () => el('div', 'poster-box poster-box--raised', 'The row you opened, or the way to take first.') },
    { name: 'copy', render: () => el('div', 'poster-box poster-box--copy', 'A text to copy.') },
    { name: 'row', render: () => el('div', 'poster-box poster-box--row', 'One result in a list.') },
    { name: 'avatar', render: () => el('span', 'poster-box poster-box--avatar', 'AB') },
    { name: 'avatar small', render: () => el('span', 'poster-box poster-box--avatar poster-box--small', 'AB') },
    { name: 'avatar agent', render: () => el('span', 'poster-box poster-box--avatar poster-box--agent', 'AB') },
    { name: 'meter', render: () => html`<svg class="poster-box poster-box--meter" width="200" height="12"><rect width="120" height="12"></rect></svg>` },
    { name: 'quota', render: () => html`<svg class="poster-box poster-box--meter poster-box--quota" width="200" height="12"><rect width="80" height="12"></rect></svg>` },
  ] },
  'frame': { variants: [{ name: 'default', render: () => el('div', 'poster-frame', 'Something with an edge.') }] },
  'record': { variants: [
    { name: 'default', render: () => html`<div class="poster-record"><h3 class="poster-record-title">A record</h3><p>Its details.</p></div>` },
    { name: 'small title', render: () => html`<div class="poster-record"><h3 class="poster-record-title poster-record-title--small">A record</h3></div>` },
  ] },
  'choice-shape': { variants: [
    { name: 'default', render: () => html`<button type="button" class="poster-choice"><b>Daily</b>Every morning at eight.</button>` },
    { name: 'chosen', render: () => html`<button type="button" class="poster-choice on"><b>Weekly</b>On Mondays.</button>` },
  ] },
  'sticker': { variants: [{ name: 'default', render: () => html`<div class="poster-sticker"><span class="poster-stat-number poster-stat-number--small">L3</span><a class="poster-action" href="#">Change</a></div>` }] },
  'aside': { variants: [
    { name: 'default', render: () => el('aside', 'poster-aside', 'A note beside the main flow.') },
    { name: 'small', render: () => el('aside', 'poster-aside poster-aside--small', 'A short note.') },
    { name: 'large', render: () => el('aside', 'poster-aside poster-aside--large', 'A note with more room.') },
    { name: 'irreversible', render: () => el('aside', 'poster-aside poster-aside--irreversible', 'This cannot be undone.') },
    { name: 'waiting', render: () => el('div', 'poster-aside poster-aside--waiting', 'The next move is in your AI chat.') },
    { name: 'suggestion', render: () => el('div', 'poster-aside poster-aside--suggestion', 'Put this on your phone.') },
  ] },
  'chip': { variants: [
    { name: 'the four tones in a row', render: () => html`<span class="poster-chips"><span class="poster-chip">v1.4.0</span><span class="poster-chip poster-chip--sun">7 unread</span><span class="poster-chip poster-chip--coral">operator</span><span class="poster-chip poster-chip--ink">colleague</span></span>` },
  ] },
  'status': { variants: [
    { name: 'the four tones', render: () => html`<span class="poster-chips"><span class="poster-status poster-status--fine">active</span><span class="poster-status poster-status--attention">paused</span><span class="poster-status poster-status--danger">revoked</span><span class="poster-status poster-status--off">archived</span></span>` },
  ] },
  'crumb': { variants: [{ name: 'default', render: () => el('span', 'poster-crumb', 'Profile') }] },
  'count': { variants: [
    { name: 'waiting', render: () => el('span', 'poster-count poster-count--waiting', '3') },
    { name: 'tally', render: () => el('span', 'poster-count poster-count--tally', '4') },
    { name: 'small', render: () => el('span', 'poster-count poster-count--waiting poster-count--small', '7') },
  ] },
  'time': { variants: [{ name: 'default', render: () => el('span', 'poster-time', '10:42') }] },
  'stat': { variants: [
    { name: 'default', render: () => html`<a class="poster-stat" href="#"><span class="poster-stat-number">3</span>messages wait for you</a>` },
    { name: 'small number', render: () => html`<p>Row <span class="poster-stat-number poster-stat-number--small">12</span></p>` },
    { name: 'large number', render: () => html`<span class="poster-stat-number poster-stat-number--large">86</span>` },
    { name: 'step number', render: () => html`<span class="poster-stat-number poster-stat-number--small poster-stat-number--step">2</span>` },
  ] },
  'showroom-band': { flush: true, variants: [
    { name: 'ink', render: () => el('section', 'showroom-band', 'A band of the front page.') },
    { name: 'sun', render: () => el('section', 'showroom-band showroom-band--sun', 'The sun band.') },
  ] },
  'showroom-section': { variants: [
    { name: 'default', render: () => el('div', 'showroom-section', 'A room on the front page.') },
    { name: 'coral', render: () => el('div', 'showroom-section showroom-section--coral', 'A room with a coral shadow.') },
  ] },
  'showroom-door': { variants: [{ name: 'default', render: () => html`<a class="showroom-door" href="#">See how it works</a>` }] },
  'showroom-slab': { variants: [
    { name: 'hot', render: () => html`<a class="showroom-slab showroom-slab--hot" href="#">Get started</a>` },
    { name: 'sun', render: () => html`<a class="showroom-slab showroom-slab--sun" href="#">Get started</a>` },
    { name: 'ink', render: () => html`<a class="showroom-slab showroom-slab--ink" href="#">Get started</a>` },
  ] },
};
