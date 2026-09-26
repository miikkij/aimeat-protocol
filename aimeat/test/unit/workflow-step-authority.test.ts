/**
 * @file test/unit/workflow-step-authority.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words a workflow's steps cost the principal that saves or starts it
 *   (services/workflow/step-authority.ts): each kind of step costs what its own door asks, the owner
 *   in person passes as requireScope lets them, a check asks only about the records it reads and the
 *   model, a workflow that reads the owner's records costs memory:read, and a wildcard covers what it
 *   covers at every other door.
 * @version-history
 *   v1.2.0 — 2026-09-25 — An agent step costs work:request for a workflow saved from 2026-09-25 on,
 *     and nothing for one saved before. The old line asserting that it cost nothing was the rule
 *     this change replaces.
 *   v1.1.0 — 2026-09-24 — A workflow that reads the owner's records costs memory:read.
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
    missingStepScopes, stepScopeRefusal, ownerInPerson, STEP_KIND_SCOPES, WORKFLOW_AUTHORITY_VERSION,
} from '../../src/services/workflow/step-authority.js';

const def = (kinds: Array<string | undefined>, llmApproved = false) => ({
    steps: kinds.map((kind, i) => ({ id: `s${i}`, ...(kind ? { action: { kind } } : {}) })) as never,
    ...(llmApproved ? { llm: { approved: true } } : {}),
});
const agent = (scopes: string[]) => ({ roles: ['agent'], scopes });
const words = (m: Array<{ scope: string }>) => m.map(x => x.scope).sort();

describe('the words a step costs', () => {
    it('is what the step\'s own door asks', () => {
        expect(STEP_KIND_SCOPES.ai).toEqual(['ai:use']);
        expect(STEP_KIND_SCOPES.extension).toEqual(['ext:invoke']);
        expect([...STEP_KIND_SCOPES.datapackage].sort()).toEqual(['memory:read', 'memory:write', 'storage:write']);
        expect([...STEP_KIND_SCOPES['export-out']].sort()).toEqual(['memory:read', 'work:request']);
        expect(STEP_KIND_SCOPES['trigger-geai']).toEqual(['work:request']);
        // An agent step gives one of the owner's agents work, which is work:request (2026-09-25; it
        // cost nothing before, and a workflow saved before then keeps that, see below). A
        // human-input step asks the owner.
        expect(STEP_KIND_SCOPES.agent).toEqual(['work:request']);
        expect(STEP_KIND_SCOPES['human-input']).toEqual([]);
    });

    it('is asked of an agent holding only workflow:write, once per word', () => {
        const missing = missingStepScopes(def(['datapackage', 'ai', 'ai', undefined]), agent(['workflow:read', 'workflow:write']), 'save');
        expect(words(missing)).toEqual(['ai:use', 'memory:read', 'memory:write', 'storage:write']);
        expect(missing.find(m => m.scope === 'ai:use')?.step).toBe('s1');
    });

    it('is covered by the exact word, the domain wildcard and full access', () => {
        expect(missingStepScopes(def(['ai']), agent(['ai:use']), 'save')).toEqual([]);
        expect(missingStepScopes(def(['ai']), agent(['ai:*']), 'save')).toEqual([]);
        expect(missingStepScopes(def(['datapackage', 'extension', 'trigger-geai']), agent(['*']), 'save')).toEqual([]);
    });

    it('costs ai:use for llm.approved, on a check as well as on a run', () => {
        expect(words(missingStepScopes(def(['human-input'], true), agent(['workflow:write']), 'save'))).toEqual(['ai:use']);
        expect(words(missingStepScopes(def(['human-input'], true), agent(['workflow:write']), 'signals-only'))).toEqual(['ai:use']);
    });

    it('asks a check about what a check does: the records it reads, and nothing it dispatches', () => {
        expect(words(missingStepScopes(def(['datapackage', 'ai']), agent(['workflow:write']), 'signals-only'))).toEqual(['memory:read']);
        expect(missingStepScopes(def(['human-input', 'trigger-geai']), agent(['workflow:write']), 'signals-only')).toEqual([]);
        expect(words(missingStepScopes(def(['datapackage', 'ai']), agent(['workflow:write']), 'full'))).toEqual(['ai:use', 'memory:read', 'memory:write', 'storage:write']);
    });
});

describe('a workflow that reads the owner\'s records costs memory:read', () => {
    const step = (over: Record<string, unknown>) => ({ steps: [{ id: 'x', ...over }] as never });
    const leaf = { kind: 'deterministic', key: 'owner.record', op: 'json_field', path: 'secret' };

    it('for a signal leaf, however deep it sits', () => {
        for (const signal of [leaf, { all: [leaf] }, { any: [{ all: [leaf] }] }, { when: leaf, then: leaf }]) {
            const d = step({ action: { kind: 'human-input' }, success_signal: signal });
            expect(words(missingStepScopes(d, agent(['workflow:write']), 'save')), JSON.stringify(signal)).toEqual(['memory:read']);
        }
        const input = step({ action: { kind: 'human-input' }, required_to_function: leaf });
        expect(words(missingStepScopes(input, agent(['workflow:write']), 'signals-only'))).toEqual(['memory:read']);
    });

    it('for an agent step, which inherits its offer\'s signals', () => {
        expect(words(missingStepScopes(def([undefined]), agent(['workflow:write']), 'save'))).toEqual(['memory:read']);
    });

    it('for a key a step writes its answer to, which its signal reads back, and for keys an ai step reads', () => {
        for (const action of [
            { kind: 'ai', result_to_key: 'k' }, { kind: 'ai', prompt_key: 'k' }, { kind: 'ai', input_keys: ['k'] },
            { kind: 'extension', result_to_key: 'k' }, { kind: 'human-input', answer_to_key: 'k' },
        ]) {
            const missing = missingStepScopes(step({ action }), agent(['ai:use', 'ext:invoke']), 'save');
            expect(words(missing), JSON.stringify(action)).toEqual(['memory:read']);
            expect(missing[0].kind).toBe('read');
        }
    });

    it('and not for a step that reads nothing', () => {
        expect(missingStepScopes(step({ action: { kind: 'human-input' }, required_to_function: 'none' }), agent([]), 'save')).toEqual([]);
        expect(missingStepScopes(step({ action: { kind: 'human-input' } }), agent(['memory:read']), 'save')).toEqual([]);
    });

    it('says which step reads', () => {
        const r = stepScopeRefusal(missingStepScopes(step({ action: { kind: 'human-input' }, success_signal: leaf }), agent([]), 'save'));
        expect(r.needed).toEqual(['memory:read']);
        expect(r.message).toContain('step "x" reads the owner\'s records');
    });
});

describe('an agent step\'s word follows the rules the workflow was saved under', () => {
    const agentStep = (authority?: number) => ({
        steps: [{ id: 'give', agent: 'bot', offer: 'o', required_to_function: 'none', success_signal: undefined }] as never,
        ...(authority !== undefined ? { authority } : {}),
    });

    it('a workflow saved from 2026-09-25 on asks work:request, and says it is an agent step', () => {
        expect(WORKFLOW_AUTHORITY_VERSION).toBe(2);
        const missing = missingStepScopes(agentStep(2), agent(['memory:read']), 'save');
        expect(words(missing)).toEqual(['work:request']);
        expect(stepScopeRefusal(missing).message).toContain('step "give" is an agent step');
        expect(missingStepScopes(agentStep(2), agent(['memory:read', 'work:request']), 'full')).toEqual([]);
    });

    it('a workflow saved before keeps running as it was saved: its agent step asks nothing more', () => {
        expect(missingStepScopes(agentStep(1), agent(['memory:read']), 'full')).toEqual([]);
        expect(missingStepScopes(agentStep(), agent(['memory:read']), 'full')).toEqual([]);
    });
});

describe('who answers for them', () => {
    it('not the owner in person', () => {
        expect(ownerInPerson({ roles: ['owner'], scopes: [] })).toBe(true);
        expect(missingStepScopes(def(['datapackage', 'ai']), { roles: ['owner'], scopes: [] }, 'full')).toEqual([]);
    });

    it('everything acting in the owner\'s name: an agent, an app grant, an ecosystem app, a visitor', () => {
        for (const caller of [
            { roles: ['agent'], scopes: [] },
            { roles: ['owner', 'agent'], scopes: [] },
            { roles: ['app'], scopes: [] },
            { roles: ['owner', 'ecosystem'], scopes: [] },
            { roles: ['owner'], scopes: [], federated: true },
        ]) {
            expect(ownerInPerson(caller), JSON.stringify(caller)).toBe(false);
            expect(words(missingStepScopes(def(['ai']), caller, 'save'))).toEqual(['ai:use']);
        }
    });
});

describe('the refusal', () => {
    it('is 403 SCOPE_DENIED and names every missing word and the step that asks it', () => {
        const r = stepScopeRefusal(missingStepScopes(def(['ai', 'datapackage']), agent([]), 'save'));
        expect(r.status).toBe(403);
        expect(r.code).toBe('SCOPE_DENIED');
        expect(r.needed.sort()).toEqual(['ai:use', 'memory:read', 'memory:write', 'storage:write']);
        expect(r.message).toContain('"ai:use"');
        expect(r.message).toContain('step "s0"');
        expect(r.message).toContain('"storage:write"');
    });

    it('shows a step id in printable ASCII, because the HTTP door repeats it in a header', () => {
        const odd = { steps: [{ id: 'line\nbreak ✓', action: { kind: 'ai' } }] as never };
        const r = stepScopeRefusal(missingStepScopes(odd, agent([]), 'save'));
        expect(r.message).toMatch(/^[\x20-\x7e]*$/);
        expect(r.message).toContain('step "line?break ?"');
    });
});
