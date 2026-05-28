/**
 * @file onboarding.ts
 * @description MCP tool registrations for Hello Integration onboarding status
 *   and API-confirmed onboarding steps.
 * @structure Registers status plus convenience confirmation tools for platform,
 *   skill bundle installation, directives, and optional service declarations.
 * @usage Called by the `aimeat connect serve` MCP server.
 * @version-history v1.0.0 -- 2026-05-28 -- Add onboarding tools for connected agents.
 * @version-history v1.0.1 -- 2026-05-28 -- Describe Hello Integration as required first-run onboarding.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

function asText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerOnboardingTools(mcp: McpServer, client: AimeatClient, agentName: string): void {
    const enc = encodeURIComponent(agentName);

    mcp.tool('aimeat_onboarding_status', 'View required Hello Integration first-run onboarding status and next-step hints', {}, async () => {
        const resp = await client.get(`/v1/agents/${enc}/onboarding`);
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_identify_platform', 'Confirm the connected agent runtime/platform for Hello Integration', {
        platform: z.string().describe('Runtime/platform name, for example claude, openclaw, hermes, generic, or vscode'),
        platform_version: z.string().optional().describe('Runtime/platform version if known'),
    }, async ({ platform, platform_version }) => {
        const body: Record<string, unknown> = { platform };
        if (platform_version) body.platform_version = platform_version;
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/identify_platform`, body);
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_confirm_skill_installed', 'Confirm this skill bundle has been downloaded/extracted for Hello Integration', {
        platform: z.string().describe('Runtime/platform using the bundle, for example generic, claude, openclaw, or hermes'),
        version: z.string().describe('Bundle version if known; use local when no version is shown'),
    }, async ({ platform, version }) => {
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/install_skill`, { platform, version });
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_confirm_directives_read', 'Confirm the agent has read its AIMEAT handbook/directives', {
        confirmed: z.boolean().optional().describe('Set true after reading the handbook/directives'),
    }, async ({ confirmed }) => {
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/read_directives`, { confirmed: confirmed ?? true });
        return asText(resp.data ?? resp);
    });

    mcp.tool('aimeat_onboarding_declare_services', 'Optionally declare services/capabilities exposed by this agent', {
        services: z.array(z.object({
            name: z.string().describe('Service name'),
            description: z.string().optional().describe('Short service description'),
        })).optional().describe('Services the agent wants to declare; empty is allowed'),
    }, async ({ services }) => {
        const resp = await client.post(`/v1/agents/${enc}/onboarding/step/declare_services`, { services: services ?? [] });
        return asText(resp.data ?? resp);
    });
}