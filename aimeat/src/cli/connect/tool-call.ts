/**
 * @file tool-call.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shell fallback for connector tools. Provides `aimeat connect tools`,
 *   `aimeat connect schema`, and `aimeat connect call` for runtimes that can run
 *   commands but cannot use MCP directly.
 * @structure
 *   - CONNECT_CLI_TOOLS -- initial REST-backed tool catalog for Hello Integration
 *   - runToolList() -- prints CLI-callable tool names
 *   - runToolSchema() -- prints plain JSON input schema metadata
 *   - runToolCall() -- loads JSON input and invokes the matching REST-backed handler
 * @usage
 *   aimeat connect tools
 *   aimeat connect schema aimeat_onboarding_status
 *   aimeat connect call aimeat_message_send --json input.json
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add initial shell fallback for agent lifecycle tools
 *   v1.1.0 -- 2026-05-28 -- Read public tool metadata from the shared MCP catalog
 *   v1.2.0 -- 2026-05-28 -- Add app, extension, and cortex CLI fallback handlers
 *   v1.3.0 -- 2026-05-28 -- Add core memory, work, wallet, board, storage, and admin handlers
 *   v1.4.0 -- 2026-05-28 -- Add remaining connector MCP handlers to CLI fallback
 *   v1.5.0 -- 2026-05-28 -- Add memory tags and owner-scope listing support
 *   v1.6.0 -- 2026-06-09 -- Add organism WORKSPACE + organism create/backup shell handlers
 *     (workspace_list/read/write/publish/update/create/object_delete/access/transfer +
 *     organism_create/export/import), so no-LLM CrewAI crews can read/write organism workspaces via
 *     `aimeat connect call`. Thin REST wrappers, server-side authz unchanged. Guarded by
 *     test/unit/connector-cli-parity.test.ts.
 *   v1.8.0 -- 2026-08-01 -- TARGET-058 Phase 11: every definition is wrapped by
 *     withProvenanceCarrying(), so a caller's `ai_provenance` block is recorded, or reported as not
 *     recorded, instead of being dropped on the floor behind an ok:true.
 *   v1.7.0 -- 2026-07-13 -- Split tool definitions + shared helpers into sibling modules
 *     (tool-call-helpers.ts, tool-call-defs-{agent,core,organism,apps}.ts) to satisfy max-file-lines;
 *     CONNECT_CLI_TOOLS is now the concatenation of those groups (order preserved).
 *   v1.9.0 -- 2026-09-06 -- secretTools joins the table: the owner's vault on the THIRD surface,
 *     which is the one a fleet daemon actually calls and the one a new tool is forgotten on.
 *   v1.10.0 -- 2026-09-08 -- adminCliTools joins the table: the operator's CORS page in one read and
 *     the write that sets a person's or an agent's list, on the third surface from day one.
 *   v1.11.0 -- 2026-09-24 -- themeCliTools joins the table: the node's themes (Themes & Styles).
 *   v1.12.0 -- 2026-09-24 -- `connect call` goes through the running serve daemon when it serves the
 *     agent, and otherwise sends a credential asked for at that moment (a key mints) instead of the
 *     stored bearer by value. A crew ran this every five seconds with an agent whose stray bearer had
 *     expired, and the node refused it every time (production refusal log L-3).
 */

import { existsSync, readFileSync } from 'node:fs';
import { CLI_FALLBACK_TOOL_DEFINITIONS, getAimeatToolDefinition } from '../../mcp/catalog/definitions.js';
import type { AimeatClient, ApiResponse } from './api-client.js';
import { AimeatClient as Client } from './api-client.js';
import { loadConfig, loadAgentByName, type AimeatConnectConfig } from './config.js';
import { resolveToken } from './agent-key.js';
import { readLiveDiscovery } from './mcp/local-discovery.js';
import { LOOPBACK_REFUSAL } from './mcp/local-admission.js';
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { agentTools } from './tool-call-defs-agent.js';
import { coreTools } from './tool-call-defs-core.js';
import { boardTools } from './tool-call-defs-boards.js';
import { skillTools } from './tool-call-defs-skills.js';
import { secretTools } from './tool-call-defs-secrets.js';
import { organismTools } from './tool-call-defs-organism.js';
import { appTools } from './tool-call-defs-apps.js';
import { commerceCliTools } from './tool-call-defs-commerce.js';
import { packageTools } from './tool-call-defs-packages.js';
import { workflowTools } from './tool-call-defs-workflows.js';
import { aiJobTools } from './tool-call-defs-ai-jobs.js';
import { decideTools } from './tool-call-defs-decide.js';
import { voiceTools } from './tool-call-defs-ai-voice.js';
import { appDraftEditTools } from './tool-call-defs-app-draft-edit.js';
import { exchangeTools } from './tool-call-defs-exchange.js';
import { connectionCliTools } from './tool-call-defs-connections.js';
import { mcpProxyCliTools } from './tool-call-defs-mcp-proxy.js';
import { adminCliTools } from './tool-call-defs-admin.js';
import { themeCliTools } from './tool-call-defs-themes.js';
import { withProvenanceCarrying } from './ai-provenance-carry.js';

// The full tool catalog is assembled from sibling group modules, preserving declaration order.
//
// TARGET-058 Phase 11: every definition goes through withProvenanceCarrying(), which is where an
// `ai_provenance` block sent to a shell-callable tool is validated, recorded (or reported as not
// recorded), and echoed back. ONE wrapper rather than thirteen edited handlers — this dispatch table
// serves both `aimeat connect call` and `POST /local/call/:tool`, and a per-handler version would
// have left whichever one somebody forgot silently stripping the block, which is the bug being fixed.
export const CONNECT_CLI_TOOLS: ConnectCliToolDefinition[] = [
    ...agentTools,
    ...coreTools,
    ...boardTools,
    ...skillTools,
    ...secretTools,
    ...organismTools,
    ...appTools,
    ...commerceCliTools,
    ...packageTools,
    ...workflowTools,
    ...aiJobTools,
    ...decideTools,
    ...voiceTools,
    ...appDraftEditTools,
    ...exchangeTools,
    ...connectionCliTools,
    ...mcpProxyCliTools,
    ...adminCliTools,
    ...themeCliTools,
].map(withProvenanceCarrying).map(withDeclaredInputOnly);

/**
 * REFUSE A PARAMETER THIS TOOL DOES NOT DECLARE, instead of ignoring it.
 *
 * THE DEFECT THIS ENDS. A caller sent `deliverable_key` to aimeat_task_complete, got `ok: true`
 * back, and the pointer to its own output was gone: no error, no warning, no log line. The same
 * shape then repeated with `owner_scope` on the memory tools, and a crew's public mirror read only
 * its own namespace for weeks while every call it made succeeded. Silent loss is the whole problem;
 * a dropped parameter that ANSWERS is worse than one that refuses, because nobody investigates a
 * success.
 *
 * So the contract is enforced in one place, on the assembled table, exactly like
 * withProvenanceCarrying above — a per-handler version would have left whichever door somebody
 * forgot still swallowing the field, which is the bug, not the fix.
 *
 * A tool that declares NO input anywhere stays permissive: absence of a schema is not evidence that
 * a parameter is wrong, and guessing would refuse working calls.
 */
function withDeclaredInputOnly(tool: ConnectCliToolDefinition): ConnectCliToolDefinition {
    const declared = new Set<string>([
        ...Object.keys(tool.input ?? {}),
        ...Object.keys(getAimeatToolDefinition(tool.name)?.input ?? {}),
        // Handled by the wrapper above rather than by any handler.
        'ai_provenance', 'ai_provenance_id',
        // Chosen by the dispatcher, not forwarded as a field.
        'agent_name', 'response_format',
    ]);
    // Nothing to check against.
    if (declared.size <= 4) return tool;
    return {
        ...tool,
        handler: (ctx, input) => {
            const unknown = Object.keys(input ?? {}).filter(key => !declared.has(key));
            if (unknown.length) {
                const accepted = [...declared].filter(k => k !== 'ai_provenance' && k !== 'ai_provenance_id' && k !== 'response_format').sort();
                return Promise.resolve({ ok: false as const, error: {
                    code: 'UNKNOWN_PARAMETER',
                    message: `${tool.name} does not take ${unknown.map(u => `"${u}"`).join(', ')}. `
                        + `It takes: ${accepted.join(', ')}. `
                        + 'This is a refusal rather than a silent drop on purpose: a parameter that is ignored '
                        + 'while the call succeeds is how a caller loses data without ever being told.',
                    unknown_parameters: unknown,
                    accepted_parameters: accepted,
                } });
            }
            return tool.handler(ctx, input);
        },
    };
}

function getTool(name: string): ConnectCliToolDefinition | undefined {
    return CONNECT_CLI_TOOLS.find(tool => tool.name === name);
}

function getCliToolMetadata(name: string) {
    const definition = getAimeatToolDefinition(name);
    return definition?.visibility.cliFallback ? definition : undefined;
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

function loadJsonSource(flags: Record<string, string>): string | null {
    if (flags.stdin === 'true') return null;
    const source = flags.json ?? flags.data;
    if (!source || source === 'true') return '{}';
    const trimmed = source.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
    if (!existsSync(source)) throw new Error(`Input JSON file not found: ${source}`);
    return readFileSync(source, 'utf-8');
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
}

function expandFileReferences(value: unknown): unknown {
    if (typeof value === 'string' && value.startsWith('@file:')) {
        return readFileSync(value.slice('@file:'.length), 'utf-8');
    }
    if (Array.isArray(value)) return value.map(item => expandFileReferences(item));
    if (typeof value === 'object' && value !== null) {
        const expanded: JsonObject = {};
        for (const [key, child] of Object.entries(value)) expanded[key] = expandFileReferences(child);
        return expanded;
    }
    return value;
}

async function readInput(flags: Record<string, string>): Promise<JsonObject> {
    const raw = flags.stdin === 'true' ? await readStdin() : loadJsonSource(flags);
    const trimmed = raw?.trim() ?? '{}';
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Tool input must be a JSON object.');
    }
    return expandFileReferences(parsed) as JsonObject;
}

export function runToolList(flags: Record<string, string>): void {
    const tools = CLI_FALLBACK_TOOL_DEFINITIONS
        .filter(tool => tool.visibility.cliFallback)
        .map(tool => ({ name: tool.name, description: tool.description }));
    if (flags.json === 'true') {
        printJson({ tools });
        return;
    }
    for (const tool of tools) console.log(`${tool.name}\n  ${tool.description}`);
}

export function runToolSchema(toolName: string | undefined): void {
    if (!toolName) {
        console.error('Usage: aimeat connect schema <tool-name>');
        process.exitCode = 1;
        return;
    }
    const tool = getCliToolMetadata(toolName);
    if (!tool || !getTool(toolName)) {
        console.error(`Unknown CLI-callable tool: ${toolName}`);
        process.exitCode = 1;
        return;
    }
    printJson(tool);
}

/** The agent one `aimeat connect call` speaks as. */
interface CallTarget { agent: string; owner: string; node_url: string }

/**
 * THROUGH THE RUNNING DAEMON, when one in this connector home serves the agent. The daemon holds a
 * current credential for every agent it serves (minted from the key and renewed on its own), so a
 * call made through it never carries a stored bearer by value, and a crew that runs this command
 * every few seconds costs the node no mint and no refused request. It is one loopback POST to
 * `/local/call/<tool>`, the same dispatch table, with the daemon's secret from serve.json.
 *
 * Null when no live daemon serves the agent, when the daemon has gone away, when it refuses the
 * secret (a file from an earlier start) or no longer holds the agent: the caller then goes to the
 * node itself.
 */
async function callThroughServeDaemon(tool: string, target: CallTarget, input: JsonObject): Promise<ApiResponse | null> {
    const daemon = readLiveDiscovery();
    const row = daemon?.agents.find(a => a.agent === target.agent && a.owner === target.owner);
    if (!daemon || !row) return null;
    const loopback = new Client(`http://127.0.0.1:${daemon.port}`, daemon.secret);
    let answer: ApiResponse;
    try {
        answer = await loopback.post(`/local/call/${encodeURIComponent(tool)}?agent=${encodeURIComponent(row.gaii)}`, input);
    } catch (err) {
        console.error(`[connect] the serve daemon on port ${daemon.port} did not answer (${(err as Error).message}); calling the node directly`);
        return null;
    }
    const code = String(answer?.error?.code);
    const notForThisDaemon = (Object.values(LOOPBACK_REFUSAL) as string[]).includes(code) || code === 'UNKNOWN_AGENT';
    return notForThisDaemon ? null : answer;
}

/**
 * A client for the node itself, carrying a CURRENT credential: a key mints one, else the stored
 * bearer is read. It knows whose credential it carries, so it asks again at every send and keeps
 * the record of a credential the node refused (./refused-credentials.ts).
 */
async function directClient(target: CallTarget): Promise<AimeatClient> {
    const token = await resolveToken(target.agent, target.owner, target.node_url);
    if (!token) throw new Error(`No credential for ${target.agent}@${target.owner}. Run: npx aimeat connect`);
    return new Client(target.node_url, token, { agent: target.agent, owner: target.owner });
}

export async function runToolCall(toolName: string | undefined, flags: Record<string, string>): Promise<void> {
    if (!toolName) {
        console.error('Usage: aimeat connect call <tool-name> --json input.json');
        process.exitCode = 1;
        return;
    }
    const tool = getTool(toolName);
    const metadata = getCliToolMetadata(toolName);
    if (!tool || !metadata) {
        console.error(`Unknown CLI-callable tool: ${toolName}`);
        process.exitCode = 1;
        return;
    }

    try {
        // Per-agent selection: if --agent is passed, route the call through THAT agent's
        // token + node URL. Without --agent, fall back to the global "primary" config
        // for backward compatibility with single-agent installs. Without this, every
        // `connect call --agent foo` silently used the primary's token and the primary's
        // agent name in the REST path -- so a multi-agent install could not target a
        // specific agent at all (the call always ran as the primary).
        let target: CallTarget;
        let config: AimeatConnectConfig | { agent: string; owner: string; node_url: string };

        if (flags.agent) {
            const loaded = await loadAgentByName(flags.agent, flags.owner || undefined);
            if (!loaded) {
                throw new Error(`Agent "${flags.agent}" not found in connector. Run: aimeat connect list`);
            }
            target = { agent: loaded.agent, owner: loaded.owner, node_url: loaded.config.node_url };
            config = { agent: loaded.agent, owner: loaded.owner, node_url: loaded.config.node_url };
        } else {
            const cfg = loadConfig();
            if (!cfg) throw new Error('Not configured. Run: npx aimeat connect');
            target = { agent: cfg.agent, owner: cfg.owner, node_url: cfg.node_url };
            config = cfg;
        }

        const input = await readInput(flags);
        // Through the running daemon when it serves this agent; otherwise straight to the node with
        // a credential asked for now. Never a stored bearer by value: see callThroughServeDaemon.
        const response = await callThroughServeDaemon(tool.name, target, input)
            ?? await tool.handler({ client: await directClient(target), config, agentPath: encodeURIComponent(target.agent) }, input);
        if (!response.ok) {
            console.error(JSON.stringify(response.error ?? response, null, 2));
            process.exitCode = 1;
            return;
        }
        printJson(response.data ?? response);
    } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
    }
}
