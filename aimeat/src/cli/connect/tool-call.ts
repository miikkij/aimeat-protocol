/**
 * @file tool-call.ts
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
 */

import { existsSync, readFileSync } from 'node:fs';
import { CLI_FALLBACK_TOOL_DEFINITIONS, getAimeatToolDefinition } from '../../mcp/catalog/definitions.js';
import type { AimeatClient } from './api-client.js';
import { AimeatClient as Client } from './api-client.js';
import { loadConfig, loadAgentByName, type AimeatConnectConfig } from './config.js';
import type { JsonObject, ConnectCliToolDefinition } from './tool-call-helpers.js';
import { agentTools } from './tool-call-defs-agent.js';
import { coreTools } from './tool-call-defs-core.js';
import { organismTools } from './tool-call-defs-organism.js';
import { appTools } from './tool-call-defs-apps.js';
import { exchangeTools } from './tool-call-defs-exchange.js';
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
    ...organismTools,
    ...appTools,
    ...exchangeTools,
].map(withProvenanceCarrying);

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
        let agentName: string;
        let owner: string;
        let client: AimeatClient;
        let config: AimeatConnectConfig | { agent: string; owner: string; node_url: string };

        if (flags.agent) {
            const loaded = await loadAgentByName(flags.agent, flags.owner || undefined);
            if (!loaded) {
                throw new Error(`Agent "${flags.agent}" not found in connector. Run: aimeat connect list`);
            }
            agentName = loaded.agent;
            owner = loaded.owner;
            client = new Client(loaded.config.node_url, loaded.token);
            config = { agent: loaded.agent, owner: loaded.owner, node_url: loaded.config.node_url };
        } else {
            const cfg = loadConfig();
            if (!cfg) throw new Error('Not configured. Run: npx aimeat connect');
            agentName = cfg.agent;
            owner = cfg.owner;
            client = await Client.fromConfig();
            config = cfg;
        }

        void owner; // reserved for future per-tool authorization checks
        const input = await readInput(flags);
        const response = await tool.handler({ client, config, agentPath: encodeURIComponent(agentName) }, input);
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
