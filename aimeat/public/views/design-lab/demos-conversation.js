/**
 * @file public/views/design-lab/demos-conversation.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's live demos for the parts of a conversation with an agent: the
 *   frame, the list of conversations, one turn in each of its states, what it produced and did,
 *   the box, and the notices around them. Each is drawn by its real component with the catalogue
 *   entry's example data (`ex`).
 * @structure CONVERSATION_DEMOS — { [id]: { variants: [{ name, render(ex) }], height? } }
 * @usage import { CONVERSATION_DEMOS } from './demos-conversation.js';
 * @version-history
 *   v1.4.0 — 2026-09-26 — The typing box is the chat's one row (.poster-composer and its stacked cut): the field with the thick line under it, the tools as framed squares, the dark block that sends with the page's word; Messages (and its Broadcast form) and an agent's Chat tab take it; the framed field, the round-cornered tools and the box's frame go (a unification: Jouni's decision "Typing box").
 *   v1.3.0 — 2026-09-26 — A message is the chat's turn (components/Turn.js classes): your words bold on the sun, the other side's beside the pale coral spine, the name above the words, the time and the read marks under them with Copy and Listen, the other six actions behind one ⋯ (CardMenu inline); an agent's options are the chat's choices. The frame, the picture beside the other side, the action pill and the Chat tab's bubbles, pairing lines and small reader go; a suggested reply waiting for approval keeps its dashed box (a unification: Jouni's decision "Message").
 *   v1.2.0 — 2026-09-26 — The conversation list's person heading (Jouni's decision "Conversation list").
 *   v1.1.0 — 2026-09-24 — The starters read as sentences (Jouni's decision "Suggestion").
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { h } from 'preact';
import htm from 'htm';
import { ThreadList, ThreadPerson } from '/components/ThreadList.js';
import { Turn, LiveTurn, TurnError } from '/components/Turn.js';
import { Composer } from '/components/Composer.js';
import { StatusBar } from '/components/AgentStatus.js';
import { GooseCredit } from '/components/Credit.js';
import { Suggestions, Suggestion, Choices } from '/components/Suggestion.js';
import { AiNotice } from '/components/AiNotice.js';
import { MobileNudge } from '/components/Nudge.js';
import { ResultCards } from '/components/ResultCard.js';
import { WorkLog } from '/components/WorkLog.js';
import {
  ConversationFrame, ConversationAbout, ConversationFoot, ConversationMain, ConversationHead,
  ConversationIcon, ConversationScroll, ConversationWelcome, ConversationJump, ConversationCap,
} from '/components/ConversationFrame.js';

const html = htm.bind(h);
const noop = () => {};

const AT = '2026-09-23T10:42:00Z';
const USER = { role: 'user', text: 'Make me a page about my team', at: AT };
const AGENT = {
  role: 'agent', at: AT, model: 'claude-sonnet-5',
  text: 'Your page is ready. It has a heading, the four of you with a line each, and a way to reach you.\n\n```aimeat-choices\nAdd a photo\nMake it dark\nLeave it as it is\n```',
  tools: [{ title: 'aimeat_app_publish', status: 'completed' }, { title: 'aimeat_memory_write', status: 'completed' }],
  cards: [{ kind: 'page', title: 'Team page', url: 'https://sandbox.aimeat.io/team' }],
};
const THREADS = [{ id: 't1', title: 'Make me a page', turns: 4 }, { id: 't2', title: 'What can you do?', turns: 2 }];
const STATUS = { agent_name: 'chat#sandbox@aimeat-local-001-dev', pays: 'node', has_own_key: false, allowance_remaining_usd: 1.5, model: 'claude-sonnet-5', enabled: true };

/** The chat page's own composition, with the library parts it is built from. */
function Conversation({ list = false, empty = false, capped = false }) {
  return html`
    <${ConversationFrame} list=${list}>
      <${ThreadList} threads=${THREADS} activeId="t1" onOpen=${noop} onNew=${noop} onDelete=${noop} onClose=${noop}>
        <${ConversationAbout} label="This conversation" name="Make me a page">
          <${StatusBar} status=${STATUS} onReset=${noop} />
        <//>
        <${ConversationFoot}><${AiNotice} compact=${true} /><${GooseCredit} /><//>
      <//>
      <${ConversationMain}>
        <${ConversationHead} backHref="/v1/home" backLabel="Back" title="Make me a page">
          <${ConversationIcon} label="Conversations" onClick=${noop}>≡<//>
        <//>
        <${ConversationScroll} onScroll=${noop}>
          ${empty
            ? html`<${ConversationWelcome} title="Your first agent" body="It works here the way your own AI tool would. Ask it for something."
                trust="Everything you make here lands in your own account.">
                <${Suggestions}><${Suggestion} onClick=${noop}>Make me a page<//><${Suggestion} onClick=${noop}>What can you do?<//><//>
              <//>`
            : html`<${Turn} id="d1" turn=${USER} /><${Turn} id="d2" turn=${AGENT} />`}
        <//>
        <${ConversationJump} onClick=${noop}>Jump to the latest<//>
        ${capped
          ? html`<${ConversationCap} title="This conversation has used up its free ride." body="Two ways to keep going:">
              <a class="btn-primary" href="#">Bring your own key →</a><//>`
          : html`<${Composer} value="" onInput=${noop} onSend=${noop} onStop=${noop} onAttach=${noop} onDropAttachment=${noop} />`}
      <//>
    <//>`;
}

export const CONVERSATION_DEMOS = {
  'conversation-frame': { height: 700, flush: true, variants: [
    { name: 'a conversation', render: () => html`<${Conversation} />` },
    { name: 'empty, with starters', render: () => html`<${Conversation} empty=${true} />` },
    { name: 'the free share is spent', render: () => html`<${Conversation} capped=${true} />` },
    { name: 'the list open (a phone)', render: () => html`<${Conversation} list=${true} />` },
  ] },
  'thread-list': { variants: [
    { name: 'default', render: (ex) => html`<${ThreadList} threads=${ex.threads} activeId=${ex.activeId} onOpen=${noop} onNew=${noop} onDelete=${noop} onClose=${noop} />` },
    { name: 'empty', render: () => html`<${ThreadList} threads=${[]} onOpen=${noop} onNew=${noop} onDelete=${noop} onClose=${noop} />` },
    { name: 'person', render: () => html`<div><${ThreadPerson} expanded=${true} onClick=${noop}>
        <span class="poster-thread-person-name">mika</span>
        <span class="poster-count poster-count--tally">3 conversations</span><span class="poster-count poster-count--waiting">2 unread</span><//>
      <div class="poster-thread-list"><div class="poster-thread poster-thread--active"><button type="button" class="poster-thread-open">
        <span class="poster-thread-title">Brand colours</span><span class="poster-thread-sub">10:42 · The client wants the coral a little warmer.</span></button>
        <span class="poster-count poster-count--waiting">1</span></div></div></div>` },
  ] },
  'agent-status': { variants: [
    { name: 'the house pays', render: (ex) => html`<${StatusBar} status=${ex.status} onReset=${noop} />` },
    { name: 'own key', render: (ex) => html`<${StatusBar} status=${{ ...ex.status, pays: 'own', has_own_key: true }} onReset=${noop} />` },
    { name: 'allowance', render: (ex) => html`<${StatusBar} status=${{ ...ex.status, pays: 'allowance' }} onReset=${null} />` },
  ] },
  'rail-action': { variants: [
    { name: 'default', render: (ex) => html`<button type="button" class="btn-ghost poster-rail-action">${ex.children}</button>` },
  ] },
  'suggestion': { variants: [
    { name: "the agent's choices", render: (ex) => html`<${Choices} options=${ex.options} onPick=${noop} />` },
    { name: 'starters', render: () => html`<${Suggestions}><${Suggestion} onClick=${noop}>Make me a page<//><${Suggestion} onClick=${noop}>What can you do?<//><//>` },
    { name: 'disabled', render: (ex) => html`<${Choices} options=${ex.options} onPick=${noop} disabled=${true} />` },
  ] },
  'turn': { variants: [
    { name: 'the person', render: () => html`<${Turn} id="u" turn=${USER} />` },
    { name: 'the agent, with tools and a result', render: () => html`<${Turn} id="a" turn=${AGENT} />` },
    { name: 'live, thinking', render: () => html`<${LiveTurn} text="" thought="" tools=${[]} cards=${[]} busy=${true} />` },
    { name: 'live, running a tool', render: () => html`<${LiveTurn} text="Building your page" tools=${[{ title: 'aimeat_app_publish', status: 'pending' }]} cards=${[]} busy=${true} />` },
    { name: 'could not run', render: () => html`<${TurnError} message="The agent did not answer in time." onRetry=${noop} />` },
    { name: 'with a name line (Messages)', render: () => html`<div class="poster-turn poster-turn--user"><span class="poster-label poster-turn-who">You</span>
        <div class="poster-turn-body"><p class="poster-turn-said">Yes, within the palette. I will send two options.</p></div>
        <div class="poster-time poster-turn-meta"><span>10:42</span><span>✓✓</span></div></div>` },
  ] },
  'result-card': { variants: [
    { name: 'every kind', render: () => html`<${ResultCards} cards=${['page', 'app', 'image', 'file', 'memory', 'workspace'].map((kind) => ({
        kind, title: 'A ' + kind, url: kind === 'memory' ? undefined : '#', ref: kind === 'memory' ? 'home.note' : undefined,
        image: kind === 'image' ? '/og-image.png' : undefined }))} />` },
  ] },
  'work-log': { variants: [
    { name: 'every status', render: () => html`<${WorkLog} tools=${[{ title: 'aimeat_app_publish', status: 'completed' },
        { title: 'aimeat_memory_write', status: 'failed' }, { title: 'aimeat_storage_upload', status: 'pending' }]} />` },
  ] },
  'ai-notice': { variants: [
    { name: 'full', render: () => html`<${AiNotice} compact=${false} />` },
    { name: 'compact', render: () => html`<${AiNotice} compact=${true} />` },
  ] },
  'nudge': { variants: [{ name: 'default', render: () => html`<${MobileNudge} onDismiss=${noop} />` }] },
  'credit': { variants: [{ name: 'default', render: () => html`<${GooseCredit} />` }] },
  'composer': { variants: [
    { name: 'empty', render: () => html`<${Composer} value="" onInput=${noop} onSend=${noop} onStop=${noop} onAttach=${noop} onDropAttachment=${noop} />` },
    { name: 'with text', render: (ex) => html`<${Composer} value=${ex.value} onInput=${noop} onSend=${noop} onStop=${noop} onAttach=${noop} onDropAttachment=${noop} />` },
    { name: 'busy', render: (ex) => html`<${Composer} value=${ex.value} busy=${true} onInput=${noop} onSend=${noop} onStop=${noop} />` },
    { name: 'attachments, one failed', render: () => html`<${Composer} value="" onInput=${noop} onSend=${noop} onStop=${noop} onAttach=${noop} onDropAttachment=${noop}
        attachments=${[{ id: 'a', name: 'photo.png', preview: '/og-image.png' }, { id: 'b', name: 'report.pdf', state: 'error', error: 'too large' }]} />` },
    { name: 'no agent here', render: () => html`<${Composer} value="" disabled=${true} note="There is no chat agent on this node." onInput=${noop} onSend=${noop} onStop=${noop} />` },
    { name: 'stacked (Messages: three squares)', render: () => html`<div class="poster-composer poster-composer--stack poster-row--thing"><div class="poster-composer-row">
        <textarea class="poster-composer-input" rows="1" placeholder="Write a message…">I will send two options.</textarea>
        <button type="button" class="poster-icon poster-composer-tool" title="Attach a file">📎</button>
        <button type="button" class="poster-icon poster-composer-tool" title="Record a voice message">🎤</button>
        <button type="button" class="poster-icon poster-composer-tool" title="The bigger editor">⤢</button>
        <button type="button" class="poster-slab poster-slab--control poster-composer-send">Reply</button></div></div>` },
  ] },
};
