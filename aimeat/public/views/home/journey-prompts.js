/**
 * @file public/views/home/journey-prompts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Portable task prompts for the owner's connected AI. No credentials or vendor assumptions.
 * @version-history
 *   v1.4.0 — 2026-10-03 — The first task is the profile interview (TASKS.profile): the AI asks about
 *     the person's work, needs, challenges, repeated work and what is unclear, saves the answers in
 *     `journey.state`, and publishes a business card as their welcome page (Jouni, 2026-10-03). It is
 *     the default for an unknown action. The road for an AI that cannot connect is the served
 *     /v1/prompts/welcome-mat prompt, pasted back to POST /v1/home/welcome-mat.
 *   v1.0.0 — 2026-09-09 — Approved home journey: useful work through the owner's AI.
 *   v1.3.0 — 2026-10-01 — The first task is a shared place (an organism with one workspace) instead
 *     of a note: a chat app already remembers things on its own (Jouni). The note stays only on the
 *     road for an AI that cannot connect, through buildPastePrompt.
 *   v1.2.0 — 2026-10-01 — buildPastePrompt and parsePastedNote: the note task for an AI that cannot
 *     connect, its answer pasted back on the home page (guided journey P2).
 *   v1.1.0 — 2026-09-19 — The tools paragraph tells the AI to find and load the tools and to report
 *     a failed call verbatim; it had told the AI to stop when its tool list looked empty.
 */
export const FIRST_NOTE_KEY = 'home.first-note';

const TASKS = {
  // The same seven questions as the served welcome-mat prompt (src/services/welcome-mat-prompt.ts)
  // and the skill aimeat-guided-journey; the three must ask the same things.
  profile: 'Make my profile on AIMEAT: interview me, then make my business card. Load the skill aimeat-guided-journey first; its stage 1 is this interview. Ask me these one at a time, in your own words, and say back in one sentence what you heard before the next one: what should you call me and what do I do; what does a normal week look like; what am I trying to get done right now; what gets in the way or keeps slipping; what do I do again and again that I would gladly hand to someone else; what feels unclear or complicated at the moment; what should other people and their AIs know about me (what I offer, what I look for, how to reach me). Show me a short summary and let me correct it. Then save my answers with aimeat_memory_write { key: "journey.state", owner_scope: true, visibility: "owner" }: read the record first and keep its other fields, and put my words in "work", "needs", "challenges", "repetitive" and "unclear". Then write my business card as one HTML page: my name, one line on what I do, a few short sections in my words and how to reach me; in the head a <script type="application/ld+json"> block with a schema.org Person (name, jobTitle, description, knowsAbout, skills, and makesOffer or seeks where they fit); and a short section headed "For AIs" in my language that says who I am, what I offer, what I look for and how an AI acting for someone else should contact me. Put only what I said and approved on it; my challenges, repeated work and unclear things stay off the page unless I ask. All styles in one <style> block, no images or outside files, readable on a phone in light and dark mode. Show it to me, and when I approve it, publish it with aimeat_portfolio_publish { html, enable: true }, which makes it public. Give me the address it returns and ask me to open it. Then offer one next step chosen from my answers: a shared place for work I share with others, an app for a need, an agent for the work I repeat, or a clear write-up of what is unclear.',
  place: 'Help me set up one shared place for my work on AIMEAT: an organism with its workspaces, which every AI I connect, whichever company makes it, and every person I invite can read and write. Load the skill aimeat-organisms first. Ask what the place is for and who else will use it. Propose a name and a starting shape (my own work, team, company, family, club or project) and say in one line what it makes, in my words, and wait for my approval. Then create it with aimeat_organism_create, giving the shape and my language, and fill the readme\'s "what is current" part with what I told you. Do not invent content on my behalf. Show me the address where I can open it, and tell me in one sentence how another AI of mine reads the same place.',
  agent: 'Help me create a new working agent. Ask what it should do and where it should run. Discover the available agent creation and runtime capabilities on this AIMEAT and reuse a suitable installed runtime or agent template. Explain the difference between connecting an AI I already use and starting an independently running worker. Let me approve its permissions and any cost before enabling it. Verify that the agent can receive work, and show its name, actual status and where I can manage or revoke it. If a runtime is missing, explain the exact missing prerequisite and the next action.',
  schedule: 'Help me create a scheduled task. Ask what should happen, its timing and timezone, which available agent should perform it, and where I want the result. Discover the current scheduling tools and check that the chosen agent can execute the task. Show me the schedule and any cost for approval, then create it through those tools. Read it back and report its next run with timezone, enabled state, result destination, and how I can pause or remove it.',
  app: 'Help me build an application for a need I describe. Ask what I want to accomplish and who will use it. Read this AIMEAT\'s current /v1/prompts/build-app instructions and discover existing apps, libraries and app-building skills before building. Follow the canonical build specification, verify the actual behavior and obtain my approval for publishing, sharing and any costs. Return the actual preview or published URL and explain who can access it.',
};

/**
 * For an AI that cannot connect: it uses no tool, and its answer comes back through the paste box,
 * which reads the first line as the title and the rest as the note (parsePastedNote).
 */
export function buildPastePrompt() {
  return [
    'Talk to me in the language I use with you.',
    'Ask me for one useful fact, preference or project note I want my AIs to remember. Show me the note and let me correct it.',
    'When I approve it, answer with exactly two lines and nothing else: a short title on the first line, and the note on the second line. I will paste your answer into my AIMEAT, where every AI I connect later reads the same note.',
  ].join('\n\n');
}

/** The pasted answer as { title, text }, or null when there is no note in it. */
export function parsePastedNote(raw) {
  const lines = String(raw || '').replace(/```[a-z]*\n?/gi, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  if (lines.length === 1) return { title: lines[0].slice(0, 120), text: lines[0] };
  return { title: lines[0].replace(/^#+\s*/, '').slice(0, 120), text: lines.slice(1).join('\n') };
}

/** The task remains useful in Claude, ChatGPT, Grok or any AI with the required tools. */
export function buildJourneyPrompt(action, origin, owner) {
  const task = TASKS[action] || TASKS.profile;
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
