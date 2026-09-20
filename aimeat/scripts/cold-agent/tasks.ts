/**
 * @file scripts/cold-agent/tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tasks a cold agent is given, and how each one is judged.
 *
 *   A task is what a PERSON would say, in their words: no tool name, no key, no route. That is
 *   the point of the measurement. The instruction review of 2026-09-18 judged forty sources of
 *   agent-facing text by reading them, which finds what is false and says nothing about where an
 *   agent actually stumbles. Here the agent gets the node and a sentence, and the node is asked
 *   afterwards whether the thing happened.
 *
 *   JUDGING. `verify` asks the NODE, through REST as the owner, never the agent's own account of
 *   what it did: an agent that says "saved" and saved nothing is the failure this exists to see.
 *   Where the outcome is an answer rather than a record, the final text is checked for the fact
 *   it must contain. `goodTools` names the tools a well-guided run reaches for; a run that gets
 *   there through others still passes, and the report shows the detour.
 *
 *   MARKERS. Every task carries a string that occurs nowhere else on the node, so a verifier
 *   finds this run's result and not an earlier run's.
 * @structure Door · TaskContext · Task · TASKS · api()
 * @usage
 *   import { TASKS } from './tasks.js';
 * @version-history
 *   2026-09-19 — build-app passes only when the app is on the Atelier track with a register.
 *     Published used to be enough, and three Classic apps in a row counted as good.
 *   v1.0.0 — 2026-09-18 — Initial: ten tasks across memory, apps, skills, joining, asking the
 *     operators, orientation and a missing record.
 */
import type { RunMetrics } from './transcript.js';
import { appQuality, describeQuality, onAtelier } from './app-quality.js';

/** `mcp`: the agent is connected over MCP as the owner's agent. `url`: it gets the address only. */
export type Door = 'mcp' | 'url';

export interface TaskContext {
    baseUrl: string;
    ownerName: string;
    ownerToken: string;
    agentToken: string;
    /** A second person on the node, for a task where somebody else shares something. */
    otherOwnerName: string;
    otherOwnerToken: string;
    /** Unique to this run of this task. */
    marker: string;
    metrics: RunMetrics;
}

export interface Task {
    id: string;
    door: Door;
    /** What the person says. `{marker}` and `{baseUrl}` are filled in. */
    prompt: string;
    goodTools: string[];
    /** Left out of a run that names no tasks; asked for with `--tasks <id>`. */
    byNameOnly?: boolean;
    /** Runs before the agent starts, for a task that needs something to exist first. */
    setup?: (ctx: Omit<TaskContext, 'metrics'>) => Promise<void>;
    /** `note` is what a PASSING run is worth knowing about; the report lists it. */
    verify: (ctx: TaskContext) => Promise<{ ok: boolean; detail: string; note?: string }>;
}

export async function api<T = Record<string, unknown>>(baseUrl: string, path: string, token: string | null, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T | null }> {
    const res = await fetch(baseUrl + path, {
        method: init.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    try { return { status: res.status, data: (JSON.parse(text) as { data?: T }).data ?? null }; } catch { return { status: res.status, data: null }; }
}

/** `keep-app`: which app each run's setup picked, by the run's marker, for its verify to read. */
const keepAppTarget = new Map<string, string>();

/** Every record the owner can see, their agents' included, as one searchable string per record. */
async function ownerRecords(ctx: TaskContext): Promise<string[]> {
    const r = await api<{ items: unknown[] }>(ctx.baseUrl, '/v1/memory?owner_scope=true&limit=500', ctx.ownerToken);
    return (r.data?.items ?? []).map(i => JSON.stringify(i));
}

/** find-shared: a fact no other run shares (20 to 99, so never the 14 or the 18 of the date), and the organism to put away afterwards. */
const pierOf = (marker: string): string => String(20 + (parseInt(marker.replace(/[^0-9a-f]/g, '').slice(0, 6) || '0', 16) % 80));
const sharedOrgs = new Map<string, string>();

const says = (ctx: TaskContext, ...needles: string[]) => needles.every(n => ctx.metrics.finalText.toLowerCase().includes(n.toLowerCase()));

export const TASKS: Task[] = [
    {
        id: 'remember',
        door: 'mcp',
        prompt: 'Remember this for me: the boiler was serviced by {marker} on 3 September, and the next service is due in a year.',
        goodTools: ['aimeat_memory_write'],
        verify: async (ctx) => {
            const hit = (await ownerRecords(ctx)).find(r => r.includes(ctx.marker));
            return { ok: !!hit, detail: hit ? 'a record carries the fact' : 'no record on the node carries the fact' };
        },
    },
    {
        id: 'recall',
        door: 'mcp',
        prompt: 'Who has my spare key? I told you a while ago.',
        goodTools: ['aimeat_memory_search', 'aimeat_memory_list', 'aimeat_memory_read'],
        setup: async (ctx) => {
            await api(ctx.baseUrl, '/v1/memory', ctx.agentToken, { method: 'POST', body: { key: 'home.spare-key', value: { note: `The spare key is with ${ctx.marker} at number 12.` }, visibility: 'private' } });
        },
        verify: async (ctx) => ({ ok: says(ctx, ctx.marker), detail: says(ctx, ctx.marker) ? 'the answer names the holder' : 'the answer does not name the holder' }),
    },
    {
        id: 'share-to-workspace',
        door: 'mcp',
        prompt: 'Write down our house rules as a short document and share it with my family in a workspace called "{marker}". Make the workspace if it does not exist yet. The rules: shoes off at the door, quiet after ten, whoever cooks does not wash up.',
        goodTools: ['aimeat_organism_create', 'aimeat_workspace_create', 'aimeat_workspace_write', 'aimeat_workspace_publish'],
        verify: async (ctx) => {
            // By MEMBER. The unfiltered list carries public organisms only, and an agent asked to
            // share something with a family rightly makes a private one: the first baseline scored
            // this task 0 of 3 while all three workspaces existed.
            const orgs = await api<{ organisms: { id: string }[] }>(ctx.baseUrl, `/v1/organisms?member=${encodeURIComponent(ctx.ownerName)}`, ctx.ownerToken);
            for (const o of orgs.data?.organisms ?? []) {
                const ws = await api(ctx.baseUrl, `/v1/organisms/${o.id}/workspaces`, ctx.ownerToken);
                if (JSON.stringify(ws.data ?? '').includes(ctx.marker)) return { ok: true, detail: `workspace found in organism ${o.id}` };
            }
            return { ok: false, detail: 'no workspace by that name in any of the owner\'s organisms' };
        },
    },
    {
        // The fact lives in SOMEBODY ELSE's organism, which the person belongs to. Nothing of it is
        // in their own memory, so memory search finds nothing and the answer needs the shared scope.
        // Added 2026-09-19: none of the first ten tasks needed anything outside the owner's own store.
        id: 'find-shared',
        door: 'mcp',
        prompt: 'When is the spring meeting of the {marker} rowing club, and where? Somebody in the club wrote it down, I did not.',
        goodTools: ['aimeat_discover', 'aimeat_organism_list', 'aimeat_organism_search', 'aimeat_workspace_read'],
        setup: async (ctx) => {
            const must = (r: { status: number }, what: string) => { if (r.status >= 300) throw new Error(`find-shared setup: ${what} answered ${r.status}`); };
            const org = await api<{ organism: { id: string } }>(ctx.baseUrl, '/v1/organisms', ctx.otherOwnerToken, { method: 'POST', body: { name: `${ctx.marker} rowing club`, description: 'The members of the rowing club.', type: 'project', join_policy: 'open', visibility: 'private' } });
            must(org, 'creating the organism');
            const orgId = org.data!.organism.id;
            sharedOrgs.set(ctx.marker, orgId);
            const manifest = { manifestVersion: '1.0', id: orgId, name: 'Club notes', kind: 'project', status: 'active', objectTypes: [{ name: 'notes', schemaRef: 'schema:notes@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'document' }] };
            const ws = await api<{ ws?: string }>(ctx.baseUrl, `/v1/organisms/${orgId}/workspaces`, ctx.otherOwnerToken, { method: 'POST', body: { name: 'Club notes', manifest } });
            must(ws, 'creating the workspace');
            const wsId = ws.data?.ws;
            if (!wsId) throw new Error(`find-shared setup: the workspace answer carried no id: ${JSON.stringify(ws.data)}`);
            const key = `organism.${orgId}.w.${wsId}.shared.notes.spring-meeting.latest`;
            must(await api(ctx.baseUrl, '/v1/memory', ctx.otherOwnerToken, { method: 'POST', body: { key, value: { title: 'Spring meeting', markdown: `# Spring meeting\n\nThe spring meeting is on 14 May at 18:00, at pier ${pierOf(ctx.marker)} of the old harbour. Bring your membership card.` }, visibility: 'private' } }), 'writing the document');
            must(await api(ctx.baseUrl, `/v1/organisms/${orgId}/join`, ctx.ownerToken, { method: 'POST', body: {} }), 'joining');
            must(await api(ctx.baseUrl, `/v1/organisms/${orgId}/workspace-access`, ctx.ownerToken, { method: 'POST', body: { ws: wsId, message: 'member' } }), 'asking for workspace access');
            must(await api(ctx.baseUrl, `/v1/organisms/${orgId}/workspace-access/decision`, ctx.otherOwnerToken, { method: 'POST', body: { ws: wsId, requester: ctx.ownerName, decision: 'approve' } }), 'approving workspace access');
            // The task is only fair if the AGENT can reach it. Ask as the agent before it starts.
            const seen = await api<{ entries: unknown[] }>(ctx.baseUrl, '/v1/discover?scope=shared&per_page=100', ctx.agentToken);
            if (!JSON.stringify(seen.data?.entries ?? []).includes(key)) throw new Error(`find-shared setup: the agent cannot see the shared document (discover answered ${seen.status}), so the task would measure a permission and not the guidance`);
        },
        verify: async (ctx) => {
            const ok = says(ctx, pierOf(ctx.marker)) && says(ctx, '14');
            // Put the club away, or every later run walks one organism more and the numbers drift.
            const orgId = sharedOrgs.get(ctx.marker);
            if (orgId) await api(ctx.baseUrl, `/v1/organisms/${orgId}/archive`, ctx.otherOwnerToken, { method: 'POST', body: { level: 'organism' } });
            return { ok, detail: ok ? 'the answer gives the date and the pier' : `the answer lacks the date or pier ${pierOf(ctx.marker)}` };
        },
    },
    {
        id: 'build-app',
        door: 'mcp',
        prompt: 'Build me a small tip calculator and put it on my AIMEAT so I can open it on my phone. Call it "{marker}".',
        goodTools: ['aimeat_skill_get', 'aimeat_app_publish'],
        verify: async (ctx) => {
            const r = await api<{ apps: unknown[] }>(ctx.baseUrl, `/v1/apps?owner=${ctx.ownerName}`, ctx.ownerToken);
            const hit = (r.data?.apps ?? []).find(a => JSON.stringify(a).includes(ctx.marker)) as { filename?: string } | undefined;
            if (!hit?.filename) return { ok: false, detail: 'no published app carries the name' };
            // Published ON THE ATELIER TRACK is the pass, since 2026-09-19. Until then published was
            // enough, and three Classic apps in a row counted as good while the developer was being
            // handed exactly that and rejecting it. What else the app is like goes in the note.
            const quality = await appQuality(ctx.baseUrl, ctx.ownerName, hit.filename, ctx.metrics.toolCalls);
            const ok = onAtelier(quality);
            return { ok, detail: ok ? 'the app is published on the Atelier track' : 'the app is published, and it is not an Atelier app with a register', note: describeQuality(quality) };
        },
    },
    {
        // An app that NEEDS PARTS. The tip calculator is covered whole by the genre it forks, so
        // three measured runs read the Design Book zero times and that was the right answer; it
        // cannot show whether a builder looks in the book, uses the kit, or keeps a person's data
        // through the node's library. This one asks for four things no genre hands over as it is:
        // data that is kept, a list that is ticked, a number, and a chart.
        // Added 2026-09-19. It is NOT part of the ten-task baseline: run it by name.
        id: 'build-tracker',
        byNameOnly: true,
        door: 'mcp',
        prompt: 'Build me a habit tracker and put it on my AIMEAT. I add my habits, I tick them off each day, I see this week as a grid, my longest streak as one big number, and a small chart of the last thirty days. It has to remember everything when I come back tomorrow, on my phone too. Call it "{marker}".',
        goodTools: ['aimeat_skill_get', 'aimeat_designbook_search', 'aimeat_app_template_get', 'aimeat_app_publish'],
        verify: async (ctx) => {
            const r = await api<{ apps: unknown[] }>(ctx.baseUrl, `/v1/apps?owner=${ctx.ownerName}`, ctx.ownerToken);
            const hit = (r.data?.apps ?? []).find(a => JSON.stringify(a).includes(ctx.marker)) as { filename?: string } | undefined;
            if (!hit?.filename) return { ok: false, detail: 'no published app carries the name' };
            const quality = await appQuality(ctx.baseUrl, ctx.ownerName, hit.filename, ctx.metrics.toolCalls);
            const html = await fetch(`${ctx.baseUrl}/v1/apps/${encodeURIComponent(ctx.ownerName)}/${encodeURIComponent(hit.filename)}?mode=inline`).then(res => res.text());
            // "Remember everything, on my phone too" is the node's store, not the browser's.
            // Through any name the page gave the global: two of three runs wrote `var A = window.AIMEAT`
            // and `A.data.set(`, and the first version of this line failed both.
            const keepsOnNode = /\/v1\/libs\/aimeat-living\.js/.test(html)
                || (/\/v1\/libs\/aimeat-data\.js/.test(html) && /\b\w+\.data\.(set|get)\s*\(/.test(html));
            const ok = onAtelier(quality) && keepsOnNode;
            const why = !onAtelier(quality) ? 'it is not an Atelier app with a register' : 'it does not keep the habits on the node, so another device starts empty';
            // Nobody answers a headless run, so what can be measured is whether the builder SAID which
            // level it took, in the one message the owner gets.
            const saidLevel = /\b(prototype|ordinary page|the finest|level)\b/i.test(ctx.metrics.finalText);
            return { ok, detail: ok ? 'an Atelier app that keeps the habits on the node' : `the app is published, and ${why}`, note: `${describeQuality(quality)}; level ${saidLevel ? 'named' : 'NOT named'} to the owner; Book line ${/From the Design Book I take/i.test(ctx.metrics.finalText) ? 'said' : 'NOT said'}` };
        },
    },
    {
        // THE OTHER HALF OF THE BOOK GROWING BY ITSELF. `build-tracker` measures that a builder writes
        // down what it made by hand. This measures what happens when the owner then says the app
        // turned out well: is that recorded, is what was made offered to the Book as components, and
        // is each one judged general or special with a reason a person would agree with. It needs an
        // app a measured build left behind (one with `made` rows its owner has not kept), so it runs on
        // a sandbox that has run `build-tracker`, and each run takes the next such app.
        // PASS: the owner's word is recorded AND at least one component from that app is proposed with
        // a judgement, or the owner is told the Book already holds what the app made. Whether the
        // judgements are SENSIBLE is read by a person from the note.
        // MEASURED 2026-09-20, Opus, three runs each: 0/3 recorded the owner's word before the MCP
        // instructions named aimeat_designbook_keep (each thanked the person and called nothing);
        // 3/3 after, with four components published and one run rightly declining a duplicate.
        // Added 2026-09-20. By name only.
        id: 'keep-app',
        byNameOnly: true,
        door: 'mcp',
        prompt: 'The habit tracker you built me, "{marker}", turned out really well. I use it every day and I am happy with it.',
        goodTools: ['aimeat_app_list', 'aimeat_designbook_keep', 'aimeat_app_get', 'aimeat_designbook_propose'],
        setup: async (ctx) => {
            const q = await api<{ made?: Array<{ rows: Array<{ app: string; kept: boolean }> }> }>(ctx.baseUrl, '/v1/designbook?view=reasons', null);
            const rows = (q.data?.made ?? []).flatMap(m => m.rows);
            const mine = [...new Set(rows.filter(r => r.app.startsWith(`${ctx.ownerName}/ca-`)).map(r => r.app))];
            const open = mine.find(app => rows.filter(r => r.app === app).every(r => !r.kept));
            if (!open) throw new Error('keep-app setup: no measured build with hand-made parts is waiting for its owner\'s word. Run `--tasks build-tracker` first.');
            const filename = open.split('/')[1];
            const renamed = await api(ctx.baseUrl, `/v1/apps/${encodeURIComponent(filename)}`, ctx.ownerToken, { method: 'PATCH', body: { name: ctx.marker } });
            if (renamed.status >= 300) throw new Error(`keep-app setup: renaming ${filename} answered ${renamed.status}`);
            keepAppTarget.set(ctx.marker, filename);
        },
        verify: async (ctx) => {
            const filename = keepAppTarget.get(ctx.marker) ?? '';
            const q = await api<{ made?: Array<{ name: string; rows: Array<{ app: string; kept: boolean }> }> }>(ctx.baseUrl, '/v1/designbook?view=reasons', null);
            const made = (q.data?.made ?? []).filter(m => m.rows.some(r => r.app === `${ctx.ownerName}/${filename}`));
            const kept = made.length > 0 && made.every(m => m.rows.filter(r => r.app === `${ctx.ownerName}/${filename}`).every(r => r.kept));
            const list = await api<{ parts: Array<{ id: string; status: string }> }>(ctx.baseUrl, '/v1/designbook?kind=component&limit=200', ctx.ownerToken);
            const from: string[] = [];
            for (const row of list.data?.parts ?? []) {
                const one = await api<{ part: { status: string; body: { from_app?: string; judgement?: { reach: string; why: string } } } }>(ctx.baseUrl, `/v1/designbook/${row.id}`, ctx.ownerToken);
                const b = one.data?.part.body;
                if (b?.from_app === filename) from.push(`${row.id} [${b.judgement?.reach}, ${one.data?.part.status}] "${b.judgement?.why}"`);
            }
            const refused = ctx.metrics.toolCalls.filter(c => /designbook_propose/.test(c.name) && c.isError).length;
            // Offering nothing is right when the shelf already holds the part, IF the owner is told so:
            // the first measured run declined to put a second week grid beside the one on the shelf.
            const declined = from.length === 0 && /already (has|holds|carries|on the shelf)|duplicate|second,? near-identical|same thing/i.test(ctx.metrics.finalText);
            const ok = kept && (from.length > 0 || declined);
            const detail = ok ? (declined ? `the owner's word is recorded, and nothing was offered because the Book already holds what ${filename} made, which the owner was told`
                : `the owner's word is recorded and ${from.length} component(s) came out of ${filename}`)
                : !kept ? `the owner's word about ${filename} was not recorded (aimeat_designbook_keep)` : `kept, and nothing from ${filename} was offered to the Book`;
            return { ok, detail, note: `made by hand: ${made.map(m => m.name).join(', ') || 'nothing'}; offered: ${from.join(' · ') || 'nothing'}; proposals the bench refused on the way: ${refused}; the owner was told what went onto the shelf: ${/shelf|Design Book|component/i.test(ctx.metrics.finalText) ? 'yes' : 'NO'}` };
        },
    },
    {
        id: 'what-apps',
        door: 'mcp',
        prompt: 'Which apps do I have here, and how do I open them?',
        goodTools: ['aimeat_app_list'],
        verify: async (ctx) => {
            const ok = says(ctx, 'Sandbox hello', 'Sandbox notes') && /https?:\/\//.test(ctx.metrics.finalText);
            return { ok, detail: ok ? 'both apps named, with an address' : 'an app or the address is missing from the answer' };
        },
    },
    {
        id: 'find-a-guide',
        door: 'mcp',
        prompt: 'I want to make a little platform game for my kid. Is there anything here that tells you how to build one properly?',
        goodTools: ['aimeat_skill_list', 'aimeat_skill_get'],
        verify: async (ctx) => {
            // The person asked whether a guide EXISTS. Loading it proves that, and so does naming
            // it: the third baseline run found the whole Phaser chain through the app-building
            // overview and was scored a failure for not having opened it.
            const loaded = ctx.metrics.toolCalls.some(c => c.name === 'aimeat_skill_get' && !c.isError && /phaser|game/i.test(JSON.stringify(c.input)));
            const named = /aimeat-phaser|aimeat-game-apps/i.test(ctx.metrics.finalText);
            return { ok: loaded || named, detail: loaded ? 'a game skill was loaded' : named ? 'the game skill was named' : 'the node\'s game skills were never found' };
        },
    },
    {
        id: 'tell-the-operators',
        door: 'mcp',
        prompt: 'The page where I change my password just shows a blank screen ({marker}). Can you let the people who run this know?',
        goodTools: ['aimeat_dm_send'],
        verify: async (ctx) => {
            const sent = ctx.metrics.toolCalls.some(c => !c.isError && /support@operators/.test(JSON.stringify(c.input)) && JSON.stringify(c.input).includes(ctx.marker));
            return { ok: sent, detail: sent ? 'a message went to support@operators' : 'nothing was sent to support@operators' };
        },
    },
    {
        id: 'what-can-you-do',
        door: 'mcp',
        prompt: 'I just connected you to this. What can you actually do for me here?',
        goodTools: ['aimeat_handbook_get', 'aimeat_discover'],
        verify: async (ctx) => {
            // The point is that keeping what the person knows comes up, in whatever words. The
            // first Opus run said "hold your knowledge somewhere your AIs can reach it" and was
            // failed for not saying "memory", which is the word this task hopes it avoids.
            const ok = /\b(remember|memory|memories|knowledge|notes?|keep track|records?)\b/i.test(ctx.metrics.finalText);
            const plain = !/aimeat_[a-z_]+/.test(ctx.metrics.finalText);
            return { ok: ok && plain, detail: !ok ? 'the answer never mentions remembering things' : plain ? 'answered in the person\'s words' : 'the answer recites tool names at the person' };
        },
    },
    {
        id: 'missing-record',
        door: 'mcp',
        prompt: 'Read me what I saved about the {marker} warranty.',
        goodTools: ['aimeat_memory_search'],
        verify: async (ctx) => {
            const honest = /(no|not|nothing|couldn't|could not|can't find|cannot find|don't see)/i.test(ctx.metrics.finalText);
            // Calls to the NODE. ToolSearch is the client loading a tool definition, and an agent
            // that loads three tools one at a time has not searched the node three times.
            const nodeCalls = ctx.metrics.toolCalls.filter(c => c.name !== 'ToolSearch').length;
            const calm = nodeCalls <= 6;
            return { ok: honest && calm, detail: !honest ? 'the answer does not say the record is missing' : calm ? `said so after ${nodeCalls} call(s) to the node` : `said so after ${nodeCalls} calls to the node` };
        },
    },
    {
        id: 'join-as-agent',
        door: 'url',
        prompt: 'This is my AIMEAT: {baseUrl} and my username there is {ownerName}. Connect yourself to it as my agent, under the name "{marker}". Tell me if you need me to approve something; I am at the screen.',
        goodTools: [],
        verify: async (ctx) => {
            const r = await api<{ agents: { name: string }[] }>(ctx.baseUrl, '/v1/agents', ctx.ownerToken);
            const hit = (r.data?.agents ?? []).some(a => a.name === ctx.marker);
            return { ok: hit, detail: hit ? 'the agent exists under the owner' : 'no such agent under the owner' };
        },
    },
];
