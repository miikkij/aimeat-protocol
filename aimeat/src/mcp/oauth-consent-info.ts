/**
 * @file src/mcp/oauth-consent-info.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/mcp/consent-info: what the MCP OAuth consent page shows about the app that
 *   asks, as this server checked it (services/oauth-consent-info.ts decides; this only answers). No
 *   credential: the page reads it before anyone signs in, and it says nothing the caller of the
 *   authorize step was not already told (secaudit2026oct22,
 *   mcp-oauth:consent-identity-from-request-not-verified-client).
 * @structure registerOAuthConsentInfo(router, storage)
 * @usage registerOAuthConsentInfo(router, storage) inside registerOAuthRoutes
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { type Request, type Response, type Router } from 'express';
import type { Storage } from '../storage/interface.js';
import { oauthConsentInfo } from '../services/oauth-consent-info.js';

export function registerOAuthConsentInfo(router: Router, storage: Storage): void {
  router.get('/v1/mcp/consent-info', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : '';
    const asked = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
    if (!clientId) {
      res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
      return;
    }
    const info = await oauthConsentInfo(storage, clientId, asked);
    if (!info) {
      res.status(404).json({ error: 'invalid_client', error_description: 'This server does not know this client_id.' });
      return;
    }
    res.json(info);
  });
}
