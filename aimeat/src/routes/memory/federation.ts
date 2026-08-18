/**
 * @file src/routes/memory/federation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Federated memory browsing routes: pull, push-home, list-home (federated sessions) + list-remote, pull-remote (home users). Extracted from src/routes/memory.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-10 — Security audit H-15: list-home and list-remote sign the peer memory-list request
 *     with this node's key, matching the verification the receiving end now performs.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/memory.ts (max-file-lines)
 */

import type { Router } from 'express';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { validateOutboundUrl } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../../services/event-bus.js';
import { sign } from '../../auth/keypair.js';
import type { MemoryRouteCtx } from './shared.js';

export function registerFederationRoutes(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, peers, resolve } = ctx;

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

  // ── /v1/memory/pull — Copy a memory entry from home node to local (federated sessions) ──
  router.post('/v1/memory/pull', requireAuth(), async (req, res) => {
    if (!req.auth!.federated) {
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

    // Construct the owner's GHII on the home node
    const ownerGhii = `${req.auth!.owner}@${homeNode}`;

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

      // Store locally with private visibility and a pulled-from tag
      const localGhii = resolve(req);
      const now = new Date().toISOString();
      const existing = await storage.getMemory(localGhii, key);
      const tags = [...remoteTags, `pulled-from:${homeNode}`];
      // Deduplicate tags
      const uniqueTags = [...new Set(tags)];

      await storage.setMemory({
        key,
        ownerGaii: localGhii,
        value,
        visibility: 'private',
        tags: uniqueTags,
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      emitChange('memory');
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
    if (!req.auth!.federated) {
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
      const payload = {
        source_node: config.nodeId,
        gaii: `${req.auth!.owner}@${homeNode}`,
        key,
        value: record.value,
        visibility: record.visibility,
        version: record.version,
        timestamp: record.updatedAt,
        tags: record.tags ?? [],
      };

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
    if (!req.auth!.federated) {
      res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'This endpoint is only available for federated sessions'));
      return;
    }

    const homeNode = req.auth!.homeNode;
    const homeUrl = req.auth!.homeUrl;
    if (!homeNode || !homeUrl) {
      res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
      return;
    }

    const ownerGhii = `${req.auth!.owner}@${homeNode}`;

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
    if (req.auth!.federated) {
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
  router.post('/v1/memory/pull-remote', requireAuth(), async (req, res) => {
    if (req.auth!.federated) {
      res.status(400).json(error(config.nodeId, 'NOT_HOME', 'This endpoint is only available for home sessions'));
      return;
    }

    const { peer_node_id, key } = req.body ?? {};
    if (!peer_node_id || typeof peer_node_id !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'peer_node_id is required'));
      return;
    }
    if (!key || typeof key !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
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

      const now = new Date().toISOString();
      const existing = await storage.getMemory(gaii, key);
      const tags = [...remoteTags, `pulled-from:${peer.nodeId}`];
      const uniqueTags = [...new Set(tags)];

      await storage.setMemory({
        key,
        ownerGaii: gaii,
        value,
        visibility: 'private',
        tags: uniqueTags,
        ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      emitChange('memory');
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
