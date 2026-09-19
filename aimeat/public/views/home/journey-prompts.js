/**
 * @file public/views/home/journey-prompts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Portable task prompts for the owner's connected AI. No credentials or vendor assumptions.
 * @version-history
 *   v1.0.0 — 2026-09-09 — Approved home journey: useful work through the owner's AI.
 *   v1.1.0 — 2026-09-19 — The tools paragraph tells the AI to find and load the tools and to report
 *     a failed call verbatim; it had told the AI to stop when its tool list looked empty.
 */
export const FIRST_NOTE_KEY = 'home.first-note';

const TASKS = {
  note: `Ask me for one useful fact, preference or project note I want my AIs to remember. Show me the proposed note. Once I approve it, use aimeat_memory_write to save one private record at key "${FIRST_NOTE_KEY}" with value {"title":"a short title","text":"the approved note"}. Read the record back and show what was actually saved. Reuse this key when revising the note; ask before replacing existing content. Explain that I can edit or delete it from Memory.`,
  agent: 'Help me create a new working agent. Ask what it should do and where it should run. Discover the available agent creation and runtime capabilities on this AIMEAT and reuse a suitable installed runtime or agent template. Explain the difference between connecting an AI I already use and starting an independently running worker. Let me approve its permissions and any cost before enabling it. Verify that the agent can receive work, and show its name, actual status and where I can manage or revoke it. If a runtime is missing, explain the exact missing prerequisite and the next action.',
  schedule: 'Help me create a scheduled task. Ask what should happen, its timing and timezone, which available agent should perform it, and where I want the result. Discover the current scheduling tools and check that the chosen agent can execute the task. Show me the schedule and any cost for approval, then create it through those tools. Read it back and report its next run with timezone, enabled state, result destination, and how I can pause or remove it.',
  app: 'Help me build an application for a need I describe. Ask what I want to accomplish and who will use it. Read this AIMEAT\'s current /v1/prompts/build-app instructions and discover existing apps, libraries and app-building skills before building. Follow the canonical build specification, verify the actual behavior and obtain my approval for publishing, sharing and any costs. Return the actual preview or published URL and explain who can access it.',
};

/** The task remains useful in Claude, ChatGPT, Grokbot or any AI with the required tools. */
export function buildJourneyPrompt(action, origin, owner) {
  const task = TASKS[action] || TASKS.note;
  return [
    'Talk to me in the language I use with you.',
    `Use my connected AIMEAT at ${origin}. My account is ${owner}. Verify the authenticated identity and use only the permissions I granted.`,
    // This paragraph used to open with "First check that AIMEAT tools are available... If they are
    // missing, say so". A client that loads connected tools on demand (Codex, 2026-09-19) shows an
    // empty list until the model looks, so the model read the list, found nothing and took the exit
    // the prompt offered, while the same task with no prompt at all went straight to work. The
    // evidence that a connection is broken is a failed call, so that is what the prompt asks for.
    'My AIMEAT tools are connected to this conversation. Some AI clients load connected tools on demand, so when they are outside your visible tool list, search your tools and connectors for "aimeat" and load them. Begin with aimeat_handbook_get, which is this AIMEAT\'s operating guide and names the tools for this task. When a real AIMEAT tool call fails, show me the exact error text and the one step that fixes it; the connection instructions are on my AIMEAT home. Report completion after a successful tool call and read-back.',
    task,
    `My home is ${origin}/v1/home. Show the real result and the next step when finished.`,
  ].join('\n\n');
}
