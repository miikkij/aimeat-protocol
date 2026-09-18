/**
 * @file src/services/first-steps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How an AI that has just met this node gets in: ONE answer, read by every public
 *   surface that gives one.
 *
 *   WHY. The instruction review of 2026-09-18 found five different first steps across the public
 *   surfaces. The JSON bootstrap told an assistant to ask whether the person knew AIMEAT and then
 *   take an anonymous token, which is off by default and answers 403. AGENTS.md and llms.txt led
 *   with device authorization and mentioned MCP in passing or not at all. skill.md, the help
 *   prompt and the per-app pages led with MCP. Each was written by hand, at a different time, and
 *   an agent reads whichever one it happened to fetch. The project's own order is settled: MCP is
 *   the preferred road in, and the prompt-driven road is for everyone MCP cannot reach.
 *
 *   REPETITION STAYS, COPYING GOES. An agent often reads exactly one of these surfaces, so each
 *   one has to carry the answer itself; the developer ruled that on the same day. What this
 *   removes is the hand copying: the surfaces still each say it, and they cannot say different
 *   things.
 *
 *   FROM CONFIG, NOT FROM MEMORY. The anonymous road appears only when this node has it switched
 *   on, and lifetimes are read from the config the node runs with.
 * @structure FirstStep · buildFirstSteps(config) · firstStepsMarkdown(config)
 * @usage
 *   import { buildFirstSteps, firstStepsMarkdown } from '../services/first-steps.js';
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { AimeatConfig } from '../config.js';

export interface FirstStep {
    /** Stable id, for a machine reader. */
    id: 'mcp' | 'device-authorization' | 'prompt-driven' | 'anonymous';
    /** Who this road is for, as a condition the reader can check about itself. */
    when: string;
    /** What to do, in one or two sentences. */
    how: string;
    /** Where the full flow is written down. */
    read: string;
}

export function buildFirstSteps(config: AimeatConfig): FirstStep[] {
    const b = config.baseUrl.replace(/\/+$/, '');
    const agentDays = Math.round(config.agentJwtTtlSeconds / 86400);
    const steps: FirstStep[] = [
        {
            id: 'mcp',
            when: 'Your app can connect to an MCP server (Claude, Claude Code, ChatGPT with developer mode, Codex, Cursor, VS Code, Grok, goose).',
            how: `Add ${b}/v1/mcp as a remote MCP server and sign in with OAuth 2.1; the person approves you and picks what you may do. Then call aimeat_handbook_get. This is the preferred road: you get the node's tools natively, and nothing to install.`,
            read: `${b}/.well-known/mcp.json`,
        },
        {
            id: 'device-authorization',
            when: 'You can make HTTP requests and cannot attach an MCP server.',
            how: `Start device authorization (RFC 8628): POST ${b}/v1/agents/device-authorize with the person's username, give them the code to approve, then poll ${b}/v1/agents/device-token. The token lasts ${agentDays} days, and you renew it yourself by signature. An agent is never created without the person approving it.`,
            read: `${b}/auth.md`,
        },
        {
            id: 'prompt-driven',
            when: 'You are a chat that can do neither (a consumer Gemini or Copilot app, for example).',
            how: `The person works through the node's pages, which compose a ready prompt for you; they run it with you and paste your answer back. Send them to ${b}/v1/portal to register, and read ${b}/v1/help/prompt for how to guide them.`,
            read: `${b}/v1/help/prompt`,
        },
    ];
    if (config.anonymousMode) {
        steps.push({
            id: 'anonymous',
            when: 'The person only wants to try something, with no account.',
            how: `This node allows an anonymous session: POST ${b}/v1/auth/anonymous. It is a throwaway identity, separate from any account the person has or makes later.`,
            read: `${b}/?format=json`,
        });
    }
    return steps;
}

/** The same steps as a markdown list, for the surfaces that are documents. */
export function firstStepsMarkdown(config: AimeatConfig): string {
    return buildFirstSteps(config)
        .map((s, i) => `${i + 1}. **${s.when}** ${s.how} Full flow: \`${s.read}\``)
        .join('\n');
}
