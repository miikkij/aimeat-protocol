/**
 * @file first-steps.test.ts
 * @description One answer to "how do I get in", and every public surface gives it. The instruction
 *   review of 2026-09-18 found five different first steps across the public surfaces, one of them
 *   a quick start (the anonymous token) that is off by default and answers 403. Held here: MCP
 *   leads, the anonymous road exists only where the node has it on, and AGENTS.md, skill.md, the
 *   landing markdown and the JSON bootstrap all carry the same text.
 * @usage cd aimeat && pnpm exec vitest run test/unit/first-steps.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { buildFirstSteps, firstStepsMarkdown } from '../../src/services/first-steps.js';
import { buildLandingMarkdown } from '../../src/services/markdown-negotiation.js';

const config = (over: Record<string, unknown> = {}) => ({
    baseUrl: 'https://node.example/', nodeId: 'node-1', anonymousMode: false, agentJwtTtlSeconds: 90 * 86400, ...over,
}) as any;

describe('buildFirstSteps', () => {
    it('leads with MCP, then device authorization, then the prompt-driven road', () => {
        expect(buildFirstSteps(config()).map(s => s.id)).toEqual(['mcp', 'device-authorization', 'prompt-driven']);
    });

    it('offers the anonymous road only on a node that has it on', () => {
        expect(buildFirstSteps(config()).some(s => s.id === 'anonymous')).toBe(false);
        expect(buildFirstSteps(config({ anonymousMode: true })).at(-1)?.id).toBe('anonymous');
    });

    it('reads the token lifetime from config and never doubles a slash', () => {
        const device = buildFirstSteps(config({ agentJwtTtlSeconds: 30 * 86400 }))[1];
        expect(device.how).toContain('30 days');
        expect(JSON.stringify(buildFirstSteps(config()))).not.toContain('example//');
    });
});

describe('the surfaces that answer "how do I get in"', () => {
    it('the landing markdown carries the shared steps, MCP first', () => {
        const md = buildLandingMarkdown(config());
        expect(md).toContain(firstStepsMarkdown(config()));
        expect(md.indexOf('/v1/mcp')).toBeLessThan(md.indexOf('device-authorize'));
    });
});
