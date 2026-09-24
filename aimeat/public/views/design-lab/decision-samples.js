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
 *   v3.1.0 — 2026-09-24 — The icon button's pictures use the built shape (.poster-icon).
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
import { Suggestions, Suggestion, Choices } from '/components/Suggestion.js';
import { CardMenu } from '/components/CardMenu.js';
import { SwatchPicker } from '/components/SwatchPicker.js';
import { GooseCredit } from '/components/Credit.js';
import { ArchiveMore } from '/components/ArchiveSection.js';
import { ConversationJump } from '/components/ConversationFrame.js';
import { CLOSE_ICON } from '/js/dialog.js';
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
/** A dialog's footer, whose rules restyle the buttons inside it. */
const foot = (children) => html`<dialog class="dlg" open><footer class="dlg-foot">${children}</footer></dialog>`;
const tag = (tone, text) => html`<span class=${'dl-tag' + (tone ? ` dl-tag--${tone}` : '')}>${text}</span>`;
const status = (tone, text) => html`<span class=${`dl-status dl-status--${tone}`}>${text}</span>`;
const action = (text) => html`<a class="poster-action" href="#">${text}</a>`;
const more = (text) => html`<a class="poster-action poster-action--more" href="#">${text}</a>`;
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
      after: after('.poster-count', () => row(html`<span class="poster-count poster-count--waiting">3</span> <span class="poster-count poster-count--waiting">5</span>`)) },
    { id: 'count-bell', measure: '.notif-badge', render: () => row(html`<span class="poster-specimen-anchor"><span class="notif-badge">7</span></span>`),
      after: after('.poster-count', () => row(html`<span class="poster-specimen-anchor"><span class="poster-count poster-count--waiting poster-count--small">7</span></span>`)) },
    { id: 'count-morsels', measure: '.brand-morsels', render: () => row(html`<span class="brand-morsels">1000</span>`), after: 'same' },
    { id: 'count-admin-nav', measure: '.cnt', solo: '.adm-sidebar', render: () => sidebar(html`<span class="cnt">4</span>`),
      after: after('.adm-sidebar', () => sidebar(html`<span class="poster-count poster-count--tally">4</span>`), '.poster-count') },
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
      after: after('.poster-day-title', () => row(html`<div class="poster-day-title poster-day-title--quiet">What was done</div>`)) },
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
      after: 'same' },
    { id: 'chooser-box', measure: '.poster-box', render: () => html`<${ChooserResult}><p>Saved. Your note is in your memory.</p><//>`, after: 'same' },
    { id: 'result-card', measure: '.poster-result', render: result, after: 'same' },
  ],
  'attention-note': [
    { id: 'waiting-note', measure: '.poster-waiting', render: waiting,
      after: 'same' },
    { id: 'nudge', measure: '.poster-nudge', render: () => html`<${MobileNudge} onDismiss=${noop} />`,
      after: 'same' },
    { id: 'aside', measure: '.poster-aside', render: () => html`<aside class="poster-aside">The next move is in your AI chat: it has to run the prompt and show you a code.</aside>`, after: 'same' },
  ],
  'action-link': [
    { id: 'poster-action', measure: '.poster-action', render: () => row(html`<a class="poster-action" href="#">Settings</a> <a class="poster-action" href="#">Sign out</a>`), after: 'same' },
    { id: 'fold', measure: '.poster-action--more', render: () => row(html`<${FoldButton} onClick=${noop}>Show all (12)<//>`),
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
    { id: 'chooser-choice', measure: '.poster-chooser-choices .is-on', solo: '.poster-chooser-choices > *', render: () => html`<div class="poster-chooser"><${ChooserChoices} label="What to do"><${ChooserChoice} on=${true} onClick=${noop}>Remember something<//><${ChooserChoice} on=${false} onClick=${noop}>Make a page<//><//></div>`,
      after: after('.poster-tab', () => tabs('Remember something', 'Make a page')) },
    { id: 'fold-switch', measure: '.poster-tab--fold.is-on', solo: '.poster-tab--fold', render: () => html`<${ModeSwitch} label="Which apps"><${FoldButton} on=${true} onClick=${noop}>Recent<//><${FoldButton} onClick=${noop}>Mine<//><//>`,
      after: after('.poster-tab', () => tabs('Recent', 'Mine')) },
    { id: 'mode-tabs', measure: '.poster-modes .is-on', solo: '.poster-modes > *', render: () => html`<${ModeTabs}><${ModeTab} on=${true} onClick=${noop}>Give it a prompt<//><${ModeTab} on=${false} onClick=${noop}>Do it step by step<//><//>`,
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
  // The home's and the chat's remaining own looks.
  'panel-action': [
    { id: 'open-items-copy', measure: '.btn-primary', render: () => html`<section class="open-items"><div class="open-items-head"><button type="button" class="btn-primary btn-sm">Take these into your AI chat</button></div></section>`,
      after: after('.poster-action', () => row(action('Take these into your AI chat'))) },
    { id: 'install', measure: '.install-cta-install', render: () => html`<div class="install-cta"><div class="install-cta-actions"><button type="button" class="btn-primary install-cta-install">Install</button></div></div>`,
      after: after('.poster-action', () => row(action('Install'))) },
    { id: 'playbook-copy', measure: '.btn-outline', render: () => html`<div class="poster-index-actions"><button type="button" class="btn-outline">Copy for my own AI</button></div>`,
      after: after('.poster-action', () => row(action('Copy for my own AI'))) },
    { id: 'setup-copy', measure: '.btn-ghost', render: () => row(html`<button type="button" class="btn-ghost btn-sm">Copy</button>`),
      after: after('.poster-action', () => row(action('Copy'))) },
    { id: 'retry', measure: '.btn-outline', render: () => html`<div class="poster-turn-error" role="alert"><p class="poster-turn-error-msg">The answer did not arrive.</p><button type="button" class="btn-outline">Try again</button></div>`,
      solo: '.poster-turn-error .btn-outline', after: after('.poster-action', () => row(action('Try again'))) },
    { id: 'decide', measure: '.btn-outline', render: () => html`<div class="open-items-decide"><button type="button" class="btn-outline btn-sm">It was right</button> <button type="button" class="btn-outline btn-sm">It was wrong</button></div>`,
      after: after('.poster-action', () => row(html`${action('It was right')} ${action('It was wrong')}`)) },
  ],
  'step-state': [
    { id: 'name-empty', measure: '.btn-outline', render: () => html`<div class="poster-actions"><button type="button" class="btn-outline" disabled>That is its name</button></div>`,
      after: after('.poster-action', () => row(html`<button type="button" class="poster-action" disabled>That is its name</button>`)) },
    { id: 'mat-waiting', measure: '.btn-outline', render: () => html`<div class="poster-actions"><button type="button" class="btn-outline" disabled>Here is my welcome mat</button></div>`,
      after: after('.poster-action', () => row(html`<button type="button" class="poster-action" disabled>Here is my welcome mat</button>`)) },
    { id: 'copy-done', measure: '.poster-prompt-actions .btn-outline', render: () => html`<${PromptCard} label="The prompt" prompt="Write me a one-page HTML welcome mat…" className="btn-outline" copyLabel="Copy the prompt" copiedLabel="Copied" />`,
      after: after('.poster-prompt-actions .poster-action', () => html`<${PromptCard} label="The prompt" prompt="Write me a one-page HTML welcome mat…" className="poster-action" copyLabel="Copy the prompt" copiedLabel="Copied" />`) },
    { id: 'started-done', measure: '.btn-outline', render: () => html`<div class="poster-actions"><button type="button" class="btn-outline">I have started it</button></div>`,
      after: after('.poster-action', () => row(html`<button type="button" class="poster-action">I have started it</button>`)) },
  ],
  dismiss: [
    { id: 'nudge-dismiss', measure: '.poster-nudge-dismiss', render: () => html`<${MobileNudge} onDismiss=${noop} />`,
      after: after('.poster-action--text', () => row(html`<button type="button" class="poster-action poster-action--text">Not now</button>`)) },
    { id: 'install-dismiss', measure: '.install-cta-dismiss', render: () => html`<div class="install-cta"><div class="install-cta-actions"><button type="button" class="btn-ghost install-cta-dismiss">Not now</button></div></div>`,
      after: after('.poster-action--text', () => row(html`<button type="button" class="poster-action poster-action--text">Not now</button>`)) },
  ],
  'icon-button': [
    { id: 'composer-tool', measure: '.poster-composer-tool', render: () => row(html`<button type="button" class="btn-outline poster-composer-tool">📎</button> <button type="button" class="vr-btn btn-outline poster-composer-tool">🎤</button>`),
      after: after('.poster-icon', () => row(html`<button type="button" class="poster-icon">📎</button> <button type="button" class="poster-icon">🎤</button>`)) },
    // The row alone: the list's side column hides itself at a lab frame's width (the phone rule).
    { id: 'thread-del', measure: '.poster-thread-del', render: () => html`<ul class="poster-thread-list"><li class="poster-thread poster-thread--active"><button type="button" class="poster-thread-open"><span class="poster-thread-title">Make me a pong game</span><span class="poster-thread-sub">2 messages</span></button><button type="button" class="btn-ghost poster-thread-del" aria-label="Delete conversation">✗</button></li></ul>`,
      after: after('.poster-icon', () => row(html`<button type="button" class="poster-icon poster-icon--small">✗</button>`)) },
    // The close square is drawn in the dark header's colour, so the header is shown with it.
    { id: 'dialog-close', measure: '.dlg-close', solo: '.dlg-head', render: () => html`<dialog class="dlg" open><header class="dlg-head"><h2 class="dlg-title">Settings</h2><button type="button" class="dlg-close" aria-label="Close" dangerouslySetInnerHTML=${{ __html: CLOSE_ICON }}></button></header></dialog>`,
      after: 'same' },
    { id: 'prompt-more', measure: '.poster-prompt-more', render: () => html`<${PromptCard} label="Remember something" prompt="Tell me in the language I use with you…" className="poster-action" copyLabel="Copy prompt" copiedLabel="Copied" saveIntent=${() => Promise.resolve()} />`,
      after: after('.poster-icon', () => row(html`<button type="button" class="poster-icon poster-icon--small">▾</button>`)) },
    { id: 'card-dots', measure: '.card-menu-dots', render: () => row(html`<${CardMenu} state="open" actions=${[{ label: 'Open', run: noop }]} />`),
      after: after('.poster-icon', () => row(html`<button type="button" class="poster-icon poster-icon--small card-menu-dots card-menu-dots--open">⋯</button>`)) },
  ],
  choice: [
    { id: 'setup-tools', measure: '.ast-tool--active', solo: '.ast-tool', render: () => html`<div class="poster-chooser"><div class="ast-tools" role="tablist"><button type="button" class="ast-tool ast-tool--active">claude.ai <span class="ast-tool-reco">recommended</span></button><button type="button" class="ast-tool">Claude Desktop</button><button type="button" class="ast-tool">ChatGPT</button></div></div>`,
      after: after('.poster-tab', () => row(html`<button type="button" class="poster-tab is-on">claude.ai <span class="ast-tool-reco">recommended</span></button> <button type="button" class="poster-tab">Claude Desktop</button> <button type="button" class="poster-tab">ChatGPT</button>`)) },
    { id: 'pattern-choice', measure: '.poster-settings-pattern-choice.active', solo: '.poster-settings-pattern-choice', render: () => html`<${SwatchPicker} title="Background" choices=${[{ value: 'off', label: 'Off', active: false }, { value: 'pixels', label: 'Pixel grid', active: true }, { value: 'hearts', label: 'Hearts', active: false }]} onChoose=${noop} />`,
      after: after('.poster-tab', () => row(html`<button type="button" class="poster-tab">Off</button> <button type="button" class="poster-tab is-on">Pixel grid</button> <button type="button" class="poster-tab">Hearts</button>`)) },
    { id: 'start-page', measure: '.seg-btn.active', solo: '.seg-btn', render: () => html`<div class="seg start-page-seg" role="radiogroup"><button type="button" class="seg-btn active">Home</button><button type="button" class="seg-btn">Settings & controls</button></div>`,
      after: after('.poster-tab', () => tabs('Home', 'Settings & controls')) },
  ],
  suggestion: [
    { id: 'sentence', measure: '.poster-suggestion', render: () => html`<${Choices} options=${['A single column with your name large', 'Two columns: about you and your work']} onPick=${noop} />`, after: 'same' },
    // Inside the welcome, which centres them, as the page does.
    { id: 'caps', measure: '.poster-suggestion--caps', render: () => html`<div class="poster-conversation-welcome"><${Suggestions}><${Suggestion} caps=${true} onClick=${noop}>Make my welcome page<//><${Suggestion} caps=${true} onClick=${noop}>Take something off my plate<//><//></div>`,
      after: after('.poster-suggestion', () => html`<div class="poster-conversation-welcome"><${Suggestions}><${Suggestion} onClick=${noop}>Make my welcome page<//><${Suggestion} onClick=${noop}>Take something off my plate<//><//></div>`) },
  ],
  'menu-row': [
    { id: 'prompt-menu', measure: '.poster-prompt-menu-item', render: () => html`<div class="poster-prompt-menu"><button type="button" class="btn-ghost poster-prompt-menu-item">Save as my own</button><button type="button" class="btn-ghost poster-prompt-menu-item">Give it to my agent</button></div>`, after: 'same' },
    { id: 'card-menu', measure: '.card-menu-item', render: () => html`<div class="card-menu"><div class="card-menu-list" role="menu"><button type="button" class="card-menu-item">Open</button><button type="button" class="card-menu-item">Add to my list</button></div></div>`,
      after: after('.poster-prompt-menu-item', () => html`<div class="poster-prompt-menu"><button type="button" class="btn-ghost poster-prompt-menu-item">Open</button><button type="button" class="btn-ghost poster-prompt-menu-item">Add to my list</button></div>`) },
    { id: 'notif-action', measure: '.notif-action-btn', render: () => html`<div class="notif-actions"><button type="button" class="notif-action-btn btn-primary">Approve</button> <button type="button" class="notif-action-btn btn-ghost">Open</button></div>`,
      after: after('.poster-prompt-menu-item', () => html`<div class="poster-prompt-menu"><button type="button" class="btn-ghost poster-prompt-menu-item">Approve</button><button type="button" class="btn-ghost poster-prompt-menu-item">Open</button></div>`) },
  ],
  'small-link': [
    { id: 'ai-more', measure: '.poster-ai-notice-more', render: () => row(html`<button type="button" class="btn-ghost poster-ai-notice-more">What does that mean?</button>`),
      after: after('.poster-action--more', () => row(more('What does that mean?'))) },
    { id: 'status-link', measure: '.poster-agent-status-link', render: () => html`<div class="poster-agent-status"><a class="poster-agent-status-link" href="#">Use your own key →</a></div>`,
      after: after('.poster-action--more', () => row(more('Use your own key →'))) },
    { id: 'credit-link', measure: '.poster-credit-link', render: () => html`<${GooseCredit} />`,
      after: after('.poster-action--more', () => row(html`<a class="poster-action poster-action--more" href="#"><span aria-hidden="true">🪿</span> Powered by goose</a>`)) },
    { id: 'setup-docs', measure: '.ast-docs', render: () => html`<div class="poster-chooser"><a class="ast-docs" href="#">Official instructions from claude.ai →</a></div>`,
      after: after('.poster-action--more', () => row(more('Official instructions from claude.ai →'))) },
    { id: 'archive-more', measure: '.poster-archive-more', render: () => html`<${ArchiveMore} onClick=${noop}>Show older<//>`,
      after: after('.poster-action--more', () => row(more('Show older'))) },
    { id: 'jump', measure: '.poster-conversation-jump', render: () => html`<${ConversationJump} onClick=${noop}>↓ Latest<//>`,
      after: after('.poster-action--more', () => row(more('↓ Latest'))) },
  ],
  'dialog-actions': [
    { id: 'cancel', measure: '.btn-ghost', render: () => foot(html`<button type="button" class="btn-ghost">Cancel</button>`),
      after: after('.poster-action', () => row(html`<button type="button" class="poster-action">Cancel</button>`)) },
    { id: 'confirm', measure: '.btn-primary', render: () => foot(html`<button type="button" class="btn-primary">Save</button>`),
      after: after('.poster-slab', () => row(html`<button type="button" class="poster-slab poster-slab--control">Save</button>`)) },
    { id: 'danger', measure: '.btn-danger-solid', render: () => foot(html`<button type="button" class="btn-danger-solid">Delete</button>`), after: 'same' },
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
    measure: '.poster-count',
    render: () => row(html`${tone('waiting', html`<span class="poster-count poster-count--waiting">3</span>`)} ${tone('tally', html`<span class="poster-count poster-count--tally">4</span>`)}
      ${tone('waiting, on the bell', html`<span class="poster-specimen-anchor"><span class="poster-count poster-count--waiting poster-count--small">7</span></span>`)}
      ${tone('morsels, kept as it is', html`<span class="brand-morsels">1000</span>`)}`),
  },
  'panel-action': {
    measure: '.poster-action',
    render: () => row(html`${action('Take these into your AI chat')} ${action('Copy for my own AI')} ${action('Try again')}`),
  },
  'step-state': {
    measure: '.poster-action',
    render: () => row(html`${tone('the next thing to do', html`<button type="button" class="btn-primary poster-slab">That is its name</button>`)}
      ${tone('not ready yet', html`<button type="button" class="poster-action" disabled>That is its name</button>`)}
      ${tone('done', html`<button type="button" class="poster-action">Copy the prompt</button>`)}`),
  },
  dismiss: {
    measure: '.poster-action--text',
    render: () => row(html`<button type="button" class="poster-action poster-action--text">Not now</button>`),
  },
  'icon-button': {
    measure: '.poster-icon',
    render: () => row(html`${tone('large', html`<button type="button" class="poster-icon">📎</button>`)}
      ${tone('small', html`<button type="button" class="poster-icon poster-icon--small">✗</button>`)}
      ${tone('small, a menu with something on it', html`<button type="button" class="poster-icon poster-icon--small card-menu-dots card-menu-dots--open">⋯</button>`)}`),
  },
  choice: {
    measure: '.poster-tab.is-on',
    render: () => tabs('claude.ai', 'Claude Desktop', 'ChatGPT'),
  },
  'dialog-actions': {
    measure: '.poster-action',
    render: () => row(html`<button type="button" class="poster-action">Cancel</button> <button type="button" class="poster-slab poster-slab--control">Save</button>`),
  },
  'small-link': {
    measure: '.poster-action--more',
    render: () => row(html`${more('What does that mean?')} ${more('Use your own key →')} ${more('Show older')}`),
  },
};
