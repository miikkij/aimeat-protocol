/**
 * @file onboarding.ts
 * @description MCP tool registrations for Hello Integration onboarding status
 *   and API-confirmed onboarding steps.
 * @structure Registers status plus convenience confirmation tools for platform,
 *   skill bundle installation, directives, and optional service declarations.
 * @usage Called by the `aimeat connect serve` MCP server.
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add onboarding tools for connected agents
 *   v1.0.1 -- 2026-05-28 -- Describe Hello Integration as required first-run onboarding
 *   v2.0.0 -- 2026-05-29 -- Registry-driven, agent_name parameter
 *   v2.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v2.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { agentNameSchema, pickAgent } from './_registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

function asText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerOnboardingTools(mcp: McpServer, registry: AgentRegistry): void {

    mcp.tool('aimeat_onboarding_status', descriptionFor('aimeat_onboarding_status'), {
        agent_name: agentNameSchema,
    }, annotationsFor('aimeat_onboarding_status'), async ({ agent_name }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.get(`/v1/agents/${enc}/onboarding`);
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_identify_platform', descriptionFor('aimeat_onboarding_identify_platform'), {
        agent_name: agentNameSchema,
        platform: z.string().describe('Runtime/platform name, for example claude, openclaw, hermes, generic, or vscode'),
        platform_version: z.string().optional().describe('Runtime/platform version if known'),
        model: z.string().max(64).optional().describe('Primary LLM model driving this agent (e.g. claude-haiku-4.5, kimi-k2.6). Self-reported, indicative attribution only'),
    }, annotationsFor('aimeat_onboarding_identify_platform'), async ({ agent_name, platform, platform_version, model }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const body: Record<string, unknown> = { platform };
        if (platform_version) body.platform_version = platform_version;
        if (model) body.model = model;
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/identify_platform`, body);
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_confirm_skill_installed', descriptionFor('aimeat_onboarding_confirm_skill_installed'), {
        agent_name: agentNameSchema,
        platform: z.string().describe('Runtime/platform using the bundle, for example generic, claude, openclaw, or hermes'),
        version: z.string().describe('Bundle version if known; use local when no version is shown'),
    }, annotationsFor('aimeat_onboarding_confirm_skill_installed'), async ({ agent_name, platform, version }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/install_skill`, { platform, version });
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_confirm_directives_read', descriptionFor('aimeat_onboarding_confirm_directives_read'), {
        agent_name: agentNameSchema,
        confirmed: z.boolean().optional().describe('Set true after reading the handbook/directives'),
    }, annotationsFor('aimeat_onboarding_confirm_directives_read'), async ({ agent_name, confirmed }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/read_directives`, { confirmed: confirmed ?? true });
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_declare_services', descriptionFor('aimeat_onboarding_declare_services'), {
        agent_name: agentNameSchema,
        services: z.array(z.object({
            name: z.string().describe('Service name'),
            description: z.string().optional().describe('Short service description'),
        })).optional().describe('Services the agent wants to declare; empty is allowed'),
    }, annotationsFor('aimeat_onboarding_declare_services'), async ({ agent_name, services }) => {
        const { client, agent } = pickAgent(registry, agent_name);
        const enc = encodeURIComponent(agent);
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/declare_services`, { services: services ?? [] });
        return asText(resp.data ?? resp);
    });
}
