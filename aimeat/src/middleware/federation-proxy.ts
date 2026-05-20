/**
 * @file federation-proxy.ts
 * @description Utility for proxying requests from federated sessions to the user's home node.
 *   When a user is logged in via federated auth, certain operations (writes, balance checks)
 *   need to be forwarded to their home node. This utility handles the outbound request,
 *   URL validation (SSRF protection), and response forwarding.
 *
 * @structure
 *   - proxyToHomeNode() -- main export, sends request to home node and forwards response
 *
 * @usage
 *   import { proxyToHomeNode } from '../middleware/federation-proxy.js';
 *   const handled = await proxyToHomeNode(req, res, config, peers, '/v1/memory', 'POST', body);
 *   if (handled) return; // response already sent
 *
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial implementation for Phase 4 Federation Mesh
 */

import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { PeerInfo } from '../services/federation.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { error } from './envelope.js';
import { logger } from '../utils/logger.js';

/**
 * Proxy a request to the federated user's home node.
 *
 * @param req - Express request (must have req.auth with federated session claims)
 * @param res - Express response (used to forward the home node's response)
 * @param config - Node configuration
 * @param peers - Map of known federation peers
 * @param targetPath - The API path to call on the home node (e.g. '/v1/memory')
 * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
 * @param body - Optional request body (will be JSON-serialized)
 * @returns true if the response was handled (sent to client), false if not a federated session
 */
export async function proxyToHomeNode(
  req: Request,
  res: Response,
  config: AimeatConfig,
  peers: Map<string, PeerInfo>,
  targetPath: string,
  method: string,
  body?: unknown,
): Promise<boolean> {
  // Not a federated session -- caller should handle locally
  if (!req.auth?.federated) {
    return false;
  }

  const homeNode = req.auth.homeNode;
  const homeUrl = req.auth.homeUrl;

  if (!homeNode || !homeUrl) {
    res.status(400).json(error(config.nodeId, 'FEDERATION_ERROR', 'Federated session missing homeNode or homeUrl'));
    return true;
  }

  // Resolve home node URL: prefer peer map (verified), fall back to JWT claim
  let resolvedUrl = homeUrl;
  const peer = peers.get(homeNode);
  if (peer?.url) {
    resolvedUrl = peer.url;
  }

  // SSRF protection: validate the outbound URL
  const urlCheck = await validateOutboundUrl(resolvedUrl);
  if (!urlCheck.valid) {
    logger.warn(`Federation proxy blocked: ${urlCheck.reason} (homeNode=${homeNode}, url=${resolvedUrl})`);
    res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
    return true;
  }

  // Build the full target URL
  const fullUrl = `${resolvedUrl.replace(/\/+$/, '')}${targetPath}`;

  try {
    const headers: Record<string, string> = {
      'X-Source-Node': config.nodeId,
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(config.federationTimeoutMs),
    };

    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(fullUrl, fetchOptions);

    // Forward the response status and body
    const responseBody = await response.text();
    res.status(response.status);

    // Forward content-type if present
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.send(responseBody);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Federation proxy error: ${message} (homeNode=${homeNode}, path=${targetPath})`);
    res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR', `Failed to reach home node: ${message}`));
    return true;
  }
}
