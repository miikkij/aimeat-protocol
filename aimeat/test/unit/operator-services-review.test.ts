/**
 * @file test/unit/operator-services-review.test.ts
 * @description The security review of operator services phase 2, over a real SQLite storage: the
 *   person cannot take a service agent's key through approveDeviceAuth (S1); the fences hold while the
 *   agent lives whatever its line's state (S4); the private read counts only while the present setting
 *   grants it, with no sweep (S5); a credential agent does not write the setting (S6); "Allow always"
 *   neither gives nor takes a service agent's words (S7); a widened entry reaches the agent at the next
 *   request (S8); the person's off survives a required entry (S9); what the person set before the entry
 *   became required is put back (S10); the operator's switch racing an approval; `operator_off` across
 *   a disable and enable.
 * @usage pnpm exec vitest run test/unit/operator-services-review.test.ts
 * @version-history
 *   v1.1.0 — 2026-11-27 — An entry's id is its service's name while the entry exists (serviceNameRefusal).
 *   v1.0.0 — 2026-11-27 — Initial (operator services review, S1 to S10).
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
import { registerSessionAuth } from '../../src/auth/node-auth.js';
import { withCurrentScopes } from '../../src/auth/effective-scopes.js';
import { OPERATOR_SERVICE_PROVISION_SCOPE, OPERATOR_ADMIN_SCOPE } from '../../src/utils/scope-coverage.js';
import { operatorServiceDecision, type ProvisionAuth } from '../../src/services/operator-services/eligibility.js';
import { approveForOperatorService } from '../../src/routes/agents/device-auth-operator-service.js';
import { approveDeviceAuth } from '../../src/routes/agents/device-auth-approve.js';
import { readLine, markRemoved } from '../../src/services/operator-services/ledger.js';
import { serviceOffForMe } from '../../src/services/operator-services/person-switch.js';
import { sweepOperatorServices } from '../../src/services/operator-services/sweep.js';
import { isOperatorServiceAgent } from '../../src/services/operator-services/agent-check.js';
import { requiredAgentRefusal } from '../../src/services/operator-services/required.js';
import { serviceKeyRefusal, serviceNameRefusal } from '../../src/services/operator-services/service-key.js';
import { privateReadHolds } from '../../src/services/operator-services/private-read.js';
import { credentialSettingRefusal } from '../../src/services/operator-services/config-write.js';
import { setServiceForAccount, type SwitchCaller } from '../../src/services/operator-services/operator-switch.js';
import { operatorServicesView } from '../../src/services/operator-services/listing.js';
import { setStandingWords, readStanding } from '../../src/services/ai-standing/settings.js';

const NODE = 'osvrev-node';
const SVC = 'desk-helper';
const OP = 'oper';
const CRED = `desk-service#${OP}@${NODE}`;
const W2 = ['memory:read', 'memory:write'];
const PR = 'memory:read-as-owner';
const REASON = 'It reads your private notes to answer the questions you send to the desk.';

let storage: Storage;
let config: AimeatConfig;
const entry = (over: Record<string, unknown> = {}) => ({
    id: SVC, display_name: 'Desk Helper', description: 'Writes a summary of each desk question for you.',
    credential_agent: 'desk-service', scopes: W2, enabled: true, ...over,
}) as AimeatConfig['operatorServices'][number];
const credAuth: ProvisionAuth = { kind: 'agent', sub: CRED, owner: OP, roles: ['agent'], scopes: [OPERATOR_SERVICE_PROVISION_SCOPE] };
const gaiiOf = (account: string) => `${SVC}#${account}@${NODE}`;
const setEntry = (over: Record<string, unknown>) => { config = { ...config, operatorServices: [entry(over)] }; registerSessionAuth(storage, config); };
const deps = () => ({ storage, config, closeMcpSessions: () => 0 });
const opInPerson = (): SwitchCaller => ({ kind: 'owner', sub: OP, owner: OP, roles: ['owner', 'operator'], scopes: [], principal: `${OP}@${NODE}` });

async function person(name: string): Promise<string> {
    const at = new Date().toISOString();
    await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, verificationLevel: 0,
        ownerName: name, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
    } as never);
    return name;
}

async function deviceRequest(account: string, requested?: string[]): Promise<DeviceAuthorizationRecord> {
    const now = new Date();
    const rec = {
        deviceCode: randomUUID(), userCode: randomUUID().slice(0, 9), ownerName: account, agentName: SVC, status: 'pending',
        requestedScopes: requested, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString(), pollInterval: 5, mode: 'interactive',
    } as DeviceAuthorizationRecord;
    await storage.createDeviceAuth(rec);
    return rec;
}

async function provision(account: string, requested?: string[], hooks: Parameters<typeof approveForOperatorService>[6] = {}) {
    const d = await operatorServiceDecision({ storage, config }, { auth: credAuth, agentName: SVC, ownerName: account, requested });
    if (d.kind !== 'approve') return { decision: d, outcome: null };
    return { decision: d, outcome: await approveForOperatorService(config, storage, d, await deviceRequest(account, requested), CRED, undefined, hooks) };
}

beforeAll(async () => {
    setThisNodeId(NODE);
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
});

beforeEach(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test', maxAgentScopes: ['*'], operatorServices: [entry()] };
    registerSessionAuth(storage, config);
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

describe('S1: approveDeviceAuth rotates a service agent\'s key only on the operator-service branch', () => {
    it('the owner\'s approval of a request for the service\'s name is refused; the key and the proof stay', async () => {
        const alice = await person('alice');
        await provision(alice);
        const before = await storage.getAgent(gaiiOf(alice));
        const out = await approveDeviceAuth(config, storage, await deviceRequest(alice, ['memory:read']), alice, ['memory:read'], undefined, true);
        expect(out).toMatchObject({ ok: false, status: 403, code: 'OPERATOR_SERVICE_KEY' });
        expect((await storage.getAgent(gaiiOf(alice)))?.publicKey).toBe(before?.publicKey);
        expect(await isOperatorServiceAgent(storage, config, gaiiOf(alice))).toBe(true);
        // The service's own reconnect still works.
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
    });
});

describe('an entry\'s id is its service\'s name while the entry exists', () => {
    it('a stored request for a NEW agent under it is not approved; a disabled entry still holds the name; no entry frees it', async () => {
        const kim = await person('kim');
        const out = await approveDeviceAuth(config, storage, await deviceRequest(kim, ['memory:read']), kim, ['memory:read'], undefined, true);
        expect(out).toMatchObject({ ok: false, status: 403, code: 'OPERATOR_SERVICE_KEY' });
        expect(await storage.getAgent(gaiiOf(kim))).toBeNull();
        expect(serviceNameRefusal(config, SVC)?.message).toMatch(/belongs to the operator service Desk Helper/);
        setEntry({ enabled: false });
        expect(serviceNameRefusal(config, SVC)).toMatchObject({ code: 'OPERATOR_SERVICE_KEY' });
        config = { ...config, operatorServices: [] };
        expect(serviceNameRefusal(config, SVC)).toBeNull();
    });
});

describe('S4: the fences hold while the agent lives, whatever its line says', () => {
    it('a removed line whose agent is still alive: still the service\'s, still fenced, and the sweep ends it', async () => {
        const bob = await person('bob');
        await provision(bob);
        // The person's off written, its end not yet run (the order the switch takes).
        await markRemoved(storage, NODE, SVC, bob, gaiiOf(bob));
        expect(await isOperatorServiceAgent(storage, config, gaiiOf(bob))).toBe(true);
        expect(await serviceKeyRefusal(storage, config, gaiiOf(bob), 'rotating its key')).toMatchObject({ code: 'OPERATOR_SERVICE_KEY' });
        setEntry({ required: true });
        expect(await requiredAgentRefusal(storage, config, gaiiOf(bob), 'stopping it')).toMatchObject({ code: 'OPERATOR_SERVICE_REQUIRED' });
        setEntry({ required: false });
        await sweepOperatorServices(deps());
        expect(await storage.getAgent(gaiiOf(bob))).toBeNull();
        expect((await readLine(storage, NODE, SVC, bob))?.state).toBe('removed');
    });
});

describe('S5: the private read counts only while the present setting grants it', () => {
    it('the entry drops the word, no sweep runs, and the old token reads as an agent without it', async () => {
        const carol = await person('carol');
        setEntry({ scopes: [...W2, PR], private_read_reason: REASON });
        await provision(carol);
        const agent = (await storage.getAgent(gaiiOf(carol)))!;
        const token = { sub: agent.gaii, owner: carol, node: NODE, roles: ['agent'], exp: Date.now() / 1000 + 3600, scopes: [...agent.defaultScopes!] };
        expect((await withCurrentScopes(storage, token)).scopes).toContain(PR);
        setEntry({ scopes: W2 });
        expect((await storage.getAgent(gaiiOf(carol)))?.defaultScopes).toContain(PR);   // no sweep ran
        expect(await privateReadHolds(storage, config, agent)).toBe(false);
        expect((await withCurrentScopes(storage, token)).scopes).not.toContain(PR);
        // Back in the setting: granted again. The operator's switch and the audience take it too.
        setEntry({ scopes: [...W2, PR], private_read_reason: REASON });
        expect((await withCurrentScopes(storage, token)).scopes).toContain(PR);
        setEntry({ scopes: [...W2, PR], private_read_reason: REASON, audience: { accounts: ['someone-else'] } });
        expect(await privateReadHolds(storage, config, agent)).toBe(false);
    });
});

describe('S6: a credential agent does not write the setting', () => {
    it('refuses the stored credential and one being written; another operator agent and the operator pass', () => {
        const changes = (value: unknown) => ({ changes: [{ path: 'agents.operator_services', value }] });
        expect(credentialSettingRefusal(config, { sub: CRED, roles: ['agent'] }, changes([entry({ scopes: [...W2, 'task:write'] })]))).toMatchObject({ status: 403 });
        expect(credentialSettingRefusal(config, { sub: `new-cred#${OP}@${NODE}`, roles: ['agent'] }, changes([entry({ credential_agent: 'new-cred' })]))).toMatchObject({ status: 403 });
        expect(credentialSettingRefusal(config, { sub: CRED, roles: ['agent'] }, { path: 'agents.operator_services' })).toMatchObject({ status: 403 });
        expect(credentialSettingRefusal(config, { sub: `op-admin#${OP}@${NODE}`, roles: ['agent'] }, changes([entry()]))).toBeNull();
        expect(credentialSettingRefusal(config, { sub: OP, roles: ['owner', 'operator'] }, changes([entry()]))).toBeNull();
        expect(credentialSettingRefusal(config, { sub: CRED, roles: ['agent'] }, { changes: [{ path: 'scopes.max_agent_scopes', value: ['*'] }] })).toBeNull();
    });
});

describe('S7: "Allow always" neither gives nor takes a service agent\'s words', () => {
    it('an entry word stays when the setting drops it, and a setting word is not given', async () => {
        const dana = await person('dana');
        await setStandingWords({ storage, config }, `${dana}@${NODE}`, ['task:write'], `${dana}@${NODE}`);
        setEntry({ scopes: [...W2, 'task:write'] });
        await provision(dana, ['memory:read']);
        expect((await storage.getAgent(gaiiOf(dana)))?.defaultScopes).not.toContain('task:write');
        expect((await readStanding(storage, `${dana}@${NODE}`)).given[gaiiOf(dana)]).toBeUndefined();
        await provision(dana);
        expect((await storage.getAgent(gaiiOf(dana)))?.defaultScopes).toContain('task:write');
        await setStandingWords({ storage, config }, `${dana}@${NODE}`, [], `${dana}@${NODE}`);
        expect((await storage.getAgent(gaiiOf(dana)))?.defaultScopes).toContain('task:write');
    });
});

describe('S8: a widened entry reaches the agent at the next request', () => {
    it('the new word is given, recorded as given, and taken back when the entry narrows', async () => {
        const erin = await person('erin');
        await provision(erin);
        setEntry({ scopes: [...W2, 'storage:read'] });
        await provision(erin);
        expect((await storage.getAgent(gaiiOf(erin)))?.defaultScopes).toContain('storage:read');
        expect((await readLine(storage, NODE, SVC, erin))?.given).toContain('storage:read');
        setEntry({ scopes: W2 });
        await provision(erin);
        expect((await storage.getAgent(gaiiOf(erin)))?.defaultScopes).not.toContain('storage:read');
    });
});

describe('S9: the person\'s off survives a required entry', () => {
    it('off before required, back while required, off again once it is not', async () => {
        const finn = await person('finn');
        await provision(finn);
        await serviceOffForMe(deps(), finn, SVC);
        setEntry({ required: true });
        expect((await provision(finn)).outcome).toMatchObject({ ok: true });
        expect(await readLine(storage, NODE, SVC, finn)).toMatchObject({ state: 'active', person_off: {} });
        setEntry({ required: false });
        await sweepOperatorServices(deps());
        expect(await storage.getAgent(gaiiOf(finn))).toBeNull();
        expect((await readLine(storage, NODE, SVC, finn))?.state).toBe('removed');
        const view = await operatorServicesView({ storage, config }, { kind: 'owner', sub: finn, owner: finn, roles: ['owner'], scopes: [] });
        expect(view.ok && view.data.services[0]).toMatchObject({ state: 'removed' });
        expect((await provision(finn)).outcome).toBeNull();
    });
});

describe('S10: what the person set before the entry became required is put back', () => {
    it('started, clearance and budget limits as the approval set them; purpose stays', async () => {
        const gina = await person('gina');
        await provision(gina);
        const gaii = gaiiOf(gina);
        await storage.updateAgent(gaii, { stoppedAt: new Date().toISOString(), stoppedBy: `${gina}@${NODE}`, clearance: 'julkinen' } as never);
        await storage.upsertAgentDirectives({ agentGaii: gaii, purpose: 'Answer in Finnish.', rules: [], memoryAreas: [], resources: [],
            budgetLimits: { maxTasksPerDay: 1 } as never, updatedAt: new Date().toISOString() });
        setEntry({ required: true });
        await sweepOperatorServices(deps());
        const a = await storage.getAgent(gaii);
        expect(a?.stoppedAt ?? null).toBeNull();
        // The node's default for a new agent (none on this node: no limit), as the approval set it.
        expect(a?.clearance ?? null).toBe(config.agentClearanceDefault || null);
        const dir = await storage.getAgentDirectives(gaii);
        expect(dir?.budgetLimits).toBeUndefined();
        expect(dir?.purpose).toBe('Answer in Finnish.');
    });
});

describe('the operator\'s switch and the ledger', () => {
    it('a switch that lands during an approval: the approval rolls back and answers NOT_APPROVED', async () => {
        const hana = await person('hana');
        const r = await provision(hana, undefined, {
            afterApprove: async () => { await setServiceForAccount(deps(), opInPerson(), SVC, hana, { on: false }); },
        });
        expect(r.outcome).toMatchObject({ ok: false, code: 'NOT_APPROVED' });
        expect(await storage.getAgent(gaiiOf(hana))).toBeNull();
        expect((await readLine(storage, NODE, SVC, hana))?.operator_off).toBeDefined();
    });

    it('operator_off survives the entry switched off and on again', async () => {
        const ivan = await person('ivan');
        await provision(ivan);
        await setServiceForAccount(deps(), opInPerson(), SVC, ivan, { on: false });
        setEntry({ enabled: false });
        await sweepOperatorServices(deps());
        setEntry({ enabled: true });
        await sweepOperatorServices(deps());
        expect((await readLine(storage, NODE, SVC, ivan))?.operator_off).toBeDefined();
        expect((await provision(ivan)).outcome).toBeNull();
        const asCred: SwitchCaller = { kind: 'agent', sub: CRED, owner: OP, roles: ['agent'], scopes: [OPERATOR_ADMIN_SCOPE], principal: CRED };
        expect(await setServiceForAccount(deps(), asCred, SVC, ivan, { on: true })).toMatchObject({ ok: false, status: 403 });
    });
});
