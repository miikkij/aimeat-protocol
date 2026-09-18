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
 *   from src/data/builtin-skills*.ts. Skills published by hand on aimeat.io alone
 *   (aimeat-first-conversation, aimeat-paying-for-the-ai, aimeat-mail-to-data were the first three
 *   tried) do not exist on it, and a case naming one can only fail.
 *
 *   GROWING IT. Ten to twenty sentences per skill is what the testing guides recommend. This
 *   starts smaller, with the skills a new person's first week reaches for, and a sentence joins
 *   the list the day a real conversation shows a skill that should have loaded and did not.
 * @structure SkillCase · SKILL_CASES · skillTasks()
 * @usage
 *   cd aimeat && pnpm cold-agent --suite skills --model sonnet --runs 3
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial: 7 skills, 30 sentences, 6 of them needing no skill.
 */
import type { Task } from './tasks.js';

export interface SkillCase { expect: string | null; say: string }

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

export function skillTasks(): Task[] {
    const seen = new Map<string, number>();
    return SKILL_CASES.map((c) => {
        const group = c.expect ?? 'none';
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
                const hit = gets.some(g => g.includes(c.expect as string));
                return { ok: hit, detail: hit ? 'loaded the skill' : gets.length ? `loaded something else:${gets.join(',')}` : 'loaded no skill' };
            },
        };
    });
}
