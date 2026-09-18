/**
 * @file src/services/skills-by-situation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The section of the agent's handbook that says which skill fits which situation,
 *   built from the node's own skill registry every time it is served.
 *
 *   WHY. The cold-agent skill baseline of 2026-09-18 ran 37 sessions in which a person's sentence
 *   called for a skill, and `aimeat_skill_list` was called in none of them. Every session opened
 *   the same way: the handbook, then tools. A skill was loaded only on the app-building road,
 *   where `aimeat_appdev_overview` names it. Nothing else tells an agent that a situation HAS a
 *   skill, so the descriptions, which read well, are never read. The route to them was missing,
 *   and the handbook is the one text an agent reliably opens first (five of nine baseline tasks).
 *
 *   WHY GENERATED. A hand-written list of skills inside a handbook is a second home for the same
 *   fact, and the instruction review of the same day found what those become. This reads the
 *   registry: a skill published on this node appears here on the next call, a retired one leaves,
 *   and a node somebody else runs lists ITS skills and not aimeat.io's.
 *
 *   WHAT IS LEFT OUT. A skill bound to one app (it teaches that app, and the app's own detail
 *   names it), a skill that names its replacement, and a skill that is a part of another listed
 *   skill: `aimeat-phaser-boot` sits under `aimeat-phaser`, which links out to it. The rule is the
 *   name: `<listed skill>-<anything>`. That keeps the section to the entry points.
 * @structure firstSentence() · skillsBySituation()
 * @usage
 *   const section = await skillsBySituation(storage, config, ownerName);
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { listSkills } from './skills.js';

const LINE_MAX = 190;

/** The first sentence of a description, which by this project's convention says what and when. */
export function firstSentence(description: string): string {
    const flat = description.replace(/\s+/g, ' ').trim();
    const end = flat.search(/[.!?](\s|$)/);
    const sentence = end > 0 ? flat.slice(0, end + 1) : flat;
    return sentence.length > LINE_MAX ? `${sentence.slice(0, LINE_MAX - 1).trimEnd()}…` : sentence;
}

/**
 * Markdown for the handbook, or '' when the node has no skill this caller may read. `ownerName`
 * is the person the agent acts for; node-scope skills with visibility `members` need one.
 */
export async function skillsBySituation(storage: Storage, config: AimeatConfig, ownerName: string | null): Promise<string> {
    const all = await listSkills(storage, config, 'node', { ownerName });
    const entries = all.filter(s => !s.binding && !s.supersededBy);
    const names = new Set(entries.map(s => s.name));
    const isPartOfAnother = (name: string) => [...names].some(other => other !== name && name.startsWith(`${other}-`));
    const listed = entries.filter(s => !isPartOfAnother(s.name)).sort((a, b) => a.name.localeCompare(b.name));
    if (listed.length === 0) return '';

    return [
        '## A skill may already cover this',
        '',
        'A skill is this node\'s own guide for one kind of job, written from what went wrong before.',
        'When what the person asks for matches a line below, load that skill first with',
        '`aimeat_skill_get` (pass the name), and work from it. It is faster than working the job out',
        'from the tools, and it carries the steps people here expect.',
        '',
        ...listed.map(s => `- \`${s.name}\`: ${firstSentence(s.description)}`),
        '',
        'The person\'s own skills and their workspaces\' skills are in `aimeat_skill_list`.',
    ].join('\n');
}
