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
import { DataMapLine, DataMapPanel } from '/components/DataMap.js';
import { DATA_MAP_SPEC } from '/components/data-map/model.js';
import { TagList } from '/components/TagList.js';
import { openAppSandboxed } from '/js/app-sandbox.js';
import { McpSetupGuide } from '/views/profile/ai-setup-guide.js';
import { OwnAimeatBlock } from '/views/surface/blocks-home.js';

const html = htm.bind(h);
const noop = () => {};

const MARKDOWN = '## A heading\n\nA paragraph with **bold**, *italic*, `code` and [a link](https://aimeat.io).\n\n- one\n- two\n\n> A quote.\n\n| Name | Value |\n|---|---|\n| a | 1 |\n\n```\nconst x = 1;\n```';
const AI_RECORD = { level: 'ai-generated', disclosure: { required: true, strength: 'full' } };
const DATA_MAP = {
  spec: DATA_MAP_SPEC, source: 'declared', form: 'one-person',
  what: 'A notebook that keeps your notes and nothing else.', usedFor: 'Your own notes.',
  arrangement: 'One record per notebook.',
  held: [{ what: 'notebook.main', holds: 'Your notes', where: 'owner-memory-private', kind: 'content', usedFor: 'feature', readers: 'owner', lossRisk: 'low', keptFor: 'until-deleted', why: 'The notes themselves.' }],
};

/** The sandbox overlay opens itself when this demo is drawn, so its look can be seen. */
function SandboxOpen() {
  useEffect(() => { openAppSandboxed('/v1/portal', 'Front page'); }, []);
  return html`<p>The overlay covers this frame.</p>`;
}

/** A store address exists in this frame only, so the demo card draws. */
function OwnAimeatDemo() {
  const w = /** @type {any} */ (window);
  w.__SITE = { ...(w.__SITE || {}), store: w.__SITE?.store || 'https://store.example.com' };
  return html`<${OwnAimeatBlock} />`;
}

export const SHARED_DEMOS = {
  'card-menu': { height: 260, variants: [
    { name: 'off', render: (ex) => html`<${CardMenu} state="off" label=${ex.label} actions=${[{ label: 'Take it off your open items', run: noop }]} />` },
    { name: 'open', render: (ex) => html`<${CardMenu} state="open" label=${ex.label} actions=${[{ label: 'Take it off your open items', run: noop }]} />` },
    { name: 'working', render: (ex) => html`<${CardMenu} state="working" label=${ex.label} actions=${[{ label: 'Take it off your open items', run: noop }]} />` },
  ] },
  'markdown': { variants: [{ name: 'every element', render: () => html`<${Markdown} text=${MARKDOWN} />` }] },
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
  'hello-mcp': { variants: [
    { name: 'the setup guide', render: () => html`<${McpSetupGuide} />` },
  ] },
  'contact-picker': { height: 320, variants: [
    { name: 'default', render: (ex) => html`<${ContactPicker} value=${ex.value} placeholder=${ex.placeholder} onChange=${noop} onSubmit=${noop} />` },
  ] },
  'data-map': { variants: [
    { name: 'the line (unused)', render: () => html`<${DataMapLine} stamp=${{ spec: DATA_MAP_SPEC, summary: 'Your notes stay in your own memory.' }} onOpen=${noop} />` },
    { name: 'the panel (unused)', render: () => html`<${DataMapPanel} map=${DATA_MAP} findings=${[]} appLabel="Notebook" />` },
  ] },
  'tags': { variants: [{ name: 'default', render: (ex) => html`<${TagList} tags=${ex.tags} max=${ex.max} onTag=${noop} />` }] },
  'app-sandbox': { height: 420, variants: [{ name: 'open', render: () => html`<${SandboxOpen} />` }] },
  'own-aimeat': { variants: [{ name: 'on a demo node', render: () => html`<${OwnAimeatDemo} />` }] },
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
  ] },
  'slab': { variants: [
    { name: 'default', render: () => html`<button type="button" class="btn-primary poster-slab">Do it</button>` },
    { name: 'large', render: () => html`<a class="btn-primary poster-slab poster-slab--large" href="#">Continue in the chat</a>` },
    { name: 'control', render: () => html`<button type="button" class="btn-primary poster-slab poster-slab--control">Send</button>` },
  ] },
  'box': { variants: [
    { name: 'default', render: () => el('div', 'poster-box', 'A framed object.') },
    { name: 'avatar', render: () => el('span', 'poster-box poster-box--avatar', 'AB') },
    { name: 'avatar small', render: () => el('span', 'poster-box poster-box--avatar poster-box--small', 'AB') },
    { name: 'meter', render: () => html`<svg class="poster-box poster-box--meter" width="200" height="12"><rect width="120" height="12"></rect></svg>` },
    { name: 'quota', render: () => html`<svg class="poster-box poster-box--meter poster-box--quota" width="200" height="12"><rect width="80" height="12"></rect></svg>` },
  ] },
  'frame': { variants: [{ name: 'default', render: () => el('div', 'poster-frame', 'Something with an edge.') }] },
  'dialog': { variants: [{ name: 'default (unused)', render: () => el('div', 'poster-dialog', 'A dialog box.') }] },
  'record': { variants: [
    { name: 'default', render: () => html`<div class="poster-record"><h3 class="poster-record-title">A record</h3><p>Its details.</p></div>` },
    { name: 'small title', render: () => html`<div class="poster-record"><h3 class="poster-record-title poster-record-title--small">A record</h3></div>` },
  ] },
  'choice': { variants: [
    { name: 'default', render: () => html`<button type="button" class="poster-choice"><b>Daily</b>Every morning at eight.</button>` },
    { name: 'chosen', render: () => html`<button type="button" class="poster-choice on"><b>Weekly</b>On Mondays.</button>` },
  ] },
  'sticker': { variants: [{ name: 'default', render: () => html`<div class="poster-sticker"><span class="poster-stat-number poster-stat-number--small">L3</span><a class="poster-action" href="#">Change</a></div>` }] },
  'aside': { variants: [
    { name: 'default', render: () => el('aside', 'poster-aside', 'A note beside the main flow.') },
    { name: 'small', render: () => el('aside', 'poster-aside poster-aside--small', 'A short note.') },
    { name: 'large', render: () => el('aside', 'poster-aside poster-aside--large', 'A note with more room.') },
    { name: 'irreversible', render: () => el('aside', 'poster-aside poster-aside--irreversible', 'This cannot be undone.') },
  ] },
  'chip': { variants: [{ name: 'default (unused)', render: () => el('span', 'poster-chip', 'music') }] },
  'crumb': { variants: [{ name: 'default', render: () => el('span', 'poster-crumb', 'Profile') }] },
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
