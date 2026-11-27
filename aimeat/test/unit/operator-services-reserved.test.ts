/**
 * @file test/unit/operator-services-reserved.test.ts
 * @description The agent names the node manages in every account are refused as an operator service
 *   entry's `id` and `credential_agent` (config/operator-services.ts RESERVED_AGENT_NAMES, S3), and the
 *   list is held to the places that make or special-case those names, so a new system agent that is
 *   added there and not here fails this test.
 * @usage pnpm exec vitest run test/unit/operator-services-reserved.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (operator services review, S3).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { operatorServiceProblem, RESERVED_AGENT_NAMES, reservedAgentName } from '../../src/config/operator-services.js';
import { CHAT_AGENT_NAME } from '../../src/services/chat/agent.js';
import { BASIC_AGENTS } from '../../src/data/basic-agents.js';

const entry = (over: Record<string, unknown> = {}) => ({
    id: 'desk-helper', display_name: 'Desk Helper', description: 'Answers questions about the desk for you.',
    credential_agent: 'desk-service', scopes: ['memory:read'], enabled: true, ...over,
});
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('the reserved agent names', () => {
    it('name every agent the node makes or special-cases', () => {
        expect(RESERVED_AGENT_NAMES).toHaveProperty(CHAT_AGENT_NAME);
        for (const b of BASIC_AGENTS) expect(RESERVED_AGENT_NAMES, b.name).toHaveProperty(b.name);
        expect(source('src/routes/ghii/web-verify.ts')).toMatch(/buildGAII\('app'/);
        expect(source('src/services/anonymous-principal-records.ts')).toMatch(/ANONYMOUS_AGENT_NAME = 'shared'/);
        expect(source('src/services/workflow/engine-inspector.ts')).toMatch(/buildGAII\('workflow-inspector'/);
        expect(source('src/routes/access-tokens.ts')).toMatch(/buildGAII\(`apptester-/);
        for (const n of ['app', 'shared', 'workflow-inspector']) expect(RESERVED_AGENT_NAMES, n).toHaveProperty(n);
        expect(reservedAgentName('apptester-1a2b3c4d')).toMatch(/access token/);
    });

    it('are refused as an entry id and as its credential agent, with the reason', () => {
        // A name the agent-name rule refuses already (validateAgentName) is refused by that rule first.
        for (const name of [...Object.keys(RESERVED_AGENT_NAMES), 'apptester-1a2b3c4d']) {
            expect(operatorServiceProblem([entry({ id: name })]), name).toMatch(/\[0\]\.id: /);
            expect(operatorServiceProblem([entry({ credential_agent: name })]), name).toMatch(/\[0\]\.credential_agent: /);
        }
        for (const name of ['app', 'chat', 'concierge', 'workflow-manager']) {
            expect(operatorServiceProblem([entry({ id: name })]), name).toMatch(/is a name this node manages/);
        }
        expect(operatorServiceProblem([entry()])).toBeNull();
    });
});
