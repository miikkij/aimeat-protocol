/**
 * @file public/views/design-lab/decision-samples.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live sample of every variant in the design lab's decisions, drawn with the real
 *   classes and, where a page draws it through a library part, by that part with the classes the
 *   page passes to it; and the picture of each proposal that is a new composition (Tag, Status,
 *   Count), drawn with the proposal classes in css/design-lab-proposals.css.
 *
 *   Per sample: `measure` is the element the preview page measures, so the values in Details are
 *   read from the drawn element, never written by hand; `solo` (default: `measure`) is the element
 *   or elements the decision is about, which the lab shows alone and large (Jouni: "Show only the
 *   thing being decided"); `after` draws the same element with the same words as the proposal
 *   would, or is 'same' when the proposal keeps its look. The lab computes what changes from the
 *   measured difference between the two, so its words cannot disagree with its pictures.
 *
 *   A sample must draw what its page draws. `pnpm design-lab:crops` measures the same element on
 *   the real page and in the preview and prints every difference. Ids match decisions-data.js;
 *   `pnpm check:ui-library` holds the two together.
 * @structure SAMPLES — { [decisionId]: [{ id, measure, solo?, render(), after }] } · PROPOSALS — { [decisionId]: { measure, render() } }
 * @usage import { SAMPLES, PROPOSALS } from './decision-samples.js';
 * @version-history
 *   v3.0.0 — 2026-09-23 — `solo` and `after` for every sample; the prompt card drawn with the
 *     underlined copy action the home's task chooser passes it (it was drawn with the red button of
 *     the first steps, which the signed-in home does not show).
 *   v2.0.0 — 2026-09-23 — Split by job with the decisions; proposal pictures for Tag, Status and Count;
 *     the morsel count drawn; the agent step's wrapper pair.
 *   v1.0.0 — 2026-09-23 — Initial: the decisions view (UI consolidation phase 2).
 */
import { h } from 'preact';
import htm from 'htm';
import { NamedRow } from '/components/NamedRow.js';
import { ThingLink } from '/components/ThingLink.js';
import { PromptCard } from '/components/PromptCard.js';
import { DayGroup, DayList, DayEmpty } from '/components/DayGroup.js';
import { ConversationAbout } from '/components/ConversationFrame.js';
import { WorkLog } from '/components/WorkLog.js';
import { ResultCards } from '/components/ResultCard.js';
import { Turn } from '/components/Turn.js';
import { ThreadList } from '/components/ThreadList.js';
import { TimelineRow, TimelineList } from '/components/Timeline.js';
import { ChooserResult, ChooserChoices, ChooserChoice } from '/components/Chooser.js';
import { WaitingNote } from '/components/WaitingNote.js';
import { MobileNudge } from '/components/Nudge.js';
import { FoldButton } from '/components/FoldButton.js';
import { ModeSwitch } from '/components/ModeSwitch.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { BackLink } from '/components/BackLink.js';
import { QuietNote } from '/components/QuietNote.js';
import { WrapperPair } from './demos-steps.js';

const html = htm.bind(h);
const noop = () => {};
const row = (children) => html`<div class="poster-specimen-row">${children}</div>`;
const AT = '2026-09-23T10:42:00Z';
const TOOLS = [{ title: 'aimeat_app_publish', status: 'completed' }, { title: 'aimeat_memory_write', status: 'failed' }];

/** An element as the proposal draws it, alone: the `after` of a sample. `measure` defaults to `solo`. */
const after = (solo, render, measure) => ({ solo, render, measure });
/** Admin parts read their colours from the admin page's own variables, set on `.adm`. */
const adm = (children) => html`<div class="adm">${children}</div>`;
const sidebar = (count) => adm(html`<nav class="adm-sidebar"><button type="button" class="adm-nav-item">Owners ${count}</button></nav>`);
/** Result cards sit inside a chat message, whose body sets their weight. */
const inTurn = (children) => html`<div class="poster-turn-body">${children}</div>`;
const tag = (tone, text) => html`<span class=${'dl-tag' + (tone ? ` dl-tag--${tone}` : '')}>${text}</span>`;
const status = (tone, text) => html`<span class=${`dl-status dl-status--${tone}`}>${text}</span>`;
const action = (text) => html`<a class="poster-action" href="#">${text}</a>`;
const tabs = (...names) => row(names.map((n, i) => html`<button type="button" class=${'poster-tab' + (i === 0 ? ' is-on' : '')}>${n}</button> `));
const prompt = () => html`<${PromptCard} label="Remember something" prompt="Tell me in the language I use with you…" className="poster-action" copyLabel="Copy prompt" copiedLabel="Copied" />`;
const result = () => inTurn(html`<${ResultCards} cards=${[{ kind: 'page', title: 'Team page', url: '#' }]} />`);
const waiting = () => html`<${WaitingNote} title="Waiting for your agent to knock.">The next move is in your AI chat.<//>`;

export const SAMPLES = {
  tag: [
    { id: 'poster-chip', measure: '.poster-chip', render: () => row(html`<span class="poster-chip">music</span> <span class="poster-chip">v1.4.0</span> <span class="poster-chip">colleague</span>`),
      after: after('.dl-tag', () => row(html`${tag('', 'music')} ${tag('', 'v1.4.0')} ${tag('', 'colleague')}`)) },
    { id: 'og-chip', measure: '.og-chip', render: () => row(html`<span class="og-chip">2 requests</span> <span class="og-chip og-chip--sun">7 unread</span> <span class="og-chip og-chip--dim">archived</span>`),
      after: after('.dl-tag', () => row(html`${tag('', '2 requests')} ${tag('sun', '7 unread')} ${tag('', 'archived')}`)) },
    { id: 'pf-mono-chip', measure: '.sch-badge', render: () => html`<div class="pf">${row(html`<span class="sch-badge sch-badge--ai">AI</span> <span class="sch-badge sch-badge--agent">agent task</span>`)}</div>`,
      after: after('.dl-tag', () => row(html`${tag('', 'AI')} ${tag('', 'agent task')}`)) },
    { id: 'row-tag', measure: '.sk-tag', render: () => row(html`<span class="sk-nm">aimeat-writing<span class="sk-tag">v1.4.0</span></span>`),
      after: after('.dl-tag', () => row(tag('', 'v1.4.0'))) },
    { id: 'adm-state-chip', measure: '.adm-own-chip', render: () => adm(row(html`<span class="adm-own-chip">member</span> <span class="adm-own-chip adm-own-chip--op">operator</span> <span class="adm-own-chip adm-own-chip--you">you</span>`)),
      after: after('.dl-tag', () => row(html`${tag('', 'member')} ${tag('coral', 'operator')} ${tag('sun', 'you')}`)) },
    { id: 'ct-tag', measure: '.ct-tag', render: () => row(html`<span class="ct-tags"><span class="ct-tag ct-tag--rel">colleague</span><span class="ct-tag">design</span><span class="ct-tag">helsinki</span></span>`),
      after: after('.dl-tag', () => row(html`${tag('ink', 'colleague')} ${tag('', 'design')} ${tag('', 'helsinki')}`)) },
    { id: 'tag-pill', measure: '.tag-pill', render: () => row(html`<span class="tag-pill active">music</span> <span class="tag-pill">notes</span> <span class="tag-pill">2026</span>`),
      after: after('.dl-tag', () => row(html`${tag('sun', 'music')} ${tag('', 'notes')} ${tag('', '2026')}`)) },
  ],
  status: [
    { id: 'pf-badge', measure: '.badge', render: () => html`<div class="pf">${row(html`<span class="badge badge-success">active</span> <span class="badge badge-warn">paused</span> <span class="badge badge-danger">revoked</span> <span class="badge badge-muted">archived</span>`)}</div>`,
      after: after('.dl-status', () => row(html`${status('fine', 'active')} ${status('attention', 'paused')} ${status('danger', 'revoked')} ${status('off', 'archived')}`)) },
    { id: 'adm-badge', measure: '.adm-badge', render: () => adm(row(html`<span class="adm-badge adm-badge-healthy">healthy</span> <span class="adm-badge adm-badge-warning">warning</span> <span class="adm-badge adm-badge-critical">critical</span> <span class="adm-badge adm-badge-muted">idle</span>`)),
      after: after('.dl-status', () => row(html`${status('fine', 'healthy')} ${status('attention', 'warning')} ${status('danger', 'critical')} ${status('off', 'idle')}`)) },
    // Chat instances passes bg-green and bg-dim, which no sheet styles: both draw the same grey word.
    { id: 'theme-badge', measure: '.badge', render: () => adm(html`<table><tbody><tr><td><span class="badge bg-green">Active</span></td><td><span class="badge bg-dim">anon</span></td></tr></tbody></table>`),
      after: after('.dl-status', () => row(html`${status('fine', 'Active')} ${status('off', 'anon')}`)) },
    { id: 'adm-grey-tag', measure: '.adm-st-chip', render: () => adm(row(html`<span class="adm-st-chip adm-st-chip--ok">per day</span> <span class="adm-st-chip adm-st-chip--bad">per day</span> <span class="adm-st-chip adm-st-chip--muted">quiet</span>`)),
      after: after('.dl-status', () => row(html`${status('fine', 'per day')} ${status('danger', 'per day')} ${status('off', 'quiet')}`)) },
  ],
  count: [
    { id: 'count-coral', measure: '.pf-side-badge', solo: '.pf-side-badge, .open-items-count', render: () => row(html`<span class="pf-side-badge">3</span> <span class="open-items-count">5</span>`),
      after: after('.dl-count', () => row(html`<span class="dl-count dl-count--waiting">3</span> <span class="dl-count dl-count--waiting">5</span>`)) },
    { id: 'count-bell', measure: '.notif-badge', render: () => row(html`<span class="poster-specimen-anchor"><span class="notif-badge">7</span></span>`),
      after: after('.dl-count', () => row(html`<span class="poster-specimen-anchor"><span class="dl-count dl-count--waiting dl-count--small">7</span></span>`)) },
    { id: 'count-morsels', measure: '.brand-morsels', render: () => row(html`<span class="brand-morsels">1000</span>`), after: 'same' },
    { id: 'count-admin-nav', measure: '.cnt', solo: '.adm-sidebar', render: () => sidebar(html`<span class="cnt">4</span>`),
      after: after('.adm-sidebar', () => sidebar(html`<span class="dl-count dl-count--tally">4</span>`), '.dl-count') },
  ],
  'row-label': [
    { id: 'poster-label', measure: '.poster-label', render: () => html`<${NamedRow} label="Assets"><${ThingLink} href="#" n=${30} label="Apps" /><//>`, after: 'same' },
    { id: 'prompt-label', measure: '.poster-prompt-head .poster-label', render: prompt,
      after: after('.poster-label', () => row(html`<span class="poster-label">Remember something</span>`)) },
    { id: 'og-label', measure: '.og-label', render: () => row(html`<span class="og-label">Visibility</span>`),
      after: after('.poster-label', () => row(html`<span class="poster-label">Visibility</span>`)) },
  ],
  'group-heading': [
    { id: 'day-title', measure: '.poster-day-title', render: () => html`<${DayList}><${DayGroup} title="Today"><${TimelineRow} category="made" text="You published a page" when="10:42" href="#" /><//><//>`, after: 'same' },
    { id: 'worklog-head', measure: '.poster-worklog-head', render: () => html`<${WorkLog} tools=${TOOLS} />`,
      after: after('.poster-day-title', () => row(html`<div class="poster-day-title dl-heading--grey">What was done</div>`)) },
    { id: 'conversation-label', measure: '.poster-conversation-label', render: () => html`<${ConversationAbout} label="This conversation" name="Make me a page" />`,
      after: after('.poster-day-title', () => row(html`<div class="poster-day-title">This conversation</div>`)) },
  ],
  timestamp: [
    { id: 'turn-meta', measure: '.poster-turn-meta', render: () => html`<${Turn} id="m1" turn=${{ role: 'agent', text: 'Your page is ready.', at: AT, model: 'claude-sonnet-5' }} />`, after: 'same' },
    { id: 'timeline-when', measure: '.poster-timeline-when', render: () => html`<${TimelineList}><${TimelineRow} category="agent" text="Your agent wrote a note" when="10:42" href="#" /><//>`,
      after: after('.poster-turn-meta', () => row(html`<span class="poster-turn-meta">10:42</span>`)) },
  ],
  'object-box': [
    { id: 'prompt-card', measure: '.poster-prompt', render: prompt,
      after: after('.poster-prompt', () => html`<div class="dl-box-plain">${prompt()}</div>`) },
    { id: 'chooser-box', measure: '.poster-box', render: () => html`<${ChooserResult}><p>Saved. Your note is in your memory.</p><//>`, after: 'same' },
    { id: 'result-card', measure: '.poster-result', render: result, after: 'same' },
  ],
  'attention-note': [
    { id: 'waiting-note', measure: '.poster-waiting', render: waiting,
      after: after('.poster-waiting', () => html`<div class="dl-as-aside">${waiting()}</div>`) },
    { id: 'nudge', measure: '.poster-nudge', render: () => html`<${MobileNudge} onDismiss=${noop} />`,
      after: after('.poster-nudge', () => html`<div class="dl-as-aside"><${MobileNudge} onDismiss=${noop} /></div>`) },
    { id: 'aside', measure: '.poster-aside', render: () => html`<aside class="poster-aside">The next move is in your AI chat: it has to run the prompt and show you a code.</aside>`, after: 'same' },
  ],
  'action-link': [
    { id: 'poster-action', measure: '.poster-action', render: () => row(html`<a class="poster-action" href="#">Settings</a> <a class="poster-action" href="#">Sign out</a>`), after: 'same' },
    { id: 'fold', measure: '.poster-fold', render: () => row(html`<${FoldButton} onClick=${noop}>Show all (12)<//>`),
      after: after('.poster-action', () => row(action('Show all (12)'))) },
    { id: 'rail-action', measure: '.poster-rail-action', render: () => row(html`<button type="button" class="btn-ghost poster-rail-action">Copy conversation</button> <button type="button" class="btn-ghost poster-rail-action">Reset session</button>`),
      after: after('.poster-action', () => row(html`${action('Copy conversation')} ${action('Reset session')}`)) },
    { id: 'back', measure: '.poster-back', render: () => html`<${BackLink} href="#" onClick=${noop}>↩ Back to your home<//>`,
      after: after('.poster-action', () => row(action('↩ Back to your home'))) },
    { id: 'btn-outline', measure: '.btn-outline', render: () => row(html`<a class="btn-outline poster-result-open" href="#">Open</a>`),
      after: after('.poster-action', () => row(action('Open'))) },
    { id: 'btn-ghost', measure: '.btn-ghost', render: () => row(html`<button type="button" class="btn-ghost poster-turn-listen">Listen</button>`),
      after: after('.poster-action', () => row(action('Listen'))) },
  ],
  'tabs-filters': [
    { id: 'chooser-choice', measure: '.poster-fold--on', solo: '.poster-chooser-choices > *', render: () => html`<div class="poster-chooser"><${ChooserChoices} label="What to do"><${ChooserChoice} on=${true} onClick=${noop}>Remember something<//><${ChooserChoice} on=${false} onClick=${noop}>Make a page<//><//></div>`,
      after: after('.poster-tab', () => tabs('Remember something', 'Make a page')) },
    { id: 'fold-switch', measure: '.poster-fold--on', solo: '.poster-fold', render: () => html`<${ModeSwitch} label="Which apps"><${FoldButton} on=${true} onClick=${noop}>Recent<//><${FoldButton} onClick=${noop}>Mine<//><//>`,
      after: after('.poster-tab', () => tabs('Recent', 'Mine')) },
    { id: 'mode-tabs', measure: '.poster-mode--on', solo: '.poster-modes > *', render: () => html`<${ModeTabs}><${ModeTab} on=${true} onClick=${noop}>Give it a prompt<//><${ModeTab} on=${false} onClick=${noop}>Do it step by step<//><//>`,
      after: after('.poster-tab', () => tabs('Give it a prompt', 'Do it step by step')) },
    { id: 'poster-tab', measure: '.poster-tab.is-on', solo: '.poster-tab', render: () => row(html`<button type="button" class="poster-tab is-on">Overview</button> <button type="button" class="poster-tab">Tasks</button> <button type="button" class="poster-tab">Messages</button>`), after: 'same' },
    { id: 'adm-filter-chip', measure: '.adm-hook-fchip.on', solo: '.adm-hook-fchip', render: () => adm(row(html`<button type="button" class="adm-hook-fchip on">all</button> <button type="button" class="adm-hook-fchip">failed</button> <button type="button" class="adm-hook-fchip">sent</button>`)),
      after: after('.poster-tab', () => tabs('all', 'failed', 'sent')) },
  ],
  'loud-action': [
    { id: 'btn-primary', measure: '.btn-primary', render: () => row(html`<button type="button" class="btn-primary">Copy the prompt</button>`),
      after: after('.poster-slab', () => row(html`<button type="button" class="btn-primary poster-slab">Copy the prompt</button>`)) },
    { id: 'slab-control', measure: '.poster-slab', render: () => row(html`<button type="button" class="btn-primary poster-slab poster-slab--control poster-composer-send">Send</button>`), after: 'same' },
    { id: 'slab', measure: '.poster-slab', render: () => row(html`<a class="poster-slab" href="#">Go to the store →</a>`), after: 'same' },
  ],
  empty: [
    { id: 'quiet-note', measure: '.poster-quiet', render: () => html`<${QuietNote}>You have not opened any apps yet.<//>`, after: 'same' },
    { id: 'day-empty', measure: '.poster-quiet', render: () => html`<${DayEmpty}>Nothing has happened here yet.<//>`,
      after: after('.poster-quiet', () => html`<${QuietNote}>Nothing has happened here yet.<//>`) },
    { id: 'conversation-empty', measure: '.poster-conversation-empty', render: () => html`<${ThreadList} threads=${[]} onOpen=${noop} onNew=${noop} onDelete=${noop} onClose=${noop} />`,
      after: after('.poster-quiet', () => html`<${QuietNote}>Nothing here yet. Say something and this is where it will be.<//>`) },
  ],
  'agent-step-wrapper': [
    { id: 'as-is', measure: '.poster-paste-label', render: () => html`<${WrapperPair} without=${false} />`,
      after: after('.poster-paste-label', () => html`<${WrapperPair} without=${true} />`) },
    { id: 'without', measure: '.poster-paste-label', render: () => html`<${WrapperPair} without=${true} />`, after: 'same' },
  ],
};

/** A tone of a proposal, captioned with its name under the example word. */
const tone = (name, children) => html`<span class="poster-specimen-tone">${children}<small>${name}</small></span>`;

export const PROPOSALS = {
  tag: {
    measure: '.dl-tag',
    render: () => html`
      ${row(html`${tone('plain', html`<span class="dl-tag">v1.4.0</span>`)} ${tone('sun', html`<span class="dl-tag dl-tag--sun">7 unread</span>`)}
        ${tone('coral', html`<span class="dl-tag dl-tag--coral">operator</span>`)} ${tone('ink', html`<span class="dl-tag dl-tag--ink">colleague</span>`)}`)}`,
  },
  status: {
    measure: '.dl-status',
    render: () => row(html`${tone('fine', html`<span class="dl-status dl-status--fine">active</span>`)} ${tone('attention', html`<span class="dl-status dl-status--attention">paused</span>`)}
      ${tone('danger', html`<span class="dl-status dl-status--danger">revoked</span>`)} ${tone('off', html`<span class="dl-status dl-status--off">archived</span>`)}`),
  },
  count: {
    measure: '.dl-count',
    render: () => row(html`${tone('waiting', html`<span class="dl-count dl-count--waiting">3</span>`)} ${tone('tally', html`<span class="dl-count dl-count--tally">4</span>`)}
      ${tone('waiting, on the bell', html`<span class="poster-specimen-anchor"><span class="dl-count dl-count--waiting dl-count--small">7</span></span>`)}
      ${tone('morsels, kept as it is', html`<span class="brand-morsels">1000</span>`)}`),
  },
};
