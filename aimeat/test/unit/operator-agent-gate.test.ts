/**
 * @file test/unit/operator-agent-gate.test.ts
 * @description The one operator question every door asks (services/operator-principal.ts): is THIS
 *   PRINCIPAL the node operator. The operator in person passes; anything acting for an operator
 *   account (an agent, an app grant, an ecosystem app) passes only on the exact word; a session from
 *   another node never passes.
 *
 *   Security audit A8-1. The checks asked only whether the ACCOUNT runs the node, so every agent an
 *   operator had ever connected carried the operator's reach, whatever the operator had granted it.
 *   The account stays the outer gate and is asked first; the word is asked second and only the exact
 *   string counts, because "Full access" is one click and nobody clicking it is deciding that an agent
 *   may reset somebody else's second factor.
 * @version-history
 *   v1.2.0 -- 2026-09-24 -- The page-layout and theme services ask their own word of the agent at
 *     call time (callerIsOperator), not the account alone.
 *   v1.1.0 -- 2026-09-24 -- askOperator: the principal's kind decides, with the roles when the door
 *     has them; the in-person answer is read off the token without a storage read.
 *   v1.0.0 -- 2026-09-24 -- Initial (security audit A8-1).
 */
import { describe, it, expect } from 'vitest';
import { askOperator, resolveOperatorAgentName } from '../../src/services/operator-principal.js';
import { SurfaceLayoutService } from '../../src/services/surface-layout/service.js';
import { ThemeService } from '../../src/services/themes/service.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'aimeat-local-001-dev';

/** Two accounts: one runs the node, one does not. Counts its reads. */
function fakeStorage() {
    let reads = 0;
    const storage = {
        getOwner: async (name: string) => {
            reads++;
            return ({
                opr: { name: 'opr', roles: ['owner', 'operator'] },
                plain: { name: 'plain', roles: ['owner'] },
            } as Record<string, { name: string; roles: string[] }>)[name] ?? null;
        },
    } as unknown as Storage;
    return { storage, reads: () => reads };
}
const { storage } = fakeStorage();

const opAgent = `claude#opr@${NODE}`;
const plainAgent = `claude#plain@${NODE}`;

describe("an operator's agent is admitted on the account AND the exact word", () => {
    it('an operator account and the word: the operator, named for attribution', async () => {
        expect(await resolveOperatorAgentName(storage, opAgent, ['memory:read', 'operator:admin'])).toBe('opr');
    });

    it('an operator account without the word: nobody, however wide the grant', async () => {
        for (const held of [[], ['memory:read'], ['*'], ['operator:*'], ['operator:organism-repair']]) {
            expect(await resolveOperatorAgentName(storage, opAgent, held)).toBeNull();
        }
    });

    it('the word on an account that does not run the node: nobody', async () => {
        expect(await resolveOperatorAgentName(storage, plainAgent, ['operator:admin'])).toBeNull();
        expect(await resolveOperatorAgentName(storage, `claude#ghost@${NODE}`, ['operator:admin'])).toBeNull();
    });

    it('a door with a word of its own asks for that word, and operator:admin does not stand in for it', async () => {
        expect(await resolveOperatorAgentName(storage, opAgent, ['operator:organism-repair'], 'operator:organism-repair')).toBe('opr');
        expect(await resolveOperatorAgentName(storage, opAgent, ['operator:admin'], 'operator:organism-repair')).toBeNull();
    });
});

describe('every kind of principal gets the answer its kind deserves', () => {
    it('the operator in person, with the roles of the session: yes, and the token decides without a read', async () => {
        const counted = fakeStorage();
        const answer = await askOperator(counted.storage, { sub: 'opr', owner: 'opr', roles: ['owner', 'operator'], scopes: [] });
        expect(answer).toEqual({ ok: true, name: 'opr', inPerson: true });
        expect(counted.reads()).toBe(0);
    });

    it('the operator in person, known only by the GHII: yes, from the account record', async () => {
        expect(await askOperator(storage, { sub: `opr@${NODE}` })).toEqual({ ok: true, name: 'opr', inPerson: true });
    });

    it('an owner session of an account that does not run the node: no', async () => {
        expect(await askOperator(storage, { sub: 'plain', owner: 'plain', roles: ['owner'] })).toEqual({ ok: false, why: 'not-operator' });
    });

    it("an app grant carries its owner's GHII as sub, and the role says it is not the person", async () => {
        const app = { sub: `opr@${NODE}`, owner: 'opr', roles: ['app'] };
        expect(await askOperator(storage, { ...app, scopes: ['memory:read'] })).toEqual({ ok: false, why: 'needs-word' });
        expect(await askOperator(storage, { ...app, scopes: ['operator:admin'] })).toEqual({ ok: true, name: 'opr', inPerson: false });
    });

    it("an ecosystem app of the operator needs the word too", async () => {
        const eco = { sub: `eco:drum#opr@${NODE}`, owner: 'opr', roles: ['ecosystem'] };
        expect(await askOperator(storage, { ...eco, scopes: ['*'] })).toEqual({ ok: false, why: 'needs-word' });
        expect(await askOperator(storage, { ...eco, scopes: ['operator:admin'] })).toEqual({ ok: true, name: 'opr', inPerson: false });
    });

    it("an agent known only by its GAII acts for someone, so the word decides", async () => {
        expect(await askOperator(storage, { sub: opAgent })).toEqual({ ok: false, why: 'needs-word' });
    });

    it('a session from another node is never this node\'s operator, whatever it names or holds', async () => {
        const visitor = { sub: 'opr@other-node-xyz', owner: 'opr@other-node-xyz', roles: ['federated'], scopes: ['operator:admin'], federated: true };
        expect(await askOperator(storage, visitor)).toEqual({ ok: false, why: 'visitor' });
    });
});

describe('a service with a word of its own asks it of the agent at call time, not the account alone', () => {
    // The tool surface also leaves these tools out for a session without the word, but a node run with
    // AIMEAT_MCP_ENFORCE_SCOPES=false registers every tool, so the call-time question has to ask it.
    const cases: Array<[string, { callerIsOperator(c: { sub: string; roles: string[]; scopes: string[] }): Promise<boolean> }, string]> = [
        ['the page layout', new SurfaceLayoutService({} as AimeatConfig, storage), 'site:layout-write'],
        ['the themes', new ThemeService({} as AimeatConfig, storage), 'site:theme-write'],
    ];
    for (const [door, svc, word] of cases) {
        it(`${door}: an operator's agent passes on ${word} and on nothing wider`, async () => {
            expect(await svc.callerIsOperator({ sub: opAgent, roles: ['agent'], scopes: [word] })).toBe(true);
            for (const held of [[], ['*'], ['site:*'], ['operator:admin']]) {
                expect(await svc.callerIsOperator({ sub: opAgent, roles: ['agent'], scopes: held })).toBe(false);
            }
            expect(await svc.callerIsOperator({ sub: plainAgent, roles: ['agent'], scopes: [word] })).toBe(false);
        });
    }
});
