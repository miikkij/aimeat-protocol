/**
 * @file scripts/cold-agent/scripted.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The driver that spends nothing. It performs each task over the node's real MCP
 *   endpoint the way a well-guided agent would, and prints the same transcript lines the `claude`
 *   driver prints. It measures no agent: it proves that the verifiers ask the node the right
 *   question, that a passing task can pass, and that the report reads a transcript correctly. A
 *   task this driver cannot pass is a task whose verifier or whose node is wrong, and that is
 *   worth knowing before a model session is paid for.
 * @structure McpSession (initialize, call) · PLAYS: one scripted play per task · scriptedTranscript()
 * @usage
 *   import { scriptedTranscript } from './scripted.js';
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { Task, TaskContext } from './tasks.js';
import { api } from './tasks.js';

type Ctx = Omit<TaskContext, 'metrics'>;

class McpSession {
    private sessionId: string | null = null;
    private nextId = 1;
    constructor(private readonly url: string, private readonly token: string) {}

    private async rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
        const res = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${this.token}`, ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        });
        this.sessionId = res.headers.get('mcp-session-id') ?? this.sessionId;
        const text = await res.text();
        // Streamable HTTP answers either plain JSON or one SSE `data:` frame.
        const payload = text.trimStart().startsWith('{') ? text : (text.split('\n').find(l => l.startsWith('data:')) ?? 'data:{}').slice(5);
        return JSON.parse(payload) as Record<string, unknown>;
    }

    async initialize(): Promise<void> {
        await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cold-agent-scripted', version: '1.0.0' } });
    }

    async call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
        const r = await this.rpc('tools/call', { name, arguments: args });
        const result = (r.result ?? {}) as { content?: { text?: string }[]; isError?: boolean };
        const text = (result.content ?? []).map(c => c.text ?? '').join('') || JSON.stringify(r.error ?? r);
        return { text, isError: result.isError === true || !!r.error };
    }
}

/** `args` may be built from what earlier steps answered, for a play whose ids come from the node. */
interface Step { tool: string; args: Record<string, unknown> | ((seen: string[]) => Record<string, unknown>) }

/** The first `"<field>": "<value>"` in a tool's JSON answer. */
const field = (text: string, name: string): string => new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`).exec(text)?.[1] ?? '';
interface Play { steps: (ctx: Ctx, seen: string[]) => Step[] | Promise<Step[]>; say: (ctx: Ctx, seen: string[]) => string }

const TIP_APP = (title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><h1>${title}</h1><label>Bill <input id="b" type="number"></label><label>Tip % <input id="t" type="number" value="10"></label><p id="o"></p><script>const f=()=>{o.textContent=(b.value*(1+t.value/100)).toFixed(2)};b.oninput=f;t.oninput=f;</script></body></html>`;

const PLAYS: Record<string, Play> = {
    'remember': {
        steps: (c) => [{ tool: 'aimeat_memory_write', args: { key: 'home.boiler-service', value: { servicedBy: c.marker, servicedOn: '2026-09-03', nextDue: '2027-09-03' } } }],
        say: () => 'Saved. I will remind you when the next service is due.',
    },
    'recall': {
        steps: () => [{ tool: 'aimeat_memory_search', args: { query: 'spare key' } }],
        say: (c, seen) => (seen.join(' ').includes(c.marker) ? `Your spare key is with ${c.marker} at number 12.` : 'I could not find a note about the spare key.'),
    },
    'what-apps': {
        steps: () => [{ tool: 'aimeat_app_list', args: { own: true } }],
        say: (c, seen) => {
            // On a node without app subdomains `url` is null and only the relative `download_url`
            // is there, so the address a person can open has to be put together from it.
            const paths = [...seen.join(' ').matchAll(/\/v1\/apps\/[A-Za-z0-9_.\-/]+\.html/g)].map(m => `${c.baseUrl}${m[0]}`).slice(0, 2);
            return `You have two apps: Sandbox hello and Sandbox notes. Open them at ${paths.join(' and ')}.`;
        },
    },
    'find-a-guide': {
        steps: () => [{ tool: 'aimeat_skill_list', args: {} }, { tool: 'aimeat_skill_get', args: { name: 'aimeat-phaser' } }],
        say: () => 'Yes: there is a guide here for building Phaser games, and I have read it.',
    },
    'tell-the-operators': {
        steps: (c) => [{ tool: 'aimeat_dm_send', args: { to: 'support@operators', subject: 'Password page is blank', body: `The change-password page shows a blank screen (${c.marker}).` } }],
        say: () => 'I have told the people who run this. They answer in Messages.',
    },
    'what-can-you-do': {
        steps: () => [{ tool: 'aimeat_handbook_get', args: { surface: 'agent' } }],
        say: () => 'I can remember things for you across conversations, keep track of tasks, share documents with people you choose, and build small apps you can open on your phone.',
    },
    'missing-record': {
        steps: (c) => [{ tool: 'aimeat_memory_search', args: { query: `${c.marker} warranty` } }],
        say: (c) => `I could not find anything saved about the ${c.marker} warranty.`,
    },
    'build-app': {
        steps: (c) => [{ tool: 'aimeat_app_publish', args: { filename: `${c.marker}.html`, name: c.marker, description: 'A small tip calculator.', category: 'tools', version: '1.0.0', content_base64: Buffer.from(TIP_APP(c.marker), 'utf8').toString('base64') } }],
        say: (c) => `Your tip calculator "${c.marker}" is published.`,
    },
    'share-to-workspace': {
        steps: (c) => [
            { tool: 'aimeat_organism_create', args: { name: `Family ${c.marker}`, description: 'Our family.' } },
            {
                tool: 'aimeat_workspace_create',
                args: (seen) => ({
                    organism_id: field(seen[0], 'id'), name: c.marker,
                    manifest: {
                        manifestVersion: '1.0', name: c.marker, kind: 'project', status: 'active',
                        objectTypes: [{ name: 'rules', schemaRef: 'schema:rules@1', namespace: 'shared.rules', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document' }],
                    },
                }),
            },
            {
                tool: 'aimeat_workspace_write',
                args: (seen) => ({ organism_id: field(seen[0], 'id'), ws: field(seen[1], 'ws'), space: 'rules', value: { title: 'House rules', markdown: '- Shoes off at the door\n- Quiet after ten\n- Whoever cooks does not wash up' } }),
            },
        ],
        say: (c) => `The house rules are written down in the workspace "${c.marker}". Your family can read them once you invite them to the group.`,
    },
};

const line = (o: unknown) => JSON.stringify(o);

export async function scriptedTranscript(task: Task, ctx: Ctx): Promise<string> {
    const out: string[] = [];
    const seen: string[] = [];
    const started = Date.now();

    if (task.door === 'url') {
        // Joining has no MCP session to script: it is three HTTP calls, shown as one shell tool each.
        const auth = await api<{ device_code: string; user_code: string }>(ctx.baseUrl, '/v1/agents/device-authorize', null, { method: 'POST', body: { agent_name: ctx.marker, owner: ctx.ownerName } });
        out.push(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'curl -X POST …/v1/agents/device-authorize' } }] } }));
        out.push(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: auth.status >= 300, content: JSON.stringify(auth.data) }] } }));
        let token: unknown = null;
        for (let i = 0; i < 10 && !token && auth.data; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const poll = await api<{ access_token?: string }>(ctx.baseUrl, '/v1/agents/device-token', null, { method: 'POST', body: { device_code: auth.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' } });
            token = poll.data?.access_token ?? null;
        }
        out.push(line({ type: 'result', subtype: 'success', num_turns: 2, duration_ms: Date.now() - started, result: token ? `I am connected as ${ctx.marker}.` : 'I asked to join; please approve me in your portal.' }));
        return out.join('\n');
    }

    // A skill case (`skill:<name>:<n>`) has one play: load the skill it names, or load nothing.
    const skill = /^skill:([^:]+):/.exec(task.id)?.[1];
    const skillPlay: Play | null = skill === undefined ? null : {
        steps: () => (skill === 'none' ? [] : [{ tool: 'aimeat_skill_list', args: {} }, { tool: 'aimeat_skill_get', args: { name: skill } }]),
        say: () => (skill === 'none' ? 'Done.' : `I have read the ${skill} guide.`),
    };
    const play = skillPlay ?? PLAYS[task.id];
    if (!play) throw new Error(`the scripted driver has no play for task ${task.id}`);
    const mcp = new McpSession(`${ctx.baseUrl}/v1/mcp`, ctx.agentToken);
    await mcp.initialize();
    let n = 0;
    for (const step of await play.steps(ctx, seen)) {
        const id = `t${++n}`;
        const args = typeof step.args === 'function' ? step.args(seen) : step.args;
        out.push(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__aimeat__${step.tool}`, input: args }] } }));
        const r = await mcp.call(step.tool, args);
        seen.push(r.text);
        out.push(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: r.isError, content: r.text }] } }));
    }
    out.push(line({ type: 'result', subtype: 'success', num_turns: n + 1, duration_ms: Date.now() - started, result: play.say(ctx, seen) }));
    return out.join('\n');
}
