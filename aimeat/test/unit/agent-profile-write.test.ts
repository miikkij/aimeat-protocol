/**
 * @file agent-profile-write.test.ts
 * @description Unit tests for the shared agent-record write, which HTTP and MCP now both call.
 *
 *   The tests that matter here are the two the copies disagreed on, because those are what a
 *   regression would quietly restore: a mode change has to re-derive the Hello Integration step
 *   list (the tool never did), and a reported language has to land in `languages` rather than being
 *   pushed into the domain list as "Language: fi" (the tool did that until August 2026). The rest
 *   assert refusals, which is where a shared write can do real damage: a cross-owner call must
 *   write nothing at all.
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-profile-write.test.ts
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Initial, with services/agent-profile-write.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    setAgentTags, setAgentMode, setAgentCapabilities,
} from '../../src/services/agent-profile-write.js';
import { createDefaultSteps } from '../../src/models/agent-onboarding-schemas.js';
import type { AgentRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'node-1' } as never as import('../../src/config.js').AimeatConfig;

function agent(over: Partial<AgentRecord> = {}): AgentRecord {
    return {
        name: 'crew', owner: 'alice', gaii: 'crew#alice@node-1',
        capabilities: [], publicKey: 'k', trustScore: 50, morselBalance: 0,
        createdAt: '2026-01-01T00:00:00Z', lastSeen: '2026-01-01T00:00:00Z',
        mode: 'interactive',
        ...over,
    };
}

/** Only what the service reads and writes. updateAgent answers with the merged record. */
function fakeStorage(over: Record<string, unknown> = {}) {
    const stored = (over.agent as AgentRecord | null | undefined) ?? agent();
    const updateAgent = vi.fn(async (_gaii: string, patch: Partial<AgentRecord>) => ({ ...stored, ...patch }));
    const updateOnboarding = vi.fn(async () => null);
    return {
        updateAgent, updateOnboarding,
        getAgent: async () => (over.agent === null ? null : stored),
        getOnboarding: async () => over.onboarding ?? null,
        ...(over.storage as Record<string, unknown> ?? {}),
    } as never as import('../../src/storage/interface.js').Storage & {
        updateAgent: typeof updateAgent; updateOnboarding: typeof updateOnboarding;
    };
}

const deps = (storage: unknown) => ({ storage: storage as never, config });

describe('setAgentTags', () => {
    it('lowercases, trims and de-duplicates, and keeps faceted tags', async () => {
        const storage = fakeStorage();
        const outcome = await setAgentTags(deps(storage), 'alice', 'crew', ['  Crew:Alpha ', 'crew:alpha', 'role:researcher']);
        expect(outcome.ok).toBe(true);
        expect(storage.updateAgent).toHaveBeenCalledWith('crew#alice@node-1', { tags: ['crew:alpha', 'role:researcher'] });
    });

    it('refuses a tag that fails the pattern without writing anything', async () => {
        const storage = fakeStorage();
        const outcome = await setAgentTags(deps(storage), 'alice', 'crew', ['ok', 'not a tag']);
        expect(outcome).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
        expect(storage.updateAgent).not.toHaveBeenCalled();
    });

    it('refuses another owner\'s agent named by full GAII', async () => {
        const storage = fakeStorage({ agent: agent({ owner: 'bob', gaii: 'crew#bob@node-1' }) });
        const outcome = await setAgentTags(deps(storage), 'alice', 'crew#bob@node-1', ['mine']);
        expect(outcome).toMatchObject({ ok: false, code: 'ACCESS_DENIED' });
        expect(storage.updateAgent).not.toHaveBeenCalled();
    });
});

describe('setAgentMode', () => {
    it('re-derives the Hello Integration step list for the new mode and keeps passed steps', async () => {
        const steps = createDefaultSteps('interactive');
        steps.find(s => s.id === 'authenticate')!.status = 'passed';
        const storage = fakeStorage({ onboarding: { agentGaii: 'crew#alice@node-1', status: 'in_progress', steps } });

        const outcome = await setAgentMode(deps(storage), 'alice', 'crew', 'task-runner');

        expect(outcome.ok).toBe(true);
        expect(storage.updateAgent).toHaveBeenCalledWith('crew#alice@node-1', { mode: 'task-runner' });
        expect(storage.updateOnboarding).toHaveBeenCalledTimes(1);
        const written = storage.updateOnboarding.mock.calls[0][1] as { steps: Array<{ id: string; status: string }> };
        expect(written.steps.map(s => s.id)).toEqual(createDefaultSteps('task-runner').map(s => s.id));
        expect(written.steps.find(s => s.id === 'authenticate')!.status).toBe('passed');
    });

    it('leaves the step list alone when the flow is already the mode\'s own', async () => {
        const storage = fakeStorage({ onboarding: { status: 'in_progress', steps: createDefaultSteps('task-runner') } });
        await setAgentMode(deps(storage), 'alice', 'crew', 'task-runner');
        expect(storage.updateOnboarding).not.toHaveBeenCalled();
    });

    it('refuses a mode outside the vocabulary', async () => {
        const storage = fakeStorage();
        const outcome = await setAgentMode(deps(storage), 'alice', 'crew', 'supervisor');
        expect(outcome).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
        expect(storage.updateAgent).not.toHaveBeenCalled();
    });
});

describe('setAgentCapabilities', () => {
    it('stores reported languages in their own field, never in the domain list', async () => {
        const storage = fakeStorage();
        const outcome = await setAgentCapabilities(deps(storage), 'crew#alice@node-1',
            { technical: [], domain: ['web development'], languages: ['fi', 'en'] }, { liveMcpSession: true });

        expect(outcome.ok).toBe(true);
        const patch = storage.updateAgent.mock.calls[0][1] as { domainCapabilities: string[]; languages?: string[] };
        expect(patch.languages).toEqual(['fi', 'en']);
        expect(patch.domainCapabilities).toEqual(['web development']);
    });

    it('marks an mcp capability verified only when the session proves the connection', async () => {
        const live = fakeStorage();
        await setAgentCapabilities(deps(live), 'crew#alice@node-1',
            { technical: [{ name: 'playwright', type: 'mcp' }, { name: 'git', type: 'tool' }] }, { liveMcpSession: true });
        expect((live.updateAgent.mock.calls[0][1] as { technicalCapabilities: Array<{ verified: boolean }> }).technicalCapabilities)
            .toEqual([{ name: 'playwright', type: 'mcp', verified: true }, { name: 'git', type: 'tool', verified: false }]);

        const owner = fakeStorage();
        await setAgentCapabilities(deps(owner), 'crew#alice@node-1',
            { technical: [{ name: 'playwright', type: 'mcp' }] }, { liveMcpSession: false });
        expect((owner.updateAgent.mock.calls[0][1] as { technicalCapabilities: Array<{ verified: boolean }> }).technicalCapabilities[0].verified)
            .toBe(false);
    });

    it('refuses a malformed report and refuses a missing agent before reading the body', async () => {
        const bad = fakeStorage();
        expect(await setAgentCapabilities(deps(bad), 'crew#alice@node-1',
            { technical: [{ name: 'x', type: 'telepathy' }] }, { liveMcpSession: true }))
            .toMatchObject({ ok: false, code: 'INVALID_INPUT' });
        expect(bad.updateAgent).not.toHaveBeenCalled();

        const missing = fakeStorage({ agent: null });
        expect(await setAgentCapabilities(deps(missing), 'ghost#alice@node-1', {}, { liveMcpSession: true }))
            .toMatchObject({ ok: false, code: 'AGENT_NOT_FOUND' });
    });
});
