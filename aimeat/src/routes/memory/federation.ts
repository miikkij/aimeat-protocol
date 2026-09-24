/**
 * @file src/routes/memory/federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federated memory browsing routes: pull, push-home, list-home (federated sessions) + list-remote, pull-remote (home users). Extracted from src/routes/memory.ts to satisfy max-file-lines.
 *
 *   A pull WRITES a record here, into the caller's own namespace, so both pull doors write the way
 *   POST /v1/memory writes: memory:write before the far node is asked, the same key checks at the
 *   door, and then services/memory-write.ts writeMemoryRecord with the caller's own roles and scopes.
 * @version-history
 *   v1.4.0 — 2026-09-24 — pull and pull-remote store what the far node answered through
 *     writeMemoryRecord, after requireScope('memory:write') and the door's key checks (an ecosystem
 *     app's data areas, the keys the node trusts in the owner's namespace). They wrote with
 *     storage.setMemory and asked for nothing. Their session-kind check moved into a middleware
 *     ahead of the scope, so a session of the wrong kind still hears NOT_FEDERATED or NOT_HOME.
 *   v1.3.0 — 2026-09-24 — The visitor's home GHII comes from homeIdentityOf, and "is this a visitor"
 *     from isForeignPrincipal. verifyJWT now hands a visitor its home GHII as `owner`, so composing
 *     `${owner}@${homeNode}` here would have named it twice (secaudit 2026-09, F-1).
 *   v1.2.0 — 2026-09-08 — push-home signs the replicate payload with the node key, over the seven
 *     fields the receiving door verifies. It had sent none, so it could not land on a real node.
 *   v1.1.0 — 2026-08-10 — Security audit H-15: list-home and list-remote sign the peer memory-list request
 *     with this node's key, matching the verification the receiving end now performs.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 */

import type { Router, Request, Response, RequestHandler } from 'express';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { homeIdentityOf, isForeignPrincipal, resolveIdentity } from '../../utils/gaii.js';
import { appMayWriteKey } from '../../utils/reserved-keys.js';
import { logger } from '../../utils/logger.js';
import { writeMemoryRecord } from '../../services/memory-write.js';
import { ecoMayWriteKey } from '../../services/ecosystem-access.js';
import { emitResourceUpdated, emitResourceListChanged } from '../../mcp/index.js';
import { sign } from '../../auth/keypair.js';
import type { MemoryRouteCtx } from './shared.js';

export function registerFederationRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, peers, resolve, stats, onDirectoryChange } = ctx;

  /**
   * The key checks POST /v1/memory makes at its own door before the shared writer runs: an ecosystem
   * app's data areas, and the keys the node trusts in the owner's namespace, which an app grant
   * writes into. Neither depends on the value, so both are asked before the far node is.
   */
  async function pullKeyRefusal(req: Request, key: string): Promise<{ code: string; message: string } | null> {
    if (req.auth!.roles.includes('ecosystem') && !(await ecoMayWriteKey(storage, resolveIdentity(req.auth!, config.nodeId), key))) {
      return { code: 'DATA_AREA_DENIED', message: `Write to "${key}" is not permitted by this app's data-area allowlist` };
    }
    if (!appMayWriteKey(req.auth!.roles, key)) {
      return { code: 'RESERVED_KEY', message: `The key "${key}" is managed by the account owner and cannot be written by an app.` };
    }
    return null;
  }

  /**
   * Store what the far node answered in the caller's own namespace here, through the writer every
   * memory door uses: the memory:write gate, the credential records, the keys only the node writes,
   * the schema locks, the ceilings and the version. A refusal is answered here, and false returned.
   */
  async function storePulled(
    req: Request, res: Response, target: string, key: string, value: unknown, tags: string[], pipeline: string,
  ): Promise<boolean> {
    const written = await writeMemoryRecord({
      storage, config, peers, emitResourceUpdated, emitResourceListChanged, onDirectoryChange, stats,
      fromAgent: req.auth!.roles.includes('agent'),
      ownerName: req.auth!.owner,
    }, {
      principal: target,
      targetGaii: target,
      scopes: req.auth!.scopes ?? [],
      roles: req.auth!.roles,
      federated: isForeignPrincipal(req.auth),
    }, { key, value, visibility: 'private', tags, ttlHours: null, pipeline });
    if (!written.ok) {
      res.status(written.status).json(error(config.nodeId, written.code, written.message, written.status, written.details));
      return false;
    }
    return true;
  }

  /**
   * Sign a peer-to-peer memory-list request with this node's key. The receiving node verifies it
   * against the key it already holds for us (audit H-15): the inventory it answers with names every
   * key a person owns, and the `requesting_node` field alone never proved anything, because the
   * federation directory publishes every node id. Returns the body to POST, signature included.
   */
  async function signedListBody(gaii: string): Promise<Record<string, unknown>> {
    const timestamp = new Date().toISOString();
    const body: Record<string, unknown> = { requesting_node: config.nodeId, gaii, timestamp };
    const nodeKey = await storage.getNodeKey();
    if (nodeKey) body.signature = await sign(nodeKey.privateKey, JSON.stringify({ requesting_node: config.nodeId, gaii, timestamp }));
    return body;
  }

  /**
   * Which kind of session a pull door is for, answered before the scope: a session of the wrong
   * kind is told the door is not its own, whatever words it carries.
   */
  const visitorsOnly: RequestHandler = (req, res, next) => {
    if (!isForeignPrincipal(req.auth)) {
      res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'This endpoint is only available for federated sessions'));
      return;
    }
    next();
  };
  const homeSessionsOnly: RequestHandler = (req, res, next) => {
    if (isForeignPrincipal(req.auth)) {
      res.status(400).json(error(config.nodeId, 'NOT_HOME', 'This endpoint is only available for home sessions'));
      return;
    }
    next();
  };

  // ── /v1/memory/pull — Copy a memory entry from home node to local (federated sessions) ──
  // It writes a record here, so it costs memory:write, the word the visitor's scope list carries
  // only when this node's peer record grants it.
  router.post('/v1/memory/pull', requireAuth(), visitorsOnly, requireScope('memory:write'), async (req, res) => {
    const { key } = req.body ?? {};
    if (!key || typeof key !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
      return;
    }
    const keyRefusal = await pullKeyRefusal(req, key);
    if (keyRefusal) {
      res.status(403).json(error(config.nodeId, keyRefusal.code, keyRefusal.message));
      return;
    }

    const homeNode = req.auth!.homeNode;
    const homeUrl = req.auth!.homeUrl;
    if (!homeNode || !homeUrl) {
      res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
      return;
    }

    // Construct the owner's GHII on the home node
    const ownerGhii = homeIdentityOf(req.auth!);

    // Resolve home URL: prefer peer map (verified), fall back to JWT claim
    let resolvedUrl = homeUrl;
    if (peers) {
      const peer = peers.get(homeNode);
      if (peer?.url) resolvedUrl = peer.url;
    }

    // SSRF protection
    const urlCheck = await validateOutboundUrl(resolvedUrl);
    if (!urlCheck.valid) {
      logger.warn(`Memory pull blocked: ${urlCheck.reason} (homeNode=${homeNode}, url=${resolvedUrl})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
      return;
    }

    const fetchUrl = `${resolvedUrl.replace(/\/+$/, '')}/v1/memory/${encodeURIComponent(ownerGhii)}/${encodeURIComponent(key)}`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          'X-Source-Node': config.nodeId,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_PULL_FAILED',
          `Home node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { value?: unknown; tags?: string[] } };
      const value = remoteData?.data?.value;
      const remoteTags = remoteData?.data?.tags ?? [];

      if (value === undefined) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found on home node`));
        return;
      }

      // Store locally with private visibility and one pulled-from tag
      const uniqueTags = [...new Set([...remoteTags, `pulled-from:${homeNode}`])];
      if (!(await storePulled(req, res, resolve(req), key, value, uniqueTags, 'memory.pull'))) return;

      res.json(success(config.nodeId, {
        pulled: true,
        key,
        source_node: homeNode,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory pull error: ${message} (homeNode=${homeNode}, key=${key})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach home node: ${message}`));
    }
  });

  // ── /v1/memory/push-home — Save local memory entry to home node (federated sessions) ──
  router.post('/v1/memory/push-home', requireAuth(), async (req, res) => {
    if (!isForeignPrincipal(req.auth)) {
      res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'This endpoint is only available for federated sessions'));
      return;
    }

    const { key } = req.body ?? {};
    if (!key || typeof key !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
      return;
    }

    const homeNode = req.auth!.homeNode;
    const homeUrl = req.auth!.homeUrl;
    if (!homeNode || !homeUrl) {
      res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
      return;
    }

    // Read the local entry
    const localGhii = resolve(req);
    const record = await storage.getMemory(localGhii, key);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found locally`));
      return;
    }

    // Resolve home URL: prefer peer map (verified), fall back to JWT claim
    let resolvedUrl = homeUrl;
    if (peers) {
      const peer = peers.get(homeNode);
      if (peer?.url) resolvedUrl = peer.url;
    }

    // SSRF protection
    const urlCheck = await validateOutboundUrl(resolvedUrl);
    if (!urlCheck.valid) {
      logger.warn(`Memory push-home blocked: ${urlCheck.reason} (homeNode=${homeNode}, url=${resolvedUrl})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
      return;
    }

    const replicateUrl = `${resolvedUrl.replace(/\/+$/, '')}/v1/federation/replicate`;

    try {
      const payload: Record<string, unknown> = {
        source_node: config.nodeId,
        gaii: homeIdentityOf(req.auth!),
        key,
        value: record.value,
        visibility: record.visibility,
        version: record.version,
        timestamp: record.updatedAt,
        tags: record.tags ?? [],
      };
      // Signed over the same seven fields the receiving door verifies (federation-sync/messaging.ts,
      // P1-11) and services/memory-replication.ts signs. Until 2026-09-08 this door sent no
      // signature at all, so a push-home could never land on a real node; the receiving door's
      // answer is 401 "Missing signature on replication request". Found by e2e-federated-session.
      const nodeKey = await storage.getNodeKey();
      if (nodeKey) {
        payload.signature = await sign(nodeKey.privateKey, JSON.stringify({
          source_node: payload.source_node, gaii: payload.gaii, key, value: record.value,
          visibility: record.visibility, version: record.version, timestamp: record.updatedAt,
        }));
      }

      const response = await fetch(replicateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source-Node': config.nodeId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_PUSH_FAILED',
          `Home node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      res.json(success(config.nodeId, {
        pushed: true,
        key,
        target_node: homeNode,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory push-home error: ${message} (homeNode=${homeNode}, key=${key})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach home node: ${message}`));
    }
  });

  // ── /v1/memory/list-home — List memories on home node (federated sessions) ──
  router.post('/v1/memory/list-home', requireAuth(), async (req, res) => {
    if (!isForeignPrincipal(req.auth)) {
      res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'This endpoint is only available for federated sessions'));
      return;
    }

    const homeNode = req.auth!.homeNode;
    const homeUrl = req.auth!.homeUrl;
    if (!homeNode || !homeUrl) {
      res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
      return;
    }

    const ownerGhii = homeIdentityOf(req.auth!);

    let resolvedUrl = homeUrl;
    if (peers) {
      const peer = peers.get(homeNode);
      if (peer?.url) resolvedUrl = peer.url;
    }

    const urlCheck = await validateOutboundUrl(resolvedUrl);
    if (!urlCheck.valid) {
      logger.warn(`Memory list-home blocked: ${urlCheck.reason} (homeNode=${homeNode}, url=${resolvedUrl})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
      return;
    }

    const fetchUrl = `${resolvedUrl.replace(/\/+$/, '')}/v1/federation/memory/list`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source-Node': config.nodeId,
        },
        body: JSON.stringify(await signedListBody(ownerGhii)),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_LIST_FAILED',
          `Home node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { entries?: unknown[]; total?: number } };
      res.json(success(config.nodeId, {
        entries: remoteData?.data?.entries ?? [],
        total: remoteData?.data?.total ?? 0,
        source_node: homeNode,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory list-home error: ${message} (homeNode=${homeNode})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach home node: ${message}`));
    }
  });

  // ── /v1/memory/list-remote — List memories on a remote peer node (home users) ──
  router.post('/v1/memory/list-remote', requireAuth(), async (req, res) => {
    if (isForeignPrincipal(req.auth)) {
      res.status(400).json(error(config.nodeId, 'NOT_HOME', 'This endpoint is only available for home sessions'));
      return;
    }

    const { peer_node_id } = req.body ?? {};
    if (!peer_node_id || typeof peer_node_id !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'peer_node_id is required'));
      return;
    }

    if (!peers) {
      res.status(503).json(error(config.nodeId, 'FEDERATION_UNAVAILABLE', 'Federation is not configured'));
      return;
    }

    const peer = peers.get(peer_node_id) ?? [...peers.values()].find(p => p.nodeId === peer_node_id);
    if (!peer || peer.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'PEER_NOT_FOUND', `Peer node "${peer_node_id}" is not an active peer`));
      return;
    }

    const urlCheck = await validateOutboundUrl(peer.url);
    if (!urlCheck.valid) {
      logger.warn(`Memory list-remote blocked: ${urlCheck.reason} (peer=${peer_node_id}, url=${peer.url})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach peer node: ${urlCheck.reason}`));
      return;
    }

    const gaii = resolve(req);
    const fetchUrl = `${peer.url.replace(/\/+$/, '')}/v1/federation/memory/list`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source-Node': config.nodeId,
        },
        body: JSON.stringify(await signedListBody(gaii)),
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_LIST_FAILED',
          `Peer node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { entries?: unknown[]; total?: number } };
      res.json(success(config.nodeId, {
        entries: remoteData?.data?.entries ?? [],
        total: remoteData?.data?.total ?? 0,
        source_node: peer.nodeId,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory list-remote error: ${message} (peer=${peer_node_id})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach peer node: ${message}`));
    }
  });

  // ── /v1/memory/pull-remote — Pull a specific key from a remote peer node (home users) ──
  // It writes a record here, so it costs memory:write, as POST /v1/memory does.
  router.post('/v1/memory/pull-remote', requireAuth(), homeSessionsOnly, requireScope('memory:write'), async (req, res) => {
    const { peer_node_id, key } = req.body ?? {};
    if (!peer_node_id || typeof peer_node_id !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'peer_node_id is required'));
      return;
    }
    if (!key || typeof key !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
      return;
    }
    const keyRefusal = await pullKeyRefusal(req, key);
    if (keyRefusal) {
      res.status(403).json(error(config.nodeId, keyRefusal.code, keyRefusal.message));
      return;
    }

    if (!peers) {
      res.status(503).json(error(config.nodeId, 'FEDERATION_UNAVAILABLE', 'Federation is not configured'));
      return;
    }

    const peer = peers.get(peer_node_id) ?? [...peers.values()].find(p => p.nodeId === peer_node_id);
    if (!peer || peer.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'PEER_NOT_FOUND', `Peer node "${peer_node_id}" is not an active peer`));
      return;
    }

    const urlCheck = await validateOutboundUrl(peer.url);
    if (!urlCheck.valid) {
      logger.warn(`Memory pull-remote blocked: ${urlCheck.reason} (peer=${peer_node_id}, url=${peer.url})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach peer node: ${urlCheck.reason}`));
      return;
    }

    const gaii = resolve(req);
    const fetchUrl = `${peer.url.replace(/\/+$/, '')}/v1/memory/${encodeURIComponent(gaii)}/${encodeURIComponent(key)}`;

    try {
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          'X-Source-Node': config.nodeId,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(config.federationTimeoutMs),
      });

      if (!response.ok) {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
        const body = await response.text().catch(() => '');
        res.status(response.status).json(error(config.nodeId, 'FEDERATION_PULL_FAILED',
          `Peer node returned ${response.status}: ${body.slice(0, 200)}`));
        return;
      }

      const remoteData = await response.json() as { data?: { value?: unknown; tags?: string[] } };
      const value = remoteData?.data?.value;
      const remoteTags = remoteData?.data?.tags ?? [];

      if (value === undefined) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Memory key "${key}" not found on peer node`));
        return;
      }

      const uniqueTags = [...new Set([...remoteTags, `pulled-from:${peer.nodeId}`])];
      if (!(await storePulled(req, res, gaii, key, value, uniqueTags, 'memory.pull-remote'))) return;

      res.json(success(config.nodeId, {
        pulled: true,
        key,
        source_node: peer.nodeId,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Memory pull-remote error: ${message} (peer=${peer_node_id}, key=${key})`);
      res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach peer node: ${message}`));
    }
  });
}
