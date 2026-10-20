/**
 * @file src/mcp/unauthenticated-answer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the MCP endpoint answers a request that carries no token, in both protocol eras.
 *
 *   ONE QUESTION A STRANGER MAY ASK WITHOUT AN ACCOUNT: what can you do?
 *
 *   A foreign agent arriving with nothing but the hostname could not learn a single capability
 *   without first getting a credential, which is the wrong way round — you decide whether to ask for
 *   an account by knowing what the account is for. `tools/list` answers with names, descriptions and
 *   input shapes: the contract, which openapi.json already publishes. No data, no session, no
 *   identity, and `tools/call` still 401s. On 2026-07-28 the answer carries the fields that revision
 *   requires of a result (resultType, ttlMs, cacheScope).
 *
 *   `initialize` — and on 2026-07-28 `server/discover` — is DELIBERATELY NOT ANSWERED HERE, and the
 *   temptation is real because an agent-readiness scanner probes exactly that. Every real MCP client
 *   opens with one of the two and relies on this 401 plus its WWW-Authenticate header to find the
 *   OAuth flow (MCP spec §5.3); an SDK v2 client runs OAuth on a 401 before it decides the era. So
 *   answering 200 with no identity would send Claude, Cursor and the rest past the only signpost
 *   they have and fail them one call later (decision 2026-10-20, item 3). A single unauthenticated
 *   `tools/list` is not a step any real client takes first, so this branch cannot be reached by one.
 * @structure answerWithoutToken(req, res, config, era)
 * @usage
 *   if (!verified) return answerWithoutToken(req, res, config, 'modern');
 * @version-history
 *   v1.0.0 — 2026-10-20 — Moved out of the MCP session code, with the 2026-07-28 shape of the public
 *     catalogue (MCP SDK v2 migration step 5).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import { MCP_RESOURCE_METADATA_PATH } from '../services/protected-resource.js';
import { getSoftwareVersion } from '../utils/version.js';

/** Answer a request without a token: the public catalogue for `tools/list`, else the OAuth challenge. */
export async function answerWithoutToken(req: Request, res: Response, config: AimeatConfig, era: 'legacy' | 'modern'): Promise<void> {
    const probe = Array.isArray(req.body) ? undefined : req.body as { method?: string; id?: unknown } | undefined;
    if (probe?.method === 'tools/list') {
        const { publicToolCatalogue } = await import('./public-catalogue.js');
        const tools = publicToolCatalogue();
        res.json({
            jsonrpc: '2.0', id: probe.id ?? null,
            result: era === 'legacy' ? { tools } : {
                tools, resultType: 'complete', ttlMs: 0, cacheScope: 'public',
                _meta: { 'io.modelcontextprotocol/serverInfo': { name: `AIMEAT Node ${config.nodeId}`, version: getSoftwareVersion() } },
            },
        });
        return;
    }
    // No token — challenge client to authenticate via OAuth (MCP spec §5.3)
    // THE MCP RESOURCE'S OWN METADATA, not the origin's. RFC 9728 §3.3 has a client reject
    // metadata whose `resource` is not the resource it is talking to, and the bare
    // well-known URL describes the origin — so pointing a client that is protecting
    // `/v1/mcp` at it handed them a document they are entitled to throw away.
    const resourceMetadataUrl = `${config.baseUrl.replace(/\/+$/, '')}${MCP_RESOURCE_METADATA_PATH}`;
    res.status(401)
        .setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`)
        .json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Authentication required. MCP requires a GHII account. Use OAuth 2.1 to obtain an access token.' },
            id: (Array.isArray(req.body) ? req.body[0]?.id : req.body?.id) ?? null,
        });
}
