/**
 * @file test/unit/operator-services-flow.test.ts
 * @description The operator-service provisioning flow over a real SQLite storage, with the orders and
 *   failures a running node cannot be made to produce on demand: the completing write failing (D5), the
 *   person's off switch landing before or after the approval (D3), a line that says active while the
 *   person's own agent holds the name (D2), a re-approval after the entry dropped a word with no sweep
 *   in between (D7), the sweep's first end throwing (D4), an agent the service made asking to add
 *   permissions (D1b), the callers that are not an agent (an app grant, an ecosystem app, a visitor),
 *   erasure, the start-up sweep for an entry removed while the node was down, and the environment
 *   variable at start.
 * @usage pnpm exec vitest run test/unit/operator-services-flow.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-27 — The account refusal carries `own` (B1).
 *   v1.1.0 — 2026-11-26 — The fixture entry carries the description the setting now requires.
 *   v1.0.0 — 2026-11-26 — Initial (security review of the operator services).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, DeviceAuthorizationRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { OPERATOR_SERVICE_PROVISION_SCOPE } from '../../src/utils/scope-coverage.js';
import { operatorServiceDecision, ACCOUNT_NOTE, SERVICE_AGENT_NOTE, type ProvisionAuth } from '../../src/services/operator-services/eligibility.js';
import { approveForOperatorService } from '../../src/routes/agents/device-auth-operator-service.js';
import { readLine, reserve, complete } from '../../src/services/operator-services/ledger.js';
import { serviceOffForMe } from '../../src/services/operator-services/person-switch.js';
import { sweepOperatorServices } from '../../src/services/operator-services/sweep.js';
import { isOperatorServiceAgent } from '../../src/services/operator-services/agent-check.js';
import { checkScopeAddition } from '../../src/services/agent/scope-add.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';
import { eraseOwner } from '../../src/services/owner/erasure.js';
import { parseOperatorServicesEnv, operatorServiceProblem } from '../../src/config/operator-services.js';
import { applyStartSettings } from '../../src/config/start-check.js';
import { writeMemoryRecord } from '../../src/services/memory/write.js';
import { operatorServiceWriteRefusal } from '../../src/services/operator-services/write-fence.js';

const NODE = 'osvflow-node';
const SVC = 'desk-helper';
const OP = 'oper';
const CRED = `desk-service#${OP}@${NODE}`;
const W3 = ['memory:read', 'memory:write', 'storage:read'];

let storage: Storage;
let config: AimeatConfig;
const entry = (over: Record<string, unknown> = {}) => ({
    id: SVC, display_name: 'Desk Helper', description: 'Writes a summary of each desk question for you.',
    credential_agent: 'desk-service', scopes: W3, enabled: true, ...over,
}) as AimeatConfig['operatorServices'][number];
const credAuth: ProvisionAuth = { kind: 'agent', sub: CRED, owner: OP, roles: ['agent'], scopes: [OPERATOR_SERVICE_PROVISION_SCOPE, 'memory:read'] };
const gaiiOf = (account: string) => `${SVC}#${account}@${NODE}`;

async function person(name: string): Promise<string> {
    const at = new Date().toISOString();
    await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, verificationLevel: 0,
        ownerName: name, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
    } as never);
    return name;
}

async function ownAgent(account: string, scopes: string[]) {
    const keys = await generateKeyPair();
    const at = new Date(Date.now() + 5).toISOString();
    await storage.createAgent({
        name: SVC, owner: account, gaii: gaiiOf(account), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0,
        capabilities: [], defaultScopes: scopes, createdAt: at, lastSeen: at, registeredBy: account,
    } as never);
}

async function request(account: string, requested?: string[]): Promise<DeviceAuthorizationRecord> {
    const now = new Date();
    const rec: DeviceAuthorizationRecord = {
        deviceCode: randomUUID(), userCode: randomUUID().slice(0, 9), ownerName: account, agentName: SVC, status: 'pending',
        requestedScopes: requested, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString(), pollInterval: 5, mode: 'interactive',
    } as DeviceAuthorizationRecord;
    await storage.createDeviceAuth(rec);
    return rec;
}

/** The whole branch: the decision, then the approval with `hooks`. */
async function provision(account: string, hooks: Parameters<typeof approveForOperatorService>[6] = {}, requested?: string[]) {
    const d = await operatorServiceDecision({ storage, config }, { auth: credAuth, agentName: SVC, ownerName: account, requested });
    if (d.kind !== 'approve') return { decision: d, outcome: null };
    const rec = await request(account, requested);
    return { decision: d, outcome: await approveForOperatorService(config, storage, d, rec, CRED, undefined, hooks), rec };
}

/** Put a line back to active with a given proof (the reservation and the completion the flow writes). */
async function setActive(account: string, proof: { created_at: string; key_fp: string }, given: string[]) {
    const nonce = randomUUID();
    await reserve(storage, NODE, SVC, account, gaiiOf(account), nonce, CRED);
    await complete(storage, NODE, SVC, account, nonce, proof, given);
}

const off = (account: string) => serviceOffForMe({ storage, config, closeMcpSessions: () => 0 }, account, SVC);

beforeAll(async () => {
    setThisNodeId(NODE);
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
});

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test', maxAgentScopes: ['*'], operatorServices: [entry()] };
    const at = new Date().toISOString();
    await storage.createOwner({ name: OP, displayName: OP, publicKey: 'pk', roles: ['owner', 'operator'], createdAt: at } as never);
    await storage.createGHII({
        username: OP, nodeId: NODE, ghii: `${OP}@${NODE}`, displayName: OP, verificationLevel: 0,
        ownerName: OP, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
    } as never);
    await storage.createAgent({
        name: 'desk-service', owner: OP, gaii: CRED, publicKey: 'pk-cred', trustScore: 50, morselBalance: 0, capabilities: [],
        defaultScopes: credAuth.scopes, createdAt: at, lastSeen: at,
    } as never);
});

describe('D5: the completing write fails', () => {
    it('leaves no agent and no line, denies the row, and the next request succeeds', async () => {
        const alice = await person('alice');
        const r = await provision(alice, { complete: async () => { throw new Error('forced'); } });
        expect(r.outcome).toMatchObject({ ok: false, status: 503, code: 'RETRY' });
        expect(await storage.getAgent(gaiiOf(alice))).toBeNull();
        expect(await readLine(storage, NODE, SVC, alice)).toBeNull();
        expect((await storage.getDeviceAuthByDeviceCode(r.rec!.deviceCode))?.status).toBe('denied');
        expect(await storage.getOnboarding(gaiiOf(alice))).toBeNull();
        const again = await provision(alice);
        expect(again.outcome).toMatchObject({ ok: true });
        expect((await readLine(storage, NODE, SVC, alice))?.state).toBe('active');
    });
});

describe('D3: the off switch and an approval in either order', () => {
    it('off lands after the reservation, before the approval: no agent, the line stays removed', async () => {
        const alice = await person('alice');
        const r = await provision(alice, { afterReserve: async () => { await off(alice); } });
        expect(r.outcome).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
        expect(await storage.getAgent(gaiiOf(alice))).toBeNull();
        expect((await readLine(storage, NODE, SVC, alice))?.state).toBe('removed');
    });
    it('off lands after the approval, before the completion: the off switch removes the agent', async () => {
        const alice = await person('alice');
        let offResult: Awaited<ReturnType<typeof off>> | null = null;
        const r = await provision(alice, { afterApprove: async () => { offResult = await off(alice); } });
        expect(offResult).toMatchObject({ ok: true, data: { agent_removed: true } });
        expect(r.outcome).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
        expect(await storage.getAgent(gaiiOf(alice))).toBeNull();
        expect((await readLine(storage, NODE, SVC, alice))?.state).toBe('removed');
    });
    it('off lands after the completion: the off switch removes the agent', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        expect(await off(alice)).toMatchObject({ ok: true, data: { agent_removed: true } });
        expect(await storage.getAgent(gaiiOf(alice))).toBeNull();
    });
});

describe('D2: a line that says active while the person\'s own agent holds the name', () => {
    it('the service is refused, and the sweep and the off switch leave her agent alone', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        const serviceProof = (await readLine(storage, NODE, SVC, alice))!.proof!;
        await storage.deleteAgent(gaiiOf(alice));                 // gone without the ledger knowing
        await ownAgent(alice, ['memory:read', 'task:read']);      // her own, under the entry's id
        const mine = await storage.getAgent(gaiiOf(alice));

        const d = await operatorServiceDecision({ storage, config }, { auth: credAuth, agentName: SVC, ownerName: alice, requested: undefined });
        expect(d).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        expect((await readLine(storage, NODE, SVC, alice))?.state).toBe('ended');

        await setActive(alice, serviceProof, W3);
        await sweepOperatorServices({ storage, config: { ...config, operatorServices: [entry({ enabled: false })] } });
        expect((await storage.getAgent(gaiiOf(alice)))?.createdAt).toBe(mine!.createdAt);

        await setActive(alice, serviceProof, W3);
        expect(await off(alice)).toMatchObject({ ok: true, data: { agent_removed: false } });
        expect((await storage.getAgent(gaiiOf(alice)))?.defaultScopes).toEqual(['memory:read', 'task:read']);
        expect(await isOperatorServiceAgent(storage, config, gaiiOf(alice))).toBe(false);
    });
});

describe('D7: a re-approval after the entry dropped a word, with no sweep', () => {
    it('the dropped word is gone, the person\'s own word stays, and given is the kept set', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        const a = await storage.getAgent(gaiiOf(alice));
        await storage.updateAgent(gaiiOf(alice), { defaultScopes: [...(a!.defaultScopes ?? []), 'task:read'] });
        config = { ...config, operatorServices: [entry({ scopes: ['memory:read', 'memory:write'] })] };
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        const after = (await storage.getAgent(gaiiOf(alice)))!.defaultScopes!;
        expect([...after].sort()).toEqual(['memory:read', 'memory:write', 'task:read']);
        expect([...(await readLine(storage, NODE, SVC, alice))!.given!].sort()).toEqual(['memory:read', 'memory:write']);
    });
});

describe('D4: the sweep', () => {
    it('a first end that throws is an incident, and the next run ends every service agent', async () => {
        const alice = await person('alice');
        const bob = await person('bob');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        expect((await provision(bob)).outcome).toMatchObject({ ok: true });
        const offConfig = { ...config, operatorServices: [entry({ enabled: false })] };
        let thrown = false;
        const first = await sweepOperatorServices({ storage, config: offConfig, beforeEnd: () => { if (!thrown) { thrown = true; throw new Error('forced'); } } });
        expect(first[0].failed).toBe(1);
        // One failure did not stop the rest: the other person's agent is already ended.
        const alive = [await storage.getAgent(gaiiOf(alice)), await storage.getAgent(gaiiOf(bob))].filter(Boolean);
        expect(alive).toHaveLength(1);
        expect((await listSecurityIncidents(storage, offConfig)).items.some((i) => i.type === 'operator_service')).toBe(true);
        await sweepOperatorServices({ storage, config: offConfig });
        expect(await storage.getAgent(gaiiOf(alice))).toBeNull();
        expect(await storage.getAgent(gaiiOf(bob))).toBeNull();
        expect((await readLine(storage, NODE, SVC, alice))?.state).toBe('ended');
        expect((await readLine(storage, NODE, SVC, bob))?.state).toBe('ended');
    });
    it('the start-up sweep ends the agents of an entry removed while the node was down', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        await sweepOperatorServices({ storage, config: { ...config, operatorServices: [] } });
        expect(await storage.getAgent(gaiiOf(alice))).toBeNull();
        expect((await readLine(storage, NODE, SVC, alice))?.state).toBe('ended');
    });
    it('narrowing the node maximum narrows the agent to what still passes, and keeps the person\'s word', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        const a = await storage.getAgent(gaiiOf(alice));
        await storage.updateAgent(gaiiOf(alice), { defaultScopes: [...(a!.defaultScopes ?? []), 'task:read'] });
        await sweepOperatorServices({ storage, config: { ...config, maxAgentScopes: ['memory:read', 'task:read', 'agent:read'] } });
        expect([...(await storage.getAgent(gaiiOf(alice)))!.defaultScopes!].sort()).toEqual(['memory:read', 'task:read']);
    });
});

describe('D1b: an agent the service made is never an approver', () => {
    it('is known as the service\'s, and adds no permission to another agent', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        expect(await isOperatorServiceAgent(storage, config, gaiiOf(alice))).toBe(true);
        const target = { gaii: `helper#${alice}@${NODE}`, defaultScopes: ['memory:read'] } as never;
        const check = checkScopeAddition({ gaii: gaiiOf(alice), scopes: ['memory:read', 'memory:write', 'agent:permissions-add'], inPerson: false, operatorService: true }, target, ['memory:write']);
        expect(check).toMatchObject({ ok: false, code: 'SCOPE_ADDITION_REFUSED' });
    });
    it('is refused as an operator service\'s credential too', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        // The service's agent of the operator's own account, named as another entry's credential.
        expect((await provision(OP)).outcome).toMatchObject({ ok: true });
        config = { ...config, operatorServices: [entry(), entry({ id: 'other-svc', credential_agent: SVC })] };
        const d = await operatorServiceDecision({ storage, config }, {
            auth: { kind: 'agent', sub: gaiiOf(OP), owner: OP, roles: ['agent'], scopes: [OPERATOR_SERVICE_PROVISION_SCOPE] },
            agentName: 'other-svc', ownerName: alice, requested: undefined,
        });
        expect(d).toEqual({ kind: 'refused', note: SERVICE_AGENT_NOTE });
    });
});

describe('F2: the fence on writes as the person', () => {
    it('the service\'s agent writes as the person only under the present prefixes; the person\'s own agent is not fenced', async () => {
        const alice = await person('alice');
        const W = [...W3, 'memory:write-as-owner'];
        config = { ...config, operatorServices: [entry({ scopes: W, write_prefixes: ['desk-helper.'] })] };
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        const svc = gaiiOf(alice);
        const as = (key: string) => writeMemoryRecord({ storage, config }, {
            principal: svc, targetGaii: `${alice}@${NODE}`, roles: ['agent'], scopes: W,
        }, { key, value: { n: 1 }, visibility: 'private', pipeline: 'test' });
        expect(await as('desk-helper.note')).toMatchObject({ ok: true });
        expect(await as('diary.secret')).toMatchObject({ ok: false, status: 403, code: 'OPERATOR_SERVICE_PREFIX' });
        // The person widens the service's agent: the fence is the entry's and stays.
        await storage.updateAgent(svc, { defaultScopes: [...W, 'memory:write-reserved'] });
        expect(await as('diary.secret')).toMatchObject({ ok: false, code: 'OPERATOR_SERVICE_PREFIX' });
        // Narrowing the prefixes binds at once.
        config = { ...config, operatorServices: [entry({ scopes: W, write_prefixes: ['desk-helper.inbox.'] })] };
        expect(await as('desk-helper.note2')).toMatchObject({ ok: false, code: 'OPERATOR_SERVICE_PREFIX' });
        expect(await as('desk-helper.inbox.1')).toMatchObject({ ok: true });
        // The person's own agent with the same word is not the service's.
        expect(await operatorServiceWriteRefusal(storage, config, `own-writer#${alice}@${NODE}`, 'diary.secret')).toBeNull();
    });
});

describe('callers that are not an agent', () => {
    it('an app grant, an ecosystem app and a visitor never reach the branch', async () => {
        const alice = await person('alice');
        for (const kind of ['app', 'ecosystem', 'visitor', 'owner', 'anonymous'] as const) {
            const d = await operatorServiceDecision({ storage, config }, {
                auth: { ...credAuth, kind, ...(kind === 'visitor' ? { federated: true } : {}) }, agentName: SVC, ownerName: alice, requested: undefined,
            });
            expect(d.kind, kind).toBe('not-service');
        }
        expect(await storage.getAgent(gaiiOf(alice))).toBeNull();
    });
});

describe('erasure', () => {
    it('clears the person\'s line from every ledger', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        expect(await readLine(storage, NODE, SVC, alice)).not.toBeNull();
        await eraseOwner(storage, NODE, alice, config);
        expect(await readLine(storage, NODE, SVC, alice)).toBeNull();
    });
});

describe('the setting at start', () => {
    it('a refused AIMEAT_OPERATOR_SERVICES reads as no entries, and the start check names why', () => {
        const bad = JSON.stringify([entry({ scopes: ['agent:write'] })]);
        expect(parseOperatorServicesEnv(bad)).toEqual([]);
        const env: NodeJS.ProcessEnv = { AIMEAT_OPERATOR_SERVICES: bad };
        const problems = applyStartSettings(env);
        const p = problems.find((x) => x.variable === 'AIMEAT_OPERATOR_SERVICES');
        expect(p?.takes).toMatch(/scopes\[0\]: "agent:write"/);
        expect(env.AIMEAT_OPERATOR_SERVICES).toBeUndefined();
    });
    it('the validator refuses every word that makes or changes another principal, and an unknown word', () => {
        for (const w of ['agent:write', 'agent:delete', 'consent:manage', 'organism:invite', 'receivers:read', 'packages:write']) {
            expect(operatorServiceProblem([entry({ scopes: ['memory:read', w] })]), w).toMatch(/never holds it/);
        }
        expect(operatorServiceProblem([entry({ scopes: ['memory:read', 'nothing:here'] })])).toMatch(/no permission this node knows/);
    });
});
