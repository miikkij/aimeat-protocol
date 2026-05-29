/**
 * @file consent.ts
 * @description MCP consent tools and resource registrations. Provides 3 tools for consent
 *   management (grant, list, revoke) and 1 resource template for reading consent records
 *   via the MCP resource protocol.
 * @structure
 *   - registerConsentTools() — registers all consent tools and resources on an McpServer instance
 * @usage
 *   import { registerConsentTools } from './consent.js';
 *   registerConsentTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 3 tools + 1 resource for consent management via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';

export function registerConsentTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    /** Resolve owner GHII from agent GAII */
    function ownerGhii(): string {
        const parsed = parseGaiiLoose(agentGaii);
        return `${parsed.owner}@${config.nodeId}`;
    }

    // ── Resource: consent record ──
    mcp.registerResource(
        'consent-record',
        new ResourceTemplate('aimeat://consent/{id}', {
            list: async () => {
                const ghii = ownerGhii();
                const consents = await storage.listConsents(ghii);
                return {
                    resources: consents.map(c => ({
                        uri: `aimeat://consent/${encodeURIComponent(c.id)}`,
                        name: `${c.dataPattern} → ${c.recipient}`,
                        mimeType: 'application/json',
                        description: `Consent: ${c.purpose} (${c.status})`,
                    })),
                };
            },
        }),
        { mimeType: 'application/json', description: 'Consent record details' },
        async (uri, variables) => {
            const id = decodeURIComponent(variables.id as string);
            const consent = await storage.getConsent(id);
            if (!consent) return { contents: [{ uri: uri.toString(), text: 'Consent not found' }] };

            const ghii = ownerGhii();
            if (consent.ownerGaii !== ghii) {
                return { contents: [{ uri: uri.toString(), text: 'Access denied' }] };
            }

            return {
                contents: [{
                    uri: uri.toString(),
                    text: JSON.stringify({
                        id: consent.id,
                        data_pattern: consent.dataPattern,
                        recipient: consent.recipient,
                        purpose: consent.purpose,
                        scope: consent.scope,
                        expires: consent.expires,
                        status: consent.status,
                        granted_at: consent.grantedAt,
                        revoked_at: consent.revokedAt,
                        metadata: consent.metadata,
                    }, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    // ── Tool 1: aimeat_consent_grant ──
    mcp.tool(
        'aimeat_consent_grant',
        'Grant data access to another agent or recipient',
        {
            target_gaii: z.string().describe('Recipient GAII, "*", or prefixed identifier (organism.x, domain:x, node:x)'),
            scope: z.enum(['private', 'dmz', 'federation']).describe('Consent scope zone'),
            data_pattern: z.string().describe('Glob pattern for data keys (e.g. "profile.*")'),
            purpose: z.string().describe('Human-readable purpose for this consent'),
            ttl_hours: z.number().optional().describe('Expiry in hours from now (omit for indefinite)'),
        },
        annotationsFor('aimeat_consent_grant'),
        async ({ target_gaii, scope, data_pattern, purpose, ttl_hours }) => {
            const ghii = ownerGhii();

            // Quota check
            const existing = await storage.listConsents(ghii);
            if (existing.length >= 100) {
                return {
                    content: [{ type: 'text' as const, text: 'Quota exceeded: maximum 100 consent records' }],
                    isError: true,
                };
            }

            const now = new Date().toISOString();
            const expires = ttl_hours != null
                ? new Date(Date.now() + ttl_hours * 3_600_000).toISOString()
                : null;

            const id = randomBytes(16).toString('hex');
            const consent = await storage.createConsent({
                id,
                ownerGaii: ghii,
                dataPattern: data_pattern,
                recipient: target_gaii,
                purpose,
                scope,
                expires,
                status: 'active',
                grantedAt: now,
                revokedAt: null,
            });

            emitResourceListChanged(agentGaii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        consent_id: consent.id,
                        target_gaii: consent.recipient,
                        scope: consent.scope,
                        expires_at: consent.expires,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_consent_list ──
    mcp.tool(
        'aimeat_consent_list',
        'List own consent grants',
        {},
        annotationsFor('aimeat_consent_list'),
        async () => {
            const ghii = ownerGhii();
            const consents = await storage.listConsents(ghii);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(consents.map(c => ({
                        id: c.id,
                        data_pattern: c.dataPattern,
                        recipient: c.recipient,
                        purpose: c.purpose,
                        scope: c.scope,
                        expires: c.expires,
                        status: c.status,
                        granted_at: c.grantedAt,
                        revoked_at: c.revokedAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_consent_revoke ──
    mcp.tool(
        'aimeat_consent_revoke',
        'Revoke a consent grant',
        {
            consent_id: z.string().describe('ID of the consent to revoke'),
        },
        annotationsFor('aimeat_consent_revoke'),
        async ({ consent_id }) => {
            const consent = await storage.getConsent(consent_id);
            if (!consent) {
                return { content: [{ type: 'text' as const, text: 'Consent not found' }], isError: true };
            }

            const ghii = ownerGhii();
            if (consent.ownerGaii !== ghii) {
                return { content: [{ type: 'text' as const, text: 'Only the consent owner can revoke' }], isError: true };
            }

            const now = new Date().toISOString();
            await storage.updateConsent(consent_id, { status: 'revoked', revokedAt: now });

            emitResourceUpdated(agentGaii, `aimeat://consent/${encodeURIComponent(consent_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ revoked: true, consent_id, revoked_at: now }, null, 2),
                }],
            };
        },
    );
}
