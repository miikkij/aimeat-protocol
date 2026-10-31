/**
 * @file src/mcp/oauth-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What MCP OAuth requires of a client, and how an access token is bound to this node's
 *   MCP endpoint. OAuth 2.1 and the MCP authorization specification require PKCE (S256) and a
 *   resource indicator (RFC 8707) on every authorization request, and the resource server refuses a
 *   token whose audience is not itself.
 *
 *   From MCP_OAUTH_LAX_REMOVED_IN (4.0.0) all of it is required: an authorization request without
 *   `code_challenge` (S256) or without a `resource` naming this node's MCP endpoint is refused, and an
 *   MCP OAuth access token without an audience is refused at the MCP endpoint. Before that release
 *   each of these is accepted, counted in the stats counter family `mcp_oauth_legacy` (by kind,
 *   GET /v1/stats) and logged at most once a day per kind, so the change can be checked on data before
 *   the release (the pattern of auth/ws-upgrade.ts for `?token=`). In every release a token whose
 *   audience names another resource is refused, and every token this node issues over MCP OAuth names
 *   the MCP endpoint as its audience.
 *
 *   Only an MCP OAuth access token (it carries `mcp_client`) owes an audience. An agent token from the
 *   device flow or POST /v1/auth/token, an owner session and a personal access token are not tokens
 *   for this resource issued by this flow, and they keep working at the MCP endpoint as before.
 * @structure MCP_OAUTH_LAX_REMOVED_IN · mcpOAuthLaxLive · mcpResourceOf · namesMcpResource ·
 *   resourceValues · LaxUse · noteLaxUse · OAuthRefusal · pkceRefusal · resourceRefusal ·
 *   mcpAudienceRefusal
 * @usage
 *   const refusal = pkceRefusal(codeChallenge, codeChallengeMethod) ?? resourceRefusal(config, resources, true);
 *   if (refusal) { res.status(400).json(refusal); return; }
 *   const aud = mcpAudienceRefusal(verified, config); // null when the MCP endpoint takes the token
 * @version-history
 *   v1.0.2 — 2026-10-31 — mcpResourceOf lives in utils/mcp-resource.ts and is re-exported here, so the
 *     chat's token mint (a service) reads it without importing src/mcp/.
 *   v1.0.1 — 2026-10-13 — namesMcpResource and apexOf take off trailing slashes in one pass
 *     (stripTrailingSlashes), not with a regex that runs in quadratic time on a client-supplied
 *     `resource` (code scanning alert 1733).
 *   v1.0.0 — 2026-10-12 — Initial (wish-mcp-oauth-vaatii-pkce-n-ja-sitoo-tokenin-mcp-osoitteeseen,
 *     Core 2026-11 evidence MCP-06 and MCP-07).
 */
import type { AimeatConfig } from '../config.js';
import type { VerifiedToken } from '../auth/jwt.js';
import { getSoftwareVersion, versionAtLeast } from '../utils/version.js';
import { getStats } from '../services/stats.js';
import { logger } from '../utils/logger.js';
import { stripTrailingSlashes } from '../utils/url-validator.js';
import { mcpResourceOf } from '../utils/mcp-resource.js';

/** The release in which PKCE, the resource indicator and the token audience stop being optional. */
export const MCP_OAUTH_LAX_REMOVED_IN = '4.0.0';

/** Whether this release still accepts an MCP OAuth client that sends no PKCE or no resource. */
export function mcpOAuthLaxLive(version: string = getSoftwareVersion()): boolean {
    return !versionAtLeast(version, MCP_OAUTH_LAX_REMOVED_IN);
}

function apexOf(config: AimeatConfig): string {
    return stripTrailingSlashes(config.baseUrl);
}

/** The audience every MCP OAuth access token of this node carries: the canonical MCP endpoint. */
export { mcpResourceOf };

/**
 * Does this resource identifier name this node's MCP endpoint? The canonical `/v1/mcp`, its `/mcp`
 * alias, a `/v2/mcp/<role>` surface, and the origin itself, which is the `resource` the bare
 * `/.well-known/oauth-protected-resource` document names. A trailing slash is ignored.
 *
 * The value comes from the client, so the trailing slashes go in one pass (stripTrailingSlashes):
 * `replace(/\/+$/, '')` retries from every slash of a long run that has a character after it, and
 * that is quadratic time on a request anybody can send.
 */
export function namesMcpResource(config: AimeatConfig, value: string): boolean {
    const apex = apexOf(config);
    const v = stripTrailingSlashes(value.trim());
    if (v === apex || v === `${apex}/v1/mcp` || v === `${apex}/mcp`) return true;
    return v.startsWith(`${apex}/v2/mcp/`) && /^[a-z]+$/.test(v.slice(`${apex}/v2/mcp/`.length));
}

/** Every `resource` value of a query or a body: RFC 8707 lets a client repeat the parameter. */
export function resourceValues(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    return list.filter((r): r is string => typeof r === 'string' && r.length > 0);
}

/** What a 3.x client may still leave out or get wrong, as the stats counter names it. */
export type LaxUse = 'no_pkce' | 'no_resource' | 'unknown_resource' | 'no_audience';

const lastNoticeDay = new Map<LaxUse, string>();

const NOTICE: Record<LaxUse, string> = {
    no_pkce: 'An MCP OAuth authorization was issued without PKCE (no code_challenge).',
    no_resource: 'An MCP OAuth token was issued for a client that sent no resource parameter (RFC 8707).',
    unknown_resource: 'An MCP OAuth client asked for a resource that is not this node\'s MCP endpoint.',
    no_audience: 'The MCP endpoint accepted an MCP OAuth access token that names no audience.',
};

/** One accepted 3.x request of this kind: counted always, logged at most once a day per kind. */
export function noteLaxUse(kind: LaxUse): void {
    getStats()?.incrementTyped('mcp_oauth_legacy', kind);
    const day = new Date().toISOString().slice(0, 10);
    if (lastNoticeDay.get(kind) === day) return;
    lastNoticeDay.set(kind, day);
    logger.warn(
        `${NOTICE[kind]} This is accepted until ${MCP_OAUTH_LAX_REMOVED_IN} and refused from it. `
        + 'GET /v1/stats counts the uses (mcp_oauth_legacy). Logged once a day.',
        { kind },
    );
}

/** An OAuth error body (RFC 6749 §5.2), answered with 400. */
export interface OAuthRefusal {
    error: 'invalid_request' | 'invalid_target' | 'invalid_grant';
    error_description: string;
}

/**
 * The PKCE half of an authorization request. A method other than S256 is refused in every release.
 * A missing challenge, and a challenge without `code_challenge_method=S256`, are refused from 4.0.0.
 * Nothing is counted here: the count belongs to the moment a code is issued (noteLaxUse).
 */
export function pkceRefusal(challenge: string | undefined, method: string | undefined, version?: string): OAuthRefusal | null {
    if (method && method !== 'S256') {
        return { error: 'invalid_request', error_description: 'Only S256 code_challenge_method is supported' };
    }
    if (mcpOAuthLaxLive(version)) return null;
    if (!challenge) {
        return { error: 'invalid_request', error_description: 'code_challenge is required (PKCE, code_challenge_method=S256).' };
    }
    if (method !== 'S256') {
        return { error: 'invalid_request', error_description: 'code_challenge_method=S256 is required with code_challenge.' };
    }
    return null;
}

/**
 * The resource half (RFC 8707). Every value given must name this node's MCP endpoint; from 4.0.0 a
 * value that does not is refused with invalid_target, and so is an authorization request that sends
 * none (`required`). Before 4.0.0 both are accepted, and the caller counts them where a code or a
 * token is issued.
 */
export function resourceRefusal(config: AimeatConfig, resources: string[], required: boolean, version?: string): OAuthRefusal | null {
    if (mcpOAuthLaxLive(version)) return null;
    if (resources.length === 0) {
        return required
            ? { error: 'invalid_target', error_description: `resource is required (RFC 8707). Send resource=${mcpResourceOf(config)}.` }
            : null;
    }
    if (!resources.every(r => namesMcpResource(config, r))) {
        return { error: 'invalid_target', error_description: `This authorization server issues tokens for ${mcpResourceOf(config)} only.` };
    }
    return null;
}

/** True when a 3.x request named a resource this node does not serve. */
export function hasUnknownResource(config: AimeatConfig, resources: string[]): boolean {
    return resources.some(r => !namesMcpResource(config, r));
}

/**
 * Why the MCP endpoint refuses this token's audience, or null when it takes it. A token that names
 * an audience must name this node's MCP endpoint. An MCP OAuth access token without one is accepted
 * and counted before 4.0.0 and refused from it. Any other token is not judged here.
 */
export function mcpAudienceRefusal(verified: VerifiedToken, config: AimeatConfig, version?: string): string | null {
    if (verified.aud !== undefined) {
        const list = Array.isArray(verified.aud) ? verified.aud : [verified.aud];
        return list.some(a => namesMcpResource(config, a))
            ? null
            : `This token was issued for another resource. Obtain a token for ${mcpResourceOf(config)} via /v1/mcp/token.`;
    }
    if (!verified.mcp_client) return null;
    if (mcpOAuthLaxLive(version)) {
        noteLaxUse('no_audience');
        return null;
    }
    return `This token names no audience. Obtain a new token for ${mcpResourceOf(config)} via /v1/mcp/token.`;
}
