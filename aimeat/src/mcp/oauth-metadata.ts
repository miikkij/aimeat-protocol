/**
 * @file src/mcp/oauth-metadata.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP OAuth discovery documents: the protected resource metadata of the origin and of
 *   the MCP endpoint (RFC 9728), and the authorization server metadata (RFC 8414) with the auth.md
 *   agent-registration block. Moved out of src/mcp/oauth.ts unchanged, to keep that file under the
 *   800-line limit.
 * @structure registerOAuthMetadataRoutes(router, config, storage)
 * @usage registerOAuthMetadataRoutes(router, config, storage) inside registerOAuthRoutes
 * @version-history
 *   v1.0.0 — 2026-10-27 — Moved from src/mcp/oauth.ts unchanged (max-file-lines; secaudit2026oct26).
 */
import { type Request, type Response, type Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { buildAgentAuthMetadata } from '../services/auth-md.js';
import { buildProtectedResourceMetadata, mcpResourceMetadata, MCP_RESOURCE_METADATA_PATH } from '../services/protected-resource.js';

export function registerOAuthMetadataRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // GET /.well-known/oauth-protected-resource — Resource metadata (RFC 9728)
    // MCP clients discover this URL from the WWW-Authenticate header on 401 responses.
    // It tells them WHERE the authorization server is and WHAT scopes are needed.
    //
    // Answered PER ORIGIN (services/protected-resource.ts). The apex keeps the document it has
    // always served; an app origin (`<sub>.apps.<apex>`) and a portfolio origin describe
    // themselves, because each is a distinct protected resource with its own grant and scopes.
    // Serving the apex's identifier there was a wrong answer: RFC 9728 §3.3 has the client reject
    // metadata whose `resource` is not the resource it is talking to.
    router.get('/.well-known/oauth-protected-resource', async (req: Request, res: Response) => {
        res.json(await buildProtectedResourceMetadata(req, config, storage));
    });

    // THE MCP ENDPOINT'S OWN DOCUMENT, at the address RFC 9728 gives a resource that has a path.
    // The bare URL above describes the ORIGIN; this one describes `${apex}/v1/mcp`, and it is the
    // one the 401 challenge names, so a client following the challenge reads a `resource` that
    // matches what it is talking to. Registered AFTER the bare path, which Express matches exactly,
    // so neither shadows the other.
    router.get(MCP_RESOURCE_METADATA_PATH, (_req: Request, res: Response) => {
        res.json(mcpResourceMetadata(config));
    });

    // GET /.well-known/oauth-authorization-server — OAuth metadata (RFC 8414), extended with
    // the agent-registration discovery of the auth.md convention (github.com/workos/auth.md):
    // `skill` points at the human/agent-readable /auth.md document, and `agent_auth` is the
    // machine-readable summary of how agents get identities on THIS node — the RFC 8628 device
    // flow (register → owner approval → claim), the Ed25519 re-auth token endpoint, revocation,
    // and the three identity types (GHII/GAII/GEAI) with their registration entry points.
    // Keep in sync with services/auth-md.ts, which narrates the same flow.
    router.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
        const baseUrl = config.baseUrl;
        res.json({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/v1/mcp/authorize`,
            token_endpoint: `${baseUrl}/v1/mcp/token`,
            registration_endpoint: `${baseUrl}/v1/mcp/register`,
            // A client may hand us an https URL as its `client_id` and let the document there say
            // who it is. Declared, because a client cannot try a mechanism it has no way to learn
            // about: without this line the only discoverable road in is the registration endpoint
            // above, which 2026-07-28 deprecates. Both work; this one stores nothing and goes stale
            // for nobody. → services/oauth-client-metadata.ts
            client_id_metadata_document_supported: true,
            revocation_endpoint: `${baseUrl}/v1/mcp/token/revoke`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['client_secret_post'],
            // PKCE with S256, which the MCP authorization spec has a client check for before it starts.
            // Required from 4.0.0, accepted without until then (mcp/oauth-binding.ts).
            code_challenge_methods_supported: ['S256'],
            // RFC 8707: a client names the resource it wants a token for, and the token names it back
            // as its audience. Not a registered RFC 8414 field; read by clients that look for it, and
            // harmless to the rest. The protected resource document names the identifier to send.
            resource_indicators_supported: true,
            scopes_supported: ['aimeat:full'],
            skill: `${baseUrl}/auth.md`,
            agent_auth: buildAgentAuthMetadata(config),
        });
    });
}
