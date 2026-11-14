/**
 * @file src/mcp/chat-tool-text.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node chat's start tools in short words. The chat lists its ~20 start tools on
 *   every model call, and their text was most of what each call paid for: 45 769 characters, about
 *   11 000 tokens, before the person said anything, of which aimeat_app_publish and
 *   aimeat_memory_write were a third, mostly the field-by-field text of `ai_provenance` (measured
 *   2026-10-31; aimeat-commercial measured 12.7k input tokens a call on the places). Jouni's cost
 *   order of 13.53 and v31 K63 asked for it to be cut.
 *
 *   ONLY WHAT IS LISTED CHANGES. The chat surface (/v2/mcp/chat) gets, for each start tool, the short
 *   description below when there is one, every parameter's text cut to its first sentence, and no
 *   text inside a parameter's own fields. The parameters, their types and their validation are the
 *   registered schema itself: the listed JSON is wrapped, the validator is not. Every other surface,
 *   /v1/mcp included, keeps the full text, and the full text of a tool stays one call away in the
 *   handbook and the skills.
 * @structure CHAT_TOOL_TEXT · listedForChat(json, params) · shortenChatTools(mcp, names)
 * @usage in createMcpServer, for role 'chat', after keepOnly(): shortenChatTools(mcp, toolsForSurface('chat'))
 * @version-history
 *   v1.2.0 — 2026-11-14 — aimeat_task_create gets a short text and leaves rules, verification,
 *     todos, resources and parent_task_id off the chat listing: the five fields the tool gained on
 *     2026-11-13 took the start set to 28 299 characters, over 26 000. aimeat_skill_get and
 *     aimeat_app_list get short texts too.
 *   v1.1.1 — 2026-11-10 — aimeat_memory_write's `patch` is listed as plain JSON with no words, as
 *     `value` is: its full text made the tool 1 128 characters on the chat surface, over 800.
 *   v1.1.0 — 2026-11-02 — aimeat_home_feed, a start tool since crew70.
 *   v1.0.0 — 2026-10-31 — Initial (v31 K63).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { registeredTools } from './sdk-seams.js';
import { logger } from '../utils/logger.js';

/**
 * A tool's short description on the chat surface, the parameters that get words of their own, and
 * the object parameters listed with only some of their fields (`fields`). The validator still takes
 * every field the registered schema takes; only the listing is smaller.
 */
export interface ChatToolText {
    description: string;
    /** Words of its own for a parameter; '' lists it with no words. */
    params?: Record<string, string>;
    fields?: Record<string, string[]>;
    /** Optional parameters the chat rarely needs, left off the listing; a call may still send them. */
    unlisted?: string[];
    /** A parameter listed in a simpler shape than it validates against, when the description says the rest. */
    plain?: Record<string, Record<string, unknown>>;
}

/** `ai_provenance` as the chat needs it: the two fields its short text names. */
const PROVENANCE_FIELDS = { ai_provenance: ['level', 'model'] };

/** The start tools whose own text is long enough to be worth a short version. */
export const CHAT_TOOL_TEXT: Record<string, ChatToolText> = {
    aimeat_app_publish: {
        description: 'Publish an HTML app as the new live version and get its address. Build it from a genre (aimeat_app_template_get, e.g. "genre-workbench") and keep its script tags. Pass the whole page as `content`. Give the person `url` from the answer.',
        params: {
            content: 'The whole HTML page.',
            ai_provenance: 'How it was made: { level: "ai-generated", model: your own model id }.',
        },
        fields: PROVENANCE_FIELDS,
        unlisted: ['owner', 'spec_token', 'spec_ack', 'ai_provenance_id', 'content_base64', 'cortex_agents', 'version', 'icon', 'tags', 'category'],
    },
    aimeat_memory_write: {
        description: 'Save a memory entry (any JSON) under `key`; writing the same key again updates it. `visibility`: private (default), owner, members, public, group (with group_id) or organism:<id>.',
        params: {
            ai_provenance: 'When a model wrote it: { level: "ai-generated", model: your own model id }; text a person wrote: { level: "original" }.',
            key: 'Such as "notes/today".',
            value: '', patch: '', visibility: '', tags: '',
        },
        fields: PROVENANCE_FIELDS,
        unlisted: ['ai_provenance_id', 'group_id', 'ttl_hours', 'owner_scope', 'expected_version'],
        // Any JSON, and one of the visibility words the description names.
        plain: { value: {}, patch: {}, visibility: { type: 'string' } },
    },
    aimeat_agent_propose: {
        description: 'Propose a new agent; nothing exists until the person approves it. Read first what it will work on (aimeat_organism_list, aimeat_workspace_list) and name that data in `purpose`. Send `crew_def` (the smallest that runs: {"agents":[{"role":"Reader","goal":"…","backstory":"…","tools":["memory"]}],"tasks":[{"id":"main","agent":"Reader","description":"… {{ctx.prompt}} …","expected_output":"…"}]}), the `scopes` the job needs (never more than you hold) and `schedule` for work on a clock. Give the person `approval_url` and `next_step` from the answer.',
    },
    // The plan, rules, checks and reading list a task may carry stay off the chat listing: a person
    // asking their chat for a task names what to do, and the agent plans it. A call may still send them.
    aimeat_task_create: {
        description: 'Queue a task for one of the person\'s agents (yourself or another agent of the same owner). The person sees it on their dashboard. `files` hands the agent documents to work on, as references, never bytes.',
        unlisted: ['rules', 'verification', 'todos', 'resources', 'parent_task_id'],
    },
    aimeat_skill_get: {
        description: 'Read one skill, the operating guide for one capability, by `name` or full `ref`. `body_only: true` gives its instructions alone; then `path` reads one file they point at.',
    },
    aimeat_app_list: {
        description: 'List the apps published on this node, each with its `url`: give the person that address to open one. `search` finds by words, `own: true` keeps to the person\'s own. Paged: call again with offset += limit while `has_more` is true.',
    },
    aimeat_handbook_get: {
        description: 'This node\'s guide. With no arguments: the guide for this chat and the node\'s skills, one line each. `tier: "build-app-atelier"` is the app build specification; `tier: "settings/concept.<word>"` explains one of this system\'s words.',
    },
    aimeat_connector_list: {
        description: 'The computers the person\'s agents run on: each one\'s name, whether it is connected now, and its agents. To the person say "computer" and its name, never its id.',
    },
    aimeat_memory_search: {
        description: 'Search your own memory by words; each hit is a snippet, not the whole value. Read a hit in full with aimeat_memory_read. `type` keeps to one kind of record, such as schema:Person.',
    },
    aimeat_workspace_read: {
        description: 'Read a workspace. Without `ids`: its index (spaces, locked schemas, every item\'s id and title). Then with `ids:[…]`: the full items you need.',
    },
    aimeat_home_feed: {
        description: 'What the person\'s home page shows: what has happened on their account, newest first. Read it when they ask what is on their home or what is new. Name an agent by `data.agent_shown_name` and give a time as `at_local` when a row has them.',
    },
    aimeat_discover: {
        description: 'Find what exists on this AIMEAT in one call: apps, memory, workspaces, knowledge, capabilities. `scope`: own (default), shared (the organisms the person belongs to) or public. `mode: "map"` gives counts first.',
    },
};

/** The first sentence of a text, at most 160 characters. "e.g." and "i.e." do not end one. */
export function firstSentence(text: string): string {
    const end = /[.!?](?=\s|$)/g;
    let cut = text;
    for (let m = end.exec(text); m; m = end.exec(text)) {
        if (/\b(?:e\.g|i\.e|etc|vs)$/i.test(text.slice(0, m.index))) continue;
        cut = text.slice(0, m.index + 1);
        break;
    }
    return cut.length > 160 ? `${cut.slice(0, 157).trimEnd()}…` : cut;
}

type Json = Record<string, unknown>;

/**
 * Every `description` below this node goes, the node's own included, and so does a length limit of
 * 200 or more, which tells a model nothing it would write past; validation still applies both.
 */
function dropTexts(node: unknown): void {
    if (Array.isArray(node)) { for (const n of node) dropTexts(n); return; }
    if (!node || typeof node !== 'object') return;
    const obj = node as Json;
    delete obj.description;
    if (typeof obj.maxLength === 'number' && obj.maxLength >= 200) delete obj.maxLength;
    for (const key of ['properties', 'patternProperties', '$defs', 'definitions']) {
        const group = obj[key];
        if (group && typeof group === 'object') for (const child of Object.values(group as Json)) dropTexts(child);
    }
    for (const key of ['items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'not']) dropTexts(obj[key]);
}

/**
 * The listed JSON Schema of one tool's input on the chat surface: each parameter keeps its type and
 * gets its own short text (from `params`) or the first sentence of its text, and nothing inside it
 * carries a text. Pure: the input is not changed.
 */
export function listedForChat(
    json: Json, params: Record<string, string> = {}, fields: Record<string, string[]> = {}, unlisted: string[] = [],
    plain: Record<string, Record<string, unknown>> = {},
): Json {
    const out = structuredClone(json);
    // The draft every tool names; a client reads the schema without it.
    delete out.$schema;
    const props = (out.properties ?? {}) as Record<string, Json>;
    const required = Array.isArray(out.required) ? out.required as string[] : [];
    // Only an optional parameter leaves the listing: a required one the model must see.
    for (const name of unlisted) if (!required.includes(name)) delete props[name];
    for (const [name, shape] of Object.entries(plain)) {
        if (props[name]) props[name] = { ...structuredClone(shape), ...(typeof props[name].description === 'string' ? { description: props[name].description } : {}) };
    }
    for (const [name, prop] of Object.entries(props)) {
        if (!prop || typeof prop !== 'object') continue;
        const own = typeof prop.description === 'string' ? prop.description : '';
        dropTexts(prop);
        const keep = fields[name];
        if (keep && prop.properties && typeof prop.properties === 'object') {
            const all = prop.properties as Json;
            prop.properties = Object.fromEntries(keep.filter(f => f in all).map(f => [f, all[f]]));
            if (Array.isArray(prop.required)) prop.required = (prop.required as string[]).filter(f => keep.includes(f));
        }
        const words = params[name] ?? (own ? firstSentence(own) : '');
        if (words) prop.description = words;
    }
    return out;
}

/** The Standard Schema shape the SDK reads: the validator, and the JSON it lists. */
interface StandardWithJson {
    '~standard': {
        version: number; vendor: string;
        validate: (value: unknown) => unknown;
        jsonSchema?: { input: (o?: unknown) => Json; output: (o?: unknown) => Json };
    };
}

/**
 * Give each named start tool its short text on this server. Returns how many were shortened. A tool
 * whose schema cannot list its JSON is left as it was, with a log line: a long text costs money, a
 * broken listing costs the tool.
 */
export function shortenChatTools(mcp: McpServer, names: Iterable<string>): number {
    const tools = registeredTools(mcp);
    let n = 0;
    for (const name of names) {
        const tool = tools[name] as unknown as { enabled: boolean; inputSchema?: StandardWithJson; update: (u: Record<string, unknown>) => void } | undefined;
        if (!tool || !tool.enabled) continue;
        const text = CHAT_TOOL_TEXT[name];
        const schema = tool.inputSchema;
        const std = schema?.['~standard'];
        try {
            const paramsSchema = std?.jsonSchema ? {
                '~standard': {
                    ...std,
                    validate: std.validate,
                    jsonSchema: {
                        input: (o?: unknown) => listedForChat(std.jsonSchema!.input(o), text?.params, text?.fields, text?.unlisted, text?.plain),
                        output: (o?: unknown) => std.jsonSchema!.output(o),
                    },
                },
            } : undefined;
            tool.update({ ...(text ? { description: text.description } : {}), ...(paramsSchema ? { paramsSchema } : {}) });
            n++;
        } catch (err) {
            logger.warn('[mcp-chat] a start tool keeps its full text', { tool: name, error: String(err) });
        }
    }
    return n;
}
