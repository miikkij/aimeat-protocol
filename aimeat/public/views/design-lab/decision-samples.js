/**
 * @file public/views/design-lab/decision-samples.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The live sample of every variant in the design lab's decisions, drawn with the real
 *   classes and, where a page draws it through a library part, by that part; and the picture of
 *   each proposal that is a new composition (Tag, Status, Count), drawn with the proposal classes in
 *   css/design-lab-proposals.css. Each names the element the preview page measures (`measure`), so
 *   the values beside it are read from the drawn element, never written by hand. Ids match
 *   decisions-data.js; `pnpm check:ui-library` holds the two together.
 * @structure SAMPLES — { [decisionId]: [{ id, measure, render() }] } · PROPOSALS — { [decisionId]: { measure, render() } }
 * @usage import { SAMPLES, PROPOSALS } from './decision-samples.js';
 * @version-history
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
import { ChooserResult } from '/components/Chooser.js';
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

export const SAMPLES = {
  tag: [
    { id: 'poster-chip', measure: '.poster-chip', render: () => row(html`<span class="poster-chip">music</span> <span class="poster-chip">v1.4.0</span> <span class="poster-chip">colleague</span>`) },
    { id: 'og-chip', measure: '.og-chip', render: () => row(html`<span class="og-chip">2 requests</span> <span class="og-chip og-chip--sun">7 unread</span> <span class="og-chip og-chip--dim">archived</span>`) },
    { id: 'pf-mono-chip', measure: '.sch-badge', render: () => html`<div class="pf">${row(html`<span class="sch-badge sch-badge--ai">AI</span> <span class="sch-badge sch-badge--agent">agent task</span> <span class="sch-tag">by an agent</span>`)}</div>` },
    { id: 'row-tag', measure: '.sk-tag', render: () => row(html`<span class="sk-nm">aimeat-writing<span class="sk-tag">v1.4.0</span></span>`) },
    { id: 'adm-state-chip', measure: '.adm-own-chip', render: () => row(html`<span class="adm-own-chip">member</span> <span class="adm-own-chip adm-own-chip--op">operator</span> <span class="adm-own-chip adm-own-chip--you">you</span>`) },
    { id: 'ct-tag', measure: '.ct-tag', render: () => row(html`<span class="ct-tags"><span class="ct-tag ct-tag--rel">colleague</span><span class="ct-tag">design</span><span class="ct-tag">helsinki</span></span>`) },
    { id: 'tag-pill', measure: '.tag-pill', render: () => row(html`<span class="tag-pill active">music</span> <span class="tag-pill">notes</span> <span class="tag-pill">2026</span>`) },
  ],
  status: [
    { id: 'pf-badge', measure: '.badge', render: () => html`<div class="pf">${row(html`<span class="badge badge-success">active</span> <span class="badge badge-warn">paused</span> <span class="badge badge-danger">revoked</span> <span class="badge badge-muted">archived</span>`)}</div>` },
    { id: 'adm-badge', measure: '.adm-badge', render: () => row(html`<span class="adm-badge adm-badge-healthy">healthy</span> <span class="adm-badge adm-badge-warning">warning</span> <span class="adm-badge adm-badge-critical">critical</span> <span class="adm-badge adm-badge-muted">idle</span>`) },
    { id: 'theme-badge', measure: '.badge', render: () => row(html`<span class="badge badge-success">active</span> <span class="badge badge-warn">paused</span> <span class="badge badge-danger">blocked</span> <span class="badge badge-info">anon</span>`) },
    { id: 'adm-grey-tag', measure: '.adm-st-chip', render: () => row(html`<span class="adm-st-chip adm-st-chip--ok">per day</span> <span class="adm-st-chip adm-st-chip--bad">per day</span> <span class="adm-st-chip adm-st-chip--muted">quiet</span>`) },
  ],
  count: [
    { id: 'count-coral', measure: '.pf-side-badge', render: () => row(html`<span class="pf-side-badge">3</span> <span class="open-items-count">5</span>`) },
    { id: 'count-bell', measure: '.notif-badge', render: () => row(html`<span class="poster-specimen-anchor"><span class="notif-badge">7</span></span>`) },
    { id: 'count-morsels', measure: '.brand-morsels', render: () => row(html`<span class="brand-morsels">1000</span>`) },
    { id: 'count-admin-nav', measure: '.cnt', render: () => row(html`<span class="adm-nav-item">Owners <span class="cnt">4</span></span>`) },
  ],
  'row-label': [
    { id: 'poster-label', measure: '.poster-label', render: () => html`<${NamedRow} label="Assets"><${ThingLink} href="#" n=${30} label="Apps" /><//>` },
    { id: 'prompt-label', measure: '.poster-prompt-label', render: () => html`<${PromptCard} label="Remember something" prompt="Tell me in the language I use with you…" className="btn-primary" copyLabel="Copy prompt" copiedLabel="Copied" />` },
    { id: 'og-label', measure: '.og-label', render: () => row(html`<span class="og-label">Visibility</span>`) },
  ],
  'group-heading': [
    { id: 'day-title', measure: '.poster-day-title', render: () => html`<${DayList}><${DayGroup} title="Today"><${TimelineRow} category="made" text="You published a page" when="10:42" href="#" /><//><//>` },
    { id: 'worklog-head', measure: '.poster-worklog-head', render: () => html`<${WorkLog} tools=${TOOLS} />` },
    { id: 'conversation-label', measure: '.poster-conversation-label', render: () => html`<${ConversationAbout} label="This conversation" name="Make me a page" />` },
  ],
  timestamp: [
    { id: 'turn-meta', measure: '.poster-turn-meta', render: () => html`<${Turn} id="m1" turn=${{ role: 'agent', text: 'Your page is ready.', at: AT, model: 'claude-sonnet-5' }} />` },
    { id: 'timeline-when', measure: '.poster-timeline-when', render: () => html`<${TimelineList}><${TimelineRow} category="agent" text="Your agent wrote a note" when="10:42" href="#" /><//>` },
  ],
  'object-box': [
    { id: 'prompt-card', measure: '.poster-prompt', render: () => html`<${PromptCard} label="The prompt" prompt="Write me a one-page HTML welcome mat…" className="btn-primary" copyLabel="Copy the prompt" copiedLabel="Copied" />` },
    { id: 'chooser-box', measure: '.poster-box', render: () => html`<${ChooserResult}><p>Saved. Your note is in your memory.</p><//>` },
    { id: 'result-card', measure: '.poster-result', render: () => html`<${ResultCards} cards=${[{ kind: 'page', title: 'Team page', url: '#' }]} />` },
  ],
  'attention-note': [
    { id: 'waiting-note', measure: '.poster-waiting', render: () => html`<${WaitingNote} title="Waiting for your agent to knock.">The next move is in your AI chat.<//>` },
    { id: 'nudge', measure: '.poster-nudge', render: () => html`<${MobileNudge} onDismiss=${noop} />` },
    { id: 'aside', measure: '.poster-aside', render: () => html`<aside class="poster-aside">The next move is in your AI chat: it has to run the prompt and show you a code.</aside>` },
  ],
  'action-link': [
    { id: 'poster-action', measure: '.poster-action', render: () => row(html`<a class="poster-action" href="#">Settings</a> <a class="poster-action" href="#">Sign out</a>`) },
    { id: 'fold', measure: '.poster-fold', render: () => row(html`<${FoldButton} onClick=${noop}>Show all (12)<//>`) },
    { id: 'rail-action', measure: '.poster-rail-action', render: () => row(html`<button type="button" class="btn-ghost poster-rail-action">Copy conversation</button> <button type="button" class="btn-ghost poster-rail-action">Reset session</button>`) },
    { id: 'back', measure: '.poster-back', render: () => html`<${BackLink} href="#" onClick=${noop}>↩ Back to your home<//>` },
    { id: 'btn-outline', measure: '.btn-outline', render: () => row(html`<a class="btn-outline poster-result-open" href="#">Open</a>`) },
    { id: 'btn-ghost', measure: '.btn-ghost', render: () => row(html`<button type="button" class="btn-ghost poster-turn-listen">Listen</button>`) },
  ],
  'tabs-filters': [
    { id: 'fold-switch', measure: '.poster-fold--on', render: () => html`<${ModeSwitch} label="Which apps"><${FoldButton} on=${true} onClick=${noop}>Recent<//><${FoldButton} onClick=${noop}>Mine<//><//>` },
    { id: 'mode-tabs', measure: '.poster-mode--on', render: () => html`<${ModeTabs}><${ModeTab} on=${true} onClick=${noop}>Give it a prompt<//><${ModeTab} on=${false} onClick=${noop}>Do it step by step<//><//>` },
    { id: 'poster-tab', measure: '.poster-tab.is-on', render: () => row(html`<button type="button" class="poster-tab is-on">Overview</button> <button type="button" class="poster-tab">Tasks</button> <button type="button" class="poster-tab">Messages</button>`) },
    { id: 'adm-filter-chip', measure: '.adm-hook-fchip.on', render: () => row(html`<button type="button" class="adm-hook-fchip on">all</button> <button type="button" class="adm-hook-fchip">failed</button> <button type="button" class="adm-hook-fchip">sent</button>`) },
  ],
  'loud-action': [
    { id: 'btn-primary', measure: '.btn-primary', render: () => row(html`<button type="button" class="btn-primary">Copy the prompt</button>`) },
    { id: 'slab-control', measure: '.poster-slab', render: () => row(html`<button type="button" class="btn-primary poster-slab poster-slab--control poster-composer-send">Send</button>`) },
    { id: 'slab', measure: '.poster-slab', render: () => row(html`<a class="poster-slab" href="#">Go to the store →</a>`) },
  ],
  empty: [
    { id: 'quiet-note', measure: '.poster-quiet', render: () => html`<${QuietNote}>You have not opened any apps yet.<//>` },
    { id: 'day-empty', measure: '.poster-day-empty', render: () => html`<${DayEmpty}>Nothing has happened here yet.<//>` },
    { id: 'conversation-empty', measure: '.poster-conversation-empty', render: () => html`<${ThreadList} threads=${[]} onOpen=${noop} onNew=${noop} onDelete=${noop} onClose=${noop} />` },
  ],
  'agent-step-wrapper': [
    { id: 'as-is', measure: '.poster-paste-label', render: () => html`<${WrapperPair} without=${false} />` },
    { id: 'without', measure: '.poster-paste-label', render: () => html`<${WrapperPair} without=${true} />` },
  ],
};

/** A tone of a proposal, captioned with its name under the example word. */
const tone = (name, children) => html`<span class="poster-specimen-tone">${children}<small>${name}</small></span>`;

export const PROPOSALS = {
  tag: {
    measure: '.dl-tag',
    render: () => html`
      ${row(html`${tone('plain', html`<span class="dl-tag">v1.4.0</span>`)} ${tone('sun', html`<span class="dl-tag dl-tag--sun">7 unread</span>`)}
        ${tone('coral', html`<span class="dl-tag dl-tag--coral">operator</span>`)} ${tone('ink', html`<span class="dl-tag dl-tag--ink">colleague</span>`)}`)}
      ${row(html`<span class="dl-tag">AI</span> <span class="dl-tag">agent task</span> <span class="dl-tag dl-tag--sun">music</span> <span class="dl-tag">notes</span> <span class="dl-tag">member</span> <span class="dl-tag dl-tag--sun">you</span>`)}`,
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
