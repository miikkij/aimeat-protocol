/**
 * @file src/routes/spec.ts
 * @description Serves the canonical OpenAPI contract and interactive API docs — GET /v1/spec returns
 *   openapi.yaml as text/yaml; GET /v1/docs renders a Swagger UI page (with a relaxed CSP for the
 *   unpkg.com-hosted assets) pointed at /v1/spec.
 *
 * @structure
 *   - specRouter(): mounts GET /v1/spec (locates + serves openapi.yaml) and GET /v1/docs (Swagger UI)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function specRouter(): Router {
  const router = Router();

  // GET /v1/spec — serve the OpenAPI spec
  router.get('/v1/spec', (_req, res) => {
    // Try to find openapi.yaml relative to the project
    const candidates = [
      join(process.cwd(), 'openapi.yaml'),
      join(process.cwd(), '..', 'openapi.yaml'),
    ];

    for (const path of candidates) {
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf-8');
        res.type('text/yaml').send(content);
        return;
      }
    }

    res.status(404).json({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'OpenAPI spec not found' },
    });
  });

  // GET /v1/docs — Swagger UI with relaxed CSP for unpkg.com assets
  router.get('/v1/docs', (_req, res) => {
    const nonce = (res.locals.cspNonce as string) || '';
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://unpkg.com`,
      `style-src 'self' 'unsafe-inline' https://unpkg.com`,
      "connect-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '));
    res.type('text/html').send(`<!DOCTYPE html>
<html>
<head>
  <title>AIMEAT API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script nonce="${nonce}">
    SwaggerUIBundle({ url: '/v1/spec', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`);
  });

  return router;
}
