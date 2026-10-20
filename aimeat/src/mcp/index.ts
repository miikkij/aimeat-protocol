/**
 * @file index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP module entry point. Contains the Express router factory (mcpRouter), OAuth 2.1
 *   endpoints, transport management, session lifecycle, and the resource change event bus.
 *   Tool/resource registrations live in ./core.ts.
 * @structure
 *   - resourceEvents, emitResourceUpdated, emitResourceListChanged — event bus for MCP resource changes
 *   - mcpRouter() — Express router factory with MCP transport + OAuth endpoints
 * @usage
 *   import { mcpRouter, emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
 * @version-history
 *   2026-10-21 — createMcpServer's last flag is `stateless` (a 2026-07-28 request) and reaches the
 *     tool groups, so the chat surface's finder answers by era.
 *   2026-10-20 — The 2026-07-28 code path (mcp/modern-endpoint.ts) beside the sessions, routed by era
 *     per request and counted in mcp_requests_total; the guidance and support-route reads moved to
 *     services/mcp-build-inputs.ts, cached for the modern path only (SDK v2 migration step 5, plan item 5).
 *   2026-10-20 — The 2025-era session code (the session maps, the idle sweep, the session half of the
 *     POST handler, GET and DELETE) moved to mcp/legacy-sessions.ts unchanged (pure extraction, so the
 *     2026-07-28 path fits beside it; SDK v2 migration step 5).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Only registerTool is patched with the scope gate and the wrapper chain; tool()
 *     throws while the server registers, since every tool uses registerTool (SDK v2 migration, step 3).
 *   2026-10-20 — The server no longer declares resources.subscribe, which no handler served.
 *   2026-10-20 — Every open session is recorded in mcp/session-registry.ts, so deleting an agent or
 *     rotating its key closes its live MCP transports at once, as both already close its connect
 *     tunnel (secaudit 2026-10, mcp-oauth:access-token-without-session-survives-agent-delete).
 *   2026-10-17 — An agent's tool whose missing permissions its person can allow with one press stays
 *     on the list, and a call answers with the address (mcp/permission-ask-gate.ts). An MCP OAuth
 *     token older than a permission its agent now holds answers 401 invalid_token, so the client
 *     refreshes and the allowed tool works in the same conversation. The agent's instructions say
 *     so (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 *   2026-10-16 — The session's platform label moves to mcp/session-platform.ts unchanged, so a unit
 *     test runs it (QA audit F01a-01).
 *   2026-10-16 — Tools are registered through mcp/tool-registrar.ts, which adds the fault wrapper
 *     (mcp/tool-fault.ts): a tool that throws is logged, reported and answered with a sentence. A call
 *     to a tool the request's permissions do not allow answers SCOPE_DENIED and is noted for the owner
 *     (mcp/scope-denied-answer.ts) (QA audit E1-01, D2-01, F5-02, E2-02, E5-01, E5-04).
 *   2026-10-14 — An unknown agent is told to connect through device authorization; the message named
 *     POST /v1/agents/connect, which is removed (feature-list audit row 202).
 *   2026-10-12 — Every tool is registered through withDeferredScopeNotice: a call made without a word
 *     the tool names for 4.0.0 (catalog scopeEnforcedFrom) is counted like its REST twin's.
 *   2026-10-12 — The MCP serverInfo.version is the node's software version (getSoftwareVersion), where
 *     it had been a fixed '1.2.0' (Core 2026-11 ruling Q2).
 *   2026-10-12 — authenticate() refuses a token whose audience names another resource, and from 4.0.0
 *     an MCP OAuth token that names none (mcp/oauth-binding.ts, Core 2026-11 MCP-07).
 *   2026-10-05 — Resources are registered through withResourceGate (mcp/resource-gate.ts): the scope
 *     of the tool that reads the same thing, from the request's token, and the organism agent gate
 *     (secaudit 2026-10, AUTH-2).
 *   2026-10-04 — A null sent for an optional field that refuses null is read as the field left out
 *     (null-as-absent.ts), on every tool of every surface.
 *   2026-10-02 — /v2/mcp/chat registers every permitted tool, switches off what the chat's list does
 *     not name, and adds aimeat_tools_find; a call by name switches a tool back on
 *     (mcp/tool-loader.ts).
 *   2026-09-28 — Every tool that takes organism_id refuses an agent the organism does not admit
 *     (mcp/organism-agent-gate.ts).
 *   2026-09-27 — answerMovedTools(): a call to one of the ten tools aimeat_app_manage replaced answers TOOL_MOVED.
 *   v1.28.0 -- 2026-09-27 -- Bind every session request to its verified principal and read scopes
 *     from the current request, including discovery and concurrent tool calls (A01/A02).
 *   v1.27.0 -- 2026-09-18 -- Every tool is registered through withErrorNextStep as well: a failing
 *            tool now says what to do next (try once more, then support@operators), which REST
 *            errors always did and no MCP error did. See mcp/error-next-step.ts.
 *   v1.26.0 -- 2026-09-17 -- A POST that has already passed through this node (X-AIMEAT-MCP-Via) is
 *            refused with 508 before anything else, and the chain it arrived with stays in scope so
 *            a remote MCP call made while serving it carries the chain on. A node could attach its
 *            own endpoint, and two nodes each other, and the calls went round in a circle.
 *   v1.25.0 -- 2026-09-05 -- The resource change event bus moves out to resource-events.ts, a leaf,
 *            and is re-exported from here. A service that notified an agent through this file
 *            imported the whole registry, and the registry imports services: the dependency cruiser
 *            named the cycle the day feat/ai-jobs was merged. A pure move.
 *   v1.24.0 -- 2026-09-05 -- The idle sweep's interval comes from config.mcpSessionSweepMs (10 s
 *            shipped) instead of a constant, so the E2E runner can pin 1 s.
 *   v1.23.0 -- 2026-09-04 -- An unauthenticated `tools/list` answers the public catalogue
 *     (./public-catalogue.ts), so a stranger's agent can learn what this node does before
 *     deciding whether to ask its owner for an account. Names, descriptions and input shapes
 *     only, all of it already in openapi.json; `tools/call` still answers 401. `initialize` is
 *     deliberately left at 401 with its WWW-Authenticate challenge, because that 401 is how
 *     every real client finds the OAuth flow.
 *   v1.22.0 -- 2026-09-03 -- tools.listChanged is declared and emitted, so a client re-reads the
 *     tool list when the owner changes an agent's scopes instead of the person reconnecting by
 *     hand. The 56-line registration block moves to register-all.ts, which the schema audit calls
 *     too: it had been keeping its own copy, and the copy had fallen to half.
 *   v1.21.0 -- 2026-08-29 -- registerAppLegalTools: aimeat_app_legal_set, aimeat_app_audit.
 *   v1.20.0 -- 2026-08-29 -- registerAppMarksTools: aimeat_app_marks_set.
 *   v1.19.0 -- 2026-08-28 -- registerAgentCrewTools: the five aimeat_crew_* tools, which call
 *     services/crew-ops.ts exactly as the Crew tab's routes do.
 *   v1.18.0 -- 2026-08-23 -- The MCP door asks all FOUR credential-death questions
 *     (credentialRevoked), not just exact-token revocation: a revoked session, a revoked app grant
 *     and a deactivated owner (BR-04) were alive here while dead on every REST route, and the
 *     session-resume branch asked nothing at all.
 *   v1.17.0 -- 2026-08-22 -- The handshake carries the proactive guidance when the owner keeps
 *     that setting on (services/proactive-mode.ts). createMcpServer takes the owner name and
 *     reads it here, because a connection is the one moment every client passes through; a
 *     failed read costs the guidance and never the session.
 *   v1.16.0 -- 2026-08-19 -- MCP sessions expire after config.mcpSessionIdleMinutes without a
 *     request. Each session holds a full McpServer (hundreds of tools, each with its Zod schema
 *     graph) and died only on an explicit client DELETE, which most clients never send -- the
 *     production heap held 17,815 live Zod check-closures and ~1 GB of schema graphs after four
 *     hours. A reaped client gets the spec's 404 and re-initializes.
 *   v1.15.0 -- 2026-08-16 -- SECURITY: a revoked access token is refused at this door. POST
 *     /v1/mcp/token/revoke writes the JWT into the revocation list and answers {revoked:true}, and
 *     nothing here ever read that list, so a credential that was dead on every REST route stayed
 *     alive on the MCP one until it expired. auth/middleware.ts checks isRevoked on all three of its
 *     paths; this was the fourth. The check sits above the session-resume branch, so a live session
 *     does not outlive the credential that opened it. Found by the E2E test-quality audit finding
 *     e2e-mcp:448, which noted the suite was asserting the endpoint echo rather than the effect.
 *   v1.14.0 -- 2026-08-16 -- registerAppDraftEditTools: the four incremental app-draft tools (write/replace/read/seed). They live in their own module
 *     because apps.ts is already near the 800-line ceiling.
 *   v1.13.0 -- 2026-08-11 -- August audit step 8: registerAppdevProofTools receives the session
 *     scopes, the way the pitfall, knowledge and commerce registrations already do. The proof
 *     attach now writes through services/memory-write.ts, whose scope gate needs them.
 *   v1.12.0 — 2026-08-10 — August audit step 8: the session's chat-instance upsert and its per-request
 *     heartbeat call services/chat-instance-write.ts instead of storage directly. A new MCP session
 *     now emits the `chat` change event the two other doors already emitted, so the browser's chat
 *     list shows it without waiting for something else to trigger a refresh.
 *   v1.11.0 — 2026-08-09 — The server declares PROMPTS (./prompts-managed.ts): the node's managed
 *     prompt packages become the primitive a person picks, which is what MCP's prompts primitive is
 *     for. mcp.prompt had been called nowhere in src/mcp/, so a surface built around prompt-driven
 *     work offered them only through a tool the model had to think of. createMcpServer is async now,
 *     since the prompt list comes from storage.
 *   v1.10.0 — 2026-08-09 — The initialize result carries `instructions` (./instructions.ts), per
 *     surface role. The handshake had never passed one, so an agent connecting to /v1/mcp met a few
 *     hundred tool descriptions with nothing telling it that aimeat_handbook_get is the way in — the
 *     operating guide was reachable only by an agent that already guessed it existed.
 *   v1.11.0 — 2026-08-23 — registerPackageTools: installing a component package. The package tools
 *     were in the catalog and on the appdev surface list, but nothing here ever registered them, so
 *     the node's own /v1/mcp served none of them — a chat could read about a package and not
 *     install it. Only install is registered here; the four authoring ones stay connector-side.
 *   v1.x — 2026-08-08 — registerCompanyTools: the company registry on the MCP surface.
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
 *   v1.0.0 — 2026-03-20 — Extracted from src/routes/mcp.ts (pure refactor, no logic changes)
 *   v1.1.0 — 2026-03-21 — Added registerOrganismsTools registration (5 tools + 1 resource)
 *   v1.2.0 — 2026-03-21 — Added registerKnowledgeTools registration (4 tools + 1 resource)
 *   v1.3.0 — 2026-03-21 — Added registerExtensionsTools registration (2 tools + 1 resource)
 *   v1.4.0 — 2026-03-21 — Added registerCatalogueTools (3), registerMemoryExtendedTools (2), registerWalletExtendedTools (1)
 *   v1.5.0 — 2026-03-21 — Added registerConsentTools (3), registerChatInstancesTools (3), registerFlagsTools (1), registerPromptsTools (1)
 *   v1.6.0 — 2026-05-28 — Added public MCP Hello Integration onboarding and telemetry tools
 *   v1.7.0 — 2026-05-30 — MCP audit Phase 3 (F1): per-agent scope enforcement — createMcpServer
 *     filters the tool surface by the agent's defaultScopes (scopeAllowsTool), mirroring REST
 *     requireScope gates. Honours config.mcpEnforceScopes (false = warn-only logging).
 *   v1.8.0 — 2026-05-30 — v2 S2: createMcpServer accepts a surface role; the gate hard-skips tools
 *     outside that surface (toolsForSurface). role='all' (v1) applies no surface filter.
 *   v1.8.1 — 2026-06-30 — resourceEvents.setMaxListeners(256): per-session fan-out (2 listeners/session,
 *     cleaned up on close) is intentional, not a leak — silences MaxListenersExceededWarning while
 *     keeping headroom for 128 concurrent agents and still flagging a genuine cleanup leak.
 *   v1.8.2 — 2026-07-13 — Extracted the OAuth 2.1 endpoints to ./oauth.ts (max-file-lines); no behavior change.
 *   v1.9.0 — 2026-07-25 — Per-session bearer token is now LIVE (sessionTokens box refreshed from every
 *     request) instead of frozen at initialize. An MCP session outlives its access token (jwtTtlSeconds,
 *     1 h default, rotated by the client via refresh_token), so capability invocation — the only path
 *     that re-presents the caller's token to the node's own HTTP surface — was answering AUTH_REQUIRED
 *     for the whole remainder of every session older than an hour. createMcpServer now takes a getter.
 */

import { Router, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { MCP_RESOURCE_METADATA_PATH } from '../services/protected-resource.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { PeerInfo } from '../services/federation.js';
// Every tool group, in one list this file no longer keeps: mcp/register-all.ts.
import { registerAllServerTools } from './register-all.js';
import { registerRemoteTools } from './remote-tools.js';
import { scopeAllowsTool, enforcedScopesForTool } from '../tool-catalog/scopes.js';
import { withResourceGate } from './resource-gate.js';
import { toolRegistrar } from './tool-registrar.js';
import { answerScopeDeniedTools } from './scope-denied-answer.js';
import { askableTool, staleGrantRefusal } from './permission-ask-gate.js';
import { toolsForSurface, toolsRegisteredOn, isV2Role, V2_ROLES, type SurfaceRole } from '../tool-catalog/surfaces.js';
import { keepOnly, answerSwitchedOffTools } from './tool-loader.js';
import { instructionsFor } from './instructions.js';
import { readBuildInputs } from '../services/mcp-build-inputs.js';
import { registerManagedPrompts } from './prompts-managed.js';
import { registerOAuthRoutes } from './oauth.js';
import { mcpAudienceRefusal } from './oauth-binding.js';
import { MCP_VIA_HEADER, parseVia, viaRefusal, runWithVia } from '../services/mcp-client/hops.js';
import { verifyJWT, type VerifiedToken } from '../auth/jwt.js';
import { credentialRevoked } from '../auth/middleware.js';
import { withCurrentScopes } from '../auth/effective-scopes.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { getSoftwareVersion } from '../utils/version.js';
import { mcpRequestAuthority, withRequestPermission } from './request-authority.js';
import { legacySessions } from './legacy-sessions.js';
import { modernEndpoint, isModernRequest } from './modern-endpoint.js';
import { getStats } from '../services/stats.js';

// ── Resource change event bus ──
// Lives in resource-events.ts, a leaf, so a service can notify an agent without importing the
// registry this file assembles (which imports the service back: a cycle). Re-exported here so
// every existing importer keeps working; new code imports the leaf.
import { emitResourceUpdated, emitResourceListChanged, resourceEvents, type ResourceChangeEvent } from './resource-events.js';
import { answerMovedTools } from './moved-tools-answer.js';
import { treatNullAsAbsent } from './null-as-absent.js';
export { resourceEvents, emitResourceUpdated, emitResourceListChanged, emitToolListChanged, type ResourceChangeEvent } from './resource-events.js';

export function mcpRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    const authority = mcpRequestAuthority();
    // The 2025-era session code (mcp/legacy-sessions.ts): one transport and one server per session.
    const legacy = legacySessions({ config, storage, authority, authenticate, createMcpServer });
    // The 2026-07-28 code path (mcp/modern-endpoint.ts): stateless, one server per request, built by
    // the same createMcpServer inside the same request authority.
    const modern = modernEndpoint({
        config, storage,
        run: (token, verified, operation) => authority.run(token, verified, operation),
        build: (agentGaii, role, owner) => createMcpServer(agentGaii, authority.scopes, role, authority.token, owner, true),
    });
    // Change events reach the open 2026-07-28 listen streams too (a 2025 session hears them in core.ts).
    resourceEvents.on('tool:listChanged', () => modern.notify.toolsChanged());
    resourceEvents.on('resource:listChanged', () => modern.notify.resourcesChanged());
    resourceEvents.on('resource:updated', (evt: ResourceChangeEvent) => modern.notify.resourceUpdated(evt.uri));

    async function authenticate(req: Request, res: Response): Promise<VerifiedToken | null> {
        const header = req.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
        if (!token) return null;
        const verified = await verifyJWT(token);
        if (!verified || await credentialRevoked(token, verified)) {
            res.status(401).json({ jsonrpc: '2.0', error: { code: -32001,
                message: 'Token is invalid or has been revoked. Obtain a new access token via /v1/mcp/token.' },
                id: req.body?.id ?? null });
            return null;
        }
        // The resource server's half of RFC 8707: a token issued for another resource is not a
        // credential here, and from 4.0.0 an MCP OAuth token must name this endpoint at all.
        const audienceRefusal = mcpAudienceRefusal(verified, config);
        if (audienceRefusal) {
            const resourceMetadataUrl = `${config.baseUrl.replace(/\/+$/, '')}${MCP_RESOURCE_METADATA_PATH}`;
            res.status(401)
                .setHeader('WWW-Authenticate', `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`)
                .json({ jsonrpc: '2.0', error: { code: -32001, message: audienceRefusal }, id: req.body?.id ?? null });
            return null;
        }
        // A permission the person allowed after this token was issued: the client refreshes and goes
        // on in the same conversation (mcp/permission-ask-gate.ts).
        const stale = await staleGrantRefusal(verified, storage, config);
        if (stale) {
            const resourceMetadataUrl = `${config.baseUrl.replace(/\/+$/, '')}${MCP_RESOURCE_METADATA_PATH}`;
            res.status(401)
                .setHeader('WWW-Authenticate', `Bearer error="invalid_token", error_description="permissions changed", resource_metadata="${resourceMetadataUrl}"`)
                .json({ jsonrpc: '2.0', error: { code: -32001, message: stale }, id: req.body?.id ?? null });
            return null;
        }
        return withCurrentScopes(storage, verified);
    }


    async function createMcpServer(
        agentGaii: string,
        scopes: string[],
        role: SurfaceRole | 'all' = 'all',
        getToken: () => string | undefined = () => undefined,
        owner?: string,
        /** A 2026-07-28 request: the server lives for this one request (mcp/modern-endpoint.ts). */
        stateless = false,
    ): Promise<McpServer> {
        // What this account chose about being offered things it did not ask for, and who answers
        // support here. Read when the server is built, because that is the one moment every client
        // passes through, and never allowed to fail a connection (services/mcp-build-inputs.ts). A 2026-07-28
        // request builds a server per request and reads both through a short cache.
        const { guidance, supportAnsweredBy } = await readBuildInputs(storage, config, owner, stateless);
        // An agent's person can allow a missing permission with one press; an owner, an app and an
        // ecosystem app have no such page (services/permission-ask.ts).
        const mayAsk = config.mcpEnforceScopes && !agentGaii.startsWith('eco:') && parseGaiiLoose(agentGaii).agent !== '';
        const mcp = new McpServer(
            // serverInfo.version is the node's software version (Core 2026-11 ruling Q2), not a number of its own.
            { name: `AIMEAT Node ${config.nodeId}`, version: getSoftwareVersion() },
            {
                // tools.listChanged is the half that was missing: the agent's scopes decide which
                // tools this session registered, so a permission change makes the client's list
                // wrong, and without the declaration no client would ever ask again.
                // resources.subscribe is NOT declared: nothing handles resources/subscribe, so a
                // client that believed it got -32601 (decision 2026-10-20, MCP migration plan item 12).
                capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
                // The orientation an agent reads before it has called anything. Without it a client
                // meets a few hundred tool descriptions and no indication of where to start, so the
                // handbook this text points at was reachable only by guessing it existed.
                instructions: instructionsFor(role, { proactiveGuidance: guidance, supportAnsweredBy, permissionAsk: mayAsk }),
            },
        );
        // A client that sends null for an optional field it left out is read as leaving it out
        // (mcp/null-as-absent.ts): CrewAI does that for every optional field, nested ones included.
        treatNullAsAbsent(mcp);

        // F1: enforce per-agent scopes on the tool surface. We monkeypatch mcp.registerTool (and
        // make mcp.tool refuse) for the duration of registration so each
        // registerXxxTools() call only registers tools this agent's scopes allow (mirrors REST
        // requireScope gates). Owner-attached agents with a '*' scope get everything. Warn-only
        // mode (config.mcpEnforceScopes=false) registers all tools but logs what WOULD be filtered.
        const enforce = config.mcpEnforceScopes;
        // On `chat` this is everything `full` carries: what is not on the chat's own list is
        // registered and then switched off below (mcp/tool-loader.ts).
        const surfaceTools = role === 'all' ? null : toolsRegisteredOn(role);
        const filteredTools: string[] = [];
        type ToolFn = (...args: unknown[]) => unknown;
        const patchable = mcp as unknown as { tool: ToolFn; registerTool: ToolFn; registerResource: ToolFn };
        // A tool the agent may not use yet, but whose person can allow it with one press, stays on
        // the list: a call answers SCOPE_DENIED with the address (mcp/permission-ask-gate.ts).
        const askable = (name: string) => mayAsk && askableTool(scopes, name);
        const gate = (name: string): boolean => {
            // v2 surface filter: a tool not in this surface's purpose is simply not part of it
            // (hard skip, silent — not a scope denial). role='all' (v1) applies no surface filter.
            if (surfaceTools && !surfaceTools.has(name)) return false;
            if (scopeAllowsTool(scopes, name)) return true;
            filteredTools.push(name);
            // warn-only: still register (true); enforce: skip (false) unless the person can allow it
            return !enforce || askable(name);
        };
        // Every tool registers through registerTool, the form the MCP SDK v2 keeps; tool() would skip
        // the gate and the wrapper chain, so while registering it throws instead of registering.
        const originalTool = patchable.tool;
        const originalRegisterTool = patchable.registerTool.bind(mcp) as ToolFn;
        // Measured INSIDE the gate: a tool this agent's scopes filtered out is never wrapped, so a
        // tool that was never offered is never counted as one that was not called. The wrap sits at
        // registration for the same reason the gate does — one place, every tool, nothing for a new
        // tool's author to remember. See mcp/tool-usage-wrap.ts.
        // A failing tool says what to do next (mcp/error-next-step.ts). It sits OUTSIDE the
        // measurement, so what is measured is what the tool itself returned.
        // An organism that admits only listed agents refuses the others on every tool that names it
        // (mcp/organism-agent-gate.ts). Innermost, so the refusal is measured and carries a next step.
        // A call without a word the tool names for 4.0.0 is counted, as its REST twin counts it
        // (mcp/deferred-scope-notice.ts, auth/rest-scope-gate.ts). Innermost, so it sees the call itself.
        // A tool that throws, or returns a caught internal error, is logged, reported to the operator
        // and answered with a sentence (mcp/tool-fault.ts). The whole chain and its order: mcp/tool-registrar.ts.
        const registrarDeps = { scopes: () => scopes, principal: () => agentGaii, storage, config };
        const measuredRegisterTool = toolRegistrar(originalRegisterTool, registrarDeps);
        // Keep the initial surface ceiling and its memory footprint. The SDK reads enabled at
        // list/call time, so a removed permission affects discovery without rebuilding a session.
        // A tool the person can allow with one press stays listed either way, so allowing it works
        // in the same session; any other newly granted tool still requires re-initialization.
        const liveGate = (name: string) => !enforce || scopeAllowsTool(scopes, name);
        const listedGate = (name: string) => liveGate(name) || askable(name);
        const liveRegisterTool = withRequestPermission(measuredRegisterTool, listedGate);
        patchable.tool = (...args: unknown[]) => { throw new Error(`the tool() form is not used here (${String(args[0])}): register with registerTool`); };
        patchable.registerTool = (...args: unknown[]) => gate(args[0] as string) ? liveRegisterTool(...args) : undefined;
        // Resources answer under the tools' rules: the scope of the tool that reads the same thing,
        // from this request's token, and the organism agent gate (mcp/resource-gate.ts, AUTH-2).
        const originalRegisterResource = patchable.registerResource.bind(mcp) as ToolFn;
        patchable.registerResource = withResourceGate(originalRegisterResource, { allows: liveGate, agentGaii: () => agentGaii, storage });

        // Every tool group, from the one list the schema audit registers against too
        // (mcp/register-all.ts). It used to stand here and the audit kept its own copy; the copies
        // drifted to 52 against 26 without either side going quiet about it.
        registerAllServerTools(mcp, {
            storage, config, peers, scopes, getToken, role, stateless,
            agentGaii: () => agentGaii,
            owner: () => owner ?? '',
            emitResourceUpdated, emitResourceListChanged,
        });

        // Restore the original methods and report what scope enforcement did this session.
        patchable.tool = originalTool;
        patchable.registerTool = originalRegisterTool;
        patchable.registerResource = originalRegisterResource;
        // A tool that became an action of another answers with the call that replaces it, and stays
        // out of tools/list (mcp/moved-tools-answer.ts).
        answerMovedTools(mcp);
        // A call to a tool this request's permissions do not allow answers SCOPE_DENIED with the word
        // it needs and is noted for the owner, not "Tool X not found" (mcp/scope-denied-answer.ts).
        // Only under enforcement, and only for a tool this surface carries.
        answerScopeDeniedTools(mcp, {
            missingWords: (name) => (!enforce || (surfaceTools && !surfaceTools.has(name)))
                ? [] : enforcedScopesForTool(name).filter((word) => !scopeIsCovered(scopes, word)),
            principal: () => agentGaii,
            baseUrl: config.baseUrl,
        });
        // THE CHAT STARTS SMALL. Everything permitted is registered above; what the chat's own list
        // does not name is switched off here, before the client first lists the tools, and comes
        // back on by purpose (aimeat_tools_find) or when it is called by name.
        if (role === 'chat') {
            const off = keepOnly(mcp, toolsForSurface('chat'));
            answerSwitchedOffTools(mcp);
            logger.info(`[mcp-chat] ${agentGaii}: ${off} tool(s) registered and switched off until needed`);
        }

        // The node's managed prompts, as the primitive the PERSON picks from (a slash command in
        // Claude Code) rather than one the model has to think of calling. Registered after the
        // tool-gate window closes: the gate patches mcp.tool/registerTool, and a prompt is neither.
        // Awaited here rather than inside that window, so no storage round-trip happens while the
        // two methods are monkeypatched.
        // Flattened remote tools, for a server the owner marked `exposure: flatten`. HERE and
        // not inside the window above, and for exactly the reason prompts are here: that gate
        // filters by the STATIC catalogue and descriptionFor() throws for a name it does not
        // hold, while a remote tool is a runtime name that can never be in it. The gate is not
        // skipped, it is answered earlier — nothing is registered unless this session holds
        // mcp:use and the owner's grant allows the tool, and each call goes back through the
        // same chokepoint the gateway uses.
        patchable.registerTool = withRequestPermission(originalRegisterTool, () => scopeIsCovered(scopes, 'mcp:use'));
        const remoteCount = await registerRemoteTools(mcp, {
            storage, config, scopes, agentGaii: () => agentGaii,
        });
        patchable.registerTool = originalRegisterTool;
        if (remoteCount > 0) {
            logger.info(`[mcp-remote] ${remoteCount} flattened tool(s) offered to ${agentGaii}`);
        }

        const promptCount = await registerManagedPrompts(mcp, storage, config, () => agentGaii);
        if (promptCount > 0) {
            logger.info(`[mcp-prompts] ${promptCount} managed prompt(s) offered to ${agentGaii}`);
        }

        if (filteredTools.length > 0) {
            logger.info(
                `[mcp-scope] ${enforce ? 'filtered' : 'would filter (warn-only)'} ${filteredTools.length} tool(s) for ${agentGaii}`,
                { scopes, filtered: [...new Set(filteredTools)] },
            );
        }

        return mcp;
    }

    // MCP Streamable HTTP POST handler — shared by /v1/mcp (role 'all') and /v2/mcp/:role.
    //
    // THE LOOP BRAKE FIRST, before origin, auth or session: a request that has already passed
    // through this node (X-AIMEAT-MCP-Via names it) is refused with 508 whoever sent it, because
    // answering it would send it round in a circle. The list it arrived with then stays in scope for
    // the whole request, so a remote MCP call this node makes while serving it carries the list
    // onward. That is what stops two nodes that attached each other, which no address check can see.
    // services/mcp-client/hops.ts has the rest of the argument. Only POST: it is where tools are
    // called, and a GET stream belongs to a session whose initialize POST was already refused.
    const handleMcpPost = (serverRole: SurfaceRole | 'all') => async (req: Request, res: Response) => {
        const via = parseVia(req.headers[MCP_VIA_HEADER]);
        const loop = viaRefusal(via, config.nodeId);
        if (loop) {
            res.status(508).json({
                jsonrpc: '2.0',
                error: { code: -32001, message: loop.message, data: { reason: loop.code } },
                id: req.body?.id ?? null,
            });
            return;
        }
        await runWithVia(via, () => handleMcpPostServed(serverRole)(req, res));
    };

    const handleMcpPostServed = (serverRole: SurfaceRole | 'all') => async (req: Request, res: Response) => {
        // Origin validation (MCP spec: REQUIRED to prevent DNS rebinding)
        const origin = req.headers.origin;
        if (origin) {
            const allowed = config.corsAllowedOrigins;
            if (!allowed.includes('*') && !allowed.includes(origin)) {
                res.status(403).json({
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Origin not allowed' },
                    id: req.body?.id ?? null,
                });
                return;
            }
        }

        // Extract auth: Bearer token only (spec: token MUST NOT be in query string)
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

        // A DEAD credential is refused here, before anything else looks at it, and dead means all
        // FOUR ways a credential dies (auth/middleware.ts credentialRevoked): exact-token revocation,
        // a revoked session row, a revoked app grant, and a deactivated owner. Until 2026-08-23 this
        // door asked only the first question, so signing out, deleting an agent or revoking an app
        // kept working on the REST surface while the same credential stayed alive on the MCP one —
        // and the session-resume branch below never asked anything at all. The check sits ABOVE the
        // session-resume branch on purpose — a live session must not outlive the credential it was
        // opened with, and that branch even refreshes the session's stored bearer from the request.
        // E2E test-quality audit, e2e-mcp:448: the suite asserted the endpoint's `revoked: true`
        // echo, which RFC 7009 answers unconditionally for any string.
        const verified = await authenticate(req, res);
        if (res.headersSent) return;

        // The protocol era decides the code path. The count is what the later decision about the 2025
        // era reads (decision 2026-10-20, item 2): mcp_requests_total:legacy and :modern on the stats page.
        const modernEra = await isModernRequest(req);
        getStats()?.incrementTyped('mcp_requests_total', modernEra ? 'modern' : 'legacy');
        if (modernEra) {
            await modern.serve(req, res, verified, token, serverRole);
            return;
        }
        await legacy.servePost(req, res, verified, token, serverRole);
    };

    const handleMcpGet = legacy.handleGet;
    const handleMcpDelete = legacy.handleDelete;

    // Validate the :role path param for v2 surfaces; replies 400 (JSON-RPC) on unknown role.
    const v2Role = (req: Request, res: Response): SurfaceRole | null => {
        const raw = req.params.role;
        const role = (Array.isArray(raw) ? raw[0] : raw) as string;
        if (!isV2Role(role)) {
            res.status(400).json({ jsonrpc: '2.0', error: { code: -32602, message: `Unknown MCP surface role "${role}". Use one of: ${V2_ROLES.join(', ')}.` }, id: req.body?.id ?? null });
            return null;
        }
        return role;
    };

    // ── v1/mcp — full surface (frozen, role 'all') ──
    // `/mcp` alongside `/v1/mcp`. The versioned path stays canonical and is what the Server Card
    // declares, but `/mcp` at the origin root is the de facto convention: a client that does not
    // read the card tries it first, and every one that did got a 404 from a node whose MCP server
    // was one path away. An alias, not a second server — same handlers, same sessions.
    router.post(['/v1/mcp', '/mcp'], handleMcpPost('all'));
    router.get(['/v1/mcp', '/mcp'], handleMcpGet);
    router.delete(['/v1/mcp', '/mcp'], handleMcpDelete);

    // ── v2/mcp/:role — purpose-scoped surfaces (appdev | agent | service | admin) ──
    router.post('/v2/mcp/:role', async (req: Request, res: Response) => {
        const role = v2Role(req, res);
        if (role) await handleMcpPost(role)(req, res);
    });
    router.get('/v2/mcp/:role', async (req: Request, res: Response) => {
        if (v2Role(req, res)) await handleMcpGet(req, res);
    });
    router.delete('/v2/mcp/:role', async (req: Request, res: Response) => {
        if (v2Role(req, res)) await handleMcpDelete(req, res);
    });

    // ── OAuth 2.1 Endpoints ── (extracted to ./oauth.ts)
    registerOAuthRoutes(router, config, storage);

    return router;
}
