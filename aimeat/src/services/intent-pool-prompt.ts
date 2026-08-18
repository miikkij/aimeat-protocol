/**
 * @file src/services/intent-pool-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a connected agent needs to know about its owner's intent pool, served by the
 *   node so a correction reaches every agent rather than the copies people pasted last month.
 *
 *   The pool is NOT a copy-prompt tool. For a connected agent it is a work queue it reads itself:
 *   a promoted intent arrives as an ordinary task, and the pool records are readable over the
 *   memory route. No new MCP tool exists for it and none is needed — that was checked before this
 *   text was written, not asserted in it.
 *
 *   The most important half of this prompt is what NOT to touch. An unpromoted intent is a person's
 *   own list, and an agent that starts "helpfully" working through it has taken something that was
 *   never handed over.
 * @structure buildIntentPoolPrompt(config)
 * @usage GET /v1/prompts/intent-pool
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (intent pool, phase 4).
 */
import type { AimeatConfig } from '../config.js';

export function buildIntentPoolPrompt(config: AimeatConfig): { full: string; body: string } {
    const url = config.baseUrl;
    const body = `# Your owner's intent pool

Your owner keeps a list of what they mean to do here. Each item is one memory record in THEIR
namespace, keyed \`intent.<id>\`. This explains the two ways you meet that list, and the one way you
must not.

## 1. Work that was handed to you arrives as a TASK

When your owner gives you an item, the node creates an ordinary task. You need no new tool:

- \`aimeat_task_list\` — your queue, as always.
- A task from the pool carries \`resources.memoryKeys\` containing \`intent.<id>\`, and its scope
  carries \`kind=intent\` plus \`intent_id\`. That is how you know where it came from.
- \`aimeat_task_complete\` when it is done.

**Completing the task closes the intent.** The node does that, not you. Do not try to write the
record yourself — you do not have permission to, and the refusal you would get is correct.

## 2. If the task names a prompt, fetch it — do not invent one

A pooled item often names a node-served prompt rather than carrying its text:

    prompt_ref: "build-app"   →   GET ${url}/v1/prompts/build-app

Fetch it at the moment you do the work. The text is deliberately not stored in the record, so the
version you get is the current one. If \`prompt_args\` is present, it holds the parameters for that
prompt.

## 3. You may READ the pool. You may not act on it uninvited

    aimeat_memory_list { prefix: "intent.", owner_scope: true }
    aimeat_memory_read { key: "intent.<id>", owner_scope: true }

\`owner_scope\` is what reaches your owner's namespace instead of your own; without it you are
looking at your own records and will find nothing.

Use this to ANSWER: "what is on my list?", "what did I say I wanted to do about X?". That is a
genuinely useful thing to be able to say.

**Do not start work you find there.** An item that was not promoted to a task was not given to you.
It is a person's own list, and working through it uninvited is taking something that was not handed
over — even when you could do it well. If something on the list looks worth doing, say so and let
them decide.

## 4. Items that close themselves

Some entries carry \`closes_when\`, e.g. \`{ "check": "first_agent" }\`. Those are the node's own
suggestions and they stop being offered the moment the condition is true. Never mark one done and
never act on one: it is not a task, and if the situation unwinds it is supposed to come back.

## In one line

Do what you were given, read the rest only to answer questions about it, and let the node close
what it opened.`;

    const full = `You are connected to an AIMEAT node at ${url} through MCP.

${body}`;
    return { full, body };
}
