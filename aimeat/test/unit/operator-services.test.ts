/**
 * @file test/unit/operator-services.test.ts
 * @description The two rules of operator services that need no node: the setting's check
 *   (config/operator-services.ts operatorServiceProblem: a refused entry is answered with the field it
 *   is in) and the provisioning decision (services/operator-services/eligibility.ts decideProvision:
 *   every condition must hold, the caller's conditions are named, and every condition about the named
 *   account answers one sentence). The E2E suite e2e-operator-service-agents.ts holds the same rules on
 *   a running node.
 * @usage pnpm exec vitest run test/unit/operator-services.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-27 — A refusal of the credential's own entry name carries `own` (B1).
 *   v1.1.0 — 2026-11-26 — The description is required, 20 to 300 characters.
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { operatorServiceProblem, MAX_OPERATOR_SERVICES } from '../../src/config/operator-services.js';
import { decideProvision, ACCOUNT_NOTE, type ProvisionFacts } from '../../src/services/operator-services/eligibility.js';
import { entryNow } from '../../src/services/operator-services/entries.js';
import { SCOPE_VOCABULARY } from '../../src/utils/scope-vocabulary.js';

const entry = (over: Record<string, unknown> = {}) => ({
    id: 'desk-helper', display_name: 'Desk Helper', description: 'Answers desk questions.',
    credential_agent: 'desk-service', scopes: ['memory:read', 'memory:write'], enabled: true, ...over,
});

describe('every word of the scope vocabulary is known', () => {
    it('is accepted, or refused by a named rule (wildcard, own-tick, never in a service); none is unknown', () => {
        // memory:read-as-owner, the private-read exception (2026-11-26), is refused only for want of its reason.
        const NAMED = /is a wildcard|on their own agent's page|never holds it|private_read_reason is required/;
        for (const w of SCOPE_VOCABULARY) {
            const p = operatorServiceProblem([entry({ scopes: [w], ...(w === 'memory:write-as-owner' ? { write_prefixes: ['svc.'] } : {}) })]);
            expect(p ?? 'accepted', w).not.toMatch(/no permission this node knows/);
            if (p) expect(p, w).toMatch(NAMED);
        }
        expect(operatorServiceProblem([entry({ scopes: ['memory:read', 'memory:write-as-owner'], write_prefixes: ['desk-helper.'] })])).toBeNull();
    });
});

describe('write_prefixes', () => {
    const asOwner = (write_prefixes?: unknown) => [entry({ scopes: ['memory:read', 'memory:write-as-owner'], ...(write_prefixes !== undefined ? { write_prefixes } : {}) })];
    it('is required with memory:write-as-owner, and says why', () => {
        expect(operatorServiceProblem(asOwner())).toMatch(/write_prefixes is required with memory:write-as-owner/);
    });
    it('refuses an empty list, too many, a short one, one without "." or "/", a wildcard, and a reserved or system namespace', () => {
        expect(operatorServiceProblem(asOwner([]))).toMatch(/1 to 8/);
        expect(operatorServiceProblem(asOwner(Array.from({ length: 9 }, (_, i) => `area${i}.`)))).toMatch(/1 to 8/);
        expect(operatorServiceProblem(asOwner(['ab.']))).toMatch(/4 to/);
        expect(operatorServiceProblem(asOwner(['desk-helper']))).toMatch(/must end with/);
        expect(operatorServiceProblem(asOwner(['desk.*.']))).toMatch(/never a wildcard/);
        for (const p of ['profile.', 'openrouter.x.', 'notif.', 'operator-service.', 'security.', 'organism.', 'commerce.hold.']) {
            expect(operatorServiceProblem(asOwner([p])), p).toMatch(/overlaps/);
        }
        expect(operatorServiceProblem(asOwner(['desk-helper.', 'notes/']))).toBeNull();
    });
});

describe('the setting check names the field it refuses', () => {
    it('accepts an empty list and a good entry', () => {
        expect(operatorServiceProblem([])).toBeNull();
        expect(operatorServiceProblem([entry()])).toBeNull();
    });

    it('refuses a value that is not a list, and more than the most entries', () => {
        expect(operatorServiceProblem({})).toMatch(/JSON list/);
        const many = Array.from({ length: MAX_OPERATOR_SERVICES + 1 }, (_, i) => entry({ id: `svc-${i}` }));
        expect(operatorServiceProblem(many)).toMatch(/at most 8/);
    });

    it('refuses * , a domain wildcard and a word outside every wildcard, naming the field', () => {
        expect(operatorServiceProblem([entry({ scopes: ['*'] })])).toMatch(/agents\.operator_services\[0\]\.scopes\[0\]: "\*" is a wildcard/);
        expect(operatorServiceProblem([entry({ scopes: ['memory:read', 'memory:*'] })])).toMatch(/scopes\[1\]: "memory:\*" is a wildcard/);
        // The ruling of 2026-11-26 lets one outside-wildcard word through, memory:read-as-owner, with its
        // reason (the private-read exception); every other one stays refused by name.
        expect(operatorServiceProblem([entry({ scopes: ['consent:read-as-owner'] })])).toMatch(/scopes\[0\]: "consent:read-as-owner" is a permission each person gives/);
        expect(operatorServiceProblem([entry({ scopes: ['memory:read-as-owner'] })])).toMatch(/\[0\]\.private_read_reason is required with memory:read-as-owner/);
        expect(operatorServiceProblem([entry({ scopes: ['operator:service-provision'] })])).toMatch(/scopes\[0\]/);
        expect(operatorServiceProblem([entry({ scopes: ['memory read'] })])).toMatch(/not a permission word/);
    });

    it('refuses a missing or bad field by its name', () => {
        expect(operatorServiceProblem([entry({ id: 'X' })])).toMatch(/\[0\]\.id/);
        expect(operatorServiceProblem([entry({ credential_agent: undefined })])).toMatch(/\[0\]\.credential_agent is required/);
        expect(operatorServiceProblem([entry({ display_name: '' })])).toMatch(/\[0\]\.display_name/);
        // The description is the one place a person learns what the service is: required, 20 to 300 characters.
        expect(operatorServiceProblem([entry({ description: undefined })])).toMatch(/\[0\]\.description is required/);
        expect(operatorServiceProblem([entry({ description: 'Too short.' })])).toMatch(/\[0\]\.description is required: 20 to 300/);
        expect(operatorServiceProblem([entry({ description: 'x'.repeat(301) })])).toMatch(/\[0\]\.description/);
        expect(operatorServiceProblem([entry({ description: 'x'.repeat(300) })])).toBeNull();
        expect(operatorServiceProblem([entry({ enabled: 'yes' })])).toMatch(/\[0\]\.enabled/);
        expect(operatorServiceProblem([entry({ scopes: [] })])).toMatch(/\[0\]\.scopes is required/);
        expect(operatorServiceProblem([entry({ extra: 1 })])).toMatch(/\[0\]\.extra is not a field/);
        expect(operatorServiceProblem([entry(), entry()])).toMatch(/\[1\]\.id: "desk-helper" is already/);
    });
});

describe('the entry against the running node', () => {
    const cfg = (max: string[]) => ({ maxAgentScopes: max, defaultAgentScopes: ['memory:read', 'memory:write'] });
    it('is usable inside the node maximum, and not when the maximum leaves a word out', () => {
        expect(entryNow(cfg(['*']), entry() as never).usable).toBe(true);
        const narrow = entryNow(cfg(['memory:read']), entry() as never);
        expect(narrow.usable).toBe(false);
        expect(narrow.allowedScopes).toEqual(['memory:read']);
        expect(narrow.problem).toMatch(/memory:write/);
    });
    it('is not usable with a word the node does not know', () => {
        const e = entryNow(cfg(['*']), entry({ scopes: ['memory:read', 'nothing:here'] }) as never);
        expect(e.usable).toBe(false);
        expect(e.problem).toMatch(/nothing:here/);
    });
    it('is not usable switched off', () => {
        expect(entryNow(cfg(['*']), entry({ enabled: false }) as never).usable).toBe(false);
    });
});

describe('the provisioning decision', () => {
    const usable = entryNow({ maxAgentScopes: ['*'], defaultAgentScopes: ['memory:read', 'memory:write'] }, entry() as never);
    const good = (over: Partial<ProvisionFacts> = {}): ProvisionFacts => ({
        callerIsAgent: true, callerIsServiceAgent: false, operator: { ok: true, name: 'op', inPerson: false }, callerAgentName: 'desk-service',
        agentName: 'desk-helper', entries: [usable], requested: ['memory:read'], ownerActive: true, line: null, existingGaii: null,
        madeByService: false, busy: false,
        ...over,
    });

    it('approves when every condition holds, with what was asked for', () => {
        expect(decideProvision(good())).toEqual({ kind: 'approve', entry: usable, scopes: ['memory:read'], existing: false, line: null, requiredNow: false });
        const all = decideProvision(good({ requested: undefined }));
        expect(all.kind === 'approve' && all.scopes).toEqual(['memory:read', 'memory:write']);
    });

    it('does not apply to a request that names no service from no credential', () => {
        expect(decideProvision(good({ agentName: 'other', callerAgentName: 'crew-forge' }))).toEqual({ kind: 'not-service' });
        expect(decideProvision(good({ callerIsAgent: false }))).toEqual({ kind: 'not-service' });
    });

    it('refuses a caller that is not an operator\'s agent holding the word', () => {
        for (const why of ['not-operator', 'needs-word', 'visitor'] as const) {
            const d = decideProvision(good({ operator: { ok: false, why } }));
            expect(d.kind).toBe('refused');
            expect(d.kind === 'refused' && d.note).toMatch(/operator:service-provision/);
        }
    });

    it('refuses service B\'s agent name asked by service A\'s credential', () => {
        const other = { ...usable, id: 'other-svc', credential_agent: 'other-cred' };
        const d = decideProvision(good({ entries: [usable, other], agentName: 'other-svc' }));
        expect(d.kind).toBe('refused');
    });

    it('refuses a word outside the entry, * and a domain wildcard', () => {
        for (const requested of [['memory:delete'], ['*'], ['memory:*'], ['memory:read-as-owner']]) {
            expect(decideProvision(good({ requested })).kind, requested.join()).toBe('refused');
        }
    });

    it('refuses a switched-off entry', () => {
        const off = { ...usable, enabled: false, usable: false };
        expect(decideProvision(good({ entries: [off] })).kind).toBe('refused');
    });

    it('marks `own` only when the credential asks for its own entry\'s name (B1: answered 403, nothing stored)', () => {
        const off = { ...usable, enabled: false, usable: false };
        const own = (f: ProvisionFacts) => { const d = decideProvision(f); return d.kind === 'refused' && d.own === true; };
        expect(own(good({ entries: [off] }))).toBe(true);
        expect(own(good({ requested: ['memory:delete'] }))).toBe(true);
        expect(own(good({ ownerActive: false }))).toBe(true);
        expect(own(good({ operator: { ok: false, why: 'needs-word' } }))).toBe(false);
        expect(own(good({ callerIsServiceAgent: true }))).toBe(false);
        expect(own(good({ entries: [usable, { ...usable, id: 'other-svc', credential_agent: 'other-cred' }], agentName: 'other-svc' }))).toBe(false);
    });

    it('answers every reason about the named account with the one sentence', () => {
        const removed = { gaii: 'desk-helper#alice@n', at: 't', state: 'removed' as const, removed_at: 't' };
        for (const f of [
            good({ ownerActive: false }),
            good({ line: removed }),
            good({ existingGaii: 'desk-helper#alice@n' }),
            good({ existingGaii: 'desk-helper#alice@n', line: { gaii: 'desk-helper#alice@n', at: 't', state: 'ended' } }),
        ]) {
            expect(decideProvision(f)).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        }
    });

    it('connects again the agent the service made (the proof matched)', () => {
        const line = { gaii: 'desk-helper#alice@n', at: 't', state: 'active' as const };
        const d = decideProvision(good({ existingGaii: 'desk-helper#alice@n', line, madeByService: true }));
        expect(d.kind === 'approve' && d.existing).toBe(true);
    });

    it('a stale line, a busy reservation and a caller that is a service\'s agent', () => {
        expect(decideProvision(good({ stale: true }))).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        expect(decideProvision(good({ busy: true }))).toEqual({ kind: 'busy' });
        expect(decideProvision(good({ callerIsServiceAgent: true })).kind).toBe('refused');
    });
});
