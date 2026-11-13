/**
 * @file test/e2e-agent-field-adds.ts
 * @description E2E for the fields an MCP tool takes because its REST route takes them (structure
 *   programme 2026-11, unit 3b).
 *
 *   THE RULE. When a route admits an agent on the same permission word the tool declares, the agent
 *   can already set a field over REST with its own token, so the tool takes the field too and hands
 *   it to the service the route calls. For one field of each tool this suite shows the tool sets it
 *   and a read returns it. A second principal is refused through the tool where the route refuses
 *   it, and a rule the service applies (a source check, a webhook policy, a template lookup) refuses
 *   through the tool as it refuses through REST.
 *
 *   HOW. Every call goes over a real session on /v1/mcp with an agent made with exactly the scopes
 *   the tool declares; every read and every REST comparison uses the route itself.
 * @structure
 *   Setup: the operator, an owner (alice) and her agents, a second owner (bob) and his agent
 *   One section per tool, in the order the fields were added
 *   Cleanup: the accounts this suite made
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-agent-field-adds
 * @version-history
 *   v1.1.0 — 2026-11-13 — federate on aimeat_board_create and aimeat_storage_upload, relation on
 *     aimeat_knowledge_links, ttl_hours on aimeat_board_post.
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 3b).
 */
import { registerOwner, setupOperator, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession, type ToolAnswer } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (path: string, token: string) => json(path, { headers: auth(token) });
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
const put = (path: string, token: string, body: unknown) => json(path, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) });
const suffix = Math.random().toString(36).slice(2, 8);

/** The code a tool refusal names, in any of the three shapes a tool answers with. */
function toolCode(r: ToolAnswer): string {
    if (typeof r.data?.code === 'string') return r.data.code;
    const m = /^([A-Z_]{3,}):/.exec(r.text);
    return m ? m[1]! : r.text.slice(0, 120);
}

console.log('\n=== MCP tools take the fields their REST routes take ===\n');

let operator!: RegisteredOwner;
let alice!: RegisteredOwner;
let bob!: RegisteredOwner;
/** One agent of alice per permission set, and a session for each. */
const agents: Record<string, { agent: McpAgent; session: McpSession }> = {};
const bobAgents: Record<string, { agent: McpAgent; session: McpSession }> = {};

async function agentOf(owner: RegisteredOwner, store: typeof agents, key: string, scopes: string[]) {
    if (!store[key]) {
        const agent = await makeAgent(BASE, owner, scopes);
        store[key] = { agent, session: await openSession(BASE, agent.token, `field-adds-${key}`) };
    }
    return store[key]!;
}

await test('Setup: the operator, an owner who is not the operator, and a second owner', async () => {
    // The first account on a node is its operator, which is exempt from some policies. Alice and bob
    // come after it, so neither is.
    operator = await setupOperator(BASE, ADMIN_PW, `fadd-op-${suffix}`);
    alice = await registerOwner(BASE, `fadd-alice-${suffix}`);
    bob = await registerOwner(BASE, `fadd-bob-${suffix}`);
    assert(alice.token && bob.token, 'both owners signed in');
});

// ─── aimeat_task_create: rules, verification, todos, resources, parent_task_id ───
console.log('\naimeat_task_create');
{
    let crew!: McpAgent;
    let parentId = '';
    await test('task_create: an agent hands rules, verification, todos, resources and a parent task to a same-owner agent', async () => {
        const orch = await agentOf(alice, agents, 'task', ['task:write']);
        crew = await makeAgent(BASE, alice, ['task:read']);
        const parent = await callTool(orch.session, 'aimeat_task_create', {
            target_agent: crew.name, title: `Parent ${suffix}`, description: 'The parent task', status: 'draft',
        });
        assert(!parent.isError, `parent task refused: ${parent.text}`);
        parentId = parent.data.task_id;
        const r = await callTool(orch.session, 'aimeat_task_create', {
            target_agent: crew.name, title: `Child ${suffix}`, description: 'Read the notes and summarise them', status: 'draft',
            rules: ['Never send mail'],
            verification: { user_expects: 'A one-page summary', technical_checks: ['the summary exists'] },
            todos: [{ id: 't1', order: 1, title: 'Read the notes', environment: 'agent' }],
            resources: { memory_keys: ['notes.field-adds'] },
            parent_task_id: parentId,
        });
        assert(!r.isError, `task refused: ${r.text}`);
        const read = await get(`/v1/agents/${crew.name}/tasks/${r.data.task_id}`, alice.token);
        assert(read.status === 200, `owner reads the task: ${read.status} ${JSON.stringify(read.body.error)}`);
        const task = read.body.data.task;
        assert(JSON.stringify(task.rules) === JSON.stringify(['Never send mail']), `rules: ${JSON.stringify(task.rules)}`);
        assert(task.verification?.userExpects === 'A one-page summary', `verification: ${JSON.stringify(task.verification)}`);
        assert(task.todos?.[0]?.title === 'Read the notes', `todos: ${JSON.stringify(task.todos)}`);
        assert(JSON.stringify(task.resources?.memoryKeys) === JSON.stringify(['notes.field-adds']), `resources: ${JSON.stringify(task.resources)}`);
        assert(task.parentTaskId === parentId, `parentTaskId: ${task.parentTaskId}`);
    });

    await test('task_create: another owner\'s agent is refused the target through the tool as through REST, and no task is written', async () => {
        const bobs = await agentOf(bob, bobAgents, 'task', ['task:write']);
        const before = await get(`/v1/agents/${crew.name}/tasks?per_page=100`, alice.token);
        const rest = await post(`/v1/agents/${crew.name}/tasks`, bobs.agent.token, { title: 'Not yours', description: 'x', rules: ['x'] });
        assert(rest.status === 404, `REST: expected 404, got ${rest.status} ${JSON.stringify(rest.body.error)}`);
        const tool = await callTool(bobs.session, 'aimeat_task_create', { target_agent: crew.name, title: 'Not yours', description: 'x', rules: ['x'] });
        assert(tool.isError && /not found/i.test(tool.text), `tool: ${tool.text}`);
        const after = await get(`/v1/agents/${crew.name}/tasks?per_page=100`, alice.token);
        assert(after.body.data?.tasks?.length === before.body.data?.tasks?.length, 'no task was written for alice\'s agent');
    });
}

// ─── aimeat_mail_send: template_id, variables, from_name, links, invoice_id, company_id ───
console.log('\naimeat_mail_send');
{
    let contactId = '';
    const templateId = `fadd${suffix}`;
    await test('mail_send: the tool composes the message from the owner\'s template and variables, as the route does', async () => {
        const mail = await agentOf(alice, agents, 'mail', ['outbound:send', 'connections:use']);
        const tpl = await post('/v1/memory', alice.token, {
            key: `outbound.template.${templateId}`, visibility: 'private',
            value: { subject: 'Hello {{name}}', body: 'Your order {{number}} is ready.' },
        });
        assert(tpl.status === 200 || tpl.status === 201, `template write: ${tpl.status} ${JSON.stringify(tpl.body.error)}`);
        const contact = await post('/v1/outbound/contacts', alice.token, { name: 'Plain Customer', email: `fadd-${suffix}@example.com` });
        assert(contact.status === 201, `contact: ${contact.status} ${JSON.stringify(contact.body.error)}`);
        contactId = contact.body.data.contact.id;
        // This node has no mail transport, so the send ends in SEND_FAILED; the logged row still
        // carries the message the node composed.
        const r = await callTool(mail.session, 'aimeat_mail_send', {
            contact_id: contactId, subject: 'placeholder', body: 'placeholder',
            template_id: templateId, variables: { name: 'Carol', number: 'T-42' },
            from_name: 'Alice Shop', links: [{ label: 'Open the order', url: 'https://example.com/orders/42' }],
        });
        const messageId = r.data?.message_id;
        assert(typeof messageId === 'string', `the send names its logged row: ${r.text}`);
        const log = await get(`/v1/outbound/log?contact_id=${encodeURIComponent(contactId)}`, alice.token);
        assert(log.status === 200, `log read: ${log.status}`);
        const row = (log.body.data.messages as any[]).find(m => m.id === messageId);
        assert(row, `row ${messageId} in the log`);
        assert(row.subject === 'Hello Carol', `the subject comes from the template: '${row.subject}'`);
    });

    await test('mail_send: a template the owner does not have is refused through the tool as through REST', async () => {
        const mail = agents.mail!;
        const rest = await post('/v1/outbound/send', mail.agent.token, { contact_id: contactId, kind: 'transactional', template_id: `missing${suffix}` });
        assert(rest.status === 404 && rest.body.error?.code === 'TEMPLATE_NOT_FOUND', `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(mail.session, 'aimeat_mail_send', { contact_id: contactId, subject: 'x', body: 'x', template_id: `missing${suffix}` });
        assert(tool.isError && toolCode(tool) === 'TEMPLATE_NOT_FOUND', `tool: ${tool.text}`);
    });

    await test('mail_send: another owner\'s agent is refused alice\'s contact through the tool as through REST', async () => {
        const bobs = await agentOf(bob, bobAgents, 'mail', ['outbound:send', 'connections:use']);
        const rest = await post('/v1/outbound/send', bobs.agent.token, { contact_id: contactId, kind: 'transactional', template_id: templateId });
        assert(rest.status === 404, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(bobs.session, 'aimeat_mail_send', { contact_id: contactId, subject: 'x', body: 'x', template_id: templateId });
        assert(tool.isError && toolCode(tool) === rest.body.error?.code, `tool: ${tool.text}, REST: ${rest.body.error?.code}`);
    });
}

// ─── aimeat_capabilities_create and aimeat_capabilities_update ───
console.log('\naimeat_capabilities_create, aimeat_capabilities_update');
{
    const capId = `fadd-${suffix}`;
    const example = { description: 'Summarise one note', input: { key: 'notes.a' }, output: { summary: 'short' } };
    await test('capabilities_create: the tool stores when-not-to-use, examples, dependencies, auth and trust settings', async () => {
        const cap = await agentOf(alice, agents, 'cap', ['capability:write', 'work:request']);
        const r = await callTool(cap.session, 'aimeat_capabilities_create', {
            id: capId, name: 'Field adds', summary: 'fixture', visibility: 'private',
            whenNotToUse: 'Not for legal advice', examples: [example],
            dependencies: [{ type: 'capability', id: 'other-cap', required: false, minVersion: null }],
            exports: [{ name: 'summarise', description: 'one note', inputSchema: {}, outputSchema: {}, example: null }],
            redactedFields: ['password'], authRequired: 'registered', trustRequired: 3,
            source: { type: 'manual', ref: 'manual', version: '2.0.0' },
        });
        assert(!r.isError, `create refused: ${r.text}`);
        const read = await get(`/v1/capabilities/${capId}`, alice.token);
        assert(read.status === 200, `read: ${read.status}`);
        const c = read.body.data;
        assert(c.whenNotToUse === 'Not for legal advice', `whenNotToUse: ${c.whenNotToUse}`);
        assert(c.examples?.[0]?.description === example.description, `examples: ${JSON.stringify(c.examples)}`);
        assert(c.dependencies?.[0]?.id === 'other-cap', `dependencies: ${JSON.stringify(c.dependencies)}`);
        assert(c.exports?.[0]?.name === 'summarise', `exports: ${JSON.stringify(c.exports)}`);
        assert(JSON.stringify(c.redactedFields) === JSON.stringify(['password']), `redactedFields: ${JSON.stringify(c.redactedFields)}`);
        assert(c.authRequired === 'registered', `authRequired: ${c.authRequired}`);
        assert(c.trustRequired === 3, `trustRequired: ${c.trustRequired}`);
        assert(c.source?.version === '2.0.0', `source: ${JSON.stringify(c.source)}`);
    });

    await test('capabilities_create: a webhook on a node that turns webhooks off is refused through the tool as through REST', async () => {
        const cap = agents.cap!;
        const rest = await post('/v1/capabilities', cap.agent.token, { id: `${capId}-hook-r`, name: 'Hook', summary: 'x', webhookUrl: 'https://elsewhere.test/hook' });
        assert(rest.status === 403 && rest.body.error?.code === 'WEBHOOKS_DISABLED', `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(cap.session, 'aimeat_capabilities_create', { id: `${capId}-hook-t`, name: 'Hook', summary: 'x', webhookUrl: 'https://elsewhere.test/hook' });
        assert(tool.isError && toolCode(tool) === 'WEBHOOKS_DISABLED', `tool: ${tool.text}`);
        const gone = await get(`/v1/capabilities/${capId}-hook-t`, alice.token);
        assert(gone.status === 404, `nothing was stored: ${gone.status}`);
    });

    await test('capabilities_create: a source the node does not take is refused through the tool as through REST', async () => {
        const cap = agents.cap!;
        const bad = { type: 'app-tool', ref: `app-tool:fadd-${suffix}:run`, version: '1.0.0' };
        const rest = await post('/v1/capabilities', cap.agent.token, { id: `${capId}-src-r`, name: 'Src', summary: 'x', source: bad });
        assert(rest.status === 400 && rest.body.error?.code === 'INVALID_INPUT', `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(cap.session, 'aimeat_capabilities_create', { id: `${capId}-src-t`, name: 'Src', summary: 'x', source: bad });
        assert(tool.isError && toolCode(tool) === 'INVALID_INPUT', `tool: ${tool.text}`);
    });

    await test('capabilities_create: another owner\'s agent is refused an id that is taken, through the tool as through REST', async () => {
        const bobs = await agentOf(bob, bobAgents, 'cap', ['capability:write', 'work:request']);
        const rest = await post('/v1/capabilities', bobs.agent.token, { id: capId, name: 'Taken', summary: 'x', whenNotToUse: 'x' });
        assert(rest.status === 409 && rest.body.error?.code === 'CAPABILITY_EXISTS', `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(bobs.session, 'aimeat_capabilities_create', { id: capId, name: 'Taken', summary: 'x', whenNotToUse: 'x' });
        assert(tool.isError && toolCode(tool) === 'CAPABILITY_EXISTS', `tool: ${tool.text}`);
    });

    await test('capabilities_update: the tool changes the deprecation message, the replacement, the schemas and the examples', async () => {
        const cap = agents.cap!;
        const r = await callTool(cap.session, 'aimeat_capabilities_update', {
            id: capId, deprecationMessage: 'Use the new one', replacedBy: 'fadd-next',
            inputSchema: { type: 'object', properties: { key: { type: 'string' } } },
            outputSchema: { type: 'object' }, examples: [{ ...example, description: 'Updated example' }],
            callable: false, trustRequired: 5,
        });
        assert(!r.isError, `update refused: ${r.text}`);
        const c = (await get(`/v1/capabilities/${capId}`, alice.token)).body.data;
        assert(c.deprecationMessage === 'Use the new one', `deprecationMessage: ${c.deprecationMessage}`);
        assert(c.replacedBy === 'fadd-next', `replacedBy: ${c.replacedBy}`);
        assert(c.inputSchema?.properties?.key?.type === 'string', `inputSchema: ${JSON.stringify(c.inputSchema)}`);
        assert(c.examples?.[0]?.description === 'Updated example', `examples: ${JSON.stringify(c.examples)}`);
        assert(c.trustRequired === 5, `trustRequired: ${c.trustRequired}`);
    });

    await test('capabilities_update: a webhook on a node that turns webhooks off is refused through the tool as through REST', async () => {
        const cap = agents.cap!;
        const rest = await put(`/v1/capabilities/${capId}`, cap.agent.token, { webhookUrl: 'https://elsewhere.test/hook' });
        assert(rest.status === 403 && rest.body.error?.code === 'WEBHOOKS_DISABLED', `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(cap.session, 'aimeat_capabilities_update', { id: capId, webhookUrl: 'https://elsewhere.test/hook' });
        assert(tool.isError && toolCode(tool) === 'WEBHOOKS_DISABLED', `tool: ${tool.text}`);
        const c = (await get(`/v1/capabilities/${capId}`, alice.token)).body.data;
        assert(c.webhookUrl === null, `the stored webhook stays empty: ${c.webhookUrl}`);
    });

    await test('capabilities_update: another owner\'s agent is refused through the tool as through REST, and the record stays', async () => {
        const bobs = await agentOf(bob, bobAgents, 'cap', ['capability:write', 'work:request']);
        const rest = await put(`/v1/capabilities/${capId}`, bobs.agent.token, { deprecationMessage: 'hijacked' });
        assert(rest.status === 403 && rest.body.error?.code === 'FORBIDDEN', `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(bobs.session, 'aimeat_capabilities_update', { id: capId, deprecationMessage: 'hijacked' });
        assert(tool.isError && toolCode(tool) === 'FORBIDDEN', `tool: ${tool.text}`);
        const c = (await get(`/v1/capabilities/${capId}`, alice.token)).body.data;
        assert(c.deprecationMessage !== 'hijacked', 'the record is unchanged');
    });
}

// ─── aimeat_schedule_create and aimeat_schedule_update ───
console.log('\naimeat_schedule_create, aimeat_schedule_update');
{
    let scheduleId = '';
    await test('schedule_create: the tool creates a paused schedule with a guard', async () => {
        const s = await agentOf(alice, agents, 'sched', ['task:write', 'workflow:read', 'workflow:write']);
        const r = await callTool(s.session, 'aimeat_schedule_create', {
            kind: 'agent_task', cron: '0 7 * * *', display_name: `Morning ${suffix}`,
            task_title: 'Morning round', task_description: 'Read the notes',
            enabled: false, constraints: [{ type: 'max_runs', enabled: true, params: { limit: 3 } }],
        });
        assert(!r.isError, `create refused: ${r.text}`);
        scheduleId = r.data.schedule_id;
        const read = await get(`/v1/schedules/${scheduleId}`, alice.token);
        assert(read.status === 200, `read: ${read.status} ${JSON.stringify(read.body.error)}`);
        const job = read.body.data.schedule;
        assert(job.enabled === false, `enabled: ${job.enabled}`);
        assert(job.constraints?.[0]?.type === 'max_runs' && job.constraints[0].params?.limit === 3, `constraints: ${JSON.stringify(job.constraints)}`);
    });

    await test('schedule_create: an agent without task:write is refused through the tool as through REST', async () => {
        const plain = await agentOf(alice, agents, 'plain', ['memory:read']);
        const rest = await post('/v1/schedules', plain.agent.token, { kind: 'agent_task', cron: '0 7 * * *', display_name: 'x', enabled: false });
        assert(rest.status === 403, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(plain.session, 'aimeat_schedule_create', { kind: 'agent_task', cron: '0 7 * * *', display_name: 'x', enabled: false });
        assert(tool.isError && /SCOPE_DENIED/.test(tool.text), `tool: ${tool.text}`);
    });

    await test('schedule_update: the tool changes the purpose and the guards', async () => {
        const s = agents.sched!;
        const r = await callTool(s.session, 'aimeat_schedule_update', {
            schedule_id: scheduleId, purpose: 'Keeps the notes read',
            constraints: [{ type: 'max_runs', enabled: true, params: { limit: 9 } }],
        });
        assert(!r.isError, `update refused: ${r.text}`);
        const job = (await get(`/v1/schedules/${scheduleId}`, alice.token)).body.data.schedule;
        assert(job.purpose === 'Keeps the notes read', `purpose: ${job.purpose}`);
        assert(job.constraints?.[0]?.params?.limit === 9, `constraints: ${JSON.stringify(job.constraints)}`);
    });

    await test('schedule_update: another owner\'s agent is refused through the tool as through REST', async () => {
        const bobs = await agentOf(bob, bobAgents, 'sched', ['task:write', 'workflow:read', 'workflow:write']);
        const rest = await json(`/v1/schedules/${scheduleId}`, { method: 'PATCH', headers: auth(bobs.agent.token), body: JSON.stringify({ purpose: 'hijacked' }) });
        assert(rest.status === 403 || rest.status === 404, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(bobs.session, 'aimeat_schedule_update', { schedule_id: scheduleId, purpose: 'hijacked' });
        assert(tool.isError && toolCode(tool) === rest.body.error?.code, `tool: ${tool.text}, REST: ${rest.body.error?.code}`);
        const job = (await get(`/v1/schedules/${scheduleId}`, alice.token)).body.data.schedule;
        assert(job.purpose !== 'hijacked', 'the schedule is unchanged');
    });
}

// ─── aimeat_organism_create, aimeat_organism_update, aimeat_organism_list ───
console.log('\naimeat_organism_create, aimeat_organism_update, aimeat_organism_list');
{
    let orgId = '';
    await test('organism_create: the tool stores interests, place, size and who sees the members', async () => {
        const o = await agentOf(alice, agents, 'org', ['organism:write', 'organism:read']);
        const r = await callTool(o.session, 'aimeat_organism_create', {
            name: `Field adds ${suffix}`, visibility: 'private',
            interests: ['birds'], location: { city: 'Tampere', country: 'FI' }, max_members: 42, member_visibility: 'members',
        });
        assert(!r.isError, `create refused: ${r.text}`);
        orgId = r.data.organism.id;
        const read = await get(`/v1/organisms/${orgId}`, alice.token);
        assert(read.status === 200, `read: ${read.status}`);
        const org = read.body.data.organism ?? read.body.data;
        assert(org.maxMembers === 42, `maxMembers: ${org.maxMembers}`);
        assert(org.memberVisibility === 'members', `memberVisibility: ${org.memberVisibility}`);
        assert(org.location?.city === 'Tampere', `location: ${JSON.stringify(org.location)}`);
        assert(JSON.stringify(org.interests) === JSON.stringify(['birds']), `interests: ${JSON.stringify(org.interests)}`);
    });

    await test('organism_create: an agent without organism:write is refused through the tool as through REST', async () => {
        const plain = await agentOf(alice, agents, 'plain', ['memory:read']);
        const rest = await post('/v1/organisms', plain.agent.token, { name: 'Nope', max_members: 3 });
        assert(rest.status === 403, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(plain.session, 'aimeat_organism_create', { name: 'Nope', max_members: 3 });
        assert(tool.isError && /SCOPE_DENIED/.test(tool.text), `tool: ${tool.text}`);
    });

    await test('organism_update: the tool changes the place, the size and who sees the members', async () => {
        const o = agents.org!;
        const r = await callTool(o.session, 'aimeat_organism_update', {
            organism_id: orgId, location: { city: 'Oulu' }, max_members: 7, member_visibility: 'admins',
        });
        assert(!r.isError, `update refused: ${r.text}`);
        const read = await get(`/v1/organisms/${orgId}`, alice.token);
        const org = read.body.data.organism ?? read.body.data;
        assert(org.maxMembers === 7 && org.memberVisibility === 'admins' && org.location?.city === 'Oulu', `organism: ${JSON.stringify({ m: org.maxMembers, v: org.memberVisibility, l: org.location })}`);
    });

    await test('organism_update: a member_visibility the node does not know is refused through the tool as through REST', async () => {
        const o = agents.org!;
        const rest = await put(`/v1/organisms/${orgId}`, o.agent.token, { member_visibility: 'everyone' });
        assert(rest.status === 400, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(o.session, 'aimeat_organism_update', { organism_id: orgId, max_members: 0 });
        assert(tool.isError, `tool: ${tool.text}`);
        const restSize = await put(`/v1/organisms/${orgId}`, o.agent.token, { max_members: 0 });
        assert(restSize.status === 400, `REST max_members 0: ${restSize.status}`);
    });

    await test('organism_update: another owner\'s agent is refused through the tool as through REST, and the organism stays', async () => {
        const bobs = await agentOf(bob, bobAgents, 'org', ['organism:write', 'organism:read']);
        const rest = await put(`/v1/organisms/${orgId}`, bobs.agent.token, { max_members: 99 });
        assert(rest.status === 403, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(bobs.session, 'aimeat_organism_update', { organism_id: orgId, max_members: 99 });
        assert(tool.isError, `tool: ${tool.text}`);
        const org = (await get(`/v1/organisms/${orgId}`, alice.token)).body.data;
        assert((org.organism ?? org).maxMembers === 7, 'the organism is unchanged');
    });

    await test('organism_list: the visibility filter narrows the list the tool shows', async () => {
        const o = agents.org!;
        const priv = await callTool(o.session, 'aimeat_organism_list', { visibility: 'private' });
        assert(!priv.isError, `list refused: ${priv.text}`);
        const ids = (priv.data as any[]).map(x => x.id);
        assert(ids.includes(orgId), `the private organism is listed: ${ids.join(', ')}`);
        assert((priv.data as any[]).every(x => x.visibility === 'private'), 'only private organisms are listed');
        const pub = await callTool(o.session, 'aimeat_organism_list', { visibility: 'public' });
        assert(!(pub.data as any[]).some(x => x.id === orgId), 'the private organism is not in the public list');
    });
}

// ─── aimeat_app_publish ───
console.log('\naimeat_app_publish');
{
    const filename = `fadd-${suffix}.html`;
    await test('app_publish: the tool stores the pacing amount and the licence on an inline publish', async () => {
        const a = await agentOf(alice, agents, 'app', ['app:write', 'app:read']);
        const r = await callTool(a.session, 'aimeat_app_publish', {
            filename, name: 'Field adds app', description: 'A page the field adds suite publishes.',
            content: '<!doctype html><html><head><title>Field adds</title></head><body><p>ok</p></body></html>',
            toll_morsels: 5, license_type: 'lifetime',
        });
        assert(!r.isError, `publish refused: ${r.text}`);
        const read = await callTool(a.session, 'aimeat_app_get', { owner: alice.name, filename });
        assert(!read.isError, `read refused: ${read.text}`);
        const manifest = read.data.manifest ?? read.data.app?.manifest ?? read.data;
        assert(manifest.tollMorsels === 5, `tollMorsels: ${manifest.tollMorsels}`);
        assert(manifest.licenseType === 'lifetime', `licenseType: ${manifest.licenseType}`);
    });

    await test('app_publish: a pacing amount that is no number of morsels is refused through the tool as through REST', async () => {
        const a = agents.app!;
        const content = Buffer.from('<!doctype html><title>x</title>').toString('base64');
        const rest = await post('/v1/apps', a.agent.token, { filename, name: 'x', content, toll_morsels: -1 });
        assert(rest.status === 400, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(a.session, 'aimeat_app_publish', { filename, name: 'x', content: '<!doctype html><title>x</title>', toll_morsels: -1 });
        assert(tool.isError, `tool: ${tool.text}`);
    });

    await test('app_publish: another owner\'s agent is refused alice\'s app through the tool as through REST', async () => {
        const bobs = await agentOf(bob, bobAgents, 'app', ['app:write', 'app:read']);
        const content = Buffer.from('<!doctype html><title>x</title>').toString('base64');
        const rest = await post('/v1/apps', bobs.agent.token, { owner: alice.name, filename, name: 'x', content, toll_morsels: 9 });
        assert(rest.status === 403, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(bobs.session, 'aimeat_app_publish', { owner: alice.name, filename, name: 'x', content: '<!doctype html><title>x</title>', toll_morsels: 9 });
        assert(tool.isError, `tool: ${tool.text}`);
        const read = await callTool(agents.app!.session, 'aimeat_app_get', { owner: alice.name, filename });
        const manifest = read.data.manifest ?? read.data.app?.manifest ?? read.data;
        assert(manifest.tollMorsels === 5, `the amount is unchanged: ${manifest.tollMorsels}`);
    });
}

// ─── Read filters: the tool answers what the route answers for the same filter ───
console.log('\nRead filters');
{
    await test('catalogue_directory: country and interests filter as on the route', async () => {
        const a = await agentOf(alice, agents, 'cat', ['catalogue:read']);
        const tool = await callTool(a.session, 'aimeat_catalogue_directory', { country: 'Nowhereland', interests: ['fadd-none'] });
        assert(!tool.isError, `tool: ${tool.text}`);
        const rest = await get('/v1/catalogue/directory?type=people&country=Nowhereland&interests=fadd-none', a.agent.token);
        assert(rest.status === 200, `REST: ${rest.status}`);
        assert(Array.isArray(tool.data) && tool.data.length === rest.body.data.entries.length, `tool ${JSON.stringify(tool.data).slice(0, 200)} REST ${rest.body.data.entries.length}`);
    });

    await test('cortex_list: namespace and visibility filter as on the route, and are refused beside a name', async () => {
        const a = await agentOf(alice, agents, 'cat', ['catalogue:read']);
        const all = await get('/v1/cortex', a.agent.token);
        assert(all.status === 200, `REST list: ${all.status}`);
        const first = (all.body.data.extensions as any[])[0];
        assert(first, 'the node has a cortex to filter on');
        const rest = await get(`/v1/cortex?namespace=${encodeURIComponent(first.namespace)}&visibility=${encodeURIComponent(first.visibility)}`, a.agent.token);
        const tool = await callTool(a.session, 'aimeat_cortex_list', { namespace: first.namespace, visibility: first.visibility });
        assert(!tool.isError, `tool: ${tool.text}`);
        const names = (x: any[]) => x.map(e => e.name).sort().join(',');
        assert(names(tool.data) === names(rest.body.data.extensions), `tool ${names(tool.data)} REST ${names(rest.body.data.extensions)}`);
        const none = await callTool(a.session, 'aimeat_cortex_list', { namespace: `fadd-none-${suffix}` });
        assert(Array.isArray(none.data) && none.data.length === 0, `an unknown namespace lists nothing: ${none.text.slice(0, 200)}`);
        const beside = await callTool(a.session, 'aimeat_cortex_list', { name: first.name, namespace: first.namespace });
        assert(beside.isError && toolCode(beside) === 'INVALID_INPUT', `with a name: ${beside.text}`);
    });

    await test('admin_knowledge: the exact author filter answers as on the route, and stays the operator\'s', async () => {
        const op = await agentOf(operator, agents, 'operator', ['operator:admin']);
        const rest = await get(`/v1/admin/knowledge?author=${encodeURIComponent(`fadd-none-${suffix}`)}`, op.agent.token);
        assert(rest.status === 200, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(op.session, 'aimeat_admin_knowledge', { author: `fadd-none-${suffix}` });
        assert(!tool.isError, `tool: ${tool.text}`);
        assert(tool.data.paging?.total === rest.body.data.paging.total && rest.body.data.paging.total === 0, `tool ${JSON.stringify(tool.data.paging)} REST ${JSON.stringify(rest.body.data.paging)}`);
        const plain = await agentOf(alice, agents, 'plainop', ['operator:admin']);
        const restNo = await get(`/v1/admin/knowledge?author=x`, plain.agent.token);
        assert(restNo.status === 403, `REST for a non-operator: ${restNo.status}`);
        const toolNo = await callTool(plain.session, 'aimeat_admin_knowledge', { author: 'x' });
        assert(toolNo.isError, `tool for a non-operator: ${toolNo.text}`);
    });

    await test('message_history: direction filters the agent\'s own conversation as on the route', async () => {
        const a = await agentOf(alice, agents, 'msg', ['memory:read']);
        const sent = await post(`/v1/agents/${a.agent.name}/messages`, alice.token, { content: `Hello ${suffix}`, direction: 'inbound' });
        assert(sent.status === 200 || sent.status === 201, `owner message: ${sent.status} ${JSON.stringify(sent.body.error)}`);
        const inbound = await callTool(a.session, 'aimeat_message_history', { direction: 'inbound' });
        assert(!inbound.isError && JSON.stringify(inbound.data).includes(`Hello ${suffix}`), `inbound: ${inbound.text.slice(0, 300)}`);
        const outbound = await callTool(a.session, 'aimeat_message_history', { direction: 'outbound' });
        assert(!JSON.stringify(outbound.data).includes(`Hello ${suffix}`), `outbound has the owner's message: ${outbound.text.slice(0, 300)}`);
        const rest = await get(`/v1/agents/${a.agent.name}/messages?direction=outbound`, a.agent.token);
        assert(rest.status === 200 && !JSON.stringify(rest.body.data).includes(`Hello ${suffix}`), `REST outbound: ${rest.status}`);
    });

    await test('instance_list: platform filters the owner\'s chat instances as on the route', async () => {
        const a = await agentOf(alice, agents, 'inst', ['memory:read']);
        const tool = await callTool(a.session, 'aimeat_instance_list', { platform: `fadd-none-${suffix}` });
        assert(!tool.isError && Array.isArray(tool.data) && tool.data.length === 0, `tool: ${tool.text.slice(0, 200)}`);
        const rest = await get(`/v1/chat-instances?platform=fadd-none-${suffix}`, a.agent.token);
        assert(rest.status === 200 && rest.body.data.chat_instances.length === 0, `REST: ${rest.status}`);
    });

    await test('consent_list: recipient filters the consents as on the route', async () => {
        const a = await agentOf(alice, agents, 'consent', ['consent:manage']);
        const recipient = `fadd-r-${suffix}@example.node`;
        const made = await post('/v1/consent', a.agent.token, { recipient, data_pattern: 'notes.*', scope: 'local', purpose: 'test' });
        assert(made.status === 200 || made.status === 201, `consent: ${made.status} ${JSON.stringify(made.body.error)}`);
        const tool = await callTool(a.session, 'aimeat_consent_list', { recipient });
        assert(!tool.isError && (tool.data as any[]).length >= 1 && (tool.data as any[]).every(c => c.recipient === recipient), `tool: ${tool.text.slice(0, 300)}`);
        const rest = await get(`/v1/consent?recipient=${encodeURIComponent(recipient)}`, a.agent.token);
        assert(rest.status === 200 && rest.body.data.consents.every((c: any) => c.recipient === recipient), `REST: ${rest.status}`);
    });

    await test('agents_list: run_mode filters the roster as on the route', async () => {
        const a = await agentOf(alice, agents, 'roster', ['agent:read']);
        const tool = await callTool(a.session, 'aimeat_agents_list', { run_mode: `fadd-none-${suffix}` });
        assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
        const listed = Array.isArray(tool.data) ? tool.data : (tool.data.agents ?? []);
        assert(listed.length === 0, `an unknown run mode lists nothing: ${listed.length}`);
        const rest = await get(`/v1/agents?run_mode=fadd-none-${suffix}`, a.agent.token);
        assert(rest.status === 200 && rest.body.data.agents.length === 0, `REST: ${rest.status}`);
    });
}

// ─── Writes on the rest of the tools ───
console.log('\nThe other write tools');
{
    await test('task_todo: the task\'s own agent records when a step was finished', async () => {
        const crew = await makeAgent(BASE, alice, ['task:read']);
        const crewSession = await openSession(BASE, crew.token, 'field-adds-crew');
        const made = await post(`/v1/agents/${crew.name}/tasks`, alice.token, {
            title: `Todo ${suffix}`, description: 'One step', status: 'queued',
            todos: [{ id: 's1', order: 1, title: 'Do the step', environment: 'agent' }],
        });
        assert(made.status === 201 || made.status === 200, `task: ${made.status} ${JSON.stringify(made.body.error)}`);
        const taskId = made.body.data.task?.id ?? made.body.data.id;
        const started = await post(`/v1/agents/${crew.name}/tasks/${taskId}/start`, alice.token, {});
        assert(started.status === 200, `start: ${started.status} ${JSON.stringify(started.body.error)}`);
        const at = '2026-01-02T03:04:05.000Z';
        const r = await callTool(crewSession, 'aimeat_task_todo', { task_id: taskId, todo_id: 's1', status: 'done', completed_at: at });
        assert(!r.isError, `todo refused: ${r.text}`);
        const task = (await get(`/v1/agents/${crew.name}/tasks/${taskId}`, alice.token)).body.data.task;
        assert(task.todos?.[0]?.completedAt === at, `completedAt: ${task.todos?.[0]?.completedAt}`);
        const bobs = await agentOf(bob, bobAgents, 'task', ['task:write']);
        const rest = await json(`/v1/agents/${crew.name}/tasks/${taskId}/todos/s1`, { method: 'PATCH', headers: auth(bobs.agent.token), body: JSON.stringify({ status: 'failed', completed_at: at }) });
        assert(rest.status === 403 || rest.status === 404, `REST for another owner's agent: ${rest.status}`);
        const tool = await callTool(bobs.session, 'aimeat_task_todo', { task_id: taskId, todo_id: 's1', status: 'failed', completed_at: at });
        assert(tool.isError, `tool for another owner's agent: ${tool.text}`);
    });

    await test('group_create: members listed without permissions get the group\'s default permissions', async () => {
        const g = await agentOf(alice, agents, 'group', ['consent:groups', 'memory:read']);
        const r = await callTool(g.session, 'aimeat_group_create', {
            name: `Field adds ${suffix}`, members: [{ identifier: bob.ghii, identifier_type: 'ghii' }],
            default_permissions: { read: true, write: true },
        });
        assert(!r.isError, `group refused: ${r.text}`);
        const groupId = r.data.group_id ?? r.data.id ?? r.data.group?.id;
        const read = await get(`/v1/groups/${groupId}`, alice.token);
        assert(read.status === 200, `read: ${read.status}`);
        const member = read.body.data.group.members?.[0];
        assert(member?.permissions?.write === true, `member permissions: ${JSON.stringify(member)}`);
        const plain = await agentOf(alice, agents, 'plain', ['memory:read']);
        const rest = await post('/v1/groups', plain.agent.token, { name: 'Nope', default_permissions: { read: true, write: true } });
        assert(rest.status === 403, `REST without consent:groups: ${rest.status}`);
        const tool = await callTool(plain.session, 'aimeat_group_create', { name: 'Nope', default_permissions: { read: true, write: true } });
        assert(tool.isError && /SCOPE_DENIED/.test(tool.text), `tool without consent:groups: ${tool.text}`);
    });

    await test('app_draft_save: the draft keeps the content type the tool names', async () => {
        const a = await agentOf(alice, agents, 'app', ['app:write', 'app:read']);
        const filename = `fadd-${suffix}.html`;
        const r = await callTool(a.session, 'aimeat_app_draft_save', {
            filename, content_base64: Buffer.from('<!doctype html><title>Draft</title>').toString('base64'), mime_type: 'text/html; charset=utf-8',
        });
        assert(!r.isError, `draft refused: ${r.text}`);
        const read = await get(`/v1/apps/${alice.name}/${filename}/draft`, alice.token);
        assert(read.status === 200 && read.body.data.mime_type === 'text/html; charset=utf-8', `draft: ${read.status} ${read.body.data?.mime_type}`);
        const bobs = await agentOf(bob, bobAgents, 'app', ['app:write', 'app:read']);
        const tool = await callTool(bobs.session, 'aimeat_app_draft_save', { owner: alice.name, filename, content_base64: 'PGI+', mime_type: 'text/plain' });
        assert(tool.isError, `another owner's agent: ${tool.text}`);
        const again = await get(`/v1/apps/${alice.name}/${filename}/draft`, alice.token);
        assert(again.body.data.mime_type === 'text/html; charset=utf-8', 'the draft is unchanged');
    });

    await test('action_execute: the tool takes a callback address as REST does, and refuses one that is no URL', async () => {
        const w = await agentOf(alice, agents, 'work', ['work:request']);
        const bad = await post('/v1/work/request', w.agent.token, { action_id: `none-${suffix}`, provider_gaii: bob.ghii, input: {}, callback_url: 'not a url' });
        assert(bad.status === 400, `REST with a bad address: ${bad.status}`);
        const badTool = await callTool(w.session, 'aimeat_action_execute', { action_id: `none-${suffix}`, provider_gaii: bob.ghii, input: {}, callback_url: 'not a url' });
        assert(badTool.isError, `tool with a bad address: ${badTool.text}`);
        const rest = await post('/v1/work/request', w.agent.token, { action_id: `none-${suffix}`, provider_gaii: bob.ghii, input: {}, callback_url: 'https://example.com/hook' });
        const tool = await callTool(w.session, 'aimeat_action_execute', { action_id: `none-${suffix}`, provider_gaii: bob.ghii, input: {}, callback_url: 'https://example.com/hook' });
        // No read answers the callback address, so the proof is that both take the request with it.
        assert(rest.status === 201 && !tool.isError && typeof tool.data.tracking_code === 'string',
            `both take the request with a callback: REST ${rest.status} ${JSON.stringify(rest.body.error)}, tool ${tool.text.slice(0, 200)}`);
    });
}

// ─── Read filters on the rest of the tools ───
console.log('\nThe other read filters');
{
    await test('memory_list: archived lists the archived records alone, as on the route', async () => {
        const m = await agentOf(alice, agents, 'mem', ['memory:read', 'memory:write']);
        const key = `fadd.live.${suffix}`;
        const wrote = await post('/v1/memory', m.agent.token, { key, value: { a: 1 }, visibility: 'private' });
        assert(wrote.status === 200 || wrote.status === 201, `write: ${wrote.status}`);
        const live = await callTool(m.session, 'aimeat_memory_list', { prefix: 'fadd.' });
        assert(JSON.stringify(live.data).includes(key), `the live record is listed by default: ${live.text.slice(0, 200)}`);
        const only = await callTool(m.session, 'aimeat_memory_list', { prefix: 'fadd.', archived: 'only' });
        assert(!only.isError && !JSON.stringify(only.data).includes(key), `archived only leaves the live record out: ${only.text.slice(0, 200)}`);
        const rest = await get('/v1/memory?prefix=fadd.&archived=only&include=meta', m.agent.token);
        assert(rest.status === 200 && !JSON.stringify(rest.body.data).includes(key), `REST archived only: ${rest.status}`);
        const both = await callTool(m.session, 'aimeat_memory_list', { prefix: 'fadd.', archived: 'include' });
        assert(JSON.stringify(both.data).includes(key), 'include lists the live record too');
    });

    await test('workspace_read: an archived-only read answers what the route answers', async () => {
        const o = await agentOf(alice, agents, 'org', ['organism:write', 'organism:read']);
        const made = await callTool(o.session, 'aimeat_organism_create', { name: `Shape ${suffix}`, visibility: 'private', shape: 'own-work', lang: 'en' });
        assert(!made.isError, `organism: ${made.text}`);
        const orgId = made.data.organism.id;
        const ws = made.data.workspaces?.[0]?.id ?? made.data.workspaces?.[0]?.ws ?? made.data.workspaces?.[0];
        assert(typeof ws === 'string', `a workspace was made: ${JSON.stringify(made.data.workspaces)}`);
        const normal = await callTool(o.session, 'aimeat_workspace_read', { organism_id: orgId, ws });
        assert(!normal.isError, `read: ${normal.text.slice(0, 200)}`);
        const only = await callTool(o.session, 'aimeat_workspace_read', { organism_id: orgId, ws, archived: 'only' });
        assert(!only.isError, `archived read: ${only.text.slice(0, 200)}`);
        const rest = await get(`/v1/organisms/${orgId}/workspace/index?ws=${encodeURIComponent(ws)}&archived=only`, o.agent.token);
        assert(rest.status === 200, `REST index archived only: ${rest.status} ${JSON.stringify(rest.body.error)}`);
        assert(JSON.stringify(only.data) === JSON.stringify(rest.body.data), `tool and route answer the same archived read: ${JSON.stringify(only.data).slice(0, 200)} / ${JSON.stringify(rest.body.data).slice(0, 200)}`);
    });

    await test('package_list: category filters the list as on the route', async () => {
        const p = await agentOf(alice, agents, 'pkg', ['packages:read']);
        const all = await get('/v1/packages', p.agent.token);
        assert(all.status === 200, `REST list: ${all.status}`);
        const category = (all.body.data.packages as any[]).find(x => x.category)?.category ?? `fadd-none-${suffix}`;
        const rest = await get(`/v1/packages?category=${encodeURIComponent(category)}`, p.agent.token);
        const tool = await callTool(p.session, 'aimeat_package_list', { category });
        assert(!tool.isError, `tool: ${tool.text.slice(0, 200)}`);
        const ids = (x: any[]) => x.map(e => e.group_id ?? e.packageGroupId ?? e.id).sort().join(',');
        assert(ids(tool.data.packages ?? []) === ids(rest.body.data.packages), `tool ${ids(tool.data.packages ?? [])} REST ${ids(rest.body.data.packages)}`);
        const none = await callTool(p.session, 'aimeat_package_list', { category: `fadd-none-${suffix}` });
        assert((none.data.packages ?? []).length === 0, 'an unknown category lists nothing');
    });
}

// ─── aimeat_board_create federate, aimeat_board_post ttl_hours ───
console.log('\naimeat_board_create, aimeat_board_post');
{
    let boardId = '';
    const boardOf = async (token: string, id: string) => {
        const list = await get('/v1/boards', token);
        assert(list.status === 200, `board list: ${list.status}`);
        return (list.body.data.boards as any[]).find(b => b.id === id);
    };

    await test('board_create: the tool marks a public board federated, as the route does', async () => {
        const b = await agentOf(alice, agents, 'board', ['social:write', 'social:read', 'organism:write', 'organism:read']);
        const r = await callTool(b.session, 'aimeat_board_create', { name: `Field adds ${suffix}`, visibility: 'public', federate: true });
        assert(!r.isError, `board refused: ${r.text}`);
        boardId = r.data.id;
        const board = await boardOf(b.agent.token, boardId);
        assert(board?.federate === true, `federate: ${JSON.stringify(board)}`);
        const rest = await post('/v1/boards', b.agent.token, { name: `Field adds REST ${suffix}`, visibility: 'public', federate: true });
        assert(rest.status === 201 || rest.status === 202, `REST board: ${rest.status} ${JSON.stringify(rest.body.error)}`);
        assert((await boardOf(b.agent.token, rest.body.data.id))?.federate === true, 'the REST board is federated too');
    });

    await test('board_create: an organisation\'s board is never federated, through the tool as through REST', async () => {
        const b = agents.board!;
        const org = await callTool(b.session, 'aimeat_organism_create', { name: `Board org ${suffix}`, visibility: 'private' });
        assert(!org.isError, `organism: ${org.text}`);
        const audience = `organism:${org.data.organism.id}`;
        const tool = await callTool(b.session, 'aimeat_board_create', { name: `Org board ${suffix}`, visibility: audience, federate: true });
        assert(!tool.isError, `tool: ${tool.text}`);
        assert((await boardOf(b.agent.token, tool.data.id))?.federate === false, 'the tool\'s organisation board stays on this node');
        const rest = await post('/v1/boards', b.agent.token, { name: `Org board REST ${suffix}`, visibility: audience, federate: true });
        assert(rest.status === 201 || rest.status === 202, `REST: ${rest.status} ${JSON.stringify(rest.body.error)}`);
        assert((await boardOf(b.agent.token, rest.body.data.id))?.federate === false, 'the REST organisation board stays on this node');
    });

    await test('board_create: an agent without social:write is refused through the tool as through REST', async () => {
        const plain = await agentOf(alice, agents, 'plain', ['memory:read']);
        const rest = await post('/v1/boards', plain.agent.token, { name: 'Nope', federate: true });
        assert(rest.status === 403, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(plain.session, 'aimeat_board_create', { name: 'Nope', federate: true });
        assert(tool.isError && /SCOPE_DENIED/.test(tool.text), `tool: ${tool.text}`);
    });

    await test('board_post: the tool gives a post its own lifetime, as the route does', async () => {
        const b = agents.board!;
        const before = Date.now();
        const r = await callTool(b.session, 'aimeat_board_post', { board_id: boardId, title: `Short ${suffix}`, body: 'Gone in two hours', ttl_hours: 2 });
        assert(!r.isError, `post refused: ${r.text}`);
        const read = await get(`/v1/boards/${boardId}/posts/${r.data.id}`, b.agent.token);
        assert(read.status === 200, `read: ${read.status}`);
        const expires = Date.parse(read.body.data.ttl_expires_at ?? read.body.data.post?.ttl_expires_at);
        const hours = (expires - before) / 3_600_000;
        assert(hours > 1.9 && hours < 2.1, `the post lives about two hours: ${hours.toFixed(3)}`);
    });

    await test('board_post: a lifetime that is no positive number is refused through the tool as through REST', async () => {
        const b = agents.board!;
        const rest = await post(`/v1/boards/${boardId}/posts`, b.agent.token, { title: 'x', body: 'x', ttl_hours: -1 });
        assert(rest.status === 400, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(b.session, 'aimeat_board_post', { board_id: boardId, title: 'x', body: 'x', ttl_hours: -1 });
        assert(tool.isError, `tool: ${tool.text}`);
    });

    await test('board_post: another owner\'s agent is refused a private board through the tool as through REST', async () => {
        const b = agents.board!;
        const priv = await callTool(b.session, 'aimeat_board_create', { name: `Private ${suffix}`, visibility: 'private' });
        assert(!priv.isError, `private board: ${priv.text}`);
        const bobs = await agentOf(bob, bobAgents, 'board', ['social:write', 'social:read']);
        const rest = await post(`/v1/boards/${priv.data.id}/posts`, bobs.agent.token, { title: 'x', body: 'x', ttl_hours: 2 });
        assert(rest.status === 403 || rest.status === 404, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(bobs.session, 'aimeat_board_post', { board_id: priv.data.id, title: 'x', body: 'x', ttl_hours: 2 });
        assert(tool.isError && toolCode(tool) === rest.body.error?.code, `tool: ${tool.text}, REST: ${rest.body.error?.code}`);
    });
}

// ─── aimeat_storage_upload federate ───
console.log('\naimeat_storage_upload');
{
    await test('storage_upload: an inline upload keeps the federate mark, as the route does', async () => {
        const s = await agentOf(alice, agents, 'store', ['storage:write', 'storage:read']);
        const data = Buffer.from(`field adds ${suffix}`).toString('base64');
        const tool = await callTool(s.session, 'aimeat_storage_upload', { key: `fadd-${suffix}.txt`, data_base64: data, mime_type: 'text/plain', federate: true });
        assert(!tool.isError && tool.data.federate === true, `tool: ${tool.text.slice(0, 300)}`);
        const rest = await post('/v1/storage', s.agent.token, { key: `fadd-rest-${suffix}.txt`, data, mime_type: 'text/plain', federate: true });
        assert((rest.status === 200 || rest.status === 201) && rest.body.data.federate === true, `REST: ${rest.status} ${JSON.stringify(rest.body.data ?? rest.body.error).slice(0, 200)}`);
        const plainUpload = await callTool(s.session, 'aimeat_storage_upload', { key: `fadd-plain-${suffix}.txt`, data_base64: data, mime_type: 'text/plain' });
        assert(plainUpload.data.federate === false, `without the flag the mark is off: ${plainUpload.text.slice(0, 200)}`);
    });

    await test('storage_upload: an agent without storage:write is refused through the tool as through REST', async () => {
        const plain = await agentOf(alice, agents, 'plain', ['memory:read']);
        const data = Buffer.from('x').toString('base64');
        const rest = await post('/v1/storage', plain.agent.token, { key: `nope-${suffix}.txt`, data, federate: true });
        assert(rest.status === 403, `REST: ${rest.status} ${rest.body.error?.code}`);
        const tool = await callTool(plain.session, 'aimeat_storage_upload', { key: `nope-${suffix}.txt`, data_base64: data, federate: true });
        assert(tool.isError && /SCOPE_DENIED/.test(tool.text), `tool: ${tool.text}`);
    });
}

// ─── aimeat_knowledge_links relation ───
console.log('\naimeat_knowledge_links');
{
    await test('knowledge_links: relation filters a package\'s links as on the route', async () => {
        const k = await agentOf(alice, agents, 'know', ['memory:write', 'memory:read']);
        const importPackage = async (name: string) => {
            const r = await post('/v1/knowledge/import', k.agent.token, {
                package: {
                    type: 'knowledge-package', name, version: '1.0.0', author: alice.name,
                    content_type: 'research', tags: ['fadd'], language: 'en', maturity: 'published',
                    synthesis: { level: 'original', description: 'e2e' }, references: [],
                    entries: [{ key: 'data', title: 'Data', visibility: 'private' }], links: [],
                    sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 },
                },
                entry_data: { data: { title: 'Data', summary: name } },
            });
            assert(r.status === 201, `import ${name}: ${r.status} ${JSON.stringify(r.body.error)}`);
            return r.body.data.package_id as string;
        };
        const a = await importPackage(`fadd-a-${suffix}`);
        const b = await importPackage(`fadd-b-${suffix}`);
        const link = await post(`/v1/knowledge/${a}/link`, k.agent.token, { target: b, relation: 'extends', description: 'A builds on B' });
        assert(link.status === 200 || link.status === 201, `link: ${link.status} ${JSON.stringify(link.body.error)}`);
        const count = (x: any) => (x?.links ?? []).length;
        const extendsTool = await callTool(k.session, 'aimeat_knowledge_links', { package_id: a, relation: 'extends' });
        assert(!extendsTool.isError && count(extendsTool.data) >= 1, `extends: ${extendsTool.text.slice(0, 300)}`);
        const otherTool = await callTool(k.session, 'aimeat_knowledge_links', { package_id: a, relation: 'contradicts' });
        assert(!otherTool.isError && count(otherTool.data) === 0, `contradicts: ${otherTool.text.slice(0, 300)}`);
        const extendsRest = await get(`/v1/knowledge/${a}/links?relation=extends`, k.agent.token);
        const otherRest = await get(`/v1/knowledge/${a}/links?relation=contradicts`, k.agent.token);
        assert(count(extendsRest.body.data) === count(extendsTool.data) && count(otherRest.body.data) === 0,
            `REST extends ${count(extendsRest.body.data)}, contradicts ${count(otherRest.body.data)}`);
        // Another owner's agent: the tool answers as the route does for the same package.
        const bobs = await agentOf(bob, bobAgents, 'know', ['memory:read']);
        const restBob = await get(`/v1/knowledge/${a}/links?relation=extends`, bobs.agent.token);
        const toolBob = await callTool(bobs.session, 'aimeat_knowledge_links', { package_id: a, relation: 'extends' });
        assert((restBob.status >= 400) === toolBob.isError, `another owner's agent: REST ${restBob.status}, tool ${toolBob.text.slice(0, 200)}`);
        if (!toolBob.isError) assert(count(toolBob.data) === count(restBob.body.data), 'the same links on both');
    });
}

// ─── Cleanup ───
console.log('\nCleanup');
await test('Cleanup: the accounts this suite made are deleted', async () => {
    const left: string[] = [];
    for (const owner of [bob, alice, operator]) {
        if (!owner) continue;
        const gone = await json(`/v1/owners/${owner.name}`, { method: 'DELETE', headers: auth(owner.token) });
        if (gone.body?.ok !== true) left.push(`${owner.name}: ${gone.status}`);
    }
    assert(left.length === 0, `not deleted: ${left.join(', ')}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
