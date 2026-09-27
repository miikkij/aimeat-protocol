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
 *   v1.6.0 — 2026-09-27 — The cap's ways (no hand-written button), ConversationCopy, AiNotice main, Panes framed and a
 *     board notice whose title opens nothing; the operator pages' parts in the operator's frame.
 *   v1.5.0 — 2026-09-27 — Messages on components: Message, MessageFile, MessageQuestions, MessageComposer and
 *     ConversationList, each drawn by calling it; the Board notices' demo moved here from demos-settings.js and calls
 *     BoardNotice; the Turn's hand-written name line and the Composer's hand-written stacked row went (the Composer's
 *     message tone and its slash commands instead).
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
  ConversationIcon, ConversationScroll, ConversationWelcome, ConversationJump, ConversationCap, ConversationCopy,
} from '/components/ConversationFrame.js';
import { OperatorFrame } from '/components/OperatorFrame.js';
import { List, Row, Name, SearchLine } from '/components/List.js';
import { TextArea } from '/components/TextField.js';
import { SettingsRoot } from '/components/SettingsFrame.js';
import { Action, Loud } from '/components/Action.js';
import { Message, Thread, ThreadDay, ThreadTop, ThreadForm } from '/components/Message.js';
import { MessageFiles, VoicePlayer } from '/components/MessageFile.js';
import { MessageQuestions } from '/components/MessageQuestions.js';
import { MessageComposer } from '/components/MessageComposer.js';
import {
  ConversationList, ConversationRows, ConversationTools, ConversationRequests, ConversationRequest,
  ConversationSection, ConversationGroup, ConversationRow, ConversationFold,
} from '/components/ConversationList.js';
import { BoardNotice, BoardNoticeText } from '/components/BoardNotice.js';
import { Panes, Pane, PaneHead, PaneDoor, PaneFields, ReplyBar, PaneNote, PaneScroll, PaneStrip } from '/components/ConversationPane.js';

const html = htm.bind(h);
const noop = () => {};
/* A voice message the demo can draw without the node: a valid WAV of no length. */
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
/* The questions a message asks: one required choice, and a multi-choice with "Other". */
const QUESTIONS = {
  submitLabel: 'Send the answers',
  questions: [
    { id: 'colour', header: 'Colour', prompt: 'Which coral should the brand use?', required: true, options: [{ id: 'warm', label: 'A step warmer' }, { id: 'same', label: 'As it is' }] },
    { id: 'parts', header: 'Parts', prompt: 'What should change with it?', multiSelect: true, options: [{ id: 'logo', label: 'The logo' }, { id: 'site', label: 'The website' }] },
  ],
};

const AT = '2026-09-23T10:42:00Z';
const USER = { role: 'user', text: 'Make me a page about my team', at: AT };
const AGENT = {
  role: 'agent', at: AT, model: 'claude-sonnet-5',
  text: 'Your page is ready. It has a heading, the four of you with a line each, and a way to reach you.\n\n```aimeat-choices\nAdd a photo\nMake it dark\nLeave it as it is\n```',
  tools: [{ title: 'aimeat_app_publish', status: 'completed' }, { title: 'aimeat_memory_write', status: 'completed' }],
  cards: [{ kind: 'page', title: 'Team page', url: 'https://sandbox.aimeat.io/team' }],
};
const THREADS = [{ id: 't1', title: 'Make me a page', turns: 4 }, { id: 't2', title: 'What can you do?', turns: 2 }];
const COPY_TEXT = 'You: Make me a page about my team\n\nAgent: Your page is ready.';
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
          ? html`<${ConversationCap} title="This conversation has used up its free ride." body="Two ways to keep going:"
              ways=${[{ href: '#', label: 'Bring your own key →', loud: true }, { href: '#', label: 'Read how the free share works', newTab: true }]} />`
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
    { name: 'copy the conversation: the rail\'s link and the head\'s icon', render: () => html`<div>
      <${ConversationCopy} text=${COPY_TEXT} label="Copy the conversation" copiedLabel="Copied" />
      <${ConversationCopy} head text=${COPY_TEXT} label="⧉" copiedLabel="✓" title="Copy the conversation" ariaLabel="Copy the conversation" /></div>` },
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
    { name: 'main: the copy in the conversation\'s column (shown on a phone only)', render: () => html`<${AiNotice} main compact=${true} />` },
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
    { name: 'own words, sending, slash commands (an agent\'s Messages tab)', render: () => html`<div style="padding-top: 7rem"><${Composer} value="/st" onInput=${noop} onSend=${noop} onStop=${noop}
        placeholder="Write to bot…" sendLabel="Send to bot" sending=${true} suggestLabel="Commands"
        suggest=${[{ key: 'status', name: '/status', desc: 'What the agent is doing now', onPick: noop }, { key: 'stop', name: '/stop', desc: 'Stop the running task', onPick: noop }]} /></div>` },
    { name: 'message tone (Messages)', render: () => html`<${SettingsRoot}><${Composer} tone="message" recipient="mika@aimeat-local-001-dev" sendLabel="Reply" onSend=${noop} /><//>` },
  ] },
  // Messages on components (component plan C2, "Thread and Composer").
  message: { variants: [
    { name: 'a thread: the other side, yours, a quote', render: () => html`<${SettingsRoot}><${Thread}>
      <${ThreadTop}><${Action} tone="more" onClick=${noop}>↩ Show older<//><//>
      <${ThreadDay}>Today<//>
      <${Message} id="dl-msg-1" who="mika" body=${'The client wants the coral **a little warmer**. Can you send two options?'} time="10:42" timeTitle="27 September 2026, 10:42"
        marks=${[{ text: 'AI wrote this', tone: 'ai', title: 'Written by mika\'s agent' }, { text: 'claude-sonnet-5', tone: 'model' }]}
        copy="The client wants the coral a little warmer." copyLabel="Copy the message" listen=${{ id: 'dl-msg-1', text: 'The client wants the coral a little warmer.' }}
        menu=${[{ label: 'Reply', run: noop }, { label: 'Forward', run: noop }, { label: 'Delete', run: noop, danger: true }]} menuLabel="More" />
      <${Message} id="dl-msg-2" mine who="You" body="Yes, within the palette. I will send two options." time="10:44"
        quote=${{ name: 'mika', text: 'The client wants the coral a little warmer.', onJump: noop }}
        receipt=${{ mark: '✓✓', tone: 'read', title: 'Read' }} copy="Yes, within the palette." copyLabel="Copy the message" menu=${[{ label: 'Reply', run: noop }]} menuLabel="More" />
    <//><//>` },
    { name: 'with files and questions', render: () => html`<${SettingsRoot}><${Thread}>
      <${Message} id="dl-msg-3" who="invoice-drafter" body="Here is the draft invoice and the hours behind it. One question first:" time="11:02"
        files=${[{ id: 'f1', name: 'invoice-september.md', url: '#', kind: 'markdown' }, { id: 'f2', name: 'hours.pdf', url: '#', kind: 'pdf' }]} onOpenText=${noop}
        questions=${{ spec: QUESTIONS, submitting: false, onSubmit: noop }} />
    <//><//>` },
    { name: 'a failed send and a long word', render: () => html`<${SettingsRoot}><${Thread}>
      <${Message} id="dl-msg-4" mine plain body="studio/clients/nordic-ferries/2026/timetable-changes-for-the-winter-season-with-every-boat" time="11:10"
        receipt=${{ mark: '✗', tone: 'error', title: 'Not delivered' }} marks=${[{ text: 'not delivered', tone: 'danger' }]} />
    <//><//>` },
    { name: 'a suggested reply (draft)', render: () => html`<${SettingsRoot}><${Thread}>
      <${Message} tone="draft" label="Your AI suggests" body="Thanks, Mika. Two options are on their way by noon."
        actions=${html`<${Action} small onClick=${noop}>Edit<//><${Loud} control onClick=${noop}>Send<//>`} />
    <//><//>` },
    { name: 'comments under a record, and the form', render: () => html`<${SettingsRoot}><${Thread} tone="comments">
      <${Message} tone="comment" who="sandbox" time="today 09:12" body="The seat map needs the new ferry." plain actions=${html`<${Action} small onClick=${noop}>Reply<//>`} />
      <${Message} tone="comment" reply who="second" whoNote=${['reply']} time="today 09:40" body="I will add it this afternoon." plain />
      <${ThreadForm}><textarea rows="2" aria-label="Write a comment" placeholder="Write a comment"></textarea><${Loud} control onClick=${noop}>Comment<//><//>
    <//><//>` },
    { name: 'a board reply', render: () => html`<${SettingsRoot}><${Message} tone="board" who="second" whoNote="member" time="yesterday" body="The key hangs by the office door." plain /><//>` },
    { name: 'capped (an agent\'s Messages tab)', render: () => html`<${SettingsRoot}><${Thread} capped>
      ${['/status', 'Running: the morning digest, 3 of 5 steps done.', '/stop', 'Stopped.'].map((text, i) => html`<${Message} key=${i} mine=${i % 2 === 0} body=${text} plain time="08:0${i}" />`)}
    <//><//>` },
  ] },
  'message-file': { variants: [
    { name: 'a picture, a text, a document', render: () => html`<${SettingsRoot}><${MessageFiles} onOpenText=${noop} files=${[
      { id: 'p', name: 'seat-map.png', url: '/og-image.png', kind: 'image' },
      { id: 't', name: 'brief.md', url: '#', kind: 'markdown' },
      { id: 'd', name: 'offer-nordic-ferries.pdf', url: '#', kind: 'pdf' },
    ]} /><//>` },
    { name: 'a voice message with the sender\'s transcript', render: () => html`<${SettingsRoot}><${MessageFiles} files=${[
      { id: 'v', name: 'voice-message.webm', url: SILENCE, kind: 'audio', durationSeconds: 14, transcript: { text: 'Morning. The boat leaves at ten past seven now.', by: 'sender' } },
    ]} /><//>` },
    { name: 'a voice message, no transcription model', render: () => html`<${SettingsRoot}><${MessageFiles} onTranscribe=${noop} canTranscribe=${false} files=${[
      { id: 'v2', name: 'voice-message.webm', url: SILENCE, kind: 'audio', durationSeconds: 62 },
    ]} /><//>` },
    { name: 'not yet copied, and expired', render: () => html`<${SettingsRoot}><${MessageFiles} files=${[
      { id: 'n', name: 'hours-september.xlsx', state: 'pending' },
      { id: 'x', name: 'old-offer-with-a-name-long-enough-to-be-cut.pdf', url: '#', state: 'expired' },
    ]} /><//>` },
    { name: 'the small player (a recording waiting to go)', render: () => html`<${SettingsRoot}><${VoicePlayer} small src=${SILENCE} /><//>` },
  ] },
  'message-questions': { variants: [
    { name: 'to answer', render: () => html`<${SettingsRoot}><${MessageQuestions} spec=${QUESTIONS} onSubmit=${noop} /><//>` },
    { name: 'sending', render: () => html`<${SettingsRoot}><${MessageQuestions} spec=${QUESTIONS} submitting onSubmit=${noop} /><//>` },
    { name: 'answered', render: () => html`<${SettingsRoot}><${MessageQuestions} spec=${QUESTIONS}
      answers=${{ colour: { selected: ['warm'], other: null }, parts: { selected: ['logo'], other: 'the menu board' } }} /><//>` },
  ] },
  'message-composer': { variants: [
    { name: 'empty', render: () => html`<${SettingsRoot}><${MessageComposer} recipient="mika@aimeat-local-001-dev" sendLabel="Reply" onSend=${noop} /><//>` },
    { name: 'a suggested reply to start from', render: () => html`<${SettingsRoot}><${MessageComposer} recipient="mika@aimeat-local-001-dev" sendLabel="Reply" onSend=${noop}
      initialText="Thanks, Mika. Two options are on their way by noon: one a step warmer, one two steps warmer, both inside the palette." /><//>` },
    { name: 'sending', render: () => html`<${SettingsRoot}><${MessageComposer} recipient="mika@aimeat-local-001-dev" sendLabel="Reply" sending onSend=${noop} initialText="On its way." /><//>` },
    { name: 'no recipient yet (the send is held)', render: () => html`<${SettingsRoot}><${MessageComposer} sendLabel="Send" onSend=${noop} /><//>` },
  ] },
  'conversation-list': { variants: [
    { name: 'requests, sections, a group, a fold', render: () => html`<${SettingsRoot}><${ConversationList}>
      <${ConversationRequests} label="Requests" count=${1}>
        <${ConversationRequest} picture="lumo@aimeat-local-001-dev" name="Lumo Bakery" address="lumo@aimeat-local-001-dev" preview="Hello, we would like a price for the seasonal menu site.">
          <${Loud} control onClick=${noop}>Accept<//><${Action} small onClick=${noop}>Decline<//><//>
      <//>
      <${ConversationTools}><${Action} small onClick=${noop}>Select<//><//>
      <${ConversationSection} kind="people" label="People" count=${3} unread=${2} open onToggle=${noop}>
        <${ConversationRow} title="mika" mark=${{ picture: 'mika@aimeat-local-001-dev' }} date="10:42" dateTitle="27 September 2026, 10:42"
          subject="Brand colours" preview="The client wants the coral a little warmer." unread=${1} active onOpen=${noop}
          archive=${{ label: 'Archive', ariaLabel: 'Archive: mika', onClick: noop }} />
        <${ConversationGroup} open onToggle=${noop} picture="second@aimeat-local-001-dev" name="second" countLabel="2 conversations" unreadLabel="1 unread"
          archive=${{ label: 'Archive all', ariaLabel: 'Archive all: second', onClick: noop }}>
          <${ConversationRow} nested title="Seat map" mark=${{ word: '#' }} date="yesterday" preview="You: I will add it." onOpen=${noop} />
          <${ConversationRow} nested title="Invoice" mark=${{ word: 'ag' }} chips=${['via bot']} date="Mon" preview="Draft attached." unread=${1} onOpen=${noop} />
        <//>
        <${ConversationFold} open=${false} onToggle=${noop} label="→ Show all 5"
          row=${html`<${ConversationRow} title="Winter timetable" chips=${['12 recipients']} date="Sep 20" preview="You: The morning boat leaves at 07:10." onOpen=${noop} />`} />
      <//>
      <${ConversationSection} kind="archive" label="Archive" count=${4} open=${false} onToggle=${noop} />
    <//><//>` },
    { name: 'selecting', render: () => html`<${SettingsRoot}><${ConversationList} selecting>
      <${ConversationTools} count="1 selected"><${Action} small onClick=${noop}>Archive<//><${Action} small onClick=${noop}>Cancel<//><//>
      <${ConversationSection} kind="people" label="People" count=${2} open onToggle=${noop}>
        <${ConversationRow} title="mika" mark=${{ picture: 'mika@aimeat-local-001-dev' }} date="10:42" preview="The client wants the coral a little warmer." selecting selected onOpen=${noop} />
        <${ConversationRow} title="Old invoices" why="archived: no answer in 30 days" date="Aug 2" preview="You: Paid, thank you." selecting onOpen=${noop} />
      <//>
    <//><//>` },
    { name: 'empty', render: () => html`<${SettingsRoot}><${ConversationList} empty="No conversations yet." /><//>` },
    { name: 'rows standing alone (a broadcast\'s results)', render: () => html`<${SettingsRoot}><${ConversationRows}>
      <${ConversationRow} title="Harbour Studio members" date="Sep 20" preview="12 of 12 delivered" onOpen=${noop} openLabel="Harbour Studio members: 12 of 12 delivered" />
    <//><//>` },
  ] },
  'conversation-pane': { height: 560, variants: [
    { name: 'the list beside an open conversation', render: () => html`<${SettingsRoot}><${Panes} open backLabel="Conversations" onBack=${noop}
        side=${html`<${ConversationList}><${ConversationSection} kind="people" label="People" count=${1} open onToggle=${noop}>
          <${ConversationRow} title="mika" mark=${{ picture: 'mika@aimeat-local-001-dev' }} date="10:42" preview="The client wants the coral a little warmer." active onOpen=${noop} /><//><//>`}>
      <${Pane}>
        <${PaneHead} picture="mika@aimeat-local-001-dev" name="mika" nameTitle="mika@aimeat-local-001-dev" subject="Brand colours" via="sent by your agent" address="mika@aimeat-local-001-dev">
          <${PaneDoor} mark="🔊" label="Listen" title="Read the conversation aloud" onClick=${noop} />
          <${PaneDoor} label="Reply with AI" onClick=${noop} />
        <//>
        <${Thread}><${Message} id="dl-pane-1" who="mika" body="The client wants the coral a little warmer." time="10:42" /><//>
        <${ReplyBar} label="↩ Replying to mika" text="The client wants the coral a little warmer." onJump=${noop} cancelLabel="Drop the quote" onCancel=${noop} />
        <${Composer} tone="message" recipient="mika@aimeat-local-001-dev" sendLabel="Reply" onSend=${noop} />
      <//>
    <//><//>` },
    { name: 'nothing open yet', render: () => html`<${SettingsRoot}><${Panes} open=${false} backLabel="Conversations" onBack=${noop}
        side=${html`<${ConversationList} empty="No conversations yet." />`}>
      <${Pane} empty>Pick a conversation, or start a new one.<//>
    <//><//>` },
    { name: 'a page\'s column: fields, a strip, a scroll, read only', render: () => html`<${SettingsRoot}><${Pane} page>
      <${PaneFields}><label>To <input aria-label="To" value="Harbour Studio members" readonly /></label><//>
      <${PaneStrip}><${Action} small onClick=${noop}>/status<//><${Action} small onClick=${noop}>/stop<//><//>
      <${PaneStrip} grey>Runs every weekday at 07:00.<//>
      <${PaneScroll}><${ConversationRows}><${ConversationRow} title="Harbour Studio members" date="Sep 20" preview="12 of 12 delivered" onOpen=${noop} /><//><//>
      <${PaneNote}>This is an announcement. Nobody can answer it.<//>
    <//><//>` },
    { name: 'framed: a list beside the thing opened from it (an operator page)', render: () => html`<${OperatorFrame} title="System prompts"><${Panes} framed label="Prompts"
        head=${html`<${SearchLine} find text value="" onInput=${noop} placeholder="Find a prompt" note="3 of 3" />`}
        side=${html`<${List} cols="name" dense>
          <${Row} selected><${Name} onOpen=${noop} meta="build-app · v4">Build an app<//><//>
          <${Row}><${Name} onOpen=${noop} meta="chat-agent · v2">The chat agent<//><//>
          <${Row}><${Name} onOpen=${noop} meta="welcome-mat · v1">The welcome mat<//><//>
        <//>`}>
      <${TextArea} label="Build an app" code rows=${8} value=${'You build one single-file web app on this AIMEAT node.\nRead the owner\'s request first, then the app catalogue.'} onInput=${noop} />
    <//><//>` },
  ] },
  'board-notices': { variants: [
    { name: 'two notices, one without a kind', render: () => html`<${SettingsRoot}>
      <${BoardNotice} kind="News" title="The ferry timetable changes on Monday" onOpen=${noop} words="The morning boat leaves at 07:10 from now on."
        who="second" whoNote="member" board=${{ name: 'Harbour', onOpen: noop }} time="today 09:12" left="6 days left" counts="2 replies · 1 thanks" />
      <${BoardNotice} title="Who has the key to the shed?" onOpen=${noop} who="sandbox" time="yesterday" counts="0 replies" />
    <//>` },
    { name: 'a notice\'s page: its text and a reply', render: () => html`<${SettingsRoot}>
      <${BoardNoticeText}>The morning boat leaves at 07:10 from now on. The evening boat keeps its time.${'\n\n'}Ask at the office for the printed timetable.<//>
      <${Message} tone="board" who="sandbox" whoNote="owner" time="today 10:02" body="Thank you, I will put it on the wall." plain />
    <//>` },
    { name: 'a long title', render: () => html`<${SettingsRoot}><${BoardNotice} kind="Question" title="Does anybody know whether the Nordic Ferries winter timetable applies to the island route as well?" onOpen=${noop} who="second" time="Sep 20" counts="5 replies" /><//>` },
    { name: 'a title that opens nothing (an operator page)', render: () => html`<${OperatorFrame} title="Boards"><${BoardNotice} kind="News" title="The ferry timetable changes on Monday"
      words="The morning boat leaves at 07:10 from now on." who="second" board=${{ name: 'Harbour', onOpen: noop }} time="today 09:12" left="6 days left" counts="2 replies" /><//>` },
  ] },
};
