/**
 * @file src/services/ui-library/entries-steps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the parts of a setup path: the numbered steps on the home, the
 *   prompt a person copies into their own AI and the box they paste its answer into, and the front
 *   page's way in. The purpose half only; facts.generated.ts carries what the files say.
 * @structure STEP_ENTRIES
 * @usage import { STEP_ENTRIES } from './entries-steps.js';
 * @version-history
 *   v1.1.0 — 2026-09-23 — AgentCard, LinkRow, AppList, TeachNote and the step card's done and limit
 *     looks deleted with their code (Jouni's decision).
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntrySource } from './types.js';

export const STEP_ENTRIES: UiEntrySource[] = [
    {
        id: 'step-card', name: 'StepCard', kind: 'component', status: 'active',
        summary: 'One step of a numbered setup path: its number, title and lead, in an ink frame with the sun shadow.',
        module: '/components/StepCard.js', sheet: '/css/components/step-card.css',
        data: {
            shape: 'StepCard({ num, title, children }) · StepLede({ children })',
            fields: { num: 'the step number as text', title: 'the step headline', children: 'the step body: a StepLede, then its controls' },
        },
        use: ['A step a person does once, in order, on the way to something working.'],
        variants: [
            { name: 'open', class: 'poster-step--open', when: 'the step in progress; the others stay closed' },
        ],
        example: { num: '1', title: 'Your welcome mat', children: 'Copy the prompt below into your AI chat.' },
        note: 'The done and limit looks were deleted on 2026-09-23 (Jouni\'s decision): only StepMatDone and StepBranchB drew them, and neither had been drawn since 07f7040c5 (2026-09-09).',
    },
    {
        id: 'prompt-card', name: 'PromptCard', kind: 'component', status: 'active',
        summary: 'A prompt a person copies into their own AI: a coral label, the copy action, an optional corner menu, and the prompt text in a scroll box.',
        module: '/components/PromptCard.js', sheet: '/css/components/prompt-card.css',
        data: {
            shape: 'PromptCard({ label, prompt, className, copyLabel, copiedLabel, onCopied, saveIntent, agents, onGiveToAgent, showPrompt })',
            fields: {
                label: 'what the prompt is', prompt: 'the text to copy', className: 'the copy button class (btn-primary while it is the next move)',
                copyLabel: 'the copy button words', copiedLabel: 'the words after copying', saveIntent: 'offers "save as an open item" in the corner menu',
                agents: 'connected agents it can be handed to', showPrompt: 'false folds the text away',
            },
        },
        use: ['The prompt-driven road: a person runs the prompt in their own chat and brings the result back.'],
        variants: [],
        example: { label: 'The prompt', prompt: 'Write me a one-page HTML welcome mat…', className: 'btn-primary', copyLabel: 'Copy the prompt', copiedLabel: 'Copied' },
    },
    {
        id: 'paste-box', name: 'PasteBox', kind: 'component', status: 'active',
        summary: 'The box a person pastes their AI\'s answer into, with its label.',
        module: '/components/PasteBox.js', sheet: '/css/components/paste-box.css',
        data: {
            shape: 'PasteBox({ id, label, boxRef, rows, placeholder, value, onInput }) · PasteLabel({ htmlFor, children })',
            fields: { id: 'the textarea id', label: 'what to paste', boxRef: 'a ref, to focus the box after a failed send', rows: 'visible rows', value: 'the text', onInput: 'change handler' },
        },
        use: ['The return half of a prompt-driven step. A failed send keeps the text in the box.'],
        variants: [],
        example: { id: 'koti-paste', label: 'Paste what your AI gave you here', placeholder: 'Everything it wrote is fine.', value: '' },
    },
    {
        id: 'text-input', name: 'TextInput', kind: 'component', status: 'active',
        summary: 'A one-line text field in an ink frame, sun outline on focus.',
        module: '/components/TextInput.js', sheet: '/css/components/text-input.css',
        data: {
            shape: 'TextInput({ id, maxLength, placeholder, value, onInput })',
            fields: { id: 'the input id', maxLength: 'the longest value', placeholder: 'the empty hint', value: 'the text', onInput: 'change handler' },
        },
        use: ['A short name or value a person types in a step.'],
        variants: [],
        example: { id: 'koti-agent-name', maxLength: '40', placeholder: 'My assistant', value: '' },
    },
    {
        id: 'named-value', name: 'NamedValue', kind: 'component', status: 'active',
        summary: 'A named value on one line: what it is called, the value, and a way to rename it.',
        module: '/components/NamedValue.js', sheet: '/css/components/named-value.css',
        data: {
            shape: 'NamedValue({ label, value, renameLabel, onRename })',
            fields: { label: 'what the value is', value: 'the value', renameLabel: 'the rename action words', onRename: 'opens the rename' },
        },
        use: ['A value a person chose earlier and may change.'],
        variants: [],
        example: { label: 'Your agent is called', value: 'Helper', renameLabel: 'Rename' },
    },
    {
        id: 'mode-tabs', name: 'ModeTabs', kind: 'component', status: 'active',
        summary: 'Two or three ways of doing one thing, as a tab list of buttons; the chosen one in an outline with coral words.',
        module: '/components/ModeTabs.js', sheet: '/css/components/mode-tabs.css',
        data: {
            shape: 'ModeTabs({ children }) · ModeTab({ on, onClick, children })',
            fields: { on: 'the chosen way', onClick: 'choose it', children: 'the way\'s name' },
        },
        use: ['A step that can be done in more than one way, where the person picks the way first.'],
        variants: [{ name: 'chosen', prop: 'on', when: 'the selected way, the chosen tab (poster.css .poster-tab.is-on)' }],
        example: { tabs: [{ on: true, children: 'Connect over MCP' }, { on: false, children: 'Paste a prompt' }] },
    },
    {
        id: 'step-list', name: 'StepList', kind: 'component', status: 'active',
        summary: 'Numbered instructions a person follows by hand, one per line.',
        module: '/components/StepList.js', sheet: '/css/components/step-list.css',
        data: { shape: 'StepList({ steps })', fields: { steps: 'the instructions, in order' } },
        use: ['Something the person does outside this page, where the order matters.'],
        variants: [],
        example: { steps: ['Open Claude settings', 'Add a connector', 'Paste the address'] },
    },
    {
        id: 'waiting-note', name: 'WaitingNote', kind: 'component', status: 'active',
        summary: 'A dashed note that says the next move is in another window: a pulsing coral dot, a bold line, and what happens next.',
        module: '/components/WaitingNote.js', sheet: '/css/components/waiting-note.css',
        data: { shape: 'WaitingNote({ title, children })', fields: { title: 'what the page waits for', children: 'what happens when it arrives' } },
        use: ['The page waits for something the person does elsewhere, and updates on its own.'],
        variants: [],
        example: { title: 'Waiting for your agent', children: 'This page moves on by itself when it connects.' },
    },
    {
        id: 'front-door', name: 'FrontDoor', kind: 'component', status: 'active',
        summary: 'The front page\'s way in: a headline, the let-your-AI-do-it box, and the register and sign-in doors.',
        module: '/components/FrontDoor.js', sheet: '/css/components/front-door.css',
        data: { shape: 'FrontDoor({ onNavigate })', fields: { onNavigate: 'the router\'s navigate, for the sign-in and register doors' } },
        use: ['The front page (portal.welcome-door block). It reads its own prompt from the node.'],
        variants: [],
        example: {},
    },
];
