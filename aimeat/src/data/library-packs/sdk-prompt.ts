/**
 * @file sdk-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-prompt.js, the prompt-driven workflow as a component.
 *   Its own file because library-packs/sdk.ts is at 775 of 800 lines.
 * @structure PROMPT_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { LibraryPack } from './types.js';

export const PROMPT_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-prompt',
    kind: 'sdk',
    category: 'ui',
    title: 'Prompt card (the prompt-driven workflow)',
    description: 'Show a prompt the app composed, copy it in one click, and take the answer back from the person\'s own AI chat, as text or as parsed JSON. No model key, no cost to the app, works with any AI.',
    url: '/v1/libs/aimeat-prompt.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-prompt.js"></script>'],
    requires: [],
    license: 'MIT',
    apiSurface: 'AIMEAT.prompt',
    aiDoc: [
      'The prompt-driven workflow: the app composes a prompt, the person copies it into THEIR OWN AI chat (Claude, ChatGPT, Gemini, Copilot, anything), and pastes the answer back; the app reads it and carries on. Use it when the AI work should cost the app nothing, when the person has no OpenRouter key for AIMEAT.ai, or when their AI cannot connect to this node over MCP. The person sees everything that leaves and everything that comes back. It is NOT AIMEAT.ai, which calls a model from inside the app on the person\'s own key.',
      'const card = AIMEAT.prompt.card(target, { prompt, label?, hint?, expect?, onResult?, onCopied?, validate?, showPrompt?, lang? }). target is a selector or an element; its content is replaced. It returns { setPrompt(next), getPrompt() -> Promise<string>, reset(), destroy() }.',
      'prompt is a string OR a function returning a string (or a Promise of one). Pass a function when the prompt carries data that changes: it is called again every time the person copies, so an earlier answer or a fresh list is in it. This is how a chain works: step 1 onResult saves the answer, step 2 prompt() reads it.',
      'expect: "text" (default) hands onResult the pasted answer as it is. expect: "json" hands it the PARSED value and refuses an answer with no JSON in it, with a sentence telling the person to ask their AI for JSON only. The parser takes the whole answer, then each fenced code block, then the first balanced {...} or [...] that parses, so an answer with a sentence before and after the JSON works. AIMEAT.prompt.extractJson(text) is the same parser on its own; it returns undefined when nothing parses.',
      'validate(value) returns a sentence to refuse the answer with (shown under the box), or nothing to accept it. Check the shape you asked for there: the answer comes from a chat the app cannot see. onResult(value, raw) may be async; the button is disabled while it runs and a thrown error is shown under the box. Leave onResult out and the card is copy-only, with no paste box.',
      'WRITE THE PROMPT SO THE ANSWER COMES BACK USABLE: say what the person wants in their words, include the data the AI needs as JSON, and end with the exact shape to answer in ("Answer with JSON only: {\\"days\\": [{\\"date\\": \\"YYYY-MM-DD\\", \\"tasks\\": [string]}]}"). Keep it under a few thousand characters; a chat input has a limit too.',
      'THE ANSWER IS UNTRUSTED TEXT. Render it with textContent, never innerHTML, and never eval it. Save it like any other record (AIMEAT.data.set) if the person should find it again.',
      'It draws with the page\'s own theme variables (--color-primary, --color-base-100/200/300, --color-base-content, --radius-box) and falls back to plain colours without them. Its labels follow the page language (en, fi, es) through AIMEAT.auth.getLang() or <html lang>; pass lang to force one. The labels are read when the card is mounted, so on the aimeat-lang-change event mount the card again. Buttons are 44 px tall and the card never grows wider than its container.',
      'Example: AIMEAT.prompt.card("#plan", { label: "Plan my week", prompt: () => "Here are my tasks: " + JSON.stringify(tasks) + ". Spread them over next week. Answer with JSON only: {\\"days\\": [{\\"date\\": \\"YYYY-MM-DD\\", \\"tasks\\": [string]}]}", expect: "json", validate: (v) => Array.isArray(v && v.days) ? null : "The answer has no days list. Paste the whole answer.", onResult: async (plan) => { await AIMEAT.data.set("myapp.plan", plan, { visibility: "private" }); showPlan(plan); } });',
    ].join('\n'),
    changelog: [{ version: '1.0.0', date: '2026-09-18', summary: 'card() with copy, paste-back, text or JSON answers and validation; extractJson().' }],
    tierHint: 'T1',
    interviewTriggers: ['prompt', 'copy prompt', 'paste the answer', 'without an api key', 'own ai', 'chatgpt', 'gemini', 'copilot', 'free ai'],
    sizeEstimate: '~8KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'ai',
    promptLine: '- aimeat-prompt.js — the prompt-driven workflow as one component: show a prompt, copy it, take the answer back from the person\'s own AI chat as text or parsed JSON (`AIMEAT.prompt.card`). No model key and no cost to the app.',
  },
];
