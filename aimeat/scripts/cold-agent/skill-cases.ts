/**
 * @file scripts/cold-agent/skill-cases.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Does a skill on the node get loaded when a person's sentence calls for it, and stay
 *   unloaded when it does not?
 *
 *   WHY. A skill nobody loads helps nobody, and the only thing an agent sees before deciding is
 *   the description line. A 2026 study found skills left unused in 56 % of the cases where one was
 *   available (arXiv 2606.11435). This project measured one skill's effect (`pnpm eval:skill`, for
 *   aimeat-writing) and none of the node's built-in skills' TRIGGERING, which is the step before
 *   effect: the instruction review of 2026-09-18 could only say the descriptions read well.
 *
 *   A CASE is a sentence a person would say, with no skill name in it, and the skill a
 *   well-guided agent loads for it. `expect: null` is a sentence that needs no skill: a description
 *   written to be "pushy" enough to trigger must not start triggering on everything.
 *
 *   JUDGING reads the transcript: the expected skill counts as loaded when `aimeat_skill_get` was
 *   called naming it, by `name` or by `ref`. The task is never finished on purpose (the turn limit
 *   is low), because what is measured is the decision to load, not the work after it.
 *
 *   ONLY SKILLS A FRESH NODE SHIPS. The sandbox is a fresh node, so every skill named here comes
 *   from src/data/builtin-skills*.ts. A skill published by hand on aimeat.io alone does not exist
 *   on it, and a case naming one can only fail. (The six conversation skills were such skills until
 *   they moved into the repository on 2026-09-18; they have cases now.)
 *
 *   GROWING IT. Ten to twenty sentences per skill is what the testing guides recommend. This
 *   starts smaller, with the skills a new person's first week reaches for, and a sentence joins
 *   the list the day a real conversation shows a skill that should have loaded and did not.
 * @structure SkillCase · SKILL_CASES · skillTasks()
 * @usage
 *   cd aimeat && pnpm cold-agent --suite skills --model sonnet --runs 3
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial: 7 skills, 30 sentences, 6 of them needing no skill.
 *   v1.1.0 — 2026-09-19 — Every entry-point skill has sentences now: 21 skills, 71 sentences. A case
 *     may accept more than one skill, and a name is matched as a whole word. Sub-skills reached only
 *     through a parent get no sentence of their own. Not yet run: about 0.5 USD a sentence per run.
 */
import type { Task } from './tasks.js';

/** `expect` may name several skills when more than one is a right answer (a generic game skill and the engine-specific one). */
export interface SkillCase { expect: string | string[] | null; say: string }

export const SKILL_CASES: SkillCase[] = [
    // Building an app
    { expect: 'aimeat-app-builder', say: 'Can you make me a little app for tracking which plants I have watered?' },
    { expect: 'aimeat-app-builder', say: 'I need a page where my football team can see who is bringing the snacks each week.' },
    { expect: 'aimeat-app-builder', say: 'Build a simple expense splitter I can open on my phone.' },
    { expect: 'aimeat-app-builder', say: 'My app looks broken on mobile. Can you fix it and publish it again?' },
    // Games
    { expect: 'aimeat-phaser', say: 'I want to make a little platform game for my kid.' },
    { expect: 'aimeat-phaser', say: 'Could you build a space shooter where the ship follows my finger?' },
    { expect: 'aimeat-phaser', say: 'Make a memory card game with sounds and a high score list.' },
    { expect: 'aimeat-phaser', say: 'The jump in my game feels floaty. Can you make it tighter?' },
    // What is open and waiting for the person
    { expect: 'aimeat-open-items', say: 'What is waiting for me? I have been away for a week.' },
    { expect: 'aimeat-open-items', say: 'Is there anything here I need to approve or answer?' },
    { expect: 'aimeat-open-items', say: 'Give me a quick list of what is still open.' },
    // A workflow that stopped producing
    { expect: 'diagnose-a-workflow', say: 'My weekly report did not arrive this Monday. Can you find out why?' },
    { expect: 'diagnose-a-workflow', say: 'The pipeline that collects the news ran, but the summary is empty.' },
    { expect: 'diagnose-a-workflow', say: 'One of the steps in my workflow is red. What broke?' },
    // The person's own data
    { expect: 'manage-my-profile-data', say: 'What do you people actually store about me?' },
    { expect: 'manage-my-profile-data', say: 'I want a copy of everything I have saved here.' },
    { expect: 'manage-my-profile-data', say: 'Make the note about my address private again.' },
    // Managing agents
    { expect: 'manage-my-agents', say: 'Which AIs have access to my account, and what can each of them do?' },
    { expect: 'manage-my-agents', say: 'I want to take away one agent\'s right to write to my memory.' },
    { expect: 'manage-my-agents', say: 'Remove the agent I connected last week, I do not use it any more.' },
    // AI transparency
    { expect: 'ai-transparency', say: 'How can somebody tell that a text here was written by an AI?' },
    { expect: 'ai-transparency', say: 'Someone sent me a picture from this site. Can I check whether it is AI-generated?' },
    { expect: 'ai-transparency', say: 'Do I have to label what you write for me before I publish it?' },
    { expect: 'ai-transparency', say: 'What does this place do about the EU rules on marking AI content?' },
    // ── Added 2026-09-19: the entry-point skills that had no sentence at all. A sub-skill that is
    // only ever reached through its parent (the eight aimeat-phaser-* area skills) gets none of its
    // own: the handbook lists entry points, and the parent routes to them.
    // Something that should happen regularly
    { expect: 'aimeat-recurring-work', say: 'Every Monday morning I want a summary of what my agents did last week.' },
    { expect: 'aimeat-recurring-work', say: 'Can something check the price of my flight once a day and tell me when it drops?' },
    { expect: 'aimeat-recurring-work', say: 'Keep track of new job ads for nurses in Tampere for me.' },
    // A recurring content pipeline
    { expect: 'set-up-content-pipeline', say: 'I want a weekly newsletter draft written from my notes, ready for me to check on Fridays.' },
    { expect: 'set-up-content-pipeline', say: 'Set it up so my agents produce a market report every month.' },
    { expect: 'set-up-content-pipeline', say: 'Two of my agents should research and then write an article each week. How do we wire that?' },
    // Connecting a new automation agent
    { expect: 'add-a-crew-agent', say: 'I have a CrewAI agent running on my server. How do I connect it here?' },
    { expect: 'add-a-crew-agent', say: 'I want to add another AI that only picks up tasks and does them.' },
    { expect: 'add-a-crew-agent', say: 'Hook my Python bot up to this so it can take work from my other agents.' },
    // Models, routing and spend
    { expect: 'configure-routing', say: 'Which model do my agents use, and can I make the cheap one the default?' },
    { expect: 'configure-routing', say: 'How much have the AI calls cost me this month?' },
    { expect: 'configure-routing', say: 'Put a daily limit on what the AI is allowed to spend.' },
    // Running the node
    { expect: 'aimeat-node-operations', say: 'How many people and agents are on this node right now?' },
    { expect: 'aimeat-node-operations', say: 'I run this server. Give me a health check of the whole thing.' },
    { expect: 'aimeat-node-operations', say: 'Show me which agents are registered here and when each was last seen.' },
    // Operating an app somebody else built
    { expect: 'use-app-bound-skills', say: 'Add the three new customers to my CRM app.' },
    { expect: 'use-app-bound-skills', say: 'There is a booking app on my account. Can you use it to reserve Thursday at two?' },
    { expect: 'use-app-bound-skills', say: 'Go through my recipe app and mark the ones I cooked this week.' },
    // Taking a skill with you
    { expect: 'install-skills-locally', say: 'Can I have that writing guide on my own computer, for Claude Code?' },
    { expect: 'install-skills-locally', say: 'I want to use one of these skills in claude.ai without connecting anything. How?' },
    { expect: 'install-skills-locally', say: 'Download the skill for my project folder.' },
    // An app that outgrew one file
    { expect: 'aimeat-app-workstation', say: 'My app is getting huge and every change takes forever. Is there a better way to work on it?' },
    { expect: 'aimeat-app-workstation', say: 'The publish said my app is too big. What now?' },
    { expect: 'aimeat-app-workstation', say: 'I want to split my app into files on my machine and still publish it as one.' },
    // Games that are not platformers, and creative canvas work
    { expect: ['aimeat-game-apps', 'aimeat-phaser'], say: 'Make me a generative art piece that draws slowly changing flowers.' },
    { expect: ['aimeat-game-apps', 'aimeat-phaser'], say: 'I want a fast particle toy with thousands of dots that follow the mouse.' },
    { expect: ['aimeat-game-apps', 'aimeat-phaser'], say: 'Which game engine should we use here for a card battler?' },
    // The designed track
    { expect: ['aimeat-app-builder-atelier', 'aimeat-app-builder'], say: 'Build me a good-looking dashboard for my sales numbers, with a proper design, not a default look.' },
    { expect: ['aimeat-app-builder-atelier', 'aimeat-app-builder'], say: 'I want an app that looks like a magazine, for my travel notes.' },
    // The first minutes with a new person, and the conversation skills
    { expect: 'aimeat-first-conversation', say: 'Hi. I just connected this. What is it and what should I do first?' },
    { expect: 'aimeat-first-conversation', say: 'My friend told me to try this. I have no idea where to start.' },
    { expect: 'aimeat-welcome-pages', say: 'Can I have a page about me that I can send to people?' },
    { expect: 'aimeat-welcome-pages', say: 'Make me a simple portfolio page with my projects.' },
    { expect: 'aimeat-paying-for-the-ai', say: 'Does this cost me anything? Who pays for the AI?' },
    { expect: 'aimeat-paying-for-the-ai', say: 'It says I have run out of free AI use. What do I do?' },
    { expect: 'aimeat-mail-to-data', say: 'Go through my email and make a table of all the invoices from this year.' },
    { expect: 'aimeat-mail-to-data', say: 'Find the order confirmations in my Gmail and list what I bought.' },
    // The node itself
    { expect: 'aimeat-node-guide', say: 'What is this AIMEAT thing, technically? How does an AI connect to it?' },
    { expect: 'aimeat-node-guide', say: 'I am a developer. Where is the API and how do I get a token?' },
    // Sentences that need no skill
    { expect: null, say: 'Remember that the plumber is coming on Thursday at nine.' },
    { expect: null, say: 'What did I ask you to remember about the plumber?' },
    { expect: null, say: 'Thanks, that is all for today.' },
    { expect: null, say: 'What is seventeen percent of 240?' },
    { expect: null, say: 'Which apps do I have here?' },
    { expect: null, say: 'Send a message to the people who run this: the help page has a typo.' },
];

const loaded = (input: unknown): string => {
    const i = (input ?? {}) as { name?: unknown; ref?: unknown };
    return `${typeof i.name === 'string' ? i.name : ''} ${typeof i.ref === 'string' ? i.ref : ''}`.toLowerCase();
};

/**
 * Whether what an agent asked `aimeat_skill_get` for names one of the wanted skills. A whole
 * name: `node:aimeat-app-builder` and `aimeat-app-builder@1.2.0` count, and a load of
 * `aimeat-app-builder-atelier` does not count as `aimeat-app-builder`.
 */
export function namesSkill(asked: string, wanted: string[]): boolean {
    return wanted.some(w => new RegExp(`(^|[\\s:/])${w}(\\s|@|$)`).test(asked));
}

export function skillTasks(): Task[] {
    const seen = new Map<string, number>();
    return SKILL_CASES.map((c) => {
        const wanted = c.expect === null ? [] : Array.isArray(c.expect) ? c.expect : [c.expect];
        const group = wanted[0] ?? 'none';
        const n = (seen.get(group) ?? 0) + 1;
        seen.set(group, n);
        return {
            id: `skill:${group}:${n}`,
            door: 'mcp' as const,
            prompt: c.say,
            goodTools: ['aimeat_skill_list', 'aimeat_skill_get', 'aimeat_handbook_get'],
            verify: async (ctx) => {
                // A load that came back as an error loaded nothing: a skill named here that a fresh
                // node does not ship fails the case, which is the truth about that node.
                const gets = ctx.metrics.toolCalls.filter(t => t.name === 'aimeat_skill_get' && !t.isError).map(t => loaded(t.input));
                if (c.expect === null) return { ok: gets.length === 0, detail: gets.length ? `loaded a skill it did not need:${gets.join(',')}` : 'loaded no skill' };
                // A whole word, so that aimeat-app-builder does not count a load of aimeat-app-builder-atelier.
                const hit = gets.some(g => namesSkill(g, wanted));
                return { ok: hit, detail: hit ? 'loaded the skill' : gets.length ? `loaded something else:${gets.join(',')}` : 'loaded no skill' };
            },
        };
    });
}
