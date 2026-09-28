/**
 * @file src/services/openapi-file.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Finds openapi.yaml on disk for the three code paths that serve it: GET /v1/spec
 *   (routes/spec.ts), GET /openapi.json (routes/agent-conventions.ts) and the operation index on
 *   /v1/docs (services/api-index.ts).
 *
 *   The contract lives at the REPO root, outside the aimeat/ package directory, so npm cannot ship it
 *   from there: `files` packs relative to package.json and no entry can name `../openapi.yaml`. The
 *   build copies it to dist/openapi.yaml (scripts/copy-dist-assets.mjs). Each reader used to look only
 *   relative to the working directory, which holds in a repo checkout and in no packaged install, so
 *   every packaged node answered /v1/spec with 404 while its own Link header advertised the address
 *   (reported from originalmiskate.com on 3.18.0, 2026-09-28).
 * @structure findOpenApiFile() → the first existing candidate path, or null
 * @usage import { findOpenApiFile } from '../services/openapi-file.js';
 * @version-history
 *   v1.0.0 — 2026-09-28 — One lookup for the three readers, with the packaged location added.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The path of openapi.yaml, or null when this install has none. */
export function findOpenApiFile(): string | null {
  // Beside this module first: the contract of the code that is running. The working directory comes
  // last, because a node started from another checkout's directory would otherwise serve that one.
  const candidates = [
    join(here, '..', '..', 'openapi.yaml'),     // built + npm: dist/src/services → dist/openapi.yaml
    join(here, '..', '..', '..', 'openapi.yaml'), // dev: aimeat/src/services → the repo root
    join(process.cwd(), 'openapi.yaml'),        // started from the repo root
    join(process.cwd(), '..', 'openapi.yaml'),  // started from aimeat/
  ];
  return candidates.find(existsSync) ?? null;
}
