/**
 * @file src/routes/security-txt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /.well-known/security.txt (RFC 9116): where to report a vulnerability in this node.
 *   The file is built at each request from the live operator settings (services/security-txt.ts), so
 *   a contact the operator saves on the Config tab is served at once and Expires is always ahead.
 *   With no contact set the route steps aside and the address answers 404, as it did before the route
 *   existed. Public, on the node's own address only (an app origin serves the app's own files).
 * @structure securityTxtRouter(config) — mounts GET /.well-known/security.txt
 * @usage app.use(securityTxtRouter(config));
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, report 4.7).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { apexOnly } from './agent-docs.js';
import { buildSecurityTxt } from '../services/security-txt.js';

export function securityTxtRouter(config: AimeatConfig): Router {
  const router = Router();

  router.get('/.well-known/security.txt', apexOnly, (_req, res, next) => {
    const body = buildSecurityTxt(config);
    if (!body) { next(); return; }
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('text/plain; charset=utf-8').send(body);
  });

  return router;
}
