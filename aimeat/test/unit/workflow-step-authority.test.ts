/**
 * @file test/unit/workflow-step-authority.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words a workflow's steps cost the principal that saves or starts it
 *   (services/workflow/step-authority.ts): each kind of step costs what its own door asks, the owner
 *   in person passes as requireScope lets them, a check asks only about the model, and a wildcard
 *   covers what it covers at every other door.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
    missingStepScopes, stepScopeRefusal, ownerInPerson, STEP_KIND_SCOPES,
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
        // An agent step works on the dispatched agent's own grant; a human-input step asks the owner.
        expect(STEP_KIND_SCOPES.agent).toEqual([]);
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
        expect(words(missingStepScopes(def([undefined], true), agent(['workflow:write']), 'save'))).toEqual(['ai:use']);
        expect(words(missingStepScopes(def([undefined], true), agent(['workflow:write']), 'signals-only'))).toEqual(['ai:use']);
    });

    it('asks a check about nothing a check does not do', () => {
        expect(missingStepScopes(def(['datapackage', 'ai']), agent(['workflow:write']), 'signals-only')).toEqual([]);
        expect(words(missingStepScopes(def(['datapackage', 'ai']), agent(['workflow:write']), 'full'))).toEqual(['ai:use', 'memory:read', 'memory:write', 'storage:write']);
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
