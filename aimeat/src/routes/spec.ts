import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  // GET /v1/docs — simple HTML redirect to Swagger UI
  router.get('/v1/docs', (_req, res) => {
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
  <script>
    SwaggerUIBundle({ url: '/v1/spec', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`);
  });

  return router;
}
