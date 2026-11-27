/**
 * @file test/unit/operator-services-phase2.test.ts
 * @description Operator services, phase 2, over the pure rules and a real SQLite storage: the new
 *   entry fields (audience, required, private_read_reason, how_to_help), the private-read exception
 *   (memory:read-as-owner only with its reason, given and taken back with the entry), a required
 *   service's agent (the person's controls refused with OPERATOR_SERVICE_REQUIRED at the shared
 *   functions, the agent itself and the person's own additions not), a person's earlier off overridden
 *   by required with the notice that says so, the operator's per-account switch (operator_off, distinct
 *   from removed), and the audience in the decision and the sweep. The E2E suite
 *   e2e-operator-service-agents.ts holds the same rules over HTTP.
 * @usage pnpm exec vitest run test/unit/operator-services-phase2.test.ts
 * @version-history
 *   v1.2.0 — 2026-11-27 — The account refusals carry `own` (B1).
 *   v1.1.0 — 2026-11-26 — serviceKeyRefusal: the key of every service agent is the service's (K1).
 *   v1.0.0 — 2026-11-26 — Initial (operator services phase 2).
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
import { OPERATOR_SERVICE_PROVISION_SCOPE, OPERATOR_ADMIN_SCOPE } from '../../src/utils/scope-coverage.js';
import { operatorServiceProblem } from '../../src/config/operator-services.js';
import { entryNow } from '../../src/services/operator-services/entries.js';
import { decideProvision, operatorServiceDecision, ACCOUNT_NOTE, type ProvisionAuth, type ProvisionFacts } from '../../src/services/operator-services/eligibility.js';
import { approveForOperatorService } from '../../src/routes/agents/device-auth-operator-service.js';
import { readLine } from '../../src/services/operator-services/ledger.js';
import { serviceOffForMe, serviceOnForMe } from '../../src/services/operator-services/person-switch.js';
import { sweepOperatorServices } from '../../src/services/operator-services/sweep.js';
import { requiredAgentRefusal, requiredScopeRefusal } from '../../src/services/operator-services/required.js';
import { serviceKeyRefusal } from '../../src/services/operator-services/service-key.js';
import { setServiceForAccount, type SwitchCaller } from '../../src/services/operator-services/operator-switch.js';
import { operatorServiceMarks } from '../../src/services/operator-services/marks.js';
import { operatorServicesView, operatorServiceAccounts } from '../../src/services/operator-services/listing.js';
import { removeAgent } from '../../src/services/agents/remove-agent.js';
import { setAgentStopped } from '../../src/services/agent/stop.js';
import { setAgentMode, setAgentRunMode } from '../../src/services/agent/profile-write.js';
import { setAgentTaskStart } from '../../src/services/agent/task-start-write.js';

const NODE = 'osvp2-node';
const SVC = 'desk-helper';
const OP = 'oper';
const CRED = `desk-service#${OP}@${NODE}`;
const W2 = ['memory:read', 'memory:write'];
const REASON = 'It reads your private notes to answer the questions you send to the desk.';

let storage: Storage;
let config: AimeatConfig;
const entry = (over: Record<string, unknown> = {}) => ({
    id: SVC, display_name: 'Desk Helper', description: 'Writes a summary of each desk question for you.',
    credential_agent: 'desk-service', scopes: W2, enabled: true, ...over,
}) as AimeatConfig['operatorServices'][number];
const credAuth: ProvisionAuth = { kind: 'agent', sub: CRED, owner: OP, roles: ['agent'], scopes: [OPERATOR_SERVICE_PROVISION_SCOPE, 'memory:read'] };
const gaiiOf = (account: string) => `${SVC}#${account}@${NODE}`;
const setEntry = (over: Record<string, unknown>) => { config = { ...config, operatorServices: [entry(over)] }; };

async function person(name: string): Promise<string> {
    const at = new Date().toISOString();
    await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    await storage.createGHII({
        username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name, verificationLevel: 0,
        ownerName: name, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
    } as never);
    return name;
}

async function provision(account: string, requested?: string[]) {
    const d = await operatorServiceDecision({ storage, config }, { auth: credAuth, agentName: SVC, ownerName: account, requested });
    if (d.kind !== 'approve') return { decision: d, outcome: null };
    const now = new Date();
    const rec = {
        deviceCode: randomUUID(), userCode: randomUUID().slice(0, 9), ownerName: account, agentName: SVC, status: 'pending',
        requestedScopes: requested, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString(), pollInterval: 5, mode: 'interactive',
    } as DeviceAuthorizationRecord;
    await storage.createDeviceAuth(rec);
    return { decision: d, outcome: await approveForOperatorService(config, storage, d, rec, CRED, undefined) };
}

const deps = () => ({ storage, config, closeMcpSessions: () => 0 });
const opInPerson = (): SwitchCaller => ({ kind: 'owner', sub: OP, owner: OP, roles: ['owner', 'operator'], scopes: [], principal: `${OP}@${NODE}` });
const notices = async (account: string) => (await storage.listMemory(`${account}@${NODE}`, { prefix: 'notif.' }))
    .map((m) => m.value as { type?: string; body?: string; i18n?: { key: string; vars: Record<string, string> } });

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

describe('the entry fields', () => {
    const ok = (over: Record<string, unknown>) => operatorServiceProblem([entry(over)]);
    it('audience: "all" or a list of 1 to 500 local account names, nothing else', () => {
        expect(ok({ audience: 'all' })).toBeNull();
        expect(ok({ audience: { accounts: ['alice', 'bob-2'] } })).toBeNull();
        expect(ok({ audience: { accounts: [] } })).toMatch(/\[0\]\.audience/);
        expect(ok({ audience: { accounts: Array.from({ length: 501 }, (_, i) => `user${i}x`) } })).toMatch(/\[0\]\.audience/);
        expect(ok({ audience: { accounts: ['Alice'] } })).toMatch(/\[0\]\.audience/);
        expect(ok({ audience: { accounts: ['alice'], extra: 1 } })).toMatch(/\[0\]\.audience/);
        expect(ok({ audience: 'some' })).toMatch(/\[0\]\.audience/);
    });
    it('required is a boolean', () => {
        expect(ok({ required: true })).toBeNull();
        expect(ok({ required: 'yes' })).toMatch(/\[0\]\.required/);
    });
    it('private_read_reason goes with memory:read-as-owner and only with it, 20 to 300 characters', () => {
        expect(ok({ scopes: [...W2, 'memory:read-as-owner'], private_read_reason: REASON })).toBeNull();
        expect(ok({ scopes: [...W2, 'memory:read-as-owner'] })).toMatch(/private_read_reason is required/);
        expect(ok({ scopes: [...W2, 'memory:read-as-owner'], private_read_reason: 'Too short.' })).toMatch(/private_read_reason is text of 20 to 300/);
        expect(ok({ private_read_reason: REASON })).toMatch(/belongs only to an entry whose scopes name memory:read-as-owner/);
    });
    it('how_to_help is optional, 20 to 300 characters', () => {
        expect(ok({ how_to_help: 'Send it the question with the ticket number in the subject.' })).toBeNull();
        expect(ok({ how_to_help: 'Short.' })).toMatch(/how_to_help/);
        expect(ok({ how_to_help: 'x'.repeat(301) })).toMatch(/how_to_help/);
    });
});

describe('the private-read exception in the running entry', () => {
    const cfg = { maxAgentScopes: ['*'], defaultAgentScopes: W2 };
    it('passes memory:read-as-owner with its reason, and no other outside-wildcard word', () => {
        expect(entryNow(cfg, entry({ scopes: [...W2, 'memory:read-as-owner'], private_read_reason: REASON }) as never).allowedScopes).toContain('memory:read-as-owner');
        // A running value written past the static check: the word without its reason is not granted.
        expect(entryNow(cfg, entry({ scopes: [...W2, 'memory:read-as-owner'] }) as never).allowedScopes).not.toContain('memory:read-as-owner');
        expect(entryNow(cfg, entry({ scopes: [...W2, 'consent:read-as-owner'] }) as never).allowedScopes).not.toContain('consent:read-as-owner');
    });
});

describe('the decision reads the audience, the operator\'s switch and required', () => {
    const usable = (over: Record<string, unknown> = {}) => entryNow({ maxAgentScopes: ['*'], defaultAgentScopes: W2 }, entry(over) as never);
    const good = (over: Partial<ProvisionFacts> = {}, e = usable()): ProvisionFacts => ({
        callerIsAgent: true, callerIsServiceAgent: false, operator: { ok: true, name: 'op', inPerson: false }, callerAgentName: 'desk-service',
        agentName: SVC, entries: [e], requested: ['memory:read'], ownerActive: true, line: null, existingGaii: null,
        madeByService: false, busy: false, account: 'alice', ...over,
    });
    const removed = { gaii: gaiiOf('alice'), at: 't', state: 'removed' as const, removed_at: 't' };
    it('outside the audience, and with no account against a list, the one sentence', () => {
        const listed = usable({ audience: { accounts: ['bob1'] } });
        expect(decideProvision(good({}, listed))).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        expect(decideProvision(good({ account: undefined }, listed))).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        expect(decideProvision(good({ account: 'bob1' }, listed)).kind).toBe('approve');
    });
    it('the operator\'s switch holds, required or not', () => {
        const offLine = { gaii: gaiiOf('alice'), at: 't', state: 'ended' as const, operator_off: { at: 't', by: `${OP}@${NODE}` } };
        expect(decideProvision(good({ line: offLine }))).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        expect(decideProvision(good({ line: offLine }, usable({ required: true })))).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
    });
    it('a person\'s off holds, unless the entry is required now', () => {
        expect(decideProvision(good({ line: removed }))).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        const d = decideProvision(good({ line: removed }, usable({ required: true })));
        expect(d.kind === 'approve' && d.requiredNow).toBe(true);
    });
});

describe('a required service\'s agent', () => {
    it('refuses the person\'s off, removal, stop, mode, run mode, task start and the entry\'s words; the agent itself and additions pass', async () => {
        const alice = await person('alice');
        expect((await provision(alice)).outcome).toMatchObject({ ok: true });
        setEntry({ required: true });
        const gaii = gaiiOf(alice);
        const ghii = `${alice}@${NODE}`;

        expect(await serviceOffForMe(deps(), alice, SVC)).toMatchObject({ ok: false, status: 403, code: 'OPERATOR_SERVICE_REQUIRED' });
        const removal = await removeAgent(deps(), { owner: alice, principal: alice, ownerInPerson: true }, SVC);
        expect(removal).toMatchObject({ ok: false, status: 403, code: 'OPERATOR_SERVICE_REQUIRED' });
        expect(removal.ok === false && removal.message).toMatch(/support@operators/);
        expect(await setAgentStopped({ storage, config }, alice, ghii, SVC, true)).toMatchObject({ ok: false, code: 'OPERATOR_SERVICE_REQUIRED' });
        expect(await setAgentMode({ storage, config }, alice, SVC, 'autonomous', ghii)).toMatchObject({ ok: false, code: 'OPERATOR_SERVICE_REQUIRED' });
        expect(await setAgentRunMode({ storage, config }, alice, SVC, 'spawn', ghii)).toMatchObject({ ok: false, code: 'OPERATOR_SERVICE_REQUIRED' });
        expect(await setAgentTaskStart({ storage, config }, alice, ghii, SVC, 'confirm')).toMatchObject({ ok: false, code: 'OPERATOR_SERVICE_REQUIRED' });
        expect(await requiredScopeRefusal(storage, config, gaii, ['memory:read'])).toMatchObject({ code: 'OPERATOR_SERVICE_REQUIRED' });
        // The person's own addition, and taking it back again, keep the entry's words: not refused.
        expect(await requiredScopeRefusal(storage, config, gaii, [...W2, 'storage:read'])).toBeNull();
        expect(await requiredScopeRefusal(storage, config, gaii, W2)).toBeNull();
        // The agent itself still sets its own mode, and a start stays open.
        expect(await setAgentMode({ storage, config }, alice, SVC, 'task-runner', gaii)).toMatchObject({ ok: true });
        expect(await setAgentStopped({ storage, config }, alice, ghii, SVC, false)).toMatchObject({ ok: true });
        expect(await storage.getAgent(gaii)).not.toBeNull();

        // Back to not required: the controls return at once, with no restart and no sweep.
        setEntry({ required: false });
        expect(await requiredAgentRefusal(storage, config, gaii, 'stopping it')).toBeNull();
        expect(await setAgentStopped({ storage, config }, alice, ghii, SVC, true)).toMatchObject({ ok: true, changed: true });
        expect(await serviceOffForMe(deps(), alice, SVC)).toMatchObject({ ok: true });
        expect(await storage.getAgent(gaii)).toBeNull();
    });

    it('the key is the service\'s for every service agent, required or not; a person\'s own agent is not fenced', async () => {
        const ivy = await person('ivy');
        await provision(ivy);
        const plain = await serviceKeyRefusal(storage, config, gaiiOf(ivy), 'rotating its key');
        expect(plain).toMatchObject({ ok: false, status: 403, code: 'OPERATOR_SERVICE_KEY' });
        expect(plain?.message).toMatch(/remove the agent/);
        setEntry({ required: true });
        expect((await serviceKeyRefusal(storage, config, gaiiOf(ivy), 'rotating its key'))?.message).toMatch(/requires Desk Helper/);
        await storage.createAgent({
            name: 'ivy-own', owner: ivy, gaii: `ivy-own#${ivy}@${NODE}`, publicKey: 'pk-own', trustScore: 50, morselBalance: 0,
            capabilities: [], defaultScopes: W2, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), registeredBy: ivy,
        } as never);
        expect(await serviceKeyRefusal(storage, config, `ivy-own#${ivy}@${NODE}`, 'rotating its key')).toBeNull();
    });

    it('a person\'s own agent under the service\'s name is not fenced', async () => {
        const bob = await person('bob');
        setEntry({ required: true });
        const keys = await generateKeyPair();
        await storage.createAgent({
            name: SVC, owner: bob, gaii: gaiiOf(bob), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0,
            capabilities: [], defaultScopes: W2, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), registeredBy: bob,
        } as never);
        expect(await requiredAgentRefusal(storage, config, gaiiOf(bob), 'removing it')).toBeNull();
        expect(await removeAgent(deps(), { owner: bob, principal: bob, ownerInPerson: true }, SVC)).toMatchObject({ ok: true });
    });

    it('a person who turned it off gets it again at the next request, told it is required now', async () => {
        const carol = await person('carol');
        await provision(carol);
        expect(await serviceOffForMe(deps(), carol, SVC)).toMatchObject({ ok: true });
        expect((await provision(carol)).decision).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        setEntry({ required: true, how_to_help: 'Send it the question with the ticket number in the subject.' });
        const again = await provision(carol);
        expect(again.outcome).toMatchObject({ ok: true });
        expect((await readLine(storage, NODE, SVC, carol))?.state).toBe('active');
        const told = (await notices(carol)).find((n) => n.type === 'operator_service_required');
        expect(told?.i18n?.vars).toMatchObject({ service: 'Desk Helper', required: 'true', how_to_help: 'Send it the question with the ticket number in the subject.' });
        expect(told?.body).toMatch(/only the operator can turn it off/);
    });
});

describe('the private read', () => {
    it('is given by the entry, shown on the mark, named in the notice, and taken back with the entry', async () => {
        const dana = await person('dana');
        setEntry({ scopes: [...W2, 'memory:read-as-owner'], private_read_reason: REASON });
        expect((await provision(dana)).outcome).toMatchObject({ ok: true });
        const agent = await storage.getAgent(gaiiOf(dana));
        expect(agent?.defaultScopes).toContain('memory:read-as-owner');
        expect((await readLine(storage, NODE, SVC, dana))?.given).toContain('memory:read-as-owner');
        const mark = (await operatorServiceMarks(storage, config, dana, [agent!])).get(gaiiOf(dana));
        expect(mark).toMatchObject({ private_read: true, private_read_reason: REASON, required: false });
        const first = (await notices(dana)).find((n) => n.type === 'operator_service_on');
        expect(first?.i18n?.vars).toMatchObject({ private_read_reason: REASON, required: 'false' });
        expect(first?.i18n?.vars.private_read).toMatch(/private records/);

        setEntry({ scopes: W2 });
        await sweepOperatorServices(deps());
        expect((await storage.getAgent(gaiiOf(dana)))?.defaultScopes).not.toContain('memory:read-as-owner');
        const after = (await operatorServiceMarks(storage, config, dana, [(await storage.getAgent(gaiiOf(dana)))!])).get(gaiiOf(dana));
        expect(after?.private_read).toBe(false);
    });
});

describe('the operator\'s switch for one account', () => {
    it('ends the agent, holds against a request, refuses the credential, and on takes only its own flag back', async () => {
        const erin = await person('erin');
        await provision(erin);
        const off = await setServiceForAccount(deps(), opInPerson(), SVC, erin, { on: false, reason: 'Erin is on leave until spring.' });
        expect(off).toMatchObject({ ok: true, data: { changed: true, agent_ended: true } });
        expect(await storage.getAgent(gaiiOf(erin))).toBeNull();
        const line = await readLine(storage, NODE, SVC, erin);
        expect(line?.state).toBe('ended');
        expect(line?.operator_off).toMatchObject({ by: `${OP}@${NODE}`, reason: 'Erin is on leave until spring.' });
        expect((await provision(erin)).decision).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        // Required does not get past the operator's own switch.
        setEntry({ required: true });
        expect((await provision(erin)).decision).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });

        const asCred: SwitchCaller = { kind: 'agent', sub: CRED, owner: OP, roles: ['agent'], scopes: [OPERATOR_ADMIN_SCOPE, OPERATOR_SERVICE_PROVISION_SCOPE], principal: CRED };
        expect(await setServiceForAccount(deps(), asCred, SVC, erin, { on: true })).toMatchObject({ ok: false, status: 403 });
        const asPerson: SwitchCaller = { kind: 'owner', sub: erin, owner: erin, roles: ['owner'], scopes: [], principal: `${erin}@${NODE}` };
        expect(await setServiceForAccount(deps(), asPerson, SVC, erin, { on: true })).toMatchObject({ ok: false, status: 403 });
        expect(await setServiceForAccount(deps(), opInPerson(), SVC, erin, { on: 'yes' })).toMatchObject({ ok: false, status: 400 });
        expect(await setServiceForAccount(deps(), opInPerson(), SVC, 'nobody-here', { on: true })).toMatchObject({ ok: false, status: 404 });

        expect(await setServiceForAccount(deps(), opInPerson(), SVC, erin, { on: true })).toMatchObject({ ok: true, data: { changed: true } });
        expect((await readLine(storage, NODE, SVC, erin))?.operator_off).toBeUndefined();
        expect((await provision(erin)).outcome).toMatchObject({ ok: true });
    });

    it('is distinct from the person\'s off: neither clears the other', async () => {
        setEntry({ required: false });
        const finn = await person('finn');
        await provision(finn);
        await serviceOffForMe(deps(), finn, SVC);
        await setServiceForAccount(deps(), opInPerson(), SVC, finn, { on: false });
        expect(await readLine(storage, NODE, SVC, finn)).toMatchObject({ state: 'removed', operator_off: { by: `${OP}@${NODE}` } });
        // The person turning it on keeps the operator's switch; the operator's on keeps the person's off.
        await serviceOnForMe(deps(), finn, SVC);
        expect(await readLine(storage, NODE, SVC, finn)).toMatchObject({ state: 'ended', operator_off: { by: `${OP}@${NODE}` } });
        await serviceOffForMe(deps(), finn, SVC);
        await setServiceForAccount(deps(), opInPerson(), SVC, finn, { on: true });
        const line = await readLine(storage, NODE, SVC, finn);
        expect(line?.state).toBe('removed');
        expect(line?.operator_off).toBeUndefined();
    });
});

describe('the audience', () => {
    it('limits who gets the agent, ends an agent whose account left it, and limits the views', async () => {
        const gail = await person('gail');
        const hugo = await person('hugo');
        setEntry({ audience: { accounts: [gail] } });
        expect((await provision(hugo)).decision).toEqual({ kind: 'refused', note: ACCOUNT_NOTE, own: true });
        expect((await provision(gail)).outcome).toMatchObject({ ok: true });

        const opCaller = { kind: 'owner', sub: OP, owner: OP, roles: ['owner', 'operator'], scopes: [] };
        const accounts = await operatorServiceAccounts({ storage, config }, opCaller, SVC);
        expect(accounts.ok && accounts.data.accounts.map((a) => a.account)).toEqual([gail]);
        const view = await operatorServicesView({ storage, config }, opCaller);
        const svc = view.ok && view.data.view === 'operator' ? view.data.services[0] : null;
        expect(svc).toMatchObject({ audience: { accounts: [gail] }, required: false, counts: { covered: 1, active: 1, operator_off: 0 } });
        const hugoView = await operatorServicesView({ storage, config }, { kind: 'owner', sub: hugo, owner: hugo, roles: ['owner'], scopes: [] });
        expect(hugoView.ok && hugoView.data.services).toEqual([]);

        setEntry({ audience: { accounts: [hugo] } });
        await sweepOperatorServices(deps());
        expect(await storage.getAgent(gaiiOf(gail))).toBeNull();
        expect((await readLine(storage, NODE, SVC, gail))?.state).toBe('ended');
        // gail still sees the entry she had a line in, outside her audience, and may not turn it off.
        const gailView = await operatorServicesView({ storage, config }, { kind: 'owner', sub: gail, owner: gail, roles: ['owner'], scopes: [] });
        expect(gailView.ok && gailView.data.services[0]).toMatchObject({ in_audience: false, may_turn_off: false, state: 'pending' });
    });
});
