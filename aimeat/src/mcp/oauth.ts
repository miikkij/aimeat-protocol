/**
 * @file src/mcp/oauth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP OAuth 2.1 endpoints (Dynamic Client Registration, authorize, browser consent,
 *   approval check, token exchange/refresh, revocation, RFC 8414/9728 metadata). Extracted from
 *   src/mcp/index.ts to satisfy max-file-lines. Authorization codes stay in-memory (short-lived,
 *   single-use); clients, refresh tokens, and approvals are persisted to storage.
 * @structure
 *   - registerOAuthRoutes() — registers all OAuth 2.1 routes on the MCP router
 * @usage
 *   import { registerOAuthRoutes } from './oauth.js';
 *   registerOAuthRoutes(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-08-10 — Both mints stamp the agent's own scopes. Omitting them meant a wildcard,
 *     so every MCP OAuth session ignored the per-tool scope filter written for exactly that surface.
 *   v1.4.0 — 2026-07-28 — /.well-known/oauth-protected-resource answers per ORIGIN
 *     (services/protected-resource.ts): an app origin names itself, its app and its declared
 *     scopes instead of the apex MCP endpoint. Apex response unchanged.
 *   v1.3.0 — 2026-07-14 — agent_auth object construction moved to services/auth-md.ts
 *     (buildAgentAuthMetadata) — /auth.md embeds the same block inline, one source of truth
 *   v1.2.0 — 2026-07-14 — agent_auth carries its own `skill` field (isitagentready expects it
 *     inside the block, not only at the metadata top level)
 *   v1.1.0 — 2026-07-14 — RFC 8414 metadata extended with the auth.md convention: `skill`
 *     pointer to /auth.md + `agent_auth` block (device-flow URIs, identity types GHII/GAII/GEAI,
 *     credential types, approval + default scopes) (agent readiness)
 *   v1.0.0 — 2026-07-13 — Extracted from src/mcp/index.ts (max-file-lines)
 */

import { type Request, type Response, type Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { issueJWT } from '../auth/jwt.js';
import { verify } from '../auth/keypair.js';
import { parseGAII } from '../utils/gaii.js';
import { buildAgentAuthMetadata } from '../services/auth-md.js';
import { buildProtectedResourceMetadata } from '../services/protected-resource.js';

// OAuth 2.1 — authorization codes stay in-memory (short-lived, single-use).
// Clients, refresh tokens, and approvals are persisted to storage.
interface AuthorizationCode {
    code: string;
    clientId: string;
    clientName?: string;
    gaii: string;
    owner: string;
    roles: string[];
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    expiresAt: number;
}

/** SHA-256 hash a raw token for storage lookup */
function hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

/** Register the OAuth 2.1 endpoints on the MCP router. */
export function registerOAuthRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
    // OAuth 2.1 — only auth codes are in-memory (short-lived, single-use)
    const authCodes = new Map<string, AuthorizationCode>();

    // ── OAuth 2.1 Endpoints ──

    // POST /v1/mcp/register — Dynamic Client Registration (RFC 7591)
    router.post('/v1/mcp/register', async (req: Request, res: Response) => {
        const { client_name, redirect_uris } = req.body ?? {};

        if (!client_name) {
            res.status(400).json({ error: 'invalid_request', error_description: 'client_name is required' });
            return;
        }

        const redirectUris = Array.isArray(redirect_uris) ? redirect_uris : [];
        const clientId = `mcp-client-${randomBytes(16).toString('hex')}`;
        const clientSecret = randomBytes(32).toString('hex');

        await storage.createOAuthClient({
            clientId,
            clientSecret: hashToken(clientSecret),
            clientName: client_name,
            redirectUris,
            createdAt: new Date().toISOString(),
        });

        res.status(201).json({
            client_id: clientId,
            client_secret: clientSecret,
            client_name,
            redirect_uris: redirectUris,
            token_endpoint_auth_method: 'client_secret_post',
            grant_types: ['authorization_code', 'refresh_token'],
        });
    });

    // GET /v1/mcp/authorize — Authorization endpoint (dual-path: signature or browser consent)
    router.get('/v1/mcp/authorize', async (req: Request, res: Response) => {
        const q = (key: string) => { const v = req.query[key]; return Array.isArray(v) ? v[0] as string : v as string | undefined; };
        const clientId = q('client_id')!;
        const redirectUri = q('redirect_uri')!;
        const responseType = q('response_type')!;
        const state = q('state');
        const scope = q('scope');
        const codeChallenge = q('code_challenge');
        const codeChallengeMethod = q('code_challenge_method');
        const gaii = q('gaii');
        const signature = q('signature');
        const timestamp = q('timestamp');

        if (responseType !== 'code') {
            res.status(400).json({ error: 'unsupported_response_type', error_description: 'Only "code" is supported' });
            return;
        }

        // PKCE validation (OAuth 2.1 requires S256)
        if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
            res.status(400).json({ error: 'invalid_request', error_description: 'Only S256 code_challenge_method is supported' });
            return;
        }

        if (!clientId) {
            res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
            return;
        }

        const client = await storage.getOAuthClient(clientId);
        if (!client) {
            res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
            return;
        }

        if (redirectUri && client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
            res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
            return;
        }

        // === PATH A: Direct agent auth (CLI/Code agents with private key) ===
        if (gaii && signature && timestamp) {
            const parsed = parseGAII(gaii);
            if (!parsed) {
                res.status(400).json({ error: 'invalid_request', error_description: 'Invalid GAII format' });
                return;
            }

            const agent = await storage.getAgent(gaii);
            if (!agent) {
                res.status(400).json({ error: 'invalid_request', error_description: 'Agent not found' });
                return;
            }

            const message = gaii + config.nodeId + timestamp;
            const isValid = await verify(agent.publicKey, message, signature);
            if (!isValid) {
                res.status(401).json({ error: 'access_denied', error_description: 'Invalid signature' });
                return;
            }

            // Issue authorization code directly
            const code = randomBytes(32).toString('hex');
            const authCode: AuthorizationCode = {
                code,
                clientId,
                clientName: client.clientName,
                gaii,
                owner: parsed.owner,
                roles: ['agent'],
                redirectUri: redirectUri ?? client.redirectUris[0] ?? '',
                codeChallenge,
                codeChallengeMethod: codeChallenge ? 'S256' : undefined,
                expiresAt: Date.now() + 600_000,
            };
            authCodes.set(code, authCode);

            if (redirectUri) {
                const url = new URL(redirectUri);
                url.searchParams.set('code', code);
                if (state) url.searchParams.set('state', state);
                res.redirect(302, url.toString());
            } else {
                res.json({ code, state });
            }
            return;
        }

        // === PATH B: Browser consent flow (Claude.ai Connectors, ChatGPT, etc.) ===
        // Redirect to consent page where user logs in and selects which agent to authorize
        const consentUrl = new URL('/v1/oauth/consent', `${req.protocol}://${req.get('host')}`);
        consentUrl.searchParams.set('client_id', clientId);
        consentUrl.searchParams.set('client_name', client.clientName);
        if (redirectUri) consentUrl.searchParams.set('redirect_uri', redirectUri);
        if (state) consentUrl.searchParams.set('state', state);
        if (scope) consentUrl.searchParams.set('scope', scope);
        if (codeChallenge) consentUrl.searchParams.set('code_challenge', codeChallenge);
        res.redirect(302, consentUrl.toString());
    });

    // POST /v1/mcp/authorize-consent — Browser consent form submission
    // Called by the consent page after user logs in, selects an agent, and clicks "Approve"
    router.post('/v1/mcp/authorize-consent', async (req: Request, res: Response) => {
        const { client_id, client_name: clientNameBody, redirect_uri, state, gaii, owner_token, code_challenge } = req.body ?? {};

        if (!client_id || !gaii || !owner_token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'Missing required fields (client_id, gaii, owner_token)' });
            return;
        }

        const client = await storage.getOAuthClient(client_id);

        // If client not found (e.g. server restarted since registration), allow consent
        // to proceed — we still verify owner JWT + agent ownership below.
        // Validate redirect_uri against registered URIs when available.
        const finalRedirect = redirect_uri ?? client?.redirectUris[0];
        if (client && finalRedirect && client.redirectUris.length > 0 && !client.redirectUris.includes(finalRedirect)) {
            res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
            return;
        }
        // Fail fast (clear 400, not a 500) if a redirect_uri was supplied but is not a
        // parseable absolute URL — otherwise `new URL(finalRedirect)` below throws an
        // unhandled TypeError, surfacing as INTERNAL_ERROR / "[object Object]" to the client.
        if (finalRedirect) {
            try { new URL(finalRedirect); }
            catch {
                res.status(400).json({ error: 'invalid_request', error_description: `Invalid redirect_uri: ${String(finalRedirect)}` });
                return;
            }
        }

        // Verify owner's JWT (the browser session token)
        let ownerPayload;
        try {
            const { verifyJWT } = await import('../auth/jwt.js');
            ownerPayload = await verifyJWT(owner_token);
        } catch {
            res.status(401).json({ error: 'access_denied', error_description: 'Invalid or expired session' });
            return;
        }
        if (!ownerPayload || !ownerPayload.owner) {
            res.status(401).json({ error: 'access_denied', error_description: 'Invalid session token' });
            return;
        }

        // Verify the agent belongs to this owner
        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(400).json({ error: 'invalid_request', error_description: 'Agent not found' });
            return;
        }
        if (agent.owner !== ownerPayload.owner) {
            res.status(403).json({ error: 'access_denied', error_description: 'Agent does not belong to you' });
            return;
        }

        // Issue authorization code
        const parsed = parseGAII(gaii);
        const code = randomBytes(32).toString('hex');
        const resolvedClientName = clientNameBody || client?.clientName || client_id;
        authCodes.set(code, {
            code,
            clientId: client_id,
            clientName: resolvedClientName,
            gaii,
            owner: parsed?.owner || agent.owner,
            roles: ['agent'],
            redirectUri: finalRedirect ?? '',
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge ? 'S256' : undefined,
            expiresAt: Date.now() + 600_000,
        });

        // Remember this approval so future authorizations skip the consent screen
        await storage.createOAuthApproval({
            clientId: client_id,
            gaii,
            owner: parsed?.owner || agent.owner,
            scope: 'aimeat:full',
            approvedAt: new Date().toISOString(),
        });

        // Build redirect URL with authorization code
        if (finalRedirect) {
            const url = new URL(finalRedirect);
            url.searchParams.set('code', code);
            if (state) url.searchParams.set('state', state);

            // If caller wants JSON (fetch from consent page), return redirect_url
            // If caller is a form POST or non-JSON, do a 302 redirect
            const acceptsJson = req.headers.accept?.includes('application/json')
                || req.headers['content-type']?.includes('application/json');
            if (acceptsJson) {
                res.json({ redirect_url: url.toString() });
            } else {
                res.redirect(302, url.toString());
            }
        } else {
            res.json({ code, state });
        }
    });

    // GET /v1/mcp/approval-check — Check if a client+agent pair has a remembered approval
    // Used by the consent page to auto-submit when the user has previously approved this client
    router.get('/v1/mcp/approval-check', async (req: Request, res: Response) => {
        const rawClientId = req.query.client_id; const clientId = (Array.isArray(rawClientId) ? rawClientId[0] : rawClientId) as string;
        const rawGaii = req.query.gaii; const gaii = (Array.isArray(rawGaii) ? rawGaii[0] : rawGaii) as string;
        if (!clientId || !gaii) {
            res.json({ approved: false });
            return;
        }
        const approval = await storage.getOAuthApproval(clientId, gaii);
        res.json({ approved: !!approval });
    });

    // POST /v1/mcp/token — Token exchange endpoint
    router.post('/v1/mcp/token', async (req: Request, res: Response) => {
        const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token, code_verifier } = req.body ?? {};

        if (grant_type === 'authorization_code') {
            if (!code || !client_id) {
                res.status(400).json({ error: 'invalid_request', error_description: 'code and client_id are required' });
                return;
            }

            const client = await storage.getOAuthClient(client_id);
            if (client && client_secret && client.clientSecret !== hashToken(client_secret)) {
                res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials' });
                return;
            }

            const authCode = authCodes.get(code);
            if (!authCode) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
                return;
            }

            // Code is single-use
            authCodes.delete(code);

            if (authCode.expiresAt < Date.now()) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
                return;
            }

            if (authCode.clientId !== client_id) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Code was issued to a different client' });
                return;
            }

            // PKCE validation (OAuth 2.1 §4.4.3)
            if (authCode.codeChallenge) {
                if (!code_verifier) {
                    res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier is required (PKCE)' });
                    return;
                }
                const computed = createHash('sha256').update(code_verifier).digest('base64url');
                if (computed !== authCode.codeChallenge) {
                    res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code_verifier does not match code_challenge' });
                    return;
                }
            }

            // redirect_uri must match if it was provided during authorization (OAuth 2.1 §4.1.3)
            if (authCode.redirectUri && redirect_uri && authCode.redirectUri !== redirect_uri) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request' });
                return;
            }

            // Issue access + refresh tokens (JWT-based access token)
            // The agent's OWN scopes, stamped explicitly. Omitting them used to mean
            // issueJWT's `?? ['*']` default, so every MCP OAuth session was a wildcard — which
            // makes the per-tool scope filter in catalog/scopes.ts decorative on exactly the
            // surface it was written for.
            const codeAgent = await storage.getAgent(authCode.gaii);
            const accessToken = await issueJWT({
                sub: authCode.gaii,
                owner: authCode.owner,
                node: config.nodeId,
                roles: authCode.roles,
                scopes: codeAgent?.defaultScopes ?? config.defaultAgentScopes,
                mcp_client: authCode.clientName || client_id,
            }, config.jwtTtlSeconds);

            const refreshTok = randomBytes(32).toString('hex');

            // Persist refresh token (hashed) to storage
            await storage.createOAuthRefreshToken({
                tokenHash: hashToken(refreshTok),
                clientId: client_id,
                gaii: authCode.gaii,
                owner: authCode.owner,
                roles: authCode.roles,
                createdAt: new Date().toISOString(),
            });

            res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: config.jwtTtlSeconds,
                refresh_token: refreshTok,
                scope: 'aimeat:full',
            });

        } else if (grant_type === 'refresh_token') {
            if (!refresh_token || !client_id) {
                res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token and client_id required' });
                return;
            }

            const client = await storage.getOAuthClient(client_id);
            if (client && client_secret && client.clientSecret !== hashToken(client_secret)) {
                res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials' });
                return;
            }

            const existing = await storage.getOAuthRefreshToken(hashToken(refresh_token));
            if (!existing || existing.clientId !== client_id) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
                return;
            }

            // Rotate: revoke old, issue new
            await storage.deleteOAuthRefreshToken(hashToken(refresh_token));

            // A refresh must not widen what the original grant carried.
            const refreshAgent = await storage.getAgent(existing.gaii);
            const newAccessToken = await issueJWT({
                sub: existing.gaii,
                owner: existing.owner,
                node: config.nodeId,
                roles: existing.roles,
                scopes: refreshAgent?.defaultScopes ?? config.defaultAgentScopes,
            }, config.jwtTtlSeconds);

            const newRefreshTok = randomBytes(32).toString('hex');

            await storage.createOAuthRefreshToken({
                tokenHash: hashToken(newRefreshTok),
                clientId: client_id,
                gaii: existing.gaii,
                owner: existing.owner,
                roles: existing.roles,
                createdAt: new Date().toISOString(),
            });

            res.json({
                access_token: newAccessToken,
                token_type: 'Bearer',
                expires_in: config.jwtTtlSeconds,
                refresh_token: newRefreshTok,
                scope: 'aimeat:full',
            });

        } else {
            res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Supported: authorization_code, refresh_token' });
        }
    });

    // POST /v1/mcp/token/revoke — Token revocation (RFC 7009)
    router.post('/v1/mcp/token/revoke', async (req: Request, res: Response) => {
        const { token, token_type_hint } = req.body ?? {};

        if (!token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
            return;
        }

        // Try as access token (JWT) — add to JWT revocation list
        if (token_type_hint !== 'refresh_token') {
            try {
                const { verifyJWT, revokeToken } = await import('../auth/jwt.js');
                const payload = await verifyJWT(token);
                if (payload && payload.exp) {
                    await revokeToken(token, payload.exp);
                    res.status(200).json({ revoked: true });
                    return;
                }
            // eslint-disable-next-line aimeat/no-silent-catch -- not a valid JWT, try as refresh token
            } catch { /* not a valid JWT, try as refresh token */ }
        }

        // Try as refresh token (hash and look up in storage)
        const deleted = await storage.deleteOAuthRefreshToken(hashToken(token));
        if (deleted) {
            res.status(200).json({ revoked: true });
            return;
        }

        // RFC 7009: always return 200, even if token not found
        res.status(200).json({ revoked: true });
    });

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
            revocation_endpoint: `${baseUrl}/v1/mcp/token/revoke`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['client_secret_post'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['aimeat:full'],
            skill: `${baseUrl}/auth.md`,
            agent_auth: buildAgentAuthMetadata(config),
        });
    });
}
