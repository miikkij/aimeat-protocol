/**
 * @file consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP consent tools and resource registrations. Provides 3 tools for consent
 *   management (grant, list, revoke) and 1 resource template for reading consent records
 *   via the MCP resource protocol.
 * @structure
 *   - registerConsentTools() — registers all consent tools and resources on an McpServer instance
 * @usage
 *   import { registerConsentTools } from './consent.js';
 *   registerConsentTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged, scopes, caller);
 * @version-history
 *   2026-10-20 — consentCaller() files and checks a consent under the session's principal, as POST
 *     /v1/consent does: an agent's consent covers the agent's own records, and an agent revokes only
 *     its own rows. It used the owner's account GHII, so the tool reached the owner's whole namespace
 *     and revoked consents the owner had made in person (secaudit 2026-10, consent-identity).
 *   2026-10-15 — aimeat_consent_grant stamps how the consent was given (MCP tool call by an agent or
 *     the person), which the consent receipt reads (feature-list audit #161).
 *   2026-10-15 — The consent-record resource refuses another owner's record with resourceRefusal
 *     (ACCESS_DENIED and a next step) instead of the bare "Access denied" (feature-list audit #186).
 *   2026-10-15 — aimeat_consent_list lists the account's consents including those REST filed under one of
 *     its agents (feature-list audit 40).
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-03-21 — Initial creation: 3 tools + 1 resource for consent management via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.1 -- 2026-09-26 -- The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { grantConsent, revokeConsent, listAccountConsents, accountHoldsConsent } from '../services/consent-write.js';
import { consentCollectionMethod } from '../services/mydata-receipt.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';
import { resourceRefusal } from './resource-refusal.js';

export function registerConsentTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
    /** The session's own scopes. Unused here: the session caller below carries them. */
    _sessionScopes: string[] = [],
    /** The session's caller (services/caller-context.ts). Its scopes reach the shared service, where
     *  the gate lives, not only the registration filter, so a tool that is registered by mistake
     *  still meets the check. */
    caller: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();

    /** Resolve owner GHII from agent GAII */
    function ownerGhii(): string {
        return `${localAccountName(agentGaii)}@${config.nodeId}`;
    }

    /**
     * The consent services' caller: the SESSION'S PRINCIPAL, with this session's scopes and roles.
     *
     * The identity a consent is filed under is the identity whose data it covers, because every
     * access check reads the consents of the data's owner (services/consent.ts
     * checkConsentForRead). POST /v1/consent files under resolveIdentity, which for an agent token
     * is the agent's own GAII: an agent's consent covers the agent's own records (decision
     * 2026-10-02, 'consent stays per agent', routes/consent.ts).
     *
     * This function passed session.ownerGhii, the account GHII, until 2026-10-20. The same request
     * through this tool therefore covered every private record in the owner's own namespace, which
     * the REST route refuses for the same token, and revokeConsent's accountHoldsConsent admitted an
     * agent revoking a consent the owner had made in person (secaudit 2026-10, consent-identity).
     * aimeat_consent_list stays account-wide (ownerGhii): reading the account's consents is by design.
     */
    function consentCaller(): { ownerGaii: string; scopes: string[]; roles: string[]; collectionMethod: string } {
        const session = caller();
        return {
            ownerGaii: session.principal, scopes: [...session.scopes], roles: [...session.roles],
            // How it was given, for the consent receipt (feature-list audit #161).
            collectionMethod: consentCollectionMethod('mcp', session),
        };
    }

    // ── Resource: consent record ──
    mcp.registerResource(
        'consent-record',
        new ResourceTemplate('aimeat://consent/{id}', {
            list: async () => {
                const ghii = ownerGhii();
                const consents = await listAccountConsents(storage, ghii);
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
            if (!accountHoldsConsent(ghii, consent.ownerGaii)) {
                return resourceRefusal(uri, 'ACCESS_DENIED', 'This consent record belongs to someone else, so it cannot be read here. '
                    + 'List your own consent records instead.');
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
        descriptionFor('aimeat_consent_grant'),
        zodShapeFor('aimeat_consent_grant'),
        annotationsFor('aimeat_consent_grant'),
        async ({ target_gaii, scope, data_pattern, purpose, ttl_hours }) => {
            // ONE implementation (services/consent-write.ts). This tool used to build the record
            // itself, which is why it accepted a recipient no access check will ever match, wrote no
            // audit entry, and never refreshed the federation directory — three things the REST door
            // has always done for the same operation.
            const granted = await grantConsent({ storage, config }, consentCaller(), {
                recipient: target_gaii,
                dataPattern: data_pattern,
                purpose,
                scope,
                expires: ttl_hours != null ? new Date(Date.now() + ttl_hours * 3_600_000).toISOString() : null,
            });
            if (!granted.ok) {
                // Nothing was granted, and the owner was asked: the answer carries the request so the
                // agent can name it to them (services/consent-write.ts, recipient '*' publish gate).
                const asked = granted.publishRequest ? `\n${JSON.stringify({ publish_request: granted.publishRequest }, null, 2)}` : '';
                return { content: [{ type: 'text' as const, text: `${granted.code}: ${granted.message}${asked}` }], isError: true };
            }
            const consent = granted.value;

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
        descriptionFor('aimeat_consent_list'),
        zodShapeFor('aimeat_consent_list'),
        annotationsFor('aimeat_consent_list'),
        async () => {
            const ghii = ownerGhii();
            const consents = await listAccountConsents(storage, ghii);

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
        descriptionFor('aimeat_consent_revoke'),
        zodShapeFor('aimeat_consent_revoke'),
        annotationsFor('aimeat_consent_revoke'),
        async ({ consent_id }) => {
            // Same function the REST door calls: it owns the ownership check, the audit entry and
            // the directory refresh, so this door cannot be the one that forgets one of them.
            const revoked = await revokeConsent({ storage, config }, consentCaller(), consent_id);
            if (!revoked.ok) {
                return { content: [{ type: 'text' as const, text: `${revoked.code}: ${revoked.message}` }], isError: true };
            }
            const now = revoked.value.revokedAt;

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
