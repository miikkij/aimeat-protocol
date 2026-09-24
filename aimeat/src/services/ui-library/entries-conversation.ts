/**
 * @file src/services/ui-library/entries-conversation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the parts of a conversation with an agent: the frame, the list
 *   of conversations, one turn, what it produced and what it did, the box, and the notices around
 *   them. The purpose half only; facts.generated.ts carries what the files say.
 * @structure CONVERSATION_ENTRIES
 * @usage import { CONVERSATION_ENTRIES } from './entries-conversation.js';
 * @version-history
 *   v1.1.0 — 2026-09-24 — The suggestion's caps variant removed (Jouni's decision "Suggestion").
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntryWritten } from './types.js';

export const CONVERSATION_ENTRIES: UiEntryWritten[] = [
    {
        id: 'conversation-frame', name: 'ConversationFrame', kind: 'component', status: 'active',
        summary: 'A conversation with an agent: the rail with the threads and everything about the open one, the conversation, and on a phone one pane at a time, fixed full-screen above the keyboard.',
        module: '/components/ConversationFrame.js', sheet: '/css/components/conversation-frame.css',
        data: {
            shape: 'ConversationFrame({ list, signin, children }) · ConversationAbout({ label, name, children }) · ConversationFoot · ConversationMain · ConversationHead({ backHref, backLabel, title, children }) · ConversationIcon({ label, onClick, children }) · ConversationScroll({ onScroll, children }) · ConversationWelcome({ title, body, trust, children }) · ConversationJump({ onClick, children }) · ConversationCap({ title, body, children })',
            fields: {
                list: 'the rail is open (a phone shows it instead of the conversation)', signin: 'the signed-out page',
                label: 'ConversationAbout: the rail heading', name: 'ConversationAbout: the conversation name',
                backHref: 'ConversationHead: where the phone\'s back link goes', title: 'the conversation name, or a welcome or cap headline',
                body: 'the welcome or cap text', trust: 'ConversationWelcome: the line on who owns what is made',
            },
        },
        useFor: ['The chat page. A ThreadList goes first inside it, then a ConversationMain.'],
        variants: [
            { name: 'list', class: 'poster-conversation--list', prop: 'list', when: 'on a phone, the rail is open' },
            { name: 'signin', class: 'poster-conversation--signin', prop: 'signin', when: 'nobody is signed in' },
        ],
        example: { list: false, about: { label: 'This conversation', name: 'Make me a page' }, head: { backHref: '/v1/home', backLabel: 'Back', title: 'Make me a page' } },
    },
    {
        id: 'thread-list', name: 'ThreadList', kind: 'component', status: 'active',
        summary: 'The person\'s conversations: one row each, the open one on the sun, a way to delete.',
        module: '/components/ThreadList.js', sheet: '/css/components/thread-list.css',
        data: {
            shape: 'ThreadList({ threads, activeId, onOpen, onNew, onDelete, onClose, children })',
            fields: { threads: '[{ id, title, turns }]', activeId: 'the open one', onOpen: 'open a thread', onNew: 'start one', onDelete: 'delete one', onClose: 'the phone\'s way back', children: 'what goes under the list in the rail' },
        },
        useFor: ['The rail of the chat page, and its drawer on a phone.'],
        variants: [{ name: 'active', class: 'poster-thread--active', when: 'the open conversation' }],
        example: { threads: [{ id: 't1', title: 'Make me a page', turns: 4 }], activeId: 't1' },
    },
    {
        id: 'agent-status', name: 'AgentStatus', kind: 'component', status: 'active',
        summary: 'Who answers and on whose money, as a column of mono facts.',
        module: '/components/AgentStatus.js', sheet: '/css/components/agent-status.css',
        data: {
            shape: 'StatusBar({ status, onReset })',
            fields: { status: '{ agent_name, pays: own|allowance|node, has_own_key, allowance_remaining_usd, model, enabled }', onReset: 'starts a fresh agent session, or null' },
        },
        useFor: ['In the rail of a conversation. The payer comes from the node, never from the page.'],
        variants: [],
        example: { status: { agent_name: 'chat#alice@aimeat.io', pays: 'node', has_own_key: false, allowance_remaining_usd: 1.5, model: 'claude-sonnet-5' } },
    },
    {
        id: 'rail-action', name: 'RailAction', kind: 'component', status: 'active',
        summary: 'A small ink-underlined action in a side column.',
        module: null, sheet: '/css/components/rail-action.css', classes: ['poster-rail-action'],
        data: { shape: 'class: poster-rail-action (on a button, or as a CopyButton className)', fields: { children: 'the action words' } },
        useFor: ['Copy conversation and Reset session in the chat rail.'],
        variants: [],
        example: { children: 'Copy conversation' },
        note: 'A class rather than a module: it is put on a CopyButton and on the reset button in AgentStatus.',
    },
    {
        id: 'suggestion', name: 'Suggestion', kind: 'component', status: 'active',
        summary: 'Underlined words a person can press instead of typing: the agent\'s choices, and the starters in capitals.',
        module: '/components/Suggestion.js', sheet: '/css/components/suggestion.css',
        data: {
            shape: 'Suggestions({ children }) · Suggestion({ disabled, onClick, children }) · Choices({ options, onPick, disabled }) · choicesIn(text) · stripChoices(text)',
            fields: { options: 'the choices an agent offered in an aimeat-choices block', onPick: 'sends the chosen words', disabled: 'no agent here' },
        },
        useFor: ['A fork the agent named, or a first request on an empty conversation.'],
        variants: [],
        example: { options: ['A page about my team', 'A form for sign-ups', 'Something else'] },
    },
    {
        id: 'turn', name: 'Turn', kind: 'component', status: 'active',
        summary: 'One thing said: the person\'s words on the sun, the agent\'s with a coral spine, the time and model under it, and a turn that could not run.',
        module: '/components/Turn.js', sheet: '/css/components/turn.css',
        data: {
            shape: 'Turn({ turn, id }) · LiveTurn({ text, thought, tools, cards, busy }) · TurnError({ message, onRetry })',
            fields: { turn: '{ role: user|agent, text, at, model, tools, cards, attachments }', id: 'the key for reading it aloud', busy: 'LiveTurn: the answer is still being written', message: 'TurnError: why it could not run', onRetry: 'TurnError: send it again' },
        },
        useFor: ['Each message in a conversation. The agent\'s words are Markdown, the person\'s are shown as typed.'],
        variants: [
            { name: 'user', class: 'poster-turn--user', when: 'what the person said' },
            { name: 'agent', class: 'poster-turn--agent', when: 'what the agent said' },
            { name: 'live', class: 'poster-turn--live', when: 'an answer still being written' },
        ],
        example: { turn: { role: 'agent', text: 'Your page is ready.', at: '2026-09-23T10:42:00Z', model: 'claude-sonnet-5' } },
    },
    {
        id: 'result-card', name: 'ResultCard', kind: 'component', status: 'active',
        summary: 'What a turn produced, as a thing: its kind, its name and a way to open it.',
        module: '/components/ResultCard.js', sheet: '/css/components/result-card.css',
        data: { shape: 'ResultCards({ cards })', fields: { cards: '[{ kind: page|app|image|file|memory|workspace, title, url, ref, image }]' } },
        useFor: ['Under an agent turn that made something. Cards are stored on the turn, so they come back.'],
        variants: [
            { name: 'page', class: 'poster-result--page', when: 'a page' },
            { name: 'app', class: 'poster-result--app', when: 'an app' },
            { name: 'image', class: 'poster-result--image', when: 'a picture' },
            { name: 'file', class: 'poster-result--file', when: 'a file' },
            { name: 'memory', class: 'poster-result--memory', when: 'a memory record' },
            { name: 'workspace', class: 'poster-result--workspace', when: 'a workspace document' },
        ],
        example: { cards: [{ kind: 'page', title: 'Team page', url: 'https://alice.aimeat.io/team' }] },
    },
    {
        id: 'work-log', name: 'WorkLog', kind: 'component', status: 'active',
        summary: 'What was actually done, one line per tool call, and the live status while a turn runs.',
        module: '/components/WorkLog.js', sheet: '/css/components/work-log.css',
        data: { shape: 'WorkLog({ tools }) · WorkLine({ tool })', fields: { tools: '[{ title, status: pending|completed|failed }]' } },
        useFor: ['Under every agent turn, open by default, so what the agent says it did can be checked.'],
        variants: [
            { name: 'completed', class: 'poster-worklog-line--completed', when: 'the call finished' },
            { name: 'failed', class: 'poster-worklog-line--failed', when: 'the call failed' },
        ],
        example: { tools: [{ title: 'aimeat_app_publish', status: 'completed' }] },
        note: 'The live status under a running turn (Turn.js LiveStatus) reads this sheet too.',
    },
    {
        id: 'ai-notice', name: 'AiNotice', kind: 'component', status: 'active',
        summary: 'That a machine is on the other end, said where a person is looking, with a way to read more.',
        module: '/components/AiNotice.js', sheet: '/css/components/ai-notice.css',
        data: { shape: 'AiNotice({ compact, className })', fields: { compact: 'one line instead of the full notice', className: "'poster-ai-notice--main' for the phone's copy above the conversation" } },
        useFor: ['Every conversation with an AI (EU AI Act, Article 50(1)). Never removed, only shortened.'],
        variants: [
            { name: 'compact', class: 'poster-ai-notice--compact', prop: 'compact', when: 'after the first answer' },
            { name: 'main', class: 'poster-ai-notice--main', when: 'the phone\'s copy, above the conversation' },
        ],
        example: { compact: false },
    },
    {
        id: 'nudge', name: 'Nudge', kind: 'component', status: 'active',
        summary: 'One suggestion, once, in a dashed frame, with the way out on the same line.',
        module: '/components/Nudge.js', sheet: '/css/components/nudge.css',
        data: { shape: 'MobileNudge({ onDismiss })', fields: { onDismiss: 'stores "not now" with the person' } },
        useFor: ['The one nudge to put the chat on a phone, shown on a desktop when no device is subscribed.'],
        variants: [],
        example: {},
    },
    {
        id: 'credit', name: 'Credit', kind: 'component', status: 'active',
        summary: 'Whose agent this is, quietly, as a link.',
        module: '/components/Credit.js', sheet: '/css/components/credit.css',
        data: { shape: 'GooseCredit()', fields: {} },
        useFor: ['The foot of the chat rail: the open-source agent that answers, linked to its source.'],
        variants: [],
        example: {},
    },
    {
        id: 'composer', name: 'Composer', kind: 'component', status: 'active',
        summary: 'The box a person types into: one row with the field, the tool buttons and the send slab, and the attachments waiting to go.',
        module: '/components/Composer.js', sheet: '/css/components/composer.css',
        data: {
            shape: 'Composer({ value, onInput, onSend, onStop, onSpeak, onAttach, attachments, onDropAttachment, busy, disabled, note, listening, voiceMaxSeconds })',
            fields: {
                value: 'the text', onInput: 'called with the new text', onSend: 'Enter or Send', onStop: 'Stop while busy',
                onSpeak: 'a recording to turn into text', onAttach: 'files picked', attachments: '[{ id, name, state: uploading|error, preview, error }]',
                busy: 'a turn is running', disabled: 'no agent here', note: 'why it is disabled', listening: 'a recording is being read',
            },
        },
        useFor: ['The foot of a conversation. Enter sends, Shift+Enter opens a line.'],
        variants: [{ name: 'error', class: 'poster-attachment--error', when: 'an attachment that failed to upload' }],
        example: { value: 'Make me a page about my team', busy: false, attachments: [] },
    },
];
