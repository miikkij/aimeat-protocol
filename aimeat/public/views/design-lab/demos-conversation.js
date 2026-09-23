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
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { h } from 'preact';
import htm from 'htm';
import { ThreadList } from '/components/ThreadList.js';
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
                <${Suggestions}><${Suggestion} caps=${true} onClick=${noop}>Make me a page<//><${Suggestion} caps=${true} onClick=${noop}>What can you do?<//><//>
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
    { name: 'starters (caps)', render: () => html`<${Suggestions}><${Suggestion} caps=${true} onClick=${noop}>Make me a page<//><${Suggestion} caps=${true} onClick=${noop}>What can you do?<//><//>` },
    { name: 'disabled', render: (ex) => html`<${Choices} options=${ex.options} onPick=${noop} disabled=${true} />` },
  ] },
  'turn': { variants: [
    { name: 'the person', render: () => html`<${Turn} id="u" turn=${USER} />` },
    { name: 'the agent, with tools and a result', render: () => html`<${Turn} id="a" turn=${AGENT} />` },
    { name: 'live, thinking', render: () => html`<${LiveTurn} text="" thought="" tools=${[]} cards=${[]} busy=${true} />` },
    { name: 'live, running a tool', render: () => html`<${LiveTurn} text="Building your page" tools=${[{ title: 'aimeat_app_publish', status: 'pending' }]} cards=${[]} busy=${true} />` },
    { name: 'could not run', render: () => html`<${TurnError} message="The agent did not answer in time." onRetry=${noop} />` },
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
  ] },
};
