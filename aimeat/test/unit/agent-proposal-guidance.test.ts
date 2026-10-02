/**
 * @file agent-proposal-guidance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every text an agent reads when a person asks it for a new agent points it at this
 *   node's proposal path: the tool description on all three surfaces, the handbooks, the two skills
 *   that cover the request, and the answer the proposal itself gives.
 *
 *   WHY. Measured 2026-10-02 on a freshly bought hosted node: the owner asked their concierge for
 *   "an agent that every morning gathers the CRM's open deals and tells me what to act on", and
 *   after 196 s it recommended CrewAI Studio and three outside CRMs. The owner's own CRM workspace
 *   went unmentioned and no proposal was written. Three things were missing from the guidance:
 *   read what the person already keeps before designing, tell them where to approve, and never
 *   send them elsewhere for what the node does itself. This test holds all three in every place an
 *   agent meets the request, because a guidance line kept in one place only is found by the agents
 *   that happen to read that place.
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-proposal-guidance.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-02 — The scope advice asks for memory:write only; an agent's own tags need no
 *     agent:write.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { descriptionFor } from '../../src/mcp/catalog/shape.js';
import { agentTools } from '../../src/tool-dispatch/tool-call-defs-agent.js';
import { AGENT_HANDBOOK } from '../../src/services/handbooks/agent.js';
import { FULL_HANDBOOK } from '../../src/services/handbooks/full.js';
import { ADMIN_HANDBOOK } from '../../src/services/handbooks/admin.js';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';
import { proposalApprovalUrl, proposalNextStep } from '../../src/services/agent-proposals.js';

/** Reads what the person already keeps: the organisms and their workspaces. */
const READS_THEIR_DATA = /aimeat_workspace_list/;
/** Says where the person approves it. */
const NAMES_APPROVAL = /approval_url/;
/** Does not send the person to another product for this. */
const STAYS_HERE = /outside (agent )?(builder|tool|product)/i;

const skill = (name: string) => BUILTIN_SKILLS.find(s => s.name === name)?.skillMd ?? '';

describe('a request for a new agent leads to a proposal on this node', () => {
    it('the tool description (node and connector MCP) says all three things', () => {
        const d = descriptionFor('aimeat_agent_propose');
        expect(d).toMatch(READS_THEIR_DATA);
        expect(d).toMatch(NAMES_APPROVAL);
        expect(d).toMatch(STAYS_HERE);
    });

    it('the description a fleet daemon reads (/local/call) says all three things', () => {
        const d = agentTools.find(t => t.name === 'aimeat_agent_propose')?.description ?? '';
        expect(d).toMatch(READS_THEIR_DATA);
        expect(d).toMatch(NAMES_APPROVAL);
        expect(d).toMatch(STAYS_HERE);
    });

    it('the agent, full and admin handbooks name the proposal tool and the rule', () => {
        for (const [which, text] of [['agent', AGENT_HANDBOOK], ['full', FULL_HANDBOOK], ['admin', ADMIN_HANDBOOK]] as const) {
            expect(text, which).toMatch(/aimeat_agent_propose/);
            expect(text, which).toMatch(READS_THEIR_DATA);
            expect(text, which).toMatch(STAYS_HERE);
        }
    });

    it('both skills that cover the request say all three things', () => {
        for (const name of ['add-a-crew-agent', 'aimeat-recurring-work']) {
            const md = skill(name);
            expect(md, name).toMatch(/aimeat_agent_propose/);
            expect(md, name).toMatch(READS_THEIR_DATA);
            expect(md, name).toMatch(NAMES_APPROVAL);
            expect(md, name).toMatch(STAYS_HERE);
        }
    });

    // Measured 2026-10-02 on a sandbox with crewaimeat 7079c1a: an agent proposed with
    // memory:read alone, as "only the scopes the job needs" suggested, read the deals and was then
    // refused its own result write (memory:write) and its tag report (agent:write), and the task
    // failed. With those two added, the same agent finished the task.
    // Since 2026-10-02 an agent's own tag report needs no agent:write (auth/self-or-scope.ts, ruled by
    // Jouni): that word also lets an agent approve new agents. So the advice names memory:write as
    // the runtime's, and where it mentions agent:write it says what that word does instead.
    it('the scope advice names memory:write as the runtime\'s, and does not ask for agent:write', () => {
        const texts: Array<[string, string]> = [
            ['catalog description', descriptionFor('aimeat_agent_propose')],
            ['handbook paragraph', AGENT_HANDBOOK],
            ['add-a-crew-agent', skill('add-a-crew-agent')],
        ];
        for (const [which, text] of texts) {
            expect(text, which).toMatch(/memory:write/);
            expect(text, which).not.toMatch(/memory:write\W+(and|\+)\W+\\?`?agent:write/);
        }
    });

    it('the answer to a proposal gives the address where the person approves it', () => {
        const url = proposalApprovalUrl('https://example.test/');
        expect(url).toBe('https://example.test/v1/profile?tab=agents');
        const fresh = proposalNextStep('CRM digest', url, false);
        expect(fresh).toContain(url);
        expect(fresh).toMatch(/Nothing has been created/);
        const waiting = proposalNextStep('CRM digest', url, true);
        expect(waiting).toContain(url);
        expect(waiting).toMatch(/already waiting/);
    });
});
