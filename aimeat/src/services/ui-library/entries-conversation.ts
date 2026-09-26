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
 *   v1.5.0 — 2026-09-27 — Messages on components: Message, MessageFile, MessageQuestions, MessageComposer,
 *     ConversationList and ConversationPane; the Turn's variants are what Turn.js draws (the name line went), the Composer's are its chat row,
 *     its slash commands and its message tone (the stacked cut went).
 *   v1.4.0 — 2026-09-26 — The typing box is the chat's one row (.poster-composer and its stacked cut): the field with the thick line under it, the tools as framed squares, the dark block that sends with the page's word; Messages (and its Broadcast form) and an agent's Chat tab take it; the framed field, the round-cornered tools and the box's frame go (a unification: Jouni's decision "Typing box").
 *   v1.3.0 — 2026-09-26 — A message is the chat's turn (components/Turn.js classes): your words bold on the sun, the other side's beside the pale coral spine, the name above the words, the time and the read marks under them with Copy and Listen, the other six actions behind one ⋯ (CardMenu inline); an agent's options are the chat's choices. The frame, the picture beside the other side, the action pill and the Chat tab's bubbles, pairing lines and small reader go; a suggested reply waiting for approval keeps its dashed box (a unification: Jouni's decision "Message").
 *   v1.2.0 — 2026-09-26 — ThreadList's person tone (ThreadPerson) and Messages as a use (Jouni's decision "Conversation list").
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
            shape: 'ThreadList({ threads, activeId, onOpen, onNew, onDelete, onClose, children }) · ThreadPerson({ expanded, onClick, children })',
            fields: { threads: '[{ id, title, turns }]', activeId: 'the open one', onOpen: 'open a thread', onNew: 'start one', onDelete: 'delete one', onClose: 'the phone\'s way back', children: 'what goes under the list in the rail; in ThreadPerson, its words', expanded: 'the person\'s conversations are shown' },
        },
        useFor: ['The rail of the chat page, and its drawer on a phone.', 'Messages: your conversations with people, grouped by person (the rows as markup, .poster-thread-list).'],
        variants: [
            { name: 'active', class: 'poster-thread--active', when: 'the open conversation; the line under its name is dark on the sun' },
            { name: 'person', class: 'poster-thread-person', prop: 'ThreadPerson', when: 'a heading over one person\'s conversations that opens and closes them' },
        ],
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
        useFor: ['Each message in a conversation. The agent\'s words are Markdown, the person\'s are shown as typed.', 'Messages and an agent\'s Chat tab: a message between two people, or between you and your agent, is this turn drawn by the Message component (components/Message.js, entry message), which puts who wrote it and when inside it; your Markdown stays ink on the sun (this sheet).'],
        variants: [
            { name: 'user', class: 'poster-turn--user', prop: 'turn.role="user"', when: 'what the person said' },
            { name: 'agent', class: 'poster-turn--agent', prop: 'turn.role="agent"', when: 'what the agent said' },
            { name: 'live', class: 'poster-turn--live', prop: 'LiveTurn', when: 'an answer still being written' },
            { name: 'could not run', class: 'poster-turn-error', prop: 'TurnError', when: 'the turn failed: the coral frame with why and Try again' },
        ],
        note: 'The name line above the words (.poster-turn-who) went on 2026-09-26: who wrote a message is inside it again, the Message\'s .message-who.',
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
        summary: 'The box a person types into: one row with the field (the thick line under it), the tools as framed squares and the dark block that sends, and the attachments waiting to go above it. Its message tone is Messages\' composer (MessageComposer).',
        module: '/components/Composer.js', sheet: '/css/components/composer.css',
        data: {
            shape: 'Composer({ tone, …}) · ChatComposer({ value, onInput, onSend, onStop, onSpeak, onAttach, attachments, onDropAttachment, busy, disabled, note, listening, voiceMaxSeconds, placeholder, sendLabel, sending, inputRef, suggest, suggestLabel })',
            fields: {
                tone: '"message": Messages\' composer, whose props are MessageComposer\'s (entry message-composer); none: the chat\'s row',
                value: 'the text', onInput: 'called with the new text', onSend: 'Enter or Send', onStop: 'Stop while busy',
                onSpeak: 'a recording to turn into text', onAttach: 'files picked', attachments: '[{ id, name, state: uploading|error, preview, error }]',
                onDropAttachment: 'called with the id of an attachment taken off',
                busy: 'a turn is running', disabled: 'no agent here', note: 'why it is disabled', listening: 'a recording is being read',
                voiceMaxSeconds: 'how long a recording may run', placeholder: 'the empty field\'s own words', sendLabel: 'the send block\'s own word',
                sending: 'a message is on its way: Send is held and Enter does not send twice', inputRef: 'a ref the page uses to put the cursor in the field',
                suggest: '[{ key, name, desc, onPick }]: what the typed words can become (an agent\'s slash commands), in a list over the field',
                suggestLabel: 'that list\'s name',
            },
        },
        useFor: ['The foot of a conversation. Enter sends, Shift+Enter opens a line.', 'An agent\'s Messages tab: the chat\'s row with its own words, the held send and the slash commands.', 'Messages and its Broadcast form: tone="message".'],
        variants: [
            { name: 'error', class: 'poster-attachment--error', prop: 'attachments[].state="error"', when: 'an attachment that failed to upload' },
            { name: 'suggest', class: 'poster-composer--suggest', prop: 'suggest', when: 'the slash commands over the field' },
            { name: 'message', class: 'poster-composer--message', prop: 'tone="message"', when: 'Messages: the field over the whole width, its tools and the send block on the line under it' },
        ],
        note: 'The stacked cut (.poster-composer--stack) went on 2026-09-26: Messages\' composer is the message tone.',
        example: { value: 'Make me a page about my team', busy: false, attachments: [] },
    },
    // Messages on components (component plan C2, "Thread and Composer").
    {
        id: 'message', name: 'Message', kind: 'component', status: 'active',
        summary: 'One thing somebody said, and the thread that holds them. A message is the chat\'s turn: yours bold on the sun, the other side\'s beside the pale coral spine. Inside it: the quoted message it answers (a press jumps to it), who wrote it in the row label\'s small capitals, the words (Markdown, or as written), the questions it asks, its files, and one line with the marks, the time and the read marks. Under it Copy (⧉), Listen and the other actions behind one ⋯. Its tones: a suggested reply in a dashed box, a workspace comment framed on the grey ground, a board reply beside a grey edge.',
        module: '/components/Message.js', sheet: '/css/components/message.css',
        data: {
            shape: 'Message({ id, mine, tone, reply, who, whoNote, label, quote, body, plain, time, timeTitle, receipt, marks, questions, files, onOpenText, onTranscribe, canTranscribe, copy, copyLabel, listen, menu, menuLabel, actions, children }) · '
                + 'Thread({ scrollRef, tone, capped, children }) · ThreadDay({ children }) · ThreadTop({ children }) · ThreadForm({ children }) · Listen({ id, text }) · useSpeechPhase(id) · flashMessage(domId)',
            fields: {
                id: 'the message\'s DOM id (a quote jumps to it)', mine: 'your own message: on the sun, on the right',
                tone: 'none: a message | "draft": a reply your AI wrote that waits for your yes | "comment": a comment on a workspace record or document | "board": a reply to a board notice',
                reply: 'comment: a reply, indented with the coral edge', who: 'who wrote it', whoNote: 'comment and board: the notes after the name (a string or a list: "reply", a section, a standing)',
                label: 'draft: the line above the words', quote: '{ name, text, title, onJump }: the message it answers',
                body: 'the words (Markdown)', plain: 'the words as written, not Markdown', time: 'when', timeTitle: 'the full date as the tooltip',
                receipt: '{ mark: "✓✓", tone: read | error, title }: the read marks', marks: '[{ text, title, tone: ai | model | fine | attention | danger | off }]: the Tags and Statuses beside the time',
                questions: '{ spec, answers, submitting, onSubmit }: the questions it asks (MessageQuestions)',
                files: '[{ id, name, url, kind, mime, state: expired | pending, durationSeconds, transcript }]: its files (MessageFile)',
                onOpenText: '(url, name): opens a Markdown file in the reader', onTranscribe: '(fileId): produces a voice message\'s transcript', canTranscribe: 'false: no transcription model, the row says so',
                copy: 'the raw text Copy puts on the clipboard', copyLabel: 'Copy\'s name', listen: '{ id, text }: Listen reads it aloud', menu: '[{ label, run, danger }]: the ⋯ menu',
                menuLabel: 'the ⋯ menu\'s name', actions: 'draft, comment, board: the page\'s actions under the words', children: 'Message: what stands under the words (link previews); Thread: the messages',
                scrollRef: 'Thread: a ref the page holds to follow the newest message', capped: 'Thread: inside a page, it scrolls after 400px',
                'Thread.tone': '"comments": the comments under a record or a document, under a hairline',
                'ThreadDay.children': 'the day a run of messages was written', 'ThreadTop.children': 'the line at the top (the way to older messages)',
                'ThreadForm.children': 'the form under a thread of comments', 'Listen.id': 'which message reads', 'Listen.text': 'what it reads',
                useSpeechPhase: '(id) → "" | speaking | paused: the reader\'s phase for one message', flashMessage: '(domId): scroll a message into view and flash it',
            },
        },
        useFor: ['Messages: the thread of a conversation with a person or an agent.', 'An agent\'s Messages tab: a capped thread inside the page.', 'The comments under a workspace record or document, and the replies under a board notice.'],
        variants: [
            { name: 'mine', class: 'poster-turn--user', prop: 'mine', when: 'your own message: bold on the sun' },
            { name: 'draft', class: 'message--draft', prop: 'tone="draft"', when: 'a reply your AI wrote that waits for your yes, in a dashed box' },
            { name: 'comment', class: 'message--comment', prop: 'tone="comment"', when: 'a comment on a workspace record or document' },
            { name: 'reply', class: 'message--reply', prop: 'tone="comment" reply', when: 'a reply to a comment, indented with the coral edge' },
            { name: 'board', class: 'message--board', prop: 'tone="board"', when: 'a reply to a board notice, beside a grey edge' },
            { name: 'read', class: 'message-receipt--read', prop: 'receipt.tone="read"', when: 'the other side read it' },
            { name: 'capped', class: 'message-thread--capped', prop: 'Thread capped', when: 'a thread inside a page' },
            { name: 'comments', class: 'message-comments', prop: 'Thread tone="comments"', when: 'the comments under a record or a document' },
            { name: 'flash', class: 'message--flash', prop: 'flashMessage(id)', when: 'a message a quote jumped to, for a moment' },
        ],
        example: { mine: false, who: 'mika', body: 'The client wants the coral **a little warmer**.', time: '10:42', marks: [{ text: 'AI wrote this', tone: 'ai' }] },
        note: 'Built on 2026-09-26 from Messages\' MessageBubble (views/profile/inbox-tab), the suggested reply\'s dashed box, a workspace comment (comments.css, .pj-comment*) and a board reply (.bp-reply) as one component with tones. It wears turn.css (the chat\'s turn) under its own sheet.',
    },
    {
        id: 'message-file', name: 'MessageFile', kind: 'component', status: 'active',
        summary: 'A file that came with a message: a picture as a thumbnail that opens full size, a voice message that plays where it sits with its transcript, a Markdown file that opens in the reader, any other file as a round chip that opens in a new tab, and a download mark beside each. A file not yet copied to the reader, or one that expired, says so in a word, and its tooltip says the rest. Only one player plays at a time.',
        module: '/components/MessageFile.js', sheet: '/css/components/message.css',
        classes: ['message-files', 'message-file', 'message-file--pending', 'message-file-name', 'message-file-state', 'message-file-open', 'message-file-get', 'message-file-picture', 'message-file-thumb-link', 'message-file-thumb', 'message-file-cap', 'message-file-voice', 'message-audio', 'message-audio--small', 'message-file-length', 'message-transcript', 'message-transcript-toggle', 'message-transcript-src', 'message-transcript-text', 'message-transcript-btn'],
        data: {
            shape: 'MessageFiles({ files, onOpenText, onTranscribe, canTranscribe }) · MessageFile({ file, onOpenText, onTranscribe, canTranscribe }) · VoicePlayer({ src, small }) · TranscriptPanel({ file, onTranscribe, canTranscribe }) · fmtClock(seconds) · stopOtherAudio(current) · attachKind(attachment)',
            fields: {
                files: 'the files of one message, in a row that wraps', file: '{ id, name, storageKey, url, kind, mime, state: expired | pending, durationSeconds, transcript: { text, by: sender | you, model } }',
                onOpenText: '(url, name): opens a Markdown file in the reader', onTranscribe: '(fileId): produces a transcript (a promise; its error is shown in place)',
                canTranscribe: 'false: no transcription model is set, the row says so', src: 'VoicePlayer: the sound\'s address', small: 'VoicePlayer: the small player in a file waiting to be sent',
                fmtClock: 'seconds → "0:14"', stopOtherAudio: 'silences every other player and the read-aloud', attachKind: 'a file → image | pdf | markdown | audio | video | file',
            },
        },
        useFor: ['The files of a message in Messages (through Message files=); the recording chip in Messages\' composer (VoicePlayer small).'],
        variants: [
            { name: 'pending', class: 'message-file--pending', prop: 'file.state="pending" | "expired"', when: 'a file not yet copied to you, or gone: dimmed, with its state in a word' },
            { name: 'picture', class: 'message-file-picture', prop: 'file.kind="image"', when: 'a picture: the thumbnail and its caption' },
            { name: 'voice', class: 'message-file-voice', prop: 'file.kind="audio"', when: 'a voice message: the player, its length and its transcript' },
            { name: 'small player', class: 'message-audio--small', prop: 'VoicePlayer small', when: 'a recording waiting to be sent' },
        ],
        example: { files: [{ id: 'f1', name: 'brief.md', url: '#', kind: 'markdown' }, { id: 'f2', name: 'offer.pdf', url: '#', kind: 'pdf' }] },
        note: 'Moved on 2026-09-26 out of views/profile/inbox-tab (AttachmentItem, AudioAttachment, TranscriptPanel and their helpers) with the same behaviour; its look is its own classes of message.css.',
    },
    {
        id: 'message-questions', name: 'MessageQuestions', kind: 'component', status: 'active',
        summary: 'The questions a message asks: each with its short name as a Tag, its words, a coral star when it must be answered, its choices as framed lines with a radio dot or a check box (the chosen one coral on a pale ground), an "Other" line to write in, and the loud action that sends, held until every required question has an answer. Once answered, the message shows ✓ and what was chosen instead.',
        module: '/components/MessageQuestions.js', sheet: '/css/components/message.css',
        classes: ['message-questions', 'message-questions-q', 'message-questions-tag', 'message-questions-prompt', 'message-questions-req', 'message-questions-opts', 'message-questions-opt', 'message-questions-opt--on', 'message-questions-opt-label', 'message-questions-other', 'message-questions-send', 'message-questions--done', 'message-questions-answered'],
        data: {
            shape: 'MessageQuestions({ spec, answers, submitting, onSubmit }) · QUESTION_OTHER',
            fields: {
                spec: '{ questions: [{ id, header, prompt, required, multiSelect, allowOther, options: [{ id, label }] }], submitLabel }',
                answers: 'the answers given: the read-only summary instead of the form', submitting: 'the answers are on their way: the send is held',
                onSubmit: '(answers) with { [questionId]: { selected: [optionId…], other } }', QUESTION_OTHER: 'the id of the "Other" choice',
            },
        },
        useFor: ['A message from an agent on another node that asks the reader to choose (a federated AskUserQuestion), through Message questions=.'],
        variants: [
            { name: 'chosen', class: 'message-questions-opt--on', when: 'the choice picked' },
            { name: 'answered', class: 'message-questions--done', prop: 'answers', when: 'the questions answered: what was chosen, read only' },
        ],
        example: { spec: { questions: [{ id: 'q1', header: 'Colour', prompt: 'Which coral?', required: true, options: [{ id: 'a', label: 'Warmer' }, { id: 'b', label: 'As it is' }] }] } },
        note: 'Moved on 2026-09-26 out of views/profile/inbox-tab/interactive-form.js (InteractiveForm, InteractiveAnswered) with the same behaviour; its look is its own classes of message.css.',
    },
    {
        id: 'message-composer', name: 'MessageComposer', kind: 'component', status: 'active',
        summary: 'Where a person writes a message to another person or their agent (the Composer\'s message tone): the field over the whole width with the thick line under it, growing with its words; under it the tools as framed squares (attach, the voice recorder, ⤢ the bigger editor) and the dark block that sends at the end of that line; the files waiting to go as round chips above, a recording\'s chip with its player. It keeps its own draft per conversation.',
        module: '/components/MessageComposer.js', sheet: '/css/components/composer.css',
        classes: ['poster-composer--message', 'poster-composer-bar', 'poster-composer-tools', 'poster-composer-chips', 'poster-composer-chip', 'poster-composer-chip--voice', 'poster-composer-chip-voice', 'poster-composer-chip-x', 'poster-composer-fallback', 'poster-composer-area', 'poster-composer-preview', 'poster-composer--tall', 'poster-composer-editor'],
        data: {
            shape: 'MessageComposer({ recipient, sendLabel, sending, onSend, initialText, draftKey, focusNonce, voiceMaxSeconds }) · loadToastUI() · bigEditorHeight() · used as Composer({ tone: "message", … })',
            fields: {
                recipient: 'who it goes to; without one the send block is held', sendLabel: 'the send block\'s word', sending: 'the message is on its way: the block says so and does not send twice',
                onSend: '(recipient, markdown, files, reset): sends; reset clears the field, the files and the saved draft',
                initialText: 'a suggested reply to start from (it wins over a saved draft)', draftKey: 'where the draft is kept in the browser, one per conversation',
                focusNonce: 'bump it to put the cursor in the field (after ↩ Reply)', voiceMaxSeconds: 'how long a recording may run',
                loadToastUI: 'loads the bigger editor (Toast UI) only when asked', bigEditorHeight: 'the bigger editor\'s height: half the window, 240 to 560px',
            },
        },
        useFor: ['Messages and its Broadcast form: the foot of a conversation with a person or an agent. Give it a key per conversation so a draft never leaks between threads.'],
        variants: [
            { name: 'chips', class: 'poster-composer-chips', when: 'files waiting to go, above the field' },
            { name: 'voice chip', class: 'poster-composer-chip--voice', when: 'a recording waiting to go, with its player' },
            { name: 'tall', class: 'poster-composer--tall', when: 'the bigger editor is open (⤢)' },
            { name: 'fallback', class: 'poster-composer-fallback', when: 'the bigger editor cannot load: a Markdown field with its preview' },
        ],
        example: { recipient: 'mika@aimeat-local-001-dev', sendLabel: 'Reply', sending: false },
        note: 'Moved on 2026-09-26 out of views/profile/inbox-tab/components.js (Composer) with every behaviour unchanged; its look is its own classes of composer.css, beside the chat\'s row (entry composer).',
    },
    {
        id: 'conversation-list', name: 'ConversationList', kind: 'component', status: 'active',
        summary: 'A person\'s conversations with people and agents, Messages\' left column: the chat\'s rows, the open one on the sun. Each row keeps its kind mark (a picture, or "ag", "#" or "·" inside a group), its name in bold with its Tags and date, the subject in coral typewriter and the last message under it, its unread count, why it was archived, and an archive square that shows under the pointer. Rows sit in sections and under a person\'s or an agent\'s heading, both of which close; a row that stands for several threads opens them; contact requests wait at the top on a pale coral ground.',
        module: '/components/ConversationList.js', sheet: '/css/components/conversation-list.css',
        data: {
            shape: 'ConversationList({ selecting, empty, children }) · ConversationRows({ children }) · ConversationTools({ count, children }) · ConversationRequests({ label, count, children }) · '
                + 'ConversationRequest({ picture, name, presence, address, preview, children }) · ConversationSection({ kind, label, count, unread, open, onToggle, children }) · '
                + 'ConversationGroup({ open, onToggle, picture, name, presence, countLabel, unreadLabel, pick, archive, children }) · '
                + 'ConversationRow({ title, presence, mark, date, dateTitle, chips, subject, preview, why, unread, active, nested, selecting, selected, onOpen, openLabel, archive }) · '
                + 'ConversationFold({ row, open, onToggle, label, closed, children })',
            fields: {
                selecting: 'many rows are being picked: the selection line stays at the top, a row press picks', empty: 'the quiet line when there is no conversation yet',
                count: 'ConversationTools: how many are picked; ConversationRequests: how many wait; ConversationSection: how many rows',
                label: 'the heading\'s words; ConversationFold: the disclosure\'s words', picture: 'a seed for the Avatar', name: 'the person\'s or agent\'s name',
                presence: 'a GHII whose presence dot is shown (fetched from the node)', address: 'the request\'s address', preview: 'the request\'s or the row\'s last words',
                kind: 'ConversationSection: people | agents | … (a section\'s own name)', unread: 'how many are unread', open: 'the section, group or fold is open',
                onToggle: 'opens or closes it', countLabel: 'the group\'s tally in words', unreadLabel: 'the group\'s unread count in words',
                pick: '{ label, onClick }: the group\'s "select all" word while selecting', archive: '{ label, ariaLabel, restore, onClick }: the archive square (restore: the box with the arrow out)',
                title: 'the row\'s name', mark: '{ picture } a person\'s picture | { word } the kind mark inside a group', date: 'when', dateTitle: 'the full date as the tooltip',
                chips: 'the Tags on the name line (via an agent, sent to many)', subject: 'the subject, in coral typewriter', why: 'why it was archived',
                active: 'the open conversation: on the sun', nested: 'inside a person\'s or an agent\'s group', selected: 'picked while selecting',
                onOpen: 'opens the conversation (or picks it)', openLabel: 'the row\'s tooltip', row: 'ConversationFold: the row that stands for the folded threads',
                closed: 'ConversationFold: the disclosure is hidden (while selecting)', children: 'the rows, the requests, the answers of a request',
            },
        },
        useFor: ['Messages\' list of conversations, and an agent\'s Messages tab\'s threads.'],
        variants: [
            { name: 'selecting', class: 'conversation-list--selecting', prop: 'selecting', when: 'many rows are being picked' },
            { name: 'nested', class: 'conversation-row--nested', prop: 'ConversationRow nested', when: 'a row inside a person\'s or an agent\'s group' },
            { name: 'selected', class: 'conversation-row--selected', prop: 'ConversationRow selected', when: 'a row picked while selecting: the coral edge' },
            { name: 'request', class: 'conversation-request', prop: 'ConversationRequest', when: 'a contact request waiting for an answer' },
            { name: 'section', class: 'conversation-section', prop: 'ConversationSection', when: 'a section that closes and still counts its unread' },
            { name: 'fold', class: 'conversation-fold-toggle', prop: 'ConversationFold', when: 'a row that stands for several threads' },
        ],
        example: { rows: [{ title: 'mika', date: '10:42', subject: 'Brand colours', preview: 'The client wants the coral a little warmer.', unread: 1, active: true }] },
        note: 'Built on 2026-09-26 from views/profile/inbox-tab/list-panel.js with its behaviour unchanged. The rows are the chat\'s rows (thread-list.css, .poster-thread, Jouni\'s decision "Conversation list"); the person\'s heading is ThreadList\'s ThreadPerson.',
    },
    {
        id: 'conversation-pane', name: 'ConversationPane', kind: 'component', status: 'active',
        summary: 'The messenger\'s frame: the list of conversations beside the open one, and on a phone one pane at a time with a way back, the open one over the whole screen. The open pane\'s head says who (a picture, the name with its presence word), the subject and "sent by your agent", with its ways on as small action links whose words go when the pane is narrow. Over the composer stand the fields and the "replying to" bar; a read-only conversation says so in the composer\'s place; a strip across the pane holds an agent\'s commands, on the grey ground for a command to fill in.',
        module: '/components/ConversationPane.js', sheet: '/css/components/conversation-pane.css',
        data: {
            shape: 'Panes({ open, backLabel, onBack, side, children }) · Pane({ empty, page, children }) · PaneHead({ picture, name, nameTitle, presence, subject, via, address, before, children }) · '
                + 'PaneDoor({ mark, label, title, pressed, onClick }) · PaneFields({ children }) · ReplyBar({ label, text, onJump, cancelLabel, onCancel }) · PaneNote({ children }) · PaneScroll({ children }) · PaneStrip({ grey, children })',
            fields: {
                open: 'Panes: a conversation is open (on a phone the open pane over the whole screen)', backLabel: 'the phone\'s way back', onBack: 'goes back to the list',
                side: 'Panes: the list of conversations', empty: 'Pane: nothing is open, the words say what to do', page: 'Pane: a page\'s column (its height follows its words, no head)',
                picture: 'PaneHead: a seed for the Avatar', name: 'who', nameTitle: 'the name\'s tooltip (the address)', presence: 'a GHII whose presence word is shown (fetched from the node)',
                subject: 'the conversation\'s subject', via: '"sent by your agent"', address: 'the address, kept for a screen reader', before: 'what stands before the picture',
                mark: 'PaneDoor: the mark that stays when the words go (🔊)', label: 'the words; ReplyBar: "↩ Replying to …"', title: 'the tooltip',
                pressed: 'PaneDoor: it is on (read aloud)', onClick: 'what the door does', text: 'ReplyBar: the quoted words', onJump: 'ReplyBar: jumps to the quoted message',
                cancelLabel: 'ReplyBar: the ✕\'s name', onCancel: 'ReplyBar: drops the quote', grey: 'PaneStrip: on the grey ground (a command to fill in, a schedule)',
                children: 'what each part holds',
            },
        },
        useFor: ['Messages: the list beside the open conversation, the open conversation\'s column and the parts around its composer.'],
        variants: [
            { name: 'open', class: 'conversation-panes--open', prop: 'Panes open', when: 'a conversation is open' },
            { name: 'empty', class: 'conversation-pane--empty', prop: 'Pane empty', when: 'nothing is open yet' },
            { name: 'page', class: 'conversation-pane--page', prop: 'Pane page', when: 'the broadcast form, tracked responses, results: a page\'s column' },
            { name: 'grey strip', class: 'conversation-strip--grey', prop: 'PaneStrip grey', when: 'a command to fill in, an agent\'s schedule' },
        ],
        example: { open: true, head: { name: 'mika', subject: 'Brand colours' } },
        note: 'Built on 2026-09-26 with the values of css/views/inbox.css and inbox-poster.css (.inbox-body, -back, -side, -panel, -thread-head, -replybar*, -announce-note, -compose-fields, -tracked-list, -results, -cmdbar, -cmdfill, -sched). The heights are measured by the page (--conversation-desk-avail, --conversation-avail).',
    },
];
