/**
 * @file mcp-servers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST surface for the remote MCP servers this node connects OUT to.
 *
 *   NOTHING HERE RETURNS AN ENDPOINT OR A CREDENTIAL. `toPublicMcpServer()` is the only projection
 *   any response uses. The URL is omitted for the same reason the credential is: a caller that
 *   learns the address can call it directly and leave every gate in this system behind, and an app
 *   holding `mcp:use` is meant to be able to USE somebody's Jira, not to reach it independently
 *   with a token of its own choosing.
 *
 *   ABSENT AND NOT-YOURS ANSWER IDENTICALLY. Every lookup goes through requireUsableServer(), which
 *   returns null for both, and the route answers one 404 body — otherwise the difference between
 *   the two answers enumerates other people's servers.
 *
 *   THREE WORDS, AND THE SPLIT IS THE DESIGN. `mcp:read` is knowing what is attached, `mcp:use` is
 *   spending it, `mcp:manage` is attaching another. An app granted only the first must not be able
 *   to call a tool, and an agent holding "Full access" still cannot attach: `mcp:manage` is outside
 *   every wildcard. The same three words gate the MCP tools, because a permission word is enforced
 *   on every door or it does not exist.
 * @structure mcpServersRouter(config, storage):
 *   GET    /v1/mcp-servers                  -- the caller's own servers
 *   POST   /v1/mcp-servers                  -- attach one (probes before it is called attached)
 *   POST   /v1/mcp-servers/:id/authorize    -- begin the OAuth round; returns an address for a PERSON
 *   GET    /v1/mcp-servers/callback         -- the far side's redirect (unauthenticated by necessity)
 *   GET    /v1/mcp-servers/:id/tools        -- what it can do, cached unless ?refresh=1
 *   POST   /v1/mcp-servers/:id/call         -- run one of its tools
 *   PATCH  /v1/mcp-servers/:id              -- the editable fields, never the slug or the credential
 *   POST   /v1/mcp-servers/organism         -- attach one for a group (its owners and admins)
 *   GET    /v1/mcp-servers/node             -- the operator's registry (operator in person)
 *   POST   /v1/mcp-servers/node             -- attach one for the whole node
 *   PATCH  /v1/mcp-servers/node/:id         -- who may use it, what it costs, on or off
 *   DELETE /v1/mcp-servers/node/:id         -- take it away from everybody
 *   GET    /v1/mcp-servers/grants           -- who may use what
 *   PUT    /v1/mcp-servers/:id/grants       -- narrow one agent to named tools, with caps
 *   DELETE /v1/mcp-servers/:id/grants/:who  -- remove the narrowing (NOT the access)
 *   DELETE /v1/mcp-servers/:id              -- detach, and forget the credential
 * @usage app.use(mcpServersRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import {
  requireAuth, requireScope, requireAnyScope, requireOperatorPrincipal,
} from '../auth/middleware.js';
import { resolveIdentity, ownerGhiiOf, callerPrincipal } from '../utils/gaii.js';
import {
  toPublicMcpServer,
  type McpTransport, type McpServerCredential, type McpPrice,
} from '../models/mcp-server-schemas.js';
import {
  attachMcpServer, listUsableServers, requireUsableServer, detachMcpServer,
  updateMcpServerSettings, attachNodeServer, listNodeServers, setNodeServerPolicy,
  attachOrganismServer,
} from '../services/mcp-client/registry.js';
import { callRemoteTool, listRemoteTools } from '../services/mcp-client/invoke.js';
import { startMcpOAuth, finishMcpOAuth } from '../services/mcp-client/oauth.js';
import {
  listMcpGrants, putMcpGrant, removeMcpGrant, type McpGrant,
} from '../services/mcp-client/grants.js';
import { emitChange } from '../services/event-bus.js';
import { recordAccountEvent } from '../services/account-events.js';

export function mcpServersRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** The human this call is for. An agent's servers are its owner's — see src/mcp/mcp-proxy.ts. */
  const ownerOf = (req: Request): string =>
    ownerGhiiOf(resolveIdentity(req.auth!, config.nodeId));

  /** Absent and not-yours, in one body. */
  const notFound = (res: Response): Response =>
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such MCP server.'));

  // ── Reading ─────────────────────────────────────────────────────────────────────────────────

  // read OR use, because an app granted only `mcp:use` still has to learn the names it may call.
  router.get('/v1/mcp-servers', requireAuth(), requireAnyScope('mcp:read', 'mcp:use'),
    async (req: Request, res: Response) => {
      res.json(success(config.nodeId, {
        servers: await listUsableServers(storage, ownerOf(req), config),
      }));
    });

  router.get('/v1/mcp-servers/:id/tools', requireAuth(), requireAnyScope('mcp:read', 'mcp:use'),
    async (req: Request, res: Response) => {
      const server = await requireUsableServer(storage, ownerOf(req), req.params.id as string);
      if (!server) return notFound(res);

      // The cache is the normal answer: asking the far side on every read would make this route as
      // slow as the slowest thing anyone attached.
      if (req.query.refresh !== '1' && server.toolCache.length) {
        return res.json(success(config.nodeId, {
          server: server.slug, tools: server.toolCache, listed_at: server.lastListedAt, cached: true,
        }));
      }
      const listed = await listRemoteTools(storage, config, server);
      if (!listed.ok) return res.status(502).json(error(config.nodeId, listed.code, listed.message));
      return res.json(success(config.nodeId, {
        server: server.slug, tools: listed.tools, listed_at: new Date().toISOString(), cached: false,
      }));
    });

  // ── Calling ─────────────────────────────────────────────────────────────────────────────────

  router.post('/v1/mcp-servers/:id/call', requireAuth(), requireScope('mcp:use'),
    async (req: Request, res: Response) => {
      const server = await requireUsableServer(storage, ownerOf(req), req.params.id as string);
      if (!server) return notFound(res);

      const { tool, arguments: args } = (req.body ?? {}) as {
        tool?: unknown; arguments?: unknown;
      };
      if (typeof tool !== 'string' || !tool) {
        return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Name the tool to call.'));
      }

      const result = await callRemoteTool({
        storage, config, server, tool,
        args: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
        // The EXACT principal, for attribution. Authorisation happened above, against the owner.
        caller: callerPrincipal(req.auth!, config.nodeId),
        callerKind: req.auth!.roles.includes('owner') ? 'owner' : 'agent',
      });

      if (!result.ok) {
        // 502 rather than 500: the far side is what failed, or its credential did. A 500 would read
        // as this node being broken and send somebody to the wrong logs.
        return res.status(502).json(error(config.nodeId, result.code, result.message));
      }
      return res.json(success(config.nodeId, {
        content: result.content,
        ...(result.structuredContent !== undefined ? { structured_content: result.structuredContent } : {}),
        // The TOOL said no. Kept distinct from the proxy failing, which is the 502 above.
        is_error: result.isError,
      }));
    });


  // ── A group's server ────────────────────────────────────────────────────────────────────────

  router.post('/v1/mcp-servers/organism', requireAuth(), requireScope('mcp:manage'),
    async (req: Request, res: Response) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const organismId = typeof b.organism_id === 'string' ? b.organism_id : '';
      const name = typeof b.name === 'string' ? b.name : '';
      const url = typeof b.url === 'string' ? b.url : '';
      if (!organismId || !name || !url) {
        return res.status(400).json(error(
          config.nodeId, 'BAD_REQUEST', 'A group server needs a group, a short name and an address.',
        ));
      }

      const credential: McpServerCredential | undefined = typeof b.token === 'string' && b.token
        ? {
          shape: 'static',
          accessToken: b.token,
          ...(typeof b.header === 'string' && b.header ? { headerName: b.header } : {}),
        }
        : undefined;

      const result = await attachOrganismServer({
        storage, config,
        organismId,
        ...(typeof b.ws === 'string' && b.ws ? { ws: b.ws } : {}),
        // The bare owner name, because that is what an organism's rolls are compared against.
        callerName: resolveIdentity(req.auth!, config.nodeId).split('@')[0],
        createdBy: callerPrincipal(req.auth!, config.nodeId),
        slug: name,
        title: typeof b.title === 'string' && b.title ? b.title : name,
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        transport: { kind: b.transport === 'sse' ? 'sse' : 'http', url },
        ...(credential ? { credential } : {}),
        ...(b.auth === 'oauth' ? { deferCredential: true as const } : {}),
      });

      if (!result.ok) {
        const status = result.code === 'SLUG_TAKEN' ? 409
          : result.code === 'NOT_ALLOWED' ? 403
            : result.code === 'NO_ENCRYPTION_KEY' ? 503
              : result.code === 'UNREACHABLE' ? 502 : 400;
        return res.status(status).json(error(config.nodeId, result.code, result.message));
      }
      return res.status(201).json(success(config.nodeId, {
        server: result.server,
        tools: result.tools,
        note: b.ws
          ? 'Everyone who can contribute to that workspace can use it; viewers can see it is there.'
          : 'Everyone in that group can use it.',
      }));
    });

  // ── The operator's registry ─────────────────────────────────────────────────────────────────
  //
  // requireOperatorPrincipal, not requireRole('operator'): the operator IN PERSON, never something
  // acting on their behalf. Attaching a server to the whole node, deciding who reaches it and
  // pricing it are three acts an agent must not perform in an operator's name.

  router.get('/v1/mcp-servers/node', requireAuth(), requireOperatorPrincipal(storage, 'mcp:manage'),
    async (_req: Request, res: Response) => {
      const servers = await listNodeServers(storage);
      // The operator's own view carries availability and price, which PublicMcpServer omits because
      // an ordinary caller has no business knowing who else is on the list.
      return res.json(success(config.nodeId, {
        servers: servers.map((s) => ({
          ...toPublicMcpServer(s),
          availability: s.availability,
          allowlist: s.allowlist,
          price: s.price,
        })),
      }));
    });

  router.post('/v1/mcp-servers/node', requireAuth(), requireOperatorPrincipal(storage, 'mcp:manage'),
    async (req: Request, res: Response) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const name = typeof b.name === 'string' ? b.name : '';
      const url = typeof b.url === 'string' ? b.url : '';
      if (!name || !url) {
        return res.status(400).json(error(
          config.nodeId, 'BAD_REQUEST', 'A server needs a short name and an address.',
        ));
      }

      const credential: McpServerCredential | undefined = typeof b.token === 'string' && b.token
        ? {
          shape: 'static',
          accessToken: b.token,
          ...(typeof b.header === 'string' && b.header ? { headerName: b.header } : {}),
        }
        : undefined;

      const result = await attachNodeServer({
        storage, config,
        createdBy: callerPrincipal(req.auth!, config.nodeId),
        slug: name,
        title: typeof b.title === 'string' && b.title ? b.title : name,
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        transport: { kind: b.transport === 'sse' ? 'sse' : 'http', url },
        ...(credential ? { credential } : {}),
        ...(b.auth === 'oauth' ? { deferCredential: true as const } : {}),
        ...(b.availability === 'all-owners' || b.availability === 'allowlist'
          ? { availability: b.availability } : {}),
        ...(Array.isArray(b.allowlist)
          ? { allowlist: b.allowlist.filter((x): x is string => typeof x === 'string') } : {}),
        ...(b.price && typeof b.price === 'object' ? { price: b.price as McpPrice } : {}),
      });

      if (!result.ok) {
        const status = result.code === 'SLUG_TAKEN' ? 409
          : result.code === 'NO_ENCRYPTION_KEY' ? 503
            : result.code === 'UNREACHABLE' ? 502 : 400;
        return res.status(status).json(error(config.nodeId, result.code, result.message));
      }
      return res.status(201).json(success(config.nodeId, {
        server: result.server,
        tools: result.tools,
        // Said out loud because it is the one thing an operator gets wrong: attaching is not
        // offering, and a server nobody may use yet looks identical to a broken one.
        note: result.server.status === 'active' && !b.availability
          ? 'Attached, and nobody may use it yet. Set availability to all-owners or allowlist.'
          : '',
      }));
    });

  router.patch('/v1/mcp-servers/node/:id', requireAuth(), requireOperatorPrincipal(storage, 'mcp:manage'),
    async (req: Request, res: Response) => {
      const server = await storage.getMcpServer(req.params.id as string);
      // Scoped to node-wide rows on purpose: this door must not become a way for an operator to
      // edit somebody's personal server, which is theirs and not the house's.
      if (!server || server.ownership !== 'node') return notFound(res);

      const b = (req.body ?? {}) as Record<string, unknown>;
      const updated = await setNodeServerPolicy(storage, server, {
        ...(b.availability === 'all-owners' || b.availability === 'allowlist'
          ? { availability: b.availability } : {}),
        ...(Array.isArray(b.allowlist)
          ? { allowlist: b.allowlist.filter((x): x is string => typeof x === 'string') } : {}),
        ...(b.price === null ? { price: null }
          : b.price && typeof b.price === 'object' ? { price: b.price as McpPrice } : {}),
        ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
        ...(b.exposure === 'gateway' || b.exposure === 'flatten' ? { exposure: b.exposure } : {}),
      });
      return res.json(success(config.nodeId, {
        server: {
          ...toPublicMcpServer(updated),
          availability: updated.availability,
          price: updated.price,
        },
      }));
    });

  router.delete('/v1/mcp-servers/node/:id', requireAuth(), requireOperatorPrincipal(storage, 'mcp:manage'),
    async (req: Request, res: Response) => {
      const server = await storage.getMcpServer(req.params.id as string);
      if (!server || server.ownership !== 'node') return notFound(res);
      await detachMcpServer(storage, server);
      return res.json(success(config.nodeId, {
        removed: server.slug,
        // Everyone loses it at once, which is worth saying before an operator finds out from
        // support tickets.
        note: 'Every owner on this node has lost those tools.',
      }));
    });

  // ── Grants: which agent may use which tools ─────────────────────────────────────────────────

  router.get('/v1/mcp-servers/grants', requireAuth(), requireAnyScope('mcp:read', 'mcp:manage'),
    async (req: Request, res: Response) => {
      const server = typeof req.query.server === 'string' ? req.query.server : undefined;
      const grants = await listMcpGrants(storage, ownerOf(req), server);
      return res.json(success(config.nodeId, { grants }));
    });

  router.put('/v1/mcp-servers/:id/grants', requireAuth(), requireScope('mcp:manage'),
    async (req: Request, res: Response) => {
      const server = await requireUsableServer(storage, ownerOf(req), req.params.id as string);
      if (!server) return notFound(res);

      const b = (req.body ?? {}) as Record<string, unknown>;
      const grantee = typeof b.grantee === 'string' ? b.grantee.trim() : '';
      if (!grantee) {
        return res.status(400).json(error(
          config.nodeId, 'BAD_REQUEST', 'Name who the permission is for, or "*" for everything.',
        ));
      }
      // `tools` is required and has no default. A grant written without it would be read as "every
      // tool", which is the OPPOSITE of what somebody writing a grant is trying to say.
      const tools = b.tools === '*' ? '*' as const
        : Array.isArray(b.tools) ? b.tools.filter((x): x is string => typeof x === 'string')
          : null;
      if (tools === null) {
        return res.status(400).json(error(
          config.nodeId, 'BAD_REQUEST',
          'Say which tools this may use: a list of names, or "*" for all of them.',
        ));
      }

      const grant: McpGrant = {
        type: 'aimeat:McpGrant',
        ownerGhii: ownerOf(req),
        server: server.slug,
        grantee,
        tools,
        ...(b.locked_input && typeof b.locked_input === 'object'
          ? { lockedInput: b.locked_input as Record<string, unknown> } : {}),
        ...(b.call_cap && typeof b.call_cap === 'object'
          ? { callCap: b.call_cap as { count: number; windowHours: number } } : {}),
        expires: typeof b.expires === 'string' ? b.expires : null,
        grantedBy: callerPrincipal(req.auth!, config.nodeId),
        grantedAt: new Date().toISOString(),
      };
      await putMcpGrant(storage, grant);
      // The list of who may use what is a live surface too: an owner narrowing an agent on one
      // screen should see it on the other without a reload.
      emitChange('mcp-servers', ownerOf(req));
      return res.json(success(config.nodeId, { grant }));
    });

  router.delete('/v1/mcp-servers/:id/grants/:grantee', requireAuth(), requireScope('mcp:manage'),
    async (req: Request, res: Response) => {
      const server = await requireUsableServer(storage, ownerOf(req), req.params.id as string);
      if (!server) return notFound(res);

      const removed = await removeMcpGrant(
        storage, ownerOf(req), server.slug, req.params.grantee as string,
      );
      if (!removed) return notFound(res);
      emitChange('mcp-servers', ownerOf(req));
      // Worth saying: removing a grant does not remove access, it removes the NARROWING. The scope
      // is what decides again, and somebody expecting the opposite would be badly surprised.
      return res.json(success(config.nodeId, {
        removed: req.params.grantee,
        note: 'That narrowing is gone. What this agent may do is decided by its permissions again.',
      }));
    });

  // ── The OAuth round ─────────────────────────────────────────────────────────────────────────

  router.post('/v1/mcp-servers/:id/authorize', requireAuth(), requireScope('mcp:manage'),
    async (req: Request, res: Response) => {
      const server = await requireUsableServer(storage, ownerOf(req), req.params.id as string);
      if (!server) return notFound(res);

      const b = (req.body ?? {}) as Record<string, unknown>;
      const started = await startMcpOAuth({
        storage, config, server,
        ownerGhii: ownerOf(req),
        ...(typeof b.return_url === 'string' ? { returnUrl: b.return_url } : {}),
      });
      if (!started.ok) {
        const status = started.code === 'NO_ENCRYPTION_KEY' ? 503
          : started.code === 'UNREACHABLE' ? 502 : 400;
        return res.status(status).json(error(config.nodeId, started.code, started.message));
      }
      // An empty address means the far side needed nothing from a person: a client that was already
      // registered with a grant in place. Saying which happened beats an address that goes nowhere.
      return res.json(success(config.nodeId, {
        authorize_url: started.authorizeUrl,
        state: started.state,
        needs_person: started.authorizeUrl !== '',
      }));
    });

  /**
   * THE ONE UNAUTHENTICATED ROUTE HERE, and it has to be: the far side redirects a BROWSER to it,
   * and that browser carries no bearer of ours. Its gate is the single-use `state`, which is bound
   * to the owner who started the round and consumed before the code is exchanged.
   */
  router.get('/v1/mcp-servers/callback', async (req: Request, res: Response) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || !code) {
      return res.status(400).json(error(
        config.nodeId, 'BAD_REQUEST', 'That sign-in did not come back complete. Start again.',
      ));
    }

    const done = await finishMcpOAuth({ storage, config, state, code });
    if (!done.ok) {
      return res.status(done.code === 'BAD_STATE' ? 400 : 502)
        .json(error(config.nodeId, done.code, done.message));
    }
    // Now that it has a credential, learn what it can do. Done HERE and not in the OAuth service
    // because invoke.ts already imports that service for the refresh, and calling back the
    // other way would be an import cycle. A failure is not fatal: the round DID succeed, and
    // the first aimeat_mcp_tools call fills the cache instead.
    await listRemoteTools(storage, config, done.server);

    // A person is looking at this in a browser, so send them back where they came from rather than
    // leaving them on a JSON page. Only a path of our own: a return URL from the round could
    // otherwise be used to bounce somebody off this node.
    if (done.returnUrl.startsWith('/')) return res.redirect(done.returnUrl);
    return res.json(success(config.nodeId, { connected: done.server.slug }));
  });

  // ── Attaching, which is a human act ─────────────────────────────────────────────────────────

  router.post('/v1/mcp-servers', requireAuth(), requireScope('mcp:manage'),
    async (req: Request, res: Response) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const name = typeof b.name === 'string' ? b.name : '';
      const url = typeof b.url === 'string' ? b.url : '';
      // A peer AIMEAT node is named, not addressed: the address is looked up on every call, so a
      // peering that ends or is demoted stops the calls with it.
      const peer = typeof b.peer === 'string' ? b.peer.trim() : '';
      if (!name || (!url && !peer)) {
        return res.status(400).json(error(
          config.nodeId, 'BAD_REQUEST',
          'A server needs a short name and either an address or the id of a peer node.',
        ));
      }

      const transport: McpTransport = peer
        ? { kind: 'aimeat', peerNodeId: peer }
        : { kind: b.transport === 'sse' ? 'sse' : 'http', url };
      const credential: McpServerCredential | undefined = typeof b.token === 'string' && b.token
        ? {
          shape: 'static',
          accessToken: b.token,
          ...(typeof b.header === 'string' && b.header ? { headerName: b.header } : {}),
        }
        : undefined;

      const result = await attachMcpServer({
        storage, config,
        ownerGhii: ownerOf(req),
        // A server the person will sign in to rather than paste a token for: it is attached
        // unreachable-but-present, and POST …/authorize starts the round. Attaching first is
        // deliberate — the round needs a row to hang the credential on, and a person who abandons
        // the consent screen leaves something they can see and remove rather than nothing at all.
        ...(b.auth === 'oauth' ? { deferCredential: true as const } : {}),
        createdBy: callerPrincipal(req.auth!, config.nodeId),
        slug: name,
        title: typeof b.title === 'string' && b.title ? b.title : name,
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        transport,
        ...(credential ? { credential } : {}),
      });

      if (!result.ok) {
        // 409 for a name already taken, 503 for a node that cannot hold a secret, 502 for a server
        // that would not answer, 400 for a name this node will not accept. Four different things a
        // person does four different things about.
        const status = result.code === 'SLUG_TAKEN' ? 409
          : result.code === 'NO_ENCRYPTION_KEY' ? 503
            : result.code === 'UNREACHABLE' ? 502 : 400;
        return res.status(status).json(error(config.nodeId, result.code, result.message));
      }
      return res.status(201).json(success(config.nodeId, {
        server: result.server, tools: result.tools,
      }));
    });

  router.patch('/v1/mcp-servers/:id', requireAuth(), requireScope('mcp:manage'),
    async (req: Request, res: Response) => {
      const server = await requireUsableServer(storage, ownerOf(req), req.params.id as string);
      if (!server) return notFound(res);

      const b = (req.body ?? {}) as Record<string, unknown>;
      // Named one by one rather than spread: the slug and the credential are NOT editable here,
      // and a spread would make that a matter of what the client happened to send.
      const updated = await updateMcpServerSettings(storage, server, {
        ...(typeof b.title === 'string' ? { title: b.title } : {}),
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        ...(b.exposure === 'gateway' || b.exposure === 'flatten' ? { exposure: b.exposure } : {}),
        ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
      });
      return res.json(success(config.nodeId, { server: toPublicMcpServer(updated) }));
    });

  router.delete('/v1/mcp-servers/:id', requireAuth(), requireScope('mcp:manage'),
    async (req: Request, res: Response) => {
      const server = await requireUsableServer(storage, ownerOf(req), req.params.id as string);
      if (!server) return notFound(res);

      await detachMcpServer(storage, server);
      await recordAccountEvent(storage, {
        ownerGhii: ownerOf(req),
        kind: 'mcp_server_removed',
        actorGaii: callerPrincipal(req.auth!, config.nodeId),
        subject: server.slug,
      }, config);

      return res.json(success(config.nodeId, {
        removed: server.slug,
        // Worth saying, because it is the thing a person cutting access actually cares about.
        note: 'The credential stored here is gone. A token you created at the far side is still '
          + 'yours to revoke there.',
      }));
    });

  return router;
}
